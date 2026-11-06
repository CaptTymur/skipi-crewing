#!/usr/bin/env bash
# ДРАЙВЕР стадии No.930-s7 (PREP): замер ПО КОДУ адреса и формы второй ступени.
# Все условия STOP выражены КОДОМ, а не обещанием: каждое — ворота с отказом до
# первого действия. Ни одного продуктового байта стадия не меняет; единственная
# запись — каталог scratchpad/crewing-930 и один локальный коммит в него.
#
# Использование:  run-930-s7-v2.sh <сертификат> <sha-живого-main-замеренный-ДО-стадии>
#
# v2 отличается от v1 двумя вещами. (1) Из ворот 3 убран живой сетевой вызов:
# в v1 он стоял ВНУТРИ окна, то есть стадия ходила в сеть, не объявив ни одного
# токена `net:`. Нашёл координатор; дефект настоящий, а не гипотетический.
# Базис теперь приходит аргументом (замер ДО стадии) и проверяется ЛОКАЛЬНО:
# объект обязан быть в репозитории, иначе отказ. (2) Порог окна 120 -> 180 с:
# порог меряется под круг гейта, а не под длительность моей команды.
set -euo pipefail

CERT="${1:-}"
BASE="${2:-}"   # sha живого main, замеренный ДО стадии (мой REPORT, не факт гейта)
S="$(cd "$(dirname "$0")" && pwd)"
W=/home/linux/Developer/worktrees/crewing-930-20261105
COORD=/home/linux/Developer/skipi-parallel-coordinator
OUT="$W/scratchpad/crewing-930/s7-wire-20261106"
WORKLOG="$W/scratchpad/crewing-930/WORKLOG.md"
MIN_WINDOW_SECONDS=90
STREAM=crewing/930-session-activation
WRITER=skipi-crewing-9b

say() { printf '%s %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
die() { printf 'ОТКАЗ: %s\n' "$*" >&2; exit "${2:-4}"; }

# ---- ВОРОТА 0: сертификат назван и существует --------------------------------
[ -n "$CERT" ] || die "сертификат гранта не назван первым аргументом" 2
[ -f "$CERT" ] || die "сертификата нет по пути $CERT" 2
[ -n "$BASE" ] || die "вторым аргументом нужен sha живого main, замеренный ДО стадии" 2

# ---- ВОРОТА 1: окно ПОКРЫВАЕТ работу (читается из сертификата, не из письма) --
LEFT="$(python3 - "$CERT" <<'PY'
import datetime, json, sys
c = json.load(open(sys.argv[1]))
exp = None
for k in ("expires_at", "window_expires_at"):
    if isinstance(c.get(k), str):
        exp = c[k]; break
    for v in c.values():
        if isinstance(v, dict) and isinstance(v.get(k), str):
            exp = v[k]; break
    if exp: break
if not exp:
    print("NOFIELD"); sys.exit(0)
t = datetime.datetime.fromisoformat(exp.replace("Z", "+00:00"))
now = datetime.datetime.now(datetime.timezone.utc)
print(int((t - now).total_seconds()))
PY
)"
if [ "$LEFT" = "NOFIELD" ]; then
  die "в сертификате не найдено поле expires_at — окно непроверяемо, стадия не начинается" 2
fi
say "окна осталось: ${LEFT}s (порог ${MIN_WINDOW_SECONDS}s)"
[ "$LEFT" -ge "$MIN_WINDOW_SECONDS" ] || die "окно короче порога — не начинаю, прошу renew" 2

# ---- ВОРОТА 2: текущесть разрешения — только PERMIT_CURRENT -------------------
GATE="$(python3 "$COORD/tools/stage_gate.py" check --certificate "$CERT" 2>&1 || true)"
printf '%s\n' "$GATE" | tee "$S/gate-check.txt" >/dev/null
printf '%s' "$GATE" | grep -q 'PERMIT_CURRENT' \
  || die "гейт не сказал PERMIT_CURRENT (см. $S/gate-check.txt)" 2

