#!/bin/bash
# No.898 stage 7 - EXECUTE the route's 19 harness commands locally, before the push.
# Usage: run-s7-harness.sh <certificate>
#
# WHY THIS STAGE EXISTS, and it is not the reason it was offered:
#   It was suggested as a way to MEASURE the hook's duration. The dearer question is whether
#   the nineteen PASS. The 2026-11-01 push executed SEVEN commands (route crewing-c3b2). My
#   route needs NINETEEN, so twelve of them would run for the first time in this task at the
#   moment of an irreversible action.
#   My first reason for this was STALE and is corrected here rather than left to contradict the
#   request: I argued from owner-authorised RED harness debt, and two of three legs are cured -
#   No.879's stack_build_metadata now pins 0.4.139 on these bytes and on origin/main while the
#   house declares 0.4.139 (PR #76), and No.878's ghost crewing_escaping_negative exists on both
#   (PR #77). On the third, the manager's canon (PROJECT_STATE No.876) says presence 130 and
#   c3b2 1 are NOT baseline red - green on base and main - and that a BRANCH turns them red.
#   So the real reason is narrower and better: twelve have no recorded outcome for THIS task, and
#   the only redness the canon records was caused by a BRANCH rather than by the house - exactly
#   the class a four-file change can reproduce. This run therefore tests MY CHANGE, not the state
#   of the house. Learning it here costs no irreversible action, no temp worktree in a gitdir
#   shared by 85 trees, and no /tmp record - the last because the hook's cleanup sits in a
#   `finally` that a kill would skip.
#
# WHY `verify --run-harness` AND NOT `node tests/*.mjs` BY HAND:
#   Same runner, same order, same cwd semantics, same JSON shape as the hook will use -
#   run_harness_commands() at 604-640, reached from verify. Running them by hand would measure
#   a different thing and report it in a different format.
#
# WHY RUNNING THEM IN THIS WORKTREE IS THE FAITHFUL CHOICE:
#   The hook runs them in a fresh detached worktree that mkdtemp puts DIRECTLY INSIDE
#   /home/linux/Developer/worktrees/. This worktree is itself a direct child of that directory,
#   so `../../skipi-plugins/...` from tests/ resolves through the SAME symlink
#   (worktrees/skipi-plugins -> /home/linux/Developer/skipi-plugins, 2026-07-03) as it will from
#   the hook's temp tree. The FORM matches, not merely the content - which is the lesson from
#   stage 5, where a plain-clone fixture could not expose a per-worktree defect. It also creates
#   NO new entry in the shared gitdir, unlike `git worktree add`.
#
# WHAT THIS NUMBER IS AND IS NOT:
#   A LOWER bound on the hook's duration. The page cache is warm here and this checkout is not
#   fresh, while the hook's tree is created a moment before use. So a local 25 s does not
#   promise a 25 s hook; a local FAILURE, however, does promise a refused push.
#
# TWO of the nineteen leave this worktree, and both are declared:
#   shared_host_runtime_isolation by its command (an absolute path into skipi-plugins), and
#   crewing_plugin_isolation by its IMPORTS - ../../skipi-plugins/_host-runtime/harness/
#   {fake-dom,isolation-contract}.mjs plus a read of an absolute .../dist/RUNTIME_VERSION. A
#   command line does not show what the file it runs imports, which is why the first count of
#   this was one and not two.
set -uo pipefail
case "$0" in -*|bash|sh|"") echo "STOP: \$0 does not name a file"; exit 1 ;; esac
DRIVER_SHA=$(sha256sum "$0" | cut -d" " -f1); echo "driver_sha256=$DRIVER_SHA"

