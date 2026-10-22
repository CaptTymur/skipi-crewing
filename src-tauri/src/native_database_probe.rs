// Test-only empirical SQLite boundary checks; not an application DB adapter.
// Every file is synthetic and exclusively created under the launcher's private TMPDIR.
use std::{collections::BTreeMap, fs, path::{Path, PathBuf}};
use std::os::unix::fs::PermissionsExt;
use rusqlite::{Connection, OpenFlags};
use sha2::{Digest, Sha256};
use serde::Serialize;

#[derive(Clone, PartialEq, Eq, Serialize)]
struct Snapshot { bytes: u64, sha256: String }
fn inventory(root: &Path) -> BTreeMap<String, Snapshot> {
    fs::read_dir(root).unwrap().map(|entry| {
        let entry = entry.unwrap(); assert!(entry.file_type().unwrap().is_file());
        let bytes = fs::read(entry.path()).unwrap();
        (entry.file_name().into_string().unwrap(), Snapshot {
            bytes: bytes.len() as u64, sha256: format!("{:x}", Sha256::digest(&bytes)),
        })
    }).collect()
}
struct Fixture { root: PathBuf, live: PathBuf, copy: PathBuf }
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("crewing635-db-probe-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap(); fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let live = root.join("live"); let copy = root.join("copy");
        fs::create_dir(&live).unwrap(); fs::create_dir(&copy).unwrap(); Self { root, live, copy }
    }
    fn database(root: &Path) -> PathBuf { root.join("synthetic.sqlite") }
    fn writer(&self, wal: bool) -> Connection {
        let conn = Connection::open(Self::database(&self.live)).unwrap();
        if wal {
            let selected: String = conn.query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0)).unwrap();
            assert_eq!(selected, "wal"); conn.execute_batch("PRAGMA wal_autocheckpoint=0;").unwrap();
        } else {
            let selected: String = conn.query_row("PRAGMA journal_mode=DELETE", [], |r| r.get(0)).unwrap();
            assert_eq!(selected, "delete");
        }
        conn.execute_batch("CREATE TABLE sentinel(id TEXT PRIMARY KEY, marker TEXT NOT NULL); INSERT INTO sentinel VALUES('synthetic-id','synthetic-preserved');").unwrap();
        conn
    }
    fn copy_committed_wal_pair(&self) {
        // The caller holds the only writer idle after committed statements. No real DB
        // or concurrently changing files are copied; this deliberately excludes SHM.
        for name in ["synthetic.sqlite", "synthetic.sqlite-wal"] {
            fs::copy(self.live.join(name), self.copy.join(name)).unwrap();
        }
        assert!(!self.copy.join("synthetic.sqlite-shm").exists());
    }
}
impl Drop for Fixture { fn drop(&mut self) { fs::remove_dir_all(&self.root).unwrap(); } }
fn read_only(path: &Path) -> Connection {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY
        | OpenFlags::SQLITE_OPEN_NO_MUTEX | OpenFlags::SQLITE_OPEN_NOFOLLOW).unwrap()
}
fn read_sentinel(conn: &Connection) {
    assert!(conn.is_readonly(rusqlite::DatabaseName::Main).unwrap());
    let marker: String = conn.query_row("SELECT marker FROM sentinel WHERE id='synthetic-id'", [], |r| r.get(0)).unwrap();
    assert_eq!(marker, "synthetic-preserved");
}
fn report(label: &str, before: &BTreeMap<String, Snapshot>, during: &BTreeMap<String, Snapshot>, after: &BTreeMap<String, Snapshot>) {
    let changed = |other: &BTreeMap<String, Snapshot>| -> Vec<String> {
        let keys: std::collections::BTreeSet<_> = before.keys().chain(other.keys()).collect();
        keys.into_iter().filter(|key| before.get(*key) != other.get(*key)).cloned().collect()
    };
    println!("NATIVE635_DB_PROBE {}", serde_json::json!({
        "case": label, "sqlite_version": rusqlite::version(), "before": before, "during": during, "after": after,
        "changed_during": changed(during), "changed_after": changed(after),
        "limit": "owned primitive fixture only; no production schema, adapter, account ownership, hot-journal or cross-platform proof"
    }));
}
#[test]
fn native635_db_probe_cold_delete_mode_readonly_preserves_all_file_bytes_and_names() {
    let f = Fixture::new(); let writer = f.writer(false); drop(writer);
    let before = inventory(&f.live); assert_eq!(before.len(), 1);
    let reader = read_only(&Fixture::database(&f.live)); read_sentinel(&reader);
    let during = inventory(&f.live); drop(reader); let after = inventory(&f.live);
    assert!(before == during && before == after, "cold DELETE-mode readonly control changed files");
    report("cold_delete", &before, &during, &after);
}
#[test]
fn native635_db_probe_live_committed_wal_readonly_reports_actual_sidecar_effects() {
    let f = Fixture::new(); let writer = f.writer(true);
    let before = inventory(&f.live); assert!(before.get("synthetic.sqlite-wal").unwrap().bytes > 32);
    assert!(before.contains_key("synthetic.sqlite-shm"));
    let reader = read_only(&Fixture::database(&f.live)); read_sentinel(&reader);
    let during = inventory(&f.live); drop(reader); let after = inventory(&f.live);
    // SHM is measured, never presumed immutable merely from READ_ONLY on Main.
    for name in ["synthetic.sqlite", "synthetic.sqlite-wal"] {
        assert!(before.get(name) == during.get(name) && before.get(name) == after.get(name), "committed data file changed");
    }
    report("live_wal_with_shm", &before, &during, &after); drop(writer);
}
#[test]
fn native635_db_probe_inactive_committed_wal_without_shm_reports_open_and_close_effects() {
    let f = Fixture::new(); let writer = f.writer(true); f.copy_committed_wal_pair();
    let before = inventory(&f.copy); assert_eq!(before.len(), 2);
    let reader = read_only(&Fixture::database(&f.copy)); read_sentinel(&reader);
    let during = inventory(&f.copy); drop(reader); let after = inventory(&f.copy);
    assert!(before.get("synthetic.sqlite") == during.get("synthetic.sqlite")
        && before.get("synthetic.sqlite") == after.get("synthetic.sqlite"), "readonly main DB changed");
    report("inactive_wal_without_shm", &before, &during, &after); drop(writer);
}
