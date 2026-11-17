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


// A group-write bit is tolerated only when the object's group IS the caller's own
// effective primary group (Debian/Ubuntu user-private-group default, umask 002) and
// the object carries no other-write bit; other-write always refuses regardless of
// group ownership. This is the SHAPE check only - whether gid==egid actually names a
// single-member group is a separate, I/O-backed question (see group_write_admission
// below). Pure/no I/O so the shape is testable without chown.
#[cfg(target_os = "linux")]
fn own_private_group_write_tolerated(mode: u32, gid: libc::gid_t, egid: libc::gid_t) -> bool {
    mode & 0o002==0 && mode & 0o020!=0 && gid==egid
}

// No.1950 subject 2: `own_private_group_write_tolerated` assumes a UPG has no member
// but the caller - a fact about today's `/etc/group` that the shape check above never
// confirms. These three functions make the assumption checkable: two pure parsers over
// `/etc/group`/`/etc/passwd`-shaped text (testable with synthetic text, no root, no
// real group edits), and a thin production wrapper that reads the live files.

// Parses `/etc/group`-shaped text (name:passwd:gid:member1,member2,...) and returns the
// explicit supplementary member list for `gid`. `None` means `gid` was not found in
// this source; NSS resolved only through LDAP/NIS/sssd is a separate, unmeasured case
// and the caller fails closed on `None`.
#[cfg(target_os = "linux")]
fn group_file_members(text: &str, gid: libc::gid_t) -> Option<Vec<String>> {
    for line in text.lines() {
        let mut fields = line.split(':');
        let (Some(_name), Some(_passwd), Some(gid_field), Some(members)) =
            (fields.next(), fields.next(), fields.next(), fields.next()) else { continue };
        if gid_field.parse::<libc::gid_t>() == Ok(gid) {
            return Some(members.split(',').filter(|m| !m.is_empty()).map(str::to_owned).collect());
        }
    }
    None
}

// Parses `/etc/passwd`-shaped text (name:passwd:uid:gid:gecos:home:shell) and reports
// whether any account OTHER than `uid` carries `gid` as its PRIMARY group - the channel
// `group_file_members` above cannot see, since primary membership lives in passwd, not
// in the group file's member list.
#[cfg(target_os = "linux")]
fn passwd_file_has_other_primary_member(text: &str, gid: libc::gid_t, uid: libc::uid_t) -> bool {
    for line in text.lines() {
        let fields: Vec<&str> = line.split(':').collect();
        if fields.len() < 4 { continue; }
        let (Ok(pw_uid), Ok(pw_gid)) = (fields[2].parse::<libc::uid_t>(), fields[3].parse::<libc::gid_t>()) else { continue };
        if pw_gid == gid && pw_uid != uid { return true; }
    }
    false
}

// Combines both sources: the UPG tolerance only holds while `gid` is genuinely
// single-member - no supplementary member in the group file AND no other account's
// primary gid matching it. An unresolvable `gid` fails closed (not confirmed
// single-member), matching "unprovable ownership refuses".
#[cfg(target_os = "linux")]
fn single_member_group_from_sources(group_text: &str, passwd_text: &str, gid: libc::gid_t, uid: libc::uid_t) -> bool {
    match group_file_members(group_text, gid) {
        Some(members) if members.is_empty() => !passwd_file_has_other_primary_member(passwd_text, gid, uid),
        _ => false,
    }
}

// I/O: reads the live NSS flat files. NSS sources other than `/etc/group` and
// `/etc/passwd` (LDAP, NIS, sssd) are UNKNOWN here and are not consulted - a group
// resolved only through them reads as "not found" by single_member_group_from_sources
// and fails closed. An unreadable file also fails closed.
#[cfg(target_os = "linux")]
fn confirmed_single_member_group(gid: libc::gid_t, uid: libc::uid_t) -> bool {
    let group_text = match fs::read_to_string("/etc/group") { Ok(t) => t, Err(_) => return false };
    let passwd_text = match fs::read_to_string("/etc/passwd") { Ok(t) => t, Err(_) => return false };
    single_member_group_from_sources(&group_text, &passwd_text, gid, uid)
}

