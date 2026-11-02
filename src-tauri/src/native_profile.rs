//! Pure V4 wire decoding, not authorization or an import/apply decision.
//! EmailStr parity is deliberately UNIMPLEMENTED: contact_email is retained
//! losslessly after only string/nonempty/max120 checks. A decoded response MUST
//! NOT be treated as a fully validated V4 profile or used to activate/apply it.
//! No Settings conversion, null-to-empty conversion, HTTP, persistence or UI.
use chrono::DateTime;
use serde::Deserialize;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ProfileDecodeError {
    InvalidResponse,
    IdentityMismatch,
}

pub(crate) struct ExpectedProfileIdentity<'a> {
    pub account_id: &'a str,
    pub crewing_id: &'a str,
    pub organization_id: Option<&'a str>,
}

// Intentionally no Debug/Serialize: profile/contact values are not log payloads.
pub(crate) struct ProfileReadDecoded {
    pub wire: ProfileReadWire,
    // Derived comparison value only; null remains None until a later accepted import.
    pub mlc_utc_date: Option<String>,
}

// No.623 (1624): без deny_unknown_fields. Правило дома — «DTO терпят неизвестные
// поля»; по ARCH-017 сервер является источником данных, и добавленное им поле не
// должно ронять разбор у клиента прежней версии. Обязательность КАЖДОГО известного
// поля сохранена (required_nullable), дубликаты и обрезанный JSON по-прежнему отказ.
#[derive(Deserialize)]
pub(crate) struct ProfileReadWire {
    pub schema_version: u32,
    pub account_id: String,
    pub crewing_id: String,
    #[serde(deserialize_with = "required_nullable")]
    pub organization_id: Option<String>,
    pub profile: ProfileWire,
}

#[derive(Deserialize)]
pub(crate) struct ProfileWire {
    pub display_name: String,
    #[serde(deserialize_with = "required_nullable")]
    pub legal_name: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub jurisdiction: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub registration_number: Option<String>,
    // GAP: not EmailStr-validated by this decoder.
    pub contact_email: String,
    #[serde(deserialize_with = "required_nullable")]
    pub contact_phone: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub mlc_cert_number: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub mlc_cert_valid_to: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub slug: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub public_description: Option<String>,
    pub mlc_certified: bool,
    pub verified_level: VerificationLevel,
    pub created_at: String,
}

#[derive(PartialEq, Eq)]
pub(crate) enum VerificationLevel {
    Pending,
    EmailVerified,
    CompanyVerified,
    IndustryVerified,
}

impl<'de> Deserialize<'de> for VerificationLevel {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where D: serde::Deserializer<'de> {
        match String::deserialize(deserializer)?.as_str() {
            "pending" => Ok(Self::Pending),
            "email_verified" => Ok(Self::EmailVerified),
            "company_verified" => Ok(Self::CompanyVerified),
            "industry_verified" => Ok(Self::IndustryVerified),
            _ => Err(serde::de::Error::custom("invalid verification level")),
        }
    }
}

fn required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

fn bounded(value: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&value.chars().count())
}

fn utc_date(value: &str) -> Result<String, ProfileDecodeError> {
    let parsed = DateTime::parse_from_rfc3339(value)
        .map_err(|_| ProfileDecodeError::InvalidResponse)?;
    if parsed.offset().local_minus_utc() != 0 || value.ends_with("-00:00") {
        return Err(ProfileDecodeError::InvalidResponse);
    }
    Ok(parsed.format("%Y-%m-%d").to_string())
}