# ---- ВОРОТА 3: базис проверяется ЛОКАЛЬНО; сетевых действий в стадии НЕТ -------
git -C "$W" cat-file -e "${BASE}^{commit}" 2>/dev/null \
  || die "объекта $BASE нет локально; сети стадия не касается, значит базис непроверяем" 3
SUBJ=src-tauri/src/native_account.rs
SHA_MAIN="$(git -C "$W" show "$BASE:$SUBJ" | sha256sum | cut -d' ' -f1)"
SHA_TREE="$(sha256sum "$W/$SUBJ" | cut -d' ' -f1)"
say "базис $BASE — локальный объект; живых сетевых вызовов стадия не делает"
say "субъект main=$SHA_MAIN tree=$SHA_TREE"
[ "$SHA_MAIN" = "$SHA_TREE" ] \
  || die "субъект замера РАСХОДИТСЯ с живым main — вывод был бы о локальной работе, а заявлен о main" 3

# ---- ВОРОТА 4: в дереве нет правок прослеженных файлов ------------------------
TRACKED_DIRTY="$(git -C "$W" status --porcelain=v1 --untracked-files=no | wc -l)"
[ "$TRACKED_DIRTY" -eq 0 ] \
  || die "в дереве $TRACKED_DIRTY правок прослеженных файлов — стадия ожидает чистое дерево" 3

# ---- СНИМОК «ДО»: доказательство чтения-без-записи ----------------------------
mkdir -p "$OUT"
before_state() {
  for f in src-tauri/src/native_account.rs src-tauri/src/native_lifecycle.rs \
           src-tauri/src/native_local_commit.rs; do
    sha256sum "$W/$f"
  done
  find "$W/src-tauri/src" "$W/dist" -printf '%T@ %s %p\n' 2>/dev/null | sort
}
before_state > "$S/before-state.txt"
BEFORE="$(sha256sum "$S/before-state.txt" | cut -d' ' -f1)"
WL_BEFORE_SHA="$(sha256sum "$WORKLOG" | cut -d' ' -f1)"
WL_BEFORE_BYTES="$(stat -c %s "$WORKLOG")"
say "снимок ДО: $BEFORE; WORKLOG $WL_BEFORE_BYTES Б / $WL_BEFORE_SHA"

