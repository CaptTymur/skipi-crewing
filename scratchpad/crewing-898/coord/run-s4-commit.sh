#!/bin/bash
# No.898 stage 4 - COMMIT the four files onto the feature branch.
# Usage: run-s4-commit.sh <certificate>
#
# This stage writes git objects and MOVES an existing ref. The surfaces were measured with
# `git rev-parse --git-path`, not assumed, and they are THREE, not one:
#   per-worktree  .git/worktrees/crewing-898-20261104/{index,HEAD,ORIG_HEAD,COMMIT_EDITMSG,logs/HEAD}
#   shared        .git/objects
#   shared        .git/refs/heads/feat/crewing-898-login-texts-20261104   <- the branch lives HERE
# 85 linked worktrees sit behind that gitdir (86 lines from `git worktree list`, incl. the main
# checkout), so `objects` and `refs` are genuinely shared ground.
#
# The branch ALREADY EXISTS at f145c601, so this does not create a ref, it MOVES one - which
# gives a predicate a file digest cannot: the ref's value before and after, and the parentage
# of what it points to.
#
# NO push and NO fetch. Nine git invocations below and every one is a read except `add` and
# `commit`; the remote cache is recorded before and after to prove it never moved.
set -uo pipefail
case "$0" in -*|bash|sh|"") echo "STOP: \$0 does not name a file"; exit 1 ;; esac
DRIVER_SHA=$(sha256sum "$0" | cut -d" " -f1); echo "driver_sha256=$DRIVER_SHA"

CERT="${1:-}"
HOME_REPO=/home/linux/Developer/skipi-crewing
WT=/home/linux/Developer/worktrees/crewing-898-20261104
GATE=/home/linux/Developer/skipi-parallel-coordinator/tools/stage_gate.py
MSG="$HOME_REPO/scratchpad/crewing-898/coord/commit-message-898.txt"
LOGS="$HOME_REPO/scratchpad/crewing-898/stage-commit"
BRANCH=feat/crewing-898-login-texts-20261104
BASE=f145c6017eaea3804a5429e5aa428b6fb0ece6d9
MSG_SHA=29a779c1e934e3bf5b831d7acdae5a6615160bab5cc3cca230f283fe19b3f4fe
DIST=96b6bd5000f957155569b342a236c17b51e244a8291475cf82260d1980fdf3fa
HARN=78b44acfe17777b6795bf51fe191fc79c4a58cd573d05676252d603628cf805f
RS=e611fae5478234a34415d18452c738612828a38a575d417d5777f9b0f041af48
JOINT=ecdd480d3df4eeafb15fc7060a81e62cb88234da0c631417e02a77bb222b81b3
WANT_PASSED=184
MIN_SECONDS=30
say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
dsha() { sha256sum "$1" | cut -d" " -f1; }

# ---- GATE 1: AUTHORITY, read as a FIELD ----
[ -n "$CERT" ] || { say "STOP: no certificate path given"; exit 2; }
[ -f "$CERT" ] || { say "STOP: certificate not a file: $CERT"; exit 2; }
GATE_OUT=$(python3 "$GATE" check --certificate "$CERT" 2>/dev/null)
VERDICT=$(python3 - "$GATE_OUT" <<'PYEOF'
import json, sys
try:
    print(json.loads(sys.argv[1]).get("verdict", "<no-verdict-key>"))
except Exception as exc:
    print("<unparseable:%s>" % type(exc).__name__)
PYEOF
)
[ "$VERDICT" = "PERMIT_CURRENT" ] || { say "STOP: gate verdict is [$VERDICT]"; exit 3; }
say "gate: verdict field parsed = PERMIT_CURRENT"

# ---- GATE 2: PRUDENCE, window from the CERTIFICATE ----
LEFT=$(python3 - "$CERT" <<'PYEOF'
import json,sys
from datetime import datetime, timezone
c=json.load(open(sys.argv[1]))
exp=c.get("expires_at") or c.get("lease",{}).get("expires_at")
if not exp: print("NOFIELD"); raise SystemExit(0)
print(int((datetime.fromisoformat(exp)-datetime.now(timezone.utc)).total_seconds()))
PYEOF
)
case "$LEFT" in
    NOFIELD) say "STOP: expires_at absent"; exit 4 ;;
    ''|*[!0-9-]*) say "STOP: window remainder unparseable: '$LEFT'"; exit 4 ;;