pub(crate) fn decode_profile_read(
    raw: &[u8],
    expected: &ExpectedProfileIdentity<'_>,
) -> Result<ProfileReadDecoded, ProfileDecodeError> {
    use ProfileDecodeError::{IdentityMismatch, InvalidResponse};
    // Decode raw bytes directly: an intermediate Value would discard duplicate keys.
    let wire: ProfileReadWire =
        serde_json::from_slice(raw).map_err(|_| InvalidResponse)?;
    if wire.schema_version != 1
        || !crate::native_account::valid_id(&wire.account_id)
        || !crate::native_account::valid_id(&wire.crewing_id)
        || wire.organization_id.as_deref().is_some_and(|id| !crate::native_account::valid_id(id))
        || !crate::native_account::valid_id(expected.account_id)
        || !crate::native_account::valid_id(expected.crewing_id)
        || expected.organization_id.is_some_and(|id| !crate::native_account::valid_id(id))
    {
        return Err(InvalidResponse);
    }
    let p = &wire.profile;
    if !bounded(&p.display_name, 2, 120) || !bounded(&p.contact_email, 1, 120) {
        return Err(InvalidResponse);
    }
    for (value, min, max) in [
        (p.legal_name.as_deref(), 2, 200),
        (p.jurisdiction.as_deref(), 2, 8),
        (p.registration_number.as_deref(), 1, 80),
        (p.contact_phone.as_deref(), 0, 40),
        (p.mlc_cert_number.as_deref(), 0, 80),
        (p.slug.as_deref(), 3, 80),
        (p.public_description.as_deref(), 0, 4000),
    ] {
        if value.is_some_and(|v| !bounded(v, min, max)) {
            return Err(InvalidResponse);
        }
    }
    if p.slug.as_deref().is_some_and(|slug| {
        !slug.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
    }) {
        return Err(InvalidResponse);
    }
    utc_date(&p.created_at)?;
    let mlc_utc_date = p.mlc_cert_valid_to.as_deref().map(utc_date).transpose()?;
    if wire.account_id != expected.account_id
        || wire.crewing_id != expected.crewing_id
        || wire.organization_id.as_deref() != expected.organization_id
    {
        return Err(IdentityMismatch);
    }
    Ok(ProfileReadDecoded { wire, mlc_utc_date })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    const ROOT_KEYS: [&str; 5] = [
        "schema_version", "account_id", "crewing_id", "organization_id", "profile",
    ];
    const PROFILE_KEYS: [&str; 13] = [
        "display_name", "legal_name", "jurisdiction", "registration_number",
        "contact_email", "contact_phone", "mlc_cert_number", "mlc_cert_valid_to",
        "slug", "public_description", "mlc_certified", "verified_level", "created_at",
    ];
    fn expected() -> ExpectedProfileIdentity<'static> {
        ExpectedProfileIdentity { account_id: "account-A", crewing_id: "company-A", organization_id: None }
    }
    fn fixture() -> Value {
        json!({
            "schema_version": 1, "account_id": "account-A", "crewing_id": "company-A",
            "organization_id": null,
            "profile": {
                "display_name": "Synthetic A", "legal_name": null, "jurisdiction": null,
                "registration_number": null, "contact_email": "synthetic-a@example.com",
                "contact_phone": null, "mlc_cert_number": null, "mlc_cert_valid_to": null,
                "slug": null, "public_description": null, "mlc_certified": false,
                "verified_level": "pending", "created_at": "2026-10-20T10:00:00Z"
            }
        })
    }
    fn decode(v: &Value) -> Result<ProfileReadDecoded, ProfileDecodeError> {
        decode_profile_read(&serde_json::to_vec(v).unwrap(), &expected())
    }
    fn invalid(v: Value) {
        assert!(matches!(decode(&v), Err(ProfileDecodeError::InvalidResponse)));
    }

    #[test]
    fn native635_profile_v4_required_keys() {
        for key in ROOT_KEYS {
            let mut v = fixture(); v.as_object_mut().unwrap().remove(key); invalid(v);
        }
        for key in PROFILE_KEYS {
            let mut v = fixture(); v["profile"].as_object_mut().unwrap().remove(key); invalid(v);
        }
        // No.623 (1624): две строки, требовавшие ОТКЛОНЯТЬ лишние поля, сняты —
        // предмет перевёрнут решением и живёт в native635_profile_v4_unknown_keys_are_tolerated.
        // Здесь остаётся ровно обязательность известных ключей.
    }

    // No.623 (решение менеджера (1624), правило дома «DTO терпят неизвестные поля»,
    // ARCH-017 «сервер — источник данных»): сервер вправе добавить поле, и клиент
    // прежней версии обязан продолжать читать ответ, а не отказывать целиком.
    // Терпимость НЕ означает «принимаем мусор»: известные поля обязаны разобраться
    // в те же значения, а дубликаты, обрезанный JSON и неверные типы остаются
    // отказом — это проверяют соседние тесты.
    #[test]
    fn native635_profile_v4_unknown_keys_are_tolerated() {
        let mut v = fixture();
        v["unexpected_root"] = json!(0);
        v["profile"]["unexpected_nested"] = json!({"any": [1, 2]});
        let decoded = decode(&v).expect("a response with server-added fields must still decode");
        assert_eq!(decoded.wire.schema_version, 1);
        assert_eq!(decoded.wire.account_id, "account-A");
        assert_eq!(decoded.wire.crewing_id, "company-A");
        assert_eq!(decoded.wire.profile.display_name, "Synthetic A");
        assert_eq!(decoded.wire.profile.contact_email, "synthetic-a@example.com");
        // ПОЛОЖИТЕЛЬНЫЙ КОНТРОЛЬ в том же тесте: фикстура без добавленных полей
        // разбирается в то же самое, иначе «разобралось» ничего не значит.
        let clean = decode(&fixture()).expect("the clean fixture decodes");
        // VerificationLevel намеренно без Debug (значения профиля не payload для
        // логов), поэтому сравнение через PartialEq, а не assert_eq!.
        assert!(decoded.wire.profile.verified_level == clean.wire.profile.verified_level);
        assert_eq!(decoded.mlc_utc_date, clean.mlc_utc_date);
    }

    #[test]
    fn native635_profile_v4_raw_duplicate_and_trailing_json_rejected() {
        let raw = serde_json::to_string(&fixture()).unwrap();
        for candidate in [
            raw.replacen("\"schema_version\":1", "\"schema_version\":1,\"schema_version\":1", 1),
            raw.replacen("\"contact_email\":", "\"contact_email\":\"duplicate@example.com\",\"contact_email\":", 1),
            format!("{raw} {{}}"),
            "{".to_string(),
        ] {
            assert!(matches!(decode_profile_read(candidate.as_bytes(), &expected()),
                Err(ProfileDecodeError::InvalidResponse)));
        }
    }

    #[test]
    fn native635_profile_v4_strict_types_version_and_enum() {
        for key in ["account_id", "crewing_id", "organization_id"] {
            for value in [json!(false), json!(1), json!([]), json!({})] {
                let mut v = fixture(); v[key] = value; invalid(v);
            }
        }
        for key in PROFILE_KEYS {
            for value in [json!([]), json!({}), json!(1)] {
                let mut v = fixture(); v["profile"][key] = value; invalid(v);
            }
        }
        for key in ["display_name", "contact_email", "verified_level", "created_at"] {
            for value in [Value::Null, json!(false)] {
                let mut v = fixture(); v["profile"][key] = value; invalid(v);
            }
        }
        for key in ["legal_name", "jurisdiction", "registration_number", "contact_phone",
            "mlc_cert_number", "mlc_cert_valid_to", "slug", "public_description"]
        {
            let mut v = fixture(); v["profile"][key] = json!(false); invalid(v);
        }
        for value in [json!(0), json!(2), json!(-1), json!(1.0), json!("1"), json!(true), Value::Null] {
            let mut v = fixture(); v["schema_version"] = value; invalid(v);
        }
        for value in [json!("false"), json!(0), Value::Null] {
            let mut v = fixture(); v["profile"]["mlc_certified"] = value; invalid(v);
        }
        let mut v = fixture(); v["profile"]["verified_level"] = json!("owner"); invalid(v);
        for level in ["pending", "email_verified", "company_verified", "industry_verified"] {
            let mut v = fixture(); v["profile"]["verified_level"] = json!(level);
            assert!(decode(&v).is_ok());
            // Serde's derived external-tag enum also accepts {"pending": null}.
            // V4 accepts only the string representation, for every variant.
            let mut v = fixture(); v["profile"]["verified_level"] = json!({});
            v["profile"]["verified_level"][level] = Value::Null;
            invalid(v);
        }
    }

    #[test]
    fn native635_profile_v4_nullable_empty_and_unicode_bounds() {
        assert!(decode(&fixture()).is_ok());
        for (key, min, max) in [
            ("display_name", 2, 120), ("legal_name", 2, 200), ("jurisdiction", 2, 8),
            ("registration_number", 1, 80), ("contact_phone", 0, 40),
            ("mlc_cert_number", 0, 80), ("public_description", 0, 4000),
        ] {
            for len in [min, max] {
                let mut v = fixture(); v["profile"][key] = json!("é".repeat(len));
                assert!(decode(&v).is_ok(), "{key}:{len}");
            }
            let mut v = fixture(); v["profile"][key] = json!("x".repeat(max + 1)); invalid(v);
            if min > 0 {
                let mut v = fixture(); v["profile"][key] = json!("x".repeat(min - 1)); invalid(v);
            }
        }
        let mut v = fixture();
        v["profile"]["contact_phone"] = json!("");
        v["profile"]["mlc_cert_number"] = json!("");
        v["profile"]["public_description"] = json!("");
        let decoded = decode(&v).ok().unwrap();
        assert_eq!(decoded.wire.profile.contact_phone.as_deref(), Some(""));
        assert_eq!(decoded.wire.profile.mlc_cert_number.as_deref(), Some(""));
        assert_eq!(decoded.wire.profile.public_description.as_deref(), Some(""));
        assert!(decoded.wire.profile.legal_name.is_none());
        assert!(decoded.wire.organization_id.is_none());
        let mut v = fixture(); v["profile"]["display_name"] = json!(" A ");
        assert_eq!(decode(&v).ok().unwrap().wire.profile.display_name, " A ");
    }

    #[test]
    fn native635_profile_v4_slug_and_utc_date() {
        for slug in ["abc", &"a".repeat(80)] {
            let mut v = fixture(); v["profile"]["slug"] = json!(slug); assert!(decode(&v).is_ok());
        }
        for slug in ["", "ab", "Abc", "ab_c", "a b", "abcé", &"a".repeat(81)] {
            let mut v = fixture(); v["profile"]["slug"] = json!(slug); invalid(v);
        }
        for stamp in ["2026-10-20T23:59:59Z", "2026-10-20T23:59:59+00:00"] {
            let mut v = fixture(); v["profile"]["mlc_cert_valid_to"] = json!(stamp);
            assert_eq!(decode(&v).ok().unwrap().mlc_utc_date.as_deref(), Some("2026-10-20"));
        }
        assert!(decode(&fixture()).ok().unwrap().mlc_utc_date.is_none());
        for stamp in ["", "2026-10-20", "2026-10-20T10:00:00",
            "2026-10-20T10:00:00+01:00", "2026-10-20T10:00:00-00:00", "2026-02-30T10:00:00Z"]
        {
            for key in ["created_at", "mlc_cert_valid_to"] {
                let mut v = fixture(); v["profile"][key] = json!(stamp); invalid(v);
            }
        }
    }

    #[test]
    fn native635_profile_v4_expected_identity_exact_and_opaque() {
        for key in ["account_id", "crewing_id", "organization_id"] {
            let mut v = fixture(); v[key] = json!("different");
            assert!(matches!(decode(&v), Err(ProfileDecodeError::IdentityMismatch)));
            for id in ["", " ", " padded", "padded ", "a\nb"] {
                let mut v = fixture(); v[key] = json!(id); invalid(v);
            }
        }
        let mut b = fixture(); b["account_id"] = json!("account-B");
        b["crewing_id"] = json!("company-B"); b["organization_id"] = json!("org-B");
        b["profile"]["contact_email"] = json!("synthetic-b@example.com");
        let expected_b = ExpectedProfileIdentity {
            account_id: "account-B", crewing_id: "company-B", organization_id: Some("org-B"),
        };
        assert!(decode_profile_read(&serde_json::to_vec(&b).unwrap(), &expected_b).is_ok());
        assert!(matches!(decode(&b), Err(ProfileDecodeError::IdentityMismatch)));
        b["organization_id"] = Value::Null;
        assert!(matches!(decode_profile_read(&serde_json::to_vec(&b).unwrap(), &expected_b),
            Err(ProfileDecodeError::IdentityMismatch)));
        let mut v = fixture(); v["account_id"] = json!("opaque internal space");
        let opaque = ExpectedProfileIdentity {
            account_id: "opaque internal space", crewing_id: "company-A", organization_id: None,
        };
        assert!(decode_profile_read(&serde_json::to_vec(&v).unwrap(), &opaque).is_ok());
    }

    #[test]
    fn native635_profile_v4_email_parity_gap_is_explicit_no_normalization() {
        // This test documents INCOMPLETE semantic validation, never V4 acceptance.
        // A later EmailStr parity stage must replace this acceptance expectation.
        for email in ["synthetic@example.com", "Case+Tag@example.com", "not-an-email", " padded@example.com "] {
            let mut v = fixture(); v["profile"]["contact_email"] = json!(email);
            assert_eq!(decode(&v).ok().unwrap().wire.profile.contact_email, email);
        }
        for email in ["".to_string(), "x".repeat(121)] {
            let mut v = fixture(); v["profile"]["contact_email"] = json!(email); invalid(v);
        }
    }
}
