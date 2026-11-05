#!/bin/bash
# No.898 3e - pin the OTHER side of the migration_required fork.
# Usage: run-s3e.sh <certificate>
#
# The house test `native635_880_f11_production_policy_on_clean_install_reaches_fresh` asserts
# that the PRODUCTION policy reaches fresh allocation. NOTHING asserts what the other policy
# does. So if `for_interactive_login()` changes, or a second caller appears passing
# `CreationPolicy::ExistingOrUncertain`, the refusal comes alive in the product and no test
# goes red. Experiment (4) demonstrated the branch IS reachable through the existing API -
# same clean install, only the policy differs, result Err("migration_required") - proven on a
# copy with an external CARGO_TARGET_DIR, outside any window. This stage pins that side.
#
# The Rust suite is NOT run in this window: 249/0 under umask 0022 is evidence of the dry run.
# Under the machine default umask 0002 the same suite is 234/15 for the pre-existing reason
# filed as No.922. In the window: the write, and the fast JS harness, which is UNCHANGED at 184
# because the twin is a Rust test.
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
PATCH="$HOME_REPO/scratchpad/crewing-898/coord/patch-s3e-twin.py"
LOGS="$HOME_REPO/scratchpad/crewing-898/stage-implement-3e"
RS_REL=src-tauri/src/native_lifecycle.rs
JOINT_REL=src-tauri/src/native_local_joint_tests.rs
HARN_REL=tests/crewing635_public_settings_harness.mjs
DIST_PRE=96b6bd5000f957155569b342a236c17b51e244a8291475cf82260d1980fdf3fa
HARN_PRE=78b44acfe17777b6795bf51fe191fc79c4a58cd573d05676252d603628cf805f
RS_PRE=e611fae5478234a34415d18452c738612828a38a575d417d5777f9b0f041af48
RS_POST=e611fae5478234a34415d18452c738612828a38a575d417d5777f9b0f041af48
HARN_POST=78b44acfe17777b6795bf51fe191fc79c4a58cd573d05676252d603628cf805f
JOINT_PRE=a070d241e73018a1b156ab17aa44b36448739fecb24d778989c3538af8197d5d
JOINT_POST=ecdd480d3df4eeafb15fc7060a81e62cb88234da0c631417e02a77bb222b81b3
DIST_POST=96b6bd5000f957155569b342a236c17b51e244a8291475cf82260d1980fdf3fa
# DIST_PRE == DIST_POST, HARN_PRE == HARN_POST and RS_PRE == RS_POST are all deliberate: 3e
# touches ONE file, and pinning the other three EQUAL on both sides is how "untouched" is
# asserted rather than assumed. Any stray write to them fails at exit 11.
BASE=f145c6017eaea3804a5429e5aa428b6fb0ece6d9
WANT_PASSED=184
MIN_SECONDS=30

say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
dsha() { sha256sum "$1" | cut -d" " -f1; }

# ---- GATE 1: AUTHORITY. Only PERMIT_CURRENT, matched not read. ----
[ -n "$CERT" ] || { say "STOP: no certificate path given"; exit 2; }
[ -f "$CERT" ] || { say "STOP: certificate not a file: $CERT"; exit 2; }
# The verdict is read as a FIELD, never grepped as a substring. `check` prints JSON with a
# `verdict` key (stage_gate.py:160). A substring grep is safe only while no other printed text
# can contain the token - and write_certificate.py holds the literal PERMIT_CURRENT inside
# `verdict_note`, so the day `check` ever prints a certificate the grep becomes
# self-confirming. One line removes the dependency on someone else's output format.
# Heredoc + argv, matching the idiom already used for the window below. Not `python3 -c`:
# check_undefined_funcs.py skips HEREDOC lines only, so an inline -c block reads as shell and
# its `import`/`try`/`except` surface as undefined commands. And not stdin either - a heredoc
# already occupies it, so the gate's output travels as an argument.
GATE_OUT=$(python3 "$GATE" check --certificate "$CERT" 2>/dev/null)
VERDICT=$(python3 - "$GATE_OUT" <<'PYEOF'
import json, sys
try:
    print(json.loads(sys.argv[1]).get("verdict", "<no-verdict-key>"))
except Exception as exc:
    print("<unparseable:%s>" % type(exc).__name__)
PYEOF
)
[ "$VERDICT" = "PERMIT_CURRENT" ] || { say "STOP: gate verdict is [$VERDICT], not PERMIT_CURRENT"; exit 3; }
say "gate: verdict field parsed = PERMIT_CURRENT"

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
say "window: ${LEFT}s remaining (measured need: patch <1s + harness ~0.55s; no cargo in this window)"