esac
[ "$LEFT" -ge "$MIN_SECONDS" ] || { say "STOP: only ${LEFT}s left, threshold ${MIN_SECONDS}s"; exit 4; }
say "window: ${LEFT}s remaining (measured need: commit well under 1s + harness ~0.55s)"

# ---- GATE 3: preconditions ----
[ -n "${ACK_START_EVENT_ID:-}" ] || { say "STOP: ACK_START_EVENT_ID absent"; exit 5; }
[ -n "${ACK_EVENT_ID:-}" ] || { say "STOP: ACK_EVENT_ID absent"; exit 5; }
[ -n "${ACK_STOP_EVENT_ID:-}" ] || { say "STOP: ACK_STOP_EVENT_ID absent"; exit 5; }
[ "$ACK_START_EVENT_ID" != "$ACK_EVENT_ID" ] || { say "STOP: start id equals request id"; exit 5; }
[ "$ACK_START_EVENT_ID" != "$ACK_STOP_EVENT_ID" ] || { say "STOP: start id equals stop id"; exit 5; }
[ "$ACK_EVENT_ID" != "$ACK_STOP_EVENT_ID" ] || { say "STOP: request id equals stop id"; exit 5; }
[ -f "$MSG" ] || { say "STOP: commit message file absent"; exit 6; }
M0=$(dsha "$MSG")
[ "$M0" = "$MSG_SHA" ] || { say "STOP: commit message $M0 != pinned $MSG_SHA - the text is part of the subject"; exit 6; }
REF0=$(git -C "$WT" rev-parse "refs/heads/$BRANCH")
HEAD0=$(git -C "$WT" rev-parse HEAD)
[ "$REF0" = "$BASE" ] || { say "STOP: branch ref $REF0 != base $BASE - this stage MOVES a known ref, not an unknown one"; exit 7; }
[ "$HEAD0" = "$BASE" ] || { say "STOP: HEAD $HEAD0 != base $BASE"; exit 7; }
[ "$(git -C "$WT" symbolic-ref HEAD)" = "refs/heads/$BRANCH" ] || { say "STOP: HEAD is not on $BRANCH"; exit 7; }
WT_STATUS=$(git -C "$WT" status --porcelain=v1 --untracked-files=all)
WT_EXPECT=$(printf ' M dist/index.html\n M src-tauri/src/native_lifecycle.rs\n M src-tauri/src/native_local_joint_tests.rs\n M tests/crewing635_public_settings_harness.mjs')
[ "$WT_STATUS" = "$WT_EXPECT" ] || { say "STOP: worktree is not the declared four-file state; got: [$WT_STATUS]"; exit 7; }
D0=$(dsha "$WT/dist/index.html"); H0=$(dsha "$WT/tests/crewing635_public_settings_harness.mjs")
R0=$(dsha "$WT/src-tauri/src/native_lifecycle.rs"); J0=$(dsha "$WT/src-tauri/src/native_local_joint_tests.rs")
[ "$D0" = "$DIST" ] && [ "$H0" = "$HARN" ] && [ "$R0" = "$RS" ] && [ "$J0" = "$JOINT" ] \
  || { say "STOP: a file digest differs from its pin"; exit 8; }
ORIGIN0=$(git -C "$WT" rev-parse origin/main 2>/dev/null || echo NONE)
CANON_TRACKED_BEFORE=$(git -C "$HOME_REPO" status --porcelain=v1 --untracked-files=no | wc -l)
say "preconditions: ref and HEAD both at $BASE on $BRANCH, four files match pins, message matches its pin, canonical tracked lines=$CANON_TRACKED_BEFORE"

# ---- ACK_START ----
mkdir -p "$LOGS" || { say "STOP: cannot create declared log dir"; exit 9; }
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
ACK="$LOGS/ACK_START-$STAMP.json"
[ ! -e "$ACK" ] || { say "STOP: an ACK_START already exists under this stamp"; exit 9; }
python3 - "$ACK" "$ACK_START_EVENT_ID" "$LEFT" "$DRIVER_SHA" <<'PYEOF'
import json,sys
from datetime import datetime, timezone
p,ev,left,dsha=sys.argv[1:5]
json.dump({"document":"ACK_START","ack_start_event_id":ev,
  "observed_at":datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
  "stage":"IMPLEMENT","stream_id":"crewing/898-client-slice",
  "writer":"crewing-writer@skipi-crewing-17","driver_sha256":dsha,
  "window_seconds_remaining_at_start":int(left)}, open(p,"w"), ensure_ascii=False, indent=2)
