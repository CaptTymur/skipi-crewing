#!/usr/bin/env bash
# Драйвер стадии IMPLEMENT, поток crewing/930-session-activation.
# Один вызов гейта — check по сертификату; остальное объявляется документами.
set -Eeuo pipefail
umask 0022                       # НАЗВАННЫЙ вход: режимы создаваемых файлов
COORD=/home/linux/Developer/skipi-parallel-coordinator
HOUSE=/home/linux/Developer/skipi-crewing
WT=/home/linux/Developer/worktrees/crewing-930-20261105
BRANCH=feature/crewing-930-red-active-session
BASE=f145c6017eaea3804a5429e5aa428b6fb0ece6d9
SP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REL=src-tauri/src/native_local_joint_tests.rs
PIN_BASE=a070d241e73018a1b156ab17aa44b36448739fecb24d778989c3538af8197d5d
PIN_POST=50774e7986d3105307c153495746a72e04d7c145899572abbfb6d2014c80831d
CERT="${1:?usage: run-930-s1.sh <certificate path>}"
SELF_SHA="$(sha256sum "${BASH_SOURCE[0]}" | cut -d" " -f1)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

# ---- 0. ВОРОТА. Принимается только PERMIT_CURRENT; иначе ни одного действия. ----
GATE_OUT="$(cd "$COORD" && python3 tools/stage_gate.py check --certificate "$CERT" 2>&1)" || {
  printf 'REFUSE: gate check exited non-zero\n%s\n' "$GATE_OUT" >&2; exit 2; }
printf '%s\n' "$GATE_OUT"
case "$GATE_OUT" in
  *PERMIT_CURRENT*) : ;;
  *) printf 'REFUSE: verdict is not PERMIT_CURRENT — no action taken\n' >&2; exit 2 ;;
esac

# ---- 1. ACK_START — НИЖЕ ворот, как требует контракт. Владелец берётся ИЗ сертификата. ----
python3 - "$CERT" "$SELF_SHA" "$SP/ACK_START-930-s1.json" "$STAMP" <<'PYACK'
import json, sys, datetime, uuid
cert, self_sha, out, stamp = sys.argv[1:5]
c = json.load(open(cert))
def pick(d, *names):
    for n in names:
        if isinstance(d, dict) and d.get(n): return d[n]
    for v in (d.values() if isinstance(d, dict) else []):
        if isinstance(v, dict):
            got = pick(v, *names)
            if got: return got
    return None
writer  = pick(c, 'writer')
expires = pick(c, 'expires_at')
now = datetime.datetime.now(datetime.timezone.utc)
rem = None
if expires:
    rem = int((datetime.datetime.fromisoformat(expires.replace('Z','+00:00')) - now).total_seconds())
doc = {
  "document": "ACK_START",
  "ack_start_event_id": f"crewing-930-s1-ackstart-{stamp}-{uuid.uuid4().hex[:8]}",
  "observed_at": now.isoformat(),
  "stage": "IMPLEMENT",
  "stream_id": "crewing/930-session-activation",
  "writer": writer,
  "writer_provenance": "скопирован из сертификата, не набран рукой",
  "driver_sha256": self_sha,
  "window_seconds_remaining_at_start": rem,
  "umask_declared": "0022",
}
json.dump(doc, open(out,'w'), ensure_ascii=False, indent=1)
print("ACK_START ->", out, "| writer:", writer, "| window_remaining:", rem)
PYACK

# ---- 2. Рабочее дерево на ЖИВОМ main (не на отставшем чекауте) ----
if [ -e "$WT" ]; then printf 'REFUSE: %s already exists\n' "$WT" >&2; exit 3; fi
git -C "$HOUSE" worktree add -b "$BRANCH" "$WT" "$BASE"
WT_HEAD="$(git -C "$WT" rev-parse HEAD)"
[ "$WT_HEAD" = "$BASE" ] || { printf 'REFUSE: worktree HEAD %s != base %s\n' "$WT_HEAD" "$BASE" >&2; exit 3; }

# ---- 3. Пин сверяется С ТЕМ САМЫМ объектом, который будет изменён ----
GOT_BASE="$(sha256sum "$WT/$REL" | cut -d" " -f1)"
[ "$GOT_BASE" = "$PIN_BASE" ] || { printf 'REFUSE: base sha %s != pinned %s\n' "$GOT_BASE" "$PIN_BASE" >&2; exit 4; }

