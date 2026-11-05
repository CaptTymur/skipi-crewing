#!/bin/bash
# No.898 stage 5 - FETCH origin/main, so the push route can be measured on FETCHED values.
# Usage: run-s5-fetch.sh <certificate>
#
# Why a stage of its own: this is a NETWORK action, and it writes refs/remotes/* in the gitdir
# shared by 85 linked worktrees. It moves no local branch and touches no working file.
#
# Two things learned the hard way and encoded here:
#   - NEVER a bare `git fetch`: No.765 recorded an accidental bare fetch creating four
#     undeclared refs in this very gitdir. The refspec is explicit and the ref COUNT is
#     compared before and after, so any extra ref is a finding rather than a surprise.
#   - GIT_TERMINAL_PROMPT=0: credentials here resolve through a gh helper, but a prompt inside
#     a window would hang until the lease expired. Failing fast beats hanging.
#
# A concurrent neighbour exists and is NOT mine: the user timer skipi-dev-tails.timer fires
# every 10 minutes and its service runs `git fetch` over repositories it finds by walking
# directories. Measured: this gitdir's FETCH_HEAD is from 11-02, so it has not come here in two
# days, and two independent reasons suggest it skips this repo (it is SSH-only per the
# coordinator's reading, while this remote is HTTPS; its first selection criterion is a DIRTY
# worktree, and both checkouts are now clean). Neither is proof, so FETCH_HEAD is recorded
# before and after and any change this driver did not cause is reported as a finding.
set -uo pipefail
case "$0" in -*|bash|sh|"") echo "STOP: \$0 does not name a file"; exit 1 ;; esac
DRIVER_SHA=$(sha256sum "$0" | cut -d" " -f1); echo "driver_sha256=$DRIVER_SHA"

CERT="${1:-}"
HOME_REPO=/home/linux/Developer/skipi-crewing
WT=/home/linux/Developer/worktrees/crewing-898-20261104
GITDIR=/home/linux/Developer/skipi-crewing/.git
GATE=/home/linux/Developer/skipi-parallel-coordinator/tools/stage_gate.py
LOGS="$HOME_REPO/scratchpad/crewing-898/stage-fetch"
BRANCH=feat/crewing-898-login-texts-20261104
COMMIT=e5132934064c8ccf701b0061570971c2af220403
BASE=f145c6017eaea3804a5429e5aa428b6fb0ece6d9
# The SET of remote ref names, not a count of loose files. A count over refs/remotes is
# blind to composition and to packing: the rehearsal saw 1 -> 2 and cried FINDING when a
# PACKED ref had merely become loose. `for-each-ref` sees packed and loose alike, and a
# name set says WHICH ref appeared, which is what attribution needs.
REFS_BEFORE_EXPECT=149
MIN_SECONDS=45
say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

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
# 45 s, not 30: a network call can be slow, and the fetch itself carries a 30 s timeout below.
[ "$LEFT" -ge "$MIN_SECONDS" ] || { say "STOP: only ${LEFT}s left, threshold ${MIN_SECONDS}s for a NETWORK stage"; exit 4; }
say "window: ${LEFT}s remaining (network stage: fetch timeout 30s, threshold ${MIN_SECONDS}s)"

[ -n "${ACK_START_EVENT_ID:-}" ] || { say "STOP: ACK_START_EVENT_ID absent"; exit 5; }
[ -n "${ACK_EVENT_ID:-}" ] || { say "STOP: ACK_EVENT_ID absent"; exit 5; }
[ -n "${ACK_STOP_EVENT_ID:-}" ] || { say "STOP: ACK_STOP_EVENT_ID absent"; exit 5; }
[ "$ACK_START_EVENT_ID" != "$ACK_EVENT_ID" ] || { say "STOP: start id equals request id"; exit 5; }
[ "$ACK_START_EVENT_ID" != "$ACK_STOP_EVENT_ID" ] || { say "STOP: start id equals stop id"; exit 5; }
[ "$ACK_EVENT_ID" != "$ACK_STOP_EVENT_ID" ] || { say "STOP: request id equals stop id"; exit 5; }