// The single admission call-sites use: narrows the pure shape check with the live
// membership confirmation. `own_private_group_write_tolerated` itself stays called from
// exactly this one place.
#[cfg(target_os = "linux")]
fn group_write_admission(mode: u32, gid: libc::gid_t, egid: libc::gid_t, uid: libc::uid_t) -> bool {
    own_private_group_write_tolerated(mode, gid, egid) && confirmed_single_member_group(gid, uid)
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
    let egid=unsafe { libc::getegid() };
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
        let own_private_group_write=group_write_admission(metadata.mode(), metadata.gid(), egid, uid);
        if metadata.mode() & 0o022!=0 && !sticky_system_ancestor && !own_private_group_write { return Err(fail()); }
    }
    let directory=fs::symlink_metadata(parent).map_err(|_|fail())?;
    if directory.uid()!=uid { return Err(fail()); }
    match fs::symlink_metadata(path) {
        Err(error) if error.kind()==io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(fail()),
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink()
            && metadata.uid()==uid && metadata.nlink()==1
            && (metadata.mode() & 0o022==0 || group_write_admission(metadata.mode(), metadata.gid(), egid, uid)) => Ok(()),
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

    // No.1947: a freshly created owner directory inherits mode 0o775 under the
    // Debian/Ubuntu default umask 002 (confirmed live on the owner's machine:
    // `stat -c '%u %g %a' ~/.config/skipi-crewing` -> 1000 1000 775, group `linux`
    // with no other member). Before the fix this refused with `settings_storage_error`
    // on a fully correct login; the directory here is created by the test itself (its
    // group is always the test process's own egid), never the owner's real directory.
    #[cfg(target_os = "linux")]
    #[test]
    fn native1947_destination_admits_owner_directory_with_group_write_bit() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("crewing1947-admission-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o775)).unwrap();
        let path = root.join("settings.json");
        let result = native_settings_destination(&path);
        fs::remove_dir_all(&root).unwrap();
        assert!(result.is_ok(), "0o775 owner-created directory must admit: {:?}", result);
    }

    // Other-write refuses regardless of group ownership, even though the directory's
    // group is still the test process's own egid - the UPG exception never covers 0o002.
    #[cfg(target_os = "linux")]
    #[test]
    fn native1947_destination_still_refuses_world_writable_owner_directory() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("crewing1947-admission-world-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o777)).unwrap();
        let path = root.join("settings.json");
        let result = native_settings_destination(&path);
        fs::remove_dir_all(&root).unwrap();
        assert!(result.is_err(), "0o777 (other-write) must still refuse: {:?}", result);
    }

    // Pure boundary table for the extracted predicate: proves the exception is scoped
    // to "group-write only, and the group IS my own egid" and nothing wider. A fixture
    // directory can't portably carry a gid different from the creating process's own
    // egid without extra OS privilege, so the "shared, non-own group" arm is checked
    // here directly rather than by chown.
    #[cfg(target_os = "linux")]
    #[test]
    fn native1947_own_private_group_write_tolerated_boundary_table() {
        assert!(own_private_group_write_tolerated(0o775, 1000, 1000), "own-gid group-write only must admit");
        assert!(!own_private_group_write_tolerated(0o777, 1000, 1000), "other-write must still refuse even at own gid");
        assert!(!own_private_group_write_tolerated(0o775, 2000, 1000), "a shared/foreign group must still refuse");
        assert!(!own_private_group_write_tolerated(0o755, 1000, 1000), "no write bits set is not the tolerated case");
    }

    // No.1950 subject 1: a settings.json written by code that never set an explicit
    // mode (or carried over by rsync/cp -p from another machine) lands at 0o664 under
    // the Debian/Ubuntu default umask 002 - the owner directory admission tolerates
    // this shape (No.1947) but the EXISTING FILE branch (native_destination, the
    // `fs::symlink_metadata(path)` match) never consulted the same predicate. Before
    // the fix this refuses `settings_storage_error` on a file that is otherwise fully
    // owned, single-linked and group-writable only by the caller's own UPG.
    #[cfg(target_os = "linux")]
    #[test]
    fn native1950_destination_admits_existing_file_with_own_group_write_bit() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("crewing1950-file-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let path = root.join("settings.json");
        fs::write(&path, br#"{"account":"synthetic-existing"}"#).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o664)).unwrap();
        let result = native_settings_destination(&path);
        fs::remove_dir_all(&root).unwrap();
        assert!(result.is_ok(), "existing file with own-group write bit must admit: {:?}", result);
    }

    // No.1950 subject 2: `own_private_group_write_tolerated`'s "UPG has no other
    // member" premise is checked here against synthetic `/etc/group`/`/etc/passwd`
    // text, not the real OS state - no root or real group edits needed. The "own
    // group, two members" case the (1947) boundary table could not cover: a second
    // account sharing the gid as its PRIMARY group (passwd, not the group file's
    // member list) must still refuse, exactly as a supplementary member must.
    #[cfg(target_os = "linux")]
    #[test]
    fn native1950_single_member_group_from_sources_boundary_table() {
        let group = "linux:x:1000:\nother:x:2000:someone-else\n";
        let passwd_solo = "linux:x:1000:1000:Linux User:/home/linux:/bin/bash\n";
        let passwd_shared_primary = "linux:x:1000:1000:Linux User:/home/linux:/bin/bash\nvisitor:x:1001:1000:Visitor:/home/visitor:/bin/bash\n";
        let group_with_supplementary = "linux:x:1000:visitor\n";

        assert!(single_member_group_from_sources(group, passwd_solo, 1000, 1000),
            "sole UPG member, no supplementary, no shared primary -> must confirm single-member");
        assert!(!single_member_group_from_sources(group_with_supplementary, passwd_solo, 1000, 1000),
            "a supplementary member in the group file must refuse confirmation");
        assert!(!single_member_group_from_sources(group, passwd_shared_primary, 1000, 1000),
            "own group, two members: another account's PRIMARY gid matching ours must refuse confirmation");
        assert!(!single_member_group_from_sources(group, passwd_solo, 9999, 1000),
            "a gid absent from the group source is unresolved and fails closed");
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
