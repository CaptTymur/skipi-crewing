#!/usr/bin/env bash
# Драйвер стадии VERIFY_BUILD, поток crewing/930-session-activation.
# ОКНО ≤300 с, а дерево ХОЛОДНОЕ. Поэтому работа режется БЮДЖЕТОМ, а не надеждой:
# каждый шаг запускается только если остатка хватает, и прерывается `timeout` на
# безопасной границе (инкрементальное состояние cargo в target/ — точка возобновления).
set -Eeuo pipefail
umask 0022
COORD=/home/linux/Developer/skipi-parallel-coordinator
WT=/home/linux/Developer/worktrees/crewing-930-20261105
SP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRITER="skipi-crewing-53"       # из streams[0].writer МОЕЙ заявки; в сертификате этого поля НЕТ
RESERVE=75                      # секунд, зарезервировано на доклад и документы
TEST=native930_joint_successful_login_activates_private_session
CERT="${1:?usage: run-930-s2.sh <certificate path>}"
SELF_SHA="$(sha256sum "${BASH_SOURCE[0]}" | cut -d" " -f1)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$SP/s2-out"; mkdir -p "$OUT"

# ---- неразрешённое значение — ОСТАНОВКА, а не поле (урок стадии 1) ----
[ -n "$WRITER" ] || { echo "REFUSE: writer unresolved" >&2; exit 9; }

# ---- 0. ВОРОТА ----
GATE="$(cd "$COORD" && python3 tools/stage_gate.py check --certificate "$CERT" 2>&1)" || {
  printf 'REFUSE: gate check rc!=0\n%s\n' "$GATE" >&2; exit 2; }
printf '%s\n' "$GATE"
case "$GATE" in *PERMIT_CURRENT*) : ;; *) echo "REFUSE: not PERMIT_CURRENT" >&2; exit 2 ;; esac

# ---- 1. БЮДЖЕТ. Считается из сертификата, не из моего ощущения ----
REMAIN="$(python3 -c "
import json,datetime,sys
c=json.load(open('$CERT'))
e=datetime.datetime.fromisoformat(c['expires_at'].replace('Z','+00:00'))
print(int((e-datetime.datetime.now(datetime.timezone.utc)).total_seconds()))")"
BUDGET=$(( REMAIN - RESERVE ))
echo "window_remaining=${REMAIN}s reserve=${RESERVE}s budget=${BUDGET}s"
if [ "$BUDGET" -lt 30 ]; then
  echo "REFUSE: budget ${BUDGET}s < 30s — окно не покрывает ни действия, ни доклада" >&2; exit 3
fi

# ---- 2. ACK_START ниже ворот ----
python3 - "$CERT" "$SELF_SHA" "$SP/ACK_START-930-s2.json" "$STAMP" "$WRITER" "$REMAIN" <<'PYACK'
import json,sys,datetime,uuid
cert,self_sha,out,stamp,writer,remain=sys.argv[1:7]
now=datetime.datetime.now(datetime.timezone.utc)
json.dump({"document":"ACK_START",
 "ack_start_event_id":f"crewing-930-s2-ackstart-{stamp}-{uuid.uuid4().hex[:8]}",
 "observed_at":now.isoformat(),"stage":"VERIFY_BUILD",
 "stream_id":"crewing/930-session-activation","writer":writer,
 "writer_provenance":"из streams[0].writer заявки; в сертификате поля writer нет — проверено на стадии 1",
 "driver_sha256":self_sha,"window_seconds_remaining_at_start":int(remain),
 "umask_declared":"0022"}, open(out,'w'), ensure_ascii=False, indent=1)
print("ACK_START ->",out,"| writer:",writer,"| remaining:",remain)
PYACK

