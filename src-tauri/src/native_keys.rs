// UNUSED Linux foundation. Caller owns a stable private namespace and Runtime
// write gate. No startup/commands/crypto consumers or server registration call it.
// Local references are NOT server/historical company-key attestations.
use super::{Namespace, Owner, FileIdentity, identity, current_uid};
use std::{fs::{self, File, OpenOptions}, io::{self, Read, Write}, path::{Path, PathBuf}};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use crypto_box::SecretKey;
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use base64::Engine;
use crate::messaging::{SK_FILENAME, derive_user_id, MyIdentity};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Error { UnsupportedNamespace, MissingKey, MalformedKey, IdentityMismatch,
    ReferenceMismatch, ReadFailed, NonEmptyFreshNamespace, CreateFailed, Collision }
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
enum LocalOrigin { Fresh, LegacySnapshot }
// Never serialize raw secret material. This entire descriptor stays in private
// Settings, atomically with account/company/DB/context refs, before consumers.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct KeyReference {
    version: u8, owner: Owner, root: PathBuf, root_identity: FileIdentity,
    key_identity: FileIdentity, raw_key_sha256: String, public_key_b64: String,
    user_id: String, local_origin: LocalOrigin,
}
impl std::fmt::Debug for KeyReference {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str("KeyReference(<private>)") }
}
impl KeyReference {
    pub(crate) fn namespace(&self) -> Result<Namespace, Error> {
        let namespace=Namespace::inspect(&self.root).map_err(|_| Error::UnsupportedNamespace)?;
        if namespace.root_identity != self.root_identity { return Err(Error::IdentityMismatch); }
        Ok(namespace)
    }
    // Pure descriptor checks only; callers still need load_stored/live validation.
    // The owner and secret/public fingerprints never leave this private module.
    pub(super) fn matches_binding_shape(&self, owner: &Owner) -> bool {
        let canonical_path = self.root.is_absolute() && self.root.to_str().is_some()
            && self.root.components().all(|c| matches!(c, std::path::Component::RootDir | std::path::Component::Normal(_)));
        let public = match base64::engine::general_purpose::STANDARD.decode(&self.public_key_b64) {
            Ok(bytes) if bytes.len() == 32 => bytes,
            _ => return false,
        };
        let mut full = [0u8; 32]; full.copy_from_slice(&public);
        self.version == 1 && &self.owner == owner && canonical_path
            && self.root_identity.uid == current_uid() && self.key_identity.uid == current_uid()
            && self.root_identity.inode != 0 && self.key_identity.inode != 0
            && self.raw_key_sha256.len() == 64
            && self.raw_key_sha256.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            && base64::engine::general_purpose::STANDARD.encode(&full) == self.public_key_b64
            && derive_user_id(&full) == self.user_id
    }
}
pub(crate) struct UnpublishedKey { reference: KeyReference, raw: [u8; 32] }
impl UnpublishedKey {
    pub(crate) fn validate_live(&self) -> Result<(), Error> {
        let namespace=self.reference.namespace()?;
        let loaded=load_stored(&namespace,&self.reference.owner,&self.reference)?;
        if loaded.raw != self.raw { return Err(Error::IdentityMismatch); }
        Ok(())
    }
    pub(crate) fn reference(&self) -> KeyReference { self.reference.clone() }
    pub(crate) fn public_identity(&self) -> MyIdentity {
        MyIdentity { user_id: self.reference.user_id.clone(), pubkey_b64: self.reference.public_key_b64.clone() }
    }
    // Deliberately no secret getter / active crypto API until coherent Runtime,
    // SessionRecord and server current-registration guards are integrated.
}
impl std::fmt::Debug for UnpublishedKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str("UnpublishedKey(<private>)") }
}
// crypto_box 0.9.1 zeroizes its scalar only; raw bytes/copies may remain. No global
// memory erasure claim. Logout privacy requires Runtime/private-resource closure.

