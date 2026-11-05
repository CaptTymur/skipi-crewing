#!/bin/bash
# No.898 stage 9 - open the PULL REQUEST, and fetch its head ref as a LOCAL witness.
# Usage: run-s9-pr.sh <certificate>
#
# FOUR NETWORK CALLS, and the window must cover all four. Counted on non-comment lines, because
# an earlier draft of this header said TWO - meaning the two that change or bring state - and a
# number in a pinned document that its own code contradicts is the defect this task keeps finding
# (two harnesses leaving the worktree, not one; "nobody has timed this route"; the committer
# identity). Split by kind:
#   READ-ONLY PRECONDITIONS, which change nothing and may be re-run freely:
#     `git ls-remote` - the branch must be published at this commit (a PR needs a published head);
#     `gh pr list`    - no PR may exist for this head yet, because this stage declares a CREATION.
#   STATE-AFFECTING:
#     `gh pr create`  - the only call with an effect outside this machine;
#     `git fetch`     - brings the witness ref and rewrites the per-worktree FETCH_HEAD.
# None of the four has an upper bound in any code I can read, so the threshold is sized by cost of
# error rather than by a predicted duration - and sized for four calls, not two.
#
# WHY A PR IS A DIFFERENT CLASS FROM THE PUSH:
#   It is REVERSIBLE - a pull request can be closed - so it is not in the class where the bytes
#   cannot be taken back. But closing leaves a visible trace and the opening sends notifications,
#   so it is not silently undoable either. Hence a floor below the push's 180 s and above a purely
#   local stage's.
#
# THE WITNESS PROBLEM, stated plainly because it is a CLASS and not a gap to paper over:
#   `gh pr create` leaves NO local artefact proving a PR exists. refs/pull/* appear only after a
#   fetch; the command's stdout is the writer's report. So the PR number and URL are REPORT for
#   the coordinator and can never be his measurement.
#   But a witness is DERIVABLE. The remote publishes refs/pull/<N>/head only for an existing PR
#   (79 such refs exist there now), and its sha must equal this slice's unique commit. So after
#   the fetch the coordinator reads, himself and without network: a local ref exists and its sha
#   is e5132934… . His measurement is therefore "a PR whose head is THIS commit exists"; the
#   number and the URL stay the writer's report. Two halves, two sources, and the report must not
#   merge them into one voice.
#   LIMIT, so nobody mistakes one for the other: the reflog of the fetched ref will read
#   `fetch …: storing ref`, NOT `update by push`. That verb attributes the LOCAL ref to the fetch,
#   which is correct and expected. The proof that the PR exists is the sha plus the ref being
#   published server-side - never the verb in that reflog.
#
# THE POSITIVE CONTROL CHANGED SHAPE, and the reason is worth keeping:
#   Stage 5 used "per-worktree FETCH_HEAD absent -> exists". That stage SUCCEEDED, and in doing so
#   it SPENT its own control: the file now exists, so this stage's fetch REWRITES it rather than
#   creating it, and "the file is there" would be true even if the fetch never ran. A successful
#   action can strip a predicate of its discriminating power. So the control here is CONTENT:
#   the sha of FETCH_HEAD is pinned before and must DIFFER after, and the nanosecond mtime must
#   move. Not existence, and not the inode - measured earlier, git rewrites this file in place, so
#   the inode is stable and ctime equals mtime to the nanosecond.
#
# A NEGATIVE CONTROL THAT `gh` DID NOT PUSH, which already exists in the repo:
#   `--head` is a promise from gh's own help ("explicitly skip any forking or pushing behavior").
#   It is CHECKED here instead of trusted: after the stage, refs/heads/<branch> and
#   refs/remotes/origin/<branch> must still hold e5132934, and the remote-tracking reflog must
#   still have EXACTLY ONE line. Any push by gh would add a second. Note also that
#   `gh auth status` reports `Git operations protocol: ssh` while this remote is HTTPS, which is a
#   second reason not to let it push.
#   `--dry-run` is NOT used and could not have been: gh's help says it "may still push git
#   changes", so the usual way to rehearse an external command is unavailable. This driver was
#   rehearsed against a STUB gh, the same way the guard stages were.
set -uo pipefail
case "$0" in -*|bash|sh|"") echo "STOP: \$0 does not name a file"; exit 1 ;; esac
DRIVER_SHA=$(sha256sum "$0" | cut -d" " -f1); echo "driver_sha256=$DRIVER_SHA"

