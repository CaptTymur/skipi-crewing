#!/usr/bin/env python3
"""No.898 sub-stage 2 - the Fresh codes, plus Н1 and Н2.

Applies to a target root (mirror or worktree) that ALREADY carries F12. Guarded by expected
PRE digests; every anchor must match exactly once; writes are atomic (temp in the same
directory, fsync, os.replace) so a kill cannot leave a truncated file. Replacement blocks
live beside this file in s3-parts/ - the same bytes that were dry-run.
Usage: patch-s3-fresh.py <root> --expect-pre dist/index.html=<sha>,tests/<harness>=<sha>
"""
import hashlib, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PARTS = os.path.join(HERE, "s3-parts")
DIST = "dist/index.html"
HARN = "tests/crewing635_public_settings_harness.mjs"

NEWKEY = "workspace_not_created"
EN = ("We could not prepare local storage for this account on this device. "
      "Sign-in did not complete. Try again; if it repeats, tell us.")
RU = ("Не удалось подготовить "
      "локальное хранилище для "
      "этого аккаунта на этом "
      "устройстве. Вход не завершён. "
      "Попробуйте ещё раз; если "
      "повторится — скажите нам.")
MAP_ANCHOR = ('"fresh_context_unavailable": "fresh_unavailable", '
              '"fresh_namespace_unavailable": "fresh_unavailable"')
MAP_NEW = '"fresh_namespace_unavailable": "%s"' % NEWKEY
EN_ANCHOR = ('    "settings.crewing.login.fresh_unavailable": '
             '"Signing in on a new installation is not available yet.",')
RU_ANCHOR = ('    "settings.crewing.login.fresh_unavailable": "Вход на '
             'новой установке пока '
             'недоступен.",')

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
    tgt = {DIST: os.path.join(root, DIST), HARN: os.path.join(root, HARN)}
    for rel, abs_ in tgt.items():
        if not os.path.isfile(abs_):
            print("REFUSE: target absent: " + abs_, file=sys.stderr); return 3
        if rel in expect and sha(abs_) != expect[rel]:
            print("REFUSE: %s is not the expected PRE bytes\n  on disk  %s\n  expected %s"
                  % (rel, sha(abs_), expect[rel]), file=sys.stderr); return 4

    a_h2 = rd(os.path.join(PARTS, "anchor_h2.txt"))
    a_h1 = rd(os.path.join(PARTS, "anchor_h1.txt"))
    a_fr = rd(os.path.join(PARTS, "anchor_fresh.txt"))
    n_h2 = rd(os.path.join(PARTS, "new_h2.js")).rstrip("\n")
    n_h1 = rd(os.path.join(PARTS, "new_h1.js")).rstrip("\n")
    n_fr = rd(os.path.join(PARTS, "new_fresh.js")).rstrip("\n")

    h = rd(tgt[HARN]); d = rd(tgt[DIST])
    checks = [(h, a_h2, "H2 threshold line"), (h, a_h1, "H1 both-dictionaries loop"),
              (h, a_fr, "Fresh literal-pairing assert"), (d, MAP_ANCHOR, "map Fresh pair"),
              (d, EN_ANCHOR, "EN fresh_unavailable text"), (d, RU_ANCHOR, "RU fresh_unavailable text")]
    for hay, needle, label in checks:
        n = hay.count(needle)
        if n != 1:
            print("REFUSE: %s matched %d times, expected exactly 1" % (label, n), file=sys.stderr); return 5

    h = h.replace(a_h2, n_h2).replace(a_h1, n_h1).replace(a_fr, n_fr)
    d = d.replace(MAP_ANCHOR, MAP_NEW)
    d = d.replace(EN_ANCHOR, '    "settings.crewing.login.%s": "%s",' % (NEWKEY, EN))
    d = d.replace(RU_ANCHOR, '    "settings.crewing.login.%s": "%s",' % (NEWKEY, RU))

    for abs_, text in ((tgt[DIST], d), (tgt[HARN], h)):
        tmp = abs_ + ".tmp-s3fresh"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text); f.flush(); os.fsync(f.fileno())
        os.replace(tmp, abs_)
    print("applied to " + root)
    for rel, abs_ in tgt.items(): print("  POST %s %s" % (sha(abs_), rel))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