# ---- 4. Вставка теста. Идемпотентна: повторный прогон отказывает, а не дублирует. ----
python3 - "$WT/$REL" "$SP/snippet-930-red-test.rs" <<'PYINS'
import sys, pathlib
target, snip = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]).read_text(encoding='utf-8')
text = target.read_text(encoding='utf-8')
if 'native930_joint_successful_login_activates_private_session' in text:
    sys.exit('REFUSE: the test name is already present — no duplicate insertion')
cut = text.rstrip()
assert cut.endswith('}'), 'module must end with its closing brace'
target.write_text(cut[:-1].rstrip('\n') + '\n' + snip + '}\n', encoding='utf-8')
print('inserted into', target)
PYINS
GOT_POST="$(sha256sum "$WT/$REL" | cut -d" " -f1)"
[ "$GOT_POST" = "$PIN_POST" ] || { printf 'REFUSE: post sha %s != declared %s\n' "$GOT_POST" "$PIN_POST" >&2; exit 5; }

# ---- 5. AFTER_STAGE ----
AFTER="$SP/AFTER_STAGE-930-s1.json"
python3 - "$AFTER" "$WT" "$REL" "$GOT_POST" "$WT_HEAD" "$STAMP" <<'PYAFT'
import json, sys, datetime, subprocess, uuid
out, wt, rel, post, head, stamp = sys.argv[1:7]
st = subprocess.run(['git','-C',wt,'status','--porcelain=v1','--untracked-files=normal'],
                    capture_output=True, text=True, check=True).stdout
json.dump({
 "document": "AFTER_STAGE",
 "after_stage_event_id": f"crewing-930-s1-afterstage-{stamp}-{uuid.uuid4().hex[:8]}",
 "observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
 "stage": "IMPLEMENT", "stream_id": "crewing/930-session-activation",
 "worktree": wt, "worktree_head": head, "branch_created": "feature/crewing-930-red-active-session",
 "file_changed": f"{wt}/{rel}", "file_sha256_after": post,
 "worktree_status_lines": st.count('\n'),
 "worktree_status_sha256_untrimmed": __import__('hashlib').sha256(st.encode()).hexdigest(),
 "compiled": False,
 "compiled_note": "стадия только пишет; первая типизация — в стадии VERIFY_BUILD, cargo пишет в target/",
 "umask_declared": "0022",
}, open(out,'w'), ensure_ascii=False, indent=1)
print("AFTER_STAGE ->", out)
PYAFT

# ---- 6. ACK_STOP — ПОСЛЕДНЕЕ действие стадии. Доклад идёт ПОСЛЕ него. ----
python3 - "$CERT" "$SP/ACK_STOP-930-s1.json" "$AFTER" "$GOT_POST" "$STAMP" <<'PYSTOP'
import json, sys, datetime, hashlib, uuid
cert, out, after, post, stamp = sys.argv[1:6]
c = json.load(open(cert))
def pick(d, *names):
    for n in names:
        if isinstance(d, dict) and d.get(n): return d[n]
    for v in (d.values() if isinstance(d, dict) else []):
        if isinstance(v, dict):
            got = pick(v, *names)
            if got: return got
    return None
json.dump({
 "document": "ACK_STOP",
 "ack_stop_event_id": f"crewing-930-s1-ackstop-{stamp}-{uuid.uuid4().hex[:8]}",
 "ack_stop_writer": pick(c, 'writer'),
 "observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
 "operations_terminated": True,
 "queued_operations_cancelled": True,
 "queued_operations_note": "истинно ВАКУУМНО: очереди не было — стадия синхронная, фоновых процессов не запускала",
 "evidence": {
   "after_state_path": after,
   "after_state_sha256": hashlib.sha256(open(after,'rb').read()).hexdigest(),
   "file_sha256_after": post,
 },
}, open(out,'w'), ensure_ascii=False, indent=1)
print("ACK_STOP ->", out)
PYSTOP
printf 'STAGE ACTIONS COMPLETE. umask=0022 self_sha256=%s\n' "$SELF_SHA"
