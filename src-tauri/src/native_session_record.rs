// Private on-disk record; independent of network DTOs and public Settings.
use serde::{Deserialize, Serialize, de, ser};
use crate::{native_account::Entitlement, private_json::Object};
#[cfg(target_os = "linux")]
type LocalBinding = crate::db::native_database::native_binding::Binding;
#[cfg(not(target_os = "linux"))]
type LocalBinding = Object;

#[derive(Clone)]
enum Format { Old, V1(LocalBinding) }
#[derive(Clone)]
pub(crate) struct SessionRecord {
    pub account_id: String,
    pub app_credential: String,
    pub signed_out: bool,
    pub entitlement: Entitlement,
    format: Format,
    opaque: Object,
}
impl SessionRecord {
    pub(crate) fn new(account_id: String, app_credential: String, signed_out: bool, entitlement: Entitlement) -> Self {
        Self { account_id, app_credential, signed_out, entitlement, format: Format::Old, opaque: Object::default() }
    }
    #[cfg(target_os = "linux")]
    pub(crate) fn with_binding(mut self, binding: LocalBinding) -> Self { self.format = Format::V1(binding); self }
    #[cfg(target_os = "linux")]
    pub(crate) fn binding(&self) -> Option<&LocalBinding> {
        match &self.format { Format::V1(binding) => Some(binding), Format::Old => None }
    }
    pub(crate) fn has_binding(&self) -> bool { matches!(self.format, Format::V1(_)) }
    pub(crate) fn binding_matches(&self, company: &str) -> bool {
        match &self.format {
            Format::Old => true,
            #[cfg(target_os = "linux")]
            Format::V1(binding) => binding.matches_owner(&self.account_id, company),
            #[cfg(not(target_os = "linux"))]
            Format::V1(_) => { let _ = company; false }
        }
    }
    // The fingerprint is private and conservative: opaque metadata changes may
    // invalidate tickets too. Neither the digest nor these references reach UI.
    pub(crate) fn binding_identity(&self) -> Result<Vec<u8>, serde_json::Error> {
        match &self.format {
            Format::Old => Ok(Vec::new()),
            Format::V1(binding) => serde_json::to_vec(&(1u8, binding)),
        }
    }
}
impl<'de> Deserialize<'de> for SessionRecord {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let opaque = Object::deserialize(d)?;
        let format = match (opaque.has("record_version"), opaque.has("local_binding")) {
            (false, false) => Format::Old,
            (true, true) => {
                let version: u8 = opaque.required("record_version").map_err(de::Error::custom)?;
                if version != 1 { return Err(de::Error::custom("unsupported private record version")); }
                Format::V1(opaque.required("local_binding").map_err(de::Error::custom)?)
            }
            _ => return Err(de::Error::custom("incomplete private record")),
        };
        Ok(Self {
            account_id: opaque.required("account_id").map_err(de::Error::custom)?,
            app_credential: opaque.required("app_credential").map_err(de::Error::custom)?,
            signed_out: opaque.required("signed_out").map_err(de::Error::custom)?,
            entitlement: opaque.required("entitlement").map_err(de::Error::custom)?,
            format, opaque,
        })
    }
}
impl Serialize for SessionRecord {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut object = self.opaque.clone();
        object.put("account_id", &self.account_id).map_err(ser::Error::custom)?;
        object.put("app_credential", &self.app_credential).map_err(ser::Error::custom)?;
        object.put("signed_out", &self.signed_out).map_err(ser::Error::custom)?;
        #[derive(Serialize)]
        struct Grant<'a> { entitlement: &'a Entitlement }
        object.overlay(&Grant { entitlement: &self.entitlement }).map_err(ser::Error::custom)?;
        match &self.format {
            Format::Old => { object.remove("record_version"); object.remove("local_binding"); }
            Format::V1(binding) => {
                object.put("record_version", &1u8).map_err(ser::Error::custom)?;
                // Binding serializer itself retains opaque descriptor children.
                object.put("local_binding", binding).map_err(ser::Error::custom)?;
            }
        }
        object.serialize(s)
    }
}
impl std::fmt::Debug for SessionRecord {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str("SessionRecord(<private>)") }
}
