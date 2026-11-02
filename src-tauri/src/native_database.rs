// Unused native database preparation/activation foundation. No startup/command calls it.
// Callers must hold the Runtime write gate and exclusive app namespace ownership.
// The supported namespace has no concurrent app path mutation; malicious same-UID
// processes and arbitrary interleaved external writers are outside this capability.
use std::{fs::{self, OpenOptions}, io::Read, path::{Component, Path, PathBuf}, sync::{Mutex, MutexGuard}};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
#[path = "native_fresh.rs"]
pub(crate) mod native_fresh;

use rusqlite::{Connection, DatabaseName, OpenFlags, OptionalExtension, params};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Error { UnsupportedNamespace, IdentityMismatch, ReferenceMismatch, DatabaseUnavailable, MigrationRequired, UnsupportedSchema, SlotUnavailable, DatabaseCloseFailed }
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct Owner { account: String, company: String, context: String }
impl Owner {
    // Validated private binding only, never JS. context is the stable persisted
    // workspace UUID, NOT an ephemeral authorization generation or ctx_ ticket.
    pub(crate) fn from_validated_binding(account: String, company: String, context: String) -> Result<Self, Error> {
        if !crate::native_account::valid_id(&account) || !crate::native_account::valid_id(&company)
            || uuid::Uuid::parse_str(&context).is_err() { return Err(Error::ReferenceMismatch); }
        Ok(Self { account, company, context })
    }
}
impl std::fmt::Debug for Owner { fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str("DatabaseOwner(<private>)") } }
#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
struct FileIdentity { device: u64, inode: u64, uid: u32 }
fn current_uid() -> u32 {
    // geteuid has no filesystem or memory mutation and is supported on this Linux-only module.
    unsafe { libc::geteuid() }
}
fn identity(meta: &fs::Metadata) -> FileIdentity { FileIdentity { device: meta.dev(), inode: meta.ino(), uid: meta.uid() } }
fn ordinary_file(path: &Path) -> Result<FileIdentity, Error> {
    let meta = fs::symlink_metadata(path).map_err(|_| Error::DatabaseUnavailable)?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.nlink() != 1
        || meta.uid() != current_uid() || meta.mode() & 0o022 != 0 { return Err(Error::UnsupportedNamespace); }
    Ok(identity(&meta))
}

#[derive(Clone)]
pub(crate) struct Namespace { root: PathBuf, root_identity: FileIdentity }
impl Namespace {
    // Admission to this type is a local filesystem check, NOT account/company proof.
    // A trusted caller must also exclusively own all app writers in this namespace.
    pub(crate) fn inspect(root: &Path) -> Result<Self, Error> {
        if !root.is_absolute() || root.to_str().is_none() { return Err(Error::UnsupportedNamespace); }
        let mut prefix = PathBuf::new();
        for component in root.components() {
            match component {
                Component::RootDir | Component::Normal(_) => prefix.push(component.as_os_str()),
                _ => return Err(Error::UnsupportedNamespace),
            }
            let meta = fs::symlink_metadata(&prefix).map_err(|_| Error::UnsupportedNamespace)?;
            if !meta.is_dir() || meta.file_type().is_symlink() { return Err(Error::UnsupportedNamespace); }
            // System ancestors are trusted; a shared sticky system temp parent is
            // allowed for exclusively created owned fixture/private child namespaces.
            let sticky_system_parent = meta.uid() == 0 && meta.mode() & 0o1000 != 0 && prefix != root;
            if !matches!(meta.uid(), 0) && meta.uid() != current_uid() { return Err(Error::UnsupportedNamespace); }
            if meta.mode() & 0o022 != 0 && !sticky_system_parent { return Err(Error::UnsupportedNamespace); }
        }
        let metadata = fs::symlink_metadata(root).map_err(|_| Error::UnsupportedNamespace)?;
        if metadata.uid() != current_uid() { return Err(Error::UnsupportedNamespace); }
        let canonical = fs::canonicalize(root).map_err(|_| Error::UnsupportedNamespace)?;
        Ok(Self { root: canonical, root_identity: identity(&metadata) })
    }
    fn verify(&self) -> Result<(), Error> {
        let observed = Self::inspect(&self.root)?;
        if observed.root_identity != self.root_identity { return Err(Error::IdentityMismatch); }
        Ok(())
    }
    fn main(&self) -> PathBuf { self.root.join("crewing.sqlite") }
    fn sidecars(&self) -> Result<Sidecars, Error> {
        let mut observed = [None; 3];
        for (index, suffix) in ["-journal", "-wal", "-shm"].into_iter().enumerate() {
            let path = self.root.join(format!("crewing.sqlite{suffix}"));
            match fs::symlink_metadata(&path) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(_) => return Err(Error::UnsupportedNamespace),
                Ok(_) => { observed[index] = Some(ordinary_file(&path)?); },
            }
        }
        Ok(Sidecars(observed))
    }
}

// Operation-local identities. SQLite may legitimately create/delete sidecars on
// close/checkpoint, so this is NOT persisted as a historical SHM inode requirement.
#[derive(Clone, PartialEq, Eq)]
struct Sidecars([Option<FileIdentity>; 3]);