fn namespace_ok(namespace: &Namespace) -> Result<(), Error> {
    namespace.verify().map_err(|_| Error::UnsupportedNamespace)
}
fn secret_metadata(path: &Path) -> Result<fs::Metadata, Error> {
    let metadata = fs::symlink_metadata(path).map_err(|error| if error.kind()==io::ErrorKind::NotFound {
        Error::MissingKey
    } else { Error::ReadFailed })?;
    validate_secret_metadata(&metadata)?;
    Ok(metadata)
}
fn validate_secret_kind_mode(metadata: &fs::Metadata) -> Result<(), Error> {
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.nlink()!=1
        || metadata.uid()!=current_uid() || metadata.mode() & 0o7777 != 0o600 {
        return Err(Error::UnsupportedNamespace);
    }
    Ok(())
}
fn validate_secret_metadata(metadata: &fs::Metadata) -> Result<(), Error> {
    validate_secret_kind_mode(metadata)?;
    if metadata.len()!=32 { return Err(Error::MalformedKey); }
    Ok(())
}
fn read_exact_key(namespace: &Namespace) -> Result<([u8; 32], FileIdentity), Error> {
    namespace_ok(namespace)?;
    let path = namespace.root.join(SK_FILENAME);
    let expected = identity(&secret_metadata(&path)?);
    let mut file = OpenOptions::new().read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC)
        .open(&path).map_err(|_| Error::ReadFailed)?;
    let metadata = file.metadata().map_err(|_| Error::ReadFailed)?;
    validate_secret_metadata(&metadata)?;
    if identity(&metadata)!=expected { return Err(Error::IdentityMismatch); }
    let mut raw = [0u8; 32]; file.read_exact(&mut raw).map_err(|_| Error::ReadFailed)?;
    let mut extra = [0u8; 1];
    if file.read(&mut extra).map_err(|_| Error::ReadFailed)? != 0 { return Err(Error::MalformedKey); }
    let after = file.metadata().map_err(|_| Error::ReadFailed)?;
    validate_secret_metadata(&after)?;
    if identity(&after)!=expected { return Err(Error::IdentityMismatch); }
    namespace_ok(namespace)?;
    if identity(&secret_metadata(&path)?)!=expected { return Err(Error::IdentityMismatch); }
    Ok((raw, expected))
}
fn reference(namespace: &Namespace, owner: Owner, key_identity: FileIdentity,
    raw: &[u8; 32], local_origin: LocalOrigin) -> KeyReference {
    let key = SecretKey::from_bytes(*raw); let public = key.public_key();
    KeyReference { version: 1, owner, root: namespace.root.clone(), root_identity: namespace.root_identity,
        key_identity, raw_key_sha256: format!("{:x}", Sha256::digest(raw)),
        public_key_b64: base64::engine::general_purpose::STANDARD.encode(public.as_bytes()),
        user_id: derive_user_id(public.as_bytes()), local_origin }
}
// Only the already-connected saved legacy company after independent account
// ownership proof. Snapshot alone cannot authorize conversion or publication.
pub(crate) fn inspect_legacy_snapshot(namespace: &Namespace, owner: Owner,
    saved_company: &str) -> Result<UnpublishedKey, Error> {
    if !crate::native_account::valid_id(saved_company) || saved_company!=owner.company {
        return Err(Error::ReferenceMismatch);
    }
    let (raw, key_identity) = read_exact_key(namespace)?;
    Ok(UnpublishedKey { reference: reference(namespace, owner, key_identity, &raw, LocalOrigin::LegacySnapshot), raw })
}
pub(crate) fn load_stored(namespace: &Namespace, owner: &Owner,
    saved: &KeyReference) -> Result<UnpublishedKey, Error> {
    if saved.version!=1 || &saved.owner!=owner || saved.root!=namespace.root
        || saved.root_identity!=namespace.root_identity { return Err(Error::ReferenceMismatch); }
    namespace_ok(namespace)?;
    // Deny a foreign/replaced inode BEFORE reading any secret material.
    if identity(&secret_metadata(&namespace.root.join(SK_FILENAME))?)!=saved.key_identity {
        return Err(Error::IdentityMismatch);
    }
    let (raw, key_identity) = read_exact_key(namespace)?;
    let observed = reference(namespace, owner.clone(), key_identity, &raw, saved.local_origin.clone());
    // Public identity alone is insufficient: clamping permits raw-byte changes
    // with identical public key/user_id. The PRIVATE raw fingerprint must match.
    if &observed!=saved { return Err(Error::ReferenceMismatch); }
    Ok(UnpublishedKey { reference: observed, raw })
}

