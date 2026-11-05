#!/bin/bash
# No.898 stage 6 - MEASURE THE PUSH ROUTE with the guard's own verify, on the values
# fetched in stage 5. No push, no PR, no harness execution, no product file touched.
# Usage: run-s6-route.sh <certificate>
#
# WHY `verify` AND NOT `pre-push-ref`, read out of the guard rather than assumed:
#   `pre_push_ref` does `git worktree add` into the SHARED gitdir (bin/skipi-guard:865) and
#   `shutil.rmtree` (894), and calls verify with run_harness=True, executing harnesses in
#   OTHER repositories. Both primitives appear ONLY in that function; `verify` occupies lines
#   664-821 and contains neither. So verify is the read-only instrument - and the commit now
#   exists, so no fixture stand-in is needed: the real object can be measured directly.
#
# WHY THIS STAGE IS NOT PURELY READ-ONLY, and the one flag that makes it so:
#   `verify --json <path>` writes that file and does `mkdir(parents=True, exist_ok=True)` on
#   its parent (1149, 816-817, 633-637). Omit the flag and nothing is written at all. It is
#   kept because the machine-readable verdict IS this stage's evidence - but the path sits
#   INSIDE the declared log directory, which this driver creates first, so write_json's mkdir
#   is a no-op and the write surface is one already-declared subtree. Contrast worth knowing:
#   for `pre-push-ref` --json DEFAULTS to /tmp/skipi-guard-pre-push-<home>.json (853); for
#   `verify` there is no default.
#
# WHY rc=1 IS NOT A FAILURE HERE:
#   verify returns `0 if result["status"] == "pass" else 1` (820). Exit 1 is a VERDICT; exit
#   2+ is an instrument failure. Conflating them would report a refused route as a broken
#   tool, or worse, report a broken tool as a clean route.
#
# THE DEBT THIS DRIVER PAYS:
#   Stage 5 pinned the ref COUNT (149). A count is blind to composition - one ref added plus
#   one removed leaves 149 with a different set, the same blindness that made me replace
#   `find -type f` with a name set after it cried FINDING over a merely re-packed ref. Here
#   the precondition pins the SORTED NAME LIST in a declared sidecar and compares with `comm`,
#   so drift is not only detected but NAMED.
set -uo pipefail
case "$0" in -*|bash|sh|"") echo "STOP: \$0 does not name a file"; exit 1 ;; esac
DRIVER_SHA=$(sha256sum "$0" | cut -d" " -f1); echo "driver_sha256=$DRIVER_SHA"

CERT="${1:-}"
HOME_REPO=/home/linux/Developer/skipi-crewing
WT=/home/linux/Developer/worktrees/crewing-898-20261104
GITDIR=/home/linux/Developer/skipi-crewing/.git
GATE=/home/linux/Developer/skipi-parallel-coordinator/tools/stage_gate.py
GUARD=/home/linux/Developer/skipi-guard/bin/skipi-guard
LOGS="$HOME_REPO/scratchpad/crewing-898/stage-route"
JSON="$LOGS/guard-verify.json"
LIVENAMES="$LOGS/refnames-live.txt"
BRANCH=feat/crewing-898-login-texts-20261104
COMMIT=e5132934064c8ccf701b0061570971c2af220403
BASE=f145c6017eaea3804a5429e5aa428b6fb0ece6d9
REFNAMES_PIN="$HOME_REPO/scratchpad/crewing-898/coord/refnames-s6.txt"
REFNAMES_PIN_SHA=de27f05ff072f1fd4476e3810186653a254e9c015575312b2f43efcd11d42297
WT_LINES_EXPECT=86
# Measured on a fixture carrying the same four paths: 0.04-0.06 s over three runs. 30 s, not
# the 45 of stage 5: there is no network call and no compiler here, so the real cost of this
# stage is turn latency, not the instrument.
MIN_SECONDS=30
EXPECT_TASK=crewing-635-single-user
EXPECT_FILES=4
say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

[ -n "$CERT" ] || { say "STOP: no certificate path given"; exit 2; }
[ -f "$CERT" ] || { say "STOP: certificate not a file: $CERT"; exit 2; }
GATE_OUT=$(python3 "$GATE" check --certificate "$CERT" 2>/dev/null)
VERDICT=$(python3 - "$GATE_OUT" <<'PYGATE'
import json, sys
try:
    print(json.loads(sys.argv[1]).get("verdict", "<no-verdict-key>"))
except Exception as exc:
    print("<unparseable:%s>" % type(exc).__name__)
PYGATE
)
[ "$VERDICT" = "PERMIT_CURRENT" ] || { say "STOP: gate verdict is [$VERDICT]"; exit 3; }
say "gate: verdict field parsed = PERMIT_CURRENT"

