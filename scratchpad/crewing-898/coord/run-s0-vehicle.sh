#!/bin/bash
# No.898 sub-stage 0 - create the work vehicle. ONE mutation, every gate before it.
# Usage: run-s0-vehicle.sh <certificate-path>
# Each declared outcome has a line that EXITS on it: `set -e` is NOT relied upon alone.
set -uo pipefail

CERT="${1:-}"
REPO=/home/linux/Developer/skipi-crewing
GATE=/home/linux/Developer/skipi-parallel-coordinator/tools/stage_gate.py
WT=/home/linux/Developer/worktrees/crewing-898-20261104
BR=feat/crewing-898-login-texts-20261104
SHA=f145c6017eaea3804a5429e5aa428b6fb0ece6d9
PIN_HEAD=0223bbd3148d695b3c226fd70c2c6196acf28334
PIN_STATUS=d449c9ce0cc17b0ba2b419959a077c288435ff5058f4add88b60bdd6b5074796
LOGS="$REPO/scratchpad/crewing-898/stage-prep-vehicle"
MIN_SECONDS=20

say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# ---- GATE 1: AUTHORITY first. Only PERMIT_CURRENT, matched not read. ----
[ -n "$CERT" ] || { say "STOP: no certificate path given"; exit 2; }
[ -f "$CERT" ] || { say "STOP: certificate not a file: $CERT"; exit 2; }
if ! python3 "$GATE" check --certificate "$CERT" | grep -q PERMIT_CURRENT; then
    say "STOP: gate did not return PERMIT_CURRENT"; exit 3
fi
say "gate: PERMIT_CURRENT"

# ---- GATE 2: PRUDENCE. Does the work fit the window the CERTIFICATE states? ----
LEFT=$(python3 - "$CERT" <<'PYEOF'
import json,sys
from datetime import datetime, timezone
c=json.load(open(sys.argv[1]))
exp=c.get("expires_at") or c.get("lease",{}).get("expires_at")
if not exp:
    print("NOFIELD"); raise SystemExit(0)
d=datetime.fromisoformat(exp)
print(int((d-datetime.now(timezone.utc)).total_seconds()))
PYEOF
)
case "$LEFT" in
    NOFIELD) say "STOP: expires_at not found in the certificate - refusing rather than reporting a fit I cannot compute"; exit 4 ;;
    ''|*[!0-9-]*) say "STOP: window remainder unparseable: '$LEFT'"; exit 4 ;;
esac
[ "$LEFT" -ge "$MIN_SECONDS" ] || { say "STOP: only ${LEFT}s left, threshold ${MIN_SECONDS}s"; exit 4; }
say "window: ${LEFT}s remaining"

# ---- GATE 3: preconditions, each its own exit ----
[ -n "${ACK_EVENT_ID:-}" ] || { say "STOP: ACK_EVENT_ID not in environment - a start I cannot name is a start I cannot reconcile"; exit 5; }
[ -d "$(dirname "$WT")" ] || { say "STOP: worktree parent absent"; exit 6; }
[ ! -e "$WT" ] || { say "STOP: worktree path already exists - not mine to overwrite"; exit 6; }
git -C "$REPO" rev-parse --verify "$BR" >/dev/null 2>&1 && { say "STOP: branch $BR already exists"; exit 6; }
NOW_HEAD=$(git -C "$REPO" rev-parse HEAD)
NOW_STATUS=$(git -C "$REPO" status --porcelain=v1 --untracked-files=normal | sha256sum | cut -d" " -f1)
[ "$NOW_HEAD" = "$PIN_HEAD" ] || { say "STOP: canonical HEAD moved: $NOW_HEAD vs pinned $PIN_HEAD"; exit 7; }
[ "$NOW_STATUS" = "$PIN_STATUS" ] || { say "STOP: canonical normal-porcelain moved: $NOW_STATUS vs pinned $PIN_STATUS"; exit 7; }
git -C "$REPO" cat-file -e "$SHA" 2>/dev/null || { say "STOP: base object $SHA not present locally"; exit 8; }
WT_BEFORE=$(git -C "$REPO" worktree list | wc -l)
[ "$WT_BEFORE" -ge 1 ] || { say "STOP: worktree listing empty - instrument failure, not an empty list"; exit 8; }
say "preconditions: path free, branch free, HEAD and porcelain match pins, base object present, worktrees before = $WT_BEFORE"

