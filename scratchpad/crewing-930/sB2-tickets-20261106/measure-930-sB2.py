#!/usr/bin/env python3
"""ЗАМЕР ПО КОДУ, слайс B, ИСПРАВЛЕННЫЙ прибор (No.930).

Предыдущий прибор дал ЛОЖНОЕ ОПРОВЕРЖЕНИЕ утверждения карточки по трём причинам,
и все три здесь закрыты:

  (1) тестовость проверялась ПОДСТРОКОЙ `cfg(test)`, которой нет в составной форме
      `#[cfg(all(test, target_os = "linux"))]` — теперь предикат РАЗБИРАЕТСЯ
      (`cfg_predicate.py`, 12 случаев, обе стороны);
  (2) тестовый файл подключён через `include!(...)`, а не `mod name;`, поэтому
      список файловых модулей не мог его увидеть — теперь `include!` разбирается,
      и включённый файл НАСЛЕДУЕТ тестовость места включения;
  (3) игла `\\bticket\\b` считала слово в КОММЕНТАРИИ и локальную переменную внутри
      тела самого определения — теперь вызов ищется как ВЫЗОВ МЕТОДА, комментарии
      вырезаются, а диапазон определения исключается по построению.

Калибровка теперь на РЕАЛЬНОМ дереве с ожиданиями, выведенными НЕЗАВИСИМО от
классификатора (граница тестового модуля по строке), а не только на моих чистых
фикстурах — ровно та ошибка, которая и стоила круга.
"""
import hashlib
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cfg_predicate import cfg_gates_test  # noqa: E402

W = os.environ["W"]
OUT = os.environ["OUT"]
BASE_SHA = os.environ["BASE_SHA"]
SUBJECT = os.environ.get("SUBJECT", "ticket")
SRC = os.path.join(W, "src-tauri", "src")
FAIL = []

ITEM_RX = re.compile(r"^(\s*)(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?"
                     r"(fn|mod|impl|struct|enum)\b\s*(\w+)?")
INCLUDE_RX = re.compile(r'include!\s*\(\s*"([^"]+)"\s*\)')


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 16), b""):
            h.update(c)
    return h.hexdigest()


def rs_files():
    out = []
    for root, _d, names in os.walk(SRC):
        for n in sorted(names):
            if n.endswith(".rs"):
                out.append(os.path.join(root, n))
    return sorted(out)


def strip_comment(line):
    """Убрать строчный комментарий, не трогая `//` внутри строкового литерала."""
    out, in_str, esc = [], False, False
    i = 0
    while i < len(line):
        ch = line[i]
        if esc:
            out.append(ch)
            esc = False
            i += 1
            continue
        if ch == "\\":
            out.append(ch)
            esc = True
            i += 1
            continue
        if ch == '"':
            in_str = not in_str
            out.append(ch)
            i += 1
            continue
        if not in_str and ch == "/" and i + 1 < len(line) and line[i + 1] == "/":
            break
        out.append(ch)
        i += 1
    return "".join(out)


def attrs_above(lines, j):
    attrs, k = [], j - 1
    while k >= 0:
        s = lines[k].strip()
        if s.startswith("#["):
            attrs.append(s)
        elif s.startswith("//") or not s:
            pass
        else:
            break
        k -= 1
    return attrs


def context_chain(lines, idx):
    """Цепочка объемлющих элементов по ОТСТУПУ (скобки не разбираются).
    Тестовость — от ЛЮБОГО предка, через РАЗБОР предиката cfg."""
    base = len(lines[idx]) - len(lines[idx].lstrip())
    chain, limit = [], base
    for j in range(idx, -1, -1):
        m = ITEM_RX.match(lines[j])
        if not m:
            continue
        ind = len(m.group(1))
        if j != idx and ind > limit:
            continue
        at = attrs_above(lines, j)
        chain.append({"kind": m.group(2), "name": m.group(3), "line": j + 1,
                      "attrs": at[:3],
                      "self_test": any(cfg_gates_test(a) for a in at)})
        if ind == 0:
            break
        limit = ind - 1
    return chain


def include_map(files):
    """included file -> тестовость МЕСТА включения (наследуется содержимым)."""
    out = {}
    for path in files:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()
        for i, line in enumerate(lines):
            m = INCLUDE_RX.search(line)
            if not m:
                continue
            target = os.path.normpath(os.path.join(os.path.dirname(path), m.group(1)))
            chain = context_chain(lines, i)
            out[target] = {
                "included_from": os.path.relpath(path, W), "at_line": i + 1,
                "site_is_test": any(n["self_test"] for n in chain),
                "owed_to": next(("%s %s @%d" % (n["kind"], n["name"], n["line"])
                                 for n in chain if n["self_test"]), None),
            }
    return out