// An error after create_new is an owned NEW unreferenced artifact, never a claim
// that nothing was written. No deletion/retry/chmod/legacy-key migration API.
pub(crate) struct CreationError {
    pub code: Error, pub created: bool, pub phase: &'static str,
    owned_identity: Option<FileIdentity>,
}
impl std::fmt::Debug for CreationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("KeyCreationError").field("code", &self.code)
            .field("created", &self.created).field("phase", &self.phase).finish()
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum Point { Created, PartialWrite, FileSync, DirectorySync }
pub(crate) fn prepare_fresh(namespace: &Namespace, owner: Owner) -> Result<UnpublishedKey, CreationError> {
    prepare_fresh_at(namespace, owner, || SecretKey::generate(&mut OsRng).to_bytes(), |_| Ok(()))
}
// Private boundary seam: fixed bytes and faults are available only to this
// module's owned tests; no public transport/command/environment fault switch.
fn prepare_fresh_at(namespace: &Namespace, owner: Owner, generate: impl FnOnce()->[u8; 32],
    mut boundary: impl FnMut(Point)->io::Result<()>) -> Result<UnpublishedKey, CreationError> {
    let before = |code, phase| CreationError { code, created: false, phase, owned_identity: None };
    namespace_ok(namespace).map_err(|error| before(error, "namespace"))?;
    let mut entries = fs::read_dir(&namespace.root).map_err(|_| before(Error::ReadFailed, "namespace_entries"))?;
    match entries.next() {
        Some(Ok(_)) => return Err(before(Error::NonEmptyFreshNamespace, "namespace_not_empty")),
        Some(Err(_)) => return Err(before(Error::ReadFailed, "namespace_entries")),
        None => (),
    }
    let raw = generate();
    let path = namespace.root.join(SK_FILENAME);
    let mut file = OpenOptions::new().write(true).create_new(true).mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC)
        .open(&path).map_err(|error| before(if error.kind()==io::ErrorKind::AlreadyExists { Error::Collision } else { Error::CreateFailed }, "create"))?;
    let metadata = file.metadata().map_err(|_| CreationError { code: Error::CreateFailed,
        created: true, phase: "created_metadata", owned_identity: None })?;
    let owned_identity = Some(identity(&metadata));
    let failed = |code, phase| CreationError { code, created: true, phase, owned_identity };
    let result = (|| {
        // Confirm the newly opened FD before the first secret write. A metadata
        // error still means a new artifact exists, never a false no-effect result.
        validate_secret_kind_mode(&metadata).map_err(|error| failed(error, "created_metadata"))?;
        if metadata.len()!=0 { return Err(failed(Error::IdentityMismatch, "created_metadata")); }
        boundary(Point::Created).map_err(|_| failed(Error::CreateFailed, "created"))?;
        file.write_all(&raw[..16]).map_err(|_| failed(Error::CreateFailed, "write"))?;
        boundary(Point::PartialWrite).map_err(|_| failed(Error::CreateFailed, "write"))?;
        file.write_all(&raw[16..]).map_err(|_| failed(Error::CreateFailed, "write"))?;
        boundary(Point::FileSync).map_err(|_| failed(Error::CreateFailed, "file_sync"))?;
        file.sync_all().map_err(|_| failed(Error::CreateFailed, "file_sync"))?;
        let metadata = file.metadata().map_err(|_| failed(Error::CreateFailed, "file_metadata"))?;
        validate_secret_metadata(&metadata).map_err(|error| failed(error, "file_metadata"))?;
        if Some(identity(&metadata))!=owned_identity { return Err(failed(Error::IdentityMismatch, "file_identity")); }
        namespace_ok(namespace).map_err(|error| failed(error, "namespace_identity"))?;
        if Some(identity(&secret_metadata(&path).map_err(|error| failed(error, "path_metadata"))?))!=owned_identity {
            return Err(failed(Error::IdentityMismatch, "path_identity"));
        }
        let directory = File::open(&namespace.root).map_err(|_| failed(Error::CreateFailed, "directory_open"))?;
        if identity(&directory.metadata().map_err(|_| failed(Error::CreateFailed, "directory_metadata"))?)!=namespace.root_identity {
            return Err(failed(Error::IdentityMismatch, "directory_identity"));
        }
        boundary(Point::DirectorySync).map_err(|_| failed(Error::CreateFailed, "directory_sync"))?;
        directory.sync_all().map_err(|_| failed(Error::CreateFailed, "directory_sync"))?;
        Ok(())
    })();
    drop(file);
    result?;
    let saved = reference(namespace, owner.clone(), owned_identity.ok_or_else(|| failed(Error::IdentityMismatch, "created_identity"))?, &raw, LocalOrigin::Fresh);
    load_stored(namespace, &owner, &saved).map_err(|error| failed(error, "read_back"))
}

