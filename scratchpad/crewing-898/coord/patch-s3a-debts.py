#!/usr/bin/env python3
"""No.898 sub-stage 3a - instrument debts only. NO product byte: dist is untouched.

Debt 1: the quote-blind brace matcher is replaced by this file's own `balancedEnd`.
Debt 2: the H2 parse controls gain an ASSERT that the map is flat - the condition under
        which they are sufficient - so it fails loudly instead of living in prose.
(Debt 3, a stale log label, is in the driver and is fixed there, not here.)
Guarded by expected PRE digests; anchors must match exactly once; atomic writes.
Usage: patch-s3a-debts.py <root> --expect-pre tests/<harness>=<sha>
"""
import hashlib, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PARTS = os.path.join(HERE, "s3a-parts")
HARN = "tests/crewing635_public_settings_harness.mjs"
DIST = "dist/index.html"

def rd(p):
    with open(p, encoding="utf-8") as f: return f.read()
def sha(p):
    with open(p, "rb") as f: return hashlib.sha256(f.read()).hexdigest()

def main():
    if len(sys.argv) < 2: print(__doc__); return 2
    root = sys.argv[1]
    expect = {}
    for i, a in enumerate(sys.argv):
        if a == "--expect-pre" and i + 1 < len(sys.argv):
            for kv in sys.argv[i+1].split(","):
                k, v = kv.split("="); expect[k] = v
    harn = os.path.join(root, HARN); dist = os.path.join(root, DIST)
    if not os.path.isfile(harn):
        print("REFUSE: harness absent: " + harn, file=sys.stderr); return 3
    for rel, abs_ in ((HARN, harn), (DIST, dist)):
        if rel in expect and sha(abs_) != expect[rel]:
            print("REFUSE: %s is not the expected PRE bytes\n  on disk  %s\n  expected %s"
                  % (rel, sha(abs_), expect[rel]), file=sys.stderr); return 4
    dist_before = sha(dist) if os.path.isfile(dist) else None

    a_m = rd(os.path.join(PARTS, "anchor_matcher.txt"))
    a_h = rd(os.path.join(PARTS, "anchor_h2ctl.txt"))
    n_m = rd(os.path.join(PARTS, "new_matcher.js")).rstrip("\n")
    n_h = rd(os.path.join(PARTS, "new_h2ctl.js")).rstrip("\n")
    h = rd(harn)
    for needle, label in ((a_m, "brace matcher"), (a_h, "H2 parse control")):
        n = h.count(needle)
        if n != 1:
            print("REFUSE: %s matched %d times, expected exactly 1" % (label, n), file=sys.stderr); return 5
    h = h.replace(a_m, n_m).replace(a_h, n_h)

    tmp = harn + ".tmp-s3a"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(h); f.flush(); os.fsync(f.fileno())
    os.replace(tmp, harn)

    # dist must be byte-identical afterwards: this sub-stage touches no product byte.
    if dist_before is not None and sha(dist) != dist_before:
        print("REFUSE-AFTER: dist changed, which this sub-stage must never do", file=sys.stderr); return 6
    print("applied to " + root)
    print("  POST %s %s" % (sha(harn), HARN))
    print("  dist UNCHANGED %s" % (dist_before,))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
