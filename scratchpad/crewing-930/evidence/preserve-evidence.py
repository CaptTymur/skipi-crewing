#!/usr/bin/env python3
"""Копирование доказательной базы с проверкой ЧТЕНИЕМ, а не кодом возврата cp."""
import sys, json, pathlib, hashlib, shutil
man = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
src = pathlib.Path(man['source']); dst = pathlib.Path(man['destination'])
mode = sys.argv[2] if len(sys.argv) > 2 else 'run'
drift, copied, verified, bad = [], 0, 0, []
for rel, rec in sorted(man['files'].items()):
    s = src / rel
    if not s.is_file(): drift.append(f'{rel}: source missing'); continue
    got = hashlib.sha256(s.read_bytes()).hexdigest()
    if got != rec['sha256']: drift.append(f'{rel}: source drifted since the manifest'); continue
if drift:
    print('REFUSE: source drifted from the manifest'); [print('  ', d) for d in drift[:10]]; sys.exit(4)
print(f'source verified against the manifest: {len(man["files"])} files, no drift')
if mode == 'check-only': sys.exit(0)
for rel, rec in sorted(man['files'].items()):
    s, d = src / rel, dst / rel
    d.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(s, d); copied += 1
    # ПРОВЕРКА ЧТЕНИЕМ: хеш прочитанных байт назначения, а не rc копирования
    got = hashlib.sha256(d.read_bytes()).hexdigest()
    if got == rec['sha256']: verified += 1
    else: bad.append(f'{rel}: copy reads {got[:16]}, manifest says {rec["sha256"][:16]}')
shutil.copy2(sys.argv[1], dst / 'MANIFEST-slice-A-evidence.json')
print(f'copied {copied}, verified BY READING {verified}, mismatches {len(bad)}')
[print('  MISMATCH', b) for b in bad[:10]]
json.dump({"copied": copied, "verified_by_reading": verified, "mismatches": bad,
           "manifest_copied_to": str(dst / 'MANIFEST-slice-A-evidence.json')},
          open(sys.argv[3] if len(sys.argv) > 3 else '/dev/stdout', 'w'), ensure_ascii=False, indent=1)
sys.exit(0 if not bad else 5)
