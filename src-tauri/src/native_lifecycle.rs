// Startup shares this Runtime Settings owner; native commands/consumers remain disabled.
use chrono::{DateTime, Utc};
use std::sync::{Arc, Mutex, RwLock, RwLockReadGuard};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use crate::{Settings, connection_context, connection_context_matches};
use crate::native_account::{self, BootstrapResponse, Connection, Entitlement, LoginResponse};
use crate::private_store::Durability;

#[path = "native_session_record.rs"]
mod record;
pub(crate) use record::SessionRecord;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Mode { Unbound, LegacyConnected, NativeLocked, NativeSession, SignedOut, Unavailable }

fn stored_response(s: &Settings) -> Option<BootstrapResponse> {
    let record = s.native_account.as_ref()?;
    Some(BootstrapResponse {
        account_id: record.account_id.clone(),
        connection: Connection {
            server_url: s.server_url.clone(), crewing_id: s.crewing_id.clone(),
            organization_id: if s.organization_id.is_empty() { None } else { Some(s.organization_id.clone()) },
            bearer_token: s.bearer_token.clone(), scopes: s.token_scopes.clone(),
            expires_at: s.token_expires_at.clone()?,
        }, entitlement: record.entitlement.clone(),
    })
}
fn stored_shape(s: &Settings, origins: &[&str]) -> bool {
    let Some(record) = &s.native_account else { return false; };
    record.binding_matches(&s.crewing_id)
        && native_account::valid_id(&record.account_id)
        && native_account::valid_opaque_credential(&record.app_credential)
        && stored_response(s).is_some_and(|r| r.validate_stored_shape(
            &record.account_id, Some(&s.crewing_id), origins,
        ).is_ok())
}
// No.828 ((1493)): `company_name` ИСКЛЮЧЕНО из признаков. Это свободный текст
// профиля без валидации, он никогда не уходит как идентификатор и участвует только
// в отображении — поэтому вписанное название организации не делает установку
// связанной и не должно закрывать вход аккаунтом (Mode::Unavailable).
// Признаков 11; каждый остальной — настоящий локальный артефакт или след прежней
// привязки, и ни один не снят.
fn local_identity_present(s: &Settings) -> bool {
    !s.bearer_token.is_empty() || !s.crewing_id.is_empty() || !s.organization_id.is_empty()
        || !s.vault_path.is_empty() || !s.recent_vaults.is_empty()
        || !s.user_display_name.is_empty() || !s.reply_to.is_empty() || !s.token_scopes.is_empty()
        || s.token_expires_at.is_some() || !s.team_role.is_empty()
        || serde_json::to_value(&s.profile).ok() != serde_json::to_value(crate::CrewingProfile::default()).ok()
}
pub(crate) fn mode(s: &Settings, origins: &[&str]) -> Mode {
    if s.load_uncertain || s.storage_uncertain { return Mode::Unavailable; }
    if let Some(record) = &s.native_account {
        if !stored_shape(s, origins) { return Mode::Unavailable; }
        if record.signed_out { return Mode::SignedOut; }
        return if s.native_authorized { Mode::NativeSession } else { Mode::NativeLocked };
    }
    if s.bearer_token.trim().starts_with("skn_") { return Mode::NativeLocked; }
    if !s.server_url.trim().is_empty()
        && native_account::valid_opaque_credential(s.bearer_token.trim())
        && native_account::valid_id(s.crewing_id.trim()) { return Mode::LegacyConnected; }
    if local_identity_present(s) { Mode::Unavailable } else { Mode::Unbound }
}
pub(crate) fn private_access(s: &Settings, origins: &[&str], now: DateTime<Utc>) -> Result<(), &'static str> {
    match mode(s, origins) {
        Mode::LegacyConnected => Ok(()),
        Mode::NativeSession => {
            let record = s.native_account.as_ref().ok_or("login_required")?;
            let response = stored_response(s).ok_or("login_required")?;
            let times = response.validate_stored_shape(&record.account_id, Some(&s.crewing_id), origins)?;
            if times.entitlement_expiry.is_some_and(|expiry| expiry <= now) { return Err("entitlement_expired"); }
            if times.connection_expiry <= now { return Err("connection_expired"); }
            response.validate(&record.account_id, Some(&s.crewing_id), origins, now)
        },
        Mode::Unavailable => Err("settings_unavailable"),
        _ => Err("login_required"),
    }
}

// An explicit native-owned fresh context is a creation intent, never server ownership proof.
// No value of this type comes from JS. Its production allocator remains a later integration.
#[derive(Clone, Copy)]
pub(crate) enum CreationPolicy { ExistingOrUncertain, FreshNativeContext }
impl CreationPolicy {
    // No.880 S2-fix (F11). Политика ИНТЕРАКТИВНОГО входа живёт в ОДНОМ месте,
    // которым пользуются и продукт, и тест: иначе продуктовый вызов и тест
    // расходятся молча — ровно так дефект и прожил весь S2.
    //
    // Передаётся БЕЗУСЛОВНО, и это безопасно по двум измеренным причинам.
    // Первая: на проводе поле называется `create_if_missing`
    // (`native_account.rs`, `/api/app/crewing/bootstrap`) — сервер создаёт
    // рабочее место только при отсутствии и не дублирует его вернувшемуся
    // пользователю. Вторая: `begin()` соединяет политику конъюнкцией с
    // `current == Mode::Unbound` ПОД ТЕМ ЖЕ барьером, под которым читает
    // состояние, поэтому намерение не может создать ничего, когда локальные
    // данные есть, а вызывающему не нужно читать состояние самому — значит и
    // гонки «прочитал до, предъявил после» не возникает.
    //
    // Почему политику НЕ выводят из состояния внутри `begin()`: `create`
    // уходит на сервер, и контракт «намерение явное» закреплён тестом
    // `native635_runtime_creation_intent_is_explicit_and_server_response_remains_required`.
    pub(crate) fn for_interactive_login() -> Self { Self::FreshNativeContext }
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum AttemptKind { Login, Refresh }
struct Attempt { id: u64, epoch: u64, context: String, snapshot: Settings, kind: AttemptKind, create: bool }

pub(crate) trait AccountTransport {
    fn login(&self, email: &str, password: &str) -> Result<LoginResponse, &'static str>;
    fn bootstrap(&self, credential: &str, account: &str, company: Option<&str>, create: bool)
        -> Result<BootstrapResponse, &'static str>;
    fn logout(&self, credential: &str) -> Result<(), &'static str>;
}
// This forwarding adapter is not constructed or invoked by the foundation's tests.
impl AccountTransport for native_account::AccountClient {
    fn login(&self, email: &str, password: &str) -> Result<LoginResponse, &'static str> {
        native_account::AccountClient::login(self, email, password)
    }
    fn bootstrap(&self, credential: &str, account: &str, company: Option<&str>, create: bool)
        -> Result<BootstrapResponse, &'static str> {
        native_account::AccountClient::bootstrap(self, credential, account, company, create)
    }
    fn logout(&self, credential: &str) -> Result<(), &'static str> {
        native_account::AccountClient::logout(self, credential)
    }
}

enum VerifiedIdentity {
    Interactive(LoginResponse),
    SameProcessRefresh { account_id: String, app_credential: String },
}
impl VerifiedIdentity {
    fn account_id(&self) -> &str {
        match self { Self::Interactive(login) => &login.account_id, Self::SameProcessRefresh { account_id, .. } => account_id }
    }
    fn credential(&self) -> &str {
        match self { Self::Interactive(login) => &login.token, Self::SameProcessRefresh { app_credential, .. } => app_credential }
    }
    fn validate(&self, kind: AttemptKind, current: &Settings, denied: bool, origins: &[&str]) -> Result<(), &'static str> {
        match self {
            Self::Interactive(login) if kind == AttemptKind::Login => login.validate(),
            Self::SameProcessRefresh { account_id, app_credential } if kind == AttemptKind::Refresh => {
                if denied || mode(current, origins) != Mode::NativeSession
                    || !current.native_account.as_ref().is_some_and(|r|
                        r.account_id == *account_id && r.app_credential == *app_credential)
                { return Err("login_required"); }
                Ok(())
            },
            _ => Err("invalid_response"),
        }
    }
}
// Native-only proof is rechecked after network I/O. Neither credentials nor proof are serialized.
pub(crate) struct VerifiedLogin { attempt: Attempt, identity: VerifiedIdentity, response: BootstrapResponse }
impl std::fmt::Debug for VerifiedLogin {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str("VerifiedLogin(<private>)") }
}
#[derive(Debug)]
pub(crate) struct CommitError { pub code: &'static str }
// Keep represents the existing binding, including the supported legacy default-vault "".
// The concrete DB adapter must prove its prepared handle belongs to this reference.
pub(crate) enum WorkspaceReference { Keep, Fresh { vault_path: String } }
pub(crate) struct PreparedWorkspace<D> { pub reference: WorkspaceReference, pub database: D }
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum CommitOutcome {
    // No.930. `authorized` несёт РЕШЕНИЕ политики. До этого `Ready` был unit-вариантом,
    // и одно и то же значение проецировалось в два противоположных смысла — продуктовый
    // путь читал его как «неактивно», тестовый движок как «авторизовано», — что было верно
    // только потому, что каждый вызывающий знал свою политику. Типам эта связка была невидима.
    Ready { authorized: bool },
    CommittedPublicationFailed { durability: Durability, reason: &'static str, database_closed: bool },
    CommittedBlocked { durability: Durability, reason: &'static str, database_closed: bool },
}
#[derive(Debug)]
pub(crate) struct LogoutOutcome {
    pub local_blocked: bool,
    pub persisted_signed_out: bool,
    pub durability: Option<Durability>,
    pub storage_error: Option<&'static str>,
    pub database_closed: bool,
    pub remote_acknowledged: bool,
    pub context_published: bool,
    pub publication_error: Option<&'static str>,
}


#[derive(Clone, Copy)]
enum PublicationPolicy {
    LocalOnly,
    // No.930. Авторизует публикацию ровно пока устройство держит непротухший
    // серверный кредит с полным набором COMPANY_SCOPES: `VerifiedLogin` доказывает
    // все девять условий, а свежесть перепроверяется после I/O (`authorization_no_longer_fresh`).
    ServerCredit,
    #[cfg(test)]
    FoundationModel,
}
impl PublicationPolicy {
    fn authorizes(self, unblocked: bool) -> bool {
        match self {
            Self::LocalOnly => false,
            Self::ServerCredit => unblocked,
            #[cfg(test)] Self::FoundationModel => unblocked,
        }
    }
}
struct CorePrepared<D> {
    workspace: PreparedWorkspace<D>,
    #[cfg(target_os = "linux")]
    binding: Option<crate::db::native_database::native_binding::Binding>,
}
#[cfg(target_os = "linux")]
#[path = "native_local_commit.rs"]
mod local_commit;
#[cfg(target_os = "linux")]
pub(crate) use local_commit::{NativeSettingsTarget, LocalPlan, LocalOutcome};

trait Clock: Send + Sync { fn now(&self) -> DateTime<Utc>; }
struct SystemClock;
impl Clock for SystemClock { fn now(&self) -> DateTime<Utc> { Utc::now() } }

// Native-issued, non-serializable intent; cancellation is bound to this attempt and context.
pub(crate) struct LoginAttempt(Attempt);
impl LoginAttempt { pub(crate) fn id(&self) -> u64 { self.0.id } }


#[derive(Default)]
struct CloseState { intent: Option<CloseIntent> }
struct CloseIntent {
    id: uuid::Uuid,
    parent_revision: String,
    parent_fingerprint: [u8; 32],
    successor: Option<CloseSuccessor>,
}
struct CloseSuccessor {
    intent_id: uuid::Uuid,
    parent_revision: String,
    parent_fingerprint: [u8; 32],
    revision: String,
    fingerprint: [u8; 32],
}
struct Closing<'a> { runtime: &'a Runtime, id: uuid::Uuid }
impl Drop for Closing<'_> {
    fn drop(&mut self) {
        // Do not recover poisoned authority or clear another caller's barrier.
        let Ok(mut authority) = self.runtime.authority.lock() else {
            self.runtime.denied.store(true, Ordering::SeqCst); return;
        };
        if authority.unavailable {
            self.runtime.denied.store(true, Ordering::SeqCst); return;
        }
        let Ok(mut state) = self.runtime.close_state.lock() else {
            authority.retire();
            self.runtime.denied.store(true, Ordering::SeqCst); return;
        };
        if state.intent.as_ref().is_some_and(|intent| intent.id == self.id) {
            state.intent = None;
            self.runtime.closing.store(false, Ordering::SeqCst);
        }
    }
}

pub(crate) struct Runtime {
    pub(crate) gate: RwLock<()>,
    settings: Arc<Mutex<Settings>>,
    authority: Arc<Mutex<crate::ConnectionRevision>>,
    close_state: Mutex<CloseState>,
    closing: AtomicBool,
    denied: AtomicBool,
    attempts: AtomicU64,
    epoch: AtomicU64,
    origins: Vec<String>,
    supported: bool,
    clock: Arc<dyn Clock>,
}
impl Runtime {
    pub(crate) fn new(mut settings: Settings) -> Arc<Self> {
        // Every process requires a fresh interactive login for native state, even if a
        // previous logout could not write its signed_out marker. No transport is used here.
        settings.native_authorized = false;
        if settings.native_account.is_some() { settings.native_generation = uuid::Uuid::new_v4().to_string(); }
        settings.connection_snapshot = None;
        settings.connection_revision = Default::default();
        let authority = settings.connection_revision.clone();
        Arc::new(Self { authority, close_state: Mutex::new(CloseState::default()), gate: RwLock::new(()), settings: Arc::new(Mutex::new(settings)),
            closing: AtomicBool::new(false), denied: AtomicBool::new(false), attempts: AtomicU64::new(0),
            epoch: AtomicU64::new(0), origins: vec![crate::api::PRIMARY_API.into(), crate::api::RU_API.into()],
            supported: cfg!(target_os = "linux"), clock: Arc::new(SystemClock) })
    }

