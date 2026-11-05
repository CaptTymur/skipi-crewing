#!/usr/bin/env python3
"""No.898 sub-stage 3b - No.894's dist-only half: the demonstration caption.

Moves the `entry.demo_note` paragraph INSIDE the `ec-doors` container (it sat after both
containers, so it stayed on screen under the login form) and gives it an id so its PLACE
can be asserted. Adds one positional assert block with its own discrimination control.
Guarded by expected PRE digests; anchors must match exactly once; atomic writes that
PRESERVE THE TARGET'S MODE (the coordinator's finding: os.replace carries the temp file's
mode onto the target, and git cannot see a non-exec mode change).
Usage: patch-s3b-note.py <root> --expect-pre dist/index.html=<sha>,tests/<harness>=<sha>
"""
import hashlib, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PARTS = os.path.join(HERE, "s3b-parts")
DIST = "dist/index.html"
HARN = "tests/crewing635_public_settings_harness.mjs"

def rd(p):
    with open(p, encoding="utf-8") as f: return f.read()
def sha(p):
    with open(p, "rb") as f: return hashlib.sha256(f.read()).hexdigest()

def write_atomic(path, text):
    mode = os.stat(path).st_mode & 0o7777          # the target's mode, read BEFORE writing
    tmp = path + ".tmp-s3b"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text); f.flush(); os.fsync(f.fileno())
    os.chmod(tmp, mode)                             # <- the debt: preserve it explicitly
    os.replace(tmp, path)
    after = os.stat(path).st_mode & 0o7777
    if after != mode:
        raise SystemExit("REFUSE-AFTER: mode drifted on %s: %o -> %o" % (path, mode, after))
    return mode

def main():
    if len(sys.argv) < 2: print(__doc__); return 2
    root = sys.argv[1]
    expect = {}
    for i, a in enumerate(sys.argv):
        if a == "--expect-pre" and i + 1 < len(sys.argv):
            for kv in sys.argv[i+1].split(","):
                k, v = kv.split("="); expect[k] = v
    tgt = {DIST: os.path.join(root, DIST), HARN: os.path.join(root, HARN)}
    for rel, abs_ in tgt.items():
        if not os.path.isfile(abs_):
            print("REFUSE: target absent: " + abs_, file=sys.stderr); return 3
        if rel in expect and sha(abs_) != expect[rel]:
            print("REFUSE: %s is not the expected PRE bytes\n  on disk  %s\n  expected %s"
                  % (rel, sha(abs_), expect[rel]), file=sys.stderr); return 4

    a_close = rd(os.path.join(PARTS, "anchor_doors_close.txt"))
    a_note  = rd(os.path.join(PARTS, "anchor_note.txt"))
    a_sum   = rd(os.path.join(PARTS, "anchor_summary.txt"))
    n_close = rd(os.path.join(PARTS, "new_note_in_doors.js")).rstrip("\n")
    n_assert= rd(os.path.join(PARTS, "new_assert.js"))

    d = rd(tgt[DIST]); h = rd(tgt[HARN])
    for hay, needle, label in ((d, a_close, "doors-closing block"), (d, a_note, "demo-note line"),
                               (h, a_sum, "harness summary line")):
        n = hay.count(needle)
        if n != 1:
            print("REFUSE: %s matched %d times, expected exactly 1" % (label, n), file=sys.stderr); return 5

    # move: insert the note inside ec-doors, then delete it from after the containers
    d = d.replace(a_close, n_close)
    d = d.replace(a_note + "\n", "")
    # the new assert must run BEFORE the summary is printed, or its passes are not counted
    h = h.replace(a_sum, n_assert + a_sum)

    modes = {}
    for rel, abs_, text in ((DIST, tgt[DIST], d), (HARN, tgt[HARN], h)):
        modes[rel] = write_atomic(abs_, text)
    print("applied to " + root)
    for rel, abs_ in tgt.items():
        print("  POST %s %s (mode %o preserved)" % (sha(abs_), rel, modes[rel]))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
