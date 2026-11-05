#!/usr/bin/env bash
# Стадия сохранения №2: прирост доказательной базы (зонд + разбор) на долговечный диск.
# Манифест — ОБХОДОМ в момент копирования, записывается В НАЗНАЧЕНИЕ. Проверка — ЧТЕНИЕМ.
set -Eeuo pipefail
umask 0022
COORD=/home/linux/Developer/skipi-parallel-coordinator
WT=/home/linux/Developer/worktrees/crewing-930-20261105
SP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DST="$WT/scratchpad/crewing-930/evidence"
WRITER="skipi-crewing-53"
RESERVE=60
CERT="${1:?usage: run-930-preserve2.sh <certificate>}"
SELF_SHA="$(sha256sum "${BASH_SOURCE[0]}" | cut -d" " -f1)"
OUT="$SP/preserve2-out"; mkdir -p "$OUT"
[ -n "$WRITER" ] || { echo "REFUSE: writer unresolved" >&2; exit 9; }

GATE="$(cd "$COORD" && python3 tools/stage_gate.py check --certificate "$CERT" 2>&1)" || {
  printf 'REFUSE: gate rc!=0\n%s\n' "$GATE" >&2; exit 2; }
printf '%s\n' "$GATE"
case "$GATE" in *PERMIT_CURRENT*) : ;; *) echo "REFUSE: not PERMIT_CURRENT" >&2; exit 2 ;; esac
REMAIN="$(python3 -c "
import json,datetime
c=json.load(open('$CERT'))
e=datetime.datetime.fromisoformat(c['expires_at'].replace('Z','+00:00'))
print(int((e-datetime.datetime.now(datetime.timezone.utc)).total_seconds()))")"
echo "remaining=${REMAIN}s reserve=${RESERVE}s"
[ $(( REMAIN - RESERVE )) -ge 20 ] || { echo "REFUSE: budget too small" >&2; exit 3; }

# ---- ПРЕДПРОВЕРКИ ДО ACK_START (урок: наличие ACK_START обязано означать старт)
for f in LIVE-PROBE-ANALYSIS.md ACK_STOP-930-probe.json AFTER_STAGE-930-probe.json; do
  [ -f "$SP/$f" ] || { echo "REFUSE: missing $f" >&2; exit 4; }
done
[ -d "$DST" ] || { echo "REFUSE: destination from the earlier stage is absent: $DST" >&2; exit 5; }
BEFORE=$(find "$DST" -type f | wc -l)
echo "three named files present; destination holds $BEFORE files before this stage"

python3 - "$CERT" "$SELF_SHA" "$SP/ACK_START-930-preserve2.json" "$WRITER" "$REMAIN" <<'PYACK'
import json,sys,datetime,uuid
cert,self_sha,out,writer,remain=sys.argv[1:6]
json.dump({"document":"ACK_START",
 "ack_start_event_id":f"crewing-930-preserve2-ackstart-{datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}",
 "observed_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),
 "stage":"FINALIZE_END","stream_id":"crewing/930-session-activation","writer":writer,
 "driver_sha256":self_sha,
 "driver_sha256_is":"запись о том, что бежало, не доказательство заверенности; привязка — из живого пересчёта evidence_files",
 "window_seconds_remaining_at_start":int(remain),"umask_declared":"0022"},
 open(out,'w'),ensure_ascii=False,indent=1)
print("ACK_START ->",out)
PYACK

# ---- КОПИРОВАНИЕ: обход в момент копирования, проверка чтением
python3 - "$SP" "$DST" "$OUT/report.json" "$BEFORE" <<'PYCP'
import sys,pathlib,hashlib,json,shutil
SP=pathlib.Path(sys.argv[1]); DST=pathlib.Path(sys.argv[2]); OUT=sys.argv[3]; before=int(sys.argv[4])
import datetime
stamp=datetime.datetime.now(datetime.timezone.utc).isoformat()
walk=sorted(p for p in SP.rglob('*') if p.is_file())
man={}; copied=verified=0; bad=[]
for p in walk:
    rel=str(p.relative_to(SP)); d=DST/rel
    man[rel]={"sha256":hashlib.sha256(p.read_bytes()).hexdigest(),"bytes":p.stat().st_size}
    d.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(p,d); copied+=1
    if hashlib.sha256(d.read_bytes()).hexdigest()==man[rel]["sha256"]: verified+=1
    else: bad.append(rel)
