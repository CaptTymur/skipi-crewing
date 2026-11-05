#!/bin/bash
# No.898 stage 12 (B2-build) - build the DEBUG binary of e5132934 with the loopback dev origin
# baked in, because S2 cannot be shown on any release build and no debug binary exists.
# Usage: run-s12-b2-build.sh <certificate>
#
# WHY A BUILD AT ALL, MEASURED RATHER THAN ASSUMED:
#   `target/debug/skipi-crewing` is absent in this worktree and nowhere under /home/linux/Developer.
#   The debug copy that produced smoke-3d was never preserved. So B2 is not "take frames" - it is
#   a build plus a stand, which is why it is two stages and not one. (A single stage would outrun
#   its window and close by drain, exactly as the release build did.)
#
# WHY THE ORIGIN IS BAKED AND WHAT SHAPE IT MUST HAVE:
#   `option_env!("SKIPI_CREWING_DEV_ACCOUNT_ORIGIN")` reads the COMPILER's environment, so the
#   value must be present at build time and cannot be supplied to the running app. The predicate
#   `dev_origin_config` (native_account.rs:394) accepts ONLY a loopback origin, and its own test
#   enumerates what is refused: a non-loopback host, a path, a query, credentials, another scheme,
#   and a bare host:port with no scheme. So the only admissible shape is `http://127.0.0.1:PORT`.
#   PORT is 19168: below the kernel's ephemeral range (32768-60999 here), so the kernel never
#   hands it out, and measured free before this driver was written.
#
# THE CONTROL THAT MATTERS MOST IS THE MIRROR OF PART A's:
#   In part A I measured three dev markers at ZERO in the release binary, with
#   `assistant.skipi.app` = 1 as the positive control proving the probe could see. Here the SAME
#   probe must come back the OTHER way: the baked loopback origin MUST appear, or the variable
#   did not reach rustc and I would be holding a debug binary still pointing at production - which
#   would make the B2 stand fail silently and look like a product defect. Same instrument,
#   opposite expected answer, same positive control. A build that "succeeded" without the origin
#   is the failure this stage is most likely to produce, so it is the one gate that is explicit.
#
# WHAT MUST NOT MOVE:
#   The RELEASE binary 1488c7004c14ea60 is part A's subject and its frames are already published;
#   a debug build must not disturb it. Its digest is taken before and compared after. Cargo.toml
#   and Cargo.lock are release-sensitive in this house: `--locked` makes cargo REFUSE rather than
#   rewrite, and both digests are pinned before and after. `--offline` so no network is needed
#   and cargo says so itself rather than my hoping.
#
# DURATION - AN ANCHOR, NOT AN ESTIMATE:
#   The RELEASE build of this same graph took 101 s (measured, stage 10). A debug build is a
#   DIFFERENT object - different profile, different codegen, no optimisation but more output - so
#   that number is an anchor and not a prediction, and nothing here promises the stage fits a
#   window. The floor therefore covers only what MUST happen under the lease: the preconditions
#   and ACK_START. Everything after is drain territory by design.
set -uo pipefail
case "$0" in -*|bash|sh|"") echo "STOP: \$0 does not name a file"; exit 1 ;; esac
DRIVER_SHA=$(sha256sum "$0" | cut -d" " -f1); echo "driver_sha256=$DRIVER_SHA"

CERT="${1:-}"
HOME_REPO=/home/linux/Developer/skipi-crewing
CARD="$HOME_REPO/scratchpad/crewing-898"
WT=/home/linux/Developer/worktrees/crewing-898-20261104
GATE=/home/linux/Developer/skipi-parallel-coordinator/tools/stage_gate.py
LOGS="$CARD/stage-b2-build"
TARGET="$WT/src-tauri/target"
DEBUG_BIN="$TARGET/debug/skipi-crewing"
RELEASE_BIN="$TARGET/release/skipi-crewing"
RELEASE_SHA=1488c7004c14ea6027b7ef84218bc49cf78828c67d036130cb8166af58a0ff73
DIST="$WT/dist/index.html"
DIST_SHA=96b6bd5000f957155569b342a236c17b51e244a8291475cf82260d1980fdf3fa
CARGO_TOML="$WT/src-tauri/Cargo.toml"
CARGO_TOML_SHA=1ab676f1989ac284d9d9a4d2e119211dd157165c321545d41e2834b4ca0b9304
CARGO_LOCK="$WT/src-tauri/Cargo.lock"
CARGO_LOCK_SHA=f593e42c088f22539abda76819e77ec39e13a27b58f5132cc93aac5b0c1367df
COMMIT=e5132934064c8ccf701b0061570971c2af220403
DEV_ORIGIN=http://127.0.0.1:19168
DISK_FLOOR_GB=30
MIN_SECONDS=30
WINDOW_CEILING=300
BUILD_ARGS=(build --offline --locked)
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
[ "$LEFT" -le "$WINDOW_CEILING" ] || { say "STOP: $LEFT s remaining exceeds the $WINDOW_CEILING s ceiling - that is not a live window"; exit 4; }
[ "$LEFT" -ge "$MIN_SECONDS" ] || { say "STOP: only ${LEFT}s left, floor ${MIN_SECONDS}s"; exit 4; }
say "window: ${LEFT}s remaining (floor ${MIN_SECONDS}s covers the preconditions and ACK_START; the build outlasts any lease by design and closes via drain)"

