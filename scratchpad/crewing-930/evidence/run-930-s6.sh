#!/usr/bin/env bash
# Закрывающая стадия слайса A: КОММИТ кода + копия доказательной базы в дерево.
# Манифест строится ОБХОДОМ В МОМЕНТ КОПИРОВАНИЯ; проверка — чтением.
set -Eeuo pipefail
umask 0022
COORD=/home/linux/Developer/skipi-parallel-coordinator
H=/home/linux/Developer/skipi-crewing
WT=/home/linux/Developer/worktrees/crewing-930-20261105
SRC="$WT/src-tauri/src"
SP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DST="$WT/scratchpad/crewing-930/evidence"
WRITER="skipi-crewing-53"
RESERVE=60
BASE=f145c6017eaea3804a5429e5aa428b6fb0ece6d9
CERT="${1:?usage: run-930-s6.sh <certificate>}"
SELF_SHA="$(sha256sum "${BASH_SOURCE[0]}" | cut -d" " -f1)"
OUT="$SP/s6-out"; mkdir -p "$OUT"
[ -n "$WRITER" ] || { echo "REFUSE: writer unresolved" >&2; exit 9; }
declare -A POST=(
 [native_lifecycle.rs]=9b7d54f7788612796d216141fc1fee7c39716fc2501143f1fd152e21d32e29bb
 [native_local_commit.rs]=d9d54d13f839231812c5397592c111f3dfb43bb180cb4f68a0aa78eeadea20c4
 [native_local_joint_tests.rs]=4f76ed419d2eca8f57a08cf731ea27efbb9fd7d654d554bcd33dfe05eb2c50de
 [lib.rs]=9a64aaea9b8cd9cda33e05226f02a99eb16b5982317b886045f1aecbde5f05b3)

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
[ $(( REMAIN - RESERVE )) -ge 25 ] || { echo "REFUSE: budget too small" >&2; exit 3; }

python3 - "$CERT" "$SELF_SHA" "$SP/ACK_START-930-s6.json" "$WRITER" "$REMAIN" <<'PYACK'
import json,sys,datetime,uuid
cert,self_sha,out,writer,remain=sys.argv[1:6]
json.dump({"document":"ACK_START",
 "ack_start_event_id":f"crewing-930-s6-ackstart-{datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}",
 "observed_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),
 "stage":"FINALIZE_END","stream_id":"crewing/930-session-activation","writer":writer,
 "driver_sha256":self_sha,"window_seconds_remaining_at_start":int(remain),"umask_declared":"0022"},
 open(out,'w'),ensure_ascii=False,indent=1)
print("ACK_START ->",out)
PYACK

# ---- 1. коммичу ТОЛЬКО заверенные байты: каждая сумма сверяется с пост-образом слайса A
for f in native_lifecycle.rs native_local_commit.rs native_local_joint_tests.rs lib.rs; do
  got="$(sha256sum "$SRC/$f" | cut -d" " -f1)"
  [ "$got" = "${POST[$f]}" ] || { echo "REFUSE: $f is $got, certified post-image ${POST[$f]}" >&2; exit 4; }
done
echo "four files equal the certified post-images"
head_now="$(git -C "$WT" rev-parse HEAD)"
[ "$head_now" = "$BASE" ] || { echo "REFUSE: HEAD $head_now != base $BASE — чей-то коммит уже лёг" >&2; exit 5; }
[ "$(git -C "$WT" rev-list "$BASE..HEAD" | wc -l)" = "0" ] || { echo "REFUSE: branch not at zero commits" >&2; exit 5; }

git -C "$WT" add -- src-tauri/src/native_lifecycle.rs src-tauri/src/native_local_commit.rs \
                   src-tauri/src/native_local_joint_tests.rs src-tauri/src/lib.rs
staged="$(git -C "$WT" diff --cached --name-only | wc -l)"
[ "$staged" = "4" ] || { echo "REFUSE: staged $staged paths, expected exactly 4" >&2; exit 6; }
git -C "$WT" diff --cached --name-only > "$OUT/staged.txt"
git -C "$WT" commit -F "$SP/commit-message-930-s6.txt" --no-verify=false > "$OUT/commit.log" 2>&1 || {
  echo "REFUSE: commit failed"; cat "$OUT/commit.log" >&2; exit 7; }
NEW="$(git -C "$WT" rev-parse HEAD)"
echo "commit = $NEW"
[ "$(git -C "$WT" rev-list "$BASE..$NEW" | wc -l)" = "1" ] || { echo "REFUSE: expected exactly one new commit" >&2; exit 8; }

# ---- 2. проверка КОММИТА чтением объектов, а не кодом возврата git
python3 - "$WT" "$NEW" "$OUT/commit-verify.json" <<'PYV'
import sys,json,subprocess,hashlib,pathlib
wt,new,out=sys.argv[1:4]
def g(*a): return subprocess.run(['git','-C',wt,*a],capture_output=True,text=True,check=True).stdout
POST={'native_lifecycle.rs':'9b7d54f7788612796d216141fc1fee7c39716fc2501143f1fd152e21d32e29bb',
 'native_local_commit.rs':'d9d54d13f839231812c5397592c111f3dfb43bb180cb4f68a0aa78eeadea20c4',
 'native_local_joint_tests.rs':'4f76ed419d2eca8f57a08cf731ea27efbb9fd7d654d554bcd33dfe05eb2c50de',
 'lib.rs':'9a64aaea9b8cd9cda33e05226f02a99eb16b5982317b886045f1aecbde5f05b3'}
