// Private credential persistence. The caller prepares the parent directory first.
// Err always means the target was not replaced. Directory sync occurs after commit.
use std::{fmt, fs::{self, File, OpenOptions}, io::{self, Write}, path::{Path, PathBuf}};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Durability { Confirmed, CommittedUnknown }

#[derive(Debug)]
pub(crate) struct PersistError { pub(crate) phase: &'static str, pub(crate) cleanup_confirmed: bool }
impl fmt::Display for PersistError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { f.write_str("settings_storage_error") }
}
impl std::error::Error for PersistError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Point { ParentOpen, Created, PartialWrite, FileSync, Rename, DirectorySync }

struct Pending { path: PathBuf, identity: File, committed: bool }
impl Pending {
    fn still_owns_path(&self) -> bool {
        let metadata = match fs::symlink_metadata(&self.path) { Ok(m) => m, Err(_) => return false };
        if !metadata.is_file() || metadata.file_type().is_symlink() { return false; }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let own = match self.identity.metadata() { Ok(m) => m, Err(_) => return false };
            metadata.dev() == own.dev() && metadata.ino() == own.ino()
        }
        #[cfg(not(unix))]
        { false }
    }
    fn cleanup(&self) -> bool {
        if self.committed { return true; }
        match fs::symlink_metadata(&self.path) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => return true,
            Err(_) => return false,
            Ok(_) => (),
        }
        if !self.still_owns_path() { return false; }
        fs::remove_file(&self.path).is_ok()
    }
}

pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<Durability, PersistError> {
    let parent = path.parent().ok_or(PersistError { phase: "parent", cleanup_confirmed: true })?;
    let name = path.file_name().ok_or(PersistError { phase: "name", cleanup_confirmed: true })?;
    let pending = parent.join(format!(".{}.pending-{}", name.to_string_lossy(), uuid::Uuid::new_v4()));
    atomic_write_at(path, &pending, bytes, |_, _| Ok(()))
}


// Metadata admission for an explicit native Settings destination. No mkdir,
// default-path resolution, reads of Settings bytes, chmod, backup or link adoption.
// Caller exclusively owns all app writers in this namespace. This is not a
// pathname lock against malicious same-UID processes or concurrent external moves.
#[cfg(target_os = "linux")]
pub(crate) fn native_settings_destination(path: &Path) -> Result<(), PersistError> {
    use std::os::unix::fs::MetadataExt;
    use std::path::Component;
    let fail=|| PersistError {phase:"native_destination",cleanup_confirmed:true};
    if !path.is_absolute() || path.to_str().is_none() || path.file_name().is_none() {
        return Err(fail());
    }
    let parent=path.parent().ok_or_else(fail)?;
    let uid=unsafe { libc::geteuid() };
    let mut prefix=PathBuf::new();
    for component in parent.components() {
        match component {
            Component::RootDir | Component::Normal(_) => prefix.push(component.as_os_str()),
            _ => return Err(fail()),
        }
        let metadata=fs::symlink_metadata(&prefix).map_err(|_|fail())?;
        if !metadata.is_dir() || metadata.file_type().is_symlink()
            || (metadata.uid()!=0 && metadata.uid()!=uid) { return Err(fail()); }
        let sticky_system_ancestor=metadata.uid()==0 && metadata.mode() & 0o1000!=0 && prefix!=parent;
        if metadata.mode() & 0o022!=0 && !sticky_system_ancestor { return Err(fail()); }
    }
    let directory=fs::symlink_metadata(parent).map_err(|_|fail())?;
    if directory.uid()!=uid { return Err(fail()); }
    match fs::symlink_metadata(path) {
        Err(error) if error.kind()==io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(fail()),
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink()
            && metadata.uid()==uid && metadata.nlink()==1 && metadata.mode() & 0o022==0 => Ok(()),
        _ => Err(fail()),
    }
}

// Available only to owned Linux/Unix test fixtures; no production fault selector.
#[cfg(all(test, unix))]
#[derive(Clone, Copy)]
pub(crate) enum TestFault { FileSync, DirectorySync }
#[cfg(all(test, unix))]
pub(crate) fn atomic_write_with_fault(path: &Path, bytes: &[u8], fault: TestFault) -> Result<Durability, PersistError> {
    let parent = path.parent().ok_or(PersistError { phase: "parent", cleanup_confirmed: true })?;
    let pending = parent.join(format!(".runtime-test-pending-{}", uuid::Uuid::new_v4()));
    let point = match fault { TestFault::FileSync => Point::FileSync, TestFault::DirectorySync => Point::DirectorySync };
    atomic_write_at(path, &pending, bytes, |boundary, _| {
        if boundary == point { Err(io::Error::new(io::ErrorKind::Other, "synthetic runtime boundary")) } else { Ok(()) }
    })
}