// Private persistent data. A caller must atomically store this together with the
// validated account/company tuple and private key/context references before use.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct DatabaseReference { owner: Owner, root: PathBuf, root_identity: FileIdentity, main_identity: FileIdentity }
impl DatabaseReference {
    pub(crate) fn namespace(&self) -> Result<Namespace, Error> {
        let namespace=Namespace::inspect(&self.root)?;
        if namespace.root_identity != self.root_identity { return Err(Error::IdentityMismatch); }
        Ok(namespace)
    }
    pub(crate) fn vault_path(&self) -> Option<&str> { self.root.to_str() }
}
impl std::fmt::Debug for DatabaseReference {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str("DatabaseReference(<private>)") }
}
fn read_header_before_sqlite(namespace: &Namespace) -> Result<FileIdentity, Error> {
    namespace.verify()?; namespace.sidecars()?;
    let path = namespace.main(); let expected = ordinary_file(&path)?;
    let mut file = OpenOptions::new().read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC)
        .open(&path).map_err(|_| Error::DatabaseUnavailable)?;
    if identity(&file.metadata().map_err(|_| Error::DatabaseUnavailable)?) != expected { return Err(Error::IdentityMismatch); }
    let mut header = [0u8; 16]; file.read_exact(&mut header).map_err(|_| Error::DatabaseUnavailable)?;
    if &header != b"SQLite format 3\0" { return Err(Error::UnsupportedSchema); }
    // This ordinary main-inode FD is closed BEFORE any unix-excl lock is acquired.
    drop(file); Ok(expected)
}
fn verify_reference(namespace: &Namespace, owner: &Owner, reference: &DatabaseReference) -> Result<(), Error> {
    if &reference.owner != owner || reference.root != namespace.root
        || reference.root_identity != namespace.root_identity { return Err(Error::ReferenceMismatch); }
    namespace.verify()?; namespace.sidecars()?;
    if ordinary_file(&namespace.main())? != reference.main_identity { return Err(Error::IdentityMismatch); }
    Ok(())
}
fn open_exclusive(namespace: &Namespace, reference: &DatabaseReference, quarantine: &mut Option<Connection>) -> Result<Connection, Error> {
    // All app path writers are excluded by the caller's namespace/runtime lease.
    // These checks precede SQLite open. A post-open stat is supplemental only.
    verify_reference(namespace, &reference.owner, reference)?;
    let conn = Connection::open_with_flags_and_vfs(namespace.main(),
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        "unix-excl").map_err(|_| Error::DatabaseUnavailable)?;
    if !matches!(conn.is_readonly(DatabaseName::Main), Ok(false)) {
        close_detached(conn, quarantine)?; return Err(Error::DatabaseUnavailable);
    }
    // Open itself is NOT lock proof: validate_schema performs actual pager reads.
    Ok(conn)
}

pub(crate) enum ExistingBinding<'a> {
    // Only the already-connected legacy vault; the account proof must independently
    // establish ownership of this SAME saved company before this call.
    LegacySameSavedCompany { saved_company: &'a str },
    NativeSavedReference(&'a DatabaseReference),
}
// A failed sqlite3_close must remain owned and denied, rather than be dropped with
// an ignored error. This slot is independent from published legacy/native CONN.
static QUARANTINE: Mutex<Option<Connection>> = Mutex::new(None);
pub(crate) struct Store<'a> {
    slot: &'a Mutex<Option<Connection>>,
    quarantine: &'a Mutex<Option<Connection>>,
}
fn close_detached(conn: Connection, quarantine: &mut Option<Connection>) -> Result<(), Error> {
    match conn.close() {
        Ok(()) => Ok(()),
        Err((conn, _)) => { *quarantine = Some(conn); Err(Error::DatabaseCloseFailed) }
    }
}
fn verify_live_handle(conn: &Connection, namespace: &Namespace) -> Result<(), Error> {
    if conn.path().map(Path::new) != Some(namespace.main().as_path()) || !conn.is_autocommit() {
        return Err(Error::IdentityMismatch);
    }
    let mut moved: libc::c_int = 1;
    // The DB mutex is held; main/static C string and writable c_int live through
    // this synchronous SQLite call. HAS_MOVED uses VFS stat, never a second main FD.
    let rc = unsafe { rusqlite::ffi::sqlite3_file_control(conn.handle(), b"main\0".as_ptr().cast(),
        rusqlite::ffi::SQLITE_FCNTL_HAS_MOVED, (&mut moved as *mut libc::c_int).cast()) };
    if rc != rusqlite::ffi::SQLITE_OK || moved != 0 { return Err(Error::IdentityMismatch); }
    Ok(())
}
impl<'a> Store<'a> {
    pub(crate) fn new(slot: &'a Mutex<Option<Connection>>, quarantine: &'a Mutex<Option<Connection>>) -> Self {
        Self { slot, quarantine }
    }
    pub(crate) fn prepare_existing(&self, namespace: Namespace, owner: Owner,
        binding: ExistingBinding<'_>) -> Result<Prepared<'a>, Error> {
        let saved = match binding {
            ExistingBinding::LegacySameSavedCompany { saved_company }
                if crate::native_account::valid_id(saved_company) && saved_company == owner.company => None,
            ExistingBinding::NativeSavedReference(reference) if reference.owner == owner
                && reference.root == namespace.root && reference.root_identity == namespace.root_identity => Some(reference),
            _ => return Err(Error::ReferenceMismatch),
        };
        let guard = self.slot.lock().map_err(|_| Error::SlotUnavailable)?;
        let quarantine = self.quarantine.lock().map_err(|_| Error::SlotUnavailable)?;
        if quarantine.is_some() { return Err(Error::DatabaseCloseFailed); }
        // Never open/close a second main-inode FD while any SQLite handle is live.
        let main_identity = if let Some(active) = guard.as_ref() {
            verify_live_handle(active, &namespace)?;
            namespace.verify()?; namespace.sidecars()?; ordinary_file(&namespace.main())?
        } else { read_header_before_sqlite(&namespace)? };
        let reference = DatabaseReference { owner, root: namespace.root.clone(), root_identity: namespace.root_identity, main_identity };
        if saved.is_some_and(|old| old != &reference) { return Err(Error::ReferenceMismatch); }
        let sidecars = namespace.sidecars()?;
        Ok(Prepared { guard, quarantine, namespace, reference, sidecars, fresh: None })
    }
    // Resolve only the DB already held by this slot. Settings vault strings and
    // Fresh allocation hints cannot supply a physical path for legacy conversion.
    pub(crate) fn prepare_current_legacy(&self, owner:Owner, saved_company:&str)
        -> Result<Prepared<'a>,Error> {
        if !crate::native_account::valid_id(saved_company) || saved_company != owner.company {
            return Err(Error::ReferenceMismatch);
        }
        let guard=self.slot.lock().map_err(|_|Error::SlotUnavailable)?;
        let quarantine=self.quarantine.lock().map_err(|_|Error::SlotUnavailable)?;
        if quarantine.is_some() {return Err(Error::DatabaseCloseFailed);}
        let active=guard.as_ref().ok_or(Error::SlotUnavailable)?;
        let path=active.path().map(Path::new).filter(|path| path.is_absolute()
            && path.file_name()==Some(std::ffi::OsStr::new("crewing.sqlite")))
            .ok_or(Error::UnsupportedNamespace)?;
        let namespace=Namespace::inspect(path.parent().ok_or(Error::UnsupportedNamespace)?)?;
        verify_live_handle(active,&namespace)?;
        let main_identity=ordinary_file(&namespace.main())?;
        let sidecars=namespace.sidecars()?;
        let reference=DatabaseReference {owner,root:namespace.root.clone(),
            root_identity:namespace.root_identity,main_identity};
        // Same SQLite connection/pager; never open/close an extra main-inode FD.
        // SQL can have pager/sidecar effects, so retain and recheck the identities.
        validate_schema(active)?;
        verify_live_handle(active,&namespace)?;
        verify_reference(&namespace,&reference.owner,&reference)?;
        if namespace.sidecars()? != sidecars {return Err(Error::IdentityMismatch);}
        Ok(Prepared {guard,quarantine,namespace,reference,sidecars,fresh:None})
    }
    pub(crate) fn prepare_fresh(&self, namespace: Namespace, owner: Owner) -> Result<Prepared<'a>, Error> {
        let guard = self.slot.lock().map_err(|_| Error::SlotUnavailable)?;
        let mut quarantine = self.quarantine.lock().map_err(|_| Error::SlotUnavailable)?;
        if quarantine.is_some() { return Err(Error::DatabaseCloseFailed); }
        if guard.is_some() { return Err(Error::ReferenceMismatch); }
        namespace.verify()?;
        for path in [namespace.main(), namespace.root.join("crewing.sqlite-journal"), namespace.root.join("crewing.sqlite-wal"), namespace.root.join("crewing.sqlite-shm")] {
            match fs::symlink_metadata(path) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                _ => return Err(Error::ReferenceMismatch),
            }
        }
        // Only exclusively created owned fresh namespaces; no existing path CREATE.
        // Failed preparation can leave unreferenced owned artifacts for the owner.
        let file = OpenOptions::new().write(true).create_new(true).mode(0o600)
            .open(namespace.main()).map_err(|_| Error::DatabaseUnavailable)?;
        let main_identity = identity(&file.metadata().map_err(|_| Error::DatabaseUnavailable)?); drop(file);
        let reference = DatabaseReference { owner, root: namespace.root.clone(), root_identity: namespace.root_identity, main_identity };
        let conn = open_exclusive(&namespace, &reference, &mut quarantine)?;
        let result = (|| {
            initialize_fresh(&conn)?; validate_schema(&conn)?;
            // Directory is a different inode; closing it cannot drop main locks.
            let directory = fs::File::open(&namespace.root).map_err(|_| Error::DatabaseUnavailable)?;
            if identity(&directory.metadata().map_err(|_| Error::DatabaseUnavailable)?) != namespace.root_identity {
                return Err(Error::IdentityMismatch);
            }
            directory.sync_all().map_err(|_| Error::DatabaseUnavailable)?;
            namespace.sidecars()
        })();
        let sidecars = match result {
            Ok(sidecars) => sidecars,
            Err(error) => { close_detached(conn, &mut quarantine)?; return Err(error); }
        };
        Ok(Prepared { guard, quarantine, namespace, reference, sidecars, fresh: Some(conn) })
    }
    // Caller has already denied private access under the Runtime write gate.
    // On failure the handle remains owned; a successful return confirms both closed.
    pub(crate) fn close_all(&self) -> Result<(), Error> {
        let mut slot = self.slot.lock().map_err(|_| Error::SlotUnavailable)?;
        let mut quarantine = self.quarantine.lock().map_err(|_| Error::SlotUnavailable)?;
        if let Some(conn) = slot.take() {
            if let Err((conn, _)) = conn.close() { *slot = Some(conn); return Err(Error::DatabaseCloseFailed); }
        }
        if let Some(conn) = quarantine.take() {
            if let Err((conn, _)) = conn.close() { *quarantine = Some(conn); return Err(Error::DatabaseCloseFailed); }
        }
        Ok(())
    }
}
impl Store<'static> { pub(crate) fn for_application() -> Self { Self::new(&super::CONN, &QUARANTINE) } }