LEFT=$(python3 - "$CERT" <<'PYWIN'
import json,sys
from datetime import datetime, timezone
c=json.load(open(sys.argv[1]))
exp=c.get("expires_at") or c.get("lease",{}).get("expires_at")
if not exp: print("NOFIELD"); raise SystemExit(0)
print(int((datetime.fromisoformat(exp)-datetime.now(timezone.utc)).total_seconds()))
PYWIN
)
case "$LEFT" in
    NOFIELD) say "STOP: expires_at absent"; exit 4 ;;
    ''|*[!0-9-]*) say "STOP: window remainder unparseable: '$LEFT'"; exit 4 ;;
esac
[ "$LEFT" -ge "$MIN_SECONDS" ] || { say "STOP: only ${LEFT}s left, threshold ${MIN_SECONDS}s"; exit 4; }
say "window: ${LEFT}s remaining (local read-only measurement; threshold ${MIN_SECONDS}s)"

[ -n "${ACK_START_EVENT_ID:-}" ] || { say "STOP: ACK_START_EVENT_ID absent"; exit 5; }
[ -n "${ACK_EVENT_ID:-}" ] || { say "STOP: ACK_EVENT_ID absent"; exit 5; }
[ -n "${ACK_STOP_EVENT_ID:-}" ] || { say "STOP: ACK_STOP_EVENT_ID absent"; exit 5; }
[ "$ACK_START_EVENT_ID" != "$ACK_EVENT_ID" ] || { say "STOP: start id equals request id"; exit 5; }
[ "$ACK_START_EVENT_ID" != "$ACK_STOP_EVENT_ID" ] || { say "STOP: start id equals stop id"; exit 5; }
[ "$ACK_EVENT_ID" != "$ACK_STOP_EVENT_ID" ] || { say "STOP: request id equals stop id"; exit 5; }

[ -f "$REFNAMES_PIN" ] || { say "STOP: ref-name pin absent: $REFNAMES_PIN"; exit 6; }
PIN_GOT=$(sha256sum "$REFNAMES_PIN" | cut -d" " -f1)
[ "$PIN_GOT" = "$REFNAMES_PIN_SHA" ] || { say "STOP: ref-name pin digest is $PIN_GOT, declared $REFNAMES_PIN_SHA"; exit 6; }

HEAD0=$(git -C "$WT" rev-parse HEAD)
REF0=$(git -C "$WT" rev-parse "refs/heads/$BRANCH")
[ "$HEAD0" = "$COMMIT" ] || { say "STOP: HEAD $HEAD0 != the committed $COMMIT"; exit 7; }
[ "$REF0" = "$COMMIT" ] || { say "STOP: branch ref $REF0 != $COMMIT"; exit 7; }
WT_STATUS=$(git -C "$WT" status --porcelain=v1 --untracked-files=all)
[ -z "$WT_STATUS" ] || { say "STOP: worktree not clean: [$WT_STATUS]"; exit 7; }
ORIGIN0=$(git -C "$WT" rev-parse origin/main)
[ "$ORIGIN0" = "$BASE" ] || { say "STOP: origin/main is $ORIGIN0, but stage 5 fetched $BASE - the route must be measured on the FETCHED value"; exit 7; }

mkdir -p "$LOGS" || { say "STOP: cannot create declared log dir"; exit 9; }
[ ! -e "$JSON" ] || { say "STOP: $JSON already exists - its creation is this stage's write and must stay attributable"; exit 9; }

# THE DEBT, PAID: names, not a number. comm requires sorted input and gets it from `sort`.
git -C "$WT" for-each-ref --format="%(refname)" refs/remotes | sort > "$LIVENAMES"
ADDED=$(comm -13 "$REFNAMES_PIN" "$LIVENAMES" | tr "\n" " ")
GONE=$(comm -23 "$REFNAMES_PIN" "$LIVENAMES" | tr "\n" " ")
[ -z "$ADDED$GONE" ] || { say "STOP: remote ref NAMES drifted since the request - added [$ADDED] gone [$GONE]. The pin names what changed, which a count could not"; exit 8; }
REFS0=$(grep -c . "$REFNAMES_PIN")
WT_LINES0=$(git -C "$WT" worktree list | wc -l)
[ "$WT_LINES0" = "$WT_LINES_EXPECT" ] || { say "STOP: worktree list holds $WT_LINES0 lines, declared $WT_LINES_EXPECT"; exit 8; }
CANON_TRACKED_BEFORE=$(git -C "$HOME_REPO" status --porcelain=v1 --untracked-files=no | wc -l)
say "preconditions: HEAD and ref at $COMMIT, worktree clean, origin/main $ORIGIN0 = the fetched value, ref NAMES identical to the pin ($REFS0 names, added and gone both empty), worktree list $WT_LINES0 lines, canonical tracked $CANON_TRACKED_BEFORE"

