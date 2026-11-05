#!/bin/bash
# No.898 stage 8 - PUSH the branch. The first IRREVERSIBLE, EXTERNAL action of this task.
# Usage: run-s8-push.sh <certificate>
#
# WHAT MAKES THIS DIFFERENT FROM EVERY EARLIER STAGE:
#   The verdict on a push is the HOOK's, not my stage-6 measurement. Stage 6 reproduced the
#   hook's arithmetic read-only; the hook takes base and head from its OWN stdin (it is written
#   that way after SKI-INC-2026-07-16) and re-decides. A clean route from stage 6 is an input,
#   not a permission.
#
# WHAT THE HOOK DOES ON MY BEHALF, measured in bin/skipi-guard, all of it declared:
#   - writes /tmp/skipi-guard-pre-push-crewing.json, because the hook passes NO --json and 853
#     defaults it there. The existing file (from the 2026-11-01 push) is PRESERVED into this
#     stage's logs first: it is the artefact that proved where mkdtemp lands, so losing it to an
#     overwrite would destroy evidence that has already been useful once.
#   - mkdtemp(dir=repo.parent) at 859. `repo` is the hook's --repo, i.e.
#     `git rev-parse --show-toplevel` at the push's cwd, so pushing from THIS worktree puts the
#     temp harness worktree in /home/linux/Developer/worktrees/ - NOT in /home/linux/Developer/,
#     which is the common parent of every house. Measured, not inferred: the 2026-11-01 record
#     has repo=/home/linux/Developer/worktrees/.skipi-guard-harness-wt-crewing-lonaaghy.
#   - `git worktree add --detach` into the SHARED gitdir (865), so worktree list goes 86 -> 87
#     -> 86, and `worktree remove --force` plus rmtree in a `finally` (892-894).
#   - runs all 19 harness commands with run_harness=True (879). Eighteen are `node tests/*.mjs`
#     relative to the temp worktree; exactly one, shared_host_runtime_isolation, is an absolute
#     path into ANOTHER house: node /home/linux/Developer/skipi-plugins/_host-runtime/harness/
#     isolation-contract.mjs. One harness also imports ../../skipi-plugins/... which resolves
#     only because /home/linux/Developer/worktrees/skipi-plugins is a symlink to the real repo
#     (measured; and the 2026-11-01 push passed plugin_isolation from exactly this position).
#   - a push with an explicit refspec also updates refs/remotes/origin/<pushed name> in the
#     shared gitdir. Measured in a fixture: refs/remotes went 2 -> 3. So the pinned NAME SET is
#     expected to gain EXACTLY ONE name, and any other addition is a finding.
#
# WHY THERE IS DELIBERATELY NO `timeout` ON THE PUSH:
#   `timeout` appears ZERO times in bin/skipi-guard - not per harness, not on git calls. The
#   runner is `subprocess.run(command, shell=True)` with no timeout (611), nineteen times in
#   sequence. So the worst case is not bounded by the instrument, and it is NOT bounded by my
#   window either: once `git push` starts, a lease expiry cannot stop it. Killing it mid-flight
#   is precisely what would leave a registered dead worktree in a gitdir shared by 85 working
#   trees - the residue this driver watches for. So the push is left to finish, its PID is
#   RECORDED so a human stop can be done by PID rather than by pattern, and an overrun is
#   reported honestly instead of being dressed up as a window that held.
#
# NO `--no-verify`, EVER: it is forbidden in this house and it is the whole point of the stage.
# NO `-u`/`--set-upstream`: that writes .git/config, which is SHARED by 86 worktrees. The
# config digest is pinned before and after instead.
set -uo pipefail
case "$0" in -*|bash|sh|"") echo "STOP: \$0 does not name a file"; exit 1 ;; esac
DRIVER_SHA=$(sha256sum "$0" | cut -d" " -f1); echo "driver_sha256=$DRIVER_SHA"