pub(crate) struct Prepared<'a> {
    guard: MutexGuard<'a, Option<Connection>>, quarantine: MutexGuard<'a, Option<Connection>>,
    namespace: Namespace, reference: DatabaseReference, sidecars: Sidecars, fresh: Option<Connection>,
}
impl Prepared<'_> {
    pub(crate) fn reference(&self) -> DatabaseReference { self.reference.clone() }
    pub(crate) fn validate_before_persist(&self) -> Result<(), Error> {
        verify_reference(&self.namespace, &self.reference.owner, &self.reference)?;
        if self.namespace.sidecars()? != self.sidecars { return Err(Error::IdentityMismatch); }
        if let Some(conn) = self.guard.as_ref() { verify_live_handle(conn, &self.namespace)?; }
        if let Some(conn) = self.fresh.as_ref() { verify_live_handle(conn, &self.namespace)?; }
        Ok(())
    }
    // ONLY after confirmed atomic Settings commit; failure is matching-identity
    // CommittedBlocked. A close failure means database_closed=false until retry.
    pub(crate) fn activate_after_confirmed_commit(mut self) -> Result<(), Error> {
        self.validate_before_persist()?;
        if let Some(old) = self.guard.take() {
            // Close can checkpoint/remove sidecars. Their identities were bound and
            // checked BEFORE this first mutation under the stable-namespace lease.
            if let Err((old, _)) = old.close() {
                *self.guard = Some(old); return Err(Error::DatabaseCloseFailed);
            }
        }
        // Bind the post-close sidecars before SQLite reopen. Legitimate close-owned
        // transitions are allowed, never an arbitrary persisted SHM inode match.
        self.namespace.sidecars()?;
        let conn = if let Some(conn) = self.fresh.take() { conn }
            else { open_exclusive(&self.namespace, &self.reference, &mut self.quarantine)? };
        let result = validate_schema(&conn).and_then(|_| {
            verify_live_handle(&conn, &self.namespace)?;
            verify_reference(&self.namespace, &self.reference.owner, &self.reference)
        });
        if let Err(error) = result { close_detached(conn, &mut self.quarantine)?; return Err(error); }
        *self.guard = Some(conn); Ok(())
    }
}
impl Drop for Prepared<'_> {
    fn drop(&mut self) {
        if let Some(conn) = self.fresh.take() {
            // No publication on abandoned fresh preparation. Failed close remains
            // owned in quarantine and blocks the next prepare; never silently lost.
            let _ = close_detached(conn, &mut self.quarantine);
        }
    }
}