CERT="${1:-}"
HOME_REPO=/home/linux/Developer/skipi-crewing
WT=/home/linux/Developer/worktrees/crewing-898-20261104
GITDIR=/home/linux/Developer/skipi-crewing/.git
GATE=/home/linux/Developer/skipi-parallel-coordinator/tools/stage_gate.py
GH=/home/linux/.local/bin/gh
LOGS="$HOME_REPO/scratchpad/crewing-898/stage-pr"
BRANCH=feat/crewing-898-login-texts-20261104
COMMIT=e5132934064c8ccf701b0061570971c2af220403
PR_BASE=main
PR_TITLE="fix(crewing): вход различает две ступени и называет отказ читаемо (No.898)"
BODY="$HOME_REPO/scratchpad/crewing-898/coord/pr-body-898.md"
BODY_SHA=1b9efa3484ea0ed12ae5a12a3f024c83c5b7c4452f05cc72becc9ae98f379fb4
# The spent-transition control, by CONTENT. Stage 5 wrote these values.
FETCHHEAD="$GITDIR/worktrees/crewing-898-20261104/FETCH_HEAD"
FETCHHEAD_SHA=d735ef165a4a277ed96aef52a564dd9cb183648a3df7310b9664a8f8ace86866
# The negative control for "gh did not push": exactly one line, written by stage 8.
BRANCH_REFLOG="$GITDIR/logs/refs/remotes/origin/$BRANCH"
BRANCH_REFLOG_LINES=1
GITCONFIG_SHA=04e1ad8de9c58ecd7e70f36dfe39014374d5130febb2fcbf5d3d24fab1cc10fe
WT_LINES_EXPECT=86
# 120 s. A PR is reversible but not silently so, and there are FOUR network calls with no upper
# bound in the code (two read-only preconditions, two that affect state). Starting too late costs a lease in DRAIN plus a re-run; refusing early costs
# one round. Below the push's 180 because nothing here is irretrievable; above a local stage's
# because closing a PR is visible and the opening notifies people.
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
say "window: ${LEFT}s remaining (FOUR network calls - two read-only preconditions plus two that affect state - none bounded in code; floor ${MIN_SECONDS}s from cost of error)"

[ -n "${ACK_START_EVENT_ID:-}" ] || { say "STOP: ACK_START_EVENT_ID absent"; exit 5; }
[ -n "${ACK_EVENT_ID:-}" ] || { say "STOP: ACK_EVENT_ID absent"; exit 5; }
[ -n "${ACK_STOP_EVENT_ID:-}" ] || { say "STOP: ACK_STOP_EVENT_ID absent"; exit 5; }
[ "$ACK_START_EVENT_ID" != "$ACK_EVENT_ID" ] || { say "STOP: start id equals request id"; exit 5; }
[ "$ACK_START_EVENT_ID" != "$ACK_STOP_EVENT_ID" ] || { say "STOP: start id equals stop id"; exit 5; }
[ "$ACK_EVENT_ID" != "$ACK_STOP_EVENT_ID" ] || { say "STOP: request id equals stop id"; exit 5; }

[ -x "$GH" ] || { say "STOP: gh not executable at $GH"; exit 6; }
[ -f "$BODY" ] || { say "STOP: PR body file absent: $BODY"; exit 6; }
BODY_GOT=$(sha256sum "$BODY" | cut -d" " -f1)
[ "$BODY_GOT" = "$BODY_SHA" ] || { say "STOP: PR body digest is $BODY_GOT, declared $BODY_SHA - the body is what a reviewer reads, so it is pinned"; exit 6; }
CFG_GOT=$(sha256sum "$GITDIR/config" | cut -d" " -f1)
[ "$CFG_GOT" = "$GITCONFIG_SHA" ] || { say "STOP: shared .git/config digest is $CFG_GOT, declared $GITCONFIG_SHA"; exit 6; }

