#!/bin/bash
# No.898 F12 - apply the dry-run-proven patch and verify. Usage: run-s2-f12.sh <certificate>
# Every declared outcome has a line that EXITS on it; `set -e` is not relied upon alone.
set -uo pipefail

# ---- GATE 0: the driver names the bytes that are RUNNING, before anything else. ----
# Rule bought by my own superseded digest on the vehicle stage: a reviewer must measure the
# bytes that executed, not the bytes they read. $0 is the file being executed; if a launch
# ever comes through a pipe or `bash -c`, $0 stops naming the subject and this line says so.
case "$0" in
  -*|bash|sh|"") echo "STOP: \$0 does not name a file ('$0') - the driver cannot hash its own subject"; exit 1 ;;
esac
DRIVER_SHA=$(sha256sum "$0" | cut -d" " -f1)
echo "driver_sha256=$DRIVER_SHA"

CERT="${1:-}"
HOME_REPO=/home/linux/Developer/skipi-crewing
WT=/home/linux/Developer/worktrees/crewing-898-20261104
GATE=/home/linux/Developer/skipi-parallel-coordinator/tools/stage_gate.py
PATCH="$HOME_REPO/scratchpad/crewing-898/coord/patch-s2-f12.py"
LOGS="$HOME_REPO/scratchpad/crewing-898/stage-implement-f12"
DIST_PRE=2f0bded661d64d6b0d5a914216685df6b041903ad09bfaf62da84a7d361c9930
HARN_PRE=894e3e3c0687c4cdbcd9662e1e249887680b44ac2852d657f0464e98483594f4
DIST_POST=9f1bd2f9467463246c6d30fc33ae463ff70177dda4118db531edc8e088f1496a
HARN_POST=bcab85b6fbb859dbf009c8042978380bd5c9a082327fa4bfce02f63ed10dbc0a
BASE=f145c6017eaea3804a5429e5aa428b6fb0ece6d9
WANT_PASSED=141
MIN_SECONDS=30

say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
dsha() { sha256sum "$1" | cut -d" " -f1; }

# ---- GATE 1: AUTHORITY. Only PERMIT_CURRENT, matched not read. ----
[ -n "$CERT" ] || { say "STOP: no certificate path given"; exit 2; }
[ -f "$CERT" ] || { say "STOP: certificate not a file: $CERT"; exit 2; }
if ! python3 "$GATE" check --certificate "$CERT" | grep -q PERMIT_CURRENT; then
    say "STOP: gate did not return PERMIT_CURRENT"; exit 3
fi
say "gate: PERMIT_CURRENT"

# ---- GATE 2: PRUDENCE. Window from the CERTIFICATE, never from a message. ----
LEFT=$(python3 - "$CERT" <<'PYEOF'
import json,sys
from datetime import datetime, timezone
c=json.load(open(sys.argv[1]))
exp=c.get("expires_at") or c.get("lease",{}).get("expires_at")
if not exp:
    print("NOFIELD"); raise SystemExit(0)
print(int((datetime.fromisoformat(exp)-datetime.now(timezone.utc)).total_seconds()))
PYEOF
)
case "$LEFT" in
    NOFIELD) say "STOP: expires_at absent - refusing rather than reporting a fit I cannot compute"; exit 4 ;;
    ''|*[!0-9-]*) say "STOP: window remainder unparseable: '$LEFT'"; exit 4 ;;
esac
[ "$LEFT" -ge "$MIN_SECONDS" ] || { say "STOP: only ${LEFT}s left, threshold ${MIN_SECONDS}s"; exit 4; }
say "window: ${LEFT}s remaining (measured need: patch <1s + harness ~0.54s)"

# ---- GATE 3: preconditions, each with its own exit ----
[ -n "${ACK_EVENT_ID:-}" ] || { say "STOP: ACK_EVENT_ID not in environment"; exit 5; }
[ -n "${ACK_STOP_EVENT_ID:-}" ] || { say "STOP: ACK_STOP_EVENT_ID not in environment - the terminal action needs its OWN id"; exit 5; }
[ "$ACK_EVENT_ID" != "$ACK_STOP_EVENT_ID" ] || { say "STOP: start and stop ids are identical - two terminal actions would be indistinguishable"; exit 5; }
[ -f "$PATCH" ] || { say "STOP: patch script absent"; exit 6; }
WT_HEAD=$(git -C "$WT" rev-parse HEAD)
[ "$WT_HEAD" = "$BASE" ] || { say "STOP: worktree HEAD $WT_HEAD != base $BASE"; exit 7; }
WT_DIRTY=$(git -C "$WT" status --porcelain=v1 --untracked-files=all | wc -l)
[ "$WT_DIRTY" -eq 0 ] || { say "STOP: worktree is not clean ($WT_DIRTY lines) before the write"; exit 7; }
D0=$(dsha "$WT/dist/index.html"); H0=$(dsha "$WT/tests/crewing635_public_settings_harness.mjs")
[ "$D0" = "$DIST_PRE" ] || { say "STOP: dist PRE $D0 != pinned $DIST_PRE"; exit 8; }
[ "$H0" = "$HARN_PRE" ] || { say "STOP: harness PRE $H0 != pinned $HARN_PRE"; exit 8; }
CANON_TRACKED_BEFORE=$(git -C "$HOME_REPO" status --porcelain=v1 --untracked-files=no | wc -l)
say "preconditions: worktree clean at base, both PRE digests match pins, canonical tracked lines=$CANON_TRACKED_BEFORE"