PYEOF
say "ACK_START written: $ACK"

# ---- THE MUTATION: stage FOUR EXPLICIT PATHS, never -A, then commit ----
PATHS=(dist/index.html src-tauri/src/native_lifecycle.rs)
PATHS+=(src-tauri/src/native_local_joint_tests.rs tests/crewing635_public_settings_harness.mjs)
if ! git -C "$WT" add -- "${PATHS[@]}" > "$LOGS/git.log" 2>&1; then
    say "STOP: git add failed - see $LOGS/git.log"; exit 10
fi
STAGED=$(git -C "$WT" diff --cached --name-only | wc -l)
[ "$STAGED" = "4" ] || { say "STOP: $STAGED paths staged, want exactly 4 - NOT committing"; exit 10; }
# No hook runs here: only pre-push is installed and core.hooksPath is empty, so --no-verify
# (which is forbidden in this house) never arises and is not passed.
if ! git -C "$WT" commit -F "$MSG" >> "$LOGS/git.log" 2>&1; then
    say "STOP: git commit failed - see $LOGS/git.log"; exit 10
fi
NEW=$(git -C "$WT" rev-parse HEAD)
REF1=$(git -C "$WT" rev-parse "refs/heads/$BRANCH")
PARENTS=$(git -C "$WT" rev-list --parents -n 1 HEAD | cut -d" " -f2-)
[ "$NEW" != "$BASE" ] || { say "STOP: HEAD did not move"; exit 11; }
[ "$REF1" = "$NEW" ] || { say "STOP: the branch ref $REF1 does not point at the new commit $NEW"; exit 11; }
[ "$PARENTS" = "$BASE" ] || { say "STOP: parentage is [$PARENTS], want exactly one parent $BASE"; exit 11; }
CHANGED=$(git -C "$WT" diff --name-only "$BASE..$NEW")
WANT=$(printf 'dist/index.html\nsrc-tauri/src/native_lifecycle.rs\nsrc-tauri/src/native_local_joint_tests.rs\ntests/crewing635_public_settings_harness.mjs')
[ "$CHANGED" = "$WANT" ] || { say "STOP: range $BASE..$NEW contains [$CHANGED]"; exit 11; }
AFTER_STATUS=$(git -C "$WT" status --porcelain=v1 --untracked-files=all)
[ -z "$AFTER_STATUS" ] || { say "STOP: worktree not clean after commit: [$AFTER_STATUS]"; exit 11; }
# The commit must not have touched the working tree: same four digests as before.
D1=$(dsha "$WT/dist/index.html"); H1=$(dsha "$WT/tests/crewing635_public_settings_harness.mjs")
R1=$(dsha "$WT/src-tauri/src/native_lifecycle.rs"); J1=$(dsha "$WT/src-tauri/src/native_local_joint_tests.rs")
[ "$D1" = "$D0" ] && [ "$H1" = "$H0" ] && [ "$R1" = "$R0" ] && [ "$J1" = "$J0" ] \
  || { say "STOP: a working-tree file changed during the commit"; exit 11; }
say "committed $NEW on $BRANCH; parent $BASE; range holds exactly the four declared paths; worktree clean; no file byte moved"

# ---- VERIFY: the tree still passes ----
( cd "$WT" && node "$WT/tests/crewing635_public_settings_harness.mjs" ) > "$LOGS/harness.log" 2>"$LOGS/harness.err"
NODE_RC=$?
ERR_BYTES=$(stat -c %s "$LOGS/harness.err")
SUM=$(python3 - "$LOGS/harness.log" "$WANT_PASSED" <<'PYEOF'
import json,sys
want=int(sys.argv[2]); last=None
for ln in open(sys.argv[1]):
    ln=ln.strip()
    if ln.startswith("{") and '"passed"' in ln: last=ln
if last is None: print("NOSUMMARY"); raise SystemExit(0)
d=json.loads(last)
print("OK" if (d.get("passed")==want and d.get("failed")==0 and d.get("setup_errors")==0)
      else "MISMATCH passed=%s failed=%s setup=%s" % (d.get("passed"),d.get("failed"),d.get("setup_errors")))
PYEOF
)
[ "$NODE_RC" = "0" ] || { say "STOP: node exited $NODE_RC"; exit 12; }
[ "$ERR_BYTES" = "0" ] || { say "STOP: harness stderr is $ERR_BYTES bytes"; exit 12; }
case "$SUM" in
  OK) say "harness: $WANT_PASSED passed / 0 failed / 0 setup_errors (node rc=$NODE_RC, stderr $ERR_BYTES B)" ;;
  NOSUMMARY) say "STOP: harness produced no summary line"; exit 12 ;;
  *) say "STOP: harness $SUM"; exit 12 ;;