CERT="${1:-}"
CONTRADICTION=no
HOME_REPO=/home/linux/Developer/skipi-crewing
WT=/home/linux/Developer/worktrees/crewing-898-20261104
GITDIR=/home/linux/Developer/skipi-crewing/.git
WT_PARENT=/home/linux/Developer/worktrees
GATE=/home/linux/Developer/skipi-parallel-coordinator/tools/stage_gate.py
LOGS="$HOME_REPO/scratchpad/crewing-898/stage-push"
BRANCH=feat/crewing-898-login-texts-20261104
COMMIT=e5132934064c8ccf701b0061570971c2af220403
BASE=f145c6017eaea3804a5429e5aa428b6fb0ece6d9
REFNAMES_PIN="$HOME_REPO/scratchpad/crewing-898/coord/refnames-s6.txt"
REFNAMES_PIN_SHA=de27f05ff072f1fd4476e3810186653a254e9c015575312b2f43efcd11d42297
EXPECT_ADDED="refs/remotes/origin/$BRANCH"
GITCONFIG_SHA=04e1ad8de9c58ecd7e70f36dfe39014374d5130febb2fcbf5d3d24fab1cc10fe
HOOK_JSON=/tmp/skipi-guard-pre-push-crewing.json
# THE LOCAL POSITIVE CONTROL. `core.logAllRefUpdates` is true and this repo is not bare, so git
# writes a reflog for every ref update: 149 reflog files already sit under .git/logs/refs/remotes,
# 51 of them carrying the literal `update by push`. Measured in a fixture rather than assumed, a
# real push writes exactly one line of the form
#   0000000000000000000000000000000000000000 <new sha> <committer> <unix> +0400\tupdate by push
# This is strictly stronger than the ref NAME SET, which proves only that the ref APPEARED: a ref
# file can be created by `update-ref` or by a fetch and the name set reads identically. The reflog
# proves it appeared BY PUSH, and carries the zeros->sha transition and the time.
# And it is LOCAL: ls-remote is my network reading and the coordinator's REPORT, while the reflog
# he can read himself - so this is the one artefact of the stage that moves part of the proof of a
# push from my report into his own measurement. It was undeclared until he found it: overlaps()
# puts it outside all three of my other gitdir tokens.
REFLOG=/home/linux/Developer/skipi-crewing/.git/logs/refs/remotes/origin/feat/crewing-898-login-texts-20261104
WT_LINES_EXPECT=86
EXPECT_HARNESSES=19
# The same external, unversioned input stage 7 pinned, and it matters MORE here: the hook runs the
# harnesses, so a shift between the grant and this push makes ONE assert red
# (crewing_plugin_isolation line 117, the only one reading the live value) and ONE outcome unknown
# (shared_host_runtime_isolation executes code from that tree) - and the push would be REFUSED for
# a reason outside my four files, which on the irreversible stage is the most expensive kind of
# misattribution. It has a VERSIONED SOURCE with an UNRECORDED DELIVERY: /home/linux/Developer/
# skipi-host-runtime (git, main, clean, last touched 2026-07-01) holds the same bytes.
RUNTIME_VERSION_FILE=/home/linux/Developer/skipi-plugins/_host-runtime/dist/RUNTIME_VERSION
RUNTIME_VERSION_SHA=022f85f4c6990ee9074c8323a5af07f1ef241ffa1f2a9d180e7df18bbf40b0d1
# 180 s, and justified from ABOVE rather than from below. Measured crewing pushes WITH the hook
# running: 15/16/18/17 s for a 14-command route (No.765), 35 s for another 14-command route
# (No.664), 15 s for 7 commands, 4 s for 6, 3-10 s for 4. Of MY nineteen, six were separately
# measured at 44/135/46/207/381/12091 ms = 12.9 s with ONE dominating at 12.1 s.
# STAGE 7 then ran all nineteen LOCALLY: 19/19 pass in **15 s** wall clock (its after.txt is the
# source, and that record is closed, so the number cannot drift). It is a LOWER bound for the
# hook and NOT a prediction of it - warm page cache, a checkout that is not fresh, and no
# temp-worktree creation, against the hook's tree made a moment before use. Note it came in below
# all three predictions (my 20-60 s, and ops anchors of 16 s and 35 s for 14 commands), which is
# a reason to trust the measurement and not to re-derive the floor from it: the quantity still
# has NO upper bound in the code. So the expectation is
# 15-45 s, the documented 14-command spread (15-18 vs 35) is real and unexplained, and 180 s is
# about four times the prudent upper end - matching the "budget 180 s with object" precedent
# already in the coordinator's ledger. The widely repeated "60-90 s" is a carried-forward
# threshold that No.664 overturned by measurement; it is not an observation and is not used here.
MIN_SECONDS=180
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
[ "$LEFT" -ge "$MIN_SECONDS" ] || { say "STOP: only ${LEFT}s left, threshold ${MIN_SECONDS}s for an IRREVERSIBLE stage whose duration nobody has measured"; exit 4; }
say "window: ${LEFT}s remaining (irreversible external action; threshold ${MIN_SECONDS}s; expectation 15-45s, worst case UNBOUNDED by the instrument)"

