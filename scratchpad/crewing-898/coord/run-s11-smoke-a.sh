#!/bin/bash
# No.898 stage 11, part A - the smoke on the RELEASE binary: it launches, it shows the entry
# screen, and it renders S1 in RU and EN. Plus one control run that TESTS a prediction.
# Usage: run-s11-smoke-a.sh <certificate>
#
# WHY ONLY S1 AND NOT ALL FOUR - THREE BORDERS, MEASURED, AND THE SECOND ONE CLOSES THE OBVIOUS
# WORKAROUND:
#   1. `ACCOUNT_ORIGIN` is a compile-time `const` (native_account.rs:7, "https://assistant.skipi.app").
#      The dev override is `option_env!("SKIPI_CREWING_DEV_ACCOUNT_ORIGIN")` (:382) - the
#      COMPILER's environment. Nothing the running app is handed can redirect it.
#   2. That branch is `#[cfg(debug_assertions)]` (:381), as is the `direct_loopback_qa` field
#      it reads (:385-386). So the branch DOES NOT EXIST in a release build, and rebuilding the
#      RELEASE profile with the variable set still yields the production origin. This was the
#      first workaround I reached for; it is closed.
#   3. The account client is reqwest 0.12.28, and `Cargo.toml:29` asks for feature `rustls-tls`,
#      which reqwest's own Cargo.toml:148 defines as `["rustls-tls-webpki-roots"]` - the BUNDLED
#      Mozilla roots. No runtime path adds a certificate. (`SSL_CERT_FILE` does appear in the
#      binary, but it comes from openssl-probe via rustls-native-certs via rustls-platform-verifier
#      via reqwest 0.13.2 - the UPDATER's client, not this one. I first attributed that string to
#      reqwest itself; the coordinator measured 0 occurrences there and he is right. The
#      conclusion survives, its stated cause did not - and had Cargo.toml said
#      `rustls-tls-native-roots`, the conclusion would have been FALSE.)
#   Therefore S2/S3/S4 each need a COMPLETED TLS session to a domain we do not own, signed by a
#   public CA. We do not obtain such a certificate for any show, and standing up our own CA is
#   the same prohibition (manager, 05.11). S1 needs no TLS at all - only a failed connection -
#   so it is the one state this binary can show honestly.
#
# WHAT A FRAME PROVES AND WHAT IT DOES NOT:
#   The texts live in dist/index.html as i18n values and Rust emits only CODES; `second_step_code()`
#   is a plain `fn` with a plain `match` and no cfg at all. So the texts are profile-independent BY
#   CONSTRUCTION, and the dist is the authority on WHAT a line says. A frame is the authority on
#   WHETHER it rendered, and on the colour that actually landed. Every .txt here is therefore read
#   out of the shipped dist by key - never transcribed from a picture - exactly as smoke-3d did.
#
# THE PREDICTION THIS STAGE TESTS, WRITTEN DOWN BEFORE THE RUN so that a surprise stays a finding
# instead of becoming a re-interpretation:
#   `upstream_unavailable` (S2) is born ONLY inside `response_json(status, &bytes, login)`
#   (native_account.rs:424-452), reached only after `request.send()` has succeeded (:480) and the
#   body has been read (:484); both of those failures yield `transport_unreachable`. A proxy that
#   answers 503 to the CONNECT never lets the tunnel stand up, so `send()` fails.
#   PREDICTED: run 3 shows S1, not S2 - i.e. a refused connection is classified as transport,
#   and S2 is unreachable on an unmodified release for the same webpki-roots reason as S3/S4.
#   The run is worth its cost in EITHER outcome: it either yields S2 on release, or it closes a
#   question that would otherwise travel into the acceptance as "almost certainly".
#   A mismatch is reported LOUDLY and does NOT fail the stage - it is a measurement, not a gate.
#
# WHY THE LANGUAGE IS SET EXPLICITLY IN BOTH RUNS rather than letting one be "the default":
#   `getUiLang()` reads localStorage, then `state.settings.interface.language`, then falls back
#   to 'ru'. With no settings file the Rust side hands JS a `Settings::default()` whose language
#   is the EMPTY STRING - which still satisfies the JS validity check at dist:1324 (an empty
#   string IS a string), so the fallback decides. The JS literal default at dist:1349
#   (`{theme:'light', language:'en'}`) applies only when the settings object is REJECTED. Which
#   of those two wins is a question I did not need to answer: both runs write the language
#   explicitly, and the control below catches a setting that failed to take effect.
#   `#[serde(default)]` on `Settings` (lib.rs:47) is what makes a two-field file legal, and the
#   file deliberately omits `company_name`: any field counted by `local_identity_present` makes
#   the login end in `settings_unavailable` before it ever reaches the transport (stand, 25.10).
#
# THE STAND NEVER TOUCHES THE OWNER'S DISPLAY: everything runs on Xephyr :9. The owner's session
# is :1 and the capture subcommand REFUSES :0/:1 outright, so a typo cannot photograph his screen.
#
# NO EGRESS IS POSSIBLE, and that is a safety property rather than a convenience: both conditions
# point the app's proxy at 127.0.0.1, so `assistant.skipi.app` is unreachable by construction and
# no address and no password can leave the machine. The credentials typed are synthetic
# (`example.invalid`), which is belt as well as braces.
set -uo pipefail
case "$0" in -*|bash|sh|"") echo "STOP: \$0 does not name a file"; exit 1 ;; esac
DRIVER_SHA=$(sha256sum "$0" | cut -d" " -f1); echo "driver_sha256=$DRIVER_SHA"

