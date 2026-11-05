#!/usr/bin/env python3
"""3c: give the SECOND login step its own refusal code.

Two stages so the failing-first run is real:
  --stage test  : the Fake's failure injection + the new test  (fix absent -> must FAIL)
  --stage fix   : the mapper + the call-site map_err           (-> must pass)

Anchor-verified: every edit refuses unless its anchor is found exactly once.
"""
import argparse, hashlib, os, sys

def write_atomic(path, text):
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        fh.write(text)
    os.chmod(tmp, os.stat(path).st_mode & 0o7777)   # os.replace carries the TEMP file's mode
    os.replace(tmp, path)
    back = open(path).read()
    if back != text:
        sys.exit("REFUSE: re-read differs from what was written")

def once(text, needle, label):
    n = text.count(needle)
    if n != 1:
        sys.exit("REFUSE: anchor %r found %d times (want exactly 1)" % (label, n))
    return n

MAPPER = '''
/// The second step of an interactive login carries its own refusal codes.
///
/// `transport_unreachable` and `upstream_unavailable` are both born inside the single `post()`
/// helper that serves BOTH `login` and `bootstrap`, so the code alone cannot say which step
/// failed -- only the call site can. And only the interactive path has two steps: `refresh`
/// replays a stored credential and has no first step, so an identical failure there must keep
/// the original code rather than imply an accepted account.
///
/// The pair is NOT collapsed into one code: the two shipped texts ask for two different
/// actions -- check your own network and retry now, versus wait because it is on our side --
/// and a status code having arrived at all is what distinguishes them.
fn second_step_code(code: &'static str) -> &'static str {
    match code {
        "transport_unreachable" => "workspace_unreachable",
        "upstream_unavailable" => "workspace_unavailable",
        other => other,
    }
}
'''

CALL_OLD = """            let response = transport.bootstrap(&identity.token, &identity.account_id, company, attempt.create)?;"""
CALL_NEW = """            let response = transport.bootstrap(&identity.token, &identity.account_id, company, attempt.create)
                .map_err(second_step_code)?;"""

FAKE_STRUCT_OLD = """        on_logout: Option<Box<dyn Fn() + 'a>>, remote_error: bool,
    }"""
FAKE_STRUCT_NEW = """        on_logout: Option<Box<dyn Fn() + 'a>>, remote_error: bool,
        fail_login: Option<&'static str>, fail_bootstrap: Option<&'static str>,
    }"""

FAKE_DEFAULT_OLD = """            on_login: None, on_bootstrap: None, on_logout: None, remote_error: false } }"""
FAKE_DEFAULT_NEW = """            on_login: None, on_bootstrap: None, on_logout: None, remote_error: false,
            fail_login: None, fail_bootstrap: None } }"""

FAKE_LOGIN_OLD = """            if let Some(callback) = &self.on_login { callback(); }
            Ok(self.identity.clone())"""
FAKE_LOGIN_NEW = """            if let Some(callback) = &self.on_login { callback(); }
            if let Some(code) = self.fail_login { return Err(code); }
            Ok(self.identity.clone())"""

FAKE_BOOT_OLD = """            if let Some(callback) = &self.on_bootstrap { callback(); }
            Ok(self.reply.clone())"""
FAKE_BOOT_NEW = """            if let Some(callback) = &self.on_bootstrap { callback(); }
            if let Some(code) = self.fail_bootstrap { return Err(code); }
            Ok(self.reply.clone())"""