CERT="${1:-}"
HOME_REPO=/home/linux/Developer/skipi-crewing
WT=/home/linux/Developer/worktrees/crewing-898-20261104
GITDIR=/home/linux/Developer/skipi-crewing/.git
GATE=/home/linux/Developer/skipi-parallel-coordinator/tools/stage_gate.py
GUARD=/home/linux/Developer/skipi-guard/bin/skipi-guard
LOGS="$HOME_REPO/scratchpad/crewing-898/stage-harness"
JSON="$LOGS/guard-harness.json"
BRANCH=feat/crewing-898-login-texts-20261104
COMMIT=e5132934064c8ccf701b0061570971c2af220403
BASE=f145c6017eaea3804a5429e5aa428b6fb0ece6d9
REFNAMES_PIN="$HOME_REPO/scratchpad/crewing-898/coord/refnames-s6.txt"
REFNAMES_PIN_SHA=de27f05ff072f1fd4476e3810186653a254e9c015575312b2f43efcd11d42297
WT_LINES_EXPECT=86
EXPECT_HARNESSES=19
EXPECT_TASK=crewing-635-single-user
# An EXTERNAL input that no gate, CI, diff or history can see: /home/linux/Developer/skipi-plugins
# is NOT a git repository (measured: `fatal: not a git repository`, with a pre-vcs sibling from
# 2026-07-02). crewing_plugin_isolation reads this file by ABSOLUTE path at its line 28 and
# asserts byte equality against constants hardcoded at 29-30. Exactly ONE assert depends on the
# LIVE file - line 117, 'shared RUNTIME_VERSION matches embedded runtime hash'; 116, 135 and 136
# compare those constants against MY dist and module exports, so a rebuild leaves them green.
# That is what makes the single tripwire dangerous: one red assert with that wording reads like
# my dist change breaking the plugin contract.
# THE RISK IS INSURANCE, NOT EXPECTATION, and this file must not say otherwise. Measured: the
# versioned SOURCE of this delivered copy is /home/linux/Developer/skipi-host-runtime (git, main,
# clean, dist/RUNTIME_VERSION last touched 2026-07-01 in d623819, 0 unpushed commits), and source
# and copy are BYTE-IDENTICAL with no divergence anywhere in either dist/ tree - so no bump sits
# undelivered. The settings-module card (548a08de...) mentions _host-runtime, RUNTIME_VERSION and
# skipi-plugins ZERO times and writes only dist/skipi-settings.*. So a shift today is measurably
# absent rather than unlikely. The precise description is an artefact with a VERSIONED SOURCE and
# an UNRECORDED DELIVERY: history and diff exist at the source, and what is missing is the link
# between the source and what the hook actually reads. Pinned in evidence_files so a shift becomes
# a mechanical candidate content drift, and read here before AND after so the record carries the
# value the run actually ran against.
RUNTIME_VERSION_FILE=/home/linux/Developer/skipi-plugins/_host-runtime/dist/RUNTIME_VERSION
RUNTIME_VERSION_SHA=022f85f4c6990ee9074c8323a5af07f1ef241ffa1f2a9d180e7df18bbf40b0d1
# 120 s, sized by the COST OF ERROR and NOT by a predicted duration - a stage whose point is to
# MEASURE a duration must not take its window floor from a prediction, or the prediction starts
# guarding the measurement meant to replace it. Both costs here are small and symmetric: starting
# too late costs a lease in DRAIN_REQUIRED plus a re-run, because this action is local,
# reversible, safely interruptible, writes nothing to the shared gitdir and leaves no /tmp
# record; refusing too early costs one round. The floor cannot bias the result either - the wall
# clock is recorded whatever it turns out to be, including above the floor.
# The only recorded magnitudes anywhere belong to OPS TASKCARDS, not to the coordinator (I
# wrongly credited him and he searched his own records): TASKCARD-2026-10-16-crewing-765:55 has
# 16 s for 14 commands on route k2-modules (series 15/16/18/17), and
# TASKCARD-2026-10-05-crewing-664:91 has 35 s for 14 harnesses and 10 s for a 4-harness route.
# Six of my nineteen are separately measured at 12.9 s with one dominating at 12.1 s. None of
# those is this route, and the duration has no upper bound in the code at all: the runner calls
# subprocess.run(..., shell=True) with NO timeout, so a hung harness hangs the stage.
MIN_SECONDS=120
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
say "window: ${LEFT}s remaining (local product test run; floor ${MIN_SECONDS}s, sized by cost of error and NOT a prediction - the duration is what this stage measures)"

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
[ -z "$WT_STATUS" ] || { say "STOP: worktree not clean BEFORE the run: [$WT_STATUS] - the whole point of the after-check is that anything the harnesses write is attributable"; exit 7; }
ORIGIN0=$(git -C "$WT" rev-parse origin/main)
[ "$ORIGIN0" = "$BASE" ] || { say "STOP: origin/main is $ORIGIN0, not the fetched $BASE"; exit 7; }
WT_LINES0=$(git -C "$WT" worktree list | wc -l)
[ "$WT_LINES0" = "$WT_LINES_EXPECT" ] || { say "STOP: worktree list holds $WT_LINES0 lines, declared $WT_LINES_EXPECT"; exit 8; }
CANON_TRACKED_BEFORE=$(git -C "$HOME_REPO" status --porcelain=v1 --untracked-files=no | wc -l)
[ -f "$RUNTIME_VERSION_FILE" ] || { say "STOP: the external runtime pin is absent: $RUNTIME_VERSION_FILE"; exit 6; }
RV0_SHA=$(sha256sum "$RUNTIME_VERSION_FILE" | cut -d" " -f1)
RV0_MTIME=$(stat -c %y "$RUNTIME_VERSION_FILE")
RV0_BODY=$(tr "\n" "|" < "$RUNTIME_VERSION_FILE")
[ "$RV0_SHA" = "$RUNTIME_VERSION_SHA" ] || { say "STOP: the external runtime file changed since the request - sha is $RV0_SHA, declared $RUNTIME_VERSION_SHA. Then ONE assert becomes red for a reason outside my four files (crewing_plugin_isolation line 117, the only one reading the live value) and ONE harness outcome becomes UNKNOWN rather than predictably red (shared_host_runtime_isolation EXECUTES code from that tree)"; exit 6; }
say "external runtime input verified BY VALUE: sha $RV0_SHA, mtime $RV0_MTIME, body [$RV0_BODY]"

