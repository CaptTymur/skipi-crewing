#!/usr/bin/env python3
"""No.898 sub-stage F12 - reachability population, derived key list, one new text.

Applies to a target root (mirror or worktree). Guarded by expected PRE digests so it
cannot be applied twice nor to the wrong bytes. Every anchor must match EXACTLY once: a
silent no-op is this class of script's real failure mode. The replacement blocks and the
anchors live beside this file in f12-parts/ - the same bytes that were dry-run to
139 passed / 0 failed, so what ships is what was tested.
Usage: patch-s2-f12.py <root> --expect-pre dist/index.html=<sha>,tests/<harness>=<sha>
"""
import hashlib, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PARTS = os.path.join(HERE, "f12-parts")
DIST = "dist/index.html"
HARN = "tests/crewing635_public_settings_harness.mjs"

NEWKEY = "storage_cleanup_unconfirmed"
EN = ("Settings could not be written, and we could not confirm the leftover file was removed. "
      "Sign-in did not complete. Try again; if it repeats, tell us.")
RU = ("Не удалось записать "
      "настройки, и мы не смогли "
      "подтвердить, что остаточный "
      "файл удалён. Вход не завершён. "
      "Попробуйте ещё раз; если "
      "повторится — скажите нам.")
EN_ANCHOR = '    "settings.crewing.login.storage_error": "Nothing could be written: check free space and permissions.",'
RU_ANCHOR = ('    "settings.crewing.login.storage_error": "Не удалось '
             'записать: проверьте '
             'свободное место и '
             'права.",')
MAP_ANCHOR = '"settings_storage_error": "storage_error"'

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

    old_f11 = rd(os.path.join(PARTS, "anchor_f11.txt"))
    old_list = rd(os.path.join(PARTS, "anchor_list.txt"))
    new_f11 = rd(os.path.join(PARTS, "new_f11.js")).rstrip("\n")
    new_list = rd(os.path.join(PARTS, "new_list.js")).rstrip("\n")

    h = rd(tgt[HARN]); d = rd(tgt[DIST])
    for hay, needle, label in [(h, old_f11, "F11 block"), (h, old_list, "hand-written key list"),
                               (d, EN_ANCHOR, "EN storage_error"), (d, RU_ANCHOR, "RU storage_error"),
                               (d, MAP_ANCHOR, "map entry")]:
        n = hay.count(needle)
        if n != 1:
            print("REFUSE: %s matched %d times, expected exactly 1" % (label, n), file=sys.stderr); return 5

    h = h.replace(old_f11, new_f11).replace(old_list, new_list)
    d = d.replace(MAP_ANCHOR, '"settings_cleanup_unconfirmed": "%s", %s' % (NEWKEY, MAP_ANCHOR))
    d = d.replace(EN_ANCHOR, EN_ANCHOR + '\n    "settings.crewing.login.%s": "%s",' % (NEWKEY, EN))
    d = d.replace(RU_ANCHOR, RU_ANCHOR + '\n    "settings.crewing.login.%s": "%s",' % (NEWKEY, RU))

    # Atomic: a temp file in the SAME directory then os.replace. `open(..., "w")` truncates
    # a 1.1 MB file before writing, and a kill inside that window leaves a half-file whose
    # PRE digest no longer matches - so re-running would refuse and the tree would need
    # repair. Three processes were killed in this environment today, so the window is not
    # hypothetical. The resulting bytes are identical, so the POST pins stay valid.
    for abs_, text in ((tgt[DIST], d), (tgt[HARN], h)):
        tmp = abs_ + ".tmp-s2f12"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text); f.flush(); os.fsync(f.fileno())
        os.replace(tmp, abs_)
    print("applied to " + root)
    for rel, abs_ in tgt.items(): print("  POST %s %s" % (sha(abs_), rel))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