[ -n "${ACK_START_EVENT_ID:-}" ] || { say "STOP: ACK_START_EVENT_ID absent"; exit 5; }
[ -n "${ACK_EVENT_ID:-}" ] || { say "STOP: ACK_EVENT_ID absent"; exit 5; }
[ -n "${ACK_STOP_EVENT_ID:-}" ] || { say "STOP: ACK_STOP_EVENT_ID absent"; exit 5; }
[ "$ACK_START_EVENT_ID" != "$ACK_EVENT_ID" ] || { say "STOP: start id equals request id"; exit 5; }
[ "$ACK_START_EVENT_ID" != "$ACK_STOP_EVENT_ID" ] || { say "STOP: start id equals stop id"; exit 5; }
[ "$ACK_EVENT_ID" != "$ACK_STOP_EVENT_ID" ] || { say "STOP: request id equals stop id"; exit 5; }

[ -f "$REFNAMES_PIN" ] || { say "STOP: ref-name pin absent: $REFNAMES_PIN"; exit 6; }
PIN_GOT=$(sha256sum "$REFNAMES_PIN" | cut -d" " -f1)
[ "$PIN_GOT" = "$REFNAMES_PIN_SHA" ] || { say "STOP: ref-name pin digest is $PIN_GOT, declared $REFNAMES_PIN_SHA"; exit 6; }
CFG_GOT=$(sha256sum "$GITDIR/config" | cut -d" " -f1)
[ "$CFG_GOT" = "$GITCONFIG_SHA" ] || { say "STOP: shared .git/config digest is $CFG_GOT, declared $GITCONFIG_SHA - 86 worktrees share it and this stage must not change it"; exit 6; }

HEAD0=$(git -C "$WT" rev-parse HEAD)
REF0=$(git -C "$WT" rev-parse "refs/heads/$BRANCH")
[ "$HEAD0" = "$COMMIT" ] || { say "STOP: HEAD $HEAD0 != the committed $COMMIT"; exit 7; }
[ "$REF0" = "$COMMIT" ] || { say "STOP: branch ref $REF0 != $COMMIT"; exit 7; }
WT_STATUS=$(git -C "$WT" status --porcelain=v1 --untracked-files=all)
[ -z "$WT_STATUS" ] || { say "STOP: worktree not clean: [$WT_STATUS]"; exit 7; }
ORIGIN0=$(git -C "$WT" rev-parse origin/main)
[ "$ORIGIN0" = "$BASE" ] || { say "STOP: origin/main is $ORIGIN0, not the fetched $BASE - the route was measured against the fetched value"; exit 7; }