// Kept private: tests inject one failing boundary, all other operations use real FS.
fn atomic_write_at(
    path: &Path, temp: &Path, bytes: &[u8],
    mut boundary: impl FnMut(Point, &Path) -> io::Result<()>,
) -> Result<Durability, PersistError> {
    let fail = |phase| PersistError { phase, cleanup_confirmed: true };
    // This implementation guarantees mode and inode checks on Linux/macOS/Android.
    #[cfg(not(unix))]
    return Err(fail("unsupported_platform"));
    let parent = path.parent().ok_or_else(|| fail("parent"))?;
    if temp.parent() != Some(parent) { return Err(fail("temp_parent")); }
    boundary(Point::ParentOpen, temp).map_err(|_| fail("parent_open"))?;
    let directory = File::open(parent).map_err(|_| fail("parent_open"))?;
    if !directory.metadata().map_err(|_| fail("parent_metadata"))?.is_dir() { return Err(fail("parent_directory")); }
    let mut options = OpenOptions::new(); options.write(true).create_new(true);
    #[cfg(unix)]
    { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    // A failed create_new conveys no ownership, including name collisions.
    let output = options.open(temp).map_err(|_| fail("create"))?;
    let mut pending = Pending { path: temp.to_owned(), identity: output, committed: false };
    let before_commit = (|| -> Result<(), &'static str> {
        boundary(Point::Created, temp).map_err(|_| "created")?;
        let split = bytes.len() / 2;
        pending.identity.write_all(&bytes[..split]).map_err(|_| "write")?;
        boundary(Point::PartialWrite, temp).map_err(|_| "write")?;
        pending.identity.write_all(&bytes[split..]).map_err(|_| "write")?;
        boundary(Point::FileSync, temp).map_err(|_| "file_sync")?;
        pending.identity.sync_all().map_err(|_| "file_sync")?;
        boundary(Point::Rename, temp).map_err(|_| "rename")?;
        // Detect accidental replacement; the private directory is the trust boundary.
        // This check is not an adversarial atomic pathname lock.
        if !pending.still_owns_path() { return Err("temp_identity"); }
        fs::rename(temp, path).map_err(|_| "rename")?;
        Ok(())
    })();
    if let Err(phase) = before_commit {
        return Err(PersistError { phase, cleanup_confirmed: pending.cleanup() });
    }
    pending.committed = true;
    if boundary(Point::DirectorySync, temp).is_err() || directory.sync_all().is_err() {
        return Ok(Durability::CommittedUnknown);
    }
    Ok(Durability::Confirmed)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    struct Fixture { root: PathBuf, path: PathBuf, temp: PathBuf }
    impl Fixture {
        fn new() -> Self {
            // The verification launcher supplies an owned private TMPDIR.
            let root = std::env::temp_dir().join(format!("crewing635-private-store-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&root).unwrap();
            #[cfg(unix)]
            { use std::os::unix::fs::PermissionsExt; fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap(); }
            let path = root.join("synthetic-settings.json");
            let temp = root.join("synthetic-pending");
            fs::write(&path, br#"{"account":"old-synthetic"}"#).unwrap();
            Self { root, path, temp }
        }
        fn old(&self) { assert_eq!(fs::read(&self.path).unwrap(), br#"{"account":"old-synthetic"}"#); }
    }
    impl Drop for Fixture { fn drop(&mut self) { fs::remove_dir_all(&self.root).unwrap(); } }
    fn fault() -> io::Error { io::Error::new(io::ErrorKind::Other, "synthetic boundary failure") }
    const NEW: &[u8] = br#"{"account":"new-synthetic","private":"synthetic-only"}"#;

    #[test]
    fn native635_store_replaces_complete_json_with_private_mode() {
        let f = Fixture::new();
        assert_eq!(atomic_write(&f.path, NEW).unwrap(), Durability::Confirmed);
        let value: serde_json::Value = serde_json::from_slice(&fs::read(&f.path).unwrap()).unwrap();
        assert_eq!(value, serde_json::json!({"account":"new-synthetic", "private":"synthetic-only"}));
        #[cfg(unix)]
        { use std::os::unix::fs::PermissionsExt; assert_eq!(fs::metadata(&f.path).unwrap().permissions().mode() & 0o777, 0o600); }
        assert_eq!(fs::read_dir(&f.root).unwrap().count(), 1);
    }
    #[test]
    fn native635_store_name_collision_preserves_unowned_file() {
        let f = Fixture::new(); fs::write(&f.temp, b"existing synthetic marker").unwrap();
        let error = atomic_write_at(&f.path, &f.temp, NEW, |_, _| Ok(())).unwrap_err();
        assert_eq!(error.phase, "create"); assert!(error.cleanup_confirmed); f.old();
        assert_eq!(fs::read(&f.temp).unwrap(), b"existing synthetic marker");
    }
    #[test]
    fn native635_store_precommit_failures_preserve_target_and_clean_owned_temp() {
        for point in [Point::ParentOpen, Point::Created, Point::PartialWrite, Point::FileSync, Point::Rename] {
            let f = Fixture::new();
            let error = atomic_write_at(&f.path, &f.temp, NEW, |p, _| if p == point { Err(fault()) } else { Ok(()) }).unwrap_err();
            assert!(error.cleanup_confirmed, "{point:?}"); f.old(); assert!(!f.temp.exists(), "{point:?}");
        }
    }
    #[test]
    fn native635_store_directory_sync_failure_is_committed_unknown() {
        let f = Fixture::new();
        let outcome = atomic_write_at(&f.path, &f.temp, NEW, |p, _| if p == Point::DirectorySync { Err(fault()) } else { Ok(()) }).unwrap();
        assert_eq!(outcome, Durability::CommittedUnknown); assert_eq!(fs::read(&f.path).unwrap(), NEW); assert!(!f.temp.exists());
    }
    #[test]
    fn native635_store_real_rename_failure_preserves_directory_target() {
        let f = Fixture::new(); let directory_target = f.root.join("existing-dir"); fs::create_dir(&directory_target).unwrap();
        fs::write(directory_target.join("marker"), b"synthetic preserve").unwrap();
        let error = atomic_write_at(&directory_target, &f.temp, NEW, |_, _| Ok(())).unwrap_err();
        assert_eq!(error.phase, "rename"); assert!(error.cleanup_confirmed); assert!(!f.temp.exists());
        assert_eq!(fs::read(directory_target.join("marker")).unwrap(), b"synthetic preserve"); f.old();
    }
    #[cfg(unix)]
    #[test]
    fn native635_store_replaced_temp_cannot_commit_replacement_bytes() {
        let f = Fixture::new();
        let error = atomic_write_at(&f.path, &f.temp, NEW, |p, path| {
            if p == Point::Created { fs::remove_file(path)?; fs::write(path, b"replacement synthetic marker")?; }
            Ok(())
        }).unwrap_err();
        assert_eq!(error.phase, "temp_identity"); assert!(!error.cleanup_confirmed); f.old();
        assert_eq!(fs::read(&f.temp).unwrap(), b"replacement synthetic marker");
    }
    #[cfg(unix)]
    #[test]
    fn native635_store_replaced_temp_is_not_removed_by_cleanup() {
        let f = Fixture::new();
        let error = atomic_write_at(&f.path, &f.temp, NEW, |p, path| {
            if p == Point::Created { fs::remove_file(path)?; fs::write(path, b"replacement synthetic marker")?; return Err(fault()); }
            Ok(())
        }).unwrap_err();
        assert!(!error.cleanup_confirmed); f.old(); assert_eq!(fs::read(&f.temp).unwrap(), b"replacement synthetic marker");
    }
}

#[cfg(all(test, not(unix)))]
mod unsupported_tests {
    use super::*;
    #[test]
    fn native635_store_unsupported_platform_does_not_touch_paths() {
        let path = Path::new("never-created-synthetic-root/settings.json");
        let temp = Path::new("never-created-synthetic-root/pending");
        let error = atomic_write_at(path, temp, b"synthetic", |_, _| panic!("unsupported must not access filesystem")).unwrap_err();
        assert_eq!(error.phase, "unsupported_platform"); assert!(error.cleanup_confirmed);
    }
}