# ---- ACK_START written by the SCRIPT, after the gates, before any other write ----
mkdir -p "$LOGS" || { say "STOP: cannot create declared log dir"; exit 9; }
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
ACK="$LOGS/ACK_START-$STAMP.json"
[ ! -e "$ACK" ] || { say "STOP: an ACK_START already exists under this stamp"; exit 9; }
python3 - "$ACK" "$ACK_EVENT_ID" "$LEFT" "$DRIVER_SHA" <<'PYEOF'
import json,sys
from datetime import datetime, timezone
p,ev,left,dsha=sys.argv[1:5]
json.dump({"document":"ACK_START","ack_start_event_id":ev,
  "observed_at":datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
  "stage":"IMPLEMENT","stream_id":"crewing/898-client-slice",
  "writer":"crewing-writer@skipi-crewing-17",
  "driver_sha256":dsha,
  "window_seconds_remaining_at_start":int(left)},
  open(p,"w"), ensure_ascii=False, indent=2)
PYEOF
say "ACK_START written: $ACK (driver_sha256=$DRIVER_SHA)"

# ---- THE MUTATION: the dry-run-proven patch, with its own PRE guard ----
if ! python3 "$PATCH" "$WT" --expect-pre "dist/index.html=$DIST_PRE,tests/crewing635_public_settings_harness.mjs=$HARN_PRE" > "$LOGS/patch.log" 2>&1; then
    say "STOP: patch refused or failed - see $LOGS/patch.log; NOT cleaning up"; exit 10
fi
D1=$(dsha "$WT/dist/index.html"); H1=$(dsha "$WT/tests/crewing635_public_settings_harness.mjs")
[ "$D1" = "$DIST_POST" ] || { say "STOP: dist POST $D1 != the digest pinned in the request $DIST_POST"; exit 11; }
[ "$H1" = "$HARN_POST" ] || { say "STOP: harness POST $H1 != the digest pinned in the request $HARN_POST"; exit 11; }
say "patch applied; both POST digests equal the values pinned in the request"

# ---- VERIFY: the harness must give exactly the dry-run numbers, or this EXITS ----
node "$WT/tests/crewing635_public_settings_harness.mjs" > "$LOGS/harness.log" 2>"$LOGS/harness.err"
SUM=$(python3 - "$LOGS/harness.log" "$WANT_PASSED" <<'PYEOF'
import json,sys
want=int(sys.argv[2])
last=None
for ln in open(sys.argv[1]):
    ln=ln.strip()
    if ln.startswith("{") and '"passed"' in ln: last=ln
if last is None: print("NOSUMMARY"); raise SystemExit(0)
d=json.loads(last)
print("OK" if (d.get("passed")==want and d.get("failed")==0 and d.get("setup_errors")==0)
      else "MISMATCH passed=%s failed=%s setup=%s" % (d.get("passed"),d.get("failed"),d.get("setup_errors")))
PYEOF
)
case "$SUM" in
  OK) say "harness: $WANT_PASSED passed / 0 failed / 0 setup_errors - equals the dry run" ;;
  NOSUMMARY) say "STOP: harness produced no summary line - instrument failure, not a pass"; exit 12 ;;
  *) say "STOP: harness $SUM"; exit 12 ;;
esac

# ---- AFTER: establish what happened to the world, then compare ----
CANON_TRACKED_AFTER=$(git -C "$HOME_REPO" status --porcelain=v1 --untracked-files=no | wc -l)
{
  echo "driver_sha256=$DRIVER_SHA"
  echo "worktree_head=$(git -C "$WT" rev-parse HEAD)"
  echo "worktree_branch=$(git -C "$WT" rev-parse --abbrev-ref HEAD)"
  echo "dist_pre=$D0"; echo "dist_post=$D1"; echo "dist_post_expected=$DIST_POST"
  echo "harness_pre=$H0"; echo "harness_post=$H1"; echo "harness_post_expected=$HARN_POST"
  echo "worktree_changed_files=$(git -C "$WT" status --porcelain=v1 --untracked-files=all | wc -l)"
  git -C "$WT" status --porcelain=v1 --untracked-files=all
  echo "canonical_tracked_lines_before=$CANON_TRACKED_BEFORE"
  echo "canonical_tracked_lines_after=$CANON_TRACKED_AFTER"
  echo "canonical_head=$(git -C "$HOME_REPO" rev-parse HEAD)"
  echo "harness_summary=$(tail -1 "$LOGS/harness.log")"
} > "$LOGS/after.txt"
say "after-state written: $LOGS/after.txt"

# ---- ACK_STOP: the stage's LAST action, with its OWN id ----
STOP="$LOGS/ACK_STOP-$STAMP.json"
python3 - "$STOP" "$ACK_STOP_EVENT_ID" "$LOGS/after.txt" "$DRIVER_SHA" <<'PYEOF'
import json,sys,hashlib
from datetime import datetime, timezone
p,ev,after,dsha=sys.argv[1:5]
body=open(after).read()
json.dump({"document":"ACK_STOP","ack_stop_event_id":ev,
  "ack_stop_writer":"crewing-writer@skipi-crewing-17",
  "observed_at":datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
  "operations_terminated":True,"queued_operations_cancelled":True,
  "driver_sha256":dsha,
  "evidence":[{"path":after,"sha256":hashlib.sha256(body.encode()).hexdigest(),"content":body}],
  "what_this_run_does_NOT_establish":("Only ONE of the route's 19 harnesses was run. Nothing here says "
    "the guard route passes, nothing was pushed, no commit was made, no stand was built, and the Fresh "
    "keys were deliberately not touched - they are the next sub-stage.")},
  open(p,"w"), ensure_ascii=False, indent=2)
PYEOF
say "ACK_STOP written: $STOP"
say "DONE"