LOGS_BEFORE=$(find "$LOGS" -type f | sort | tr "\n" " ")
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
ACK="$LOGS/ACK_START-$STAMP.json"
[ ! -e "$ACK" ] || { say "STOP: an ACK_START already exists under this stamp"; exit 9; }
python3 - "$ACK" "$ACK_START_EVENT_ID" "$LEFT" "$DRIVER_SHA" <<'PYSTART'
import json,sys
from datetime import datetime, timezone
p,ev,left,dsha=sys.argv[1:5]
json.dump({"document":"ACK_START","ack_start_event_id":ev,
  "observed_at":datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
  "stage":"INTEGRATE","stream_id":"crewing/898-client-slice",
  "writer":"crewing-writer@skipi-crewing-17","driver_sha256":dsha,
  "window_seconds_remaining_at_start":int(left)}, open(p,"w"), ensure_ascii=False, indent=2)
PYSTART
say "ACK_START written: $ACK"

# ---- THE MEASUREMENT. No --run-harness, so no harness command may execute. ----
"$GUARD" verify --home crewing --auto-task --repo "$WT" \
    --base "$BASE" --head HEAD --json "$JSON" > "$LOGS/verify.stdout" 2>"$LOGS/verify.stderr"
VERIFY_RC=$?
case "$VERIFY_RC" in
  0) VERDICT_KIND="pass" ;;
  1) VERDICT_KIND="fail" ;;
  *) say "STOP: verify exited $VERIFY_RC - an INSTRUMENT failure, not a verdict (0 pass / 1 fail)"
     sed 's/^/    /' "$LOGS/verify.stderr" | head -5
     exit 10 ;;
esac
say "verify exited $VERIFY_RC = $VERDICT_KIND (0 pass / 1 fail / 2+ instrument failure)"
[ -s "$JSON" ] || { say "STOP: $JSON absent or empty after a verify that exited $VERIFY_RC"; exit 10; }

# Parse by FIELD, never by substring of the printed summary.
python3 - "$JSON" "$EXPECT_TASK" "$EXPECT_FILES" > "$LOGS/parsed.txt" <<'PYPARSE'
import json,sys
d=json.load(open(sys.argv[1])); want_task, want_n = sys.argv[2], int(sys.argv[3])
f=d.get("changed_files") or []
t=d.get("tests") or []
out={
 "schema_version": d.get("schema_version"), "status": d.get("status"),
 "task": d.get("task"), "task_source": d.get("task_source"), "task_rule": d.get("task_rule"),
 "comparison": d.get("comparison"), "sha": d.get("sha"),
 "changed_file_count": len(f), "changed_files": f,
 "protected_paths_touched": d.get("protected_paths_touched"),
 "release_paths_touched": d.get("release_paths_touched"),
 "release_changes": d.get("release_changes"),
 "scope_violations": d.get("scope_violations"),
 "exact_file_set_missing": d.get("exact_file_set_missing"),
 "exact_file_set_unexpected": d.get("exact_file_set_unexpected"),
 "override_present": d.get("override_present"),
 "errors": d.get("errors"),
 "harness_total": len(t),
 "harness_statuses": sorted({x.get("status") for x in t}),
 "harness_executed": [x.get("name") for x in t if x.get("status") != "not_run"],
 "task_matches_prediction": d.get("task")==want_task,
 "file_count_matches_prediction": len(f)==want_n,
}
for k,v in out.items(): print("%s=%s" % (k, json.dumps(v, ensure_ascii=False)))
PYPARSE
sed 's/^/    /' "$LOGS/parsed.txt"
GOT_TASK=$(sed -n 's/^task=//p' "$LOGS/parsed.txt" | tr -d '"')
GOT_N=$(sed -n 's/^changed_file_count=//p' "$LOGS/parsed.txt")
GOT_STATUS=$(sed -n 's/^status=//p' "$LOGS/parsed.txt" | tr -d '"')
EXECUTED=$(sed -n 's/^harness_executed=//p' "$LOGS/parsed.txt")

# A harness that RAN would mean this was not the read-only measurement I declared.
[ "$EXECUTED" = "[]" ] || { say "STOP: harness commands executed $EXECUTED - this stage declared that none would run"; exit 11; }

# Route and file count are this stage's OUTPUT, so a difference from the prediction is a
# FINDING, not a stage failure: the stage succeeded in measuring. Whether to push follows
# from a decision made after this script, not from the script.
[ "$GOT_TASK" = "$EXPECT_TASK" ] || say "FINDING: route resolved to [$GOT_TASK], predicted [$EXPECT_TASK]. The measurement stands and the push decision does not follow from this script"
[ "$GOT_N" = "$EXPECT_FILES" ] || say "FINDING: range holds $GOT_N file(s), predicted $EXPECT_FILES"

