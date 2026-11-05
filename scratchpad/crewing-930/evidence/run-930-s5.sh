#!/usr/bin/env bash
# Стадия сохранения доказательной базы слайса A. Проверка — ЧТЕНИЕМ скопированного.
set -Eeuo pipefail
umask 0022
COORD=/home/linux/Developer/skipi-parallel-coordinator
SP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRITER="skipi-crewing-53"
RESERVE=60
CERT="${1:?usage: run-930-s5.sh <certificate>}"
SELF_SHA="$(sha256sum "${BASH_SOURCE[0]}" | cut -d" " -f1)"
MAN="$SP/MANIFEST-slice-A-evidence.json"
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

python3 - "$CERT" "$SELF_SHA" "$SP/ACK_START-930-s5.json" "$WRITER" "$REMAIN" <<'PYACK'
import json,sys,datetime,uuid
cert,self_sha,out,writer,remain=sys.argv[1:6]
json.dump({"document":"ACK_START",
 "ack_start_event_id":f"crewing-930-s5-ackstart-{datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}",
 "observed_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),
 "stage":"FINALIZE_END","stream_id":"crewing/930-session-activation","writer":writer,
 "driver_sha256":self_sha,"window_seconds_remaining_at_start":int(remain),"umask_declared":"0022"},
 open(out,'w'),ensure_ascii=False,indent=1)
print("ACK_START ->",out)
PYACK

python3 "$SP/preserve-evidence.py" "$MAN" run "$SP/s5-out-copy-report.json"

python3 - "$SP" "$MAN" "$WRITER" <<'PYFIN'
import json,sys,pathlib,hashlib,datetime,uuid,subprocess,os
SP=pathlib.Path(sys.argv[1]); MAN=pathlib.Path(sys.argv[2]); WRITER=sys.argv[3]
now=datetime.datetime.now(datetime.timezone.utc)
rep=json.loads((SP/'s5-out-copy-report.json').read_text())
man=json.loads(MAN.read_text())
dst=pathlib.Path(man['destination'])
# независимый пересчёт: обойти НАЗНАЧЕНИЕ и сверить с манифестом ещё раз
recount={}
for rel,rec in man['files'].items():
    p=dst/rel
    recount[rel]= p.is_file() and hashlib.sha256(p.read_bytes()).hexdigest()==rec['sha256']
ok=sum(1 for v in recount.values() if v)
rows=[l.split(None,3) for l in subprocess.run(['ps','-eo','pid,ppid,comm,args'],capture_output=True,text=True).stdout.splitlines()[1:]]
rows=[r for r in rows if len(r)==4]
def anc(pid):
    s=set()
    while pid and pid!='1':
        try: st=open(f'/proc/{pid}/stat').read().split()
        except FileNotFoundError: break
        s.add(pid); pid=st[3]
    return s
mine=anc(str(os.getpid()))
surv=[{"pid":r[0],"ppid":r[1],"comm":r[2],"mine_by_ppid":r[1] in mine or r[0] in mine}
      for r in rows if r[2] in ('cargo','rustc','git')]
after={"document":"AFTER_STAGE",
 "after_stage_event_id":f"crewing-930-s5-afterstage-{now.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}",
 "observed_at":now.isoformat(),"stage":"FINALIZE_END","stream_id":"crewing/930-session-activation",
 "declared_file_count":man['file_count'],"declared_total_bytes":man['total_bytes'],
 "copied":rep['copied'],"verified_by_reading":rep['verified_by_reading'],"mismatches":rep['mismatches'],
 "independent_recount_at_destination":{"files_matching":ok,"of":len(man['files'])},
 "verification_method":"хеш ПРОЧИТАННЫХ байт назначения, дважды: при копировании и независимым обходом; код возврата cp не использован как доказательство",
 "destination":str(dst),"manifest_sha256":hashlib.sha256(MAN.read_bytes()).hexdigest(),
 "survivors_by_ppid":surv,"umask_declared":"0022"}
json.dump(after,open(SP/'AFTER_STAGE-930-s5.json','w'),ensure_ascii=False,indent=1)
json.dump({"document":"ACK_STOP",
 "ack_stop_event_id":f"crewing-930-s5-ackstop-{now.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}",
 "ack_stop_writer":WRITER,"observed_at":now.isoformat(),
 "operations_terminated":True,"queued_operations_cancelled":True,
 "evidence":{"after_state_path":str(SP/'AFTER_STAGE-930-s5.json'),
  "after_state_sha256":hashlib.sha256((SP/'AFTER_STAGE-930-s5.json').read_bytes()).hexdigest(),
  "files_verified_by_reading":rep['verified_by_reading'],"independent_recount":ok,
  "survivors_by_ppid":surv,
  "queued_operations_note":"очередей не ставил; стадия синхронная, cargo не вызывался"}},
 open(SP/'ACK_STOP-930-s5.json','w'),ensure_ascii=False,indent=1)
print(f"AFTER_STAGE + ACK_STOP written | copied {rep['copied']}, verified {rep['verified_by_reading']}, recount {ok}/{len(man['files'])}")
PYFIN
printf 'STAGE ACTIONS COMPLETE. umask=0022 self_sha256=%s\n' "$SELF_SHA"