mkdir -p "$LOGS" || { say "STOP: cannot create declared log dir"; exit 9; }
git -C "$WT" for-each-ref --format="%(refname)" refs/remotes | sort > "$LOGS/refnames-before.txt"
ADDED0=$(comm -13 "$REFNAMES_PIN" "$LOGS/refnames-before.txt" | tr "\n" " ")
GONE0=$(comm -23 "$REFNAMES_PIN" "$LOGS/refnames-before.txt" | tr "\n" " ")
[ -z "$ADDED0$GONE0" ] || { say "STOP: remote ref NAMES drifted since the request - added [$ADDED0] gone [$GONE0]"; exit 8; }
WT_LINES0=$(git -C "$WT" worktree list | wc -l)
[ "$WT_LINES0" = "$WT_LINES_EXPECT" ] || { say "STOP: worktree list holds $WT_LINES0 lines, declared $WT_LINES_EXPECT"; exit 8; }
PRUNABLE0=$(git -C "$WT" worktree list --porcelain | grep -c "^prunable" || true)
[ "$PRUNABLE0" = "0" ] || { say "STOP: $PRUNABLE0 prunable worktree(s) already registered - clean that before adding an action that creates one"; exit 8; }
RESIDUE0=$(ls -d "$WT_PARENT"/.skipi-guard-harness-wt-* 2>/dev/null | wc -l)
[ "$RESIDUE0" = "0" ] || { say "STOP: $RESIDUE0 stale harness worktree dir(s) already in $WT_PARENT"; exit 8; }

# POSITIVE CONTROL, before-half: the branch must NOT exist on the remote, so the control is a
# transition from nothing to a named sha. ls-remote is a NETWORK READ, and it is mine: the
# coordinator has no network, so the fact of the push is my reading and a REPORT for him.
REMOTE0=$(GIT_TERMINAL_PROMPT=0 git -C "$WT" ls-remote origin "refs/heads/$BRANCH" 2>"$LOGS/ls-remote-before.err")
REMOTE0_N=$(printf "%s" "$REMOTE0" | grep -c . || true)
[ "$REMOTE0_N" = "0" ] || { say "STOP: the branch ALREADY exists on the remote: [$REMOTE0]. This stage declared a creation, not an update - and the base mode would differ: a non-zero remote_sha makes resolve_push_base use THAT sha, so the range and possibly the route change and stage 6's verdict does not transfer"; exit 7; }
# The local half of the same premise: a leftover reflog would make the "absent -> exists" control
# vacuous, so it must not be there either.
[ ! -e "$REFLOG" ] || { say "STOP: a reflog for this remote-tracking ref already exists at $REFLOG - the control is a transition from NOTHING, and a leftover would make it vacuous"; exit 7; }
say "local control, before: reflog ABSENT at $REFLOG"

# The hook will overwrite the default json. Preserve the existing one with its digest FIRST.
if [ -f "$HOOK_JSON" ]; then
    cp "$HOOK_JSON" "$LOGS/hook-json-BEFORE-preserved.json"
    PREV_SHA=$(sha256sum "$LOGS/hook-json-BEFORE-preserved.json" | cut -d" " -f1)
    PREV_MTIME=$(stat -c %y "$HOOK_JSON")
    say "preserved the previous hook record: sha256 $PREV_SHA, mtime $PREV_MTIME"
else
    PREV_SHA=NONE; PREV_MTIME=NONE
    say "no previous hook record at $HOOK_JSON"
fi
[ -f "$RUNTIME_VERSION_FILE" ] || { say "STOP: the external runtime pin is absent: $RUNTIME_VERSION_FILE"; exit 6; }
RV0_SHA=$(sha256sum "$RUNTIME_VERSION_FILE" | cut -d" " -f1)
RV0_BODY=$(tr "\n" "|" < "$RUNTIME_VERSION_FILE")
[ "$RV0_SHA" = "$RUNTIME_VERSION_SHA" ] || { say "STOP: the external runtime file changed since the request - sha is $RV0_SHA, declared $RUNTIME_VERSION_SHA. The hook would then refuse this push for a reason outside my four files, and a refusal is cheap only when it is attributable"; exit 6; }
say "external runtime input verified BY VALUE: sha $RV0_SHA, body [$RV0_BODY]"
CANON_TRACKED_BEFORE=$(git -C "$HOME_REPO" status --porcelain=v1 --untracked-files=no | wc -l)
say "preconditions: HEAD and ref at $COMMIT, worktree clean, origin/main $ORIGIN0 = the fetched value, ref names identical to the pin, worktree list $WT_LINES0, prunable 0, residue dirs 0, shared .git/config digest matches, branch ABSENT on the remote, canonical tracked $CANON_TRACKED_BEFORE"

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