const TABLES: [(&str, &[&str]); 5] = [
    ("vacancies", &["id", "posted_at", "payload_json", "status"]),
    ("applications", &["id", "vacancy_id", "received_at", "applicant_summary_json", "status"]),
    ("documents", &["id", "name", "doc_type", "stored_path", "original_filename", "size_bytes", "notes", "created_at", "category", "template_id", "valid_to", "has_expiry", "issuer", "issue_date", "cert_number"]),
    ("seafarers", &["id", "display_name", "rank", "position", "nationality", "available_from", "source_application_id", "first_seen_at", "last_received_at", "ex_crew", "status", "notes", "summary_json", "manifest_json", "docs_dir", "cv_path", "availability_status", "last_ping_at", "last_reply_at", "last_reply_text"]),
    ("seafarer_documents", &["id", "seafarer_id", "title", "category", "template_id", "file_path", "file_name", "doc_number", "issued_by", "valid_from", "valid_to", "has_file", "received_at"]),
];
struct Column { name: String, declared_type: String, not_null: bool, default: Option<String>, primary_key_position: i64 }
fn validate_schema(conn: &Connection) -> Result<(), Error> {
    for (table, required) in TABLES {
        // This actual read must succeed; merely opening unix-excl is not lock proof.
        let kind: Option<String> = conn.query_row("SELECT type FROM sqlite_schema WHERE name=?1", [table], |row| row.get(0))
            .optional().map_err(|_| Error::DatabaseUnavailable)?;
        if kind.as_deref() != Some("table") { return Err(Error::UnsupportedSchema); }
        let mut query = conn.prepare(&format!("PRAGMA table_info({table})")).map_err(|_| Error::DatabaseUnavailable)?;
        let columns = query.query_map([], |row| Ok(Column { name: row.get(1)?, declared_type: row.get(2)?,
            not_null: row.get::<_, i64>(3)? != 0, default: row.get(4)?, primary_key_position: row.get(5)?,
        })).map_err(|_| Error::DatabaseUnavailable)?.collect::<rusqlite::Result<Vec<_>>>().map_err(|_| Error::DatabaseUnavailable)?;
        if required.iter().any(|name| !columns.iter().any(|column| column.name == *name)) { return Err(Error::MigrationRequired); }
        let id = columns.iter().find(|column| column.name == "id").ok_or(Error::UnsupportedSchema)?;

        if id.primary_key_position != 1 || columns.iter().filter(|column| column.primary_key_position != 0).count() != 1
            || affinity(&id.declared_type) != Affinity::Text {
            return Err(Error::UnsupportedSchema);
        }
        // TEXT PRIMARY KEY may legitimately report notnull=0 in SQLite. Extra
        // nullable/default columns, indexes, triggers and foreign keys are retained.
        let nullable = match table {
            "documents" => &["notes", "template_id", "valid_to", "issuer", "issue_date", "cert_number"][..],
            "seafarers" => &["rank", "position", "nationality", "available_from", "source_application_id", "notes", "summary_json", "manifest_json", "docs_dir", "cv_path", "last_ping_at", "last_reply_at", "last_reply_text"][..],
            "seafarer_documents" => &["category", "template_id", "file_path", "file_name", "doc_number", "issued_by", "valid_from", "valid_to"][..],
            _ => &[][..],
        };
        for column in &columns {
            if required.contains(&column.name.as_str()) {
                let integer = matches!((table, column.name.as_str()),
                    ("documents", "size_bytes" | "has_expiry") | ("seafarers", "ex_crew") | ("seafarer_documents", "has_file"));
                let expected = if integer { Affinity::Integer } else { Affinity::Text };
                if affinity(&column.declared_type) != expected { return Err(Error::UnsupportedSchema); }
            }
            // Existing CRUD explicitly supplies NULL to these optional fields.
            if column.not_null && nullable.contains(&column.name.as_str()) { return Err(Error::UnsupportedSchema); }
            // seafarer INSERT omits availability_status. Additional columns are
            // also omitted, so a NOT NULL DEFAULT NULL is incompatible too.
            let omitted = !required.contains(&column.name.as_str())
                || (table == "seafarers" && column.name == "availability_status");
            if (column.not_null && omitted || table == "seafarers" && column.name == "availability_status")
                && !column.default.as_deref().is_some_and(non_null_literal_default) {
                return Err(Error::UnsupportedSchema);
            }
        }
        let sql = format!("SELECT {} FROM {table} LIMIT 0", required.join(","));
        conn.prepare(&sql).map_err(|_| Error::DatabaseUnavailable)?;
    }
    Ok(())
}
#[derive(PartialEq, Eq)]
enum Affinity { Integer, Text, Other }
fn affinity(declared: &str) -> Affinity {
    let declared = declared.to_ascii_uppercase();
    // SQLite's rule order matters: INTCHAR has INTEGER, not TEXT affinity.
    if declared.contains("INT") { Affinity::Integer }
    else if ["CHAR", "CLOB", "TEXT"].iter().any(|part| declared.contains(part)) { Affinity::Text }
    else { Affinity::Other }
}
// Conservatively admit literal defaults and SQLite date/time keywords. Unknown
// expressions are unsupported; schema metadata is never executed as arbitrary SQL.
fn non_null_literal_default(default: &str) -> bool {
    let mut value = default.trim();
    while value.starts_with('(') && value.ends_with(')') { value = value[1..value.len()-1].trim(); }
    if matches!(value.to_ascii_uppercase().as_str(), "CURRENT_TIME" | "CURRENT_DATE" | "CURRENT_TIMESTAMP") { return true; }
    if value.parse::<f64>().is_ok_and(f64::is_finite) { return true; }
    let bytes = value.as_bytes();
    if bytes.len() < 2 || !matches!(bytes[0], b'\'' | b'"') || bytes.last() != Some(&bytes[0]) { return false; }
    let quote = bytes[0]; let mut index = 1;
    while index < bytes.len()-1 {
        if bytes[index] == quote {
            if index+1 >= bytes.len()-1 || bytes[index+1] != quote { return false; }
            index += 1;
        }
        index += 1;
    }
    true
}
const FRESH_SCHEMA: &str = "
CREATE TABLE vacancies (id TEXT PRIMARY KEY, posted_at TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open');
CREATE TABLE applications (id TEXT PRIMARY KEY, vacancy_id TEXT NOT NULL, received_at TEXT NOT NULL, applicant_summary_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new');
CREATE TABLE documents (id TEXT PRIMARY KEY, name TEXT NOT NULL, doc_type TEXT NOT NULL, stored_path TEXT NOT NULL,
 original_filename TEXT NOT NULL, size_bytes INTEGER NOT NULL, notes TEXT, created_at TEXT NOT NULL,
 category TEXT NOT NULL DEFAULT 'Other', template_id TEXT, valid_to TEXT, has_expiry INTEGER NOT NULL DEFAULT 0,
 issuer TEXT, issue_date TEXT, cert_number TEXT);
CREATE TABLE seafarers (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, rank TEXT, position TEXT, nationality TEXT,
 available_from TEXT, source_application_id TEXT, first_seen_at TEXT NOT NULL, last_received_at TEXT NOT NULL,
 ex_crew INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'prospect', notes TEXT, summary_json TEXT, manifest_json TEXT,
 docs_dir TEXT, cv_path TEXT, availability_status TEXT NOT NULL DEFAULT 'unknown', last_ping_at TEXT, last_reply_at TEXT, last_reply_text TEXT);
CREATE TABLE seafarer_documents (id TEXT PRIMARY KEY, seafarer_id TEXT NOT NULL, title TEXT NOT NULL, category TEXT, template_id TEXT,
 file_path TEXT, file_name TEXT, doc_number TEXT, issued_by TEXT, valid_from TEXT, valid_to TEXT,
 has_file INTEGER NOT NULL DEFAULT 0, received_at TEXT NOT NULL,
 FOREIGN KEY(seafarer_id) REFERENCES seafarers(id) ON DELETE CASCADE);
CREATE INDEX idx_seafarers_rank ON seafarers(rank);
CREATE INDEX idx_seafarers_ex_crew ON seafarers(ex_crew);
CREATE INDEX idx_seafarer_documents_owner ON seafarer_documents(seafarer_id);";
fn initialize_fresh(conn: &Connection) -> Result<(), Error> {
    conn.execute_batch("PRAGMA synchronous=FULL; BEGIN IMMEDIATE;").map_err(|_| Error::DatabaseUnavailable)?;
    conn.execute_batch(FRESH_SCHEMA).map_err(|_| Error::DatabaseUnavailable)?;
    let now = chrono::Utc::now().to_rfc3339();
    for (tid, name, category, doc_type, has_expiry) in super::REQUIRED_TEMPLATES {
        conn.execute("INSERT INTO documents (id,name,doc_type,stored_path,original_filename,size_bytes,notes,created_at,category,template_id,has_expiry)
            VALUES (?1,?2,?3,'','',0,NULL,?4,?5,?6,?7)",
            params![uuid::Uuid::new_v4().to_string(), name, doc_type, now, category, tid, if *has_expiry { 1 } else { 0 }])
            .map_err(|_| Error::DatabaseUnavailable)?;
    }
    conn.execute_batch("COMMIT;").map_err(|_| Error::DatabaseUnavailable)?;
    Ok(())
}

#[cfg(test)]
mod tests {
// Synthetic private namespace only. Never hash/open a second main FD while any
// SQLite handle is live. Inventories are only before open / after explicit close.
use super::*;
use std::{collections::BTreeMap, io::{BufRead, BufReader, Write}, os::unix::fs::{PermissionsExt, symlink}, process::{Child, Command, Stdio}};
use sha2::{Digest, Sha256};
struct Fixture { root: PathBuf, db: PathBuf }
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("crewing635-native-db-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap(); fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let db = root.join("workspace"); fs::create_dir(&db).unwrap(); Self { root, db }
    }
    fn namespace(&self) -> Namespace { Namespace::inspect(&self.db).unwrap() }
    fn main(&self) -> PathBuf { self.db.join("crewing.sqlite") }
    fn cold(&self) {
        let conn = Connection::open(self.main()).unwrap(); initialize_fresh(&conn).unwrap();
        conn.execute("INSERT INTO vacancies VALUES('fixture-row','fixture-date','{}','open')", []).unwrap();
        conn.close().unwrap(); fs::set_permissions(self.main(), fs::Permissions::from_mode(0o600)).unwrap();
    }
}
impl Drop for Fixture { fn drop(&mut self) { fs::remove_dir_all(&self.root).unwrap(); } }
fn owner() -> Owner { Owner::from_validated_binding("fixture-account".into(), "fixture-company".into(), "00000000-0000-4000-8000-000000000635".into()).unwrap() }
fn legacy() -> ExistingBinding<'static> { ExistingBinding::LegacySameSavedCompany { saved_company: "fixture-company" } }
fn inventory(path: &Path) -> BTreeMap<String, String> {
    fs::read_dir(path).unwrap().map(|entry| {
        let entry = entry.unwrap(); assert!(entry.file_type().unwrap().is_file());
        (entry.file_name().into_string().unwrap(), format!("{:x}", Sha256::digest(fs::read(entry.path()).unwrap())))
    }).collect()
}
fn row_present(conn: &Connection) {
    assert_eq!(conn.query_row("SELECT status FROM vacancies WHERE id='fixture-row'", [], |r| r.get::<_, String>(0)).unwrap(), "open");
}
fn persist(f: &Fixture, reference: &DatabaseReference) {
    let bytes = serde_json::to_vec(reference).unwrap();
    assert_eq!(crate::private_store::atomic_write(&f.root.join("private-reference.json"), &bytes).unwrap(), crate::private_store::Durability::Confirmed);
    assert!(serde_json::from_slice::<DatabaseReference>(&fs::read(f.root.join("private-reference.json")).unwrap()).unwrap() == *reference);
}
// Native account/company/key SessionRecord wiring remains separate: this exercises
// only real atomic IO composed with the private DB adapter, never production login.
#[test]
fn native635_database_cold_prepare_and_precommit_fault_preserve_files_and_reference() {
    let f = Fixture::new(); f.cold(); let before = inventory(&f.db);
    let active = Mutex::new(None); let quarantine = Mutex::new(None); let store = Store::new(&active, &quarantine);
    fs::write(f.root.join("private-reference.json"), b"old synthetic reference").unwrap();
    let prepared = store.prepare_existing(f.namespace(), owner(), legacy()).unwrap();
    prepared.validate_before_persist().unwrap();
    assert!(crate::private_store::atomic_write_with_fault(&f.root.join("private-reference.json"), &serde_json::to_vec(&prepared.reference()).unwrap(), crate::private_store::TestFault::FileSync).is_err());
    drop(prepared);
    assert_eq!(fs::read(f.root.join("private-reference.json")).unwrap(), b"old synthetic reference");
    assert!(active.lock().unwrap().is_none()); assert!(quarantine.lock().unwrap().is_none());
    assert_eq!(inventory(&f.db), before);
}
#[test]
fn native635_database_live_handle_survives_precommit_then_rows_survive_exclusive_transition() {
    let f = Fixture::new(); f.cold();
    let conn = Connection::open(f.main()).unwrap(); row_present(&conn); let pointer = unsafe { conn.handle() } as usize;
    let active = Mutex::new(Some(conn)); let quarantine = Mutex::new(None); let store = Store::new(&active, &quarantine);
    let prepared = store.prepare_existing(f.namespace(), owner(), legacy()).unwrap();
    assert_eq!(unsafe { prepared.guard.as_ref().unwrap().handle() } as usize, pointer);
    row_present(prepared.guard.as_ref().unwrap()); drop(prepared);
    assert_eq!(unsafe { active.lock().unwrap().as_ref().unwrap().handle() } as usize, pointer);
    let prepared = store.prepare_existing(f.namespace(), owner(), legacy()).unwrap();
    persist(&f, &prepared.reference()); prepared.activate_after_confirmed_commit().unwrap();
    row_present(active.lock().unwrap().as_ref().unwrap()); store.close_all().unwrap();
}
#[test]
fn native635_database_live_same_path_replaced_inode_is_refused_without_adoption() {
    let f = Fixture::new(); f.cold(); let conn = Connection::open(f.main()).unwrap(); row_present(&conn);
    let active = Mutex::new(Some(conn)); let quarantine = Mutex::new(None); let store = Store::new(&active, &quarantine);
    fs::rename(f.main(), f.db.join("old.sqlite")).unwrap(); fs::write(f.main(), b"replacement synthetic bytes").unwrap();
    assert!(matches!(store.prepare_existing(f.namespace(), owner(), legacy()), Err(Error::IdentityMismatch)));
    // No ordinary FD is opened on the still-live old inode. Replacement is a different inode.
    assert_eq!(fs::read(f.main()).unwrap(), b"replacement synthetic bytes"); store.close_all().unwrap();
}
#[test]
fn native635_database_sidecar_substitution_after_prepare_is_refused_before_sqlite() {
    let f = Fixture::new(); f.cold(); fs::write(f.db.join("crewing.sqlite-journal"), b"synthetic non-hot journal").unwrap();
    let active = Mutex::new(None); let quarantine = Mutex::new(None); let store = Store::new(&active, &quarantine);
    let prepared = store.prepare_existing(f.namespace(), owner(), legacy()).unwrap();
    let journal = f.db.join("crewing.sqlite-journal"); fs::rename(&journal, f.db.join("preserved-journal")).unwrap(); fs::write(&journal, b"replacement sidecar").unwrap();
    assert_eq!(prepared.validate_before_persist(), Err(Error::IdentityMismatch)); drop(prepared);
    assert!(active.lock().unwrap().is_none()); assert_eq!(fs::read(&journal).unwrap(), b"replacement sidecar");
}
#[test]
fn native635_database_wrong_owner_and_private_reference_cannot_adopt_workspace() {
    let f = Fixture::new(); f.cold(); let before = inventory(&f.db);
    let active = Mutex::new(None); let quarantine = Mutex::new(None); let store = Store::new(&active, &quarantine);
    let prepared = store.prepare_existing(f.namespace(), owner(), legacy()).unwrap(); let reference = prepared.reference(); drop(prepared);
    for changed in [Owner { account: "other-account".into(), ..owner() }, Owner { company: "other-company".into(), ..owner() }, Owner { context: uuid::Uuid::new_v4().to_string(), ..owner() }] {
        assert!(matches!(store.prepare_existing(f.namespace(), changed, ExistingBinding::NativeSavedReference(&reference)), Err(Error::ReferenceMismatch)));
    }
    assert!(matches!(store.prepare_existing(f.namespace(), owner(), ExistingBinding::LegacySameSavedCompany { saved_company: "other-company" }), Err(Error::ReferenceMismatch)));
    assert_eq!(inventory(&f.db), before);
}
#[test]
fn native635_database_symlink_hardlink_and_namespace_replacement_refused() {
    for target in ["crewing.sqlite", "crewing.sqlite-journal", "crewing.sqlite-wal", "crewing.sqlite-shm"] {
        let f = Fixture::new(); f.cold(); let outside = f.root.join("synthetic-target"); fs::write(&outside, b"do not touch").unwrap();
        if target == "crewing.sqlite" { fs::remove_file(f.db.join(target)).unwrap(); }
        symlink(&outside, f.db.join(target)).unwrap();
        let active = Mutex::new(None); let quarantine = Mutex::new(None); let store = Store::new(&active, &quarantine);
        assert!(store.prepare_existing(f.namespace(), owner(), legacy()).is_err()); assert_eq!(fs::read(&outside).unwrap(), b"do not touch");
    }
    let f = Fixture::new(); f.cold(); fs::hard_link(f.main(), f.root.join("extra-link")).unwrap();
    let active = Mutex::new(None); let quarantine = Mutex::new(None); let store = Store::new(&active, &quarantine);
    assert!(matches!(store.prepare_existing(f.namespace(), owner(), legacy()), Err(Error::UnsupportedNamespace)));
    fs::remove_file(f.root.join("extra-link")).unwrap();
    let prepared = store.prepare_existing(f.namespace(), owner(), legacy()).unwrap();
    fs::rename(&f.db, f.root.join("old-workspace")).unwrap(); fs::create_dir(&f.db).unwrap();
    assert_eq!(prepared.validate_before_persist(), Err(Error::IdentityMismatch));
}
#[test]
fn native635_database_fresh_is_detached_until_commit_and_existing_is_never_recreated() {
    let f = Fixture::new(); let active = Mutex::new(None); let quarantine = Mutex::new(None); let store = Store::new(&active, &quarantine);
    let prepared = store.prepare_fresh(f.namespace(), owner()).unwrap(); assert!(prepared.guard.is_none());
    assert_eq!(fs::metadata(f.main()).unwrap().permissions().mode() & 0o777, 0o600);
    persist(&f, &prepared.reference()); prepared.activate_after_confirmed_commit().unwrap();
    assert_eq!(active.lock().unwrap().as_ref().unwrap().query_row("SELECT count(*) FROM documents", [], |r| r.get::<_, i64>(0)).unwrap(), 5);
    store.close_all().unwrap();
    assert!(matches!(store.prepare_fresh(f.namespace(), owner()), Err(Error::ReferenceMismatch)));
    fs::remove_file(f.main()).unwrap(); assert!(store.prepare_existing(f.namespace(), owner(), legacy()).is_err()); assert!(!f.main().exists());
}
#[test]
fn native635_database_postcommit_unsupported_schema_keeps_matching_reference_and_closes() {
    let f = Fixture::new(); f.cold(); let conn = Connection::open(f.main()).unwrap();
    conn.execute("ALTER TABLE documents DROP COLUMN issuer", []).unwrap(); conn.close().unwrap(); let before = inventory(&f.db);
    let active = Mutex::new(None); let quarantine = Mutex::new(None); let store = Store::new(&active, &quarantine);
    let prepared = store.prepare_existing(f.namespace(), owner(), legacy()).unwrap(); let reference = prepared.reference(); persist(&f, &reference);
    assert_eq!(prepared.activate_after_confirmed_commit(), Err(Error::MigrationRequired));
    assert!(active.lock().unwrap().is_none()); assert!(quarantine.lock().unwrap().is_none());
    assert!(serde_json::from_slice::<DatabaseReference>(&fs::read(f.root.join("private-reference.json")).unwrap()).unwrap() == reference);
    assert_eq!(inventory(&f.db), before); // no native ALTER, seed or recovery needed in this cold fixture
}
#[test]
fn native635_database_schema_rejects_actual_insert_null_and_omission_failures() {
    for (from, to) in [
        ("notes TEXT", "notes TEXT NOT NULL DEFAULT ''"),
        ("size_bytes INTEGER", "size_bytes TEXT"),
        ("has_expiry INTEGER", "has_expiry TEXT"),
        ("ex_crew INTEGER", "ex_crew TEXT"),
        ("has_file INTEGER", "has_file TEXT"),
        ("id TEXT PRIMARY KEY", "id INTCHAR PRIMARY KEY"),
        ("template_id TEXT", "template_id TEXT NOT NULL DEFAULT ''"),
        ("availability_status TEXT NOT NULL DEFAULT 'unknown'", "availability_status TEXT NOT NULL"),
        ("availability_status TEXT NOT NULL DEFAULT 'unknown'", "availability_status TEXT DEFAULT NULL"),
        ("status TEXT NOT NULL DEFAULT 'open'", "status TEXT NOT NULL DEFAULT 'open', extra TEXT NOT NULL DEFAULT NULL"),
        ("status TEXT NOT NULL DEFAULT 'open'", "status TEXT NOT NULL DEFAULT 'open', extra TEXT NOT NULL DEFAULT (NULL)"),
    ] {
        let conn = Connection::open_in_memory().unwrap(); conn.execute_batch(&FRESH_SCHEMA.replacen(from, to, 1)).unwrap();
        assert_eq!(validate_schema(&conn), Err(Error::UnsupportedSchema), "{to}"); conn.close().unwrap();
    }
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(&FRESH_SCHEMA.replacen("status TEXT NOT NULL DEFAULT 'open'", "status TEXT NOT NULL DEFAULT 'open', extra TEXT NOT NULL DEFAULT 'retained'", 1)).unwrap();
    validate_schema(&conn).unwrap();
    conn.execute("INSERT INTO vacancies(id,posted_at,payload_json) VALUES('new','now','{}')", []).unwrap();
    assert_eq!(conn.query_row("SELECT extra FROM vacancies", [], |r| r.get::<_, String>(0)).unwrap(), "retained"); conn.close().unwrap();
}
struct OwnedStatement(*mut rusqlite::ffi::sqlite3_stmt);
impl OwnedStatement {
    fn new(conn: &Connection) -> Self {
        let mut statement = std::ptr::null_mut();
        // Only synthetic fixture: deliberately unfinalized statement forces BUSY.
        assert_eq!(unsafe { rusqlite::ffi::sqlite3_prepare_v2(conn.handle(), b"SELECT * FROM vacancies\0".as_ptr().cast(), -1, &mut statement, std::ptr::null_mut()) }, rusqlite::ffi::SQLITE_OK);
        Self(statement)
    }
    fn finalize(mut self) -> i32 {
        let result = unsafe { rusqlite::ffi::sqlite3_finalize(self.0) }; self.0 = std::ptr::null_mut(); result
    }
}
impl Drop for OwnedStatement { fn drop(&mut self) {
    if !self.0.is_null() { unsafe { rusqlite::ffi::sqlite3_finalize(self.0); } }
} }
#[test]
fn native635_database_close_failure_retains_old_handle_and_refuses_exclusive_reopen() {
    let f = Fixture::new(); f.cold(); let conn = Connection::open(f.main()).unwrap(); let pointer = unsafe { conn.handle() } as usize;
    let active = Mutex::new(Some(conn)); let quarantine = Mutex::new(None); let store = Store::new(&active, &quarantine);
    // Declared after slots: panic cleanup finalizes before connection owners drop.
    let statement = OwnedStatement::new(active.lock().unwrap().as_ref().unwrap());
    let prepared = store.prepare_existing(f.namespace(), owner(), legacy()).unwrap(); persist(&f, &prepared.reference());
    assert_eq!(prepared.activate_after_confirmed_commit(), Err(Error::DatabaseCloseFailed));
    assert_eq!(unsafe { active.lock().unwrap().as_ref().unwrap().handle() } as usize, pointer);
    assert!(quarantine.lock().unwrap().is_none()); assert_eq!(store.close_all(), Err(Error::DatabaseCloseFailed));
    assert_eq!(statement.finalize(), rusqlite::ffi::SQLITE_OK); store.close_all().unwrap();
}
#[test]
fn native635_database_abandoned_fresh_close_failure_quarantines_and_blocks_prepare_until_closed() {
    let f = Fixture::new(); let active = Mutex::new(None); let quarantine = Mutex::new(None); let store = Store::new(&active, &quarantine);
    let prepared = store.prepare_fresh(f.namespace(), owner()).unwrap();
    let statement = OwnedStatement::new(prepared.fresh.as_ref().unwrap()); drop(prepared);
    assert!(active.lock().unwrap().is_none()); assert!(quarantine.lock().unwrap().is_some());
    assert!(matches!(store.prepare_existing(f.namespace(), owner(), legacy()), Err(Error::DatabaseCloseFailed)));
    assert_eq!(store.close_all(), Err(Error::DatabaseCloseFailed)); assert_eq!(statement.finalize(), rusqlite::ffi::SQLITE_OK);
    store.close_all().unwrap(); assert!(quarantine.lock().unwrap().is_none());
    let prepared = store.prepare_existing(f.namespace(), owner(), legacy()).unwrap(); persist(&f, &prepared.reference());
    prepared.activate_after_confirmed_commit().unwrap(); store.close_all().unwrap();
}
const WAL_CREATE: &str = r#"import os,sqlite3,sys
c=sqlite3.connect(sys.argv[1]); c.executescript(sys.argv[2]); c.execute('PRAGMA journal_mode=WAL'); c.execute('PRAGMA wal_autocheckpoint=0'); c.execute("INSERT INTO vacancies VALUES('fixture-row','fixture-date','{}','open')"); c.commit(); os._exit(0)
"#;
#[test]
fn native635_database_inactive_wal_prepare_is_byte_exact_and_activation_reads_committed_rows() {
    for retain_shm in [false, true] {
        let f = Fixture::new(); let output = Command::new("/usr/bin/python3").args(["-I", "-B", "-c", WAL_CREATE]).arg(f.main()).arg(FRESH_SCHEMA).env_clear().env("TMPDIR", &f.root).env("SQLITE_TMPDIR", &f.root).output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        if !retain_shm { fs::remove_file(f.db.join("crewing.sqlite-shm")).unwrap(); }
        let before = inventory(&f.db); assert!(before.contains_key("crewing.sqlite-wal"));
        let active = Mutex::new(None); let quarantine = Mutex::new(None); let store = Store::new(&active, &quarantine);
        let prepared = store.prepare_existing(f.namespace(), owner(), legacy()).unwrap(); prepared.validate_before_persist().unwrap();
        assert_eq!(inventory(&f.db), before); // no open SQLite handle exists at this boundary
        persist(&f, &prepared.reference()); prepared.activate_after_confirmed_commit().unwrap();
        row_present(active.lock().unwrap().as_ref().unwrap()); store.close_all().unwrap();
    }
}
struct Writer(Child);
impl Drop for Writer { fn drop(&mut self) {
    if self.0.try_wait().unwrap().is_none() {
        // Only this owned child's PID; it inherits the supervisor-owned PGID.
        let _ = self.0.kill(); self.0.wait().unwrap();
    }
} }
#[test]
fn native635_database_external_active_writer_blocks_before_private_activation() {
    let f = Fixture::new(); f.cold();
    let script = "import sqlite3,sys\nc=sqlite3.connect(sys.argv[1],timeout=0); c.execute('BEGIN IMMEDIATE'); print('READY',flush=True); sys.stdin.readline(); c.rollback(); c.close()";
    let mut writer = Writer(Command::new("/usr/bin/python3").args(["-I", "-B", "-c", script]).arg(f.main()).env_clear().env("TMPDIR", &f.root).env("SQLITE_TMPDIR", &f.root).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap());
    let mut line = String::new(); BufReader::new(writer.0.stdout.take().unwrap()).read_line(&mut line).unwrap(); assert_eq!(line.trim(), "READY");
    let active = Mutex::new(None); let quarantine = Mutex::new(None); let store = Store::new(&active, &quarantine);
    let prepared = store.prepare_existing(f.namespace(), owner(), legacy()).unwrap(); persist(&f, &prepared.reference());
    assert_eq!(prepared.activate_after_confirmed_commit(), Err(Error::DatabaseUnavailable)); assert!(active.lock().unwrap().is_none()); assert!(quarantine.lock().unwrap().is_none());
    writer.0.stdin.take().unwrap().write_all(b"release\n").unwrap(); assert!(writer.0.wait().unwrap().success());
    let prepared = store.prepare_existing(f.namespace(), owner(), legacy()).unwrap(); persist(&f, &prepared.reference()); prepared.activate_after_confirmed_commit().unwrap();
    row_present(active.lock().unwrap().as_ref().unwrap()); store.close_all().unwrap();
}
}

// Local-only key foundation; no active crypto/registration/startup caller.
#[path = "native_keys.rs"]
pub(crate) mod native_keys;
#[path = "native_binding.rs"]
pub(crate) mod native_binding;