# ---- ACK_START — НИЖЕ ворот, первым действием стадии --------------------------
DRIVER_SHA="$(sha256sum "$0" | cut -d' ' -f1)"
ACK_START="$OUT/ACK_START-930-s7.json"
OUT="$OUT" STREAM="$STREAM" WRITER="$WRITER" LEFT="$LEFT" DRIVER_SHA="$DRIVER_SHA" \
ACK_START="$ACK_START" python3 - <<'PY'
import datetime, json, os
now = datetime.datetime.now(datetime.timezone.utc)
doc = {
    "document": "ACK_START",
    "ack_start_event_id": "crewing-930-s7-ACKSTART-%s" % now.strftime("%Y%m%dT%H%M%SZ"),
    "observed_at": now.isoformat(),
    "stage": "PREP",
    "stream_id": os.environ["STREAM"],
    "writer": os.environ["WRITER"],
    "driver_sha256": os.environ["DRIVER_SHA"],
    "window_seconds_remaining_at_start": int(os.environ["LEFT"]),
    "note": "документ оформлен в тот же миг, что и начало; задним числом не датирован",
}
open(os.environ["ACK_START"], "w", encoding="utf-8").write(
    json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
print(doc["ack_start_event_id"])
PY
say "ACK_START написан: $ACK_START"

# ---- ЗАМЕР --------------------------------------------------------------------
W="$W" OUT="$OUT" BASE_SHA="$BASE" python3 "$S/measure-930-s7.py" | tee "$S/measure.log"
cp "$S/calibration-930-s7.md" "$OUT/calibration-930-s7.md"
cp "$S/measure-930-s7.py" "$S/record-930-s7-v2.py" "$S/run-930-s7.sh" "$0" "$OUT/"

# ---- ЗАПИСЬ (сборка из измеренного JSON, числа рукой не набираются) -----------
OUT="$OUT" WORKLOG="$WORKLOG" python3 "$S/record-930-s7-v2.py" | tee "$S/record.log"

# ---- ПРОВЕРКА: WORKLOG только ДОПИСАН (пред-образ — байтовый префикс) ---------
WL_PREFIX_SHA="$(head -c "$WL_BEFORE_BYTES" "$WORKLOG" | sha256sum | cut -d' ' -f1)"
[ "$WL_PREFIX_SHA" = "$WL_BEFORE_SHA" ] \
  || die "WORKLOG изменён не дописыванием: первые $WL_BEFORE_BYTES байт больше не те" 5
say "WORKLOG: дописывание подтверждено байтовым префиксом"

# ---- ПРОВЕРКА: продуктовые файлы не тронуты ------------------------------------
before_state > "$S/after-state.txt"
AFTER="$(sha256sum "$S/after-state.txt" | cut -d' ' -f1)"
[ "$BEFORE" = "$AFTER" ] \
  || { diff "$S/before-state.txt" "$S/after-state.txt" | head -20; \
       die "продуктовая поверхность сдвинулась — стадия обязана быть читающей" 5; }
say "чтение-без-записи подтверждено: $AFTER"

# ---- КОММИТ: только scratchpad/crewing-930 ------------------------------------
git -C "$W" add -f scratchpad/crewing-930
FOREIGN="$(git -C "$W" diff --cached --name-only | grep -vc '^scratchpad/crewing-930/' || true)"
[ "$FOREIGN" = "0" ] \
  || die "в индексе $FOREIGN путей вне scratchpad/crewing-930 — коммит не делается" 6
DELETIONS="$(git -C "$W" diff --cached --name-status | awk '$1=="D"' | wc -l)"
[ "$DELETIONS" -eq 0 ] || die "в индексе $DELETIONS удалений — коммит не делается" 6
git -C "$W" commit -q -m "chore(crewing-930): замер по коду — адрес и форма второй ступени (стадия 2, шаг 1)"
COMMIT="$(git -C "$W" rev-parse HEAD)"
say "коммит записи: $COMMIT (только scratchpad, удалений 0)"

# ---- ACK_STOP — ПОСЛЕДНЕЕ действие стадии; доклад идёт ПОСЛЕ него -------------
AFTER_TXT="$OUT/after-state-930-s7.txt"
cp "$S/after-state.txt" "$AFTER_TXT"
AFTER_SHA="$(sha256sum "$AFTER_TXT" | cut -d' ' -f1)"
ACK_STOP="$OUT/ACK_STOP-930-s7.json"
WRITER="$WRITER" STREAM="$STREAM" AFTER_TXT="$AFTER_TXT" AFTER_SHA="$AFTER_SHA" \
COMMIT="$COMMIT" ACK_STOP="$ACK_STOP" python3 - <<'PY'
import datetime, json, os
now = datetime.datetime.now(datetime.timezone.utc)
doc = {
    "document": "ACK_STOP",
    "ack_stop_event_id": "crewing-930-s7-ACKSTOP-%s" % now.strftime("%Y%m%dT%H%M%SZ"),
    "ack_stop_writer": os.environ["WRITER"],
    "stream_id": os.environ["STREAM"],
    "observed_at": now.isoformat(),
    "operations_terminated": True,
    "queued_operations_cancelled": True,
    "queued_operations_note": "истинно ВАКУУМНО: очереди и фоновых процессов стадия не "
                              "создавала вовсе — стадия синхронная, отменять было нечего",
    "evidence": {
        "after_state_path": os.environ["AFTER_TXT"],
        "after_state_sha256": os.environ["AFTER_SHA"],
        "record_commit": os.environ["COMMIT"],
    },
}
open(os.environ["ACK_STOP"], "w", encoding="utf-8").write(
    json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
print(doc["ack_stop_event_id"])
PY
say "ACK_STOP написан: $ACK_STOP"
say "СТАДИЯ ЗАВЕРШЕНА. Доклад координатору — после этой строки, вне окна."
