mod local_joint {
    use super::*;
    use crate::db::native_database::{self as database, native_keys as keys, native_binding::Binding};
    use std::{cell::Cell, io::Write};
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

    use crate::native_lifecycle::local_commit::{self,KeyFault};
    type References=local_commit::TestReferences;
    struct Bundle<'a> {
        database: database::Prepared<'a>,
        key: keys::UnpublishedKey,
        binding: Binding,
    }
    #[derive(Debug, PartialEq, Eq)]
    enum JointOutcome {
        Inactive,
        AuthorizedFoundation,
        Blocked { durability: Durability, reason: &'static str, database_closed: bool },
        PublicationFailed { durability: Durability, reason: &'static str, database_closed: bool },
    }
    struct JointFixture {
        root: PathBuf, path: PathBuf, db_root: PathBuf, key_root: PathBuf, alternative_root: PathBuf,
        db_namespace: database::Namespace, key_namespace: database::Namespace,
        stable_uuid: String, owner: database::Owner,
        slot: Mutex<Option<Sqlite>>, quarantine: Mutex<Option<Sqlite>>,
        references: RefCell<Option<References>>,
        prepares: Cell<usize>, persists: Cell<usize>, activations: Cell<usize>,
    }
    impl JointFixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("crewing635-joint-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&root).unwrap();
            fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
            let db_root = root.join("database");
            let key_root = root.join("independent-keys");
            let alternative_root = root.join("alternative-keys");
            for path in [&db_root, &key_root, &alternative_root] {
                fs::create_dir(path).unwrap();
                fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap();
            }
            let stable_uuid = uuid::Uuid::new_v4().to_string();
            let owner = database::Owner::from_validated_binding(
                login().account_id, response().connection.workspace_id, stable_uuid.clone()).unwrap();
            Self {
                db_namespace: database::Namespace::inspect(&db_root).unwrap(),
                key_namespace: database::Namespace::inspect(&key_root).unwrap(),
                path: root.join("settings.json"), root, db_root, key_root, alternative_root,
                stable_uuid, owner, slot: Mutex::new(None), quarantine: Mutex::new(None),
                references: RefCell::new(None), prepares: Cell::new(0), persists: Cell::new(0), activations: Cell::new(0),
            }
        }
        fn store(&self) -> database::Store<'_> { database::Store::new(&self.slot, &self.quarantine) }
        fn legacy_settings(&self, raw_vault:&str) -> Settings {
            // Canonical owned DB/key installation precedes this explicit historical
            // legacy fixture. This is not a production native-to-legacy conversion.
            let mut settings=self.existing_settings(true);
            settings.native_account=None;
            settings.native_authorized=false;
            settings.bearer_token="legacy-owned-company-credential".into();
            settings.vault_path=raw_vault.into();
            settings.recent_vaults=vec!["".into(),"./historical-vault".into(),raw_vault.into()];
            settings.company_name="Preserved legacy company".into();
            assert_eq!(mode(&settings,&runtime_origins()),Mode::LegacyConnected);
            assert_eq!(crate::private_store::atomic_write(&self.path,
                &serde_json::to_vec_pretty(&settings).unwrap()).unwrap(),Durability::Confirmed);
            settings
        }
        fn legacy_apply(&self, runtime:&Runtime, proof:VerifiedLogin)
            -> Result<local_commit::LocalOutcome,local_commit::LocalError> {
            let database=self.root.join("decoy-fresh-database");
            let key=self.root.join("decoy-fresh-keys");
            for path in [&database,&key] {
                fs::create_dir(path).unwrap();
                fs::set_permissions(path,fs::Permissions::from_mode(0o700)).unwrap();
            }
            self.assert_legacy_decoys_empty();
            // Fresh allocation hints deliberately disagree with the active DB and
            // with the native-owned independent legacy load-only key source.
            let controls=local_commit::TestControls {fault:KeyFault::None,
                alternative:database::Namespace::inspect(&self.alternative_root).unwrap(),
                key_root:self.key_root.clone(),references:&self.references,
                prepares:&self.prepares,persists:&self.persists,activations:&self.activations};
            let plan=local_commit::LocalPlan::for_test(self.store(),
                database::Namespace::inspect(&database).unwrap(),
                database::Namespace::inspect(&key).unwrap(),self.stable_uuid.clone(),controls);
            let target=local_commit::NativeSettingsTarget::for_test(&self.path,None);
            runtime.commit_local(proof,plan,target)
        }
        fn assert_legacy_decoys_empty(&self) {
            for name in ["decoy-fresh-database","decoy-fresh-keys"] {
                let path=self.root.join(name);
                assert_eq!(fs::metadata(&path).unwrap().mode() & 0o777,0o700);
                assert_eq!(fs::read_dir(path).unwrap().count(),0,"Fresh decoy namespace must remain unused");
            }
        }
        fn base_settings(&self) -> Settings {
            let mut settings = Settings::default();
            settings.interface.theme = "dark".into();
            settings
        }
        fn existing_settings(&self, binding_present: bool) -> Settings {
            let database = self.store().prepare_fresh(self.db_namespace.clone(), self.owner.clone()).unwrap();
            let key = keys::prepare_fresh(&self.key_namespace, self.owner.clone()).unwrap();
            let db_reference = database.reference();
            let key_reference = key.reference();
            let binding = Binding::from_references(self.stable_uuid.clone(),
                db_reference.clone(), key_reference.clone()).unwrap();
            database.validate_before_persist().unwrap();
            let mut settings = self.base_settings();
            settings.profile.legal_name = "Canonical joint fixture profile".into();
            let reply = response();
            settings.server_url = reply.connection.server_url;
            settings.crewing_id = reply.connection.workspace_id;
            settings.bearer_token = reply.connection.bearer_token;
            settings.token_scopes = reply.connection.scopes;
            settings.token_expires_at = Some(reply.connection.expires_at);
            settings.vault_path = self.db_root.to_str().unwrap().into();
            settings.recent_vaults = vec![settings.vault_path.clone()];
            settings.native_account = Some(SessionRecord::new(login().account_id, login().token,
                false, reply.entitlement).with_binding(binding.clone()));
            // Fixture metadata uses finite ordinary JSON only. Production opaque
            // parsing never routes through Value; lexical controls are in format12.
            let mut record = serde_json::to_value(settings.native_account.as_ref().unwrap()).unwrap();
            record["future_session_meta"] = serde_json::json!({"keep":["session",17]});
            record["local_binding"]["future_binding_meta"] = serde_json::json!({"keep":["binding",19]});
            record["entitlement"]["future_grant_meta"] = serde_json::json!({"keep":["grant",23]});
            settings.native_account = Some(serde_json::from_value(record).unwrap());
            assert_eq!(settings.persist_native_to_path(&self.path).unwrap(), Durability::Confirmed);
            database.activate_after_confirmed_commit().unwrap();
            *self.references.borrow_mut() = Some(References { database: db_reference, key: key_reference, binding });
            self.slot.lock().unwrap().as_ref().unwrap().execute(
                "INSERT INTO vacancies(id,posted_at,payload_json,status) VALUES('fixture-row','fixture-date','{}','open')",
                []).unwrap();
            if !binding_present {
                // Deliberate historical-record fixture, after the real canonical
                // DB was installed against a confirmed v1 record. Strict action
                // must not infer these separately retained fixture references.
                settings.native_account = Some(SessionRecord::new(login().account_id, login().token,
                    false, response().entitlement));
                assert_eq!(settings.persist_native_to_path(&self.path).unwrap(), Durability::Confirmed);
            }
            settings
        }
        fn runtime(&self, settings: Settings) -> Arc<Runtime> {
            if settings.native_account.is_some() {
                assert_eq!(settings.persist_native_to_path(&self.path).unwrap(), Durability::Confirmed);
            } else {
                private_store::atomic_write(&self.path, &serde_json::to_vec(&settings).unwrap()).unwrap();
            }
            let mut runtime = Runtime::new(settings);
            Arc::get_mut(&mut runtime).unwrap().clock = Arc::new(ManualClock(Mutex::new(now())));
            runtime
        }
        fn proof(&self, runtime: &Runtime, fresh: bool) -> VerifiedLogin {
            let context = runtime.context().unwrap();
            let pending = runtime.start_login(&context, if fresh {
                CreationPolicy::FreshNativeContext
            } else { CreationPolicy::ExistingOrUncertain }).unwrap();
            let mut fake = Fake::default();
            fake.reply.connection.bearer_token = "skn_joint-next-company-credential".into();
            fake.reply.connection.expires_at = (now() + chrono::Duration::minutes(9)).to_rfc3339();
            let proof = runtime.authenticate(&fake, "joint@example.invalid", "synthetic-password", pending).unwrap();
            assert_eq!(proof.attempt.create, fresh);
            proof
        }
        fn reset_counters(&self) { self.prepares.set(0); self.persists.set(0); self.activations.set(0); }
        fn saved(&self) -> Settings { serde_json::from_slice(&self.bytes()).unwrap() }
        fn bytes(&self) -> Vec<u8> { fs::read(&self.path).unwrap() }
        fn row(&self) -> Option<(String, String, String)> {
            self.slot.lock().unwrap().as_ref().map(|database|
                database.query_row("SELECT posted_at,payload_json,status FROM vacancies WHERE id='fixture-row'",
                    [], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?))).unwrap())
        }
        fn row_when_closed(&self) -> (String, String, String) {
            // No independent main-inode FD while any SQLite handle is live.
            // Keep both owned slots excluded until this read-only handle closes.
            let slot = self.slot.lock().unwrap();
            let quarantine = self.quarantine.lock().unwrap();
            assert!(slot.is_none() && quarantine.is_none());
            let database = Sqlite::open_with_flags(self.db_root.join("crewing.sqlite"),
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX
                    | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW).unwrap();
            let row = database.query_row(
                "SELECT posted_at,payload_json,status FROM vacancies WHERE id='fixture-row'",
                [], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?))).unwrap();
            assert!(database.close().is_ok());
            drop(quarantine); drop(slot);
            row
        }
        fn pointer(&self) -> usize {
            self.slot.lock().unwrap().as_ref().map(|database| unsafe { database.handle() as usize }).unwrap_or(0)
        }
        fn close(&self) -> Result<(), &'static str> {
            self.store().close_all().map_err(|_| "database_unavailable")
        }
        fn mutate_key(&self, replace_inode: bool) {
            let path = self.key_root.join(crate::messaging::SK_FILENAME);
            let before = keys::inspect_legacy_snapshot(&self.key_namespace, self.owner.clone(),
                &response().connection.workspace_id).unwrap().public_identity();
            let inode = fs::symlink_metadata(&path).unwrap().ino();
            let raw = fs::read(&path).unwrap();
            assert_eq!(raw.len(), 32);
            if replace_inode {
                fs::rename(&path, self.key_root.join("retained-original-key")).unwrap();
                let mut file = fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&path).unwrap();
                file.write_all(&raw).unwrap(); file.sync_all().unwrap();
                assert_ne!(fs::symlink_metadata(&path).unwrap().ino(), inode);
            } else {
                let mut changed = raw.clone(); changed[0] ^= 1;
                assert!(changed != raw);
                fs::write(&path, changed).unwrap();
                assert_eq!(fs::symlink_metadata(&path).unwrap().ino(), inode);
            }
            let after = keys::inspect_legacy_snapshot(&self.key_namespace, self.owner.clone(),
                &response().connection.workspace_id).unwrap().public_identity();
            assert_eq!(before.user_id, after.user_id);
            assert_eq!(before.pubkey_b64, after.pubkey_b64,
                "same public identity does not prove unchanged raw key/reference");
        }
        fn prepare(&self, current: &Settings, fault: KeyFault) -> Result<PreparedWorkspace<Bundle<'_>>, &'static str> {
            self.prepares.set(self.prepares.get() + 1);
            let prior = self.references.borrow().clone();
            let database = if let Some(prior) = &prior {
                self.store().prepare_existing(self.db_namespace.clone(), self.owner.clone(),
                    database::ExistingBinding::NativeSavedReference(&prior.database))
            } else {
                self.store().prepare_fresh(self.db_namespace.clone(), self.owner.clone())
            }.map_err(|_| "database_unavailable")?;
            let key = if let Some(prior) = &prior {
                keys::load_stored(&self.key_namespace, &self.owner, &prior.key).map_err(|_| "key_unavailable")?
            } else {
                keys::prepare_fresh(&self.key_namespace, self.owner.clone()).map_err(|_| "key_unavailable")?
            };
            let references = if let Some(prior) = prior { prior } else {
                References { database: database.reference(), key: key.reference(),
                    binding: Binding::from_references(self.stable_uuid.clone(),
                        database.reference(), key.reference()).unwrap() }
            };
            database.validate_before_persist().map_err(|_| "database_unavailable")?;
            *self.references.borrow_mut() = Some(references.clone());
            let key = if matches!(fault, KeyFault::WrongOwner | KeyFault::WrongReference) {
                let owner = if fault == KeyFault::WrongOwner {
                    database::Owner::from_validated_binding("other-synthetic-account".into(),
                        response().connection.workspace_id, self.stable_uuid.clone()).unwrap()
                } else { self.owner.clone() };
                keys::prepare_fresh(&database::Namespace::inspect(&self.alternative_root).unwrap(), owner)
                    .map_err(|_| "key_unavailable")?
            } else { key };
            if matches!(fault, KeyFault::BeforeRaw | KeyFault::BeforeInode) {
                self.mutate_key(fault == KeyFault::BeforeInode);
            }
            let reference = if mode(current, &runtime_origins()) == Mode::Unbound {
                WorkspaceReference::Fresh { vault_path: self.db_root.to_str().unwrap().into() }
            } else { WorkspaceReference::Keep };
            Ok(PreparedWorkspace { reference, database: Bundle { database, key, binding: references.binding } })
        }
        // Baseline runs the actual current generic engine with real resources.
        // It intentionally lacks the future mandatory binding attachment/key
        // validation/LocalOnly policy. No fake strict result or effect report.
        fn foundation_apply(&self, runtime: &Runtime, proof: VerifiedLogin,
            key_fault: KeyFault, persist_fault: Option<TestFault>) -> Result<JointOutcome, &'static str> {
            runtime.commit(proof, |current, _| self.prepare(current, key_fault), |settings| {
                self.persists.set(self.persists.get() + 1);
                let durability = match persist_fault {
                    Some(fault) => settings.persist_native_with_fault(&self.path, fault)?,
                    None => settings.persist_native_to_path(&self.path)?,
                };
                if key_fault == KeyFault::AfterRaw { self.mutate_key(false); }
                Ok(durability)
            }, |bundle| {
                self.activations.set(self.activations.get() + 1);
                let Bundle { database, key, binding } = bundle;
                // These genuine values are not currently checked by Runtime.
                drop(key); drop(binding);
                database.activate_after_confirmed_commit().map_err(|_| "database_unavailable")
            }, || self.close()).map(|outcome| match outcome {
                CommitOutcome::Ready => JointOutcome::AuthorizedFoundation,
                CommitOutcome::CommittedBlocked {durability,reason,database_closed}
                    => JointOutcome::Blocked {durability,reason,database_closed},
                CommitOutcome::CommittedPublicationFailed {durability,reason,database_closed}
                    => JointOutcome::PublicationFailed {durability,reason,database_closed},
            }).map_err(|error| error.code)
        }
        fn local_apply(&self, runtime:&Runtime, proof:VerifiedLogin,
            key_fault:KeyFault, persist_fault:Option<TestFault>)
            -> Result<local_commit::LocalOutcome,local_commit::LocalError> {
            let controls=local_commit::TestControls {fault:key_fault,
                alternative:database::Namespace::inspect(&self.alternative_root).unwrap(),
                key_root:self.key_root.clone(),references:&self.references,
                prepares:&self.prepares,persists:&self.persists,activations:&self.activations};
            let plan=local_commit::LocalPlan::for_test(self.store(),self.db_namespace.clone(),
                self.key_namespace.clone(),self.stable_uuid.clone(),controls);
            let target=local_commit::NativeSettingsTarget::for_test(&self.path,persist_fault);
            runtime.commit_local(proof,plan,target)
        }
        fn apply(&self, runtime: &Runtime, proof: VerifiedLogin,
            key_fault: KeyFault, persist_fault: Option<TestFault>) -> Result<JointOutcome, &'static str> {
            self.local_apply(runtime,proof,key_fault,persist_fault).map(|outcome| match outcome {
                local_commit::LocalOutcome::CommittedInactive {..} => JointOutcome::Inactive,
                local_commit::LocalOutcome::CommittedBlocked {durability,reason,database_closed,..}
                    => JointOutcome::Blocked {durability,reason,database_closed},
                local_commit::LocalOutcome::CommittedPublicationFailed {durability,reason,database_closed,..}
                    => JointOutcome::PublicationFailed {durability,reason,database_closed},
            }).map_err(|error|error.code)
        }
        fn seed_native_session(&self, runtime: &Arc<Runtime>) {
            // NativeSession comes from the existing cfgtest foundation engine,
            // real canonical DB/key preparation and actual atomic persistence.
            let proof = super::proof(runtime, &Fake::default());
            assert_eq!(self.foundation_apply(runtime, proof, KeyFault::None, None).unwrap(),
                JointOutcome::AuthorizedFoundation);
            assert!(runtime.ticket(&runtime.context().unwrap()).is_ok());
            self.reset_counters();
        }
        fn assert_bound_record(&self, settings: &Settings) {
            let record = settings.native_account.as_ref().expect("native record");
            assert!(record.has_binding(), "actual prepared DB/key references must be attached before persistence");
            let value = serde_json::to_value(record).unwrap();
            assert_eq!(value["record_version"], 1);
            assert_eq!(value["local_binding"]["stable_uuid"], self.stable_uuid);
            let database: database::DatabaseReference = serde_json::from_value(value["local_binding"]["database_ref"].clone()).unwrap();
            let key: keys::KeyReference = serde_json::from_value(value["local_binding"]["key_ref"].clone()).unwrap();
            let references = self.references.borrow();
            let references = references.as_ref().unwrap();
            assert_eq!(database, references.database);
            assert_eq!(key, references.key);
        }
    }
    fn runtime_origins() -> Vec<&'static str> { vec![crate::api::PRIMARY_API,crate::api::RU_API] }
    fn business_row() -> Option<(String,String,String)> {
        Some(("fixture-date".into(),"{}".into(),"open".into()))
    }
    impl Drop for JointFixture {
        fn drop(&mut self) {
            self.store().close_all().unwrap();
            fs::remove_dir_all(&self.root).unwrap();
        }
    }

    // No.880 S2-fix, блокер F11 (аудит Супервайзора 3458f16b). Ветка Fresh была
    // подключена к аллокатору, но ПРОДУКТ в неё не попадал: `create` требует
    // трёх конъюнктов, и третий — политика вызывающего, а единственный
    // продуктовый вызов передавал `ExistingOrUncertain`. Соседний тест выше
    // проверяет Fresh с ЯВНЫМ `fresh = true` и потому дефект не видит: он
    // проверяет ветку, а не достижимость ветки продуктом.
    // Здесь политика берётся ТЕМ ЖЕ местом, которым её берёт продукт
    // (`CreationPolicy::for_interactive_login()`), поэтому расхождение между
    // продуктовым вызовом и тестом становится невозможным по конструкции.
    #[test]
    fn native635_880_f11_production_policy_on_clean_install_reaches_fresh() {
        let fixture = JointFixture::new();
        let runtime = fixture.runtime(fixture.base_settings());
        // ПОЛОЖИТЕЛЬНЫЙ КОНТРОЛЬ: установка действительно чистая, иначе тест
        // доказывал бы совсем другой исход.
        assert_eq!(mode(&runtime.settings_arc().lock().unwrap(), &runtime_origins()), Mode::Unbound,
            "control: the fixture must be an unbound install");
        let context = runtime.context().unwrap();
        let pending = runtime.start_login(&context, CreationPolicy::for_interactive_login()).unwrap();
        let mut fake = Fake::default();
        fake.reply.connection.bearer_token = "skn_joint-next-company-credential".into();
        fake.reply.connection.expires_at = (now() + chrono::Duration::minutes(9)).to_rfc3339();
        let proof = runtime.authenticate(&fake, "joint@example.invalid", "synthetic-password", pending).unwrap();
        assert!(proof.attempt.create,
            "the policy the product passes must permit creating a context on a clean install");
        let outcome = fixture.apply(&runtime, proof, KeyFault::None, None);
        assert_eq!(outcome, Ok(JointOutcome::Inactive),
            "a clean install signing in with the PRODUCTION policy must reach the fresh local context, not migration_required");
        // И рабочее место действительно выделено, а не объявлено.
        assert!(fixture.references.borrow().is_some(), "fresh local references were actually prepared");
    }

    #[test]
    fn native635_joint_fresh_actual_resources_are_atomically_bound_and_inactive() {
        let fixture = JointFixture::new();
        let initial = fixture.base_settings();
        let initial_profile = serde_json::to_value(&initial.profile).unwrap();
        let runtime = fixture.runtime(initial);
        let proof = fixture.proof(&runtime, true);
        let outcome = fixture.apply(&runtime, proof, KeyFault::None, None).unwrap();
        let saved = fixture.saved();
        fixture.assert_bound_record(&saved);
        assert_eq!(outcome, JointOutcome::Inactive, "local coherent commit must not grant a private session");
        assert_eq!((fixture.prepares.get(),fixture.persists.get(),fixture.activations.get()), (1,1,1));
        assert_eq!(serde_json::to_value(&saved.profile).unwrap(), initial_profile);
        assert_eq!(saved.interface.theme, "dark");
        let references = fixture.references.borrow();
        let reference = &references.as_ref().unwrap().key;
        assert_eq!(keys::load_stored(&fixture.key_namespace,&fixture.owner,reference).unwrap().reference(), *reference);
        drop(references);
        let current = runtime.settings.lock().unwrap();
        fixture.assert_bound_record(&current);
        assert!(!current.native_authorized);
        assert_eq!(mode(&current,&runtime.origins()),Mode::NativeLocked);
        drop(current);
        assert!(runtime.denied.load(Ordering::SeqCst));
        assert!(runtime.ticket(&runtime.context().unwrap()).is_err());
        assert_ne!(fixture.pointer(),0,"confirmed inactive local DB handle is installed");
    }

    #[test]
    fn native635_joint_old_native_record_refuses_before_any_preparation_or_persist() {
        let fixture = JointFixture::new();
        let runtime = fixture.runtime(fixture.existing_settings(false));
        let old_bytes = fixture.bytes(); let old_context = runtime.context().unwrap();
        let old_pointer = fixture.pointer();
        let proof = fixture.proof(&runtime,false);
        let result = fixture.apply(&runtime,proof,KeyFault::None,None);
        assert_eq!(fixture.prepares.get(),0,"missing binding must not infer fixture DB/key references");
        assert_eq!(fixture.persists.get(),0);
        assert_eq!(fixture.activations.get(),0);
        assert!(result.is_err());
        assert_eq!(fixture.bytes(),old_bytes);
        assert_eq!(runtime.context().unwrap(),old_context);
        assert_eq!(fixture.pointer(),old_pointer);
        assert_eq!(fixture.row(),business_row());
    }

    #[test]
    fn native635_joint_wrong_actual_prepared_key_owner_or_reference_is_precommit() {
        for fault in [KeyFault::WrongOwner,KeyFault::WrongReference] {
            let fixture = JointFixture::new();
            let runtime = fixture.runtime(fixture.existing_settings(true));
            fixture.seed_native_session(&runtime);
            let old_bytes = fixture.bytes(); let old_context = runtime.context().unwrap();
            let old_pointer = fixture.pointer();
            let proof = fixture.proof(&runtime,false);
            let result = fixture.apply(&runtime,proof,fault,None);
            assert!(result.is_err(),"valid binding A must not accept actual prepared key B");
            assert_eq!(fixture.persists.get(),0);
            assert_eq!(fixture.activations.get(),0);
            assert_eq!(fixture.bytes(),old_bytes);
            assert_eq!(runtime.context().unwrap(),old_context);
            assert_eq!(fixture.pointer(),old_pointer);
            assert_eq!(fixture.row(),business_row());
        }
    }

    #[test]
    fn native635_joint_actual_key_raw_or_inode_change_before_persist_is_refused() {
        for fault in [KeyFault::BeforeRaw,KeyFault::BeforeInode] {
            let fixture = JointFixture::new();
            let runtime = fixture.runtime(fixture.existing_settings(true));
            fixture.seed_native_session(&runtime);
            let old_bytes = fixture.bytes(); let old_pointer = fixture.pointer();
            let proof = fixture.proof(&runtime,false);
            let result = fixture.apply(&runtime,proof,fault,None);
            assert!(result.is_err(),"live validation must detect changed key despite identical public identity");
            assert_eq!(fixture.persists.get(),0);
            assert_eq!(fixture.activations.get(),0);
            assert_eq!(fixture.bytes(),old_bytes);
            assert_eq!(fixture.pointer(),old_pointer);
            assert_eq!(fixture.row(),business_row());
            // The deliberately tampered old key is not a preserved usable private
            // session. No ticket/crypto-usability success is inferred here.
        }
    }

    #[test]
    fn native635_joint_postrename_key_change_keeps_new_matching_record_blocked() {
        let fixture = JointFixture::new();
        let runtime = fixture.runtime(fixture.existing_settings(true));
        fixture.seed_native_session(&runtime);
        let old_bytes = fixture.bytes(); let old_context = runtime.context().unwrap();
        let old_ticket = runtime.ticket(&old_context).unwrap();
        let proof = fixture.proof(&runtime,false);
        let outcome = fixture.apply(&runtime,proof,KeyFault::AfterRaw,None).unwrap();
        assert_eq!(outcome,JointOutcome::Blocked { durability:Durability::Confirmed,
            reason:"key_unavailable",database_closed:true });
        assert_eq!(fixture.persists.get(),1);
        assert_eq!(fixture.activations.get(),0,"postrename key check precedes DB installation");
        assert_ne!(fixture.bytes(),old_bytes);
        let saved = fixture.saved();
        fixture.assert_bound_record(&saved);
        assert_eq!(saved.bearer_token,"skn_joint-next-company-credential");
        let current = runtime.settings.lock().unwrap();
        fixture.assert_bound_record(&current);
        assert_eq!(current.bearer_token,saved.bearer_token);
        assert!(!current.native_authorized);
        drop(current);
        assert!(fixture.row().is_none());
        assert_eq!(Some(fixture.row_when_closed()),business_row());
        assert!(old_ticket.lease().is_err());
        assert!(runtime.ticket(&runtime.context().unwrap()).is_err());
    }

    #[test]
    fn native635_joint_actual_file_sync_failure_preserves_old_settings_handle_and_business_row() {
        let fixture = JointFixture::new();
        let runtime = fixture.runtime(fixture.existing_settings(true));
        fixture.seed_native_session(&runtime);
        let old_bytes = fixture.bytes(); let old_context = runtime.context().unwrap();
        let old_pointer = fixture.pointer(); assert_ne!(old_pointer,0);
        let proof = fixture.proof(&runtime,false);
        let result = fixture.apply(&runtime,proof,KeyFault::None,Some(TestFault::FileSync));
        assert_eq!(result.unwrap_err(),"settings_storage_error");
        assert_eq!((fixture.prepares.get(),fixture.persists.get(),fixture.activations.get()),(1,1,0));
        assert_eq!(fixture.bytes(),old_bytes);
        assert_eq!(runtime.context().unwrap(),old_context);
        assert_eq!(fixture.pointer(),old_pointer);
        assert_eq!(fixture.row(),business_row());
        fixture.assert_bound_record(&fixture.saved());
        assert!(runtime.ticket(&old_context).is_ok());
    }

    #[test]
    fn native635_joint_actual_directory_sync_unknown_keeps_new_v1_record_blocked() {
        let fixture = JointFixture::new();
        let runtime = fixture.runtime(fixture.existing_settings(true));
        fixture.seed_native_session(&runtime);
        let old_bytes = fixture.bytes(); let old_context = runtime.context().unwrap();
        let old_ticket = runtime.ticket(&old_context).unwrap();
        let proof = fixture.proof(&runtime,false);
        let outcome = fixture.apply(&runtime,proof,KeyFault::None,Some(TestFault::DirectorySync)).unwrap();
        assert_eq!(outcome,JointOutcome::Blocked {durability:Durability::CommittedUnknown,
            reason:"settings_durability_unknown",database_closed:true});
        assert_eq!((fixture.prepares.get(),fixture.persists.get(),fixture.activations.get()),(1,1,0));
        assert_ne!(fixture.bytes(),old_bytes);
        let saved = fixture.saved(); fixture.assert_bound_record(&saved);
        assert_eq!(saved.bearer_token,"skn_joint-next-company-credential");
        let current = runtime.settings.lock().unwrap();
        fixture.assert_bound_record(&current);
        assert_eq!(current.bearer_token,saved.bearer_token);
        assert!(current.storage_uncertain && !current.native_authorized);
        drop(current);
        assert!(fixture.row().is_none());
        assert_eq!(Some(fixture.row_when_closed()),business_row());
        assert!(old_ticket.lease().is_err());
        assert!(runtime.ticket(&runtime.context().unwrap()).is_err());
    }

    #[test]
    fn native635_joint_same_owner_refresh_preserves_private_binding_and_opaque_metadata_but_is_inactive() {
        let fixture = JointFixture::new();
        let runtime = fixture.runtime(fixture.existing_settings(true));
        fixture.seed_native_session(&runtime);
        let before = serde_json::to_value(fixture.saved().native_account.unwrap()).unwrap();
        let old_context = runtime.context().unwrap();
        let old_ticket = runtime.ticket(&old_context).unwrap();
        let mut fake = Fake::default();
        fake.reply.connection.bearer_token = "skn_joint-next-company-credential".into();
        fake.reply.connection.expires_at = (now()+chrono::Duration::minutes(9)).to_rfc3339();
        let proof = runtime.refresh(&fake,&old_context).unwrap();
        let outcome = fixture.apply(&runtime,proof,KeyFault::None,None).unwrap();
        let saved = fixture.saved(); fixture.assert_bound_record(&saved);
        let after = serde_json::to_value(saved.native_account.as_ref().unwrap()).unwrap();
        assert_eq!(after["local_binding"],before["local_binding"]);
        assert_eq!(after["future_session_meta"],before["future_session_meta"]);
        assert_eq!(after["entitlement"]["future_grant_meta"],before["entitlement"]["future_grant_meta"]);
        assert_eq!(saved.bearer_token,"skn_joint-next-company-credential");
        assert_eq!(saved.token_expires_at,Some((now()+chrono::Duration::minutes(9)).to_rfc3339()));
        assert_eq!(outcome,JointOutcome::Inactive,"LocalOnly refresh must revoke prior model authorization");
        assert_eq!(mode(&runtime.settings.lock().unwrap(),&runtime.origins()),Mode::NativeLocked);
        assert!(old_ticket.lease().is_err());
        assert!(runtime.ticket(&runtime.context().unwrap()).is_err());
        assert_eq!(fixture.row(),business_row());
    }

    #[test]
    fn native635_joint_fresh_file_sync_error_reports_actual_artifacts_phase_and_cleanup() {
        let fixture=JointFixture::new();
        let runtime=fixture.runtime(fixture.base_settings());
        let old_bytes=fixture.bytes();
        let old_inode=fs::metadata(&fixture.path).unwrap().ino();
        let proof=fixture.proof(&runtime,true);
        let error=fixture.local_apply(&runtime,proof,KeyFault::None,Some(TestFault::FileSync)).unwrap_err();
        assert_eq!(error.code,"settings_storage_error");
        let effects=error.effects;
        assert!(effects.database_preparation_started && effects.database_fresh_may_have_created);
        assert_eq!(effects.key_creation,Some(local_commit::KeyCreationEffect::Created));
        assert!(!effects.key_existing_loaded);
        assert_eq!(effects.settings,local_commit::SettingsEffect::PrecommitError {
            phase:"file_sync",cleanup_confirmed:true});
        assert!(!effects.database_installation_attempted && !effects.database_installed);
        assert_eq!(effects.database_close,None,"unpublished Prepared drop is not an explicit Store close claim");
        assert_eq!(fixture.bytes(),old_bytes,"precommit error preserves initial Settings bytes");
        assert_eq!(fs::metadata(&fixture.path).unwrap().ino(),old_inode,"precommit error preserves initial Settings inode");
        assert!(fixture.slot.lock().unwrap().is_none());
        assert!(fixture.quarantine.lock().unwrap().is_none());
        // A precommit error does not imply no new artifacts. These are actual
        // files from canonical prepare, not an effect placeholder or predicted path.
        assert!(fs::metadata(fixture.db_root.join("crewing.sqlite")).unwrap().is_file());
        let references=fixture.references.borrow();
        let key=&references.as_ref().unwrap().key;
        assert_eq!(keys::load_stored(&fixture.key_namespace,&fixture.owner,key).unwrap().reference(),*key);
        assert!(!fs::read_dir(&fixture.root).unwrap().any(|entry|
            entry.unwrap().file_name().to_string_lossy().contains(".pending-")));
        assert_eq!(mode(&runtime.settings.lock().unwrap(),&runtime.origins()),Mode::Unbound);
    }

    #[test]
    fn native635_joint_legacy_empty_or_relative_vault_uses_live_physical_db_and_independent_existing_key() {
        for raw_vault in ["","./old-relative-vault"] {
            let fixture=JointFixture::new();
            let initial=fixture.legacy_settings(raw_vault);
            let profile=serde_json::to_value(&initial.profile).unwrap();
            let recent=initial.recent_vaults.clone();
            let company_name=initial.company_name.clone();
            let runtime=fixture.runtime(initial);
            let old_context=runtime.context().unwrap();
            assert_ne!(fixture.pointer(),0);
            assert_eq!(fixture.row(),business_row());
            let key_path=fixture.key_root.join(crate::messaging::SK_FILENAME);
            let old_key=fs::read(&key_path).unwrap();
            let old_key_inode=fs::metadata(&key_path).unwrap().ino();
            let proof=fixture.proof(&runtime,false);
            let outcome=fixture.legacy_apply(&runtime,proof).unwrap();
            let effects=match outcome {
                local_commit::LocalOutcome::CommittedInactive {durability:Durability::Confirmed,effects} => effects,
                other=>panic!("legacy conversion must be coherent and inactive: {other:?}"),
            };
            fixture.assert_legacy_decoys_empty();
            assert!(effects.database_preparation_started);
            assert!(!effects.database_fresh_may_have_created);
            assert!(effects.key_existing_loaded);
            assert_eq!(effects.key_creation,None,"legacy key must be loaded without creation or rekey");
            assert!(effects.database_installed && effects.database_installation_attempted);
            assert_eq!(effects.database_close,None,"successful inactive conversion retains a DB handle");
            assert_eq!(effects.settings,local_commit::SettingsEffect::Committed {
                durability:Durability::Confirmed,published:true});
            assert_eq!((fixture.prepares.get(),fixture.persists.get(),fixture.activations.get()),(1,1,1));
            let saved=fixture.saved();
            assert_eq!(saved.vault_path,raw_vault,"keep the literal saved vault, even when empty/relative");
            assert_eq!(saved.recent_vaults,recent);
            assert_eq!(saved.company_name,company_name);
            assert_eq!(serde_json::to_value(&saved.profile).unwrap(),profile);
            let binding=saved.native_account.as_ref().unwrap().binding().unwrap();
            assert!(binding.matches_owner(&login().account_id,&response().connection.workspace_id));
            assert_ne!(binding.stable_uuid(),fixture.stable_uuid,"adoption issues a new native context, not a Fresh namespace");
            let uuid=uuid::Uuid::parse_str(binding.stable_uuid()).unwrap();
            assert_eq!(uuid.get_version_num(),4);
            assert_eq!(binding.database_reference().vault_path(),fixture.db_root.to_str());
            let references=fixture.references.borrow();
            let actual=references.as_ref().unwrap();
            assert!(binding.matches_prepared(&actual.database,&actual.key),
                "compare with actual prepared refs captured before Settings serialization");
            assert_eq!(keys::load_stored(&fixture.key_namespace,binding.owner(),&actual.key).unwrap().reference(),actual.key);
            drop(references);
            assert_eq!(fs::read(&key_path).unwrap(),old_key);
            assert_eq!(fs::metadata(&key_path).unwrap().ino(),old_key_inode);
            assert_ne!(fixture.pointer(),0);
            assert_eq!(fixture.row(),business_row());
            let current=runtime.settings.lock().unwrap();
            assert_eq!(current.vault_path,raw_vault);
            assert_eq!(current.recent_vaults,recent);
            assert_eq!(serde_json::to_value(&current.profile).unwrap(),profile);
            assert!(!current.native_authorized);
            assert_eq!(mode(&current,&runtime.origins()),Mode::NativeLocked);
            drop(current);
            assert_ne!(runtime.context().unwrap(),old_context);
            assert!(runtime.denied.load(Ordering::SeqCst));
            assert!(runtime.ticket(&runtime.context().unwrap()).is_err());
        }
    }

    #[test]
    fn native635_joint_legacy_without_live_handle_refuses_without_inference_or_creation() {
        let fixture=JointFixture::new();
        let runtime=fixture.runtime(fixture.legacy_settings(""));
        fixture.close().unwrap();
        assert_eq!(fixture.pointer(),0);
        let old_bytes=fixture.bytes(); let old_context=runtime.context().unwrap();
        let key_path=fixture.key_root.join(crate::messaging::SK_FILENAME);
        let old_key=fs::read(&key_path).unwrap();
        let old_inode=fs::metadata(fixture.db_root.join("crewing.sqlite")).unwrap().ino();
        let proof=fixture.proof(&runtime,false);
        let error=fixture.legacy_apply(&runtime,proof).unwrap_err();
        fixture.assert_legacy_decoys_empty();
        assert!(!error.effects.database_fresh_may_have_created);
        assert_eq!(error.effects.key_creation,None);
        assert_eq!(error.effects.settings,local_commit::SettingsEffect::NotAttempted);
        assert!(!error.effects.database_installed && !error.effects.database_installation_attempted);
        assert_eq!((fixture.persists.get(),fixture.activations.get()),(0,0));
        assert_eq!(fixture.bytes(),old_bytes);
        assert_eq!(runtime.context().unwrap(),old_context);
        assert_eq!(fixture.pointer(),0);
        assert_eq!(fs::metadata(fixture.db_root.join("crewing.sqlite")).unwrap().ino(),old_inode);
        assert_eq!(Some(fixture.row_when_closed()),business_row());
        assert_eq!(fs::read(&key_path).unwrap(),old_key);
        assert_eq!(mode(&runtime.settings.lock().unwrap(),&runtime.origins()),Mode::LegacyConnected);
    }
}