    fn authority_unavailable(&self) -> bool {
        if self.close_state.is_poisoned() {
            self.denied.store(true, Ordering::SeqCst);
            if let Ok(mut authority) = self.authority.lock() { authority.retire(); }
            return true;
        }
        self.authority.lock().map_or(true, |authority| authority.unavailable)
    }
    fn claim_close(&self, expected: &str) -> Result<Closing<'_>, &'static str> {
        // This short admission never waits for gate/Settings/DB while holding
        // authority. The same mutex linearizes final commit publication.
        let mut authority = self.authority.lock().map_err(|_| {
            self.denied.store(true, Ordering::SeqCst); "settings_unavailable"
        })?;
        if authority.unavailable { return Err("settings_unavailable"); }
        if expected.is_empty() || authority.revision != expected || authority.fingerprint.is_none() {
            return Err("settings_changed");
        }
        let mut state = match self.close_state.lock() {
            Ok(state) => state,
            Err(error) => {
                drop(error); authority.retire();
                self.denied.store(true, Ordering::SeqCst); return Err("settings_unavailable");
            },
        };
        if state.intent.is_some() { return Err("login_required"); }
        let intent = CloseIntent { id: uuid::Uuid::new_v4(), parent_revision: expected.to_owned(),
            parent_fingerprint: authority.fingerprint.ok_or("settings_unavailable")?, successor: None };
        self.closing.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "login_required")?;
        let id = intent.id;
        state.intent = Some(intent);
        Ok(Closing { runtime: self, id })
    }
    fn close_accepts_current(&self, closing: &Closing<'_>, current: &Settings) -> Result<bool, &'static str> {
        let fingerprint = crate::connection_fingerprint(current);
        let mut authority = self.authority.lock().map_err(|_| "settings_unavailable")?;
        let mut state = match self.close_state.lock() {
            Ok(state) => state,
            Err(error) => {
                drop(error); authority.retire();
                self.denied.store(true, Ordering::SeqCst); return Err("settings_unavailable");
            },
        };
        let intent = state.intent.as_mut().filter(|intent| intent.id == closing.id)
            .ok_or("settings_unavailable")?;
        if authority.unavailable { return Err("settings_unavailable"); }
        if authority.fingerprint != Some(fingerprint) { return Ok(false); }
        if authority.revision == intent.parent_revision && fingerprint == intent.parent_fingerprint {
            return Ok(true);
        }
        let accepts = intent.successor.as_ref().is_some_and(|successor|
            successor.intent_id == intent.id
                && successor.parent_revision == intent.parent_revision
                && successor.parent_fingerprint == intent.parent_fingerprint
                && successor.revision == authority.revision && successor.fingerprint == fingerprint);
        if accepts { intent.successor = None; }
        Ok(accepts)
    }
    fn install_unpublished(&self, current: &mut Settings, mut proposed: Settings) {
        self.denied.store(true, Ordering::SeqCst);
        self.epoch.fetch_add(1, Ordering::SeqCst);
        proposed.native_authorized = false;
        proposed.storage_uncertain = true;
        proposed.connection_snapshot = None;
        proposed.connection_revision = self.authority.clone();
        match self.authority.lock() {
            Ok(mut authority) => {
                authority.retire();
                *current = proposed;
            },
            Err(error) => { drop(error); *current = proposed; },
        }
    }
    fn publication_failed<F: FnOnce() -> Result<(), &'static str>>(
        &self, current: &mut Settings, proposed: Settings, durability: Durability,
        close: &mut Option<F>, closed: &mut Option<bool>,
    ) -> CommitOutcome {
        // No authority/intent or prepared DB guard is held at this point.
        if closed.is_none() { *closed = Some(close.take().is_some_and(|close| close().is_ok())); }
        self.install_unpublished(current, proposed);
        CommitOutcome::CommittedPublicationFailed { durability,
            reason: "settings_publication_unavailable", database_closed: closed.unwrap_or(false) }
    }
    #[cfg(test)]
    fn publish_committed<F: FnOnce() -> Result<(), &'static str>>(
        &self, current: &mut Settings, proposed: Settings, proof: &VerifiedLogin,
        durability: Durability, blocked: Option<&'static str>, close: F,
    ) -> CommitOutcome {
        self.publish_committed_core(current,proposed,proof,durability,blocked,close,PublicationPolicy::FoundationModel)
    }
    fn publish_committed_core<F: FnOnce() -> Result<(), &'static str>>(
        &self, current: &mut Settings, mut proposed: Settings, proof: &VerifiedLogin,
        durability: Durability, mut blocked: Option<&'static str>, close: F, policy: PublicationPolicy,
    ) -> CommitOutcome {
        let mut close = Some(close);
        let mut closed = None;
        let mut cancellation_observed = false;
        let mut cancellation_owner = None;
        loop {
            proposed.native_authorized = policy.authorizes(blocked.is_none());
            let prepared = match crate::prepare_settings_install(proposed, current) {
                Ok(prepared) => prepared,
                Err(proposed) => return self.publication_failed(current, proposed, durability, &mut close, &mut closed),
            };
            let mut authority = match self.authority.lock() {
                Ok(authority) => authority,
                Err(error) => {
                    drop(error);
                    return self.publication_failed(current, prepared.proposed, durability, &mut close, &mut closed);
                },
            };
            let mut state = match self.close_state.lock() {
                Ok(state) => state,
                Err(error) => {
                    drop(error);
                    drop(authority);
                    return self.publication_failed(current, prepared.proposed, durability, &mut close, &mut closed);
                },
            };
            if authority.unavailable || authority.revision != prepared.parent_revision
                || authority.fingerprint != Some(prepared.parent_fingerprint)
                || prepared.parent_revision != proof.attempt.context
            {
                drop(state); drop(authority);
                return self.publication_failed(current, prepared.proposed, durability, &mut close, &mut closed);
            }
            let closing_now = self.closing.load(Ordering::SeqCst);
            let pending_matches = state.intent.as_ref().is_some_and(|intent|
                intent.parent_revision == prepared.parent_revision
                    && intent.parent_fingerprint == prepared.parent_fingerprint);
            let owner_now = state.intent.as_ref().map(|intent| intent.id);
            if closing_now && cancellation_owner.is_none() { cancellation_owner = owner_now; }
            if closing_now && (!pending_matches || owner_now != cancellation_owner) {
                drop(state); drop(authority);
                return self.publication_failed(current, prepared.proposed, durability, &mut close, &mut closed);
            }
            if closing_now {
                cancellation_observed = true;
                blocked.get_or_insert("login_cancelled");
            }
            if cancellation_observed && !closing_now {
                drop(state); drop(authority);
                return self.publication_failed(current, prepared.proposed, durability, &mut close, &mut closed);
            }
            if blocked.is_none() && proof.response.validate(proof.identity.account_id(),
                Some(&prepared.proposed.crewing_id), &self.origins(), self.clock.now()).is_err()
            { blocked = Some("authorization_no_longer_fresh"); }
            if (blocked.is_some() && closed.is_none())
                || prepared.proposed.native_authorized != policy.authorizes(blocked.is_none())
            {
                // Capture the exact close owner above BEFORE any resource close;
                // recheck that owner and parent after this bounded operation.
                drop(state); drop(authority);
                proposed = prepared.proposed;
                if closed.is_none() {
                    closed = Some(close.take().is_some_and(|close| close().is_ok()));
                }
                continue;
            }
            let successor = if cancellation_observed && pending_matches {
                let intent = state.intent.as_ref().expect("checked intent");
                Some(CloseSuccessor { intent_id: intent.id, parent_revision: intent.parent_revision.clone(),
                    parent_fingerprint: intent.parent_fingerprint, revision: prepared.next_revision.clone(),
                    fingerprint: prepared.next_fingerprint })
            } else { None };
            let ready = blocked.is_none();
            self.denied.store(!policy.authorizes(ready), Ordering::SeqCst);
            self.epoch.fetch_add(1, Ordering::SeqCst);
            match crate::install_prepared_settings(current, &mut authority, prepared) {
                Ok(()) => {
                    if let Some(successor) = successor {
                        // The native receipt exists only with the exact published
                        // successor and is consumed by its waiting CAS owner.
                        if let Some(intent) = state.intent.as_mut() { intent.successor = Some(successor); }
                    }
                    return if let Some(reason) = blocked {
                        CommitOutcome::CommittedBlocked { durability, reason, database_closed: closed.unwrap_or(false) }
                    } else { CommitOutcome::Ready { authorized: policy.authorizes(ready) } };
                },
                Err(prepared) => {
                    drop(state); drop(authority);
                    return self.publication_failed(current, prepared.proposed, durability, &mut close, &mut closed);
                },
            }
        }
    }

    fn publish_logout(&self, current: &mut Settings, proposed: Settings, closing: &Closing<'_>) -> bool {
        let prepared = match crate::prepare_settings_install(proposed, current) {
            Ok(prepared) => prepared,
            Err(proposed) => { self.install_unpublished(current, proposed); return false; },
        };
        let mut authority = match self.authority.lock() {
            Ok(authority) => authority,
            Err(error) => { drop(error); self.install_unpublished(current, prepared.proposed); return false; },
        };
        let state = match self.close_state.lock() {
            Ok(state) => state,
            Err(error) => { drop(error); drop(authority); self.install_unpublished(current, prepared.proposed); return false; },
        };
        if !state.intent.as_ref().is_some_and(|intent| intent.id == closing.id) {
            drop(state); drop(authority);
            self.install_unpublished(current, prepared.proposed); return false;
        }
        match crate::install_prepared_settings(current, &mut authority, prepared) {
            Ok(()) => true,
            Err(prepared) => {
                drop(state); drop(authority);
                self.install_unpublished(current, prepared.proposed); false
            },
        }
    }

    fn origins(&self) -> Vec<&str> { self.origins.iter().map(String::as_str).collect() }
    pub(crate) fn settings_arc(&self) -> Arc<Mutex<Settings>> { self.settings.clone() }
    pub(crate) fn context(&self) -> Result<String, &'static str> {
        let _gate = self.gate.read().map_err(|_| "settings_unavailable")?;
        let settings = self.settings.lock().map_err(|_| "settings_unavailable")?;
        if self.authority_unavailable() { return Err("settings_unavailable"); }
        let context = connection_context(&settings);
        if context.is_empty() { Err("settings_unavailable") } else { Ok(context) }
    }
    fn preflight(&self) -> Result<(), &'static str> {
        if !self.supported { return Err("native_unsupported"); }
        if self.authority_unavailable() { self.denied.store(true, Ordering::SeqCst); return Err("settings_unavailable"); }
        if self.closing.load(Ordering::SeqCst) { return Err("login_required"); }
        Ok(())
    }
    fn begin(&self, expected: &str, kind: AttemptKind, policy: CreationPolicy) -> Result<Attempt, &'static str> {
        self.preflight()?;
        let _gate = self.gate.read().map_err(|_| "settings_unavailable")?;
        self.preflight()?;
        let settings = self.settings.lock().map_err(|_| "settings_unavailable")?;
        if !connection_context_matches(&settings, expected) { return Err("settings_changed"); }
        let current = mode(&settings, &self.origins());
        if current == Mode::Unavailable { return Err("settings_unavailable"); }
        if current == Mode::NativeLocked && settings.native_account.is_none() { return Err("ownership_conflict"); }
        if kind == AttemptKind::Refresh
            && (current != Mode::NativeSession || self.denied.load(Ordering::SeqCst)) { return Err("login_required"); }
        // Increment inside the read barrier: logout/cancel excludes this publication.
        let id = self.attempts.fetch_add(1, Ordering::SeqCst) + 1;
        let attempt = Attempt { id, epoch: self.epoch.load(Ordering::SeqCst), context: expected.to_owned(),
            snapshot: settings.clone(), kind,
            create: kind == AttemptKind::Login && current == Mode::Unbound
                && matches!(policy, CreationPolicy::FreshNativeContext) };
        self.preflight()?;
        Ok(attempt)
    }
    fn attempt_matches(&self, a: &Attempt, s: &Settings) -> bool {
        !self.closing.load(Ordering::SeqCst)
            && self.attempts.load(Ordering::SeqCst) == a.id && self.epoch.load(Ordering::SeqCst) == a.epoch
            && connection_context_matches(s, &a.context)
    }
    fn recheck(&self, a: &Attempt) -> Result<(), &'static str> {
        let _gate = self.gate.read().map_err(|_| "settings_unavailable")?;
        let s = self.settings.lock().map_err(|_| "settings_unavailable")?;
        if !self.attempt_matches(a, &s) { return Err("settings_changed"); }
        Ok(())
    }
    pub(crate) fn cancel(&self, expected: &str, attempt_id: u64) -> Result<(), &'static str> {
        let _gate = self.gate.write().map_err(|_| "settings_unavailable")?;
        let settings = self.settings.lock().map_err(|_| "settings_unavailable")?;
        if !connection_context_matches(&settings, expected)
            || self.attempts.load(Ordering::SeqCst) != attempt_id { return Err("settings_changed"); }
        self.attempts.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    pub(crate) fn start_login(&self, expected: &str, policy: CreationPolicy) -> Result<LoginAttempt, &'static str> {
        self.begin(expected, AttemptKind::Login, policy).map(LoginAttempt)
    }
    pub(crate) fn authenticate(
        &self, transport: &impl AccountTransport, email: &str, password: &str, pending: LoginAttempt,
    ) -> Result<VerifiedLogin, &'static str> {
        let attempt = pending.0;
        self.recheck(&attempt)?;
        let identity = transport.login(email, password)?;
        identity.validate()?;
        let validated = (|| {
            self.recheck(&attempt)?;
            if attempt.snapshot.native_account.as_ref().is_some_and(|r| r.account_id != identity.account_id) {
                return Err("tenant_mismatch");
            }
            let company = (!attempt.snapshot.crewing_id.trim().is_empty()).then_some(attempt.snapshot.crewing_id.as_str());
            let response = transport.bootstrap(&identity.token, &identity.account_id, company, attempt.create)?;
            self.recheck(&attempt)?;
            response.validate(&identity.account_id, company, &self.origins(), self.clock.now())?;
            Ok(response)
        })();
        match validated {
            Ok(response) => Ok(VerifiedLogin { attempt, identity: VerifiedIdentity::Interactive(identity), response }),
            // A stale/failed attempt must not revoke a credential reused by a newer login.
            // No automatic logout or background cleanup is sent for discarded login proofs.
            Err(error) => Err(error),
        }
    }
    fn deny_refresh_if_current(&self, attempt: &Attempt) {
        if self.authority_unavailable() { self.denied.store(true, Ordering::SeqCst); return; }
        let Ok(_gate) = self.gate.write() else { self.denied.store(true, Ordering::SeqCst); return; };
        let Ok(mut current) = self.settings.lock() else { self.denied.store(true, Ordering::SeqCst); return; };
        if self.attempts.load(Ordering::SeqCst) != attempt.id
            || self.epoch.load(Ordering::SeqCst) != attempt.epoch
            || !connection_context_matches(&current, &attempt.context) { return; }
        let mut next = current.clone();
        next.native_authorized = false;
        next.native_generation = uuid::Uuid::new_v4().to_string();
        let prepared = match crate::prepare_settings_install(next, &current) {
            Ok(prepared) => prepared,
            Err(_) => { self.denied.store(true, Ordering::SeqCst); return; },
        };
        let Ok(mut authority) = self.authority.lock() else { self.denied.store(true, Ordering::SeqCst); return; };
        let Ok(state) = self.close_state.lock() else { authority.retire(); self.denied.store(true, Ordering::SeqCst); return; };
        if authority.unavailable || authority.revision != prepared.parent_revision
            || authority.fingerprint != Some(prepared.parent_fingerprint) { return; }
        self.denied.store(true, Ordering::SeqCst);
        // A waiting logout owns this parent. Deny access without rotating away
        // its context; let that owner persist SignedOut and close resources.
        if self.closing.load(Ordering::SeqCst) || state.intent.is_some() { return; }
        if crate::install_prepared_settings(&mut current, &mut authority, prepared).is_ok() {
            self.epoch.fetch_add(1, Ordering::SeqCst);
        }
    }
    pub(crate) fn refresh(
        &self, transport: &impl AccountTransport, expected: &str,
    ) -> Result<VerifiedLogin, &'static str> {
        let attempt = self.begin(expected, AttemptKind::Refresh, CreationPolicy::ExistingOrUncertain)?;
        let record = attempt.snapshot.native_account.as_ref().ok_or("login_required")?;
        self.recheck(&attempt)?;
        let received = transport.bootstrap(&record.app_credential, &record.account_id,
            Some(&attempt.snapshot.crewing_id), false).and_then(|response| {
                response.validate(&record.account_id, Some(&attempt.snapshot.crewing_id), &self.origins(), self.clock.now())?;
                Ok(response)
            });
        let on_error = |code| {
            if matches!(code, "login_required" | "invalid_credentials" | "entitlement_missing"
                | "entitlement_expired" | "entitlement_revoked" | "tenant_mismatch" | "scope_denied" | "invalid_response") {
                self.deny_refresh_if_current(&attempt);
            }
            code
        };
        let response = received.map_err(&on_error)?;
        self.recheck(&attempt)?;
        response.validate(&record.account_id, Some(&attempt.snapshot.crewing_id), &self.origins(), self.clock.now())
            .map_err(on_error)?;
        let identity = VerifiedIdentity::SameProcessRefresh {
            app_credential: record.app_credential.clone(), account_id: record.account_id.clone(),
        };
        Ok(VerifiedLogin { identity, response, attempt })
    }
    // Foundation authorization exists only in tests. No.930: the sealed `commit_local`
    // entry point now passes `ServerCredit`, NOT `LocalOnly` — the previous wording was made
    // false by this very patch, so it is corrected here rather than left to be read as checked.
    #[cfg(test)]
    pub(crate) fn commit<D>(
        &self, proof: VerifiedLogin,
        prepare: impl FnOnce(&Settings, &Settings) -> Result<PreparedWorkspace<D>, &'static str>,
        persist: impl FnOnce(&Settings) -> Result<Durability, &'static str>,
        activate: impl FnOnce(D) -> Result<(), &'static str>,
        close: impl FnOnce() -> Result<(), &'static str>,
    ) -> Result<CommitOutcome, CommitError> {
        self.commit_core(proof, PublicationPolicy::FoundationModel,
            |current,proposed| prepare(current,proposed).map(|workspace| CorePrepared {
                workspace, #[cfg(target_os = "linux")] binding:None }),
            persist, |database| activate(database).map_err(|_| "database_unavailable"), close)
    }
    fn commit_core<D>(
        &self, proof: VerifiedLogin, policy: PublicationPolicy,
        prepare: impl FnOnce(&Settings, &Settings) -> Result<CorePrepared<D>, &'static str>,
        persist: impl FnOnce(&Settings) -> Result<Durability, &'static str>,
        activate: impl FnOnce(D) -> Result<(), &'static str>,
        close: impl FnOnce() -> Result<(), &'static str>,
    ) -> Result<CommitOutcome, CommitError> {
        let fail = |code, _proof: VerifiedLogin| CommitError { code };
        if let Err(code) = self.preflight() { return Err(fail(code, proof)); }
        let _gate = match self.gate.write() { Ok(g) => g, Err(_) => return Err(fail("settings_unavailable", proof)) };
        let mut current = match self.settings.lock() { Ok(s) => s, Err(_) => return Err(fail("settings_unavailable", proof)) };
        if !self.attempt_matches(&proof.attempt, &current) { return Err(fail("settings_changed", proof)); }
        if current.load_uncertain || current.storage_uncertain { return Err(fail("settings_unavailable", proof)); }
        if current.native_account.as_ref().is_some_and(|r| r.account_id != proof.identity.account_id()) {
            return Err(fail("tenant_mismatch", proof));
        }
        let company = (!current.crewing_id.trim().is_empty()).then_some(current.crewing_id.as_str());
        if let Err(code) = proof.identity.validate(proof.attempt.kind, &current, self.denied.load(Ordering::SeqCst), &self.origins()).and_then(|_| proof.response.validate(
            proof.identity.account_id(), company, &self.origins(), self.clock.now(),
        )) { return Err(fail(code, proof)); }
        let mut proposed = current.clone();
        proposed.server_url = proof.response.connection.server_url.clone();
        proposed.bearer_token = proof.response.connection.bearer_token.clone();
        proposed.crewing_id = proof.response.connection.crewing_id.clone();
        proposed.organization_id = proof.response.connection.organization_id.clone().unwrap_or_default();
        proposed.token_scopes = proof.response.connection.scopes.clone();
        proposed.token_expires_at = Some(proof.response.connection.expires_at.clone());
        // Retain the same owner's private binding and additive metadata on refresh.
        let mut record = current.native_account.clone().unwrap_or_else(|| SessionRecord::new(
            proof.identity.account_id().to_owned(), proof.identity.credential().to_owned(),
            false, proof.response.entitlement.clone()));
        record.account_id = proof.identity.account_id().to_owned();
        record.app_credential = proof.identity.credential().to_owned();
        record.signed_out = false;
        record.entitlement = proof.response.entitlement.clone();
        proposed.native_account = Some(record);
        proposed.native_authorized = false;
        proposed.native_generation = uuid::Uuid::new_v4().to_string();
        proposed.storage_uncertain = false;
        proposed.team_role.clear();
        proposed.team_onboarding_seen = false;
        let prepared = match prepare(&current, &proposed) { Ok(d) => d, Err(code) => return Err(fail(code, proof)) };
        #[cfg(target_os = "linux")]
        {
            // No.930. Условие ключуется на ИДЕНТИЧНОСТИ варианта, и это не защита продукта:
            // состояние `binding.is_none()` в продукте НЕДОСТИЖИМО — единственная продуктовая
            // точка построения (`native_local_commit.rs`) кладёт `Some(...)` литерально, а
            // `binding: None` существует один раз, в `#[cfg(test)] commit<D>`. Фраза «LocalOnly
            // требует привязку» описывает тестовый путь, а не инвариант продукта.
            if matches!(policy,PublicationPolicy::LocalOnly) && prepared.binding.is_none() {
                return Err(fail("native_binding_missing",proof));
            }
            if let Some(binding)=prepared.binding {
                if !binding.matches_owner(proof.identity.account_id(),&proposed.crewing_id) {
                    return Err(fail("ownership_conflict",proof));
                }
                if let Some(old)=current.native_account.as_ref().and_then(SessionRecord::binding) {
                    if old.stable_uuid()!=binding.stable_uuid()
                        || !old.matches_prepared(binding.database_reference(),binding.key_reference()) {
                        return Err(fail("ownership_conflict",proof));
                    }
                }
                // Only this core attaches the validated envelope to its own proposed tuple.
                proposed.native_account=proposed.native_account.take().map(|record| record.with_binding(binding));
            }
        }
        let workspace=prepared.workspace;
        match workspace.reference {
            WorkspaceReference::Keep if current.native_account.is_some()
                || mode(&current, &self.origins()) == Mode::LegacyConnected => (),
            WorkspaceReference::Fresh { vault_path } if mode(&current, &self.origins()) == Mode::Unbound
                && !vault_path.trim().is_empty() && std::path::Path::new(&vault_path).is_absolute() => {
                proposed.vault_path = vault_path;
            },
            _ => return Err(fail("ownership_conflict", proof)),
        }
        // A slow prepare must not commit a proof which has expired in the meantime.
        if let Err(code) = proof.response.validate(proof.identity.account_id(), company, &self.origins(), self.clock.now()) {
            return Err(fail(code, proof));
        }
        if self.authority_unavailable() { return Err(fail("settings_unavailable", proof)); }
        if !self.attempt_matches(&proof.attempt, &current) { return Err(fail("settings_changed", proof)); }
        let durability = match persist(&proposed) { Ok(d) => d, Err(code) => return Err(fail(code, proof)) };
        // From here on the file has been replaced: every failure is a committed,
        // matching identity kept blocked. Never report a precommit rollback.
        let blocked = if durability == Durability::CommittedUnknown {
            drop(workspace.database);
            proposed.storage_uncertain = true;
            Some("settings_durability_unknown")
        } else if self.authority_unavailable() {
            drop(workspace.database);
            Some("settings_publication_unavailable")
        } else if self.closing.load(Ordering::SeqCst) {
            drop(workspace.database);
            Some("login_cancelled")
        } else if proof.response.validate(proof.identity.account_id(), company, &self.origins(), self.clock.now()).is_err() {
            drop(workspace.database);
            Some("authorization_no_longer_fresh")
        } else if let Err(code) = activate(workspace.database) {
            Some(code)
        } else if proof.response.validate(proof.identity.account_id(), company, &self.origins(), self.clock.now()).is_err() {
            Some("authorization_no_longer_fresh")
        } else { None };
        Ok(self.publish_committed_core(&mut current, proposed, &proof, durability, blocked, close, policy))
    }

    pub(crate) fn ticket(self: &Arc<Self>, expected: &str) -> Result<PrivateTicket, &'static str> {
        let ticket = PrivateTicket { runtime: self.clone(), context: expected.to_owned(), epoch: self.epoch.load(Ordering::SeqCst) };
        { let _lease = ticket.lease()?; }
        Ok(ticket)
    }
    pub(crate) fn logout(
        &self, transport: &impl AccountTransport, expected: &str,
        persist: impl FnOnce(&Settings) -> Result<Durability, &'static str>,
        close: impl FnOnce() -> Result<(), &'static str>,
    ) -> Result<LogoutOutcome, &'static str> {
        self.preflight()?;
        let closing = self.claim_close(expected)?;
        self.finish_logout(transport, closing, persist, close)
    }
    fn finish_logout(
        &self, transport: &impl AccountTransport, closing: Closing<'_>,
        persist: impl FnOnce(&Settings) -> Result<Durability, &'static str>,
        close: impl FnOnce() -> Result<(), &'static str>,
    ) -> Result<LogoutOutcome, &'static str> {
        if !std::ptr::eq(closing.runtime, self) { return Err("settings_changed"); }
        let gate = self.gate.write().map_err(|_| { self.denied.store(true, Ordering::SeqCst); "settings_unavailable" })?;
        let mut current = self.settings.lock().map_err(|_| { self.denied.store(true, Ordering::SeqCst); "settings_unavailable" })?;
        if !self.close_accepts_current(&closing, &current).map_err(|code| {
            self.denied.store(true, Ordering::SeqCst); code
        })? { return Err("settings_changed"); }
        // A no-account logout still cancels a pending first native login. It does
        // not modify the legacy connection, close its DB, or claim a signed-out file.
        self.attempts.fetch_add(1, Ordering::SeqCst);
        let credential = current.native_account.as_ref().ok_or("login_required")?.app_credential.clone();
        let proper_credential = stored_shape(&current, &self.origins());
        self.epoch.fetch_add(1, Ordering::SeqCst);
        self.denied.store(true, Ordering::SeqCst);
        let mut proposed = current.clone();
        proposed.native_account.as_mut().ok_or("login_required")?.signed_out = true;
        proposed.native_authorized = false;
        proposed.native_generation = uuid::Uuid::new_v4().to_string();
        proposed.storage_uncertain = false;
        let stored = if current.load_uncertain || !proper_credential { Err("settings_unavailable") } else { persist(&proposed) };
        proposed.storage_uncertain = !matches!(stored, Ok(Durability::Confirmed));
        let database_closed = close().is_ok();
        let context_published = self.publish_logout(&mut current, proposed, &closing);
        drop(current); drop(gate);
        // Keep this caller's CAS-owned barrier through the bounded remote request:
        // a server may reuse this credential during a subsequent interactive login.
        let remote_acknowledged = context_published && proper_credential && transport.logout(&credential).is_ok();
        drop(closing);
        Ok(LogoutOutcome { local_blocked: true, persisted_signed_out: matches!(stored, Ok(Durability::Confirmed)),
            durability: stored.as_ref().ok().copied(), storage_error: stored.err(), database_closed, remote_acknowledged, context_published,
            publication_error: (!context_published).then_some("settings_publication_unavailable") })
    }
}