# ---- GATE 3: preconditions, each with its own exit ----
[ -n "${ACK_START_EVENT_ID:-}" ] || { say "STOP: ACK_START_EVENT_ID not in environment - the act of starting needs its OWN id, distinct from the request event"; exit 5; }
[ -n "${ACK_EVENT_ID:-}" ] || { say "STOP: ACK_EVENT_ID (the request event) not in environment"; exit 5; }
[ "$ACK_START_EVENT_ID" != "$ACK_EVENT_ID" ] || { say "STOP: start id equals the request id - the journal could not tell input from act"; exit 5; }
[ -n "${ACK_STOP_EVENT_ID:-}" ] || { say "STOP: ACK_STOP_EVENT_ID not in environment - the terminal action needs its OWN id"; exit 5; }
[ "$ACK_START_EVENT_ID" != "$ACK_STOP_EVENT_ID" ] || { say "STOP: start and stop ids are identical - two terminal actions would be indistinguishable"; exit 5; }
[ "$ACK_EVENT_ID" != "$ACK_STOP_EVENT_ID" ] || { say "STOP: request and stop ids are identical - a replay of complete would return the recorded outcome instead of a fresh one"; exit 5; }
[ -f "$PATCH" ] || { say "STOP: patch script absent"; exit 6; }
say "subject: the joint tests, POST pinned to $JOINT_POST (dist, harness and lifecycle are pinned EQUAL on both sides and must not move)"
WT_HEAD=$(git -C "$WT" rev-parse HEAD)
[ "$WT_HEAD" = "$BASE" ] || { say "STOP: worktree HEAD $WT_HEAD != base $BASE"; exit 7; }
# The predicate is about the EXPECTED state, not emptiness. Carrying "clean" over from the F12
# driver was wrong once already: the THREE modified files ARE this stage's declared PRE state,
# the 3c POST it builds on. Comparing the whole OUTPUT (not a line count) also keeps what the
# zero-check was really guarding - a stray .tmp-* left by an interrupted write would not match and would refuse.
WT_STATUS=$(git -C "$WT" status --porcelain=v1 --untracked-files=all)
WT_EXPECT=$(printf ' M dist/index.html\n M src-tauri/src/native_lifecycle.rs\n M tests/crewing635_public_settings_harness.mjs')
[ "$WT_STATUS" = "$WT_EXPECT" ] || { say "STOP: worktree is not at the declared PRE state. Expected exactly the three declared modified files left by 3c; got: [$WT_STATUS]"; exit 7; }
D0=$(dsha "$WT/dist/index.html"); H0=$(dsha "$WT/$HARN_REL"); R0=$(dsha "$WT/$RS_REL"); J0=$(dsha "$WT/$JOINT_REL")
[ "$D0" = "$DIST_PRE" ] || { say "STOP: dist PRE $D0 != pinned $DIST_PRE"; exit 8; }
[ "$H0" = "$HARN_PRE" ] || { say "STOP: harness PRE $H0 != pinned $HARN_PRE"; exit 8; }
[ "$R0" = "$RS_PRE" ] || { say "STOP: native_lifecycle.rs PRE $R0 != pinned $RS_PRE"; exit 8; }
[ "$J0" = "$JOINT_PRE" ] || { say "STOP: joint tests PRE $J0 != pinned $JOINT_PRE"; exit 8; }
CANON_TRACKED_BEFORE=$(git -C "$HOME_REPO" status --porcelain=v1 --untracked-files=no | wc -l)
say "preconditions: vehicle porcelain equals the THREE-file PRE state left by 3c, all four PRE digests match pins, canonical tracked lines=$CANON_TRACKED_BEFORE"