CERT="${1:-}"
HOME_REPO=/home/linux/Developer/skipi-crewing
CARD="$HOME_REPO/scratchpad/crewing-898"
WT=/home/linux/Developer/worktrees/crewing-898-20261104
GATE=/home/linux/Developer/skipi-parallel-coordinator/tools/stage_gate.py
LOGS="$CARD/stage-smoke-a"
OUT="$CARD/smoke-release-a"
TOOL="$CARD/coord/smoke-tool.py"
TOOL_SHA=89da3a2f8b6c6f42984c11a0c6af9350a4beb74994e89aff8f9393f2b65876e1
BIN="$WT/src-tauri/target/release/skipi-crewing"
BIN_SHA=1488c7004c14ea6027b7ef84218bc49cf78828c67d036130cb8166af58a0ff73
DIST="$WT/dist/index.html"
DIST_SHA=96b6bd5000f957155569b342a236c17b51e244a8291475cf82260d1980fdf3fa
COMMIT=e5132934064c8ccf701b0061570971c2af220403
XDISP=9
XW=1100
XH=750
ACCENT=004564
# smoke-3d calibration: its two-line second-step refusal boxes all measure h=31. A first-step
# line is one sentence, so S1 must come out MATERIALLY SHORTER. This number is the discriminator
# and it was measured, not chosen.
CAL_H_SECOND_STEP=31
# PORTS BELOW THE KERNEL'S EPHEMERAL RANGE, and that is the whole point of these numbers.
# Measured: /proc/sys/net/ipv4/ip_local_port_range is 32768-60999, ip_local_reserved_ports is
# EMPTY, and 166 sockets sit inside that range right now. My first choice (39165/39166) was
# inside it, so the kernel could hand either to any process as an outgoing port: the bind could
# fail through nobody's fault, and - worse - a listener appearing on the "closed" port between
# run 1 and run 3 would silently turn condition 1 into a different experiment. Ports under
# 32768 are never handed out by the kernel. The coordinator measured this; I re-measured it.
CLOSED_PORT=19165
P503_PORT=19166
P503_PORT_ALT=19167
# FLOOR FROM A MEASUREMENT, NOT A GUESS: rehearsed outside the lease on this very binary, a
# complete run - Xephyr up, app launched, window mapped, entry frame, click, type, submit,
# refusal frame, analysis - took 12 s. Three runs plus preconditions and the four controls come
# to roughly 60 s. So unlike the build, this stage FITS inside a window, and the floor is set to
# cover the WHOLE stage rather than merely its ACK_START: 90 s means it starts only if it can
# plausibly finish, which for a short stage is worth more than a drain.
MIN_SECONDS=90
WINDOW_CEILING=300
EMAIL=smoke-a@example.invalid
PASSWORD=synthetic-not-a-real-secret
say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# "The port is closed" is a statement about a MOMENT, and this stage runs three times. A
# listener appearing between run 1 and run 3 would silently turn condition 1 into a different
# experiment. So the predicate is ONE function, defined once and called both in the
# preconditions and before every run - two copies of a predicate drift apart, and the copy that
# drifts is always the one nobody re-reads.
port_is_closed() {
    python3 - "$1" <<'PYPORT'
import socket, sys
s = socket.socket(); s.settimeout(1.0)
try:
    s.connect(("127.0.0.1", int(sys.argv[1])))
except OSError:
    raise SystemExit(0)      # refused, as required
finally:
    s.close()
raise SystemExit(1)          # a listener answered
PYPORT
}

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
say "window: ${LEFT}s remaining (floor ${MIN_SECONDS}s covers the preconditions and ACK_START; the three app launches are seconds each and close via drain if the window ends)"