# ---------------------------------------------------------------- preconditions
mkdir -p "$LOGS" || { say "STOP: cannot create $LOGS"; exit 5; }

HEAD_AT=$(git -C "$WT" rev-parse HEAD)
[ "$HEAD_AT" = "$COMMIT" ] || { say "STOP: worktree HEAD is $HEAD_AT, not the candidate"; exit 5; }
DIRTY=$(git -C "$WT" status --porcelain | wc -l)
[ "$DIRTY" = "0" ] || { say "STOP: worktree not clean ($DIRTY entries)"; exit 5; }

for pair in "$DIST:$DIST_SHA" "$CARGO_TOML:$CARGO_TOML_SHA" "$CARGO_LOCK:$CARGO_LOCK_SHA" "$RELEASE_BIN:$RELEASE_SHA"; do
    f="${pair%:*}"; want="${pair##*:}"
    got=$(sha256sum "$f" 2>/dev/null | cut -d" " -f1)
    [ "$got" = "$want" ] || { say "STOP: $f is not the pinned artefact (on disk [$got])"; exit 9; }
done
say "pins: dist, Cargo.toml, Cargo.lock and the RELEASE binary all match disk"

# Positive control for this stage: the debug binary must be ABSENT now, so "it exists" afterwards
# means THIS build made it. A pre-existing file would make the whole stage unfalsifiable.
[ -e "$DEBUG_BIN" ] && { say "STOP: $DEBUG_BIN already exists - this stage's positive control is 'absent -> exists'"; exit 8; }

FREE_GB=$(df -BG --output=avail "$HOME_REPO" | tail -1 | tr -dc '0-9')
[ "$FREE_GB" -ge "$DISK_FLOOR_GB" ] || { say "STOP: only ${FREE_GB}GB free, floor ${DISK_FLOOR_GB}GB"; exit 5; }

