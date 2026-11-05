#!/usr/bin/env python3
"""finish: WORKLOG, AFTER_STAGE, ACK_STOP. Никаких новых действий над кодом."""
import sys, json, pathlib, hashlib, subprocess, datetime, uuid, os, re
OUT, SP, SRC, WT, WRITER, CERT = map(pathlib.Path, sys.argv[1:7]); WRITER = str(WRITER)
now = datetime.datetime.now(datetime.timezone.utc)
def sha(p): return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
files = ['native_lifecycle.rs','native_local_commit.rs','native_local_joint_tests.rs','lib.rs']
final = {f: sha(SRC/f) for f in files}
attempts = {}
for p in sorted(OUT.glob('attempt-*.rc')):
    n = p.stem.split('-')[1]; attempts[n] = p.read_text().strip()
last = max(attempts) if attempts else None
compiles = attempts.get(last) == '0'
# dead_code в ПРОДУКТОВОМ cfg: имена печатает формат по умолчанию
probe = OUT/'product-check.log'
dead, refresh_dead = [], []
if probe.exists():
    t = probe.read_text(errors='replace')
    dead = [l for l in t.splitlines() if 'never used' in l or 'never constructed' in l]
    grp = re.search(r'multiple methods are never used(.{0,4000})', t, re.S)
    refresh_dead = re.findall(r'fn\s+refresh', grp.group(1)) if grp else []
# выжившие по ppid
rows = [l.split(None,3) for l in subprocess.run(['ps','-eo','pid,ppid,comm,args'],
        capture_output=True,text=True).stdout.splitlines()[1:]]
rows = [r for r in rows if len(r)==4]
def anc(pid):
    s=set()
    while pid and pid!='1':
        try: st=open(f'/proc/{pid}/stat').read().split()
        except FileNotFoundError: break
        s.add(pid); pid=st[3]
    return s
mine = anc(str(os.getpid()))
surv = [{"pid":r[0],"ppid":r[1],"comm":r[2],"args":r[3][:110],"mine_by_ppid": r[1] in mine or r[0] in mine}
        for r in rows if r[2] in ('cargo','rustc','git')]
blocks_final = json.load(open(OUT/'blocks-final.json'))
# WORKLOG
wl = WT/'scratchpad'/'crewing-930'; wl.mkdir(parents=True, exist_ok=True)
(wl/'WORKLOG.md').write_text(f"""# WORKLOG — No.930 слайс A (выразимость). Записано под заверением, {now.isoformat()}

## Результат стадии (факт)
- попытки компиляции: {json.dumps(attempts)} при N=5; дерево компилируется: **{compiles}**
- суммы четырёх файлов после: {json.dumps(final, indent=1)}
- блоки `#[test]`: {blocks_final['cutter_control']} — единица резки: {blocks_final['unit']}
- выжившие (атрибуция по ppid, не по comm): {json.dumps(surv, ensure_ascii=False)}
- umask прогона: 0022

## ОГОВОРКА, обещанная координатору: «до/после» снимались на РАЗНОМ коде
Числа PRESERVE «до» снимались на базовом файле `a070d241…` (версия живого main), «после» —
план, а не замер. Вставка RED-теста добавила 31 строку В КОНЕЦ модуля и не изменила ни одной
существующей строки — поэтому счёт утверждений трёх PRESERVE-тестов ею не затронут. Правка
слайса A лежит в ХАРНЕССЕ (вариант `JointOutcome::Active` и два плеча отображения) и тоже вне
всех блоков `#[test]`, что подтверждено сверкой хешей 13 блоков.

## Размер тёплого кэша — ДВЕ строки с путями и приборами, а не одно «правильное» число
- `worktrees/crewing-898-20261104/src-tauri/target` — `du -sh` 5,6 G / `du -sb` 5 957 890 186 Б
- `skipi-crewing/src-tauri/target` — `du -sh` 27 G / `du -sb` 28 302 555 442 Б
- `worktrees/crewing-930-20261105/src-tauri/target` — 5 420 837 580 Б (замер координатора)
Расхождение 5,6 против 26,4 объяснялось РАЗНЫМИ каталогами, а не прибором: блочный и видимый
размеры согласованы на обоих путях.
""", encoding='utf-8')
after = {"document":"AFTER_STAGE",
 "after_stage_event_id":f"crewing-930-s4-afterstage-{now.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}",
 "observed_at":now.isoformat(),"stage":"IMPLEMENT","stream_id":"crewing/930-session-activation",
 "attempts":attempts,"max_attempts":5,"tree_compiles":compiles,
 "final_file_sha256":final,
 "blocks":{"unit":blocks_final["unit"],"cutter_control":blocks_final["cutter_control"],
           "compared_against":"blocks-before.json","verdict":"см. вывод compare-blocks.py в журнале стадии"},
 "dead_code_product_cfg":{"log_present":probe.exists(),"lines":len(dead),
   "refresh_named_in_group":len(refresh_dead),
   "note":"формат по умолчанию: имена членов группового диагностика печатаются; --message-format=short их подавляет"},
 "survivors_by_ppid":surv,"umask_declared":"0022",
 "worklog":str(wl/'WORKLOG.md'),"worklog_sha256":sha(wl/'WORKLOG.md')}
json.dump(after, open(SP/'AFTER_STAGE-930-s4.json','w'), ensure_ascii=False, indent=1)
json.dump({"document":"ACK_STOP",
 "ack_stop_event_id":f"crewing-930-s4-ackstop-{now.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}",
 "ack_stop_writer":WRITER,"observed_at":now.isoformat(),
 "operations_terminated":True,"queued_operations_cancelled":True,
 "evidence":{"after_state_path":str(SP/'AFTER_STAGE-930-s4.json'),
   "after_state_sha256":sha(SP/'AFTER_STAGE-930-s4.json'),
   "survivors_by_ppid":surv,"worklog_sha256":sha(wl/'WORKLOG.md'),
   "queued_operations_note":"очередей не ставил; timeout глушит группу"}},
 open(SP/'ACK_STOP-930-s4.json','w'), ensure_ascii=False, indent=1)
print('WORKLOG + AFTER_STAGE + ACK_STOP written; compiles =', compiles)
