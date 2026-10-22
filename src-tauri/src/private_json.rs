// Private Settings metadata only. Never use opaque members as authority or log them.
use serde::{Deserialize, Serialize, de::{self, DeserializeOwned, MapAccess, Visitor}, ser::SerializeMap};
use serde_json::value::{RawValue, to_raw_value};
use std::{collections::BTreeMap, fmt};

#[derive(Clone, Default)]
pub(crate) struct Object(BTreeMap<String, Box<RawValue>>);
impl Object {
    fn parse(raw: &RawValue, depth: usize) -> Result<Self, serde_json::Error> {
        if depth >= 128 { return Err(invalid()); }
        struct Members;
        impl<'de> Visitor<'de> for Members {
            type Value = Object;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result { f.write_str("private object") }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Object, A::Error> {
                let mut members = BTreeMap::new();
                while let Some(key) = map.next_key::<String>()? {
                    if members.contains_key(&key) { return Err(de::Error::custom("ambiguous private object")); }
                    members.insert(key, map.next_value::<Box<RawValue>>()?);
                }
                Ok(Object(members))
            }
        }
        let mut decoder = serde_json::Deserializer::from_str(raw.get());
        let object = serde::Deserializer::deserialize_map(&mut decoder, Members)?;
        decoder.end()?;
        for value in object.0.values() { validate(value, depth + 1)?; }
        Ok(object)
    }
    pub(crate) fn has(&self, key: &str) -> bool { self.0.contains_key(key) }
    pub(crate) fn required<T: DeserializeOwned>(&self, key: &str) -> Result<T, serde_json::Error> {
        serde_json::from_str(self.0.get(key).ok_or_else(invalid)?.get())
    }
    pub(crate) fn put<T: Serialize>(&mut self, key: &str, value: &T) -> Result<(), serde_json::Error> {
        self.0.insert(key.to_owned(), to_raw_value(value)?); Ok(())
    }
    pub(crate) fn remove(&mut self, key: &str) { self.0.remove(key); }
    // Only a serializer's explicit KNOWN fields may be supplied here. Reassert
    // their values last; preserve unknown children, never select authority from them.
    pub(crate) fn overlay<T: Serialize>(&mut self, known: &T) -> Result<(), serde_json::Error> {
        let incoming = Self::parse(&to_raw_value(known)?, 0)?;
        self.merge(incoming)
    }
    fn merge(&mut self, incoming: Object) -> Result<(), serde_json::Error> {
        for (key, value) in incoming.0 {
            let replacement = match self.0.get(&key) {
                Some(old) if old.get().trim_start().starts_with('{') && value.get().trim_start().starts_with('{') => {
                    let mut nested = Self::parse(old, 0)?;
                    nested.merge(Self::parse(&value, 0)?)?;
                    to_raw_value(&nested)?
                }
                _ => value,
            };
            self.0.insert(key, replacement);
        }
        Ok(())
    }
}
fn invalid() -> serde_json::Error { <serde_json::Error as de::Error>::custom("invalid private record") }
fn validate(raw: &RawValue, depth: usize) -> Result<(), serde_json::Error> {
    if depth >= 128 { return Err(invalid()); }
    match raw.get().trim_start().as_bytes().first() {
        Some(b'{') => { Object::parse(raw, depth)?; }
        Some(b'[') => {
            for item in serde_json::from_str::<Vec<Box<RawValue>>>(raw.get())? { validate(&item, depth + 1)?; }
        }
        _ => (), // RawValue already validates JSON syntax; no numeric conversion.
    }
    Ok(())
}
impl<'de> Deserialize<'de> for Object {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let raw = Box::<RawValue>::deserialize(d)?;
        Self::parse(&raw, 0).map_err(de::Error::custom)
    }
}
impl Serialize for Object {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (key, value) in &self.0 { map.serialize_entry(key, value)?; }
        map.end()
    }
}