# ---------------------------------------------------------------- preconditions
mkdir -p "$LOGS" || { say "STOP: cannot create $LOGS"; exit 5; }

GOT=$(sha256sum "$BIN" 2>/dev/null | cut -d" " -f1)
[ "$GOT" = "$BIN_SHA" ] || { say "STOP: the release binary is not the pinned artefact (on disk [$GOT])"; exit 9; }
GOT=$(sha256sum "$DIST" 2>/dev/null | cut -d" " -f1)
[ "$GOT" = "$DIST_SHA" ] || { say "STOP: dist is not the pinned artefact (on disk [$GOT])"; exit 9; }
GOT=$(sha256sum "$TOOL" 2>/dev/null | cut -d" " -f1)
[ "$GOT" = "$TOOL_SHA" ] || { say "STOP: smoke-tool.py is not the reviewed file (on disk [$GOT])"; exit 9; }
say "pins: binary ${BIN_SHA:0:16}, dist ${DIST_SHA:0:16}, tool ${TOOL_SHA:0:16} - all three match disk"

HEAD_AT=$(git -C "$WT" rev-parse HEAD)
[ "$HEAD_AT" = "$COMMIT" ] || { say "STOP: worktree HEAD is $HEAD_AT, not the candidate"; exit 5; }
DIRTY=$(git -C "$WT" status --porcelain | wc -l)
[ "$DIRTY" = "0" ] || { say "STOP: worktree not clean ($DIRTY entries)"; exit 5; }
CANON_BEFORE=$(git -C "$HOME_REPO" status --porcelain -- ':!scratchpad' | wc -l)

for t in Xephyr xdotool; do
    command -v "$t" >/dev/null || { say "STOP: $t absent"; exit 6; }
done
python3 -c 'import Xlib, PIL' 2>/dev/null || { say "STOP: python-Xlib or PIL absent"; exit 6; }

# The display is re-measured HERE, inside the stage: "free at 06:29Z" is a statement about a
# moment, and a free display is not a reserved one.
[ -e "/tmp/.X11-unix/X$XDISP" ] && { say "STOP: /tmp/.X11-unix/X$XDISP already exists - :$XDISP is in use"; exit 7; }
pgrep -x Xephyr >/dev/null && { say "STOP: a Xephyr is already running (pids $(pgrep -x Xephyr | tr '\n' ' ')) - refusing to share a nested server"; exit 7; }
OWNER_SOCKETS=$(ls /tmp/.X11-unix/ 2>/dev/null | tr '\n' ' ')
say "display: :$XDISP free; owner's sockets present and untouched: [$OWNER_SOCKETS]"

# The closed-port condition must be PROVEN closed, not assumed: a listener on that port would
# silently turn condition 1 into something else entirely.
if command -v ss >/dev/null; then
    ss -ltn 2>/dev/null | grep -qE "127\.0\.0\.1:$CLOSED_PORT\b" && { say "STOP: something listens on $CLOSED_PORT - it is not a closed port"; exit 5; }
