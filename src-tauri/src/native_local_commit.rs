// Linux-only, currently unused by app commands. Local commit never grants private access.
use super::*;
use crate::db::native_database::{self as database, native_binding::Binding, native_keys as keys};
use std::{cell::RefCell, path::{Path, PathBuf}};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum KeyCreationEffect { Created, Failed { created: bool, phase: &'static str } }
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum SettingsEffect {
    NotAttempted,
    PrecommitError { phase: &'static str, cleanup_confirmed: bool },
    Committed { durability: Durability, published: bool },
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Effects {
    pub database_preparation_started: bool,
    pub database_fresh_may_have_created: bool,
    pub key_existing_loaded: bool,
    pub key_creation: Option<KeyCreationEffect>,
    pub settings: SettingsEffect,
    pub database_installation_attempted: bool,
    // Historical installation fact. database_close separately records final close confirmation.
    pub database_installed: bool,
    pub database_close: Option<bool>,
}
impl Default for Effects {
    fn default() -> Self { Self { database_preparation_started:false, database_fresh_may_have_created:false,
        key_existing_loaded:false, key_creation:None, settings:SettingsEffect::NotAttempted,
        database_installation_attempted:false, database_installed:false, database_close:None } }
}
#[derive(Debug)]
pub(crate) struct LocalError { pub code: &'static str, pub effects: Effects }
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum LocalOutcome {
    CommittedInactive { durability: Durability, effects: Effects },
    CommittedBlocked { durability: Durability, reason: &'static str, database_closed: bool, effects: Effects },
    CommittedPublicationFailed { durability: Durability, reason: &'static str, database_closed: bool, effects: Effects },
}
// Constructors cannot receive UI-selected paths. Production Fresh allocation and
// unassigned server provenance remain deliberately unavailable in this slice.
pub(crate) struct LocalPlan<'a> {
    store: database::Store<'a>,
    #[cfg(test)] fresh: Option<FreshIntent>,
    #[cfg(test)] controls: Option<TestControls<'a>>,
    #[cfg(test)] legacy_key_source_override: Option<PathBuf>,
}
#[cfg(test)]
struct FreshIntent { database: database::Namespace, key: database::Namespace, stable_uuid: String }
pub(crate) struct NativeSettingsTarget {
    path: PathBuf,
    #[cfg(test)] fault: Option<crate::private_store::TestFault>,
}
impl NativeSettingsTarget {
    pub(crate) fn for_application() -> Result<Self, &'static str> {
        let root = dirs::config_dir().ok_or("settings_unavailable")?;
        let path = root.join("skipi-crewing").join("settings.json");
        // Read-only admission. No config_path mkdir, relative fallback, chmod or adoption.
        crate::private_store::native_settings_destination(&path).map_err(|_| "settings_storage_error")?;
        Ok(Self { path, #[cfg(test)] fault:None })
    }
    #[cfg(test)]
    pub(super) fn for_test(path: &Path, fault: Option<crate::private_store::TestFault>) -> Self {
        crate::private_store::native_settings_destination(path).unwrap();
        Self { path:path.to_owned(), fault }
    }
    fn persist(&self, settings: &Settings) -> Result<Durability, crate::NativePersistError> {
        #[cfg(test)]
        if let Some(fault) = self.fault { return settings.persist_native_detailed_with_fault(&self.path, fault); }
        settings.persist_native_detailed(&self.path)
    }
}
impl LocalPlan<'static> {
    pub(crate) fn existing_application() -> Self {
        Self { store:database::Store::for_application(), #[cfg(test)] fresh:None, #[cfg(test)] controls:None, #[cfg(test)] legacy_key_source_override:None }
    }
}
struct LocalPrepared<'a> { database:database::Prepared<'a>, key:keys::UnpublishedKey, binding:Binding }
impl<'a> LocalPlan<'a> {
    fn legacy_key_namespace(&self) -> Result<database::Namespace,&'static str> {
        #[cfg(test)]
        {
            // Explicit native-owned test source, independent of FreshIntent.key.
            // Missing override never reads a workstation key in unit tests.
            let root=self.legacy_key_source_override.as_deref().ok_or("key_unavailable")?;
            return database::Namespace::inspect(root).map_err(|_|"key_unavailable");
        }
        #[cfg(not(test))]
        {
            // Same fixed Linux location as messaging::keys_dir, without calling
            // its mkdir/fallback path or any key generation/active crypto helper.
            let root=dirs::config_dir().ok_or("key_unavailable")?.join("skipi-crewing").join("keys");
            database::Namespace::inspect(&root).map_err(|_|"key_unavailable")
        }
    }
    fn key_created(&self, namespace:&database::Namespace, owner:database::Owner, effects:&RefCell<Effects>)
        -> Result<keys::UnpublishedKey, &'static str> {
        match keys::prepare_fresh(namespace, owner) {
            Ok(key) => {
                effects.borrow_mut().key_creation=Some(KeyCreationEffect::Created);
                Ok(key)
            },
            Err(error) => {
                effects.borrow_mut().key_creation=Some(KeyCreationEffect::Failed {created:error.created,phase:error.phase});
                Err("key_unavailable")
            },
        }
    }
    fn prepare(&self, current:&Settings, proposed:&Settings, allow_fresh:bool, effects:&RefCell<Effects>)
        -> Result<CorePrepared<LocalPrepared<'a>>, &'static str> {
        let record=proposed.native_account.as_ref().ok_or("login_required")?;
        let (mut bundle, reference) = if let Some(old) = current.native_account.as_ref() {
            // Unsupported historical native records never infer references or fall back to Fresh.
            let binding=old.binding().ok_or("native_binding_missing")?.clone();
            if !binding.matches_owner(&record.account_id,&proposed.crewing_id) { return Err("ownership_conflict"); }
            let namespace=binding.database_reference().namespace().map_err(|_|"database_unavailable")?;
            let key_namespace=binding.key_reference().namespace().map_err(|_|"key_unavailable")?;
            effects.borrow_mut().database_preparation_started=true;
            self.count_prepare();
            let database=self.store.prepare_existing(namespace,binding.owner().clone(),
                database::ExistingBinding::NativeSavedReference(binding.database_reference()))
                .map_err(|_|"database_unavailable")?;
            let key=keys::load_stored(&key_namespace,binding.owner(),binding.key_reference())
                .map_err(|_|"key_unavailable")?;
            effects.borrow_mut().key_existing_loaded=true;
            (LocalPrepared {database,key,binding}, WorkspaceReference::Keep)
        } else if mode(current,&[crate::api::PRIMARY_API,crate::api::RU_API]) == Mode::LegacyConnected {
            // This UUID binds the proven current resources locally. It is not a
            // new namespace or historical server attestation of the existing key.
            let stable_uuid=uuid::Uuid::new_v4().to_string();
            let owner=database::Owner::from_validated_binding(record.account_id.clone(),
                proposed.crewing_id.clone(),stable_uuid.clone()).map_err(|_|"ownership_conflict")?;
            effects.borrow_mut().database_preparation_started=true;
            self.count_prepare();
            let database=self.store.prepare_current_legacy(owner.clone(),&current.crewing_id)
                .map_err(|_|"database_unavailable")?;
            let key_namespace=self.legacy_key_namespace()?;
            let key=keys::inspect_legacy_snapshot(&key_namespace,owner,&current.crewing_id)
                .map_err(|_|"key_unavailable")?;
            effects.borrow_mut().key_existing_loaded=true;
            let binding=Binding::from_references(stable_uuid,database.reference(),key.reference())?;
            (LocalPrepared {database,key,binding},WorkspaceReference::Keep)
        } else {
            if !allow_fresh || mode(current,&[crate::api::PRIMARY_API,crate::api::RU_API]) != Mode::Unbound {
                return Err("migration_required");
            }
            #[cfg(not(test))]
            { return Err("fresh_context_unavailable"); }
            #[cfg(test)]
            {
                let fresh=self.fresh.as_ref().ok_or("fresh_context_unavailable")?;
                let owner=database::Owner::from_validated_binding(record.account_id.clone(),
                    proposed.crewing_id.clone(),fresh.stable_uuid.clone()).map_err(|_|"ownership_conflict")?;
                effects.borrow_mut().database_preparation_started=true;
                effects.borrow_mut().database_fresh_may_have_created=true;
                self.count_prepare();
                let database=self.store.prepare_fresh(fresh.database.clone(),owner.clone()).map_err(|_|"database_unavailable")?;
                let key=self.key_created(&fresh.key,owner,effects)?;
                let binding=Binding::from_references(fresh.stable_uuid.clone(),database.reference(),key.reference())?;
                let vault_path=database.reference().vault_path().ok_or("ownership_conflict")?.to_owned();
                (LocalPrepared {database,key,binding},WorkspaceReference::Fresh {vault_path})
            }
        };
        #[cfg(test)]
        if let Some(control)=&self.controls {
            match control.fault {
                KeyFault::WrongOwner | KeyFault::WrongReference => {
                    let owner=if control.fault==KeyFault::WrongOwner {
                        database::Owner::from_validated_binding("foreign-account".into(),proposed.crewing_id.clone(),
                            bundle.binding.stable_uuid().to_owned()).map_err(|_|"ownership_conflict")?
                    } else { bundle.binding.owner().clone() };
                    // Keep valid binding A, replace the actual prepared key with B.
                    bundle.key=self.key_created(&control.alternative,owner,effects)?;
                },
                KeyFault::BeforeRaw => self.mutate_key(&bundle.binding,&proposed.crewing_id,false)?,
                KeyFault::BeforeInode => self.mutate_key(&bundle.binding,&proposed.crewing_id,true)?,
                _ => (),
            }
        }
        if !bundle.binding.matches_owner(&record.account_id,&proposed.crewing_id)
            || !bundle.binding.matches_prepared(&bundle.database.reference(),&bundle.key.reference()) {
            return Err("ownership_conflict");
        }
        bundle.database.validate_before_persist().map_err(|_|"database_unavailable")?;
        bundle.key.validate_live().map_err(|_|"key_unavailable")?;
        #[cfg(test)]
        if let Some(control)=&self.controls {
            *control.references.borrow_mut()=Some(TestReferences {database:bundle.database.reference(),
                key:bundle.key.reference(),binding:bundle.binding.clone()});
        }
        let binding=Some(bundle.binding.clone());
        Ok(CorePrepared {workspace:PreparedWorkspace {reference,database:bundle},binding})
    }
    fn activate(&self, bundle:LocalPrepared<'a>, effects:&RefCell<Effects>) -> Result<(), &'static str> {
        // A failed first check drops the entire bundle before the caller's close.
        bundle.key.validate_live().map_err(|_|"key_unavailable")?;
        let LocalPrepared {database,key,binding:_}=bundle;
        effects.borrow_mut().database_installation_attempted=true;
        self.count_activate();
        database.activate_after_confirmed_commit().map_err(|_|"database_unavailable")?;
        effects.borrow_mut().database_installed=true;
        // Database guards have been consumed; retain key through the second check.
        key.validate_live().map_err(|_|"key_unavailable")?;
        Ok(())
    }
    fn count_prepare(&self) { #[cfg(test)] if let Some(c)=&self.controls { c.prepares.set(c.prepares.get()+1); } }
    fn count_persist(&self) { #[cfg(test)] if let Some(c)=&self.controls { c.persists.set(c.persists.get()+1); } }
    fn count_activate(&self) { #[cfg(test)] if let Some(c)=&self.controls { c.activations.set(c.activations.get()+1); } }
}
impl Runtime {
    pub(crate) fn commit_local(&self, proof:VerifiedLogin, plan:LocalPlan<'_>, target:NativeSettingsTarget)
        -> Result<LocalOutcome,LocalError> {
        let effects=RefCell::new(Effects::default());
        let allow_fresh=proof.attempt.create;
        let result=self.commit_core(proof,PublicationPolicy::LocalOnly,
            |current,proposed| plan.prepare(current,proposed,allow_fresh,&effects),
            |proposed| {
                plan.count_persist();
                match target.persist(proposed) {
                    Ok(durability) => {
                        effects.borrow_mut().settings=SettingsEffect::Committed {durability,published:false};
                        #[cfg(test)]
                        if plan.controls.as_ref().is_some_and(|c|c.fault==KeyFault::AfterRaw) {
                            // Same actual atomic writer has returned after rename.
                            // The closed test selector mutates only its proven owned key.
                            plan.mutate_key(proposed.native_account.as_ref().unwrap().binding().unwrap(),
                                &proposed.crewing_id,false).expect("owned postrename key fault setup");
                        }
                        Ok(durability)
                    },
                    Err(error) => {
                        effects.borrow_mut().settings=SettingsEffect::PrecommitError {
                            phase:error.phase,cleanup_confirmed:error.cleanup_confirmed};
                        Err(error.code)
                    },
                }
            },
            |bundle| plan.activate(bundle,&effects),
            || {
                // commit_core has dropped/consumed the entire DB bundle first.
                let confirmed=plan.store.close_all().is_ok();
                effects.borrow_mut().database_close=Some(confirmed);
                if confirmed {Ok(())} else {Err("database_unavailable")}
            });
        let mut effects=effects.into_inner();
        let outcome=match result {
            Err(error) => return Err(LocalError {code:error.code,effects}),
            Ok(outcome) => outcome,
        };
        let publication_ok=!matches!(outcome,CommitOutcome::CommittedPublicationFailed {..});
        if let SettingsEffect::Committed {published,..}=&mut effects.settings { *published=publication_ok; }
        Ok(match outcome {
            CommitOutcome::Ready => LocalOutcome::CommittedInactive {durability:Durability::Confirmed,effects},
            CommitOutcome::CommittedBlocked {durability,reason,database_closed} =>
                LocalOutcome::CommittedBlocked {durability,reason,database_closed,effects},
            CommitOutcome::CommittedPublicationFailed {durability,reason,database_closed} =>
                LocalOutcome::CommittedPublicationFailed {durability,reason,database_closed,effects},
        })
    }
}

#[cfg(test)]
#[derive(Clone)]
pub(super) struct TestReferences {
    pub(super) database:database::DatabaseReference,
    pub(super) key:keys::KeyReference,
    pub(super) binding:Binding,
}
#[cfg(test)]
#[derive(Clone,Copy,PartialEq,Eq)]
pub(super) enum KeyFault {None,WrongOwner,WrongReference,BeforeRaw,BeforeInode,AfterRaw}
#[cfg(test)]
pub(super) struct TestControls<'a> {
    pub(super) fault:KeyFault, pub(super) alternative:database::Namespace, pub(super) key_root:PathBuf,
    pub(super) references:&'a RefCell<Option<TestReferences>>,
    pub(super) prepares:&'a std::cell::Cell<usize>, pub(super) persists:&'a std::cell::Cell<usize>,
    pub(super) activations:&'a std::cell::Cell<usize>,
}
#[cfg(test)]
impl<'a> LocalPlan<'a> {
    pub(super) fn for_test(store:database::Store<'a>, database:database::Namespace, key:database::Namespace,
        stable_uuid:String, controls:TestControls<'a>) -> Self {
        // An explicit native-owned legacy source for unit fixtures; never infer
        // it from FreshIntent.key (Legacy caller tests deliberately supply a decoy).
        let legacy_key_source_override=Some(controls.key_root.clone());
        Self {store,fresh:Some(FreshIntent {database,key,stable_uuid}),controls:Some(controls),legacy_key_source_override}
    }
    fn mutate_key(&self,binding:&Binding,company:&str,inode:bool) -> Result<(), &'static str> {
        use std::{fs,io::Write,os::unix::fs::{MetadataExt,OpenOptionsExt}};
        let control=self.controls.as_ref().ok_or("key_unavailable")?;
        let namespace=database::Namespace::inspect(&control.key_root).map_err(|_|"key_unavailable")?;
        let before=keys::load_stored(&namespace,binding.owner(),binding.key_reference()).map_err(|_|"key_unavailable")?;
        let public=before.public_identity(); drop(before);
        let path=control.key_root.join(crate::messaging::SK_FILENAME);
        let identity=fs::metadata(&path).map_err(|_|"key_unavailable")?;
        let mut raw=fs::read(&path).map_err(|_|"key_unavailable")?;
        if raw.len()!=32 {return Err("key_unavailable");}
        if inode {
            fs::rename(&path,control.key_root.join("retained-original-key")).map_err(|_|"key_unavailable")?;
            fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&path)
                .and_then(|mut f|f.write_all(&raw)).map_err(|_|"key_unavailable")?;
            assert_ne!(fs::metadata(&path).unwrap().ino(),identity.ino());
        } else {
            raw[0]^=1;
            fs::write(&path,&raw).map_err(|_|"key_unavailable")?;
            assert_eq!(fs::metadata(&path).unwrap().ino(),identity.ino());
        }
        let after=keys::inspect_legacy_snapshot(&namespace,binding.owner().clone(),company).map_err(|_|"key_unavailable")?;
        assert_eq!(after.public_identity().user_id,public.user_id);
        assert_eq!(after.public_identity().pubkey_b64,public.pubkey_b64);
        Ok(())
    }
}