# ---- ACK_START written by the SCRIPT, after the gates, before any other write ----
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
  "writer":"crewing-writer@skipi-crewing-17",
  "driver_sha256":dsha,
  "window_seconds_remaining_at_start":int(left)},
  open(p,"w"), ensure_ascii=False, indent=2)
PYEOF
say "ACK_START written: $ACK (driver_sha256=$DRIVER_SHA)"

# ---- THE MUTATION: the dry-run-proven patch, with its own PRE guard ----
if ! python3 "$PATCH" --root "$WT" >> "$LOGS/patch.log" 2>&1; then
    say "STOP: patch refused or failed - see $LOGS/patch.log; NOT cleaning up"; exit 10
fi
D1=$(dsha "$WT/dist/index.html"); H1=$(dsha "$WT/$HARN_REL"); R1=$(dsha "$WT/$RS_REL"); J1=$(dsha "$WT/$JOINT_REL")
[ "$D1" = "$DIST_POST" ] || { say "STOP: dist POST $D1 != pinned $DIST_POST"; exit 11; }
[ "$H1" = "$HARN_POST" ] || { say "STOP: harness POST $H1 != pinned $HARN_POST"; exit 11; }
[ "$R1" = "$RS_POST" ] || { say "STOP: native_lifecycle.rs CHANGED ($R1) - 3e touches only the joint tests"; exit 11; }
[ "$J1" = "$JOINT_POST" ] || { say "STOP: joint tests POST $J1 != pinned $JOINT_POST"; exit 11; }
say "patch applied; the joint tests match their pin, dist/harness/lifecycle proven UNCHANGED"

# ---- VERIFY: the harness must give exactly the dry-run numbers, or this EXITS ----
# Three independent things can go wrong and only one was checked. NOSUMMARY catches a crash
# BEFORE the summary; node's rc catches a crash AFTER it; a non-empty stderr catches a warning
# alongside a green summary. Measured before being made a refusal: rc 0 and ZERO stderr bytes
# on three runs of the patched tree and one of the unpatched, node v24.13.0 - so this cannot
# be a false red. An empty stderr is evidence too, which is why the size is printed either way.
( cd "$WT" && node "$WT/$HARN_REL" ) > "$LOGS/harness.log" 2>"$LOGS/harness.err"
NODE_RC=$?
ERR_BYTES=$(stat -c %s "$LOGS/harness.err")
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
[ "$NODE_RC" = "0" ] || { say "STOP: node exited $NODE_RC - a crash AFTER the summary line would otherwise read as a pass"; exit 12; }
[ "$ERR_BYTES" = "0" ] || { say "STOP: harness stderr is $ERR_BYTES bytes; a green summary beside stderr output is a signal, not a pass - see $LOGS/harness.err"; exit 12; }
case "$SUM" in
  OK) say "harness: $WANT_PASSED passed / 0 failed / 0 setup_errors - equals the dry run (node rc=$NODE_RC, stderr $ERR_BYTES B)" ;;
  NOSUMMARY) say "STOP: harness produced no summary line - instrument failure, not a pass"; exit 12 ;;
  *) say "STOP: harness $SUM"; exit 12 ;;
esac