# ---- THE IRREVERSIBLE ACTION. Explicit refspec; no --no-verify; no -u; no timeout. ----
say "pushing refs/heads/$BRANCH -> refs/heads/$BRANCH (the hook now runs $EXPECT_HARNESSES harnesses)"
PUSH_START=$(date -u +%s)
# ONE source for the command: the same array runs it and is echoed into after.txt. A separately
# typed provenance line drifts from the call it describes - caught in the stage-7 driver, where
# the call gained --head "$COMMIT" while the echo kept --head HEAD.
PUSH_ARGS=(-C "$WT" push origin "refs/heads/$BRANCH:refs/heads/$BRANCH")
PUSH_CMDLINE="git ${PUSH_ARGS[*]}"
say "command: $PUSH_CMDLINE"
GIT_TERMINAL_PROMPT=0 git "${PUSH_ARGS[@]}" > "$LOGS/push.stdout" 2>"$LOGS/push.stderr" &
PUSH_PID=$!
echo "$PUSH_PID" > "$LOGS/push.pid"
say "push PID $PUSH_PID recorded to $LOGS/push.pid (a stop, if ever needed, goes by this PID and not by pattern)"
wait "$PUSH_PID"
PUSH_RC=$?
PUSH_END=$(date -u +%s)
PUSH_SECONDS=$((PUSH_END - PUSH_START))
say "push exited $PUSH_RC after ${PUSH_SECONDS}s (the first measurement of the HOOK's duration - a DIFFERENT object from stage 7, which ran the same nineteen locally; that one is a lower bound for this one)"
sed 's/^/    out| /' "$LOGS/push.stdout" | head -20
sed 's/^/    err| /' "$LOGS/push.stderr" | head -30

# POSITIVE CONTROL, after-half. Measured regardless of rc, because a refusal must PROVE that
# nothing was pushed - that is the whole value of a gate.
REMOTE1=$(GIT_TERMINAL_PROMPT=0 git -C "$WT" ls-remote origin "refs/heads/$BRANCH" 2>"$LOGS/ls-remote-after.err")
REMOTE1_SHA=$(printf "%s" "$REMOTE1" | awk 'NR==1{print $1}')
REMOTE1_N=$(printf "%s" "$REMOTE1" | grep -c . || true)

if [ "$PUSH_RC" != "0" ]; then
    say "push REFUSED or FAILED (rc $PUSH_RC). Proving nothing was pushed rather than asserting it:"
    if [ "$REMOTE1_N" = "0" ]; then
        say "  confirmed: the branch is still ABSENT on the remote, so the refusal cost nothing"
    else
        say "  FINDING: rc was $PUSH_RC yet the remote now holds the branch at $REMOTE1_SHA - a partial push needs a human"
    fi
    grep -n "Skipi Guard pre-push" "$LOGS/push.stderr" "$LOGS/push.stdout" 2>/dev/null | sed 's/^/    /' | head -10
fi

# LOCAL POSITIVE CONTROL, after. Measured regardless of rc, like the remote half.
REFLOG_STATE=ABSENT; [ -e "$REFLOG" ] && REFLOG_STATE=EXISTS
REFLOG_LINE=""; REFLOG_LINES=0; REFLOG_BYPUSH=no; REFLOG_FROM_ZEROS=no; REFLOG_TO_COMMIT=no
if [ "$REFLOG_STATE" = "EXISTS" ]; then
    REFLOG_LINES=$(grep -c . "$REFLOG" || true)
    REFLOG_LINE=$(tail -1 "$REFLOG")
    case "$REFLOG_LINE" in *"update by push"*) REFLOG_BYPUSH=yes ;; esac
    case "$REFLOG_LINE" in 0000000000000000000000000000000000000000\ *) REFLOG_FROM_ZEROS=yes ;; esac
    case "$REFLOG_LINE" in *" $COMMIT "*) REFLOG_TO_COMMIT=yes ;; esac
    say "local control, after: reflog EXISTS, $REFLOG_LINES line(s), by-push=$REFLOG_BYPUSH from-zeros=$REFLOG_FROM_ZEROS to-commit=$REFLOG_TO_COMMIT"
    say "  $REFLOG_LINE"
else
    say "local control, after: reflog still ABSENT"