# ---- ACK_START: written BY THE SCRIPT, after the gates, before any other write ----
mkdir -p "$LOGS" || { say "STOP: cannot create declared log dir"; exit 9; }
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
ACK="$LOGS/ACK_START-$STAMP.json"
[ ! -e "$ACK" ] || { say "STOP: an ACK_START already exists under this stamp"; exit 9; }
python3 - "$ACK" "$ACK_EVENT_ID" "$LEFT" "$WT_BEFORE" <<'PYEOF'
import json,sys
from datetime import datetime, timezone
path,event,left,before=sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4]
json.dump({"document":"ACK_START","ack_start_event_id":event,
  "observed_at":datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
  "stage":"PREP","stream_id":"crewing/898-client-slice",
  "writer":"crewing-writer@skipi-crewing-17",
  "window_seconds_remaining_at_start":int(left),
  "worktrees_before":int(before),
  "single_mutation":"git worktree add -b <branch> <path> <sha>"},
  open(path,"w"), ensure_ascii=False, indent=2)
PYEOF
say "ACK_START written: $ACK"

# ---- THE SINGLE MUTATION ----
if ! git -C "$REPO" worktree add -b "$BR" "$WT" "$SHA" > "$LOGS/worktree-add.log" 2>&1; then
    say "STOP: worktree add failed, rc nonzero - NOT cleaning up (PRESERVE forbids remove/prune); see $LOGS/worktree-add.log"
    exit 10
fi
say "mutation done"

# ---- AFTER: establish what happened to the world FIRST ----
WT_AFTER=$(git -C "$REPO" worktree list | wc -l)
NEW_HEAD=$(git -C "$WT" rev-parse HEAD 2>/dev/null || echo UNREADABLE)
POST_HEAD=$(git -C "$REPO" rev-parse HEAD)
POST_STATUS=$(git -C "$REPO" status --porcelain=v1 --untracked-files=normal | sha256sum | cut -d" " -f1)
{
  echo "canonical_head_BEFORE=$NOW_HEAD"
  echo "canonical_status_BEFORE=$NOW_STATUS"
  echo "worktrees_before=$WT_BEFORE"
  echo "worktrees_after=$WT_AFTER"
  echo "new_worktree_head=$NEW_HEAD"
  echo "expected_head=$SHA"
  echo "canonical_head_after=$POST_HEAD"
  echo "canonical_head_pinned=$PIN_HEAD"
  echo "canonical_status_after=$POST_STATUS"
  echo "canonical_status_pinned=$PIN_STATUS"
  for f in dist/index.html tests/crewing635_public_settings_harness.mjs tests/fixtures/crewing_public_settings.mjs; do
      if [ -f "$WT/$f" ]; then
          echo "target_present $f $(sha256sum "$WT/$f" | cut -d" " -f1)"
      else
          echo "target_MISSING $f"
      fi
  done
} > "$LOGS/after.txt"
say "after-state written: $LOGS/after.txt"

# ---- ACK_STOP is the stage's LAST ACTION; the narrative comes after it ----
STOP="$LOGS/ACK_STOP-$STAMP.json"
python3 - "$STOP" "$ACK_EVENT_ID" "$LOGS/after.txt" <<'PYEOF'
import json,sys,hashlib
from datetime import datetime, timezone
path,event,after=sys.argv[1],sys.argv[2],sys.argv[3]
body=open(after).read()
json.dump({"document":"ACK_STOP","ack_stop_event_id":event,
  "ack_stop_writer":"crewing-writer@skipi-crewing-17",
  "observed_at":datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
  "operations_terminated":True,"queued_operations_cancelled":True,
  "evidence":[{"path":after,"sha256":hashlib.sha256(body.encode()).hexdigest(),
               "content":body}],
  "what_this_run_does_NOT_establish":("No harness was run, no application launched, no stand built, "
    "no push attempted and no guard route re-measured. The worktree's existence says nothing about "
    "any test passing.")},
  open(path,"w"), ensure_ascii=False, indent=2)
PYEOF
say "ACK_STOP written: $STOP"
say "DONE"
