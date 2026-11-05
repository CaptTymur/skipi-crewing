#!/usr/bin/env python3
"""Сверка блоков. Без --expect-changed требует полного равенства.
С ним: разойтись вправе ТОЛЬКО объявленные, и только в объявленном направлении."""
import sys, json
a = json.load(open(sys.argv[1]))["blocks"]; b = json.load(open(sys.argv[2]))["blocks"]
decl = {}
if '--expect-changed' in sys.argv:
    decl = json.load(open(sys.argv[sys.argv.index('--expect-changed') + 1]))
allowed_changed = set(decl.get('changed_in_place', {}))
renames = decl.get('renamed', {})
must_same = set(decl.get('must_be_unchanged', [])) or set(a)
bad = []
for n in a:
    if n in renames:
        spec = renames[n]
        new = spec["to"] if isinstance(spec, dict) else spec
        if n in b: bad.append(f'{n}: renamed block still present under the old name')
        if new not in b: bad.append(f'{new}: renamed-to block absent'); continue
        if isinstance(spec, dict):
            # ТЕЛО переименованного блока тоже ограничено: переименование плюс
            # произвольная правка не проходит (пробел, найденный координатором)
            if a[n]["sha256"] != spec["sha256_before"]:
                bad.append(f'{n}: pre-rename body differs from the declaration')
            if b[new]["sha256"] != spec["sha256_after"]:
                bad.append(f'{new}: post-rename body differs from the declaration')
        continue
    if n not in b: bad.append(f'{n}: MISSING and not declared as renamed'); continue
    if a[n]["sha256"] != b[n]["sha256"] and n not in allowed_changed:
        bad.append(f'{n}: CHANGED but not declared')
    if n in must_same and a[n]["sha256"] != b[n]["sha256"] and n not in allowed_changed:
        bad.append(f'{n}: declared must_be_unchanged yet changed')
for n in b:
    if n not in a and n not in {(s['to'] if isinstance(s, dict) else s) for s in renames.values()}:
        bad.append(f'{n}: ADDED and not declared')
orc = decl.get('oracle_block_sha256')
if orc and b.get('native930_joint_successful_login_activates_private_session', {}).get('sha256') != orc:
    bad.append('ORACLE block sha mismatch — the subject test must not be edited')
if bad:
    print('BLOCKS DIVERGED BEYOND THE DECLARATION'); [print('  ', x) for x in bad]; sys.exit(1)
print(f'blocks conform to the declaration: {len(allowed_changed)} changed in place, '
      f'{len(renames)} renamed, {len(must_same)} unchanged, oracle byte-identical')