HEAD0=$(git -C "$WT" rev-parse HEAD)
REF0=$(git -C "$WT" rev-parse "refs/heads/$BRANCH")
[ "$HEAD0" = "$COMMIT" ] || { say "STOP: HEAD $HEAD0 != the committed $COMMIT"; exit 7; }
[ "$REF0" = "$COMMIT" ] || { say "STOP: branch ref $REF0 != $COMMIT"; exit 7; }
WT_STATUS=$(git -C "$WT" status --porcelain=v1 --untracked-files=all)
[ -z "$WT_STATUS" ] || { say "STOP: worktree not clean before fetch: [$WT_STATUS]"; exit 7; }
ORIGIN0=$(git -C "$WT" rev-parse origin/main)
REFNAMES0=$(git -C "$WT" for-each-ref --format="%(refname)" refs/remotes | sort)
REFS0=$(printf "%s\n" "$REFNAMES0" | grep -c . )
# The SHARED FETCH_HEAD is the NEIGHBOUR detector, not mine: a fetch run from the main
# checkout (which is what skipi-dev-tails does) writes this file, and a fetch run from a
# linked worktree never touches it. Measured, not assumed.
FH0_MTIME=$(stat -c %Y "$GITDIR/FETCH_HEAD" 2>/dev/null || echo NONE)
FH0_SHA=$(sha256sum "$GITDIR/FETCH_HEAD" 2>/dev/null | cut -d" " -f1 || echo NONE)
# The PER-WORKTREE FETCH_HEAD is MY positive control. Asked git for the path rather than
# building it: in a linked worktree `.git` is a file, so the portable form is --git-path.
PERWT_FH=$(git -C "$WT" rev-parse --git-path FETCH_HEAD)
case "$PERWT_FH" in /*) ;; *) PERWT_FH="$WT/$PERWT_FH" ;; esac
PWFH0_STATE=ABSENT; [ -e "$PERWT_FH" ] && PWFH0_STATE=EXISTS
PWFH0_MTIME=$(stat -c %Y "$PERWT_FH" 2>/dev/null || echo NONE)
[ "$REFS0" = "$REFS_BEFORE_EXPECT" ] || { say "STOP: refs/remotes holds $REFS0 entries, declared $REFS_BEFORE_EXPECT - something changed them since the request"; exit 8; }
CANON_TRACKED_BEFORE=$(git -C "$HOME_REPO" status --porcelain=v1 --untracked-files=no | wc -l)
say "preconditions: HEAD and ref at $COMMIT, worktree clean, origin/main $ORIGIN0, refs/remotes $REFS0, SHARED FETCH_HEAD sha ${FH0_SHA:0:12} (neighbour detector), per-worktree FETCH_HEAD $PWFH0_STATE (my positive control), canonical tracked $CANON_TRACKED_BEFORE"

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
  "stage":"INTEGRATE","stream_id":"crewing/898-client-slice",
  "writer":"crewing-writer@skipi-crewing-17","driver_sha256":dsha,
  "window_seconds_remaining_at_start":int(left)}, open(p,"w"), ensure_ascii=False, indent=2)
PYEOF
say "ACK_START written: $ACK"

# ---- THE NETWORK ACTION: explicit refspec, no prompt possible, hard timeout ----
GIT_TERMINAL_PROMPT=0 timeout 30 git -C "$WT" fetch origin main > "$LOGS/fetch.log" 2>&1
FETCH_RC=$?
if [ "$FETCH_RC" != "0" ]; then
    say "STOP: fetch exited $FETCH_RC (124 = the 30s timeout) - see $LOGS/fetch.log"
    sed 's/^/    /' "$LOGS/fetch.log" | head -5
    exit 10
fi
ORIGIN1=$(git -C "$WT" rev-parse origin/main)
REFNAMES1=$(git -C "$WT" for-each-ref --format="%(refname)" refs/remotes | sort)
REFS1=$(printf "%s\n" "$REFNAMES1" | grep -c . )
HEAD1=$(git -C "$WT" rev-parse HEAD)
REF1=$(git -C "$WT" rev-parse "refs/heads/$BRANCH")
WT_AFTER=$(git -C "$WT" status --porcelain=v1 --untracked-files=all)
[ "$HEAD1" = "$COMMIT" ] || { say "STOP: HEAD moved to $HEAD1 - a fetch must not move it"; exit 11; }
[ "$REF1" = "$COMMIT" ] || { say "STOP: the branch ref moved to $REF1 - a fetch must not move it"; exit 11; }
[ -z "$WT_AFTER" ] || { say "STOP: worktree dirty after fetch: [$WT_AFTER]"; exit 11; }
# ---- POSITIVE CONTROL. Everything else this stage measures is expected to be UNCHANGED
# (the cache is already fresh), so "nothing moved" would read identically for "the fetch ran
# and brought nothing" and "the fetch did not run". `git fetch` rewrites the per-worktree
# FETCH_HEAD ALWAYS, even when it brings zero refs - proved in a fixture of the same SHAPE
# (a linked worktree): absent -> created on a zero-result fetch, and rewritten on the next.
# So this file is the one artefact that separates the two cases.
PWFH1_STATE=ABSENT; [ -e "$PERWT_FH" ] && PWFH1_STATE=EXISTS
PWFH1_MTIME=$(stat -c %Y "$PERWT_FH" 2>/dev/null || echo NONE)
PWFH1_SHA=$(sha256sum "$PERWT_FH" 2>/dev/null | cut -d" " -f1 || echo NONE)
PWFH1_HEAD1=$(head -1 "$PERWT_FH" 2>/dev/null || echo NONE)
[ "$PWFH1_STATE" = EXISTS ] || { say "STOP: POSITIVE CONTROL FAILED - $PERWT_FH absent after a fetch that exited 0. A fetch rewrites it unconditionally, so its absence means the fetch did not do the work its exit code claims"; exit 12; }
if [ "$PWFH0_STATE" = EXISTS ] && [ "$PWFH1_MTIME" = "$PWFH0_MTIME" ]; then
    say "STOP: POSITIVE CONTROL FAILED - $PERWT_FH mtime did not move ($PWFH0_MTIME); the file pre-existed and the fetch did not rewrite it"
    exit 12
fi
say "positive control PASSED: per-worktree FETCH_HEAD $PWFH0_STATE -> $PWFH1_STATE, sha ${PWFH1_SHA:0:12}, first line: $PWFH1_HEAD1"
ADDED=$(comm -13 <(printf "%s\n" "$REFNAMES0") <(printf "%s\n" "$REFNAMES1") | tr "\n" " ")
GONE=$(comm -23 <(printf "%s\n" "$REFNAMES0") <(printf "%s\n" "$REFNAMES1") | tr "\n" " ")
[ -z "$ADDED$GONE" ] || say "FINDING: remote ref NAMES changed - added [$ADDED] gone [$GONE]. An explicit 'fetch origin main' should change none. Reporting, not failing: a named ref is attributable, and the timer is the first thing to check."
say "fetched; origin/main $ORIGIN0 -> $ORIGIN1; refs/remotes $REFS0 -> $REFS1; local branch and HEAD unmoved at $COMMIT; worktree clean"

# ---- THE POINT OF THE STAGE: the route, measured on FETCHED values ----
MB=$(git -C "$WT" merge-base origin/main HEAD)
RANGE_FILES=$(git -C "$WT" diff --name-only "$MB...HEAD" | wc -l)
git -C "$WT" diff --name-only "$MB...HEAD" > "$LOGS/range.txt"
say "route input measured AFTER the fetch: merge-base $MB, triple-dot range holds $RANGE_FILES file(s)"
sed 's/^/    /' "$LOGS/range.txt"

FH1_MTIME=$(stat -c %Y "$GITDIR/FETCH_HEAD" 2>/dev/null || echo NONE)
FH1_SHA=$(sha256sum "$GITDIR/FETCH_HEAD" 2>/dev/null | cut -d" " -f1 || echo NONE)
CANON_TRACKED_AFTER=$(git -C "$HOME_REPO" status --porcelain=v1 --untracked-files=no | wc -l)
{
  echo "driver_sha256=$DRIVER_SHA"
  echo "fetch_rc=$FETCH_RC"; echo "fetch_refspec=origin main (explicit, never bare)"
  echo "origin_main_before=$ORIGIN0"; echo "origin_main_after=$ORIGIN1"
  echo "refs_remotes_before=$REFS0"; echo "refs_remotes_after=$REFS1"
  echo "refs_added=[${ADDED:-none}]"; echo "refs_gone=[${GONE:-none}]"
  echo "shared_fetch_head_path=$GITDIR/FETCH_HEAD"
  echo "shared_fetch_head_role=neighbour detector; a worktree fetch never writes it"
  echo "shared_fetch_head_sha_before=$FH0_SHA"; echo "shared_fetch_head_sha_after=$FH1_SHA"
  echo "shared_fetch_head_mtime_before=$FH0_MTIME"; echo "shared_fetch_head_mtime_after=$FH1_MTIME"
  echo "perwt_fetch_head_path=$PERWT_FH"
  echo "perwt_fetch_head_role=MY positive control; a fetch rewrites it even bringing zero"
  echo "perwt_fetch_head_state_before=$PWFH0_STATE"; echo "perwt_fetch_head_state_after=$PWFH1_STATE"
  echo "perwt_fetch_head_mtime_before=$PWFH0_MTIME"; echo "perwt_fetch_head_mtime_after=$PWFH1_MTIME"
  echo "perwt_fetch_head_sha_after=$PWFH1_SHA"
  echo "perwt_fetch_head_first_line=$PWFH1_HEAD1"
  echo "head_before=$HEAD0"; echo "head_after=$HEAD1"
  echo "branch_ref_before=$REF0"; echo "branch_ref_after=$REF1"
  echo "worktree_status_after=[$WT_AFTER]"
  echo "merge_base_AFTER_fetch=$MB"
  echo "range_file_count=$RANGE_FILES"
  sed 's/^/range_file=/' "$LOGS/range.txt"
  echo "pushed=no"
  echo "canonical_tracked_lines_before=$CANON_TRACKED_BEFORE"
  echo "canonical_tracked_lines_after=$CANON_TRACKED_AFTER"
  echo "canonical_head=$(git -C "$HOME_REPO" rev-parse HEAD)"
} > "$LOGS/after.txt"
say "after-state written: $LOGS/after.txt"

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
  "what_this_run_does_NOT_establish":("A FETCH only - nothing was pushed and no local branch "
    "moved. The merge-base and range recorded here are the INPUT the guard's hook will compute "
    "from, not its verdict: the hook takes base and head from its own stdin, and for a branch "
    "the remote does not yet have, REMOTE_SHA is zeroes and the range is taken from the "
    "merge-base with the fetched origin/main. So this measurement is fresh and relevant, and it "
    "is still not a guard verdict. The route must be judged by running the guard on THESE "
    "values, which is the next request, and the push after that is another.")},
  open(p,"w"), ensure_ascii=False, indent=2)
PYEOF
say "ACK_STOP written: $STOP"

if [ "$CANON_TRACKED_AFTER" != "$CANON_TRACKED_BEFORE" ]; then
    say "STOP: canonical tracked-change count moved $CANON_TRACKED_BEFORE -> $CANON_TRACKED_AFTER. TWO causes are indistinguishable from here: this stage, or a neighbour in their own checkout. Subject COMPLETE, lease CLOSED; attribution belongs to the coordinator."
    exit 13
fi
say "canonical checkout unmoved: tracked-change count $CANON_TRACKED_BEFORE -> $CANON_TRACKED_AFTER"
say "DONE"
