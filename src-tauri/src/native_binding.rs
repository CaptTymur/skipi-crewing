// Pure private reference envelope. Loading this type performs no DB/key file I/O.
// It proves local consistency only, never current authorization or historical ownership.
use super::{DatabaseReference, Owner, FileIdentity, current_uid};
use super::native_keys::KeyReference;
use crate::private_json::Object;
use serde::{Deserialize, Serialize, de, ser};

#[derive(Clone, Serialize, Deserialize)]
struct Known {
    version: u8,
    stable_uuid: String,
    database_ref: DatabaseReference,
    key_ref: KeyReference,
}
#[derive(Clone)]
pub(crate) struct Binding { known: Known, opaque: Object }
fn path_shape(path: &std::path::Path) -> bool {
    path.is_absolute() && path.to_str().is_some() && path.components().all(|c|
        matches!(c, std::path::Component::RootDir | std::path::Component::Normal(_)))
}
fn file_shape(file: &FileIdentity) -> bool { file.uid == current_uid() && file.inode != 0 }
impl Binding {
    pub(crate) fn stable_uuid(&self) -> &str { &self.known.stable_uuid }
    pub(crate) fn owner(&self) -> &Owner { &self.known.database_ref.owner }
    pub(crate) fn database_reference(&self) -> &DatabaseReference { &self.known.database_ref }
    pub(crate) fn key_reference(&self) -> &KeyReference { &self.known.key_ref }
    pub(crate) fn matches_prepared(&self, database: &DatabaseReference, key: &KeyReference) -> bool {
        self.validate().is_ok() && self.database_reference() == database && self.key_reference() == key
    }
    pub(crate) fn from_references(stable_uuid: String, database_ref: DatabaseReference, key_ref: KeyReference)
        -> Result<Self, &'static str> {
        let binding = Self { known: Known { version: 1, stable_uuid, database_ref, key_ref }, opaque: Object::default() };
        binding.validate()?; Ok(binding)
    }
    fn validate(&self) -> Result<(), &'static str> {
        let k = &self.known; let db = &k.database_ref;
        let uuid = uuid::Uuid::parse_str(&k.stable_uuid).map_err(|_| "invalid_binding")?;
        if k.version != 1 || uuid.get_version_num() != 4 || uuid.get_variant() != uuid::Variant::RFC4122
            || uuid.to_string() != k.stable_uuid
            || !crate::native_account::valid_id(&db.owner.account)
            || !crate::native_account::valid_id(&db.owner.company)
            || db.owner.context != k.stable_uuid || !path_shape(&db.root)
            || !file_shape(&db.root_identity) || !file_shape(&db.main_identity)
            || !k.key_ref.matches_binding_shape(&db.owner)
        { return Err("invalid_binding"); }
        Ok(())
    }
    pub(crate) fn matches_owner(&self, account: &str, company: &str) -> bool {
        self.validate().is_ok() && self.known.database_ref.owner.account == account
            && self.known.database_ref.owner.company == company
    }
}
impl<'de> Deserialize<'de> for Binding {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let opaque = Object::deserialize(d)?;
        let known = Known {
            version: opaque.required("version").map_err(de::Error::custom)?,
            stable_uuid: opaque.required("stable_uuid").map_err(de::Error::custom)?,
            database_ref: opaque.required("database_ref").map_err(de::Error::custom)?,
            key_ref: opaque.required("key_ref").map_err(de::Error::custom)?,
        };
        let binding = Self { known, opaque };
        binding.validate().map_err(de::Error::custom)?; Ok(binding)
    }
}
impl Serialize for Binding {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        self.validate().map_err(ser::Error::custom)?;
        let mut object = self.opaque.clone();
        object.overlay(&self.known).map_err(ser::Error::custom)?;
        object.serialize(s)
    }
}
impl std::fmt::Debug for Binding {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str("NativeBinding(<private>)") }
}