HEAD0=$(git -C "$WT" rev-parse HEAD)
REF0=$(git -C "$WT" rev-parse "refs/heads/$BRANCH")
RTRACK0=$(git -C "$WT" rev-parse "refs/remotes/origin/$BRANCH")
[ "$HEAD0" = "$COMMIT" ] || { say "STOP: HEAD $HEAD0 != $COMMIT"; exit 7; }
[ "$REF0" = "$COMMIT" ] || { say "STOP: branch ref $REF0 != $COMMIT"; exit 7; }
[ "$RTRACK0" = "$COMMIT" ] || { say "STOP: remote-tracking ref $RTRACK0 != $COMMIT"; exit 7; }
WT_STATUS=$(git -C "$WT" status --porcelain=v1 --untracked-files=all)
[ -z "$WT_STATUS" ] || { say "STOP: worktree not clean: [$WT_STATUS]"; exit 7; }

# The branch must EXIST on the remote - the opposite of stage 8's precondition, because a PR
# cannot be opened for a head that is not published.
REMOTE_SHA=$(GIT_TERMINAL_PROMPT=0 git -C "$WT" ls-remote origin "refs/heads/$BRANCH" 2>/dev/null | awk 'NR==1{print $1}')
[ "$REMOTE_SHA" = "$COMMIT" ] || { say "STOP: the remote branch is [$REMOTE_SHA], expected $COMMIT"; exit 7; }
say "remote branch present at $COMMIT (my reading; a REPORT for the coordinator)"

# No PR may already exist for this head: this stage declares a CREATION.
EXISTING=$("$GH" pr list --repo CaptTymur/skipi-crewing --head "$BRANCH" --state all --json number 2>/dev/null || echo "[]")
case "$EXISTING" in
    "[]"|"") say "no pull request exists for this head yet" ;;
    *) say "STOP: a pull request already exists for this head: $EXISTING. This stage declared a creation"; exit 7 ;;
esac

# THE POSITIVE CONTROL, by CONTENT because stage 5 spent the existence transition.
[ -f "$FETCHHEAD" ] || { say "STOP: $FETCHHEAD absent - stage 5 created it, so its absence means something removed it and the content control has no baseline"; exit 8; }
FH0_SHA=$(sha256sum "$FETCHHEAD" | cut -d" " -f1)
FH0_MTIME=$(stat -c %.9Y "$FETCHHEAD")
[ "$FH0_SHA" = "$FETCHHEAD_SHA" ] || { say "STOP: FETCH_HEAD content is $FH0_SHA, declared $FETCHHEAD_SHA - the control compares CONTENT, so its baseline must be the declared one"; exit 8; }
say "positive-control baseline: FETCH_HEAD sha $FH0_SHA, mtime $FH0_MTIME (existence is NOT the control - stage 5 spent that)"

# THE NEGATIVE CONTROL baseline: exactly one reflog line on the remote-tracking ref.
[ -f "$BRANCH_REFLOG" ] || { say "STOP: $BRANCH_REFLOG absent - stage 8 wrote it"; exit 8; }
RL0_LINES=$(grep -c . "$BRANCH_REFLOG")
[ "$RL0_LINES" = "$BRANCH_REFLOG_LINES" ] || { say "STOP: the remote-tracking reflog has $RL0_LINES lines, declared $BRANCH_REFLOG_LINES - a second line would already mean something pushed"; exit 8; }
PR_REFS0=$(git -C "$WT" for-each-ref --format="%(refname)" "refs/remotes/origin/pr/*" | wc -l)
[ "$PR_REFS0" = "0" ] || { say "STOP: refs/remotes/origin/pr/* already holds $PR_REFS0 ref(s)"; exit 8; }
WT_LINES0=$(git -C "$WT" worktree list | wc -l)
[ "$WT_LINES0" = "$WT_LINES_EXPECT" ] || { say "STOP: worktree list holds $WT_LINES0 lines, declared $WT_LINES_EXPECT"; exit 8; }
CANON_TRACKED_BEFORE=$(git -C "$HOME_REPO" status --porcelain=v1 --untracked-files=no | wc -l)
say "preconditions: HEAD/ref/remote-tracking all at $COMMIT, worktree clean, body pinned, config pinned, no existing PR, pr/* empty, reflog 1 line, worktree list $WT_LINES0, canonical $CANON_TRACKED_BEFORE"

