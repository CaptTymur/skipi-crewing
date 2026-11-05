#!/bin/bash
# No.898 stage 10 - build the RELEASE binary of the candidate e5132934, so the owner's
# acceptance can happen on a running artefact rather than on frames.
# Usage: run-s10-build.sh <certificate>
#
# WHY RELEASE AND NOT DEBUG (the manager's decision, and his reasoning is recorded because it
# corrects a weaker version of mine):
#   `dist` is embedded from the SAME bytes in both profiles, and the texts and contrast the owner
#   judges live in `dist`. So the subject of the acceptance does not depend on the profile at all;
#   only the native half does. RELEASE therefore removes the frames' standing caveat ("release
#   untested") WITHOUT changing what the acceptance measures - a strict option with no cost in
#   substance. And if RELEASE ever diverges from DEBUG, that is a finding to obtain BEFORE the
#   acceptance, not something to hide by choosing the profile that matches the pictures: exact
#   agreement with what was expected proves almost nothing while feeling like proof.
#
# WHAT I CAN AND CANNOT VERIFY ABOUT THE EMBEDDED dist - measured, not assumed:
#   The INPUT is verifiable with certainty: tauri.conf.json declares
#   `build.frontendDist = ../dist`, so the build reads that directory, and this driver pins
#   dist/index.html to 96b6bd50…fdf3fa both BEFORE and AFTER (a build must not rewrite its input).
#   The OUTPUT is NOT verifiable by inspecting the binary. Measured on the existing 2026-09-30
#   release binary: `strings` finds `<!DOCTYPE html` (5) and `<title>` (4) but NOT `mobile-status`,
#   NOT `loginRefusalText`, NOT `data-theme`, and ZERO Cyrillic - the 1,131,783-byte document is
#   stored compressed. A first probe looked for a NEW text there, got 0, and that 0 was
#   uninterpretable: the positive control (a string that MUST be there, `Войдите в аккаунт Skipi`)
#   also returned 0, which proved the instrument blind rather than the binary old. No asset
#   manifest with a digest is left under target/release/build/*/out either.
#   So: proving the RUNNING app shows those four texts is the smoke test - a separate stage.
#
# SAFETY ON RELEASE-SENSITIVE FILES:
#   `--locked` is passed so cargo REFUSES rather than rewriting Cargo.lock. Cargo.lock and
#   Cargo.toml are release-sensitive in this house and out of scope for a non-release task; their
#   digests are pinned before and after and a change is a STOP, not a note.
#
# NO NETWORK IS DECLARED, and `--offline` is what makes that true rather than hoped:
#   the shared registry cache holds 814 .crate files against 595 packages in the lock, but 814 >=
#   595 is a COUNT and not a composition - it does not prove the right versions are present. So
#   the build runs `--offline` and cargo answers the question itself: if anything is missing it
#   fails loudly, and that failure is returned as a finding rather than repaired in this stage.
#
# WHAT THE WINDOW FLOOR IS FOR, corrected after it refused its own stage:
#   My first floor was 240 s, reasoned as "start only at the beginning of a window". It refused the
#   start with 200 s remaining, and the refusal was CORRECT while the floor was wrong in kind.
#   Measured: with a floor of 240 against a 300 s ceiling, the total budget for pulse age + the
#   coordinator's chain + message delivery + my turn is 60 s - and delivery plus one turn alone
#   cost 47 s. The floor was therefore unreachable through a human-speed channel, not unlucky.
#   And it guarded almost nothing: the whole precondition block (toolchain, two rev-parses, status,
#   three digests, disk, canonical count) measures 60 MILLISECONDS.
#   So the floor's real job is the only thing that MUST happen inside the window: complete the
#   preconditions and write ACK_START, so the stage legitimately started under the lease. 30 s is
#   ample for a 60 ms block on a loaded machine. Everything after ACK_START is drain territory by
#   design - the build outlasts any lease, and no floor can change that, which is exactly why a
#   large floor bought nothing while making the stage impossible to start.
#   RENEW IS AVAILABLE HERE - my earlier premise that it was not is WRONG, and the coordinator
#   measured it: target/ is gitignored and absent so `git status` does not move (it is the sha of
#   EMPTY output), HEAD does not move, and this stage writes none of its own four pins. All three
#   renew checks would pass. Drain is still the right choice, for arithmetic rather than for the
#   reason I gave: renew buys at most one more 300 s window, and a build plausibly running tens of
#   minutes would need 2-8 consecutive renews, each with a fresh event, a live inspect and a review
#   MID-BUILD through a human-speed channel. A chain of eight renews is more fragile than one
#   honest drain.
#   On expiry the command is NOT interrupted - killing a build mid-flight leaves a partial target
#   and there is no safe boundary inside it. Closure then goes: `reference --lease-id … --instance
#   …` to obtain the CURRENT certificate (expiry raises the revision, so the one held at start
#   stops being current), then `ack-stop --certificate <that> --evidence <this stage's ACK_STOP>
#   --action-event <its id>`. This driver never re-reads the certificate after the start gate, so a
#   revision change cannot affect it.
set -uo pipefail
case "$0" in -*|bash|sh|"") echo "STOP: \$0 does not name a file"; exit 1 ;; esac
DRIVER_SHA=$(sha256sum "$0" | cut -d" " -f1); echo "driver_sha256=$DRIVER_SHA"