esac

# ---- AFTER ----
ORIGIN1=$(git -C "$WT" rev-parse origin/main 2>/dev/null || echo NONE)
CANON_TRACKED_AFTER=$(git -C "$HOME_REPO" status --porcelain=v1 --untracked-files=no | wc -l)
{
  echo "driver_sha256=$DRIVER_SHA"
  echo "branch=$BRANCH"
  echo "ref_before=$REF0"; echo "ref_after=$REF1"; echo "commit=$NEW"; echo "parent=$PARENTS"
  echo "commit_message_sha256=$M0"
  echo "range_files=$(echo "$CHANGED" | wc -l)"
  echo "$CHANGED" | sed 's/^/range_file=/'
  echo "worktree_status_after=[$AFTER_STATUS]"
  echo "dist=$D1"; echo "harness=$H1"; echo "lifecycle=$R1"; echo "joint=$J1"
  echo "origin_main_before=$ORIGIN0"; echo "origin_main_after=$ORIGIN1"
  echo "pushed=no"; echo "fetched=no"
  echo "canonical_tracked_lines_before=$CANON_TRACKED_BEFORE"
  echo "canonical_tracked_lines_after=$CANON_TRACKED_AFTER"
  echo "canonical_head=$(git -C "$HOME_REPO" rev-parse HEAD)"
  echo "harness_summary=$(tail -1 "$LOGS/harness.log")"
} > "$LOGS/after.txt"
say "after-state written: $LOGS/after.txt"

# ---- ACK_STOP: the stage's LAST action ----
STOP="$LOGS/ACK_STOP-$STAMP.json"
python3 - "$STOP" "$ACK_STOP_EVENT_ID" "$LOGS/after.txt" "$DRIVER_SHA" <<'PYEOF'
import json,sys,hashlib
from datetime import datetime, timezone
p,ev,after,dsha=sys.argv[1:5]
body=open(after).read()
json.dump({"document":"ACK_STOP","ack_stop_event_id":ev,
  "ack_stop_writer":"crewing-writer@skipi-crewing-17",
  "observed_at":datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
  "operations_terminated":True,"queued_operations_cancelled":True,"driver_sha256":dsha,
  "evidence":[{"path":after,"sha256":hashlib.sha256(body.encode()).hexdigest(),"content":body}],
  "what_this_run_does_NOT_establish":("A LOCAL commit only. Nothing was pushed and nothing was "
    "fetched - the origin/main cache is recorded before and after and is unchanged. The guard "
    "does not look at a local commit: only pushed refs are gated, so this run says NOTHING about "
    "whether the push will pass. The push route must be measured AFTER a fetch, on the fetched "
    "values, and today's measurement does not carry. Only one of the route's 19 harnesses ran. "
    "The Rust suite was not run here: 249/0 under umask 0022 is dry-run evidence, and under the "
    "machine default 0002 the same suite is 234/15 for the pre-existing reason filed as No.922.")},
  open(p,"w"), ensure_ascii=False, indent=2)
PYEOF
say "ACK_STOP written: $STOP"

if [ "$CANON_TRACKED_AFTER" != "$CANON_TRACKED_BEFORE" ]; then
    say "STOP: canonical tracked-change count moved $CANON_TRACKED_BEFORE -> $CANON_TRACKED_AFTER. TWO causes are indistinguishable from here: (a) this stage wrote outside its declared surfaces, or (b) a neighbour legitimately wrote in their own checkout during this window. Stage subject is COMPLETE and the lease is CLOSED; attribution belongs to the coordinator."
    exit 13
fi
say "canonical checkout unmoved: tracked-change count $CANON_TRACKED_BEFORE -> $CANON_TRACKED_AFTER"
say "DONE"