mkdir -p "$LOGS" || { say "STOP: cannot create declared log dir"; exit 9; }
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

# ---- EXTERNAL CALL 1: create the pull request. --head forbids any push or fork. ----
GH_ARGS=(pr create --repo CaptTymur/skipi-crewing --base "$PR_BASE" --head "$BRANCH"
         --title "$PR_TITLE" --body-file "$BODY")
say "command: $GH ${GH_ARGS[*]}"
"$GH" "${GH_ARGS[@]}" > "$LOGS/gh.stdout" 2>"$LOGS/gh.stderr"
GH_RC=$?
say "gh pr create exited $GH_RC"
sed 's/^/    out| /' "$LOGS/gh.stdout" | head -10
sed 's/^/    err| /' "$LOGS/gh.stderr" | head -20
if [ "$GH_RC" != "0" ]; then
    say "STOP: gh pr create exited $GH_RC - nothing was created. This is a verdict about the request, not a driver failure"
    exit 20
fi
PR_URL=$(grep -oE 'https://github\.com/[^[:space:]]+/pull/[0-9]+' "$LOGS/gh.stdout" | head -1)
PR_NUM=$(printf "%s" "$PR_URL" | sed 's|.*/pull/||')
case "$PR_NUM" in
    ''|*[!0-9]*) say "STOP: could not parse a PR number from gh's output - got url [$PR_URL]"; exit 21 ;;
esac
say "PR number $PR_NUM, url $PR_URL (both are MY report; the coordinator has no network)"

# ---- EXTERNAL CALL 2: fetch the PR's head ref - the DERIVED local witness. ----
PR_REF="refs/remotes/origin/pr/$PR_NUM"
PR_REFLOG="$GITDIR/logs/$PR_REF"
say "fetching refs/pull/$PR_NUM/head -> $PR_REF (published only for an EXISTING pull request)"
GIT_TERMINAL_PROMPT=0 git -C "$WT" fetch origin "refs/pull/$PR_NUM/head:$PR_REF" \
    > "$LOGS/fetch.stdout" 2>"$LOGS/fetch.stderr"
FETCH_RC=$?
say "fetch exited $FETCH_RC"
sed 's/^/    /' "$LOGS/fetch.stderr" | head -10

# POSITIVE CONTROL, by content.
FH1_SHA=$(sha256sum "$FETCHHEAD" | cut -d" " -f1)
FH1_MTIME=$(stat -c %.9Y "$FETCHHEAD")
FH_MOVED=no
[ "$FH1_SHA" != "$FH0_SHA" ] && FH_MOVED=content
[ "$FH_MOVED" = "no" ] && [ "$FH1_MTIME" != "$FH0_MTIME" ] && FH_MOVED=mtime-only
# if/elif rather than `case` on purpose: check_undefined_funcs parses a case PATTERN as a command
# at statement start, so lowercase labels made it report `content`, `mtime-only` and `no` as
# undefined functions. The code was correct and the reviewer's instrument was noisy, which costs
# him a round; an equivalent formulation that keeps his tool clean is the cheaper side to change.
# The blind spot itself is reported to him separately - it will meet someone else's `case`.
if [ "$FH_MOVED" = "content" ]; then
    say "positive control PASSED: FETCH_HEAD CONTENT changed (sha ${FH0_SHA:0:12} -> ${FH1_SHA:0:12}, mtime $FH0_MTIME -> $FH1_MTIME)"