CERT="${1:-}"
HOME_REPO=/home/linux/Developer/skipi-crewing
WT=/home/linux/Developer/worktrees/crewing-898-20261104
GITDIR=/home/linux/Developer/skipi-crewing/.git
GATE=/home/linux/Developer/skipi-parallel-coordinator/tools/stage_gate.py
LOGS="$HOME_REPO/scratchpad/crewing-898/stage-build"
BRANCH=feat/crewing-898-login-texts-20261104
COMMIT=e5132934064c8ccf701b0061570971c2af220403
TARGET="$WT/src-tauri/target"
BIN="$TARGET/release/skipi-crewing"
DIST="$WT/dist/index.html"
DIST_SHA=96b6bd5000f957155569b342a236c17b51e244a8291475cf82260d1980fdf3fa
CARGO_TOML="$WT/src-tauri/Cargo.toml"
CARGO_TOML_SHA=1ab676f1989ac284d9d9a4d2e119211dd157165c321545d41e2834b4ca0b9304
CARGO_LOCK="$WT/src-tauri/Cargo.lock"
CARGO_LOCK_SHA=f593e42c088f22539abda76819e77ec39e13a27b58f5132cc93aac5b0c1367df
# The 2026-09-30 house binary: the new artefact must DIFFER from it, or no build happened. Its
# digest is NOT pinned as a constant - it is read live below, because a pinned prefix that the
# script never compares would be a constant asserting something unchecked.
OLD_BIN=/home/linux/Developer/skipi-crewing/src-tauri/target/release/skipi-crewing
DISK_FLOOR_GB=30
MIN_SECONDS=30
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
# A CEILING as well as a floor. The protocol computes expiry as min(now+300, heartbeat+max), so a
# remainder above 300 s is impossible from a legitimate grant: it means a clock skew or a
# fabricated document, NOT generosity. Found by testing my own arithmetic with three synthetic
# certificates after the coordinator reported the mirror of this in his preflight, where a pulse
# from the FUTURE read as maximum freshness: an expired certificate (-601 s) refuses here
# correctly via the floor, but 86400 s would have STARTED, because a large number passed a test
# that only looked downward. A bound checked on one side only is half a check.
WINDOW_CEILING=300
[ "$LEFT" -le "$WINDOW_CEILING" ] || { say "STOP: the certificate claims ${LEFT}s remaining, above the protocol ceiling of ${WINDOW_CEILING}s - that is a clock skew or a fabricated document, not a longer window"; exit 4; }
[ "$LEFT" -ge "$MIN_SECONDS" ] || { say "STOP: only ${LEFT}s left, floor ${MIN_SECONDS}s - this stage starts only at the BEGINNING of a window because it will outlast one"; exit 4; }
say "window: ${LEFT}s remaining (floor ${MIN_SECONDS}s covers the preconditions and ACK_START - 60 ms of work - and nothing more; the build outlasts any lease by design and closes via drain)"