#[cfg(test)]
mod tests {
use super::*;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::collections::BTreeMap;
// Published RFC 7748 section6.1 test data, NEVER an actual user's private key.
// https://www.rfc-editor.org/rfc/rfc7748.html#section-6.1
fn synthetic_raw() -> [u8; 32] {
    let text = "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a";
    let mut raw = [0u8; 32];
    for (index, byte) in raw.iter_mut().enumerate() { *byte = u8::from_str_radix(&text[2*index..2*index+2],16).unwrap(); }
    raw
}
fn owner() -> Owner {
    Owner::from_validated_binding("key-fixture-account".into(), "key-fixture-company".into(), "00000000-0000-4000-8000-000000000635".into()).unwrap()
}
struct Fixture { root: PathBuf, keys: PathBuf }
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("crewing635-native-key-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap(); fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let keys = root.join("keys"); fs::create_dir(&keys).unwrap(); fs::set_permissions(&keys, fs::Permissions::from_mode(0o700)).unwrap();
        Self { root, keys }
    }
    fn namespace(&self) -> Namespace { Namespace::inspect(&self.keys).unwrap() }
    fn path(&self) -> PathBuf { self.keys.join(SK_FILENAME) }
    fn write(&self, bytes: &[u8]) {
        fs::write(self.path(), bytes).unwrap(); fs::set_permissions(self.path(), fs::Permissions::from_mode(0o600)).unwrap();
    }
    fn snapshot(&self) -> BTreeMap<String,String> {
        fs::read_dir(&self.keys).unwrap().map(|entry| { let entry=entry.unwrap();
            assert!(entry.file_type().unwrap().is_file());
            (entry.file_name().into_string().unwrap(),format!("{:x}",Sha256::digest(fs::read(entry.path()).unwrap())))
        }).collect()
    }
}
impl Drop for Fixture { fn drop(&mut self) { fs::remove_dir_all(&self.root).unwrap(); } }
#[test]
fn native635_key_legacy_snapshot_retains_bytes_inode_path_and_legacy_public_wire_vector() {
    let f=Fixture::new(); f.write(&synthetic_raw()); let before=f.snapshot(); let id=identity(&fs::metadata(f.path()).unwrap());
    let material=inspect_legacy_snapshot(&f.namespace(),owner(),"key-fixture-company").unwrap();
    assert!(material.raw==synthetic_raw()); assert!(material.reference.local_origin==LocalOrigin::LegacySnapshot);
    assert_eq!(material.public_identity().pubkey_b64,"hSDwCYkwp1R0i33ctD73Wg2/Og0mOBr066SpjqqbTmo=");
    assert_eq!(material.public_identity().user_id,"gagjzfqdxevewopn");
    assert_eq!(f.snapshot(),before); assert!(identity(&fs::metadata(f.path()).unwrap())==id);
}
#[test]
fn native635_key_missing_load_does_not_create_regenerate_or_make_a_directory() {
    let f=Fixture::new(); assert_eq!(inspect_legacy_snapshot(&f.namespace(),owner(),"key-fixture-company").unwrap_err(),Error::MissingKey);
    assert!(f.snapshot().is_empty()); assert!(!f.path().exists());
}
#[test]
fn native635_key_malformed_length_load_does_not_replace_or_repair() {
    for bytes in [vec![],vec![7;31],vec![7;33],vec![7;4096]] {
        let f=Fixture::new(); f.write(&bytes); let before=f.snapshot(); let id=identity(&fs::metadata(f.path()).unwrap());
        assert_eq!(inspect_legacy_snapshot(&f.namespace(),owner(),"key-fixture-company").unwrap_err(),Error::MalformedKey);
        assert_eq!(f.snapshot(),before); assert!(identity(&fs::metadata(f.path()).unwrap())==id);
    }
}
#[test]
fn native635_key_group_or_other_access_is_denied_without_chmod() {
    for mode in [0o644,0o640,0o660,0o604,0o4600] {
        let f=Fixture::new(); f.write(&synthetic_raw()); fs::set_permissions(f.path(),fs::Permissions::from_mode(mode)).unwrap();
        assert_eq!(inspect_legacy_snapshot(&f.namespace(),owner(),"key-fixture-company").unwrap_err(),Error::UnsupportedNamespace);
        assert_eq!(fs::metadata(f.path()).unwrap().mode()&0o7777,mode);
        assert_eq!(fs::read(f.path()).unwrap(),synthetic_raw());
    }
}
#[test]
fn native635_key_symlink_fifo_and_hardlink_are_denied_without_follow_or_read() {
    let f=Fixture::new(); let outside=f.root.join("owned-target"); fs::write(&outside,synthetic_raw()).unwrap();
    symlink(&outside,f.path()).unwrap(); assert_eq!(inspect_legacy_snapshot(&f.namespace(),owner(),"key-fixture-company").unwrap_err(),Error::UnsupportedNamespace);
    assert_eq!(fs::read(&outside).unwrap(),synthetic_raw()); fs::remove_file(f.path()).unwrap();
    let name=std::ffi::CString::new(f.path().to_str().unwrap()).unwrap();
    assert_eq!(unsafe {libc::mkfifo(name.as_ptr(),0o600)},0);
    assert_eq!(inspect_legacy_snapshot(&f.namespace(),owner(),"key-fixture-company").unwrap_err(),Error::UnsupportedNamespace); fs::remove_file(f.path()).unwrap();
    f.write(&synthetic_raw()); fs::hard_link(f.path(),f.root.join("same-inode")).unwrap();
    assert_eq!(inspect_legacy_snapshot(&f.namespace(),owner(),"key-fixture-company").unwrap_err(),Error::UnsupportedNamespace);
}
#[test]
fn native635_key_wrong_owner_or_saved_company_denies_before_secret_read() {
    let f=Fixture::new(); f.write(&synthetic_raw());
    let saved=inspect_legacy_snapshot(&f.namespace(),owner(),"key-fixture-company").unwrap().reference();
    fs::remove_file(f.path()).unwrap();
    for changed in [Owner {account:"other-account".into(),..owner()},Owner {company:"other-company".into(),..owner()},Owner {context:uuid::Uuid::new_v4().to_string(),..owner()}] {
        assert_eq!(load_stored(&f.namespace(),&changed,&saved).unwrap_err(),Error::ReferenceMismatch);
    }
    assert_eq!(inspect_legacy_snapshot(&f.namespace(),owner(),"other-company").unwrap_err(),Error::ReferenceMismatch);
    assert!(f.snapshot().is_empty());
}
#[test]
fn native635_key_matching_saved_reference_reloads_same_private_bytes() {
    let f=Fixture::new(); f.write(&synthetic_raw()); let ns=f.namespace();
    let saved=inspect_legacy_snapshot(&ns,owner(),"key-fixture-company").unwrap().reference();
    let encoded=serde_json::to_vec(&saved).unwrap(); let decoded=serde_json::from_slice::<KeyReference>(&encoded).unwrap();
    let loaded=load_stored(&ns,&owner(),&decoded).unwrap(); assert!(loaded.raw==synthetic_raw()); assert!(loaded.reference()==saved);
    let value:serde_json::Value=serde_json::from_slice(&encoded).unwrap(); assert!(value.get("raw").is_none());
    assert_eq!(format!("{:?}",loaded),"UnpublishedKey(<private>)"); assert_eq!(format!("{:?}",saved),"KeyReference(<private>)");
}
#[test]
fn native635_key_replaced_inode_with_same_bytes_is_refused_before_adoption() {
    let f=Fixture::new(); f.write(&synthetic_raw()); let ns=f.namespace();
    let saved=inspect_legacy_snapshot(&ns,owner(),"key-fixture-company").unwrap().reference();
    fs::rename(f.path(),f.root.join("old-key")).unwrap(); f.write(&synthetic_raw());
    assert_eq!(load_stored(&ns,&owner(),&saved).unwrap_err(),Error::IdentityMismatch);
    assert_eq!(fs::read(f.path()).unwrap(),synthetic_raw()); assert_eq!(fs::read(f.root.join("old-key")).unwrap(),synthetic_raw());
}
#[test]
fn native635_key_ignored_clamping_bit_change_same_public_identity_is_still_refused() {
    let f=Fixture::new(); f.write(&synthetic_raw()); let ns=f.namespace();
    let saved=inspect_legacy_snapshot(&ns,owner(),"key-fixture-company").unwrap().reference();
    let mut changed=synthetic_raw(); changed[0]^=1;
    assert_eq!(SecretKey::from_bytes(changed).public_key().as_bytes(),SecretKey::from_bytes(synthetic_raw()).public_key().as_bytes());
    f.write(&changed); assert!(identity(&fs::metadata(f.path()).unwrap())==saved.key_identity);
    assert_eq!(load_stored(&ns,&owner(),&saved).unwrap_err(),Error::ReferenceMismatch);
    assert_eq!(fs::read(f.path()).unwrap(),changed);
}
#[test]
fn native635_key_fresh_create_new_is_private_and_reloadable_without_legacy_path_access() {
    let f=Fixture::new(); let ns=f.namespace(); let key=prepare_fresh(&ns,owner()).unwrap();
    assert!(key.reference.local_origin==LocalOrigin::Fresh); assert_eq!(fs::metadata(f.path()).unwrap().mode()&0o7777,0o600);
    assert_eq!(fs::read(f.path()).unwrap(),key.raw); assert_eq!(key.public_identity().user_id.len(),16);
    let loaded=load_stored(&ns,&owner(),&key.reference()).unwrap(); assert!(loaded.raw==key.raw);
    assert!(loaded.reference()==key.reference()); assert_eq!(f.snapshot().len(),1);
}
#[test]
fn native635_key_fresh_nonempty_existing_key_and_dangling_symlink_never_overwrite_or_generate() {
    let f=Fixture::new(); f.write(&synthetic_raw()); let before=f.snapshot();
    let error=prepare_fresh_at(&f.namespace(),owner(),||panic!("generation must not run"),|_|Ok(())).unwrap_err();
    assert!(!error.created); assert_eq!(error.code,Error::NonEmptyFreshNamespace); assert_eq!(f.snapshot(),before);
    fs::remove_file(f.path()).unwrap(); symlink(f.root.join("absent-synthetic-target"),f.path()).unwrap();
    let error=prepare_fresh_at(&f.namespace(),owner(),||panic!("generation must not run"),|_|Ok(())).unwrap_err();
    assert!(!error.created); assert_eq!(error.code,Error::NonEmptyFreshNamespace); assert!(f.path().is_symlink());
    assert!(!f.root.join("absent-synthetic-target").exists());
}
#[test]
fn native635_key_fresh_failures_report_owned_unreferenced_artifact_and_never_retry_over_it() {
    for (point,phase,length) in [(Point::Created,"created",0),(Point::PartialWrite,"write",16),(Point::FileSync,"file_sync",32),(Point::DirectorySync,"directory_sync",32)] {
        let f=Fixture::new(); let ns=f.namespace();
        let error=prepare_fresh_at(&ns,owner(),synthetic_raw,|at| if at==point {Err(io::Error::new(io::ErrorKind::Other,"synthetic key boundary"))} else {Ok(())}).unwrap_err();
        assert!(error.created); assert_eq!(error.phase,phase); assert!(error.owned_identity==Some(identity(&fs::metadata(f.path()).unwrap())));
        assert_eq!(fs::metadata(f.path()).unwrap().len(),length); let before=f.snapshot();
        let second=prepare_fresh_at(&ns,owner(),||panic!("no blind generation/retry"),|_|Ok(())).unwrap_err();
        assert!(!second.created); assert_eq!(second.code,Error::NonEmptyFreshNamespace); assert_eq!(f.snapshot(),before);
    }
}
#[test]
fn native635_key_created_path_substitution_is_reported_without_deleting_either_inode() {
    let f=Fixture::new(); let ns=f.namespace(); let moved=f.root.join("owned-created-key"); let replacement=[42u8;32];
    let error=prepare_fresh_at(&ns,owner(),synthetic_raw,|point| {
        if point==Point::Created {fs::rename(f.path(),&moved)?; fs::write(f.path(),replacement)?; fs::set_permissions(f.path(),fs::Permissions::from_mode(0o600))?;}
        Ok(())
    }).unwrap_err();
    assert!(error.created); assert_eq!(error.code,Error::IdentityMismatch); assert_eq!(error.phase,"path_identity");
    assert!(error.owned_identity==Some(identity(&fs::metadata(&moved).unwrap())));
    assert_eq!(fs::read(&moved).unwrap(),synthetic_raw()); assert_eq!(fs::read(f.path()).unwrap(),replacement);
}
#[test]
fn native635_key_replaced_or_group_writable_namespace_never_adopts_key() {
    let f=Fixture::new(); f.write(&synthetic_raw()); let ns=f.namespace();
    let saved=inspect_legacy_snapshot(&ns,owner(),"key-fixture-company").unwrap().reference();
    fs::rename(&f.keys,f.root.join("old-keys")).unwrap(); fs::create_dir(&f.keys).unwrap(); f.write(&[42;32]);
    assert_eq!(load_stored(&ns,&owner(),&saved).unwrap_err(),Error::UnsupportedNamespace); assert_eq!(fs::read(f.path()).unwrap(),[42;32]);
    fs::set_permissions(&f.keys,fs::Permissions::from_mode(0o770)).unwrap(); assert!(Namespace::inspect(&f.keys).is_err());
    fs::set_permissions(&f.keys,fs::Permissions::from_mode(0o700)).unwrap();
}
}
