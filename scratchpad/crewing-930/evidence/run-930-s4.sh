#!/usr/bin/env bash
# Драйвер слайса A, поток crewing/930-session-activation. ПОДКОМАНДЫ: apply | retry | finish.
# КАЖДАЯ начинается своим `check` по сертификату — действовать после истечения пермита
# невозможно по построению, а не по дисциплине.
set -Eeuo pipefail
umask 0022
COORD=/home/linux/Developer/skipi-parallel-coordinator
WT=/home/linux/Developer/worktrees/crewing-930-20261105
SRC="$WT/src-tauri/src"
SP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCHED="$SP/patched-slice-A"
WRITER="skipi-crewing-53"
RESERVE=75
MAX_ATTEMPTS=5
OUT="$SP/s4-out"; mkdir -p "$OUT"
CMD="${1:?usage: run-930-s4.sh <apply|retry|finish> <certificate>}"
CERT="${2:?missing certificate path}"
SELF_SHA="$(sha256sum "${BASH_SOURCE[0]}" | cut -d" " -f1)"
[ -n "$WRITER" ] || { echo "REFUSE: writer unresolved" >&2; exit 9; }

PRE_L=5a9d96910d0a2dd24c4171630f4a9c29479a249d055401a29e97e4d0c15cfa6b
PRE_C=4a549e5a9af9288186615723dd26db169c04122584153260e05979e75a390e21
PRE_J=50774e7986d3105307c153495746a72e04d7c145899572abbfb6d2014c80831d
PRE_B=89a90f8893b362f82cfe4bb11b72c712365aab47b2c642bf0cc88c8cba694525
POST_L=9b7d54f7788612796d216141fc1fee7c39716fc2501143f1fd152e21d32e29bb
POST_C=d9d54d13f839231812c5397592c111f3dfb43bb180cb4f68a0aa78eeadea20c4
POST_J=4f76ed419d2eca8f57a08cf731ea27efbb9fd7d654d554bcd33dfe05eb2c50de
POST_B=9a64aaea9b8cd9cda33e05226f02a99eb16b5982317b886045f1aecbde5f05b3

gate() {
  local out
  out="$(cd "$COORD" && python3 tools/stage_gate.py check --certificate "$CERT" 2>&1)" || {
    printf 'REFUSE: gate rc!=0\n%s\n' "$out" >&2; exit 2; }
  case "$out" in *PERMIT_CURRENT*) printf '%s\n' "$out" ;;
    *) printf 'REFUSE: not PERMIT_CURRENT\n%s\n' "$out" >&2; exit 2 ;; esac
}
left() { python3 -c "
import json,datetime
c=json.load(open('$CERT'))
e=datetime.datetime.fromisoformat(c['expires_at'].replace('Z','+00:00'))
print(int((e-datetime.datetime.now(datetime.timezone.utc)).total_seconds()))"; }
sha() { sha256sum "$1" | cut -d" " -f1; }

# Единица резки объявлена: от строки `#[test]` до строки с закрывающей `}`, БЕЗ хвостового \n.
blocks() { python3 "$SP/cut-blocks.py" "$SRC/native_local_joint_tests.rs" "$1"; }

case "$CMD" in
apply)
  gate
  [ ! -f "$SP/ACK_START-930-s4.json" ] || { echo "REFUSE: ACK_START already exists — apply не повторяется" >&2; exit 8; }
  R="$(left)"; B=$(( R - RESERVE ))
  echo "remaining=${R}s budget=${B}s"
  [ "$B" -ge 40 ] || { echo "REFUSE: budget ${B}s < 40s" >&2; exit 3; }
  python3 - "$CERT" "$SELF_SHA" "$SP/ACK_START-930-s4.json" "$WRITER" "$R" <<'PYACK'
import json,sys,datetime,uuid
cert,self_sha,out,writer,remain=sys.argv[1:6]
json.dump({"document":"ACK_START",
 "ack_start_event_id":f"crewing-930-s4-ackstart-{datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}",
 "observed_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),
 "stage":"IMPLEMENT","stream_id":"crewing/930-session-activation","writer":writer,
 "driver_sha256":self_sha,"window_seconds_remaining_at_start":int(remain),
 "umask_declared":"0022"},open(out,'w'),ensure_ascii=False,indent=1)