[ -n "${ACK_START_EVENT_ID:-}" ] || { say "STOP: ACK_START_EVENT_ID absent"; exit 5; }
[ -n "${ACK_EVENT_ID:-}" ] || { say "STOP: ACK_EVENT_ID absent"; exit 5; }
[ -n "${ACK_STOP_EVENT_ID:-}" ] || { say "STOP: ACK_STOP_EVENT_ID absent"; exit 5; }
[ "$ACK_START_EVENT_ID" != "$ACK_EVENT_ID" ] || { say "STOP: start id equals request id"; exit 5; }
[ "$ACK_START_EVENT_ID" != "$ACK_STOP_EVENT_ID" ] || { say "STOP: start id equals stop id"; exit 5; }
[ "$ACK_EVENT_ID" != "$ACK_STOP_EVENT_ID" ] || { say "STOP: request id equals stop id"; exit 5; }

# `cargo --version` rather than `command -v cargo`: it proves the toolchain RUNS, not merely that
# a file sits on PATH - and it avoids a blind spot in check_undefined_funcs, which reads the shell
# builtin `command` at statement start as an undefined function (reported to the coordinator).
CARGO_V=$(cargo --version 2>/dev/null) || { say "STOP: cargo does not run"; exit 6; }
RUSTC_V=$(rustc --version 2>/dev/null) || { say "STOP: rustc does not run"; exit 6; }
HEAD0=$(git -C "$WT" rev-parse HEAD)
REF0=$(git -C "$WT" rev-parse "refs/heads/$BRANCH")
[ "$HEAD0" = "$COMMIT" ] || { say "STOP: HEAD $HEAD0 != $COMMIT - this stage builds EXACTLY the candidate"; exit 7; }
[ "$REF0" = "$COMMIT" ] || { say "STOP: branch ref $REF0 != $COMMIT"; exit 7; }
WT_STATUS=$(git -C "$WT" status --porcelain=v1 --untracked-files=all)
[ -z "$WT_STATUS" ] || { say "STOP: worktree not clean before the build: [$WT_STATUS]"; exit 7; }

DIST0=$(sha256sum "$DIST" | cut -d" " -f1)
[ "$DIST0" = "$DIST_SHA" ] || { say "STOP: dist/index.html is $DIST0, the frames were taken against $DIST_SHA - then the frames are not of what would be built"; exit 8; }
TOML0=$(sha256sum "$CARGO_TOML" | cut -d" " -f1)
LOCK0=$(sha256sum "$CARGO_LOCK" | cut -d" " -f1)
[ "$TOML0" = "$CARGO_TOML_SHA" ] || { say "STOP: Cargo.toml digest is $TOML0, declared $CARGO_TOML_SHA"; exit 8; }
[ "$LOCK0" = "$CARGO_LOCK_SHA" ] || { say "STOP: Cargo.lock digest is $LOCK0, declared $CARGO_LOCK_SHA"; exit 8; }
say "inputs pinned: dist $DIST0, Cargo.toml ${TOML0:0:12}, Cargo.lock ${LOCK0:0:12}"

# POSITIVE CONTROL baseline: the worktree carries no target at all, so the control is a
# transition from NOTHING to a binary. Unlike stage 9's spent FETCH_HEAD, this one is available.
[ ! -e "$TARGET" ] || { say "FINDING: $TARGET already exists ($(du -sh "$TARGET" 2>/dev/null | cut -f1)) - the nothing->binary control is weaker, falling back to binary digest and mtime"; }
BIN_BEFORE=ABSENT; [ -f "$BIN" ] && BIN_BEFORE=EXISTS
[ "$BIN_BEFORE" = "ABSENT" ] || { say "STOP: $BIN already exists - this stage declared a creation, and its control is nothing->exists"; exit 8; }