doc={"method":"манифест построен ОБХОДОМ в момент копирования и записан В НАЗНАЧЕНИЕ — не член своего предмета",
 "walked_at":stamp,"predicate":"rglob('*'), только файлы; байты — сумма st_size (как du -sb)",
 "file_count":len(man),"total_bytes":sum(v["bytes"] for v in man.values()),
 "copied":copied,"verified_by_reading":verified,"mismatches":bad,
 "destination_files_before_this_stage":before,
 "residue_declared":("ACK_STOP и AFTER_STAGE САМОЙ этой стадии пишутся ПОСЛЕ обхода и в копию не попадут — "
   "их суммы уйдут в доклад. Это residue по построению, и он сокращается с каждой стадией, но не исчезает."),
 "files":man}
(DST/'MANIFEST-walked-at-copy-time.json').write_text(json.dumps(doc,ensure_ascii=False,indent=1),encoding='utf-8')
json.dump({k:v for k,v in doc.items() if k!='files'},open(OUT,'w'),ensure_ascii=False,indent=1)
print(f'walked {len(man)}, copied {copied}, verified BY READING {verified}, mismatches {len(bad)}')
PYCP

# ---- AFTER_STAGE + ACK_STOP
python3 - "$SP" "$OUT" "$WRITER" "$DST" <<'PYFIN'
import sys,json,pathlib,hashlib,datetime,uuid,subprocess,os
SP,OUT,WRITER,DST=pathlib.Path(sys.argv[1]),pathlib.Path(sys.argv[2]),sys.argv[3],pathlib.Path(sys.argv[4])
now=datetime.datetime.now(datetime.timezone.utc)
rep=json.loads((OUT/'report.json').read_text())
after=len(list(DST.rglob('*')))
rows=[l.split(None,3) for l in subprocess.run(['ps','-eo','pid,ppid,comm,args'],capture_output=True,text=True).stdout.splitlines()[1:]]
rows=[r for r in rows if len(r)==4]
def anc(p):
    s=set()
    while p and p!='1':
        try: st=open(f'/proc/{p}/stat').read().split()
        except FileNotFoundError: break
        s.add(p); p=st[3]
    return s
mine=anc(str(os.getpid()))
surv=[{"pid":r[0],"ppid":r[1],"comm":r[2],"mine_by_ppid":r[1] in mine or r[0] in mine} for r in rows if r[2] in ('cargo','rustc','git','curl')]
doc={"document":"AFTER_STAGE",
 "after_stage_event_id":f"crewing-930-preserve2-afterstage-{now.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}",
 "observed_at":now.isoformat(),"stage":"FINALIZE_END","stream_id":"crewing/930-session-activation",
 "copy":rep,"destination_entries_after":after,
 "three_named_files_now_durable":["LIVE-PROBE-ANALYSIS.md","ACK_STOP-930-probe.json","AFTER_STAGE-930-probe.json"],
 "survivors_by_ppid":surv,"umask_declared":"0022",
 "no_network":"стадия сетевых действий не делает: curl не вызывается, разрешение владельца израсходовано 15:54:19Z"}
json.dump(doc,open(SP/'AFTER_STAGE-930-preserve2.json','w'),ensure_ascii=False,indent=1)
json.dump({"document":"ACK_STOP",
 "ack_stop_event_id":f"crewing-930-preserve2-ackstop-{now.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}",
 "ack_stop_writer":WRITER,"observed_at":now.isoformat(),
 "operations_terminated":True,"queued_operations_cancelled":True,
 "evidence":{"after_state_path":str(SP/'AFTER_STAGE-930-preserve2.json'),
   "after_state_sha256":hashlib.sha256((SP/'AFTER_STAGE-930-preserve2.json').read_bytes()).hexdigest(),
   "verified_by_reading":rep["verified_by_reading"],"mismatches":len(rep["mismatches"]),
   "survivors_by_ppid":surv,
   "queued_operations_note":"очередей не ставил; сети не касался; стадия синхронная"}},
 open(SP/'ACK_STOP-930-preserve2.json','w'),ensure_ascii=False,indent=1)
print('AFTER_STAGE + ACK_STOP written | verified',rep["verified_by_reading"],'| dest entries',after)
PYFIN
printf 'STAGE ACTIONS COMPLETE. umask=0022 self_sha256=%s\n' "$SELF_SHA"
