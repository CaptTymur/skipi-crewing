#!/usr/bin/env python3
"""No.898 sub-stage 1 - the Fresh codes. Applies to a target root (mirror or worktree).

Guarded: refuses unless each target file equals its expected PRE digest, so it cannot be
applied twice and cannot be applied to the wrong bytes. Every replacement is asserted to
have happened exactly once - a silent no-op is the failure mode this class of script has.
Usage: patch-s1-fresh.py <root> [--expect-pre a=sha,b=sha]
"""
import hashlib, sys, os

NEW_KEY = "workspace_not_created"
EN = ("We could not prepare local storage for this account on this device. "
      "Sign-in did not complete. Try again; if it repeats, tell us.")
RU = ("\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u0438\u0442\u044c "
      "\u043b\u043e\u043a\u0430\u043b\u044c\u043d\u043e\u0435 \u0445\u0440\u0430\u043d\u0438\u043b\u0438\u0449\u0435 \u0434\u043b\u044f "
      "\u044d\u0442\u043e\u0433\u043e \u0430\u043a\u043a\u0430\u0443\u043d\u0442\u0430 \u043d\u0430 \u044d\u0442\u043e\u043c "
      "\u0443\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432\u0435. \u0412\u0445\u043e\u0434 \u043d\u0435 "
      "\u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043d. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0451 "
      "\u0440\u0430\u0437; \u0435\u0441\u043b\u0438 \u043f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0441\u044f \u2014 "
      "\u0441\u043a\u0430\u0436\u0438\u0442\u0435 \u043d\u0430\u043c.")

DIST = "dist/index.html"
HARN = "tests/crewing635_public_settings_harness.mjs"

EDITS_DIST = [
 # one replacement removes the dead entry AND repoints the live code
 ('"fresh_context_unavailable": "fresh_unavailable", "fresh_namespace_unavailable": "fresh_unavailable"',
  '"fresh_namespace_unavailable": "%s"' % NEW_KEY),
 ('    "settings.crewing.login.fresh_unavailable": "Signing in on a new installation is not available yet.",',
  '    "settings.crewing.login.%s": "%s",' % (NEW_KEY, EN)),
 ('    "settings.crewing.login.fresh_unavailable": "\u0412\u0445\u043e\u0434 \u043d\u0430 \u043d\u043e\u0432\u043e\u0439 '
  '\u0443\u0441\u0442\u0430\u043d\u043e\u0432\u043a\u0435 \u043f\u043e\u043a\u0430 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d.",',
  '    "settings.crewing.login.%s": "%s",' % (NEW_KEY, RU)),
]

OLD_ASSERT = '''    ok(/"fresh_namespace_unavailable":\\s*"fresh_unavailable"/.test(html),
       'No.880/\u2116793: the allocator refusal code maps to a named text, not to refused_unspecified');'''

NEW_ASSERT = '''    // No.898: ассерт следует КЛЮЧУ, а не одной буквальной паре. Прежняя форма пинила
    // `"fresh_namespace_unavailable": "fresh_unavailable"` и краснела бы ПО ПОСТРОЕНИЮ при
    // любой смене ключа — по верной причине в неподходящий момент.
    const mapBlockFresh=(html.match(/function loginRefusalText\\(code\\) \\{\\n  var map = (\\{[\\s\\S]*?\\});/)||['',''])[1];
    const freshTarget=(mapBlockFresh.match(/"fresh_namespace_unavailable":\\s*"([a-z_]+)"/)||[])[1];
    ok(!!freshTarget,'No.898: the live allocator refusal code is mapped at all — target '+String(freshTarget));
    const freshKeyCount=(html.match(new RegExp('"settings\\\\.crewing\\\\.login\\\\.'+freshTarget+'"','g'))||[]).length;
    ok(freshKeyCount===2,'No.898: the allocator refusal key has a text in BOTH language blocks — '+freshTarget+' occurrences='+freshKeyCount);
    // ДВА ассерта на само УДАЛЕНИЕ: «новый ключ работает» не ловит «старый остался»,
    // поэтому без них следующий писатель вернёт мёртвую запись и ничего не покраснеет.
    ok(!/"fresh_context_unavailable"\\s*:/.test(mapBlockFresh),
       'No.898: the test-only code fresh_context_unavailable is ABSENT from the map — dead data; it is unreachable in a product build by cfg');
    ok(!/"settings\\.crewing\\.login\\.fresh_unavailable"/.test(html),
       'No.898: the retired key fresh_unavailable is ABSENT from both language blocks');
    // Контроль инструмента: тот же предикат обязан НАХОДИТЬ существующий ключ, иначе
    // два отрицания выше зелены потому, что он не умеет находить ничего.
    const freshCtrl=(html.match(/"settings\\.crewing\\.login\\.storage_error"/g)||[]).length;
    ok(freshCtrl===2,'control: the counting predicate finds a key that DOES exist (storage_error occurrences='+freshCtrl+'), so the zeros above mean genuinely absent');'''

def sha(p):
    with open(p,"rb") as f: return hashlib.sha256(f.read()).hexdigest()

def main():
    if len(sys.argv) < 2: print(__doc__); return 2
    root = sys.argv[1]
    expect = {}
    for i,a in enumerate(sys.argv):
        if a == "--expect-pre" and i+1 < len(sys.argv):
            for kv in sys.argv[i+1].split(","):
                k,v = kv.split("="); expect[k]=v
    targets = {DIST: os.path.join(root,DIST), HARN: os.path.join(root,HARN)}
    for rel,abs_ in targets.items():
        if not os.path.isfile(abs_):
            print("REFUSE: target absent: "+abs_, file=sys.stderr); return 3
        if rel in expect and sha(abs_) != expect[rel]:
            print("REFUSE: %s is not the expected PRE bytes\n  on disk %s\n  expected %s"
                  % (rel, sha(abs_), expect[rel]), file=sys.stderr); return 4

    html = open(targets[DIST], encoding="utf-8").read()
    for old,new in EDITS_DIST:
        n = html.count(old)
        if n != 1:
            print("REFUSE: dist edit matched %d times, expected exactly 1:\n  %s" % (n, old[:90]),
                  file=sys.stderr); return 5
        html = html.replace(old,new)

    harn = open(targets[HARN], encoding="utf-8").read()
    n = harn.count(OLD_ASSERT)
    if n != 1:
        print("REFUSE: harness assert matched %d times, expected exactly 1" % n, file=sys.stderr); return 6
    harn = harn.replace(OLD_ASSERT, NEW_ASSERT)

    open(targets[DIST],"w",encoding="utf-8").write(html)
    open(targets[HARN],"w",encoding="utf-8").write(harn)
    print("applied to "+root)
    for rel,abs_ in targets.items(): print("  POST %s %s" % (sha(abs_), rel))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