mkdir -p "$LOGS" || { say "STOP: cannot create declared log dir"; exit 9; }
[ ! -e "$JSON" ] || { say "STOP: $JSON already exists - its creation is this stage's write and must stay attributable"; exit 9; }
say "preconditions: HEAD and ref at $COMMIT, worktree CLEAN, origin/main $ORIGIN0 = the fetched value, worktree list $WT_LINES0, canonical tracked $CANON_TRACKED_BEFORE"

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
ACK="$LOGS/ACK_START-$STAMP.json"
[ ! -e "$ACK" ] || { say "STOP: an ACK_START already exists under this stamp"; exit 9; }
python3 - "$ACK" "$ACK_START_EVENT_ID" "$LEFT" "$DRIVER_SHA" <<'PYSTART'
import json,sys
from datetime import datetime, timezone
p,ev,left,dsha=sys.argv[1:5]
json.dump({"document":"ACK_START","ack_start_event_id":ev,
  "observed_at":datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
  "stage":"VERIFY_BUILD","stream_id":"crewing/898-client-slice",
  "writer":"crewing-writer@skipi-crewing-17","driver_sha256":dsha,
  "window_seconds_remaining_at_start":int(left)}, open(p,"w"), ensure_ascii=False, indent=2)
PYSTART
say "ACK_START written: $ACK"

# ---- THE RUN. Nineteen node processes in sequence, no network, nothing irreversible. ----
say "executing $EXPECT_HARNESSES harness commands via the guard's own runner"
RUN_START=$(date -u +%s)
# --head "$COMMIT" and not HEAD: the guard copies the literal into its record, which is why
# stage 6's record carries head:"HEAD" and a reader resolved it against the MAIN checkout's HEAD.
# ONE source for the command: the same array runs it and is echoed into after.txt. A separately
# typed provenance line drifts from the call it describes - which is exactly what happened here
# once already, when the call gained --head "$COMMIT" and the echo kept --head HEAD.
GUARD_ARGS=(verify --home crewing --auto-task --repo "$WT" \
    --base "$BASE" --head "$COMMIT" --run-harness --json "$JSON")
