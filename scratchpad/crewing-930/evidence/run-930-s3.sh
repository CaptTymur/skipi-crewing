#!/usr/bin/env bash
# Драйвер стадии VERIFY_BUILD-2, поток crewing/930-session-activation.
# Предмет: ИЗМЕРИТЬ красноту RED-теста, с двумя контролями — наводка оракула (`--list` обязан
# дать ровно два совпадения) и способность харнесса покраснеть (одноразовый контрольный тест,
# снимаемый обратной правкой байтов в той же стадии).
set -Eeuo pipefail
umask 0022
COORD=/home/linux/Developer/skipi-parallel-coordinator
WT=/home/linux/Developer/worktrees/crewing-930-20261105
REL=src-tauri/src/native_local_joint_tests.rs
SP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRITER="skipi-crewing-53"
RESERVE=75
FILTER=native930
SHA_START=50774e7986d3105307c153495746a72e04d7c145899572abbfb6d2014c80831d
SHA_A=4ab2cc553487b28d74d375d0c774b9495d7f615c38bba9b34787129a8ae88717
SHA_B=$SHA_START
CERT="${1:?usage: run-930-s3.sh <certificate path>}"
SELF_SHA="$(sha256sum "${BASH_SOURCE[0]}" | cut -d" " -f1)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$SP/s3-out"; mkdir -p "$OUT"
[ -n "$WRITER" ] || { echo "REFUSE: writer unresolved" >&2; exit 9; }

left() { python3 -c "
import json,datetime
c=json.load(open('$CERT'))
e=datetime.datetime.fromisoformat(c['expires_at'].replace('Z','+00:00'))
print(int((e-datetime.datetime.now(datetime.timezone.utc)).total_seconds()))"; }

# ---- 0. ВОРОТА ----
GATE="$(cd "$COORD" && python3 tools/stage_gate.py check --certificate "$CERT" 2>&1)" || {
  printf 'REFUSE: gate rc!=0\n%s\n' "$GATE" >&2; exit 2; }
printf '%s\n' "$GATE"
case "$GATE" in *PERMIT_CURRENT*) : ;; *) echo "REFUSE: not PERMIT_CURRENT" >&2; exit 2 ;; esac
REMAIN="$(left)"; BUDGET=$(( REMAIN - RESERVE ))
echo "remaining=${REMAIN}s reserve=${RESERVE}s budget=${BUDGET}s"
[ "$BUDGET" -ge 40 ] || { echo "REFUSE: budget ${BUDGET}s < 40s" >&2; exit 3; }

# ---- 1. ACK_START ----
python3 - "$CERT" "$SELF_SHA" "$SP/ACK_START-930-s3.json" "$STAMP" "$WRITER" "$REMAIN" <<'PYACK'
import json,sys,datetime,uuid
cert,self_sha,out,stamp,writer,remain=sys.argv[1:7]
json.dump({"document":"ACK_START",
 "ack_start_event_id":f"crewing-930-s3-ackstart-{stamp}-{uuid.uuid4().hex[:8]}",
 "observed_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),
 "stage":"VERIFY_BUILD","stream_id":"crewing/930-session-activation","writer":writer,
 "driver_sha256":self_sha,"window_seconds_remaining_at_start":int(remain),
 "umask_declared":"0022"}, open(out,'w'), ensure_ascii=False, indent=1)
print("ACK_START ->",out,"| remaining:",remain)
PYACK

# ---- 2. Пин сверяется с тем самым объектом ----
GOT="$(sha256sum "$WT/$REL" | cut -d" " -f1)"
[ "$GOT" = "$SHA_START" ] || { echo "REFUSE: start sha $GOT != $SHA_START" >&2; exit 4; }

# ---- 3. СОСТОЯНИЕ A: вставка одноразового контроля ----
python3 - "$WT/$REL" "$SP/snippet-930-control-must-fail.rs" <<'PYINS'
import sys, pathlib
t, snip = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]).read_text(encoding='utf-8')
text = t.read_text(encoding='utf-8')
if 'native930_zzz_control_must_fail_delete_me_before_commit' in text:
    sys.exit('REFUSE: control already present')