fi
if [ "$PUSH_RC" = "0" ]; then
    if [ "$REFLOG_STATE" != "EXISTS" ] || [ "$REFLOG_BYPUSH" != "yes" ] || [ "$REFLOG_FROM_ZEROS" != "yes" ] || [ "$REFLOG_TO_COMMIT" != "yes" ]; then
        say "FINDING: the push exited 0 but the local reflog does not attest a creation by push (exists=$REFLOG_STATE by-push=$REFLOG_BYPUSH from-zeros=$REFLOG_FROM_ZEROS to-commit=$REFLOG_TO_COMMIT). The ref name set cannot tell a push from an update-ref or a fetch, which is why this control exists"
        CONTRADICTION=yes
    fi
fi

# Residue control: the hook's cleanup sits in a `finally`, so a kill skips it.
WT_LINES1=$(git -C "$WT" worktree list | wc -l)
PRUNABLE1=$(git -C "$WT" worktree list --porcelain | grep -c "^prunable" || true)
RESIDUE1=$(ls -d "$WT_PARENT"/.skipi-guard-harness-wt-* 2>/dev/null | wc -l)
RESIDUE1_LIST=$(ls -d "$WT_PARENT"/.skipi-guard-harness-wt-* 2>/dev/null | tr "\n" " ")
if [ "$WT_LINES1" != "$WT_LINES_EXPECT" ] || [ "$PRUNABLE1" != "0" ] || [ "$RESIDUE1" != "0" ]; then
    say "FINDING: residue after the hook - worktree list $WT_LINES0 -> $WT_LINES1, prunable $PRUNABLE1, harness dirs $RESIDUE1 [$RESIDUE1_LIST]. The hook's cleanup is in a finally and a kill skips it. The repair is \`git worktree prune\` plus removing the directory, and this driver does NOT do it silently"
else
    say "residue control: worktree list $WT_LINES0 -> $WT_LINES1, prunable 0, harness dirs 0 - the hook cleaned up after itself"
fi

# Ref name set: exactly ONE addition is expected, and only that one.
git -C "$WT" for-each-ref --format="%(refname)" refs/remotes | sort > "$LOGS/refnames-after.txt"
ADDED1=$(comm -13 "$LOGS/refnames-before.txt" "$LOGS/refnames-after.txt" | tr "\n" " ")
GONE1=$(comm -23 "$LOGS/refnames-before.txt" "$LOGS/refnames-after.txt" | tr "\n" " ")
ADDED1_TRIM=$(printf "%s" "$ADDED1" | sed 's/ *$//')
if [ "$PUSH_RC" = "0" ]; then
    [ "$ADDED1_TRIM" = "$EXPECT_ADDED" ] || say "FINDING: expected exactly one new remote-tracking ref [$EXPECT_ADDED], got added [$ADDED1] gone [$GONE1]"
else
    [ -z "$ADDED1$GONE1" ] || say "FINDING: the push failed yet remote ref names changed - added [$ADDED1] gone [$GONE1]"
fi

HEAD1=$(git -C "$WT" rev-parse HEAD)
REF1=$(git -C "$WT" rev-parse "refs/heads/$BRANCH")
WT_AFTER=$(git -C "$WT" status --porcelain=v1 --untracked-files=all)
ORIGIN1=$(git -C "$WT" rev-parse origin/main)
CFG_AFTER=$(sha256sum "$GITDIR/config" | cut -d" " -f1)
[ "$HEAD1" = "$COMMIT" ] || say "FINDING: HEAD moved to $HEAD1"
[ "$REF1" = "$COMMIT" ] || say "FINDING: branch ref moved to $REF1"
[ -z "$WT_AFTER" ] || say "FINDING: worktree dirty after the push: [$WT_AFTER]"
[ "$ORIGIN1" = "$BASE" ] || say "FINDING: origin/main moved to $ORIGIN1"
[ "$CFG_AFTER" = "$GITCONFIG_SHA" ] || say "FINDING: shared .git/config changed to $CFG_AFTER - no -u was passed, so nothing should have written it"