elif [ "$FH_MOVED" = "mtime-only" ]; then
    say "positive control PASSED: FETCH_HEAD rewritten with IDENTICAL content - sha ${FH0_SHA:0:12} unchanged, mtime $FH0_MTIME -> $FH1_MTIME. Legitimate: a fetch bringing the same bytes rewrites the file, which is why the nanosecond mtime is read and not just the digest"
else
    say "positive control FAILED: FETCH_HEAD did NOT change at all - sha ${FH0_SHA:0:12}, mtime $FH0_MTIME unmoved. A fetch rewrites it unconditionally, so this means the fetch did not run"
fi

# THE WITNESS: a local ref whose sha the coordinator checks himself.
WITNESS_STATE=ABSENT; [ -n "$(git -C "$WT" for-each-ref --format='%(refname)' "$PR_REF")" ] && WITNESS_STATE=EXISTS
WITNESS_SHA=""; [ "$WITNESS_STATE" = "EXISTS" ] && WITNESS_SHA=$(git -C "$WT" rev-parse "$PR_REF")
WITNESS_OK=no; [ "$WITNESS_SHA" = "$COMMIT" ] && WITNESS_OK=yes
WITNESS_REFLOG_LINE=""
[ -f "$PR_REFLOG" ] && WITNESS_REFLOG_LINE=$(tail -1 "$PR_REFLOG")
say "WITNESS: $PR_REF $WITNESS_STATE, sha ${WITNESS_SHA:-none}, equals this slice's commit: $WITNESS_OK"
[ -n "$WITNESS_REFLOG_LINE" ] && say "  its reflog: $WITNESS_REFLOG_LINE"
say "  the verb above attributes the LOCAL ref to the FETCH and is expected; what proves the PR exists is the sha plus the ref being published server-side"
if [ "$FETCH_RC" = "0" ] && [ "$WITNESS_OK" != "yes" ]; then
    say "FINDING: the fetch exited 0 but the witness does not hold this slice's commit (state=$WITNESS_STATE sha=${WITNESS_SHA:-none}). Then refs/pull/$PR_NUM/head is not what this stage claims it is"
fi
if [ "$FETCH_RC" != "0" ]; then
    say "FINDING: the PR was CREATED (url $PR_URL) but the witness fetch failed, so the coordinator has no local check of it - the number and url remain my report alone, and that must be said rather than papered over"
fi

# NEGATIVE CONTROL: gh must not have pushed anything.
HEAD1=$(git -C "$WT" rev-parse HEAD)
REF1=$(git -C "$WT" rev-parse "refs/heads/$BRANCH")
RTRACK1=$(git -C "$WT" rev-parse "refs/remotes/origin/$BRANCH")
RL1_LINES=$(grep -c . "$BRANCH_REFLOG")
WT_AFTER=$(git -C "$WT" status --porcelain=v1 --untracked-files=all)
WT_LINES1=$(git -C "$WT" worktree list | wc -l)
CFG_AFTER=$(sha256sum "$GITDIR/config" | cut -d" " -f1)
GH_PUSHED=no
[ "$RL1_LINES" != "$RL0_LINES" ] && GH_PUSHED=yes
[ "$REF1" != "$COMMIT" ] && GH_PUSHED=yes
[ "$RTRACK1" != "$COMMIT" ] && GH_PUSHED=yes
if [ "$GH_PUSHED" = "yes" ]; then
    say "FINDING: something PUSHED during this stage - reflog lines $RL0_LINES -> $RL1_LINES, branch $REF1, remote-tracking $RTRACK1. --head was supposed to forbid exactly this"
else
    say "negative control: gh did NOT push - remote-tracking reflog still $RL1_LINES line(s), branch and tracking ref still $COMMIT"
fi
[ "$HEAD1" = "$COMMIT" ] || say "FINDING: HEAD moved to $HEAD1"
[ -z "$WT_AFTER" ] || say "FINDING: worktree dirty after the stage: [$WT_AFTER]"
[ "$WT_LINES1" = "$WT_LINES_EXPECT" ] || say "FINDING: worktree list went $WT_LINES0 -> $WT_LINES1"
if [ "$CFG_AFTER" != "$GITCONFIG_SHA" ]; then
    say "FINDING: the shared .git/config changed to $CFG_AFTER - most likely gh writing remote.origin.gh-resolved. Detection rather than prediction was the point; 86 worktrees share that file"
    git -C "$WT" config --get remote.origin.gh-resolved | sed 's/^/      gh-resolved now: /'