cut = text.rstrip(); assert cut.endswith('}')
t.write_text(cut[:-1].rstrip('\n') + '\n' + snip + '}\n', encoding='utf-8')
print('control inserted')
PYINS
GOT_A="$(sha256sum "$WT/$REL" | cut -d" " -f1)"
[ "$GOT_A" = "$SHA_A" ] || { echo "REFUSE: state A sha $GOT_A != $SHA_A" >&2; exit 5; }
echo "state_A=$GOT_A (объявлено заранее)"

cd "$WT/src-tauri"
# ---- 4. НАВОДКА ОРАКУЛА: --list обязан дать РОВНО ДВА совпадения ----
B="$(( $(left) - RESERVE ))"
if [ "$B" -ge 20 ]; then
  set +e; setsid timeout -k 10s "${B}s" cargo test "$FILTER" -- --list > "$OUT/list.log" 2>&1; echo $? > "$OUT/list.rc"; set -e
else echo skipped > "$OUT/list.rc"; fi
echo "list rc=$(cat "$OUT/list.rc")"

# ---- 5. ОДИН ВЫЗОВ на оба теста ----
B="$(( $(left) - RESERVE ))"
if [ "$B" -ge 20 ]; then
  set +e; setsid timeout -k 10s "${B}s" cargo test "$FILTER" -- --nocapture > "$OUT/run.log" 2>&1; echo $? > "$OUT/run.rc"; set -e
else echo skipped > "$OUT/run.rc"; fi
echo "run rc=$(cat "$OUT/run.rc")"

# ---- 6. СОСТОЯНИЕ B: снятие контроля ОБРАТНОЙ ПРАВКОЙ БАЙТОВ, не git checkout ----
python3 - "$WT/$REL" "$SP/snippet-930-control-must-fail.rs" <<'PYDEL'
import sys, pathlib
t, snip = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]).read_text(encoding='utf-8')
text = t.read_text(encoding='utf-8')
if snip not in text: sys.exit('REFUSE: control block not found verbatim — не снимаю угадыванием')
t.write_text(text.replace(snip, '', 1), encoding='utf-8')
print('control removed by inverse edit')
PYDEL
GOT_B="$(sha256sum "$WT/$REL" | cut -d" " -f1)"
[ "$GOT_B" = "$SHA_B" ] || { echo "REFUSE: state B sha $GOT_B != $SHA_B" >&2; exit 6; }
echo "state_B=$GOT_B (равен пост-образу стадии 1)"

# ---- 7. Выжившие: comm== И атрибуция по ppid ----
python3 - "$OUT/survivors.json" <<'PYSURV'
import json,sys,subprocess,os
rows=[l.split(None,3) for l in subprocess.run(['ps','-eo','pid,ppid,comm,args'],
      capture_output=True,text=True).stdout.splitlines()[1:]]
rows=[r for r in rows if len(r)==4]
def anc(pid):
    out=[]
    while pid and pid!='1':
        try: st=open(f'/proc/{pid}/stat').read().split()
        except FileNotFoundError: break
        out.append(pid); pid=st[3]
    return set(out)
mine=anc(str(os.getpid()))
hits=[{"pid":r[0],"ppid":r[1],"comm":r[2],"args":r[3][:120],
       "mine_by_ppid": (r[1] in mine or r[0] in mine)}
      for r in rows if r[2] in ('cargo','rustc','git')]
json.dump({"counts":{n:len([r for r in rows if r[2]==n]) for n in ('cargo','rustc','git')},
 "attribution_by_ppid":hits,
 "controls":{"total_rows":len(rows),"bash":len([r for r in rows if r[2]=='bash']),
             "python3":len([r for r in rows if r[2]=='python3'])},
 "note":"атрибуция по ppid, не по comm: имя процесса не отличает мою сборку от чужой команды того же имени"},
 open(sys.argv[1],'w'), ensure_ascii=False, indent=1)
print("survivors ->", json.load(open(sys.argv[1]))["counts"])
PYSURV

# ---- 8. AFTER_STAGE: состав результата, а не код возврата ----
python3 - "$OUT" "$SP/AFTER_STAGE-930-s3.json" "$STAMP" "$GOT_A" "$GOT_B" <<'PYAFT'
import json,sys,pathlib,re,datetime,hashlib,uuid
out,dst,stamp,sha_a,sha_b=sys.argv[1:6]
O=pathlib.Path(out)
def rd(n):
    p=O/n; return p.read_text(errors='replace') if p.exists() else ''