GUARD_CMDLINE="$GUARD ${GUARD_ARGS[*]}"
say "command: $GUARD_CMDLINE"
"$GUARD" "${GUARD_ARGS[@]}" > "$LOGS/verify.stdout" 2>"$LOGS/verify.stderr"
VERIFY_RC=$?
RUN_END=$(date -u +%s)
RUN_SECONDS=$((RUN_END - RUN_START))
case "$VERIFY_RC" in
  0) KIND="all pass" ;;
  1) KIND="at least one FAILED - a verdict about the harnesses" ;;
  *) say "STOP: verify exited $VERIFY_RC after ${RUN_SECONDS}s - an INSTRUMENT failure, not a verdict (0 pass / 1 fail)"
     sed 's/^/    /' "$LOGS/verify.stderr" | head -10
     exit 10 ;;
esac
say "verify exited $VERIFY_RC = $KIND, after ${RUN_SECONDS}s wall clock"
[ -s "$JSON" ] || { say "STOP: $JSON absent or empty after a verify that exited $VERIFY_RC"; exit 10; }

python3 - "$JSON" "$EXPECT_HARNESSES" > "$LOGS/parsed.txt" <<'PYPARSE'
import json,sys
from collections import Counter
d=json.load(open(sys.argv[1])); want=int(sys.argv[2])
t=d.get("tests") or []
print("status=%s" % json.dumps(d.get("status")))
print("task=%s" % json.dumps(d.get("task")))
print("comparison=%s" % json.dumps(d.get("comparison")))
print("sha=%s" % json.dumps(d.get("sha")))
print("errors=%s" % json.dumps(d.get("errors")))
print("harness_total=%d" % len(t))
print("harness_status_counts=%s" % json.dumps(dict(Counter(x.get("status") for x in t))))
print("harness_not_run=%s" % json.dumps([x.get("name") for x in t if x.get("status")=="not_run"]))
print("harness_failed=%s" % json.dumps([x.get("name") for x in t if x.get("status")=="fail"]))
print("harness_passed_count=%d" % sum(1 for x in t if x.get("status")=="pass"))
print("count_matches=%s" % json.dumps(len(t)==want))
for x in t:
    print("harness: %-44s %-8s exit=%s" % (x.get("name"), x.get("status"), x.get("exit_code")))
PYPARSE
grep -v '^harness: ' "$LOGS/parsed.txt" | sed 's/^/    /'
grep '^harness: ' "$LOGS/parsed.txt" | sed 's/^/    /'
GOT_N=$(sed -n 's/^harness_total=//p' "$LOGS/parsed.txt")
NOT_RUN=$(sed -n 's/^harness_not_run=//p' "$LOGS/parsed.txt")
FAILED=$(sed -n 's/^harness_failed=//p' "$LOGS/parsed.txt")
PASSED=$(sed -n 's/^harness_passed_count=//p' "$LOGS/parsed.txt")