print("ACK_START ->",out)
PYACK
  # пины сверяются с ТЕМИ САМЫМИ объектами
  for p in "native_lifecycle.rs $PRE_L" "native_local_commit.rs $PRE_C" \
           "native_local_joint_tests.rs $PRE_J" "lib.rs $PRE_B"; do
    set -- $p; got="$(sha "$SRC/$1")"
    [ "$got" = "$2" ] || { echo "REFUSE: pre sha of $1 is $got, declared $2" >&2; exit 4; }
  done
  blocks "$OUT/blocks-before.json"; echo "blocks BEFORE -> $OUT/blocks-before.json"
  for f in native_lifecycle.rs native_local_commit.rs native_local_joint_tests.rs lib.rs; do
    cp -- "$PATCHED/$f" "$SRC/$f"
  done
  for p in "native_lifecycle.rs $POST_L" "native_local_commit.rs $POST_C" \
           "native_local_joint_tests.rs $POST_J" "lib.rs $POST_B"; do
    set -- $p; got="$(sha "$SRC/$1")"
    [ "$got" = "$2" ] || { echo "REFUSE: post sha of $1 is $got, declared $2" >&2; exit 5; }
  done
  echo "all four post-images match the declaration"
  blocks "$OUT/blocks-after-apply.json"
  python3 "$SP/compare-blocks.py" "$OUT/blocks-before.json" "$OUT/blocks-after-apply.json" --expect-changed "$SP/declared-block-changes.json" || exit 6
  echo 0 > "$OUT/attempts"
  "$0" retry "$CERT"
  ;;
retry)
  gate
  n=$(( $(cat "$OUT/attempts" 2>/dev/null || echo 0) + 1 ))
  [ "$n" -le "$MAX_ATTEMPTS" ] || { echo "REFUSE: attempt $n > N=$MAX_ATTEMPTS — объявленный исход, не обрыв" >&2; exit 7; }
  echo "$n" > "$OUT/attempts"
  # правки ради компиляции разрешены ТОЛЬКО в коде: блоки обязаны остаться теми же
  blocks "$OUT/blocks-now.json"
  python3 "$SP/compare-blocks.py" "$OUT/blocks-before.json" "$OUT/blocks-now.json" --expect-changed "$SP/declared-block-changes.json" || exit 6
  B=$(( $(left) - RESERVE ))
  if [ "$B" -lt 20 ]; then echo "SKIP compile: остаток ${B}s < 20s"; echo skipped > "$OUT/attempt-$n.rc"; exit 0; fi
  echo "=== compile attempt $n/$MAX_ATTEMPTS, budget ${B}s ==="
  set +e
  ( cd "$SRC/.." && setsid timeout -k 10s "${B}s" cargo check --tests ) > "$OUT/attempt-$n.log" 2>&1
  rc=$?
  set -e
  echo "$rc" > "$OUT/attempt-$n.rc"
  echo "attempt $n rc=$rc"
  if [ "$rc" -ne 0 ]; then
    echo "--- первые ошибки ---"; grep -E "^error" "$OUT/attempt-$n.log" | head -8 || true
  fi
  ;;
finish)
  gate
  blocks "$OUT/blocks-final.json"
  python3 "$SP/compare-blocks.py" "$OUT/blocks-before.json" "$OUT/blocks-final.json" --expect-changed "$SP/declared-block-changes.json" || echo "WARNING: блоки разошлись — идёт в отчёт как есть"
  B=$(( $(left) - RESERVE ))
  if [ "$B" -ge 25 ]; then
    echo "=== dead_code в ПРОДУКТОВОМ cfg, формат по умолчанию (имена печатаются) ==="
    set +e; ( cd "$SRC/.." && setsid timeout -k 10s "${B}s" cargo check ) > "$OUT/product-check.log" 2>&1; echo "rc=$?"; set -e
  else echo "SKIP product dead_code probe: остаток ${B}s"; fi
  python3 "$SP/finish-report.py" "$OUT" "$SP" "$SRC" "$WT" "$WRITER" "$CERT"
  ;;
*) echo "REFUSE: unknown subcommand $CMD" >&2; exit 1 ;;
esac