def scan(files, pattern, inc_map, skip_ranges=None):
    rx = re.compile(pattern)
    rows = []
    for path in files:
        rel = os.path.relpath(path, W)
        inherited = inc_map.get(os.path.normpath(path))
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                lines = fh.readlines()
        except OSError as exc:
            FAIL.append("%s: %s" % (rel, exc))
            continue
        for i, raw in enumerate(lines):
            code = strip_comment(raw)
            if not rx.search(code):
                continue
            if skip_ranges:
                if any(f == rel and lo <= i + 1 <= hi for f, lo, hi in skip_ranges):
                    continue
            chain = context_chain(lines, i)
            is_test = any(n["self_test"] for n in chain)
            if not is_test and inherited and inherited["site_is_test"]:
                is_test = True
                owed = "include! из %s:%d (%s)" % (inherited["included_from"],
                                                   inherited["at_line"],
                                                   inherited["owed_to"])
            else:
                owed = next(("%s %s @%d" % (n["kind"], n["name"], n["line"])
                             for n in chain if n["self_test"]), None)
            rows.append({"file": rel, "line": i + 1, "code": code.strip()[:160],
                         "verdict": "ТЕСТОВОЕ" if is_test else "ПРОДУКТОВОЕ",
                         "test_owed_to": owed,
                         "enclosing": ("%s %s @%d" % (chain[0]["kind"], chain[0]["name"],
                                                      chain[0]["line"])) if chain else None})
    return rows


def definition_range(files, name):
    """Диапазон строк `fn <name>` — от объявления до строки с закрывающей скобкой
    на том же отступе. Нужен, чтобы ТЕЛО определения не считалось вызывающим."""
    rx = re.compile(r"^(\s*)(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+" +
                    re.escape(name) + r"\b")
    out = []
    for path in files:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()
        for i, line in enumerate(lines):
            m = rx.match(line)
            if not m:
                continue
            ind = len(m.group(1))
            end = i
            for j in range(i + 1, len(lines)):
                st = lines[j]
                if st.strip() == "}" and (len(st) - len(st.lstrip())) == ind:
                    end = j
                    break
            out.append((os.path.relpath(path, W), i + 1, end + 1))
    return out