# Measured HERE, before the record is written, so BOTH halves of the pair are durable: ACK_STOP
# hashes after.txt, so a value computed after the write can only ever live in stdout. Stage 5 did
# this correctly and stage 6 did not - a copy regression, and stage 6 is closed so its record
# stays one half short.
RV1_SHA=$(sha256sum "$RUNTIME_VERSION_FILE" 2>/dev/null | cut -d" " -f1 || echo ABSENT)
RV1_BODY=$(tr "\n" "|" < "$RUNTIME_VERSION_FILE" 2>/dev/null || echo ABSENT)
[ "$RV1_SHA" = "$RV0_SHA" ] || say "FINDING: the external runtime file changed DURING the push - $RV0_SHA -> $RV1_SHA. Any harness verdict from the hook was then measured against a moving input"
CANON_TRACKED_AFTER=$(git -C "$HOME_REPO" status --porcelain=v1 --untracked-files=no | wc -l)

# The hook's own record, parsed BY FIELD.
HOOK_SHA=NONE; HOOK_STATUS=NONE; HOOK_TASK=NONE; HOOK_N=NONE; HOOK_STATUSES=NONE; HOOK_FAILED=NONE
# Set when the hook's own record CONTRADICTS a successful push. With the real guard a failing
# harness makes the hook exit non-zero and the push is refused, so "pushed AND a harness failed"
# cannot happen - which is exactly why it must not be a quiet line in a log. It gets its own
# exit code, after ACK_STOP, so the anomaly is impossible to miss.
CONTRADICTION=no
if [ -f "$HOOK_JSON" ]; then
    HOOK_SHA=$(sha256sum "$HOOK_JSON" | cut -d" " -f1)
    cp "$HOOK_JSON" "$LOGS/hook-json-AFTER.json"
    python3 - "$LOGS/hook-json-AFTER.json" > "$LOGS/hook-parsed.txt" <<'PYHOOK'
import json,sys
d=json.load(open(sys.argv[1])); t=d.get("tests") or []
from collections import Counter
print("hook_status=%s" % json.dumps(d.get("status")))
print("hook_task=%s" % json.dumps(d.get("task")))
print("hook_repo=%s" % json.dumps(d.get("repo")))
print("hook_base=%s" % json.dumps(d.get("base")))
print("hook_head=%s" % json.dumps(d.get("head")))
print("hook_comparison=%s" % json.dumps(d.get("comparison")))
print("hook_errors=%s" % json.dumps(d.get("errors")))
print("hook_push_ref=%s" % json.dumps(d.get("push_ref")))
print("harness_total=%d" % len(t))
print("harness_status_counts=%s" % json.dumps(dict(Counter(x.get("status") for x in t))))
print("harness_failed=%s" % json.dumps([x.get("name") for x in t if x.get("status") != "pass"]))
print("harness_names=%s" % json.dumps([x.get("name") for x in t]))
PYHOOK
    sed 's/^/    /' "$LOGS/hook-parsed.txt"
    HOOK_STATUS=$(sed -n 's/^hook_status=//p' "$LOGS/hook-parsed.txt" | tr -d '"')
    HOOK_TASK=$(sed -n 's/^hook_task=//p' "$LOGS/hook-parsed.txt" | tr -d '"')
    HOOK_N=$(sed -n 's/^harness_total=//p' "$LOGS/hook-parsed.txt")
    HOOK_STATUSES=$(sed -n 's/^harness_status_counts=//p' "$LOGS/hook-parsed.txt")
    HOOK_FAILED=$(sed -n 's/^harness_failed=//p' "$LOGS/hook-parsed.txt")
    [ "$HOOK_N" = "$EXPECT_HARNESSES" ] || { say "FINDING: the hook ran $HOOK_N harness commands, the route declares $EXPECT_HARNESSES"; CONTRADICTION=yes; }
    [ "$HOOK_FAILED" = "[]" ] || { say "FINDING: harness commands not passing: $HOOK_FAILED"; CONTRADICTION=yes; }
else
    say "FINDING: $HOOK_JSON absent after the push - the hook writes it by default, so its absence means the hook did not reach that line"
    [ "$PUSH_RC" != "0" ] || CONTRADICTION=yes
fi