AVAIL_GB=$(df --output=avail -BG / | tail -1 | tr -dc '0-9')
[ "$AVAIL_GB" -ge "$DISK_FLOOR_GB" ] || { say "STOP: only ${AVAIL_GB} GB free, floor ${DISK_FLOOR_GB} GB. NOT cleaning anything - returning this as a line, because what to remove is the manager's decision"; exit 9; }
CANON_TRACKED_BEFORE=$(git -C "$HOME_REPO" status --porcelain=v1 --untracked-files=no | wc -l)
say "preconditions: HEAD/ref at $COMMIT, worktree clean, target ABSENT, binary ABSENT, ${AVAIL_GB} GB free (floor ${DISK_FLOOR_GB}), canonical tracked $CANON_TRACKED_BEFORE"
say "toolchain: $CARGO_V / $RUSTC_V"

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
  "stage":"VERIFY_BUILD","stream_id":"crewing/898-client-slice",
  "writer":"crewing-writer@skipi-crewing-17","driver_sha256":dsha,
  "window_seconds_remaining_at_start":int(left)}, open(p,"w"), ensure_ascii=False, indent=2)
PYSTART
say "ACK_START written: $ACK"

# ---- THE BUILD. --offline so no network is needed; --locked so Cargo.lock cannot be rewritten.
BUILD_ARGS=(build --release --offline --locked)
BUILD_CMDLINE="cargo ${BUILD_ARGS[*]} (cwd $WT/src-tauri)"
say "command: $BUILD_CMDLINE"
BUILD_START=$(date -u +%s)
( cd "$WT/src-tauri" && cargo "${BUILD_ARGS[@]}" ) > "$LOGS/build.stdout" 2>"$LOGS/build.stderr" &
BUILD_PID=$!
echo "$BUILD_PID" > "$LOGS/build.pid"
say "build PID $BUILD_PID recorded to $LOGS/build.pid (a stop, if ever needed, goes by this PID and not by pattern)"
wait "$BUILD_PID"
BUILD_RC=$?
BUILD_END=$(date -u +%s)
BUILD_SECONDS=$((BUILD_END - BUILD_START))
say "cargo exited $BUILD_RC after ${BUILD_SECONDS}s"
tail -5 "$LOGS/build.stdout" | sed 's/^/    out| /'
tail -12 "$LOGS/build.stderr" | sed 's/^/    err| /'

# Release-sensitive files must be byte-identical: --locked should have guaranteed it, CHECKED here.
TOML1=$(sha256sum "$CARGO_TOML" | cut -d" " -f1)
LOCK1=$(sha256sum "$CARGO_LOCK" | cut -d" " -f1)
DIST1=$(sha256sum "$DIST" | cut -d" " -f1)
[ "$TOML1" = "$TOML0" ] || say "FINDING: Cargo.toml changed during the build: $TOML0 -> $TOML1"
[ "$LOCK1" = "$LOCK0" ] || say "FINDING: Cargo.lock changed during the build despite --locked: $LOCK0 -> $LOCK1. That file is release-sensitive"
[ "$DIST1" = "$DIST0" ] || say "FINDING: dist/index.html changed during the build: $DIST0 -> $DIST1 - a build must not rewrite its own input"

if [ "$BUILD_RC" != "0" ]; then
    say "STOP: the build FAILED (rc $BUILD_RC). NOT repairing it here and NOT swapping the profile - both are the manager's decision, not a mid-stage improvisation"
    grep -nE "^error|could not compile|not found in registry|failed to select" "$LOGS/build.stderr" | head -8 | sed 's/^/    /'
    exit 20
fi

# POSITIVE CONTROL: nothing -> a binary, and it must differ from the five-week-old one.
BIN_AFTER=ABSENT; [ -f "$BIN" ] && BIN_AFTER=EXISTS
[ "$BIN_AFTER" = "EXISTS" ] || { say "STOP: cargo exited 0 but $BIN does not exist - the success claim is not matched by an artefact"; exit 21; }
BIN_SHA=$(sha256sum "$BIN" | cut -d" " -f1)
BIN_MTIME=$(stat -c %.9Y "$BIN")
BIN_SIZE=$(stat -c %s "$BIN")
OLD_SHA_FULL=$(sha256sum "$OLD_BIN" 2>/dev/null | cut -d" " -f1)
DIFFERS=yes; [ "$BIN_SHA" = "$OLD_SHA_FULL" ] && DIFFERS=no
[ "$DIFFERS" = "yes" ] || say "FINDING: the new binary is byte-identical to the 2026-09-30 one - that cannot be right for a different commit"
say "positive control PASSED: binary ABSENT -> EXISTS, ${BIN_SIZE} bytes, sha ${BIN_SHA:0:16}, differs from the 2026-09-30 artefact: $DIFFERS"