def main():
    files = rs_files()
    inc = include_map(files)
    defs = definition_range(files, SUBJECT)

    rep = {
        "measured_at_utc": subprocess.run(["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"],
                                          capture_output=True, text=True,
                                          check=True).stdout.strip(),
        "layer": "НАЙДЕНО В КЛИЕНТСКОМ КОДЕ (чтение названного SHA). Не «проверено в работе».",
        "base_sha": BASE_SHA, "subject": SUBJECT, "scan_files": len(files),
        "include_map": {os.path.relpath(k, W): v for k, v in inc.items()},
        "definition_ranges": [{"file": f, "from": a, "to": b} for f, a, b in defs],
        "voids_previous": {
            "previous_raw": "scratchpad/crewing-930/sB-tickets-20261106/"
                            "measure-930-sB-raw.json",
            "previous_verdict": "claim_holds_in_full=False (ЛОЖНОЕ ОПРОВЕРЖЕНИЕ)",
            "reason": "подстрока вместо разбора cfg; include! не разбирался; игла "
                      "считала комментарии и тело определения",
        },
    }

    # ВЫЗОВЫ: только вызов метода, вне диапазона определения, без комментариев
    rep["calls"] = scan(files, r"\.%s\s*\(" % re.escape(SUBJECT), inc,
                        skip_ranges=defs)
    rep["private_ticket_constructions"] = [
        r for r in scan(files, r"PrivateTicket\s*\{|PrivateTicket::(new|from)\b", inc)
        if not re.search(r"\b(struct|enum|type|impl)\s+(?:<[^>]*>\s*)?PrivateTicket\b",
                         r["code"])]
    rep["private_ticket_consumptions"] = scan(
        files, r"fn\s+\w+\s*\([^)]*:\s*&?(?:mut\s+)?PrivateTicket\b", inc)

    def split(rows):
        return {"total": len(rows),
                "production": sum(1 for r in rows if r["verdict"] == "ПРОДУКТОВОЕ"),
                "test": sum(1 for r in rows if r["verdict"] == "ТЕСТОВОЕ")}

    rep["summary"] = {"calls": split(rep["calls"]),
                      "constructions": split(rep["private_ticket_constructions"]),
                      "consumptions": split(rep["private_ticket_consumptions"])}
    rep["production_sites"] = {
        "calls": [r for r in rep["calls"] if r["verdict"] == "ПРОДУКТОВОЕ"],
        "constructions": [r for r in rep["private_ticket_constructions"]
                          if r["verdict"] == "ПРОДУКТОВОЕ"],
        "consumptions": [r for r in rep["private_ticket_consumptions"]
                         if r["verdict"] == "ПРОДУКТОВОЕ"],
    }
    s = rep["summary"]
    rep["card_claim"] = {
        "claim": "продуктового вызывающего нет ни у `%s`, ни у `PrivateTicket`" % SUBJECT,
        "production_calls": s["calls"]["production"],
        "production_constructions": s["constructions"]["production"],
        "production_consumptions": s["consumptions"]["production"],
        "verdict": None,
    }
    cc = rep["card_claim"]
    cc["verdict"] = ("ДЕРЖИТСЯ: продуктовых вызывающих 0"
                     if cc["production_calls"] == 0 else
                     "ОПРОВЕРГНУТО: продуктовых вызовов %d — см. production_sites.calls"
                     % cc["production_calls"])

    # ---- КАЛИБРОВКА НА РЕАЛЬНОМ ДЕРЕВЕ, ожидания выведены НЕЗАВИСИМО ----------
    cal = {}
    lf = os.path.join(SRC, "native_lifecycle.rs")
    if os.path.isfile(lf):
        with open(lf, encoding="utf-8", errors="replace") as fh:
            ll = fh.readlines()
        boundary = None
        for i, line in enumerate(ll):
            if re.match(r"^\s*mod\s+\w+\s*\{", line) and any(
                    cfg_gates_test(a) for a in attrs_above(ll, i)):
                boundary = i + 1
                break
        rows = [r for r in rep["calls"] if r["file"] == "src-tauri/src/native_lifecycle.rs"]
        agree = [r for r in rows
                 if (r["verdict"] == "ТЕСТОВОЕ") == (boundary is not None
                                                     and r["line"] > boundary)]
        cal["real_tree_boundary"] = {
            "file": "src-tauri/src/native_lifecycle.rs",
            "test_module_opens_at_line": boundary,
            "independent_rule": "строка > границы тестового модуля => ТЕСТОВОЕ",
            "call_sites_in_file": len(rows),
            "agree_with_independent_rule": len(agree),
            "disagree": [r for r in rows if r not in agree][:5],
        }
    cmds = scan(files, r"#\[tauri::command\]", inc)
    cal["known_production_needle"] = {
        "needle": "#[tauri::command]", "total": len(cmds),
        "classified_production": sum(1 for r in cmds if r["verdict"] == "ПРОДУКТОВОЕ"),
        "classified_test": sum(1 for r in cmds if r["verdict"] == "ТЕСТОВОЕ")}
    rep["calibration_on_real_tree"] = cal
    rep["read_failures"] = FAIL

    os.makedirs(OUT, exist_ok=True)
    raw = os.path.join(OUT, "measure-930-sB2-raw.json")
    with open(raw, "w", encoding="utf-8") as fh:
        json.dump(rep, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print("RAW %s" % raw)
    print("sha256 %s" % sha256_file(raw))
    print("сводка %s" % json.dumps(rep["summary"], ensure_ascii=False))
    print("вердикт: %s" % cc["verdict"])

    # ---- ВОРОТА ---------------------------------------------------------------
    if FAIL:
        print("ОТКАЗ: нечитаемые файлы", file=sys.stderr)
        return 3
    if not defs:
        print("ОТКАЗ: определение `fn %s` не найдено — субъект не тот" % SUBJECT,
              file=sys.stderr)
        return 3
    k = cal["known_production_needle"]
    if k["total"] == 0 or k["classified_test"] != 0:
        print("ОТКАЗ: продуктовый контроль негоден (всего %d, названо тестовыми %d)"
              % (k["total"], k["classified_test"]), file=sys.stderr)
        return 3
    b = cal.get("real_tree_boundary") or {}
    if b.get("test_module_opens_at_line") is None:
        print("ОТКАЗ: в native_lifecycle.rs не найден тестовый модуль по РАЗБОРУ cfg — "
              "именно его пропустил прошлый прибор, значит контроль не задействован",
              file=sys.stderr)
        return 3
    if b["call_sites_in_file"] and b["agree_with_independent_rule"] != b["call_sites_in_file"]:
        print("ОТКАЗ: классификатор расходится с НЕЗАВИСИМЫМ правилом границы на %d из "
              "%d мест реального файла"
              % (b["call_sites_in_file"] - b["agree_with_independent_rule"],
                 b["call_sites_in_file"]), file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