{
  echo "driver_sha256=$DRIVER_SHA"
  echo "action=$PUSH_CMDLINE"
  echo "no_verify_used=no"; echo "set_upstream_used=no"; echo "timeout_used=no (deliberate; see the header)"
  echo "push_rc=$PUSH_RC"
  echo "push_wall_seconds=$PUSH_SECONDS"
  echo "push_pid=$PUSH_PID"
  echo "harnesses_expected=$EXPECT_HARNESSES"
  echo "remote_branch_before_count=$REMOTE0_N"
  echo "remote_branch_after_sha=${REMOTE1_SHA:-NONE}"
  echo "remote_branch_after_count=$REMOTE1_N"
  echo "positive_control=branch ABSENT -> ${REMOTE1_SHA:-STILL ABSENT}"
  echo "expected_added_ref=$EXPECT_ADDED"
  echo "refnames_added=[${ADDED1:-none}]"; echo "refnames_gone=[${GONE1:-none}]"
  echo "worktree_list_lines_before=$WT_LINES0"; echo "worktree_list_lines_after=$WT_LINES1"
  echo "prunable_before=$PRUNABLE0"; echo "prunable_after=$PRUNABLE1"
  echo "harness_residue_dirs_before=$RESIDUE0"; echo "harness_residue_dirs_after=$RESIDUE1"
  echo "harness_residue_list=[$RESIDUE1_LIST]"
  echo "head_before=$HEAD0"; echo "head_after=$HEAD1"
  echo "branch_ref_before=$REF0"; echo "branch_ref_after=$REF1"
  echo "origin_main_before=$ORIGIN0"; echo "origin_main_after=$ORIGIN1"
  echo "worktree_status_after=[$WT_AFTER]"
  echo "shared_git_config_sha_before=$GITCONFIG_SHA"; echo "shared_git_config_sha_after=$CFG_AFTER"
  echo "hook_json_path=$HOOK_JSON"
  echo "hook_json_prev_sha256=$PREV_SHA"; echo "hook_json_prev_mtime=$PREV_MTIME"
  echo "hook_json_new_sha256=$HOOK_SHA"
  echo "hook_status=$HOOK_STATUS"; echo "hook_task=$HOOK_TASK"
  echo "hook_harness_total=$HOOK_N"; echo "hook_harness_status_counts=$HOOK_STATUSES"
  echo "hook_harness_failed=$HOOK_FAILED"
  echo "hook_record_contradicts_success=$CONTRADICTION"
  echo "pr_opened=no"
  echo "reflog_path=$REFLOG"
  echo "reflog_role=LOCAL positive control; proves the ref arrived BY PUSH, which the name set cannot"
  echo "reflog_state_before=ABSENT (gated: exit 7 if present)"
  echo "reflog_state_after=$REFLOG_STATE"
  echo "reflog_lines_after=$REFLOG_LINES"
  echo "reflog_by_push=$REFLOG_BYPUSH"
  echo "reflog_from_zeros=$REFLOG_FROM_ZEROS"
  echo "reflog_to_commit=$REFLOG_TO_COMMIT"
  echo "reflog_line=$REFLOG_LINE"
  echo "external_runtime_file=$RUNTIME_VERSION_FILE"
  echo "external_runtime_sha_before=$RV0_SHA"; echo "external_runtime_sha_after=$RV1_SHA"
  echo "external_runtime_body_before=[$RV0_BODY]"; echo "external_runtime_body_after=[$RV1_BODY]"
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
if [ "$PUSH_RC" = "0" ] && [ "$CONTRADICTION" = "yes" ]; then
    say "STOP: the push SUCCEEDED but the hook's own record contradicts that - see the FINDING lines above. The bytes are on the remote and cannot be taken back by this driver; this exit exists so the contradiction is not read as a clean stage"
    exit 21
fi
if [ "$PUSH_RC" != "0" ]; then
    say "DONE (push REFUSED, rc $PUSH_RC; nothing pushed - see above). The hook's refusal is a VERDICT, not a driver failure"
    exit 20
fi
say "DONE (pushed; branch now at ${REMOTE1_SHA:-unknown} on the remote)"