#[derive(Clone)]
pub(crate) struct PrivateTicket { runtime: Arc<Runtime>, context: String, epoch: u64 }
impl PrivateTicket {
    pub(crate) fn lease(&self) -> Result<RwLockReadGuard<'_, ()>, &'static str> {
        if self.runtime.authority_unavailable() { return Err("settings_unavailable"); }
        if self.runtime.closing.load(Ordering::SeqCst) { return Err("login_required"); }
        let gate = self.runtime.gate.read().map_err(|_| "settings_unavailable")?;
        if self.runtime.closing.load(Ordering::SeqCst) || self.runtime.denied.load(Ordering::SeqCst)
            || self.runtime.epoch.load(Ordering::SeqCst) != self.epoch { return Err("login_required"); }
        if self.runtime.authority_unavailable() { return Err("settings_unavailable"); }
        let settings = self.runtime.settings.lock().map_err(|_| "settings_unavailable")?;
        if !connection_context_matches(&settings, &self.context) { return Err("settings_changed"); }
        if settings.native_account.is_some() && !self.runtime.supported { return Err("native_unsupported"); }
        private_access(&settings, &self.runtime.origins(), self.runtime.clock.now())?;
        drop(settings);
        Ok(gate)
    }
}

#[cfg(all(test, target_os = "linux"))]
mod runtime_tests {
    use super::*;
    use crate::native_account::COMPANY_SCOPES;
    use crate::private_store::{self, TestFault};
    use std::{cell::RefCell, fs, path::PathBuf};
    use std::os::unix::fs::PermissionsExt;
    use rusqlite::Connection as Sqlite;

