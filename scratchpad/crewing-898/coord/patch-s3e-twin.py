#!/usr/bin/env python3
"""3e: pin the other side of the migration_required fork.

The house test `native635_880_f11_production_policy_on_clean_install_reaches_fresh` asserts the
PRODUCTION policy reaches fresh allocation. Nothing asserts what the OTHER policy does. So if
`for_interactive_login()` ever changes, or a second caller appears with
`CreationPolicy::ExistingOrUncertain`, the refusal comes alive in the product and no test goes
red. This adds the complementary assertion, so the two together pin the boundary rather than
one side of it.

Experiment (4) demonstrated the branch IS reachable through the existing API: same clean
install, only the policy differs, and the result is Err("migration_required"). Proven on a copy
with an external CARGO_TARGET_DIR, outside any window.
"""
import argparse, hashlib, os, sys

TWIN = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "twin-test.rs")).read()
ANCHOR = '''        // И рабочее место действительно выделено, а не объявлено.
        assert!(fixture.references.borrow().is_some(), "fresh local references were actually prepared");
    }
'''

def write_atomic(path, text):
    tmp = path + ".tmp"
    open(tmp, "w").write(text)
    os.chmod(tmp, os.stat(path).st_mode & 0o7777)
    os.replace(tmp, path)
    if open(path).read() != text:
        sys.exit("REFUSE: re-read differs from what was written")

ap = argparse.ArgumentParser(); ap.add_argument("--root", required=True)
a = ap.parse_args()
p = os.path.join(a.root, "src-tauri/src/native_local_joint_tests.rs")
s = open(p).read()
print("sha256 before: %s mode %o" % (hashlib.sha256(s.encode()).hexdigest()[:16], os.stat(p).st_mode & 0o7777))
if s.count(ANCHOR) != 1:
    sys.exit("REFUSE: anchor found %d times (want 1)" % s.count(ANCHOR))
if "native898_experiment4" in s:
    sys.exit("REFUSE: the twin test is already present")
# the sibling must exist: this stage only makes sense beside it
if "native635_880_f11_production_policy_on_clean_install_reaches_fresh" not in s:
    sys.exit("REFUSE: the sibling test is absent - the pair would pin nothing")
s = s.replace(ANCHOR, ANCHOR + "\n" + TWIN)
if s.count("native898_experiment4") != 1:
    sys.exit("REFUSE: the twin did not land exactly once")
write_atomic(p, s)
print("sha256 after:  %s mode %o" % (hashlib.sha256(open(p).read().encode()).hexdigest()[:16], os.stat(p).st_mode & 0o7777))