HEAD1=$(git -C "$WT" rev-parse HEAD)
WT_AFTER=$(git -C "$WT" status --porcelain=v1 --untracked-files=all)
[ "$HEAD1" = "$COMMIT" ] || say "FINDING: HEAD moved to $HEAD1"
[ -z "$WT_AFTER" ] || say "FINDING: worktree dirty after the build: [$WT_AFTER] - target/ is gitignored, so anything here was written OUTSIDE it"
TARGET_SIZE=$(du -sh "$TARGET" 2>/dev/null | cut -f1)
AVAIL_AFTER=$(df --output=avail -BG / | tail -1 | tr -dc '0-9')
CANON_TRACKED_AFTER=$(git -C "$HOME_REPO" status --porcelain=v1 --untracked-files=no | wc -l)

{
  echo "driver_sha256=$DRIVER_SHA"
  echo "command=$BUILD_CMDLINE"
  echo "profile=release  offline=yes  locked=yes  timeout=no (deliberate; see the header)"
  echo "cargo_version=$CARGO_V"; echo "rustc_version=$RUSTC_V"
  echo "build_rc=$BUILD_RC"
  echo "build_wall_seconds=$BUILD_SECONDS"
  echo "build_pid=$BUILD_PID"
  echo "window_at_start_seconds=$LEFT"
  echo "overran_window=$([ "$BUILD_SECONDS" -gt "$LEFT" ] && echo yes || echo no)"
  echo "binary_path=$BIN"
  echo "binary_before=$BIN_BEFORE"; echo "binary_after=$BIN_AFTER"
  echo "binary_sha256=$BIN_SHA"; echo "binary_bytes=$BIN_SIZE"; echo "binary_mtime=$BIN_MTIME"
  echo "differs_from_20260930_artefact=$DIFFERS"
  echo "old_artefact_sha256=$OLD_SHA_FULL"
  echo "dist_sha_before=$DIST0"; echo "dist_sha_after=$DIST1"
  echo "dist_verification=INPUT only; the embedded copy is NOT inspectable (compressed, measured)"
  echo "cargo_toml_sha_before=$TOML0"; echo "cargo_toml_sha_after=$TOML1"
  echo "cargo_lock_sha_before=$LOCK0"; echo "cargo_lock_sha_after=$LOCK1"
  echo "head_before=$HEAD0"; echo "head_after=$HEAD1"
  echo "worktree_status_after=[$WT_AFTER]"
  echo "target_size_after=$TARGET_SIZE"
  echo "disk_avail_gb_before=$AVAIL_GB"; echo "disk_avail_gb_after=$AVAIL_AFTER"
  echo "canonical_tracked_lines_before=$CANON_TRACKED_BEFORE"
  echo "canonical_tracked_lines_after=$CANON_TRACKED_AFTER"
  echo "shown_to_owner=no"; echo "merged=no"; echo "released=no"
  echo "next=a smoke stage is required to prove the RUNNING release shows the four texts; frames so far are from a DEBUG build"
  echo "next_constraint=the new frames must NOT replace or cancel smoke-3d/. Any state that diverges from those frames is a FINDING that goes to the owner, not something overwritten by a fresh snapshot; the DEBUG frames stay in place with their digests as evidence of that run"
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
if [ -n "$WT_AFTER" ] || [ "$LOCK1" != "$LOCK0" ] || [ "$DIST1" != "$DIST0" ]; then
    say "STOP: the binary exists but an input or the tree moved - see the FINDING lines. Reported with its own code so it is not read as a clean stage"
    exit 22
fi
say "DONE: release binary built in ${BUILD_SECONDS}s, ${BIN_SIZE} bytes, sha ${BIN_SHA:0:16}. NOT shown to the owner, NOT merged, NOT released; a smoke stage is still required to prove the RUNNING release shows the four texts"