# POSITIVE CONTROL. Stage 6 established that all nineteen read `not_run` when the flag is
# absent. So the proof that --run-harness took effect is that NONE of them still says not_run.
# Without this, "no failures" would read identically for "they all passed" and "none ran".
# PREMISE, not a report. Reproduced before fixing: a result carrying ZERO tests made the
# not_run control pass VACUOUSLY (0 of 0), printed only a FINDING for the count, never compared
# the route at all, and exited 0 announcing "all 0 harness commands pass". A route resolving to
# another task - default_task here is plugin-host, and resolve_task takes the FIRST matching
# rule - would therefore have produced a green stage that measured the wrong set, which is the
# one thing this stage exists to prevent. So both are STOPs, and they come BEFORE the control.
GOT_TASK=$(sed -n 's/^task=//p' "$LOGS/parsed.txt" | tr -d '"')
[ "$GOT_TASK" = "$EXPECT_TASK" ] || { say "STOP: the route resolved to [$GOT_TASK], this stage's premise is [$EXPECT_TASK] - a different route runs a different set, so the measurement would not be about the thing declared"; exit 14; }
[ "$GOT_N" = "$EXPECT_HARNESSES" ] || { say "STOP: the runner executed $GOT_N commands, the route declares $EXPECT_HARNESSES"; exit 14; }
say "premise verified: route [$GOT_TASK], $GOT_N commands - both as declared, not merely reported"
[ "$NOT_RUN" = "[]" ] || { say "STOP: POSITIVE CONTROL FAILED - these still read not_run: $NOT_RUN. --run-harness did not take effect, so a clean result would mean nothing"; exit 11; }
# And the control counts OUTCOMES, so it cannot be satisfied by an empty or short list.
FAILED_N=$(printf "%s" "$FAILED" | tr -d '[]' | tr ',' '\n' | grep -c . || true)
ACCOUNTED=$((PASSED + FAILED_N))
[ "$ACCOUNTED" = "$EXPECT_HARNESSES" ] || { say "STOP: POSITIVE CONTROL FAILED - $PASSED passed plus $FAILED_N failed accounts for $ACCOUNTED of $EXPECT_HARNESSES; every command must have an outcome"; exit 11; }
say "positive control PASSED: 0 left at not_run and all $EXPECT_HARNESSES accounted for ($PASSED pass, $FAILED_N fail)"

# The verdict itself is this stage's PRODUCT, so a failure is reported, not hidden - and it is
# exactly the thing worth knowing before an irreversible push.
if [ "$FAILED" != "[]" ]; then
    say "VERDICT: harness commands FAILING on the pushed bytes: $FAILED"
    say "  this would REFUSE the push, and knowing it here cost no irreversible action"
    for n in $(printf "%s" "$FAILED" | tr -d '[]"' | tr ',' ' '); do
        say "  --- tail of $n ---"
        python3 - "$JSON" "$n" <<'PYTAIL'
import json,sys
d=json.load(open(sys.argv[1]))
for x in d.get("tests") or []:
    if x.get("name")==sys.argv[2]:
        print((x.get("summary") or "")[:1200])
PYTAIL
    done
fi

HEAD1=$(git -C "$WT" rev-parse HEAD)
REF1=$(git -C "$WT" rev-parse "refs/heads/$BRANCH")
WT_AFTER=$(git -C "$WT" status --porcelain=v1 --untracked-files=all)
WT_LINES1=$(git -C "$WT" worktree list | wc -l)
ORIGIN1=$(git -C "$WT" rev-parse origin/main)
[ "$HEAD1" = "$COMMIT" ] || say "FINDING: HEAD moved to $HEAD1"
[ "$REF1" = "$COMMIT" ] || say "FINDING: branch ref moved to $REF1"
[ "$ORIGIN1" = "$BASE" ] || say "FINDING: origin/main moved to $ORIGIN1"
[ "$WT_LINES1" = "$WT_LINES_EXPECT" ] || say "FINDING: worktree list went $WT_LINES0 -> $WT_LINES1"
# Nineteen test programs ran with cwd in this tree. If any of them writes, the tree is dirty
# and the push's own precondition would refuse. Reported and NOT repaired: restoring someone
# else's test output is a separate decision, and a silent repair would hide which harness did it.
if [ -n "$WT_AFTER" ]; then
    say "FINDING: the worktree is DIRTY after the run - a harness wrote into it:"
    printf '%s\n' "$WT_AFTER" | sed 's/^/      /'
    say "  NOT repaired by this driver: the push precondition requires a clean tree, so this needs a decision, and a silent cleanup would hide which command did it"
else
    say "worktree still CLEAN after nineteen test programs ran in it"
fi