TEST = '''    #[test]
    fn native635_runtime_second_step_unreachable_is_distinguishable_from_the_first() {
        // `transport_unreachable` and `upstream_unavailable` are born inside the single `post()`
        // helper serving BOTH login and bootstrap, so the code alone cannot say which step
        // failed. These arms pin the distinction to the call site.
        // The pair stays a pair: the two shipped texts ask for two different actions, so
        // each second-step failure keeps its own code rather than collapsing into one.
        let mut seen: Vec<&'static str> = vec![];
        for (code, expected) in [("transport_unreachable", "workspace_unreachable"),
                                 ("upstream_unavailable", "workspace_unavailable")] {
            let f = Fixture::new(); let (rt, _) = f.runtime(f.settings(true)); let old = f.bytes();
            let fake = Fake { fail_bootstrap: Some(code), ..Fake::default() };
            let pending = rt.start_login(&rt.context().unwrap(), CreationPolicy::FreshNativeContext).unwrap();
            let got = rt.authenticate(&fake, "synthetic", "synthetic", pending).unwrap_err();
            assert_eq!(got, expected, "second step failing with {code} must carry its own step-two code");
            seen.push(got);
            // Step one was reached and accepted before step two was attempted -- this is what
            // lets the text say the account details were accepted.
            assert_eq!(fake.calls.borrow().as_slice(), ["login", "bootstrap:synthetic-company:false"]);
            // And nothing was written -- this is what lets the text say so.
            assert_eq!(f.bytes(), old); assert!(f.row().is_some());
        }
        // Control: the SAME code on step ONE keeps the original. Without this arm a blanket
        // rename of the transport codes would pass.
        let f = Fixture::new(); let (rt, _) = f.runtime(f.settings(true)); let old = f.bytes();
        let fake = Fake { fail_login: Some("transport_unreachable"), ..Fake::default() };
        let pending = rt.start_login(&rt.context().unwrap(), CreationPolicy::FreshNativeContext).unwrap();
        assert_eq!(rt.authenticate(&fake, "synthetic", "synthetic", pending).unwrap_err(), "transport_unreachable");
        assert_eq!(fake.calls.borrow().as_slice(), ["login"]); assert_eq!(f.bytes(), old);
        // Control: `refresh` replays a stored credential and has NO first step, so an identical
        // bootstrap failure there must not imply an accepted account. This arm fails if the code
        // is renamed in native_account.rs instead of mapped at the interactive call site.
        let f = Fixture::new(); let (rt, _) = connected(&f);
        let fake = Fake { fail_bootstrap: Some("transport_unreachable"), ..Fake::default() };
        assert_eq!(rt.refresh(&fake, &rt.context().unwrap()).unwrap_err(), "transport_unreachable");
        assert_eq!(fake.calls.borrow().as_slice(), ["bootstrap:synthetic-company:false"]);
        // Control: the two second-step codes must stay DISTINCT from each other. Collapsing
        // them would merge "check your network and retry" with "wait, it is on our side".
        assert_ne!(seen[0], seen[1], "the second-step pair must not collapse into one code");
        // Control: the mapping is narrow -- a non-transport second-step refusal is untouched.
        let f = Fixture::new(); let (rt, _) = f.runtime(f.settings(true));
        let fake = Fake { fail_bootstrap: Some("ownership_conflict"), ..Fake::default() };
        let pending = rt.start_login(&rt.context().unwrap(), CreationPolicy::FreshNativeContext).unwrap();
        assert_eq!(rt.authenticate(&fake, "synthetic", "synthetic", pending).unwrap_err(), "ownership_conflict");
    }
'''

ap = argparse.ArgumentParser()
ap.add_argument("--root", required=True)
ap.add_argument("--stage", required=True, choices=["test", "fix"])
a = ap.parse_args()

path = os.path.join(a.root, "src/native_lifecycle.rs")
src = open(path).read()
before = hashlib.sha256(src.encode()).hexdigest()
print("file: %s" % path)
print("sha256 before: %s" % before[:16])
print("mode before:   %o" % (os.stat(path).st_mode & 0o7777))

if a.stage == "test":
    # the dry-run probe comment must go, so the diff I later transcribe is exact
    lines = src.split("\n")
    kept = [l for l in lines if not l.startswith("// dry-run probe ")]
    removed = len(lines) - len(kept)
    print("dry-run probe lines removed: %d" % removed)
    src = "\n".join(kept)

    for label, old, new in [
        ("Fake struct",   FAKE_STRUCT_OLD,   FAKE_STRUCT_NEW),
        ("Fake::default", FAKE_DEFAULT_OLD,  FAKE_DEFAULT_NEW),
        ("Fake::login",   FAKE_LOGIN_OLD,    FAKE_LOGIN_NEW),
        ("Fake::bootstrap", FAKE_BOOT_OLD,   FAKE_BOOT_NEW),
    ]:
        once(src, old, label)
        src = src.replace(old, new)
        print("  applied: %s" % label)

    # insert the test before the LAST closing brace of mod runtime_tests
    marker = "\n        assert!(rt.ticket(&rt.context().unwrap()).is_err());\n    }\n}\n"
    once(src, marker, "module close")
    src = src.replace(marker, "\n        assert!(rt.ticket(&rt.context().unwrap()).is_err());\n    }\n" + TEST + "}\n")
    print("  applied: new test inserted before mod close")
    if src.count("fn native635_runtime_second_step_unreachable_is_distinguishable_from_the_first") != 1:
        sys.exit("REFUSE: test name not present exactly once")
    if "fn second_step_code" in src or ".map_err(second_step_code)" in src:
        sys.exit("REFUSE: stage 'test' must not contain the fix")

else:
    if "fail_bootstrap" not in src:
        sys.exit("REFUSE: stage 'fix' requires stage 'test' to have run first")
    once(src, "enum VerifiedIdentity {", "mapper anchor")
    src = src.replace("\nenum VerifiedIdentity {", MAPPER + "\nenum VerifiedIdentity {")
    print("  applied: second_step_unreachable mapper")
    once(src, CALL_OLD, "bootstrap call site")
    src = src.replace(CALL_OLD, CALL_NEW)
    print("  applied: map_err at the authenticate call site")
    # the refresh call site must remain untouched
    if "transport.bootstrap(&record.app_credential" not in src:
        sys.exit("REFUSE: refresh call site vanished")
    if src.count(".map_err(second_step_code)") != 1:
        sys.exit("REFUSE: the mapper must be applied at exactly one call site")

write_atomic(path, src)
after = hashlib.sha256(open(path).read().encode()).hexdigest()
print("sha256 after:  %s" % after[:16])
print("mode after:    %o" % (os.stat(path).st_mode & 0o7777))
print("lines: %d" % len(open(path).read().split("\n")))