# ---- AFTER: establish what happened to the world, then compare ----
CANON_TRACKED_AFTER=$(git -C "$HOME_REPO" status --porcelain=v1 --untracked-files=no | wc -l)
{
  echo "driver_sha256=$DRIVER_SHA"
  echo "dist_mode=$(stat -c %a "$WT/dist/index.html")"
  echo "harness_mode=$(stat -c %a "$WT/$HARN_REL")"
  echo "rust_mode=$(stat -c %a "$WT/$RS_REL")"
  echo "rust_pre=$R0"; echo "rust_post=$R1"; echo "rust_post_expected=$RS_POST"
  echo "joint_mode=$(stat -c %a "$WT/$JOINT_REL")"
  echo "joint_pre=$J0"; echo "joint_post=$J1"; echo "joint_post_expected=$JOINT_POST"
  echo "worktree_head=$(git -C "$WT" rev-parse HEAD)"
  echo "worktree_branch=$(git -C "$WT" rev-parse --abbrev-ref HEAD)"
  echo "dist_pre=$D0"; echo "dist_post=$D1"; echo "dist_post_expected=$DIST_POST"
  echo "harness_pre=$H0"; echo "harness_post=$H1"; echo "harness_post_expected=$HARN_POST"
  echo "cargo_ran_in_window=no"
  echo "gen_schemas_exists=$([ -d "$WT/src-tauri/gen/schemas" ] && echo yes || echo no)"
  echo "src_tauri_target_exists=$([ -d "$WT/src-tauri/target" ] && echo yes || echo no)"
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
  "what_this_run_does_NOT_establish":("Only ONE of the route's 19 harnesses was run. Nothing here "
    "says the guard route passes, nothing was pushed, no commit was made, and no stand was built. "
    "The Rust suite was NOT run in this window: its 249/0 is evidence of a dry run on a COPY under "
    "umask 0022, and under the machine's default umask 0002 that same suite is 234/15 for the "
    "pre-existing reason filed as No.922. The subject of THIS stage is a TEST, not product "
    "behaviour: it pins the side of the migration_required fork that nothing asserted, and it "
    "changes nothing a person can see. The JS harness count is unchanged at 184 precisely because "
    "the twin is a Rust test. Nothing here may be read as permission to push or release.")},
  open(p,"w"), ensure_ascii=False, indent=2)
PYEOF
say "ACK_STOP written: $STOP"

# ---- finding 1 (coordinator review of step 1): the canonical counts were printed and judged
# by a reader's eyes. This is the only place an accidental write would land in the manager's
# checkout, so it gets a predicate with its own exit. It cannot go false-red: the log dir lives
# under scratchpad/ and the count is taken with --untracked-files=no, so this stage's own
# writes do not move it.
#
# Placed AFTER ACK_STOP, unlike exits 10-12, and the difference is deliberate: 10-12 are
# failures of the WRITE ITSELF - the stage did not achieve its subject, and the open lease is
# the signal. 13 is a side effect detected after a SUCCESSFUL write: the subject is done, so
# the lease closes cleanly and the violation is reported loudly instead. after.txt carries both
# counts and is embedded verbatim in ACK_STOP, so the terminal artefact records it either way.
# WHAT THIS GUARD CANNOT SEE, stated beside it because it is unfixable, not deferred.
# The count is taken with --untracked-files=no, so a NEW UNTRACKED file in the canonical
# checkout is invisible to it. Widening to -uall is not available: `scratchpad/` is NOT
# gitignored there (`git check-ignore scratchpad/` matches no rule), and -uall prints 619 lines
# against 0 for -uno at PRE -- every one of them under scratchpad/, i.e. this session's own
# artefacts. So -uall would be a false red by construction AND would be moved by the stage's
# own writes. Measured, including a probe file that -uno scored 0 and -uall scored 1.
# Therefore: -uno is necessary, and the blind spot is its named price.
if [ "$CANON_TRACKED_AFTER" != "$CANON_TRACKED_BEFORE" ]; then
    # The message names BOTH causes this predicate cannot separate, because a reader defaults to
    # blaming the stage. Telling WHICH is the coordinator's job, not this driver's: at 13 he
    # compares the canonical HEAD and status fingerprint against his own last closeout. A guard
    # reports what it sees, not what it cannot.
    say "STOP: canonical tracked-change count moved $CANON_TRACKED_BEFORE -> $CANON_TRACKED_AFTER. TWO causes are indistinguishable from here: (a) this stage wrote outside its declared surfaces, or (b) a neighbour legitimately wrote in their own checkout during this window - the canonical checkout is the manager's working ground and was never inside this lease. Stage subject is COMPLETE and the lease is CLOSED: this is a report, not a failed write. Attribution belongs to the coordinator, who compares canonical HEAD and status fingerprint against his last closeout."
    exit 13
fi
say "canonical checkout unmoved: tracked-change count $CANON_TRACKED_BEFORE -> $CANON_TRACKED_AFTER"
say "DONE"