RV1_SHA=$(sha256sum "$RUNTIME_VERSION_FILE" 2>/dev/null | cut -d" " -f1 || echo ABSENT)
RV1_MTIME=$(stat -c %y "$RUNTIME_VERSION_FILE" 2>/dev/null || echo ABSENT)
RV1_BODY=$(tr "\n" "|" < "$RUNTIME_VERSION_FILE" 2>/dev/null || echo ABSENT)
# Measured HERE, before the record is written, so BOTH halves of the pair are durable. ACK_STOP
# hashes after.txt, so a value computed after the write can never be added to it - it would live
# only in stdout. The trade is a millisecond-wide gap between this reading and ACK_STOP, and it
# is worth it: a pair with one half missing cannot be checked by anyone reading the record later.
# This was a COPY REGRESSION - stage 5 measured it before its write and recorded both halves,
# stage 6 did not, and stage 6 is closed so its record stays one half short (the value is in my
# report and in the coordinator's closure, not in its after.txt).
CANON_TRACKED_AFTER=$(git -C "$HOME_REPO" status --porcelain=v1 --untracked-files=no | wc -l)
if [ "$RV1_SHA" != "$RV0_SHA" ]; then
    say "FINDING: the external runtime file changed DURING the run - $RV0_SHA -> $RV1_SHA. Any plugin-harness result above was measured against a moving input"
fi

LOGS_AFTER=$(find "$LOGS" -type f | sort | tr "\n" " ")
{
  echo "driver_sha256=$DRIVER_SHA"
  echo "guard_command=$GUARD_CMDLINE"
  echo "run_harness_flag=PRESENT"
  echo "verify_rc=$VERIFY_RC"
  echo "verify_rc_meaning=0 all pass / 1 at least one failed (a VERDICT) / 2+ instrument failure"
  echo "verdict_kind=$KIND"
  echo "wall_seconds=$RUN_SECONDS"
  echo "wall_seconds_note=LOWER bound for the hook: warm page cache and a checkout that is not fresh, where the hook creates its tree a moment before use"
  cat "$LOGS/parsed.txt"
  echo "external_runtime_file=$RUNTIME_VERSION_FILE"
  echo "external_runtime_in_git=NO - skipi-plugins is not a git repository"
  echo "external_runtime_sha_before=$RV0_SHA"; echo "external_runtime_sha_after=$RV1_SHA"
  echo "external_runtime_mtime_before=$RV0_MTIME"; echo "external_runtime_mtime_after=$RV1_MTIME"
  echo "external_runtime_body_before=[$RV0_BODY]"; echo "external_runtime_body_after=[$RV1_BODY]"
  echo "head_before=$HEAD0"; echo "head_after=$HEAD1"
  echo "branch_ref_before=$REF0"; echo "branch_ref_after=$REF1"
  echo "origin_main_before=$ORIGIN0"; echo "origin_main_after=$ORIGIN1"
  echo "worktree_list_lines_before=$WT_LINES0"; echo "worktree_list_lines_after=$WT_LINES1"
  echo "worktree_status_before=[$WT_STATUS]"
  echo "worktree_status_after=[$WT_AFTER]"
  echo "log_files_after=[$LOGS_AFTER]"
  echo "pushed=no"; echo "pr_opened=no"
  echo "canonical_tracked_lines_before=$CANON_TRACKED_BEFORE"
  echo "canonical_tracked_lines_after=$CANON_TRACKED_AFTER"
  echo "canonical_control_blind_spot=a COUNT at --untracked-files=no: blind to a substitution (one file reverted while another changes) and to a new untracked file there"
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

if [ "$CANON_TRACKED_BEFORE" != "$CANON_TRACKED_AFTER" ]; then
    say "FINDING: canonical checkout tracked-change count went $CANON_TRACKED_BEFORE -> $CANON_TRACKED_AFTER"
    exit 13
fi
say "canonical checkout unmoved: tracked-change count $CANON_TRACKED_BEFORE -> $CANON_TRACKED_AFTER"
if [ -n "$WT_AFTER" ]; then
    say "DONE with a dirty worktree - see the FINDING. The push cannot proceed until that is decided"
    exit 22
fi
if [ "$VERIFY_RC" != "0" ]; then
    say "DONE: the run completed and the VERDICT is that $FAILED would refuse the push. Not a driver failure"
    exit 23
fi
say "DONE: all $GOT_N harness commands pass on the pushed bytes in ${RUN_SECONDS}s"