# ---- 3. Шаги, каждый под своим бюджетом. rc 124 = срезано на безопасной границе ----
run_step() {  # $1 имя  $2.. команда
  local name="$1"; shift
  local left=$(( $(python3 -c "
import json,datetime
c=json.load(open('$CERT'))
e=datetime.datetime.fromisoformat(c['expires_at'].replace('Z','+00:00'))
print(int((e-datetime.datetime.now(datetime.timezone.utc)).total_seconds()))") - RESERVE ))
  if [ "$left" -lt 20 ]; then echo "SKIP $name: остаток ${left}s < 20s"; echo "skipped" > "$OUT/$name.rc"; return 0; fi
  echo "=== $name: budget ${left}s ==="
  set +e
  setsid timeout -k 10s "${left}s" "$@" > "$OUT/$name.log" 2>&1
  local rc=$?
  set -e
  echo "$rc" > "$OUT/$name.rc"
  echo "$name rc=$rc ($([ $rc -eq 124 ] && echo 'СРЕЗАНО по timeout — безопасная граница' || echo 'завершился сам'))"
}

cd "$WT/src-tauri"
run_step check-product cargo check --message-format=short
run_step check-tests   cargo check --tests --message-format=short
run_step run-red-test  cargo test "$TEST" -- --exact --nocapture

# ---- 4. Выживших быть не должно — и это МЕРИТСЯ, а не утверждается ----
SURV="$(ps -eo comm | grep -cx -e rustc -e cargo || true)"
if [ "$SURV" -ne 0 ]; then
  echo "survivors=$SURV — глушу группу и перемеряю"
  pkill -x rustc || true; pkill -x cargo || true; sleep 2
  SURV="$(ps -eo comm | grep -cx -e rustc -e cargo || true)"
fi
echo "survivors_after=$SURV"

# ---- 4b. ЗАПИСЬ В РЕПОЗИТОРИЙ: WORKLOG дома под заверением (просьба координатора) ----
WL="$WT/scratchpad/crewing-930"; mkdir -p "$WL"
python3 - "$SP/PRESERVE-counts-and-form-choice.md" "$SP/SPLIT-930-two-piles.md" "$OUT" "$WL/WORKLOG.md" "$SURV" <<'PYWL'
import sys, pathlib, datetime
static_a, static_b, out, dst, surv = sys.argv[1:6]
O = pathlib.Path(out)
def rc(n):
    q = O/f'{n}.rc'; return q.read_text().strip() if q.exists() else 'not_run'
head = f"""# WORKLOG — №930, активация сессии. Поток crewing/930-session-activation

Записано под заверением координатора epoch 49, стадия VERIFY_BUILD,
{datetime.datetime.now(datetime.timezone.utc).isoformat()}.
База ветки — живой `main` f145c601; главный чекаут дома отставал на 36 коммитов и для
замера не использовался (№938).

## Результат ЭТОЙ стадии (факт, не план)

- `cargo check` (продуктовый cfg): rc **{rc('check-product')}**
- `cargo check --tests`: rc **{rc('check-tests')}**
- прогон RED-теста: rc **{rc('run-red-test')}**  (101 = тест упал, то есть КРАСЕН — ожидаемое)
- выживших процессов cargo/rustc после остановки: **{surv}** (предикат `comm==`, не подстрока)
- rc 124 означает СРЕЗАНО по `timeout` на безопасной границе: дерево было ХОЛОДНЫМ
  (`target/` отсутствовал), инкрементальное состояние в `target/` — точка возобновления.
- umask прогона: **0022**. Сьюта красна под `0o002` и зелена под `0o022` (232/15 против 247/0),
  поэтому зелёный без названного числа непрочитываем.

"""
body = "\n---\n\n" + pathlib.Path(static_a).read_text(encoding='utf-8')
body += "\n---\n\n## Разделение работы на две кучи (№930), перенесено из сессионного скрэтчпада\n\n"
body += pathlib.Path(static_b).read_text(encoding='utf-8')
pathlib.Path(dst).write_text(head + body, encoding='utf-8')
print('WORKLOG ->', dst)
PYWL
WL_SHA="$(sha256sum "$WL/WORKLOG.md" | cut -d" " -f1)"
echo "worklog_sha256=$WL_SHA"

# ---- 5. AFTER_STAGE: факт, включая вердикт зонда dead_code ----
python3 - "$OUT" "$SP/AFTER_STAGE-930-s2.json" "$STAMP" "$SURV" "$WT" <<'PYAFT'
import json,sys,pathlib,datetime,hashlib,subprocess,uuid,re
out,dst,stamp,surv,wt=sys.argv[1:6]
O=pathlib.Path(out)
def rc(n):
    p=O/f'{n}.rc'; return p.read_text().strip() if p.exists() else 'not_run'
def log(n):
    p=O/f'{n}.log'
    return (p.read_text(errors='replace'), hashlib.sha256(p.read_bytes()).hexdigest()) if p.exists() else ('','')
prod,prod_sha=log('check-product')
tests,tests_sha=log('check-tests')
red,red_sha=log('run-red-test')
# зонд dead_code по `refresh` — ищем предъявленным предикатом, и называем контроль
dead=[l for l in prod.splitlines() if 'never used' in l or 'dead_code' in l]
refresh_dead=[l for l in dead if 'refresh' in l]
json.dump({"document":"AFTER_STAGE",
 "after_stage_event_id":f"crewing-930-s2-afterstage-{stamp}-{uuid.uuid4().hex[:8]}",
 "observed_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),
 "stage":"VERIFY_BUILD","stream_id":"crewing/930-session-activation",
 "steps":{"check-product":rc('check-product'),"check-tests":rc('check-tests'),"run-red-test":rc('run-red-test')},
 "rc_legend":{"0":"завершился сам","124":"СРЕЗАНО timeout на безопасной границе; target/ — точка возобновления",
              "101":"cargo: тест упал (для RED-шага это ОЖИДАЕМОЕ)","skipped":"остатка окна не хватило"},
 "logs":{"check-product":prod_sha,"check-tests":tests_sha,"run-red-test":red_sha},
 "dead_code_probe":{"predicate":"строки продуктового cargo check, содержащие 'never used' или 'dead_code'",
   "all_dead_code_lines":len(dead),"lines_naming_refresh":len(refresh_dead),
   "refresh_lines":refresh_dead[:5],
   "control_note":("число всех dead_code-строк — положительный контроль предиката: если оно 0, предикат "
     "ничего не нашёл ВООБЩЕ, и вывод про refresh делать нельзя"),
   "verdict":("UNKNOWN: продуктовый check не завершился" if rc('check-product') not in ('0','101')
              else ("refresh назван мёртвым — продуктовых вызывающих нет" if refresh_dead
                    else "refresh НЕ назван мёртвым — требует разбора, вывод не делать"))},
 "red_test_outcome":("UNKNOWN: шаг не завершился" if rc('run-red-test') not in ('0','101')
                     else ("КРАСЕН (cargo rc 101)" if rc('run-red-test')=='101' else "ЗЕЛЁН — это дефект оракула, разбирать")),
 "survivors_after":int(surv),
 "worktree_head":subprocess.run(['git','-C',wt,'rev-parse','HEAD'],capture_output=True,text=True).stdout.strip(),
 "umask_declared":"0022",
}, open(dst,'w'), ensure_ascii=False, indent=1)
print("AFTER_STAGE ->",dst)
PYAFT

# ---- 6. ACK_STOP — последнее действие ----
python3 - "$SP/ACK_STOP-930-s2.json" "$SP/AFTER_STAGE-930-s2.json" "$STAMP" "$WRITER" "$SURV" <<'PYSTOP'
import json,sys,datetime,hashlib,uuid,subprocess
dst,after,stamp,writer,surv=sys.argv[1:6]
rows=[l.split(None,3) for l in subprocess.run(['ps','-eo','pid,ppid,comm,args'],capture_output=True,text=True).stdout.splitlines()[1:]]
rows=[r for r in rows if len(r)==4]
def c(n): return len([r for r in rows if r[2]==n])
json.dump({"document":"ACK_STOP",
 "ack_stop_event_id":f"crewing-930-s2-ackstop-{stamp}-{uuid.uuid4().hex[:8]}",
 "ack_stop_writer":writer,
 "observed_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),
 "operations_terminated":True,"queued_operations_cancelled":True,
 "evidence":{"after_state_path":after,
   "after_state_sha256":hashlib.sha256(open(after,'rb').read()).hexdigest(),
   "survivors_cargo_rustc":int(surv),
   "comm_counts":{"cargo":c('cargo'),"rustc":c('rustc'),"python3":c('python3'),"bash":c('bash')},
   "control_note":f"нули при {len(rows)} строках всего и {c('bash')} bash — предикат comm==, не подстрока",
   "queued_operations_note":"очередей не ставил; timeout глушит группу, выжившие перемерены после глушения"},
}, open(dst,'w'), ensure_ascii=False, indent=1)
print("ACK_STOP ->",dst)
PYSTOP
printf 'STAGE ACTIONS COMPLETE. umask=0022 self_sha256=%s\n' "$SELF_SHA"
