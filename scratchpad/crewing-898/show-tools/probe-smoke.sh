#!/bin/bash
# PROBE, not the stage driver. It exercises the mechanics of the part-A smoke so the real
# driver's window floor is a MEASURED number and not a guess, and so the riskiest unknown (does
# this release binary even launch under Xephyr, and does the login form open) is answered before
# a lease is spent on it. It writes ONLY inside the session scratchpad and touches no surface
# the stage declares. It carries no certificate gate because it performs no declared action -
# which is also why it is a separate file: a driver able to skip its own gate has no gate.
set -uo pipefail
SP=/tmp/claude-1000/-home-linux-Developer-skipi-crewing/ebbd1815-b6d4-4272-b07f-4adc865ecf49/scratchpad
CARD=/home/linux/Developer/skipi-crewing/scratchpad/crewing-898
TOOL="$CARD/coord/smoke-tool.py"
WT=/home/linux/Developer/worktrees/crewing-898-20261104
BIN="$WT/src-tauri/target/release/skipi-crewing"
OUT="$SP/probe-frames"
STAND="$SP/probe-stand"
XDISP=9
CLOSED_PORT=39165
LANG_CODE="${1:-en}"
t0=$(date +%s)
mark() { printf '  +%-3ss %s\n' "$(( $(date +%s) - t0 ))" "$*"; }

rm -rf "$OUT" "$STAND"; mkdir -p "$OUT" "$STAND/.config/skipi-crewing"
chmod 700 "$STAND" "$STAND/.config" "$STAND/.config/skipi-crewing"
printf '{"interface":{"theme":"light","language":"%s"}}\n' "$LANG_CODE" > "$STAND/.config/skipi-crewing/settings.json"
chmod 600 "$STAND/.config/skipi-crewing/settings.json"

XEPHYR_PID=""; APP_PID=""
cleanup() {
  for p in "$APP_PID" "$XEPHYR_PID"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done
  for p in "$APP_PID" "$XEPHYR_PID"; do [ -n "$p" ] && wait "$p" 2>/dev/null; done
}
trap cleanup EXIT

[ -e "/tmp/.X11-unix/X$XDISP" ] && { echo "STOP: :$XDISP in use"; exit 7; }
Xephyr ":$XDISP" -screen 1100x750 -ac -nolisten tcp >"$SP/probe-xephyr.log" 2>&1 &
XEPHYR_PID=$!
w=0; while [ $w -lt 100 ] && [ ! -e "/tmp/.X11-unix/X$XDISP" ]; do sleep 0.1; w=$((w+1)); done
[ -e "/tmp/.X11-unix/X$XDISP" ] || { echo "STOP: Xephyr no socket"; exit 10; }
mark "Xephyr up on :$XDISP"

PROXY="http://127.0.0.1:$CLOSED_PORT"
env -i HOME="$STAND" DISPLAY=":$XDISP" PATH=/usr/bin:/bin \
    XDG_RUNTIME_DIR="/run/user/$(id -u)" LANG=C.UTF-8 \
    WEBKIT_DISABLE_DMABUF_RENDERER=1 \
    HTTPS_PROXY="$PROXY" https_proxy="$PROXY" HTTP_PROXY="$PROXY" http_proxy="$PROXY" \
    ALL_PROXY="$PROXY" all_proxy="$PROXY" NO_PROXY="" no_proxy="" \
    "$BIN" >"$SP/probe-app.log" 2>&1 &
APP_PID=$!
mark "app launched (pid $APP_PID)"

WID=""; w=0
while [ $w -lt 400 ]; do
  WID=$(DISPLAY=":$XDISP" xdotool search --onlyvisible . 2>/dev/null | tail -1)
  [ -n "$WID" ] && break
  kill -0 "$APP_PID" 2>/dev/null || { echo "STOP: app exited early"; tail -20 "$SP/probe-app.log"; exit 10; }
  sleep 0.1; w=$((w+1))
done
[ -n "$WID" ] || { echo "STOP: no window in 40s"; tail -20 "$SP/probe-app.log"; exit 10; }
mark "window $WID mapped"
sleep 3

python3 "$TOOL" capture --display "$XDISP" --out "$OUT/1-entry.png" | sed 's/^/    /'
mark "entry frame captured"

CLICK=$(python3 "$TOOL" find-fill --frame "$OUT/1-entry.png" --rgb 004564) || { echo "STOP: no accent button on the entry frame"; exit 11; }
CX=$(printf '%s' "$CLICK" | python3 -c 'import json,sys; print(json.load(sys.stdin)["click_x"])')
CY=$(printf '%s' "$CLICK" | python3 -c 'import json,sys; print(json.load(sys.stdin)["click_y"])')
mark "login door measured at ($CX,$CY)"
DISPLAY=":$XDISP" xdotool mousemove "$CX" "$CY" click 1
sleep 1
python3 "$TOOL" capture --display "$XDISP" --out "$OUT/2-form.png" | sed 's/^/    /'
if cmp -s "$OUT/1-entry.png" "$OUT/2-form.png"; then echo "  STOP: frame unchanged after click - form did not open"; exit 11; fi
mark "login form opened (frame changed)"

DISPLAY=":$XDISP" xdotool type --delay 30 "probe@example.invalid"
DISPLAY=":$XDISP" xdotool key Tab
DISPLAY=":$XDISP" xdotool type --delay 30 "synthetic-not-a-real-secret"
sleep 1
python3 "$TOOL" capture --display "$XDISP" --out "$OUT/2b-typed.png" | sed 's/^/    /'
if cmp -s "$OUT/2-form.png" "$OUT/2b-typed.png"; then echo "  WARNING: frame unchanged after typing - keystrokes may not have landed"; fi
mark "credentials typed"

CLICK=$(python3 "$TOOL" find-fill --frame "$OUT/2-form.png" --rgb 004564) || { echo "STOP: no submit button"; exit 11; }
CX=$(printf '%s' "$CLICK" | python3 -c 'import json,sys; print(json.load(sys.stdin)["click_x"])')
CY=$(printf '%s' "$CLICK" | python3 -c 'import json,sys; print(json.load(sys.stdin)["click_y"])')
mark "submit measured at ($CX,$CY)"
DISPLAY=":$XDISP" xdotool mousemove "$CX" "$CY" click 1
sleep 5
python3 "$TOOL" capture --display "$XDISP" --out "$OUT/3-refusal.png" | sed 's/^/    /'
mark "refusal frame captured"

echo
echo "=== ANALYSIS of the refusal frame ==="
python3 "$TOOL" analyze --frame "$OUT/3-refusal.png"
echo
echo "=== app stderr (last 12 lines) ==="
tail -12 "$SP/probe-app.log" | sed 's/^/    /'
mark "probe complete"