fi
CANON_TRACKED_AFTER=$(git -C "$HOME_REPO" status --porcelain=v1 --untracked-files=no | wc -l)

{
  echo "driver_sha256=$DRIVER_SHA"
  echo "gh_binary=$GH"
  echo "gh_command=$GH ${GH_ARGS[*]}"
  echo "gh_rc=$GH_RC"
  echo "dry_run_used=no (gh's help says --dry-run may still push git changes)"
  echo "pr_number=$PR_NUM"
  echo "pr_url=$PR_URL"
  echo "pr_number_and_url_provenance=MY report via gh over the network; NOT the coordinator's measurement"
  echo "pr_body_file=$BODY"; echo "pr_body_sha256=$BODY_GOT"
  echo "pr_base=$PR_BASE"; echo "pr_head=$BRANCH"
  echo "witness_ref=$PR_REF"
  echo "witness_state=$WITNESS_STATE"
  echo "witness_sha=${WITNESS_SHA:-none}"
  echo "witness_equals_slice_commit=$WITNESS_OK"
  echo "witness_provenance=the COORDINATOR's measurement: a local ref he reads without network"
  echo "witness_reflog_line=$WITNESS_REFLOG_LINE"
  echo "witness_reflog_caveat=the verb attributes the LOCAL ref to the fetch; proof of the PR is the sha plus server-side publication"
  echo "fetch_rc=$FETCH_RC"
  echo "positive_control=FETCH_HEAD by CONTENT, because stage 5 SPENT the absent->exists transition"
  echo "fetch_head_path=$FETCHHEAD"
  echo "fetch_head_sha_before=$FH0_SHA"; echo "fetch_head_sha_after=$FH1_SHA"
  echo "fetch_head_mtime_before=$FH0_MTIME"; echo "fetch_head_mtime_after=$FH1_MTIME"
  echo "fetch_head_changed=$FH_MOVED"
  echo "negative_control=gh must not push; a second reflog line would prove it did"
  echo "branch_reflog_lines_before=$RL0_LINES"; echo "branch_reflog_lines_after=$RL1_LINES"
  echo "gh_pushed=$GH_PUSHED"
  echo "head_before=$HEAD0"; echo "head_after=$HEAD1"
  echo "branch_ref_before=$REF0"; echo "branch_ref_after=$REF1"
  echo "remote_tracking_before=$RTRACK0"; echo "remote_tracking_after=$RTRACK1"
  echo "pr_refs_before=$PR_REFS0"
  echo "worktree_status_after=[$WT_AFTER]"
  echo "worktree_list_lines_before=$WT_LINES0"; echo "worktree_list_lines_after=$WT_LINES1"
  echo "shared_git_config_sha_before=$GITCONFIG_SHA"; echo "shared_git_config_sha_after=$CFG_AFTER"
  echo "merged=no"; echo "released=no"
  echo "canonical_tracked_lines_before=$CANON_TRACKED_BEFORE"
  echo "canonical_tracked_lines_after=$CANON_TRACKED_AFTER"
  echo "canonical_control_blind_spot=a COUNT at --untracked-files=no: blind to a substitution and to a new untracked file there"
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
if [ "$GH_PUSHED" = "yes" ] || [ "$FH_MOVED" = "no" ]; then
    say "STOP: the PR exists (url $PR_URL) but a control failed - gh_pushed=$GH_PUSHED fetch_head_changed=$FH_MOVED. Reported with its own code so it is not read as a clean stage"
    exit 22
fi
say "DONE: PR $PR_NUM open at $PR_URL; witness $PR_REF holds $WITNESS_SHA. NOT merged, NOT released, owner acceptance of texts and colour still absent"