fi
port_is_closed "$CLOSED_PORT" || { say "STOP: the 'closed' port accepted a connection"; exit 5; }
say "closed-port control: 127.0.0.1:$CLOSED_PORT refuses connections, so condition 1 really is 'no proxy reachable'"

# Positive control for the whole stage: frames must appear where there were NONE. If the output
# directory already exists the control is spent and the stage refuses rather than mixing runs.
[ -e "$OUT" ] && { say "STOP: $OUT already exists - this stage's positive control is 'frames appear where none were'"; exit 8; }

# smoke-3d and smoke-3c are closed evidence. Their digests are taken BEFORE and compared AFTER:
# the manager's instruction is that the new frames must not replace or cancel them, and a
# promise of that kind is worth exactly the measurement that backs it.
PRIOR_BEFORE="$LOGS/prior-frames-before.txt"
( cd "$CARD" && sha256sum smoke-3c/* smoke-3d/* ) | sort > "$PRIOR_BEFORE"
say "prior evidence pinned: $(wc -l < "$PRIOR_BEFORE") files across smoke-3c/ and smoke-3d/"

mkdir -p "$OUT"
EVENT_ID="${ACK_EVENT:-unset}"
cat > "$LOGS/ACK_START-$(date -u +%Y%m%dT%H%M%SZ).json" <<ACKJSON
{"stage":"s11-smoke-a","driver_sha256":"$DRIVER_SHA","tool_sha256":"$TOOL_SHA",
 "binary_sha256":"$BIN_SHA","dist_sha256":"$DIST_SHA","commit":"$COMMIT",
 "display":":$XDISP","owner_display_untouched":":1","window_left_s":$LEFT,
 "prediction_run3":"S1 transport_unreachable, NOT S2 - a refused CONNECT fails send() before response_json() can mint upstream_unavailable",
 "started_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
ACKJSON
say "ACK_START written"

# ---------------------------------------------------------------- the runs
XEPHYR_PID=""
APP_PID=""
PROXY_PID=""
cleanup_run() {
    # Each pid is waited on individually and only when set: `wait ""` is an error, and an
    # error inside a cleanup path is how a stage loses its own teardown.
    local p
    for p in "$APP_PID" "$PROXY_PID" "$XEPHYR_PID"; do
        [ -n "$p" ] && kill "$p" 2>/dev/null
    done
    for p in "$APP_PID" "$PROXY_PID" "$XEPHYR_PID"; do
        [ -n "$p" ] && wait "$p" 2>/dev/null
    done
    APP_PID=""; PROXY_PID=""; XEPHYR_PID=""
}
trap cleanup_run EXIT

FAILURES=0
frame_sha() { sha256sum "$1" 2>/dev/null | cut -d" " -f1; }


# run_once <label> <lang> <condition>
run_once() {
    local label="$1" lang="$2" condition="$3"
    local stand="$LOGS/stand-$label"
    local proxy_url="http://127.0.0.1:$CLOSED_PORT"

    say "[$label] lang=$lang condition=$condition"
    rm -rf "$stand"
    # 700 throughout: private_store.rs:76 refuses ANY ancestor with mode & 0o022, and a stand
    # under a 775 directory fails with settings_storage_error that reads like a product defect.
    mkdir -p "$stand/.config/skipi-crewing"
    chmod 700 "$stand" "$stand/.config" "$stand/.config/skipi-crewing"
    printf '{"interface":{"theme":"light","language":"%s"}}\n' "$lang" > "$stand/.config/skipi-crewing/settings.json"
    chmod 600 "$stand/.config/skipi-crewing/settings.json"

    if [ "$condition" = "closed" ]; then
        port_is_closed "$CLOSED_PORT" || { say "[$label] STOP: something now listens on $CLOSED_PORT - condition 1 is no longer 'no proxy reachable'"; return 5; }
        say "[$label] closed-port control re-measured: 127.0.0.1:$CLOSED_PORT still refuses"
    fi

    if [ "$condition" = "proxy503" ]; then
        # A busy port is WEATHER, not a verdict: retry on the alternate and record a finding,
        # rather than losing the stage to an address someone else happens to hold.
        local chosen=""
        local p
        for p in "$P503_PORT" "$P503_PORT_ALT"; do
            python3 "$TOOL" proxy503 --port "$p" --seconds 120 --log "$LOGS/$label-proxy.log" \
                > "$LOGS/$label-proxy.out" 2>&1 &
            PROXY_PID=$!
            local waited=0
            while [ "$waited" -lt 50 ]; do
                grep -q listening "$LOGS/$label-proxy.out" 2>/dev/null && break
                grep -q BIND_FAILED "$LOGS/$label-proxy.out" 2>/dev/null && break
                kill -0 "$PROXY_PID" 2>/dev/null || break
                sleep 0.1; waited=$((waited+1))
            done
            if grep -q listening "$LOGS/$label-proxy.out" 2>/dev/null; then chosen="$p"; break; fi
            say "[$label] FINDING: bind on $p did not take ($(head -1 "$LOGS/$label-proxy.out" 2>/dev/null)) - retrying on the alternate"
            wait "$PROXY_PID" 2>/dev/null; PROXY_PID=""
        done
        [ -n "$chosen" ] || { say "[$label] STOP: neither $P503_PORT nor $P503_PORT_ALT could be bound"; return 5; }
        proxy_url="http://127.0.0.1:$chosen"
        say "[$label] 503-on-CONNECT proxy up on $chosen"
    fi

    Xephyr ":$XDISP" -screen "${XW}x${XH}" -ac -nolisten tcp >"$LOGS/$label-xephyr.log" 2>&1 &
    XEPHYR_PID=$!
    local waited=0
    while [ "$waited" -lt 100 ] && [ ! -e "/tmp/.X11-unix/X$XDISP" ]; do sleep 0.1; waited=$((waited+1)); done
    [ -e "/tmp/.X11-unix/X$XDISP" ] || { say "[$label] STOP: Xephyr never created its socket"; return 10; }

    # `env -i` so the app inherits nothing of this shell: the profile is $stand and only the
    # variables named here exist. XDG_RUNTIME_DIR is passed because a WebKit app needs its
    # socket directory, and LANG is pinned so glyph rendering cannot vary between runs - the
    # frames are compared byte-wise, so an inherited locale would be an uncontrolled input.
    env -i HOME="$stand" DISPLAY=":$XDISP" PATH=/usr/bin:/bin \
        XDG_RUNTIME_DIR="/run/user/$(id -u)" LANG=C.UTF-8 \
        WEBKIT_DISABLE_DMABUF_RENDERER=1 \
        HTTPS_PROXY="$proxy_url" https_proxy="$proxy_url" \
        HTTP_PROXY="$proxy_url" http_proxy="$proxy_url" \
        ALL_PROXY="$proxy_url" all_proxy="$proxy_url" \
        NO_PROXY="" no_proxy="" \
        "$BIN" >"$LOGS/$label-app.log" 2>&1 &
    APP_PID=$!

    local wid=""
    waited=0
    while [ "$waited" -lt 300 ]; do
        wid=$(DISPLAY=":$XDISP" xdotool search --onlyvisible . 2>/dev/null | tail -1)
        [ -n "$wid" ] && break
        kill -0 "$APP_PID" 2>/dev/null || { say "[$label] STOP: the app exited before mapping a window (see $label-app.log)"; return 10; }
        sleep 0.1; waited=$((waited+1))
    done
    [ -n "$wid" ] || { say "[$label] STOP: no window appeared within 30s"; return 10; }
    say "[$label] window $wid mapped after $((waited/10))s"
    sleep 3

    python3 "$TOOL" capture --display "$XDISP" --out "$OUT/$label-1-entry.png" || return 10
    local sha_entry; sha_entry=$(frame_sha "$OUT/$label-1-entry.png")

    # The click point is MEASURED off the frame the app actually drew, never hard-coded.
    local click; click=$(python3 "$TOOL" find-fill --frame "$OUT/$label-1-entry.png" --rgb "$ACCENT") || return 11
    local cx cy
    cx=$(printf '%s' "$click" | python3 -c 'import json,sys; print(json.load(sys.stdin)["click_x"])')
    cy=$(printf '%s' "$click" | python3 -c 'import json,sys; print(json.load(sys.stdin)["click_y"])')
    say "[$label] login door measured at ($cx,$cy)"
    DISPLAY=":$XDISP" xdotool mousemove "$cx" "$cy" click 1
    sleep 1

    python3 "$TOOL" capture --display "$XDISP" --out "$OUT/$label-2-form.png" || return 10
    local sha_form; sha_form=$(frame_sha "$OUT/$label-2-form.png")
    # Each step verifies ITSELF: if the click did nothing the frame is unchanged, and the stage
    # stops instead of typing into a screen that is not the form.
    [ "$sha_form" != "$sha_entry" ] || { say "[$label] STOP: the frame did not change after the click - the login form never opened"; return 11; }

    # entryShowLogin(true) focuses #a-email, and with no window manager the pointer is already
    # inside the window, so XTEST keystrokes land in that field.
    DISPLAY=":$XDISP" xdotool type --delay 30 "$EMAIL"
    DISPLAY=":$XDISP" xdotool key Tab
    DISPLAY=":$XDISP" xdotool type --delay 30 "$PASSWORD"
    sleep 1

    click=$(python3 "$TOOL" find-fill --frame "$OUT/$label-2-form.png" --rgb "$ACCENT") || return 11
    cx=$(printf '%s' "$click" | python3 -c 'import json,sys; print(json.load(sys.stdin)["click_x"])')
    cy=$(printf '%s' "$click" | python3 -c 'import json,sys; print(json.load(sys.stdin)["click_y"])')
    say "[$label] submit measured at ($cx,$cy)"
    DISPLAY=":$XDISP" xdotool mousemove "$cx" "$cy" click 1
    sleep 5

    python3 "$TOOL" capture --display "$XDISP" --out "$OUT/$label-3-refusal.png" || return 10
    local sha_ref; sha_ref=$(frame_sha "$OUT/$label-3-refusal.png")
    [ "$sha_ref" != "$sha_form" ] || { say "[$label] STOP: the frame did not change after submit - no refusal was drawn"; return 11; }

    python3 "$TOOL" analyze --frame "$OUT/$label-3-refusal.png" > "$LOGS/$label-analysis.json" || return 12
    local verdict; verdict=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["verdict"])' "$LOGS/$label-analysis.json")
    [ "$verdict" = "REFUSAL_BOX_FOUND" ] || { say "[$label] STOP: analysis verdict [$verdict] - no refusal line at the declared colour"; return 12; }
    local boxh; boxh=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["refusal_box"]["h"])' "$LOGS/$label-analysis.json")
    local core; core=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["contrast_core"])' "$LOGS/$label-analysis.json")
    local mean; mean=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["contrast_mean"])' "$LOGS/$label-analysis.json")
    say "[$label] refusal drawn: box height ${boxh}px, contrast core=$core mean=$mean (declared 6.40, AA floor 4.5)"

    python3 "$TOOL" text --dist "$DIST" --dist-sha "$DIST_SHA" --lang "$lang" > "$LOGS/$label-texts.json" || return 12

    # THE APP'S OWN LOG IS THE STRONGEST CONTROL THIS STAGE HAS, and the rehearsal found it
    # rather than the design anticipating it. reqwest logs at TRACE, so the binary states its
    # own account origin and what happened to it:
    #   proxy(http://127.0.0.1:PORT/) intercepts 'https://assistant.skipi.app/'
    # That single line proves at RUNTIME what the source said at compile time - the release
    # binary's origin IS production - and simultaneously proves the request went to the loopback
    # proxy instead. Geometry says a refusal was drawn; this says WHICH host was asked and that
    # nothing reached it.
    cp "$LOGS/$label-app.log" "$OUT/$label-app.log"
    if ! grep -q "intercepts 'https://assistant.skipi.app/'" "$OUT/$label-app.log"; then
        say "[$label] STOP: the app's log does not show the proxy intercepting https://assistant.skipi.app/ - either the origin is not what we measured or the proxy was bypassed"
        return 12
    fi
    say "[$label] origin control: the binary names https://assistant.skipi.app/ and the loopback proxy intercepted it - no direct egress"

    # PRIVACY CONTROL: the rehearsal measured zero occurrences of either credential in the log,
    # and these frames are going to a person. A leak here would be published, not just stored.
    for secret in "$EMAIL" "$PASSWORD"; do
        if grep -qF "$secret" "$OUT/$label-app.log"; then
            say "[$label] STOP: a typed credential appears in the log that this stage publishes"
            return 12
        fi
    done

    cleanup_run
    return 0
}

for spec in "en-closed en closed" "ru-closed ru closed" "en-503 en proxy503"; do
    set -- $spec
    # `$?` IS CAPTURED ON THE LINE IMMEDIATELY AFTER THE COMMAND, with nothing between them.
    # The previous form was `if ! run_once …; then rc=$?`, and `!` INVERTS the status: run_once
    # returning 5 made `! run_once` return 0, so rc read 0 and the log line "RUN FAILED (rc 0)"
    # printed exactly the number a success would print. That was the only place a run's cause of
    # death reached the journal. Calibrated in a shell rather than reasoned about:
    #   f() { return 5; };  if ! f; then rc=$?   -> 0
    #                       f; rc=$?             -> 5
    # Nothing may stand between the command and the capture - not `!`, not an assignment, not a
    # substitution, not an `if`. Branch on the variable, never on the freshness of `$?`.
    run_once "$1" "$2" "$3"; rc=$?
    if [ "$rc" -ne 0 ]; then
        say "RUN FAILED: $1 (rc $rc)"
        FAILURES=$((FAILURES+1))
        cleanup_run
    fi
done
trap - EXIT

[ "$FAILURES" = "0" ] || { say "STOP: $FAILURES of 3 runs failed - no partial frame set is offered as a show"; exit 13; }

# ---------------------------------------------------------------- controls
H_EN=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["refusal_box"]["h"])' "$LOGS/en-closed-analysis.json")
H_RU=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["refusal_box"]["h"])' "$LOGS/ru-closed-analysis.json")
W_EN=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["refusal_box"]["w"])' "$LOGS/en-closed-analysis.json")
W_RU=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["refusal_box"]["w"])' "$LOGS/ru-closed-analysis.json")

# CONTROL 1 - geometry, against the smoke-3d calibration. The second-step texts are longer by
# construction, so a first-step line must be materially shorter. Equal heights would mean the
# frame is not showing the state the network condition says it is.
if [ "$H_EN" -ge "$CAL_H_SECOND_STEP" ] || [ "$H_RU" -ge "$CAL_H_SECOND_STEP" ]; then
    say "FINDING: a first-step refusal box (en ${H_EN}px, ru ${H_RU}px) is not shorter than smoke-3d's two-line second-step boxes (${CAL_H_SECOND_STEP}px). The frames may not show S1."
    FAILURES=$((FAILURES+1))
else
    say "CONTROL 1 PASSED: S1 boxes (en ${H_EN}px, ru ${H_RU}px) are shorter than the ${CAL_H_SECOND_STEP}px two-line second-step calibration"
fi

# CONTROL 2 - the language positive control is on the TEXT, not on the fact of switching. Two
# frames differing proves the setting took effect; identical frames would mean both runs showed
# one language while the record claimed two.
if cmp -s "$OUT/en-closed-3-refusal.png" "$OUT/ru-closed-3-refusal.png"; then
    say "FINDING: the EN and RU refusal frames are byte-identical - the language setting did not take effect, so one of the two labels is false"
    FAILURES=$((FAILURES+1))
else
    say "CONTROL 2 PASSED: EN and RU refusal frames differ (box widths ${W_EN}px vs ${W_RU}px), so the language really switched"
fi

# CONTROL 3 - the prediction. Same language, two network conditions. A matching box says the
# 503-on-CONNECT run produced the SAME state as the refused connection, which is S1.
H_503=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["refusal_box"]["h"])' "$LOGS/en-503-analysis.json")
W_503=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["refusal_box"]["w"])' "$LOGS/en-503-analysis.json")
if [ "$W_503" = "$W_EN" ] && [ "$H_503" = "$H_EN" ]; then
    say "PREDICTION CONFIRMED: 503-on-CONNECT yields the same box as a refused connection (${W_503}x${H_503}) - S1, not S2. S2 is unreachable on an unmodified release for the same reason as S3/S4."
    PRED=confirmed
else
    say "PREDICTION REFUTED - THIS IS A FINDING, NOT A FAILURE: 503-on-CONNECT drew a DIFFERENT box (${W_503}x${H_503}) than the refused connection (${W_EN}x${H_EN}). The state differs; which state it is must be read off the frame and returned before acceptance."
    PRED=refuted
fi
printf '%s\n' "$(cat "$LOGS/en-503-proxy.log" 2>/dev/null)" | sed 's/^/  proxy saw: /'

# CONTROL 4 - the closed evidence is untouched, measured rather than promised.
PRIOR_AFTER="$LOGS/prior-frames-after.txt"
( cd "$CARD" && sha256sum smoke-3c/* smoke-3d/* ) | sort > "$PRIOR_AFTER"
if cmp -s "$PRIOR_BEFORE" "$PRIOR_AFTER"; then
    say "CONTROL 4 PASSED: all $(wc -l < "$PRIOR_AFTER") files of smoke-3c/ and smoke-3d/ are byte-identical to before this stage"
else
    say "STOP: prior frame digests MOVED during this stage"; diff "$PRIOR_BEFORE" "$PRIOR_AFTER" | sed 's/^/  /'; exit 15
fi

CANON_AFTER=$(git -C "$HOME_REPO" status --porcelain -- ':!scratchpad' | wc -l)
say "canonical checkout unmoved: tracked-change count $CANON_BEFORE -> $CANON_AFTER"

( cd "$OUT" && sha256sum ./* ) | sort > "$LOGS/new-frames.txt"
cat > "$LOGS/after.txt" <<AFTEREOF
stage=s11-smoke-a
driver_sha256=$DRIVER_SHA
tool_sha256=$TOOL_SHA
binary_sha256=$BIN_SHA
dist_sha256=$DIST_SHA
commit=$COMMIT
frames_written=$(ls -1 "$OUT" | wc -l)
box_height_en=$H_EN
box_height_ru=$H_RU
box_height_503=$H_503
box_width_en=$W_EN
box_width_ru=$W_RU
box_width_503=$W_503
calibration_second_step_height=$CAL_H_SECOND_STEP
prediction_run3=$PRED
canonical_tracked_lines_before=$CANON_BEFORE
canonical_tracked_lines_after=$CANON_AFTER
prior_evidence_unchanged=yes
owner_display_touched=no
AFTEREOF
cat > "$LOGS/ACK_STOP-$(date -u +%Y%m%dT%H%M%SZ).json" <<ACKSTOP
{"stage":"s11-smoke-a","driver_sha256":"$DRIVER_SHA","frames":$(ls -1 "$OUT" | wc -l),
 "prediction_run3":"$PRED","prior_evidence_unchanged":true,"owner_display_touched":false,
 "limits":["S2/S3/S4 unreachable on an unmodified release build - three measured borders",
           "contrast_core reproduces the declared 6.40; contrast_mean uses a wider glyph population than smoke-3d's estimator and reads lower - both clear AA 4.5",
           "no owner acceptance is created by this stage; frames are a condition of the show, not a substitute for it"],
 "stopped_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
ACKSTOP

[ "$FAILURES" = "0" ] || { say "STOP: $FAILURES control(s) failed - see the FINDING lines above"; exit 14; }
say "DONE: $(ls -1 "$OUT" | wc -l) files in smoke-release-a/ ($(ls -1 "$OUT"/*.png | wc -l) frames), S1 shown on the RELEASE binary in EN and RU, prediction $PRED. smoke-3d/ and smoke-3c/ untouched. NOT an acceptance - the owner's live gate is unchanged by anything here."