CARGO_V=$(cargo --version 2>/dev/null) || { say "STOP: cargo does not run"; exit 6; }
CANON_BEFORE=$(git -C "$HOME_REPO" status --porcelain -- ':!scratchpad' | wc -l)
REG_BEFORE=$(ls /home/linux/.cargo/registry/cache/*/ 2>/dev/null | wc -l)
say "preconditions: HEAD at $COMMIT, worktree clean, debug ABSENT, ${FREE_GB}GB free, toolchain $CARGO_V"

cat > "$LOGS/ACK_START-$(date -u +%Y%m%dT%H%M%SZ).json" <<ACKJSON
{"stage":"s12-b2-build","driver_sha256":"$DRIVER_SHA","commit":"$COMMIT",
 "dev_origin_baked":"$DEV_ORIGIN","profile":"debug","window_left_s":$LEFT,
 "release_binary_must_not_move":"$RELEASE_SHA",
 "started_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
ACKJSON
say "ACK_START written"

# ---------------------------------------------------------------- the build
say "command: SKIPI_CREWING_DEV_ACCOUNT_ORIGIN=$DEV_ORIGIN cargo ${BUILD_ARGS[*]} (cwd $WT/src-tauri)"
START=$(date +%s)
( cd "$WT/src-tauri" && SKIPI_CREWING_DEV_ACCOUNT_ORIGIN="$DEV_ORIGIN" cargo "${BUILD_ARGS[@]}" ) \
    > "$LOGS/build.out" 2> "$LOGS/build.err"
RC=$?
ELAPSED=$(( $(date +%s) - START ))
tail -4 "$LOGS/build.err" | sed 's/^/    err| /'
[ "$RC" = "0" ] || { say "STOP: cargo exited $RC after ${ELAPSED}s - returned as a finding, not repaired here"; exit 10; }
say "cargo exited 0 after ${ELAPSED}s (the RELEASE build of this graph took 101s - an anchor, not a prediction: a different profile is a different object)"

# ---------------------------------------------------------------- controls
[ -f "$DEBUG_BIN" ] || { say "STOP: cargo reported success but $DEBUG_BIN does not exist"; exit 11; }
DEBUG_SHA=$(sha256sum "$DEBUG_BIN" | cut -d" " -f1)
DEBUG_BYTES=$(stat -c %s "$DEBUG_BIN")
say "positive control PASSED: debug binary ABSENT -> EXISTS, $DEBUG_BYTES bytes, sha ${DEBUG_SHA:0:16}"

# THE CONTROL THIS STAGE EXISTS FOR, and the mirror of part A's. In the release binary the dev
# markers measured 0 with `assistant.skipi.app` = 1 as the proof the probe could see. Here the
# baked origin MUST be present: a debug build without it still points at production, the B2 stand
# would fail against a closed port, and the failure would read as a product defect.
BAKED=$(strings -a "$DEBUG_BIN" | grep -c "^$DEV_ORIGIN$")
PROD=$(strings -a "$DEBUG_BIN" | grep -c 'assistant\.skipi\.app')
say "origin probe: baked loopback origin occurrences = $BAKED ; production origin occurrences = $PROD"
[ "$PROD" -ge 1 ] || { say "STOP: POSITIVE CONTROL FAILED - 'assistant.skipi.app' not found at all, so the probe is blind and the $BAKED above means nothing"; exit 12; }
[ "$BAKED" -ge 1 ] || { say "STOP: the baked origin $DEV_ORIGIN is NOT in the binary - SKIPI_CREWING_DEV_ACCOUNT_ORIGIN did not reach rustc. This binary still points at production and must not be used for the B2 stand."; exit 12; }
say "origin control PASSED: the compile-time variable reached rustc (the production const also remains, as the source keeps both)"

for pair in "$DIST:$DIST_SHA" "$CARGO_TOML:$CARGO_TOML_SHA" "$CARGO_LOCK:$CARGO_LOCK_SHA"; do
    f="${pair%:*}"; want="${pair##*:}"
    got=$(sha256sum "$f" | cut -d" " -f1)
    [ "$got" = "$want" ] || { say "STOP: $f MOVED during the build (now [$got])"; exit 13; }
done
RELEASE_AFTER=$(sha256sum "$RELEASE_BIN" | cut -d" " -f1)
[ "$RELEASE_AFTER" = "$RELEASE_SHA" ] || { say "STOP: the RELEASE binary moved during this build - part A's published subject must not change"; exit 13; }
say "untouched: dist, Cargo.toml, Cargo.lock, and the RELEASE binary ${RELEASE_SHA:0:16} (part A's subject)"

CANON_AFTER=$(git -C "$HOME_REPO" status --porcelain -- ':!scratchpad' | wc -l)
REG_AFTER=$(ls /home/linux/.cargo/registry/cache/*/ 2>/dev/null | wc -l)
FREE_AFTER=$(df -BG --output=avail "$HOME_REPO" | tail -1 | tr -dc '0-9')
say "canonical checkout unmoved: tracked-change count $CANON_BEFORE -> $CANON_AFTER ; registry $REG_BEFORE -> $REG_AFTER ; disk ${FREE_GB} -> ${FREE_AFTER} GB"

cat > "$LOGS/after.txt" <<AFTEREOF
stage=s12-b2-build
driver_sha256=$DRIVER_SHA
commit=$COMMIT
profile=debug
dev_origin_baked=$DEV_ORIGIN
debug_binary_sha256=$DEBUG_SHA
debug_binary_bytes=$DEBUG_BYTES
baked_origin_occurrences=$BAKED
production_origin_occurrences=$PROD
release_binary_sha256_before=$RELEASE_SHA
release_binary_sha256_after=$RELEASE_AFTER
elapsed_seconds=$ELAPSED
canonical_tracked_lines_before=$CANON_BEFORE
canonical_tracked_lines_after=$CANON_AFTER
registry_entries_before=$REG_BEFORE
registry_entries_after=$REG_AFTER
disk_free_gb_before=$FREE_GB
disk_free_gb_after=$FREE_AFTER
AFTEREOF

cat > "$LOGS/TERMINAL-CLAIM-s12.json" <<CLAIM
{"observed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
 "operations_terminated": true,
 "queued_operations_cancelled": true,
 "evidence": "B2-build complete, cargo rc 0 in ${ELAPSED}s. Debug binary ABSENT -> EXISTS, $DEBUG_BYTES bytes, sha $DEBUG_SHA. Baked loopback origin $DEV_ORIGIN present ($BAKED occurrences) with the production origin as the probe's positive control ($PROD) - the compile-time variable reached rustc. dist, Cargo.toml, Cargo.lock and the RELEASE binary $RELEASE_SHA all byte-identical before and after. Canonical checkout $CANON_BEFORE -> $CANON_AFTER. No stand was raised and no frame was taken: that is B2-smoke."}
CLAIM
say "terminal claim written: $LOGS/TERMINAL-CLAIM-s12.json (four keys; the rich report follows separately)"
say "DONE: debug binary ${DEBUG_SHA:0:16} built in ${ELAPSED}s with origin $DEV_ORIGIN baked. NOT a stand, NOT a frame, NOT an acceptance."