def rc(n):
    p=O/n; return p.read_text().strip() if p.exists() else 'not_run'
listlog, runlog = rd('list.log'), rd('run.log')
listed=[l.strip() for l in listlog.splitlines() if l.strip().endswith(': test')]
res=re.findall(r'test result:\s*(\w+)\.\s*(\d+) passed;\s*(\d+) failed;.*?(\d+) filtered out', runlog)
comp=[{"verdict":a,"passed":int(b),"failed":int(c),"filtered_out":int(d)} for a,b,c,d in res]
executed=sum(x["passed"]+x["failed"] for x in comp)
failures=re.findall(r'^\s*(\S+)\s+stdout:|^failures:\s*$|^\s{4}(\S+)$', runlog, re.M)
# какие именно утверждения упали
asserts=re.findall(r"assertion.*?\n?.*?No\.930[^\n]*", runlog)
ctrl_failed = 'native930_zzz_control_must_fail_delete_me_before_commit' in runlog and 'FAILED' in runlog
json.dump({"document":"AFTER_STAGE",
 "after_stage_event_id":f"crewing-930-s3-afterstage-{stamp}-{uuid.uuid4().hex[:8]}",
 "observed_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),
 "stage":"VERIFY_BUILD","stream_id":"crewing/930-session-activation",
 "both_tree_states_declared":{"state_A_with_control":sha_a,"state_B_after_removal":sha_b,
   "state_B_equals_stage1_post_image":sha_b=="50774e7986d3105307c153495746a72e04d7c145899572abbfb6d2014c80831d",
   "removal_method":"обратная правка байтов тем же блоком, не git checkout"},
 "oracle_aim_control":{"list_rc":rc('list.rc'),"tests_listed":len(listed),"names":listed[:6],
   "required":"ровно 2","passed_control":len(listed)==2},
 "redden_control":{"control_test_present_in_run":ctrl_failed,
   "note":"контроль одноразовый: доказывает, что харнесс сообщает падение именно в этом прогоне"},
 "result_composition":comp,"executed_total":executed,
 "verdict_predicate":"СОСТАВ результата, не код возврата (rc 0 у cargo означает и «прошёл», и «ничего не совпало»)",
 "run_rc_for_reference":rc('run.rc'),
 "failed_assertions_naming_No930":asserts[:4],
 "logs":{"list.log":hashlib.sha256((O/'list.log').read_bytes()).hexdigest() if (O/'list.log').exists() else None,
         "run.log":hashlib.sha256((O/'run.log').read_bytes()).hexdigest() if (O/'run.log').exists() else None},
 "dead_code_probe_not_rerun":("НЕ прогонялся намеренно: ответ уже измерен в evidence стадии 2 "
   "(s2-out/run-red-test.log, формат по умолчанию, строки 601+) — `refresh` назван в групповом "
   "диагностике вместе с девятью другими методами. Повторять прогон ради формата значило бы "
   "тратить окно на уже доказанное."),
 "umask_declared":"0022",
}, open(dst,'w'), ensure_ascii=False, indent=1)
print("AFTER_STAGE ->",dst,"| executed:",executed,"| listed:",len(listed))
PYAFT

# ---- 9. ACK_STOP последним ----
python3 - "$SP/ACK_STOP-930-s3.json" "$SP/AFTER_STAGE-930-s3.json" "$OUT/survivors.json" "$STAMP" "$WRITER" <<'PYSTOP'
import json,sys,datetime,hashlib,uuid
dst,after,surv,stamp,writer=sys.argv[1:6]
s=json.load(open(surv))
json.dump({"document":"ACK_STOP",
 "ack_stop_event_id":f"crewing-930-s3-ackstop-{stamp}-{uuid.uuid4().hex[:8]}",
 "ack_stop_writer":writer,
 "observed_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),
 "operations_terminated":True,"queued_operations_cancelled":True,
 "evidence":{"after_state_path":after,
   "after_state_sha256":hashlib.sha256(open(after,'rb').read()).hexdigest(),
   "survivors":s,
   "queued_operations_note":"очередей не ставил; timeout глушит группу"}},
 open(dst,'w'), ensure_ascii=False, indent=1)
print("ACK_STOP ->",dst)
PYSTOP
printf 'STAGE ACTIONS COMPLETE. umask=0022 self_sha256=%s\n' "$SELF_SHA"