HEAD1=$(git -C "$WT" rev-parse HEAD)
REF1=$(git -C "$WT" rev-parse "refs/heads/$BRANCH")
WT_AFTER=$(git -C "$WT" status --porcelain=v1 --untracked-files=all)
WT_LINES1=$(git -C "$WT" worktree list | wc -l)
ORIGIN1=$(git -C "$WT" rev-parse origin/main)
[ "$HEAD1" = "$COMMIT" ] || { say "STOP: HEAD moved to $HEAD1"; exit 12; }
[ "$REF1" = "$COMMIT" ] || { say "STOP: branch ref moved to $REF1"; exit 12; }
[ -z "$WT_AFTER" ] || { say "STOP: worktree dirty after a read-only measurement: [$WT_AFTER]"; exit 12; }
[ "$ORIGIN1" = "$BASE" ] || { say "STOP: origin/main moved to $ORIGIN1"; exit 12; }
# The control for "verify creates no worktree": the same line count before and after.
[ "$WT_LINES1" = "$WT_LINES_EXPECT" ] || { say "STOP: worktree list went $WT_LINES0 -> $WT_LINES1; verify must create none"; exit 12; }
say "controls: HEAD, branch ref and origin/main unmoved; worktree clean; worktree list $WT_LINES0 -> $WT_LINES1, so verify created none"

LOGS_AFTER=$(find "$LOGS" -type f | sort | tr "\n" " ")
{
  echo "driver_sha256=$DRIVER_SHA"
  echo "guard_bin=$GUARD"
  echo "guard_command=verify --home crewing --auto-task --repo $WT --base $BASE --head HEAD --json $JSON"
  echo "run_harness_flag=ABSENT (harnesses must not execute)"
  echo "verify_rc=$VERIFY_RC"
  echo "verify_rc_meaning=0 pass / 1 fail (a VERDICT) / 2+ instrument failure"
  echo "verdict_kind=$VERDICT_KIND"
  echo "status_field=$GOT_STATUS"
  cat "$LOGS/parsed.txt"
  echo "refnames_pin=$REFNAMES_PIN"
  echo "refnames_pin_sha256=$REFNAMES_PIN_SHA"
  echo "refnames_predicate=sorted NAME LIST compared with comm, not a count"
  echo "refnames_added=[${ADDED:-none}]"
  echo "refnames_gone=[${GONE:-none}]"
  echo "refnames_count=$REFS0"
  echo "worktree_list_lines_before=$WT_LINES0"
  echo "worktree_list_lines_after=$WT_LINES1"
  echo "head_before=$HEAD0"; echo "head_after=$HEAD1"
  echo "branch_ref_before=$REF0"; echo "branch_ref_after=$REF1"
  echo "origin_main_before=$ORIGIN0"; echo "origin_main_after=$ORIGIN1"
  echo "worktree_status_after=[$WT_AFTER]"
  echo "log_files_before=[$LOGS_BEFORE]"
  echo "log_files_after=[$LOGS_AFTER]"
  echo "pushed=no"; echo "pr_opened=no"
  echo "canonical_tracked_lines_before=$CANON_TRACKED_BEFORE"
} > "$LOGS/after.txt"
say "after-state written: $LOGS/after.txt"

STOPDOC="$LOGS/ACK_STOP-$STAMP.json"
python3 - "$STOPDOC" "$ACK_STOP_EVENT_ID" "$LOGS/after.txt" "$DRIVER_SHA" <<'PYSTOP'
import hashlib,json,sys
from datetime import datetime, timezone
p,ev,after,dsha=sys.argv[1:5]
json.dump({"document":"ACK_STOP","ack_stop_event_id":ev,
  "ack_stop_writer":"crewing-writer@skipi-crewing-17",
  "observed_at":datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
  "operations_terminated":True,"queued_operations_cancelled":True,
  "driver_sha256":dsha,
  "evidence":{"after_state_path":after,
              "after_state_sha256":hashlib.sha256(open(after,"rb").read()).hexdigest()}},
  open(p,"w"), ensure_ascii=False, indent=2)
PYSTOP
say "ACK_STOP written: $STOPDOC"

CANON_TRACKED_AFTER=$(git -C "$HOME_REPO" status --porcelain=v1 --untracked-files=no | wc -l)
if [ "$CANON_TRACKED_BEFORE" != "$CANON_TRACKED_AFTER" ]; then
    say "FINDING: canonical checkout tracked-change count went $CANON_TRACKED_BEFORE -> $CANON_TRACKED_AFTER"
    exit 13
fi
say "canonical checkout unmoved: tracked-change count $CANON_TRACKED_BEFORE -> $CANON_TRACKED_AFTER"
say "DONE"