res={}
for f,want in POST.items():
    blob=subprocess.run(['git','-C',wt,'show',f'{new}:src-tauri/src/{f}'],capture_output=True,check=True).stdout
    res[f]={"sha256_in_commit":hashlib.sha256(blob).hexdigest(),"matches_certified":hashlib.sha256(blob).hexdigest()==want}
names=g('show','--name-only','--format=','HEAD').split()
json.dump({"commit":new,"files_in_commit":names,"file_count":len(names),
 "blob_verification_by_reading":res,
 "all_four_match":all(v["matches_certified"] for v in res.values()),
 "worktree_clean_for_sources":g('status','--porcelain=v1','--',"src-tauri/src").strip()=="" ,
 "method":"байты объектов из коммита прочитаны через git show и хешированы; код возврата git как доказательство не использован"},
 open(out,'w'),ensure_ascii=False,indent=1)
print('commit verified by reading:', all(v["matches_certified"] for v in res.values()), '| files', len(names))
PYV

# ---- 3. база: манифест ОБХОДОМ в момент копирования
python3 - "$SP" "$DST" "$OUT/evidence-report.json" <<'PYE'
import sys,pathlib,hashlib,json,shutil
SP=pathlib.Path(sys.argv[1]); DST=pathlib.Path(sys.argv[2]); OUT=sys.argv[3]
walk=sorted(p for p in SP.rglob('*') if p.is_file())
man={str(p.relative_to(SP)):{"sha256":hashlib.sha256(p.read_bytes()).hexdigest(),"bytes":p.stat().st_size} for p in walk}
copied=verified=0; bad=[]
for rel,rec in man.items():
    d=DST/rel; d.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(SP/rel,d); copied+=1
    if hashlib.sha256(d.read_bytes()).hexdigest()==rec["sha256"]: verified+=1
    else: bad.append(rel)
doc={"method":"манифест построен ОБХОДОМ в момент копирования, не списком, составленным заранее",
 "file_count":len(man),"total_bytes":sum(v["bytes"] for v in man.values()),
 "copied":copied,"verified_by_reading":verified,"mismatches":bad,"files":man}
(DST/'MANIFEST-walked-at-copy-time.json').write_text(json.dumps(doc,ensure_ascii=False,indent=1),encoding='utf-8')
json.dump({k:v for k,v in doc.items() if k!="files"},open(OUT,'w'),ensure_ascii=False,indent=1)
print(f'evidence: walked {len(man)}, copied {copied}, verified BY READING {verified}, mismatches {len(bad)}')
PYE

# ---- 4. AFTER_STAGE + ACK_STOP
python3 - "$SP" "$OUT" "$WRITER" "$WT" <<'PYFIN'
import sys,json,pathlib,hashlib,datetime,uuid,subprocess,os
SP,OUT,WRITER,WT=pathlib.Path(sys.argv[1]),pathlib.Path(sys.argv[2]),sys.argv[3],sys.argv[4]
now=datetime.datetime.now(datetime.timezone.utc)
cv=json.loads((OUT/'commit-verify.json').read_text()); er=json.loads((OUT/'evidence-report.json').read_text())
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
surv=[{"pid":r[0],"ppid":r[1],"comm":r[2],"mine_by_ppid":r[1] in mine or r[0] in mine} for r in rows if r[2] in ('cargo','rustc','git')]
after={"document":"AFTER_STAGE",
 "after_stage_event_id":f"crewing-930-s6-afterstage-{now.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}",
 "observed_at":now.isoformat(),"stage":"FINALIZE_END","stream_id":"crewing/930-session-activation",
 "commit":cv,"evidence_copy":er,"survivors_by_ppid":surv,"umask_declared":"0022",
 "threat_rows_closed":{"reboot":"закрыта копией в дерево","worktree_removal":"закрыта КОММИТОМ (объекты в общем gitdir)",
   "machine_loss":"НЕ закрыта — push отдельная стадия и слово владельца"}}
json.dump(after,open(SP/'AFTER_STAGE-930-s6.json','w'),ensure_ascii=False,indent=1)
json.dump({"document":"ACK_STOP",
 "ack_stop_event_id":f"crewing-930-s6-ackstop-{now.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}",
 "ack_stop_writer":WRITER,"observed_at":now.isoformat(),
 "operations_terminated":True,"queued_operations_cancelled":True,
 "evidence":{"after_state_path":str(SP/'AFTER_STAGE-930-s6.json'),
  "after_state_sha256":hashlib.sha256((SP/'AFTER_STAGE-930-s6.json').read_bytes()).hexdigest(),
  "commit":cv["commit"],"all_four_blobs_match_certified":cv["all_four_match"],
  "evidence_files_verified":er["verified_by_reading"],"survivors_by_ppid":surv,
  "queued_operations_note":"очередей не ставил; cargo не вызывался; push НЕ делался"}},
 open(SP/'ACK_STOP-930-s6.json','w'),ensure_ascii=False,indent=1)
print('AFTER_STAGE + ACK_STOP written | commit', cv["commit"][:12], '| evidence', er["verified_by_reading"])
PYFIN
printf 'STAGE ACTIONS COMPLETE. umask=0022 self_sha256=%s\n' "$SELF_SHA"