    struct ManualClock(Mutex<DateTime<Utc>>);
    impl Clock for ManualClock { fn now(&self) -> DateTime<Utc> { *self.0.lock().unwrap() } }
    impl ManualClock { fn expire(&self) { *self.0.lock().unwrap() += chrono::Duration::minutes(11); } }
    fn now() -> DateTime<Utc> { "2026-10-19T16:00:00Z".parse().unwrap() }
    fn login() -> LoginResponse {
        LoginResponse { token: "synthetic-app-credential".into(), scope: "app_full".into(),
            role: Some("member".into()), account_id: "synthetic-account".into() }
    }
    fn response() -> BootstrapResponse {
        BootstrapResponse { account_id: "synthetic-account".into(), connection: Connection {
            server_url: crate::api::PRIMARY_API.into(), crewing_id: "synthetic-company".into(),
            organization_id: None, bearer_token: "skn_synthetic-company-credential".into(),
            scopes: COMPANY_SCOPES.iter().map(|s| (*s).into()).collect(),
            expires_at: (now() + chrono::Duration::minutes(10)).to_rfc3339(),
        }, entitlement: Entitlement { source: "approved_free".into(), expires_at: None } }
    }
    struct Fake<'a> {
        identity: LoginResponse, reply: BootstrapResponse, calls: RefCell<Vec<String>>,
        on_login: Option<Box<dyn Fn() + 'a>>, on_bootstrap: Option<Box<dyn Fn() + 'a>>,
        on_logout: Option<Box<dyn Fn() + 'a>>, remote_error: bool,
    }
    impl Default for Fake<'_> {
        fn default() -> Self { Self { identity: login(), reply: response(), calls: RefCell::new(vec![]),
            on_login: None, on_bootstrap: None, on_logout: None, remote_error: false } }
    }
    impl AccountTransport for Fake<'_> {
        fn login(&self, _email: &str, _password: &str) -> Result<LoginResponse, &'static str> {
            self.calls.borrow_mut().push("login".into());
            if let Some(callback) = &self.on_login { callback(); }
            Ok(self.identity.clone())
        }
        fn bootstrap(&self, credential: &str, account: &str, company: Option<&str>, create: bool)
            -> Result<BootstrapResponse, &'static str> {
            assert_eq!(credential, self.identity.token, "bootstrap uses the app credential, never the company bearer");
            assert_eq!(account, self.identity.account_id, "bootstrap account must come from the validated native identity");
            self.calls.borrow_mut().push(format!("bootstrap:{}:{}", company.unwrap_or("none"), create));
            if let Some(callback) = &self.on_bootstrap { callback(); }
            Ok(self.reply.clone())
        }
        fn logout(&self, credential: &str) -> Result<(), &'static str> {
            assert_eq!(credential, self.identity.token, "logout uses the saved app credential, never the company bearer");
            self.calls.borrow_mut().push("logout".into());
            if let Some(callback) = &self.on_logout { callback(); }
            if self.remote_error { Err("upstream_unavailable") } else { Ok(()) }
        }
    }

    // Owned tiny SQLite proves lifecycle ordering and handle retention only. This is
    // not the production DB schema, global DB slot, profile, or backend ownership proof.
    struct Fixture { root: PathBuf, path: PathBuf, vault: String, db: Mutex<Option<Sqlite>> }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("crewing635-runtime-core-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&root).unwrap(); fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
            let vault = root.join("vault"); fs::create_dir(&vault).unwrap();
            let db = Sqlite::open(vault.join("synthetic.sqlite")).unwrap();
            db.execute_batch("CREATE TABLE sentinel(marker TEXT NOT NULL); INSERT INTO sentinel VALUES('synthetic-preserved');").unwrap();
            Self { path: root.join("synthetic-settings.json"), vault: vault.to_str().unwrap().into(), root, db: Mutex::new(Some(db)) }
        }
        fn settings(&self, legacy: bool) -> Settings {
            let mut s = Settings::default();
            if legacy {
                s.server_url = crate::api::PRIMARY_API.into(); s.crewing_id = "synthetic-company".into();
                s.bearer_token = "synthetic-legacy-credential".into(); s.vault_path = self.vault.clone();
                s.recent_vaults = vec![self.vault.clone()]; s.company_name = "Synthetic preserved company".into();
                s.user_display_name = "Synthetic user".into(); s.team_role = "member".into();
                s.team_onboarding_seen = true; s.interface.theme = "dark".into();
                s.profile.legal_name = "Synthetic preserved profile".into();
            }
            s
        }
        fn runtime(&self, s: Settings) -> (Arc<Runtime>, Arc<ManualClock>) {
            self.persist(&s, None).unwrap();
            let mut rt = Runtime::new(s); let clock = Arc::new(ManualClock(Mutex::new(now())));
            Arc::get_mut(&mut rt).unwrap().clock = clock.clone(); (rt, clock)
        }
        fn persist(&self, s: &Settings, fault: Option<TestFault>) -> Result<Durability, &'static str> {
            let bytes = serde_json::to_vec(s).unwrap();
            let result = if let Some(fault) = fault { private_store::atomic_write_with_fault(&self.path, &bytes, fault) }
                else { private_store::atomic_write(&self.path, &bytes) };
            result.map_err(|_| "settings_storage_error")
        }
        fn bytes(&self) -> Vec<u8> { fs::read(&self.path).unwrap() }
        fn saved(&self) -> Settings { serde_json::from_slice(&self.bytes()).unwrap() }
        fn row(&self) -> Option<String> {
            self.db.lock().unwrap().as_ref().map(|db| db.query_row("SELECT marker FROM sentinel", [], |r| r.get(0)).unwrap())
        }
        fn close(&self) -> Result<(), &'static str> { self.db.lock().unwrap().take(); Ok(()) }
        fn apply(&self, rt: &Runtime, proof: VerifiedLogin, fault: Option<TestFault>, phase: Option<&dyn Fn(&str)>, activation_fails: bool)
            -> Result<CommitOutcome, CommitError> {
            self.apply_with_persist(rt, proof, |s| {
                let stored = self.persist(s, fault)?;
                if let Some(hook) = phase { hook("persist"); } Ok(stored)
            }, phase, activation_fails)
        }
        fn apply_with_persist(&self, rt: &Runtime, proof: VerifiedLogin,
            persist: impl FnOnce(&Settings) -> Result<Durability, &'static str>,
            phase: Option<&dyn Fn(&str)>, activation_fails: bool) -> Result<CommitOutcome, CommitError> {
            rt.commit(proof, |current, _| {
                if let Some(hook) = phase { hook("prepare"); }
                let database = self.db.lock().unwrap();
                if database.is_none() { return Err("database_unavailable"); }
                let reference = if mode(current, &rt.origins()) == Mode::Unbound {
                    WorkspaceReference::Fresh { vault_path: self.vault.clone() }
                } else { WorkspaceReference::Keep };
                Ok(PreparedWorkspace { reference, database })
            }, persist, |database| {
                drop(database); if let Some(hook) = phase { hook("activate"); }
                if activation_fails { Err("synthetic_activation_failure") } else { Ok(()) }
            }, || self.close())
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) { self.db.get_mut().unwrap().take(); fs::remove_dir_all(&self.root).unwrap(); }
    }
    fn proof(rt: &Runtime, fake: &Fake<'_>) -> VerifiedLogin {
        let pending = rt.start_login(&rt.context().unwrap(), CreationPolicy::ExistingOrUncertain).unwrap();
        rt.authenticate(fake, "synthetic@example.invalid", "synthetic-password", pending).unwrap()
    }
    fn connected(f: &Fixture) -> (Arc<Runtime>, Arc<ManualClock>) {
        let (rt, clock) = f.runtime(f.settings(true));
        assert_eq!(f.apply(&rt, proof(&rt, &Fake::default()), None, None, false).unwrap(), CommitOutcome::Ready { authorized: true });
        (rt, clock)
    }



    // Real joined logout callers exercise lifecycle ordering with the owned tiny
    // SQLite fixture above. These tests make no canonical DB or backend claim.
    fn closing_race_at(phase: &str, stale: bool) {
        use std::{cell::Cell, sync::mpsc, thread, time::{Duration, Instant}};
        let f = Fixture::new();
        let (rt, _) = connected(&f);
        let obsolete = rt.context().unwrap();
        if stale {
            let refresh = rt.refresh(&Fake::default(), &obsolete).unwrap();
            assert_eq!(f.apply(&rt, refresh, None, None, false).unwrap(), CommitOutcome::Ready { authorized: true });
        }
        let parent = rt.context().unwrap();
        let expected = if stale { obsolete } else { parent.clone() };
        let old_ticket = rt.ticket(&parent).unwrap();
        let old_bytes = f.bytes();
        let next_reply = Fake { reply: BootstrapResponse {
            connection: Connection { bearer_token: "skn_synthetic-next-company-credential".into(), ..response().connection },
            ..response()
        }, ..Fake::default() };
        let verified = proof(&rt, &next_reply);
        let reached = Cell::new(false);
        let observed_closing = Cell::new(false);
        let admission_completed = Cell::new(false);
        let persisted = Cell::new(0usize);
        let activated = Cell::new(0usize);
        let actor_done = AtomicBool::new(false);
        let (commit, logout, before_logout_write, remote_calls) = thread::scope(|scope| {
            let (start_tx, start_rx) = mpsc::sync_channel::<()>(1);
            let actor_rt = &rt;
            let actor_f = &f;
            let done = &actor_done;
            let actor = scope.spawn(move || {
                if start_rx.recv_timeout(Duration::from_secs(3)).is_err() {
                    done.store(true, Ordering::SeqCst);
                    return (Err("test_stage_not_reached"), None, Vec::new());
                }
                // Fake contains RefCell; construct it inside this Rust thread.
                let remote = Fake::default();
                let before = RefCell::new(None);
                let logout = actor_rt.logout(&remote, &expected, |settings| {
                    *before.borrow_mut() = Some(actor_f.bytes());
                    settings.persist_native_to_path(&actor_f.path)
                }, || actor_f.close());
                done.store(true, Ordering::SeqCst);
                let calls = remote.calls.into_inner();
                (logout, before.into_inner(), calls)
            });
            let hook = |current_phase: &str| {
                if current_phase == "activate" { activated.set(activated.get() + 1); }
                if current_phase != phase { return; }
                reached.set(true);
                start_tx.send(()).unwrap();
                let deadline = Instant::now() + Duration::from_secs(2);
                loop {
                    let closing = rt.closing.load(Ordering::SeqCst);
                    let completed = actor_done.load(Ordering::SeqCst);
                    if closing || completed {
                        observed_closing.set(closing);
                        admission_completed.set(completed);
                        break;
                    }
                    if Instant::now() >= deadline { break; }
                    thread::sleep(Duration::from_millis(1));
                }
            };
            let commit = f.apply_with_persist(&rt, verified, |settings| {
                persisted.set(persisted.get() + 1);
                let durability = settings.persist_native_to_path(&f.path)?;
                hook("persist");
                Ok(durability)
            }, Some(&hook), false);
            // The commit gate and prepared DB guard have been released before join.
            let (logout, before, calls) = actor.join().unwrap();
            (commit, logout, before, calls)
        });
        assert!(reached.get(), "requested phase must actually execute");
        assert!(observed_closing.get() || admission_completed.get(), "bounded logout admission must complete");
        if stale {
            assert!(!observed_closing.get(), "stale logout must be rejected before publishing a closing barrier");
            assert_eq!(logout.unwrap_err(), "settings_changed");
            assert!(before_logout_write.is_none());
            assert!(remote_calls.is_empty());
            assert_eq!(commit.unwrap(), CommitOutcome::Ready { authorized: true });
            assert_eq!(persisted.get(), 1);
            assert_eq!(activated.get(), 1);
            assert!(rt.ticket(&rt.context().unwrap()).is_ok());
            assert!(f.row().is_some());
            return;
        }
        assert!(observed_closing.get(), "real current-context logout must own the barrier");
        if phase == "prepare" {
            assert_eq!(commit.unwrap_err().code, "settings_changed",
                "logout published during prepare must cancel before persistence");
            assert_eq!(persisted.get(), 0);
            assert_eq!(activated.get(), 0);
            assert_eq!(before_logout_write.as_deref(), Some(old_bytes.as_slice()));
        } else {
            assert!(matches!(commit, Ok(CommitOutcome::CommittedBlocked {
                durability: Durability::Confirmed, reason: "login_cancelled", database_closed: true
            })), "logout after rename must return matching committed-blocked, never Ready: {commit:?}");
            assert_eq!(persisted.get(), 1);
            assert_eq!(activated.get(), usize::from(phase == "activate"));
            assert_ne!(before_logout_write.as_deref(), Some(old_bytes.as_slice()));
            let before: Settings = serde_json::from_slice(before_logout_write.as_ref().unwrap()).unwrap();
            assert_eq!(before.crewing_id, "synthetic-company");
            assert_eq!(before.bearer_token, "skn_synthetic-next-company-credential");
            let record = before.native_account.unwrap();
            assert_eq!(record.account_id, "synthetic-account");
            assert_eq!(record.app_credential, "synthetic-app-credential");
            assert!(!record.signed_out);
        }
        let logout = logout.expect("the waiting owner must accept the exact committed successor");
        assert!(logout.local_blocked && logout.persisted_signed_out
            && logout.database_closed && logout.remote_acknowledged);
        assert_eq!(logout.durability, Some(Durability::Confirmed));
        assert!(logout.storage_error.is_none());
        assert_eq!(remote_calls, ["logout"]);
        let saved = f.saved();
        assert_eq!(saved.bearer_token, if phase == "prepare" {
            "skn_synthetic-company-credential"
        } else { "skn_synthetic-next-company-credential" });
        assert_eq!(saved.profile.legal_name, "Synthetic preserved profile");
        let saved_record = saved.native_account.unwrap();
        assert!(saved_record.signed_out);
        assert_eq!(saved_record.account_id, "synthetic-account");
        assert_eq!(saved_record.app_credential, "synthetic-app-credential");
        assert_eq!(mode(&rt.settings.lock().unwrap(), &rt.origins()), Mode::SignedOut);
        assert!(f.row().is_none());
        assert!(old_ticket.lease().is_err());
        assert!(!rt.closing.load(Ordering::SeqCst));
    }

    // No.828: название организации — СВОБОДНЫЙ ТЕКСТ профиля ((1493)), а не признак
    // локальной идентичности. Пока оно входило в local_identity_present, девственная
    // установка, где человек успел вписать название, уходила в Mode::Unavailable —
    // то есть вход аккаунтом становился невозможен из-за отображаемой строки.
    #[test]
    fn native635_828_company_name_alone_is_not_local_identity() {
        let origins = [crate::api::PRIMARY_API, crate::api::RU_API];
        // ПОЛОЖИТЕЛЬНЫЙ КОНТРОЛЬ: пустые настройки действительно Unbound, иначе
        // проверка ниже ничего не различает.
        let empty = Settings::default();
        assert_eq!(mode(&empty, &origins), Mode::Unbound,
            "control: default settings must be Unbound, else this test cannot tell the cases apart");

        let mut named = Settings::default();
        named.company_name = "Marlow Crewing Ltd".into();
        assert_eq!(mode(&named, &origins), Mode::Unbound,
            "No.828: a display-only company name must not make the install look bound");

        // И ОБРАТНЫЙ ОБЪЕКТ: признаки, которые действительно означают локальную
        // идентичность, продолжают работать — снятие company_name не снимает
        // детектор целиком.
        let mut vault = Settings::default();
        vault.vault_path = "/tmp/synthetic-vault".into();
        assert_eq!(mode(&vault, &origins), Mode::Unavailable,
            "a real local artefact still marks the install as bound");
        let mut display = Settings::default();
        display.user_display_name = "Synthetic Operator".into();
        assert_eq!(mode(&display, &origins), Mode::Unavailable,
            "the operator display name is still a local identity trace");
    }

    #[test]
    fn native635_closing_race_before_persist_preserves_old_file_until_logout() {
        closing_race_at("prepare", false);
    }
    #[test]
    fn native635_closing_race_after_rename_retains_matching_blocked_successor() {
        closing_race_at("persist", false);
    }
    #[test]
    fn native635_closing_race_during_activation_blocks_final_publication() {
        closing_race_at("activate", false);
    }
    #[test]
    fn native635_closing_race_stale_logout_never_publishes_barrier() {
        closing_race_at("prepare", true);
    }


    fn poison_authority_only(authority: &Arc<Mutex<crate::ConnectionRevision>>) {
        let induced = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = authority.lock().unwrap();
            panic!("synthetic caught authority-only poison");
        }));
        assert!(induced.is_err());
        assert!(authority.is_poisoned());
    }

    #[test]
    fn native635_closing_authority_poison_invalidates_old_snapshot_without_panic() {
        let f = Fixture::new(); let (rt, _) = connected(&f);
        let parent = rt.context().unwrap();
        let ticket = rt.ticket(&parent).unwrap();
        let snapshot = rt.settings.lock().unwrap().clone();
        let authority = snapshot.connection_revision.clone();
        poison_authority_only(&authority);
        assert_eq!(connection_context(&snapshot), "",
            "poison must be checked before snapshot fast path");
        assert!(!connection_context_matches(&snapshot, &parent));
        assert!(!connection_context_matches(&snapshot, ""));
        let context = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| rt.context()));
        assert_eq!(context.expect("native context must not panic"), Err("settings_unavailable"));
        let lease = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| ticket.lease().is_err()));
        assert!(lease.expect("ticket must not panic"));
        let fake = Fake::default();
        assert_eq!(rt.start_login(&parent, CreationPolicy::ExistingOrUncertain).err(), Some("settings_unavailable"));
        assert!(fake.calls.borrow().is_empty());
    }

    #[test]
    fn native635_closing_authority_poison_before_persist_preserves_file() {
        use std::cell::Cell;
        let f = Fixture::new(); let (rt, _) = connected(&f);
        let verified = proof(&rt, &Fake::default());
        let authority = rt.settings.lock().unwrap().connection_revision.clone();
        let old_bytes = f.bytes();
        let writes = Cell::new(0);
        let phase = |name: &str| { if name == "prepare" { poison_authority_only(&authority); } };
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            f.apply_with_persist(&rt, verified, |settings| {
                writes.set(writes.get() + 1);
                settings.persist_native_to_path(&f.path)
            }, Some(&phase), false)
        }));
        assert_eq!(writes.get(), 0, "authority failure before persistence must stop the writer");
        assert_eq!(f.bytes(), old_bytes);
        let result = result.expect("authority-only failure must not unwind through Runtime gate/Settings");
        assert!(result.is_err());
        assert!(f.row().is_some());
    }

    #[test]
    fn native635_closing_authority_poison_after_rename_keeps_matching_blocked_memory() {
        let f = Fixture::new(); let (rt, _) = connected(&f);
        let parent = rt.context().unwrap(); let old_ticket = rt.ticket(&parent).unwrap();
        let authority = rt.settings.lock().unwrap().connection_revision.clone();
        let old_bytes = f.bytes();
        let fake = Fake { reply: BootstrapResponse {
            connection: Connection { bearer_token: "skn_synthetic-poison-next-credential".into(), ..response().connection },
            ..response()
        }, ..Fake::default() };
        let verified = proof(&rt, &fake);
        let phase = |name: &str| { if name == "persist" { poison_authority_only(&authority); } };
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            f.apply_with_persist(&rt, verified, |settings| {
                let durability = settings.persist_native_to_path(&f.path)?;
                phase("persist");
                Ok(durability)
            }, None, false)
        }));
        let result = result.expect("postrename authority-only poison must return a committed publication failure");
        let outcome = result.expect("a committed file must never be reported as a precommit error");
        assert!(!matches!(outcome, CommitOutcome::Ready { .. }));
        assert_ne!(f.bytes(), old_bytes);
        assert_eq!(f.saved().bearer_token, "skn_synthetic-poison-next-credential");
        let current = rt.settings.lock().expect("only authority was poisoned");
        assert!(Arc::ptr_eq(&authority, &current.connection_revision), "do not replace poisoned authority");
        assert_eq!(current.bearer_token, "skn_synthetic-poison-next-credential");
        assert!(current.storage_uncertain);
        assert!(!current.native_authorized);
        assert!(current.connection_snapshot.is_none());
        let public = crate::settings_for_ui(&current);
        assert_eq!(public.connection_context, "");
        assert!(!public.has_bearer_token);
        assert!(public.crewing_id.is_empty() && public.vault_path.is_empty());
        assert_eq!(public.interface.theme, "dark");
        drop(current);
        assert!(rt.denied.load(Ordering::SeqCst));
        assert_eq!(rt.context(), Err("settings_unavailable"));
        assert!(old_ticket.lease().is_err());
        assert!(f.row().is_none());
    }

    #[test]
    fn native635_closing_authority_generic_writer_rejects_already_poisoned_before_callback() {
        use std::cell::Cell;
        let f = Fixture::new();
        let mut current = f.settings(true);
        let _context = connection_context(&current);
        let proposed = current.clone();
        poison_authority_only(&current.connection_revision);
        let writes = Cell::new(0);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            crate::persist_and_install_settings(&mut current, proposed, |_| {
                writes.set(writes.get() + 1); Ok(())
            })
        }));
        assert_eq!(writes.get(), 0, "known poisoned authority must stop generic writer admission");
        assert!(result.expect("known authority poison must not panic").is_err());
    }


    // New private protocol controls complement the unchanged eight failing-first
    // Runtime regressions. These helpers grant no product/private-consumer readiness.
    #[test]
    fn native635_closing_protocol_publication_wins_before_old_logout_admission() {
        use std::{sync::mpsc, thread, time::Duration};
        let f = Fixture::new(); let (rt, _) = connected(&f);
        let parent = rt.context().unwrap();
        let authority_owner = rt.settings.lock().unwrap().connection_revision.clone();
        let (installed, observed_closing, actor_result, writes, closes) = thread::scope(|scope| {
            let gate = rt.gate.write().unwrap();
            let mut current = rt.settings.lock().unwrap();
            let mut next = current.clone();
            next.native_generation = uuid::Uuid::new_v4().to_string();
            let prepared = crate::prepare_settings_install(next, &current).ok().unwrap();
            let mut authority = authority_owner.lock().unwrap();
            let (start_tx, start_rx) = mpsc::sync_channel::<()>(1);
            let (entered_tx, entered_rx) = mpsc::sync_channel::<()>(1);
            let actor_rt = &rt; let actor_f = &f;
            let actor = scope.spawn(move || {
                let remote = Fake::default();
                let writes = std::cell::Cell::new(0);
                let closes = std::cell::Cell::new(0);
                start_rx.recv_timeout(Duration::from_secs(2)).unwrap();
                entered_tx.send(()).unwrap();
                let result = actor_rt.logout(&remote, &parent, |settings| {
                    writes.set(writes.get() + 1); settings.persist_native_to_path(&actor_f.path)
                }, || { closes.set(closes.get() + 1); actor_f.close() });
                (result, writes.get(), closes.get())
            });
            start_tx.send(()).unwrap();
            entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
            let observed_closing = rt.closing.load(Ordering::SeqCst);
            // Same native publication primitive used by Runtime; authority remains
            // held through the actual Settings replacement and actor admission.
            let installed = crate::install_prepared_settings(&mut current, &mut authority, prepared).is_ok();
            drop(authority); drop(current); drop(gate);
            let (result, writes, closes) = actor.join().unwrap();
            (installed, observed_closing, result, writes, closes)
        });
        assert!(installed);
        assert!(!observed_closing);
        assert_eq!(actor_result.unwrap_err(), "settings_changed");
        assert_eq!((writes, closes), (0, 0));
        assert!(!rt.closing.load(Ordering::SeqCst));
    }

    fn closing_successor_case(case: usize) {
        let f = Fixture::new(); let (rt, _) = connected(&f);
        let parent = rt.context().unwrap();
        let verified = proof(&rt, &Fake::default());
        let closing = rt.claim_close(&parent).unwrap();
        let outcome = {
            let _gate = rt.gate.write().unwrap();
            let mut current = rt.settings.lock().unwrap();
            let mut next = current.clone();
            next.native_generation = uuid::Uuid::new_v4().to_string();
            next.persist_native_to_path(&f.path).unwrap();
            rt.publish_committed(&mut current, next, &verified, Durability::Confirmed, None, || f.close())
        };
        assert_eq!(outcome, CommitOutcome::CommittedBlocked { durability: Durability::Confirmed,
            reason: "login_cancelled", database_closed: true });
        if case == 1 {
            let foreign = Closing { runtime: &rt, id: uuid::Uuid::new_v4() };
            let current = rt.settings.lock().unwrap();
            assert_eq!(rt.close_accepts_current(&foreign, &current), Err("settings_unavailable"));
            drop(current); drop(foreign);
            assert!(rt.closing.load(Ordering::SeqCst));
        } else if (2..=6).contains(&case) {
            let _authority = rt.authority.lock().unwrap();
            let mut state = rt.close_state.lock().unwrap();
            let receipt = state.intent.as_mut().unwrap().successor.as_mut().unwrap();
            match case {
                2 => receipt.intent_id = uuid::Uuid::new_v4(),
                3 => receipt.parent_revision.push_str("-foreign"),
                4 => receipt.parent_fingerprint[0] ^= 1,
                5 => receipt.revision.push_str("-foreign"),
                6 => receipt.fingerprint[0] ^= 1,
                _ => unreachable!(),
            }
        } else if case == 7 {
            let _gate = rt.gate.write().unwrap();
            let mut current = rt.settings.lock().unwrap();
            let mut next = current.clone();
            next.native_generation = uuid::Uuid::new_v4().to_string();
            crate::install_settings(&mut current, next);
        }
        let current = rt.settings.lock().unwrap();
        if case == 0 || case == 1 {
            assert_eq!(rt.close_accepts_current(&closing, &current), Ok(true));
            assert_eq!(rt.close_accepts_current(&closing, &current), Ok(false), "receipt is one-shot");
        } else {
            assert_eq!(rt.close_accepts_current(&closing, &current), Ok(false), "foreign/stale successor refused");
        }
        drop(current); drop(closing);
        assert!(!rt.closing.load(Ordering::SeqCst));
    }
    #[test]
    fn native635_closing_protocol_receipt_rejects_foreign_stale_and_replay() {
        for case in 0..8 { closing_successor_case(case); }
    }

    #[test]
    fn native635_closing_protocol_old_raii_never_clears_new_owner() {
        let f = Fixture::new(); let (rt, _) = connected(&f);
        let closing = rt.claim_close(&rt.context().unwrap()).unwrap();
        let successor_id = uuid::Uuid::new_v4();
        {
            let _authority = rt.authority.lock().unwrap();
            rt.close_state.lock().unwrap().intent.as_mut().unwrap().id = successor_id;
        }
        drop(closing);
        assert!(rt.closing.load(Ordering::SeqCst));
        assert_eq!(rt.close_state.lock().unwrap().intent.as_ref().unwrap().id, successor_id);
        drop(Closing { runtime: &rt, id: successor_id });
        assert!(!rt.closing.load(Ordering::SeqCst));
    }

    #[test]
    fn native635_closing_protocol_raii_authority_poison_has_no_second_panic() {
        let f = Fixture::new(); let (rt, _) = connected(&f);
        let closing = rt.claim_close(&rt.context().unwrap()).unwrap();
        poison_authority_only(&rt.authority);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| drop(closing)));
        assert!(result.is_ok());
        assert!(rt.closing.load(Ordering::SeqCst));
        assert!(rt.denied.load(Ordering::SeqCst));
        assert_eq!(rt.context(), Err("settings_unavailable"));
    }

    #[test]
    fn native635_closing_protocol_refresh_denial_preserves_waiting_logout_parent() {
        let f = Fixture::new(); let (rt, _) = connected(&f);
        let parent = rt.context().unwrap();
        let pending = rt.begin(&parent, AttemptKind::Refresh, CreationPolicy::ExistingOrUncertain).unwrap();
        let epoch = rt.epoch.load(Ordering::SeqCst);
        let closing = rt.claim_close(&parent).unwrap();
        rt.deny_refresh_if_current(&pending);
        assert!(rt.denied.load(Ordering::SeqCst));
        assert_eq!(rt.context().unwrap(), parent);
        assert_eq!(rt.epoch.load(Ordering::SeqCst), epoch);
        assert_eq!(rt.close_accepts_current(&closing, &rt.settings.lock().unwrap()), Ok(true));
        let remote = Fake::default();
        let result = rt.finish_logout(&remote, closing,
            |settings| settings.persist_native_to_path(&f.path), || f.close()).unwrap();
        assert!(result.local_blocked && result.persisted_signed_out && result.database_closed && result.context_published);
        assert!(f.saved().native_account.unwrap().signed_out);
        assert_eq!(mode(&rt.settings.lock().unwrap(), &rt.origins()), Mode::SignedOut);
        assert!(!rt.closing.load(Ordering::SeqCst));
    }

    #[test]
    fn native635_closing_protocol_intent_poison_retires_old_root_snapshot_and_returns_typed_failure() {
        let f = Fixture::new(); let (rt, _) = connected(&f);
        let parent = rt.context().unwrap();
        let snapshot = rt.settings.lock().unwrap().clone();
        let authority = snapshot.connection_revision.clone();
        assert!(crate::activation_token(&snapshot, &snapshot.server_url, None, Some(&parent)).is_ok());
        assert!(crate::messaging::pubkey_context(&snapshot, &parent).is_ok());
        let fake = Fake { reply: BootstrapResponse {
            connection: Connection { bearer_token: "skn_synthetic-intent-poison-next".into(), ..response().connection },
            ..response()
        }, ..Fake::default() };
        let verified = proof(&rt, &fake);
        let outcome = f.apply_with_persist(&rt, verified, |settings| {
            let durability = settings.persist_native_to_path(&f.path)?;
            let stimulus = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let _guard = rt.close_state.lock().unwrap();
                panic!("synthetic caught close-intent-only poison");
            }));
            assert!(stimulus.is_err());
            Ok(durability)
        }, None, false).unwrap();
        assert_eq!(outcome, CommitOutcome::CommittedPublicationFailed { durability: Durability::Confirmed,
            reason: "settings_publication_unavailable", database_closed: true });
        assert!(!authority.is_poisoned(), "healthy shared authority must be retired explicitly");
        assert_eq!(connection_context(&snapshot), "");
        assert!(!connection_context_matches(&snapshot, &parent));
        assert_eq!(crate::activation_token(&snapshot, &snapshot.server_url, None, Some(&parent)), Err("settings_changed".into()));
        assert_eq!(crate::messaging::pubkey_context(&snapshot, &parent), Err("settings_changed".into()));
        assert_eq!(f.saved().bearer_token, "skn_synthetic-intent-poison-next");
        let current = rt.settings.lock().unwrap();
        assert!(Arc::ptr_eq(&authority, &current.connection_revision));
        assert_eq!(current.bearer_token, "skn_synthetic-intent-poison-next");
        assert!(current.storage_uncertain && !current.native_authorized);
        let public = crate::settings_for_ui(&current);
        assert!(public.connection_context.is_empty() && public.crewing_id.is_empty() && !public.has_bearer_token);
        drop(current);
        assert!(f.row().is_none());
        assert_eq!(rt.context(), Err("settings_unavailable"));
    }

    #[test]
    fn native635_closing_protocol_owner_changed_during_close_never_gets_receipt() {
        let f = Fixture::new(); let (rt, _) = connected(&f);
        let parent = rt.context().unwrap();
        let verified = proof(&rt, &Fake::default());
        let held_closing = RefCell::new(None);
        let replacement_id = uuid::Uuid::new_v4();
        let outcome = rt.commit(verified, |_, _| {
            Ok(PreparedWorkspace { reference: WorkspaceReference::Keep, database: f.db.lock().unwrap() })
        }, |settings| {
            let durability = settings.persist_native_to_path(&f.path)?;
            *held_closing.borrow_mut() = Some(rt.claim_close(&parent).unwrap());
            Ok(durability)
        }, |database| { drop(database); panic!("cancellation must precede activation"); }, || {
            f.close()?;
            let _authority = rt.authority.lock().unwrap();
            rt.close_state.lock().unwrap().intent.as_mut().unwrap().id = replacement_id;
            Ok(())
        }).unwrap();
        assert_eq!(outcome, CommitOutcome::CommittedPublicationFailed { durability: Durability::Confirmed,
            reason: "settings_publication_unavailable", database_closed: true });
        assert!(rt.close_state.lock().unwrap().intent.as_ref().unwrap().successor.is_none());
        drop(held_closing.into_inner());
        assert!(rt.closing.load(Ordering::SeqCst));
        assert!(rt.denied.load(Ordering::SeqCst));
        assert_eq!(rt.context(), Err("settings_unavailable"));
        // Retired shared authority intentionally prevents even RAII reopening.
        drop(Closing { runtime: &rt, id: replacement_id });
        assert!(rt.closing.load(Ordering::SeqCst));
    }

    #[test]
    fn native635_closing_protocol_intent_poison_prewrite_paths_retire_shared_snapshots() {
        use std::cell::Cell;
        for case in 0..3 {
            let f = Fixture::new(); let (rt, _) = connected(&f);
            let parent = rt.context().unwrap();
            let snapshot = rt.settings.lock().unwrap().clone();
            let authority = snapshot.connection_revision.clone();
            let pending = rt.begin(&parent, AttemptKind::Refresh, CreationPolicy::ExistingOrUncertain).unwrap();
            let closing = (case == 1).then(|| rt.claim_close(&parent).unwrap());
            let old_bytes = f.bytes();
            assert!(crate::activation_token(&snapshot, &snapshot.server_url, None, Some(&parent)).is_ok());
            assert!(crate::messaging::pubkey_context(&snapshot, &parent).is_ok());
            let stimulus = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let _guard = rt.close_state.lock().unwrap();
                panic!("synthetic caught close-intent-only prewrite poison");
            }));
            assert!(stimulus.is_err());
            match case {
                0 => assert_eq!(rt.start_login(&parent, CreationPolicy::ExistingOrUncertain).err(), Some("settings_unavailable")),
                1 => drop(closing),
                2 => rt.deny_refresh_if_current(&pending),
                _ => unreachable!(),
            }
            assert!(!authority.is_poisoned());
            assert_eq!(connection_context(&snapshot), "");
            assert!(!connection_context_matches(&snapshot, &parent));
            assert_eq!(crate::activation_token(&snapshot, &snapshot.server_url, None, Some(&parent)), Err("settings_changed".into()));
            assert_eq!(crate::messaging::pubkey_context(&snapshot, &parent), Err("settings_changed".into()));
            let mut current = rt.settings.lock().unwrap();
            assert!(Arc::ptr_eq(&authority, &current.connection_revision));
            let next = current.clone();
            let writes = Cell::new(0);
            assert!(crate::persist_and_install_settings(&mut current, next, |_| {
                writes.set(writes.get() + 1); Ok(())
            }).is_err());
            assert_eq!(writes.get(), 0, "shared tombstone forbids generic persistence");
            drop(current);
            assert_eq!(f.bytes(), old_bytes);
            assert_eq!(rt.context(), Err("settings_unavailable"));
            assert!(rt.denied.load(Ordering::SeqCst));
        }
    }

    #[test]
    fn native635_closing_protocol_publication_failure_preserves_actual_close_failure() {
        let f = Fixture::new(); let (rt, _) = connected(&f);
        let verified = proof(&rt, &Fake::default());
        let outcome = rt.commit(verified, |_, _| {
            Ok(PreparedWorkspace { reference: WorkspaceReference::Keep, database: f.db.lock().unwrap() })
        }, |settings| {
            let durability = settings.persist_native_to_path(&f.path)?;
            poison_authority_only(&rt.authority);
            Ok(durability)
        }, |database| { drop(database); panic!("authority unavailable must prevent activation"); },
        || Err("synthetic_database_close_failure")).unwrap();
        assert_eq!(outcome, CommitOutcome::CommittedPublicationFailed { durability: Durability::Confirmed,
            reason: "settings_publication_unavailable", database_closed: false });
        assert!(f.row().is_some(), "this injected closer actually left the owned handle open");
        let current = rt.settings.lock().unwrap();
        assert!(current.storage_uncertain && !current.native_authorized);
        assert!(Arc::ptr_eq(&rt.authority, &current.connection_revision));
        drop(current);
        assert!(rt.denied.load(Ordering::SeqCst));
        assert_eq!(rt.context(), Err("settings_unavailable"));
    }

    include!("native_local_joint_tests.rs");

    // These retain the actual Runtime::commit call and the Settings serializer;
    // only the explicit persistence destination is an owned fixture.
    #[cfg(target_os = "linux")]
    fn native_commit_using_settings_adapter(f: &Fixture, rt: &Runtime) -> Result<CommitOutcome, CommitError> {
        f.apply_with_persist(rt, proof(rt, &Fake::default()),
            |settings| settings.persist_native_to_path(&f.path), None, false)
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn native635_nativepersist_commit_preserves_old_settings_fd() {
        use std::io::{Read, Seek, SeekFrom};
        use std::os::unix::fs::MetadataExt;
        let f=Fixture::new(); let (rt, _)=f.runtime(f.settings(true)); let old=f.bytes();
        let mut old_fd=fs::File::open(&f.path).unwrap();
        let old_identity=(old_fd.metadata().unwrap().dev(),old_fd.metadata().unwrap().ino());
        assert_eq!(native_commit_using_settings_adapter(&f,&rt).unwrap(),CommitOutcome::Ready { authorized: true });
        old_fd.seek(SeekFrom::Start(0)).unwrap();let mut retained=Vec::new();old_fd.read_to_end(&mut retained).unwrap();
        assert_eq!(retained,old,"atomic Settings replacement must not rewrite retained old inode");
        let after=fs::metadata(&f.path).unwrap();
        assert_ne!((after.dev(),after.ino()),old_identity);
        assert!(f.saved().native_account.is_some());assert!(!f.saved().native_authorized);
        assert_eq!(f.row().as_deref(),Some("synthetic-preserved"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn native635_nativepersist_commit_replaces_0644_with_private_new_inode() {
        use std::os::unix::fs::MetadataExt;
        let f=Fixture::new(); let (rt, _)=f.runtime(f.settings(true));
        fs::set_permissions(&f.path,fs::Permissions::from_mode(0o644)).unwrap();
        let old_fd=fs::File::open(&f.path).unwrap();let old_metadata=old_fd.metadata().unwrap();
        assert_eq!(old_metadata.mode() & 0o7777,0o644);
        assert_eq!(native_commit_using_settings_adapter(&f,&rt).unwrap(),CommitOutcome::Ready { authorized: true });
        let new_metadata=fs::metadata(&f.path).unwrap();
        assert_eq!(new_metadata.mode() & 0o7777,0o600,"new private Settings must replace old public mode");
        assert_ne!((new_metadata.dev(),new_metadata.ino()),(old_metadata.dev(),old_metadata.ino()));
        assert_eq!(old_fd.metadata().unwrap().mode() & 0o7777,0o644,"never chmod an old Settings inode");
        assert_eq!(f.saved().crewing_id,"synthetic-company");
        assert_eq!(f.saved().profile.legal_name,"Synthetic preserved profile");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn native635_nativepersist_commit_refuses_link_targets_before_publish() {
        for kind in ["symlink","hardlink"] {
            let f=Fixture::new(); let (rt, _)=f.runtime(f.settings(true));let old=f.bytes();
            let old_context=rt.context().unwrap();let witness=f.root.join("owned-settings-witness");
            if kind=="symlink" {
                fs::rename(&f.path,&witness).unwrap();std::os::unix::fs::symlink(&witness,&f.path).unwrap();
            } else { fs::hard_link(&f.path,&witness).unwrap(); }
            let result=native_commit_using_settings_adapter(&f,&rt);
            assert!(result.is_err(),"native Settings {kind} must be refused before commit");
            assert_eq!(fs::read(&witness).unwrap(),old);assert_eq!(f.bytes(),old);
            assert_eq!(rt.context().unwrap(),old_context);assert!(rt.settings.lock().unwrap().native_account.is_none());
            assert_eq!(f.row().as_deref(),Some("synthetic-preserved"));
            if kind=="symlink" {assert!(fs::symlink_metadata(&f.path).unwrap().file_type().is_symlink());}
            else { use std::os::unix::fs::MetadataExt; assert_eq!(fs::metadata(&f.path).unwrap().nlink(),2); }
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn native635_nativepersist_legacy_writer_control_keeps_existing_mode_and_inode() {
        use std::os::unix::fs::MetadataExt;
        let f=Fixture::new();let legacy=f.settings(true);f.persist(&legacy,None).unwrap();
        fs::set_permissions(&f.path,fs::Permissions::from_mode(0o644)).unwrap();
        let old=fs::File::open(&f.path).unwrap();let metadata=old.metadata().unwrap();
        legacy.save_to_path(&f.path).unwrap();
        let after=fs::metadata(&f.path).unwrap();
        assert_eq!((after.dev(),after.ino()),(metadata.dev(),metadata.ino()));assert_eq!(after.mode() & 0o7777,0o644);
        assert!(f.saved().native_account.is_none());assert_eq!(f.saved().profile.legal_name,"Synthetic preserved profile");
    }


    #[cfg(target_os = "linux")]
    #[test]
    fn native635_nativepersist_file_sync_failure_via_adapter_is_precommit() {
        let f=Fixture::new();let (rt,_)=f.runtime(f.settings(true));let old=f.bytes();let context=rt.context().unwrap();
        let result=f.apply_with_persist(&rt,proof(&rt,&Fake::default()),
            |s| s.persist_native_with_fault(&f.path,TestFault::FileSync),None,false).unwrap_err();
        assert_eq!(result.code,"settings_storage_error");assert_eq!(f.bytes(),old);
        assert_eq!(rt.context().unwrap(),context);assert!(rt.settings.lock().unwrap().native_account.is_none());
        assert_eq!(f.row().as_deref(),Some("synthetic-preserved"));assert!(rt.ticket(&context).is_ok());
        assert_eq!(fs::read_dir(&f.root).unwrap().count(),2,"no pending Settings file");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn native635_nativepersist_directory_sync_unknown_via_adapter_is_committed_blocked() {
        let f=Fixture::new();let (rt,_)=f.runtime(f.settings(true));let old=f.bytes();
        let outcome=f.apply_with_persist(&rt,proof(&rt,&Fake::default()),
            |s| s.persist_native_with_fault(&f.path,TestFault::DirectorySync),None,false).unwrap();
        assert_eq!(outcome,CommitOutcome::CommittedBlocked {durability:Durability::CommittedUnknown,
            reason:"settings_durability_unknown",database_closed:true});
        assert_ne!(f.bytes(),old);let loaded=Settings::load_from(&f.path);let live=rt.settings.lock().unwrap();
        assert_eq!(loaded.crewing_id,live.crewing_id);assert_eq!(loaded.bearer_token,live.bearer_token);
        assert_eq!(loaded.native_account.as_ref().unwrap().account_id,live.native_account.as_ref().unwrap().account_id);
        assert!(!loaded.native_authorized);assert!(!live.native_authorized);assert!(live.storage_uncertain);drop(live);
        assert!(f.row().is_none());assert!(rt.ticket(&rt.context().unwrap()).is_err());
        assert_eq!(fs::read_dir(&f.root).unwrap().count(),2);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn native635_nativepersist_missing_final_target_control_creates_private_file_only() {
        let f=Fixture::new();let (rt,_)=f.runtime(f.settings(true));fs::remove_file(&f.path).unwrap();
        assert_eq!(native_commit_using_settings_adapter(&f,&rt).unwrap(),CommitOutcome::Ready { authorized: true });
        let loaded=Settings::load_from(&f.path);assert!(loaded.native_account.is_some());assert!(!loaded.load_uncertain);
        assert_eq!(fs::metadata(&f.path).unwrap().permissions().mode() & 0o7777,0o600);
        assert_eq!(fs::read_dir(&f.root).unwrap().count(),2);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn native635_nativepersist_invalid_parent_and_nonregular_target_are_precommit() {
        for kind in ["missing_parent","directory","dangling_symlink","symlink_parent","writable_parent"] {
            let f=Fixture::new();let (rt,_)=f.runtime(f.settings(true));let old=f.bytes();let context=rt.context().unwrap();
            let target=match kind {
                "missing_parent" => f.root.join("missing").join("settings.json"),
                "directory" => {let p=f.root.join("target-directory");fs::create_dir(&p).unwrap();p},
                "dangling_symlink" => {let p=f.root.join("dangling");std::os::unix::fs::symlink(f.root.join("absent"),&p).unwrap();p},
                "symlink_parent" => {let p=f.root.join("parent-alias");std::os::unix::fs::symlink(&f.root,&p).unwrap();p.join("settings-new.json")},
                _ => {let p=f.root.join("writable");fs::create_dir(&p).unwrap();fs::set_permissions(&p,fs::Permissions::from_mode(0o777)).unwrap();p.join("settings.json")},
            };
            let result=f.apply_with_persist(&rt,proof(&rt,&Fake::default()),
                |s| s.persist_native_to_path(&target),None,false);
            assert!(result.is_err(),"{kind}");assert_eq!(f.bytes(),old);assert_eq!(rt.context().unwrap(),context);
            assert!(rt.settings.lock().unwrap().native_account.is_none());assert_eq!(f.row().as_deref(),Some("synthetic-preserved"));
            assert!(!f.root.join("missing").exists());assert!(!f.root.join("absent").exists());
            assert!(!f.root.join("settings-new.json").exists());assert!(!f.root.join("writable/settings.json").exists());
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn native635_nativepersist_incomplete_record_cannot_create_settings_target() {
        let f=Fixture::new();let target=f.root.join("never-created-settings.json");
        let mut settings=f.settings(true);settings.native_account=Some(SessionRecord::new(
            "synthetic-account".into(), "synthetic-only".into(), false,
            Entitlement {source:"approved_free".into(),expires_at:None},
        ));
        assert_eq!(settings.persist_native_to_path(&target),Err("settings_unavailable"));assert!(!target.exists());
        // Relative destination is rejected by metadata admission before any write.
        assert!(private_store::native_settings_destination(std::path::Path::new(".")).is_err());
    }


    #[cfg(target_os = "linux")]
    #[test]
    fn native635_nativepersist_recordless_skn_orphan_cannot_create_settings_target() {
        let f=Fixture::new();let target=f.root.join("orphan-settings-never-created.json");
        let mut settings=f.settings(true);settings.bearer_token="skn_synthetic_recordless".into();
        assert!(settings.native_account.is_none());
        assert_eq!(mode(&settings,&[crate::api::PRIMARY_API,crate::api::RU_API]),Mode::NativeLocked);
        assert_eq!(settings.persist_native_to_path(&target),Err("settings_unavailable"));assert!(!target.exists());
    }

    #[test]
    fn native635_runtime_success_preserves_legacy_db_profile_vault_and_retires_team_role() {
        let f = Fixture::new(); let (rt, _) = f.runtime(f.settings(true));
        let old_context = rt.context().unwrap(); let old_ticket = rt.ticket(&old_context).unwrap();
        let fake = Fake::default(); let verified = proof(&rt, &fake);
        assert_eq!(fake.calls.borrow().as_slice(), ["login", "bootstrap:synthetic-company:false"]);
        assert_eq!(f.apply(&rt, verified, None, None, false).unwrap(), CommitOutcome::Ready { authorized: true });
        let state = rt.settings.lock().unwrap();
        assert!(state.native_authorized); assert_eq!(state.vault_path, f.vault);
        assert_eq!(state.profile.legal_name, "Synthetic preserved profile"); assert_eq!(state.interface.theme, "dark");
        assert!(state.team_role.is_empty()); assert!(!state.team_onboarding_seen);
        assert_eq!(state.user_display_name, "Synthetic user"); drop(state);
        assert_eq!(f.row().as_deref(), Some("synthetic-preserved")); assert!(old_ticket.lease().is_err());
        assert_ne!(rt.context().unwrap(), old_context); assert!(rt.ticket(&rt.context().unwrap()).is_ok());
        assert_eq!(fs::metadata(&f.path).unwrap().permissions().mode() & 0o777, 0o600);
        assert!(!f.saved().native_authorized);
    }
    #[test]
    fn native635_runtime_atomic_precommit_error_keeps_old_file_handle_and_context() {
        let f = Fixture::new(); let (rt, _) = f.runtime(f.settings(true));
        let old = f.bytes(); let context = rt.context().unwrap();
        let error = f.apply(&rt, proof(&rt, &Fake::default()), Some(TestFault::FileSync), None, false).unwrap_err();
        assert_eq!(error.code, "settings_storage_error"); assert_eq!(f.bytes(), old);
        assert_eq!(rt.context().unwrap(), context); assert_eq!(f.row().as_deref(), Some("synthetic-preserved"));
        assert!(rt.settings.lock().unwrap().native_account.is_none()); assert!(rt.ticket(&context).is_ok());
    }
    #[test]
    fn native635_runtime_actual_postrename_unknown_keeps_new_identity_blocked_and_closes_db() {
        let f = Fixture::new(); let (rt, _) = f.runtime(f.settings(true)); let old = f.bytes();
        assert_eq!(f.apply(&rt, proof(&rt, &Fake::default()), Some(TestFault::DirectorySync), None, false).unwrap(),
            CommitOutcome::CommittedBlocked { durability: Durability::CommittedUnknown,
                reason: "settings_durability_unknown", database_closed: true });
        assert_ne!(f.bytes(), old); let saved = f.saved(); let state = rt.settings.lock().unwrap();
        assert_eq!(saved.crewing_id, state.crewing_id); assert_eq!(saved.bearer_token, state.bearer_token);
        assert!(state.storage_uncertain); assert!(!state.native_authorized); drop(state);
        assert!(f.row().is_none()); assert!(rt.ticket(&rt.context().unwrap()).is_err());
    }
    #[test]
    fn native635_runtime_activation_failure_is_committed_matching_blocked() {
        let f = Fixture::new(); let (rt, _) = f.runtime(f.settings(true));
        assert_eq!(f.apply(&rt, proof(&rt, &Fake::default()), None, None, true).unwrap(),
            CommitOutcome::CommittedBlocked { durability: Durability::Confirmed, reason: "database_unavailable", database_closed: true });
        assert!(f.saved().native_account.is_some()); assert!(rt.settings.lock().unwrap().native_account.is_some());
        assert!(f.row().is_none()); assert!(rt.ticket(&rt.context().unwrap()).is_err());
    }
    #[test]
    fn native635_runtime_expiry_during_prepare_is_precommit_and_after_rename_is_committed_blocked() {
        for boundary in ["prepare", "persist", "activate"] {
            let f = Fixture::new(); let (rt, clock) = f.runtime(f.settings(true)); let old = f.bytes();
            let hook = |phase: &str| { if phase == boundary { clock.expire(); } };
            let result = f.apply(&rt, proof(&rt, &Fake::default()), None, Some(&hook), false);
            if boundary == "prepare" {
                assert_eq!(result.unwrap_err().code, "invalid_response"); assert_eq!(f.bytes(), old);
                assert_eq!(f.row().as_deref(), Some("synthetic-preserved"));
            } else {
                assert_eq!(result.unwrap(), CommitOutcome::CommittedBlocked { durability: Durability::Confirmed,
                    reason: "authorization_no_longer_fresh", database_closed: true });
                assert_ne!(f.bytes(), old); assert!(f.saved().native_account.is_some()); assert!(f.row().is_none());
                assert!(!rt.settings.lock().unwrap().native_authorized);
            }
        }
    }
    #[test]
    fn native635_runtime_default_vault_keep_and_legacy_vault_switch_rejection() {
        let f = Fixture::new(); let mut s = f.settings(true); s.vault_path.clear();
        let (rt, _) = f.runtime(s);
        assert_eq!(f.apply(&rt, proof(&rt, &Fake::default()), None, None, false).unwrap(), CommitOutcome::Ready { authorized: true });
        assert!(rt.settings.lock().unwrap().vault_path.is_empty()); assert!(f.saved().vault_path.is_empty());
        let g = Fixture::new(); let (legacy, _) = g.runtime(g.settings(true)); let old = g.bytes();
        let error = legacy.commit(proof(&legacy, &Fake::default()), |_, _| Ok(PreparedWorkspace {
            reference: WorkspaceReference::Fresh { vault_path: g.vault.clone() }, database: (),
        }), |_| panic!("no persistence on legacy reference replacement"), |_| panic!("no activation"), || panic!("no close")).unwrap_err();
        assert_eq!(error.code, "ownership_conflict"); assert_eq!(g.bytes(), old); assert!(g.row().is_some());
    }
    #[test]
    fn native635_runtime_existing_binding_never_requests_creation_and_wrong_company_has_no_writes() {
        let f = Fixture::new(); let (rt, _) = f.runtime(f.settings(true)); let old = f.bytes();
        let mut fake = Fake::default(); fake.reply.connection.crewing_id = "different-company".into();
        let pending = rt.start_login(&rt.context().unwrap(), CreationPolicy::FreshNativeContext).unwrap();
        assert_eq!(rt.authenticate(&fake, "synthetic", "synthetic", pending).unwrap_err(), "tenant_mismatch");
        assert_eq!(fake.calls.borrow().as_slice(), ["login", "bootstrap:synthetic-company:false"]);
        assert_eq!(f.bytes(), old); assert!(f.row().is_some());
    }
    #[test]
    fn native635_runtime_saved_account_mismatch_and_invalid_login_never_bootstrap_or_revoke() {
        let f = Fixture::new(); let (rt, _) = connected(&f); let old = f.bytes();
        for bad_scope in [false, true] {
            let mut fake = Fake::default();
            if bad_scope { fake.identity.scope = "profile:read".into(); } else { fake.identity.account_id = "different-account".into(); }
            let pending = rt.start_login(&rt.context().unwrap(), CreationPolicy::ExistingOrUncertain).unwrap();
            assert_eq!(rt.authenticate(&fake, "synthetic", "synthetic", pending).unwrap_err(), if bad_scope { "invalid_response" } else { "tenant_mismatch" });
            assert_eq!(fake.calls.borrow().as_slice(), ["login"]); assert_eq!(f.bytes(), old);
        }
    }
    #[test]
    fn native635_runtime_creation_intent_is_explicit_and_server_response_remains_required() {
        for explicit in [false, true] {
            let f = Fixture::new(); let (rt, _) = f.runtime(f.settings(false)); let fake = Fake::default();
            let policy = if explicit { CreationPolicy::FreshNativeContext } else { CreationPolicy::ExistingOrUncertain };
            let pending = rt.start_login(&rt.context().unwrap(), policy).unwrap();
            let verified = rt.authenticate(&fake, "synthetic", "synthetic", pending).unwrap();
            assert_eq!(fake.calls.borrow()[1], format!("bootstrap:none:{}", explicit));
            assert_eq!(f.apply(&rt, verified, None, None, false).unwrap(), CommitOutcome::Ready { authorized: true });
            assert_eq!(f.saved().vault_path, f.vault);
        }
    }
    #[test]
    fn native635_runtime_scoped_cancel_after_login_prevents_bootstrap_without_revoking_reused_credential() {
        let f = Fixture::new(); let (rt, _) = f.runtime(f.settings(true)); let context = rt.context().unwrap();
        let pending = rt.start_login(&context, CreationPolicy::ExistingOrUncertain).unwrap(); let id = pending.id();
        let fake = Fake { on_login: Some(Box::new(|| {
            assert!(rt.gate.try_write().is_ok()); rt.cancel(&context, id).unwrap();
        })), ..Fake::default() };
        assert_eq!(rt.authenticate(&fake, "synthetic", "synthetic", pending).unwrap_err(), "settings_changed");
        assert_eq!(fake.calls.borrow().as_slice(), ["login"]);
        let newer = rt.start_login(&context, CreationPolicy::ExistingOrUncertain).unwrap();
        assert_eq!(rt.cancel(&context, id), Err("settings_changed"));
        assert!(rt.authenticate(&Fake::default(), "synthetic", "synthetic", newer).is_ok());
    }
    #[test]
    fn native635_runtime_logout_without_account_cancels_pending_login_but_preserves_legacy_access() {
        let f = Fixture::new(); let (rt, _) = f.runtime(f.settings(true)); let context = rt.context().unwrap();
        let verified = proof(&rt, &Fake::default()); let fake = Fake::default(); let old = f.bytes();
        assert_eq!(rt.logout(&fake, &context, |_| panic!("no native record"), || panic!("legacy DB retained")).unwrap_err(), "login_required");
        assert_eq!(f.apply(&rt, verified, None, None, false).unwrap_err().code, "settings_changed");
        assert_eq!(f.bytes(), old); assert!(f.row().is_some()); assert!(rt.ticket(&context).is_ok()); assert!(fake.calls.borrow().is_empty());
    }
    #[test]
    fn native635_runtime_same_tuple_refresh_rotates_context_and_old_ticket_without_interactive_login() {
        let f = Fixture::new(); let (rt, clock) = connected(&f); let context = rt.context().unwrap();
        let old_snapshot = rt.settings.lock().unwrap().clone(); let ticket = rt.ticket(&context).unwrap();
        clock.expire(); assert!(ticket.lease().is_err());
        let mut fake = Fake::default(); fake.reply.connection.expires_at = (clock.now() + chrono::Duration::minutes(10)).to_rfc3339();
        let refreshed = rt.refresh(&fake, &context).unwrap();
        assert_eq!(fake.calls.borrow().as_slice(), ["bootstrap:synthetic-company:false"]);
        assert_eq!(f.apply(&rt, refreshed, None, None, false).unwrap(), CommitOutcome::Ready { authorized: true });
        assert_ne!(rt.context().unwrap(), context); assert!(!connection_context_matches(&old_snapshot, &context));
        assert!(ticket.lease().is_err()); assert!(rt.ticket(&rt.context().unwrap()).is_ok());
    }
    #[test]
    fn native635_runtime_malformed_refresh_response_blocks_only_current_attempt() {
        let f = Fixture::new(); let (rt, _) = connected(&f); let context = rt.context().unwrap();
        let fake = Fake { reply: BootstrapResponse { account_id: "wrong-account".into(), ..response() }, ..Fake::default() };
        assert_eq!(rt.refresh(&fake, &context).unwrap_err(), "tenant_mismatch");
        assert!(rt.ticket(&rt.context().unwrap()).is_err());
        let other = Fixture::new(); let (newer, _) = connected(&other); let old_context = newer.context().unwrap();
        let pending = newer.start_login(&old_context, CreationPolicy::ExistingOrUncertain).unwrap(); let id = pending.id();
        let stale = Fake { on_bootstrap: Some(Box::new(|| {
            // Cancel the in-flight refresh using its currently native-issued ID.
            let refresh_id = newer.attempts.load(Ordering::SeqCst);
            assert!(refresh_id > id); assert!(newer.gate.try_write().is_ok()); newer.cancel(&old_context, refresh_id).unwrap();
        })), reply: BootstrapResponse { account_id: "wrong-account".into(), ..response() }, ..Fake::default() };
        assert_eq!(newer.refresh(&stale, &old_context).unwrap_err(), "tenant_mismatch");
        assert!(newer.ticket(&old_context).is_ok());
    }
    #[test]
    fn native635_runtime_logout_double_failure_blocks_memory_and_restart_without_any_transport() {
        let f = Fixture::new(); let (rt, _) = connected(&f); let context = rt.context().unwrap();
        let late_proof = proof(&rt, &Fake::default()); let old_ticket = rt.ticket(&context).unwrap(); let old = f.bytes();
        let fake = Fake { remote_error: true, ..Fake::default() };
        let result = rt.logout(&fake, &context, |s| f.persist(s, Some(TestFault::FileSync)), || f.close()).unwrap();
        assert!(result.local_blocked && result.database_closed); assert!(!result.persisted_signed_out && !result.remote_acknowledged);
        assert_eq!(result.storage_error, Some("settings_storage_error")); assert!(result.durability.is_none());
        assert_eq!(f.bytes(), old); assert!(f.row().is_none()); assert!(old_ticket.lease().is_err());
        assert_eq!(f.apply(&rt, late_proof, None, None, false).unwrap_err().code, "settings_changed");
        let restart = Runtime::new(f.saved()); let no_network = Fake::default(); let restarted_context = restart.context().unwrap();
        assert_eq!(mode(&restart.settings.lock().unwrap(), &restart.origins()), Mode::NativeLocked);
        assert!(restart.ticket(&restarted_context).is_err()); assert_eq!(restart.refresh(&no_network, &restarted_context).unwrap_err(), "login_required");
        assert!(no_network.calls.borrow().is_empty()); assert_eq!(f.bytes(), old);
    }
    #[test]
    fn native635_runtime_logout_holds_owned_barrier_through_remote_and_rejects_stale_context() {
        let f = Fixture::new(); let (rt, _) = connected(&f); let old_context = rt.context().unwrap();
        let refreshed = rt.refresh(&Fake::default(), &old_context).unwrap(); f.apply(&rt, refreshed, None, None, false).unwrap();
        let context = rt.context().unwrap(); let fake = Fake::default();
        assert_eq!(rt.logout(&fake, &old_context, |_| panic!("stale no write"), || panic!("stale no close")).unwrap_err(), "settings_changed");
        assert!(fake.calls.borrow().is_empty()); assert!(rt.ticket(&context).is_ok());
        let remote = Fake { on_logout: Some(Box::new(|| {
            assert!(rt.gate.try_write().is_ok());
            assert!(rt.start_login(&rt.context().unwrap(), CreationPolicy::ExistingOrUncertain).is_err());
            assert_eq!(rt.logout(&Fake::default(), &rt.context().unwrap(), |_| panic!("second logout"), || panic!("second close")).unwrap_err(), "login_required");
            assert!(rt.closing.load(Ordering::SeqCst));
        })), ..Fake::default() };
        let result = rt.logout(&remote, &context, |s| f.persist(s, None), || f.close()).unwrap();
        assert!(result.local_blocked && result.persisted_signed_out && result.remote_acknowledged && result.database_closed);
        assert_eq!(result.durability, Some(Durability::Confirmed)); assert!(result.storage_error.is_none());
        assert!(!rt.closing.load(Ordering::SeqCst)); assert!(f.saved().native_account.unwrap().signed_out);
        assert_eq!(mode(&rt.settings.lock().unwrap(), &rt.origins()), Mode::SignedOut);
        assert!(rt.refresh(&Fake::default(), &rt.context().unwrap()).is_err());
    }
    #[test]
    fn native635_runtime_unsupported_native_rejects_before_transport_or_mutating_callbacks() {
        let f = Fixture::new(); let (mut rt, _) = f.runtime(f.settings(true)); let verified = proof(&rt, &Fake::default());
        Arc::get_mut(&mut rt).unwrap().supported = false; let old = f.bytes(); let context = rt.context().unwrap(); let fake = Fake::default();
        assert_eq!(rt.start_login(&context, CreationPolicy::ExistingOrUncertain).err().unwrap(), "native_unsupported");
        assert_eq!(rt.refresh(&fake, &context).unwrap_err(), "native_unsupported");
        assert_eq!(rt.commit(verified, |_, _| -> Result<PreparedWorkspace<()>, &'static str> { panic!("unsupported prepare") },
            |_| panic!("unsupported persist"), |_| panic!("unsupported activate"), || panic!("unsupported close")).unwrap_err().code, "native_unsupported");
        assert_eq!(rt.logout(&fake, &context, |_| panic!("unsupported logout persist"), || panic!("unsupported close")).unwrap_err(), "native_unsupported");
        assert!(fake.calls.borrow().is_empty()); assert_eq!(f.bytes(), old); assert!(f.row().is_some()); assert!(rt.ticket(&context).is_ok());
    }

    #[test]
    fn native635_runtime_refresh_expiring_between_validation_boundaries_denies_current_authorization() {
        use std::collections::VecDeque;
        struct SequenceClock(Mutex<VecDeque<DateTime<Utc>>>);
        impl Clock for SequenceClock { fn now(&self) -> DateTime<Utc> { self.0.lock().unwrap().pop_front().expect("exact clock boundary") } }
        let f = Fixture::new(); let (mut rt, _) = connected(&f); let context = rt.context().unwrap();
        Arc::get_mut(&mut rt).unwrap().clock = Arc::new(SequenceClock(Mutex::new(VecDeque::from([
            now(), now() + chrono::Duration::minutes(11),
        ]))));
        let fake = Fake::default();
        assert_eq!(rt.refresh(&fake, &context).unwrap_err(), "invalid_response");
        assert!(!rt.settings.lock().unwrap().native_authorized);
        assert!(rt.denied.load(Ordering::SeqCst)); assert_ne!(rt.context().unwrap(), context);
        // Denial occurs before private_access asks the test clock for another time.
        assert!(rt.ticket(&rt.context().unwrap()).is_err());
    }
}
