#!/usr/bin/env python3
"""ЗАМЕР ПО КОДУ, слайс B (No.930): кто в ПРОДЕ должен звать `ticket` и что
потребляет `PrivateTicket`.

Карточка утверждает (замер 05.11), что продуктового вызывающего нет НИ У ОДНОГО
из них. Этот прибор обязан такое утверждение либо подтвердить ЗАМЕРОМ с живым
контролем, либо опровергнуть — «ноль вызывающих» без контроля ничем не лучше
слепого зонда.

Отвечает на:
  B1  все определения и места употребления `ticket` — и ПРОДУКТОВОЕ ли каждое;
  B2  где `PrivateTicket` конструируется и где потребляется, где цепочка рвётся;
  B3  что фактически переводит сессию в `'active'` — цепочка от входа до состояния;
  B4  контроли: прибор обязан уметь отличать продуктовое место от тестового.

КЛЮЧЕВОЕ РАЗЛИЧЕНИЕ, от которого зависит весь вывод: место считается ТЕСТОВЫМ,
если (а) его файл подключён в родителе под `#[cfg(test)]`, либо (б) оно лежит
внутри элемента с `#[cfg(test)]`/`#[test]`. Иначе — ПРОДУКТОВОЕ. Классификатор
калибруется в обе стороны на известных местах, а не принимается на веру.
"""
import hashlib
import json
import os
import re
import subprocess
import sys

W = os.environ["W"]
OUT = os.environ["OUT"]
BASE_SHA = os.environ["BASE_SHA"]
SRC = os.path.join(W, "src-tauri", "src")
FAIL = []


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for c in iter(lambda: fh.read(1 << 16), b""):
            h.update(c)
    return h.hexdigest()


def rs_files():
    out = []
    for root, _d, names in os.walk(SRC):
        for n in sorted(names):
            if n.endswith(".rs"):
                out.append(os.path.join(root, n))
    return sorted(out)


# ---- шаг 1: какие ФАЙЛЫ подключены под cfg(test) -----------------------------
MOD_RX = re.compile(r"^\s*(#\[cfg\(test\)\]\s*)?(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;")


def test_only_modules():
    """Модули, объявленные в родителе под #[cfg(test)]. Возвращает имя -> (файл, строка)."""
    marked, plain = {}, {}
    for path in rs_files():
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()
        for i, line in enumerate(lines):
            m = re.match(r"^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;", line)
            if not m:
                continue
            name = m.group(1)
            prev = lines[i - 1].strip() if i else ""
            same = line.strip()
            is_test = ("#[cfg(test)]" in prev) or same.startswith("#[cfg(test)]")
            (marked if is_test else plain)[name] = {
                "declared_in": os.path.relpath(path, W), "line": i + 1,
                "attr_line": prev if is_test else None,
            }
    return marked, plain


ITEM_RX = re.compile(r"^(\s*)(?:pub(?:\([^)]*\))?\s+)?"
                     r"(?:async\s+)?(fn|mod|impl|struct|enum)\s+(\w+)?")


def _attrs_above(lines, j):
    attrs, k = [], j - 1
    while k >= 0 and (lines[k].lstrip().startswith("#[")
                      or lines[k].lstrip().startswith("//")):
        if lines[k].lstrip().startswith("#["):
            attrs.append(lines[k].strip())
        k -= 1
    return attrs


def enclosing_context(lines, idx):
    """ВСЯ цепочка объемлющих элементов и её тестовость.

    Допущение названо прямо: ОТСТУП следует вложенности (так форматирует rustfmt).
    Скобки не разбираются вовсе — поэтому ошибка нарезчиков этого дома (скобки внутри
    строк и комментариев) здесь невозможна по построению; взамен есть своё допущение,
    против которого стоит второй прибор.

    Тестовым место считается, если cfg(test)/#[test] несёт ЛЮБОЙ предок, а не только
    ближайший: встроенный `#[cfg(test)] mod inner { fn helper() { … } }` иначе читался
    бы как продуктовый (найдено армом F)."""
    base_indent = len(lines[idx]) - len(lines[idx].lstrip())
    chain, nearest, limit = [], None, base_indent
    for j in range(idx, -1, -1):
        m = ITEM_RX.match(lines[j])
        if not m:
            continue
        indent = len(m.group(1))
        if j != idx and indent > limit:
            continue
        attrs = _attrs_above(lines, j)
        node = {"kind": m.group(2), "name": m.group(3), "line": j + 1,
                "attrs": attrs[:4],
                "self_is_test": any("cfg(test)" in x or x.startswith("#[test]")
                                    for x in attrs)}
        chain.append(node)
        if nearest is None:
            nearest = node
        if indent == 0:
            break
        limit = indent - 1
    if nearest is None:
        return {"kind": None, "name": None, "line": None, "attrs": [],
                "is_test_item": False, "ancestors": []}
    return {"kind": nearest["kind"], "name": nearest["name"], "line": nearest["line"],
            "attrs": nearest["attrs"],
            "is_test_item": any(n["self_is_test"] for n in chain),
            "test_owed_to": next((("%s %s @%d" % (n["kind"], n["name"], n["line"]))
                                  for n in chain if n["self_is_test"]), None),
            "ancestors": [("%s %s @%d" % (n["kind"], n["name"], n["line"]))
                          for n in chain[1:]][:4]}


def classify(files, pattern, test_mods):
    """Места употребления с классификацией ПРОДУКТОВОЕ/ТЕСТОВОЕ."""
    rx = re.compile(pattern)
    rows = []
    for path in files:
        rel = os.path.relpath(path, W)
        stem = os.path.splitext(os.path.basename(path))[0]
        file_is_test_only = stem in test_mods
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                lines = fh.readlines()
        except OSError as exc:
            FAIL.append("%s: %s" % (rel, exc))
            continue
        for i, line in enumerate(lines):
            if not rx.search(line):
                continue
            ctx = enclosing_context(lines, i)
            is_prod = not (file_is_test_only or ctx["is_test_item"])
            rows.append({
                "file": rel, "line": i + 1, "text": line.strip()[:200],
                "enclosing": ctx,
                "file_is_test_only": file_is_test_only,
                "verdict": "ПРОДУКТОВОЕ" if is_prod else "ТЕСТОВОЕ",
            })
    return rows


def main():
    files = rs_files()
    test_mods, prod_mods = test_only_modules()

    report = {
        "measured_at_utc": subprocess.run(["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"],
                                          capture_output=True, text=True,
                                          check=True).stdout.strip(),
        "layer": "НАЙДЕНО В КЛИЕНТСКОМ КОДЕ (чтение названного SHA). Не «проверено в работе».",
        "base_sha": BASE_SHA,
        "scan_files": len(files),
        "modules_declared_cfg_test": test_mods,
        "modules_declared_plain_count": len(prod_mods),
    }

    # ---- B1: ticket ----------------------------------------------------------
    report["B1_ticket"] = {
        "definitions": classify(files, r"\bfn\s+ticket\b|\bfn\s+\w*_ticket\b", test_mods),
        "mentions": classify(files, r"\bticket\b", test_mods),
    }
    # ---- B2: PrivateTicket --------------------------------------------------
    report["B2_private_ticket"] = {
        "type_decl": classify(files, r"(struct|enum|type)\s+PrivateTicket\b", test_mods),
        "mentions": classify(files, r"\bPrivateTicket\b", test_mods),
    }
    # ---- B3: что переводит в 'active' ---------------------------------------
    report["B3_active"] = {
        "active_literal": classify(files, r"'active'|\"active\"", test_mods),
        "session_state": classify(files, r"account_session_state|session_state", test_mods),
        "native_authorized_assign": classify(files, r"native_authorized\s*=", test_mods),
        "mode_fn": classify(files, r"NativeLocked|NativeUnlocked|fn\s+mode\b", test_mods),
    }

    # ---- КОНТРОЛИ классификатора, в обе стороны ------------------------------
    controls = {}
    # (а) заведомо ТЕСТОВОЕ: место внутри файла, объявленного под cfg(test)
    tagged_test = [r for r in report["B1_ticket"]["mentions"] + report["B2_private_ticket"]["mentions"]
                   if r["verdict"] == "ТЕСТОВОЕ"]
    # (б) заведомо ПРОДУКТОВОЕ: #[tauri::command] — вход из UI, тестом быть не может
    cmd_sites = classify(files, r"#\[tauri::command\]", test_mods)
    controls["known_production_needle"] = {
        "needle": "#[tauri::command]",
        "total": len(cmd_sites),
        "classified_production": sum(1 for r in cmd_sites if r["verdict"] == "ПРОДУКТОВОЕ"),
        "classified_test": sum(1 for r in cmd_sites if r["verdict"] == "ТЕСТОВОЕ"),
    }
    cfg_test_lines = classify(files, r"#\[cfg\(test\)\]", test_mods)
    # НЕЗАВИСИМЫЙ от предмета контроль тестовой стороны: тело функции под `#[test]`
    # ОБЯЗАНО классифицироваться как ТЕСТОВОЕ. Пробуем строку через две после самого
    # атрибута (атрибут -> `fn ...` -> тело). Это свойство классификатора, а не моих игл.
    probes = []
    for path in files:
        rel = os.path.relpath(path, W)
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()
        for i, line in enumerate(lines):
            if "#[test]" not in line:
                continue
            # ищем строку с объявлением функции, затем пробуем ЕЁ саму: место внутри
            # `fn` под `#[test]` обязано быть тестовым, где бы тело ни начиналось
            j = None
            if re.search(r"\bfn\s+\w+", line):      # атрибут и fn на одной строке
                j = i
            else:
                for k in range(i + 1, min(i + 6, len(lines))):
                    if re.search(r"\bfn\s+\w+", lines[k]):
                        j = k
                        break
            if j is None:
                continue
            ctx = enclosing_context(lines, j)
            probes.append({"file": rel, "attr_line": i + 1, "probed_line": j + 1,
                           "probe_kind": "строка объявления fn под #[test]",
                           "classified": "ТЕСТОВОЕ" if (ctx["is_test_item"]
                                or os.path.splitext(os.path.basename(path))[0] in test_mods)
                                else "ПРОДУКТОВОЕ",
                           "test_owed_to": ctx.get("test_owed_to")})
    bad_probes = [p_ for p_ in probes if p_["classified"] != "ТЕСТОВОЕ"]
    controls["known_test_needle"] = {
        "needle": "тело функции под `#[test]` обязано классифицироваться ТЕСТОВЫМ",
        "probes": len(probes),
        "probes_misclassified_as_production": len(bad_probes),
        "misclassified_examples": bad_probes[:5],
        "sites_classified_test_among_my_needles": len(tagged_test),
        "test_modules_file_level": len(test_mods),
        "cfg_test_attr_lines": len(cfg_test_lines),
        "note": ("контроль НЕ зависит от моих игл. Две прежние версии были негодны: "
                 "первая спрашивала ПРОКСИ (число файловых cfg(test)-модулей) и давала "
                 "ложный отказ на дереве со встроенными модулями (арм F); вторая "
                 "требовала, чтобы хоть одно место МОИХ игл попало в тест — и отказала "
                 "бы ровно тогда, когда все места продуктовые, то есть на законном "
                 "исходе, ОПРОВЕРГАЮЩЕМ утверждение карточки"),
    }
    # ---- ВТОРОЙ ПРИБОР на тот же объект, без общей машинерии -----------------
    # Допущение первого прибора названо прямо: `enclosing_context` считает, что ОТСТУП
    # следует вложенности (так форматирует rustfmt), и НЕ разбирает скобки вовсе —
    # поэтому ошибка нарезчиков этого дома (скобки внутри строк и комментариев) ему не
    # грозит. Но своё допущение он имеет, и против него нужен контроль.
    # Метод 2: чистый счёт строк-атрибутов `#[test]` — ни отступов, ни скобок, ни
    # структуры. Если число функций, которые метод 1 назвал тестовыми ПО АТРИБУТУ
    # `#[test]`, не равно числу таких атрибутов в файле, значит метод 1 приписал
    # место не тому элементу.
    per_file_attr = {}
    for path in files:
        rel = os.path.relpath(path, W)
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            per_file_attr[rel] = sum(1 for l in fh if l.strip() == "#[test]")
    all_rows = (report["B1_ticket"]["mentions"] + report["B2_private_ticket"]["mentions"]
                + report["B3_active"]["active_literal"] + report["B3_active"]["session_state"])
    seen_items, per_file_walker = set(), {}
    for r in all_rows:
        enc = r["enclosing"]
        if not any(x.startswith("#[test]") for x in enc.get("attrs", [])):
            continue
        key = (r["file"], enc.get("line"))
        if key in seen_items:
            continue
        seen_items.add(key)
        per_file_walker[r["file"]] = per_file_walker.get(r["file"], 0) + 1
    disagreements = {f: {"walker_test_items_seen": n,
                         "attr_lines_in_file": per_file_attr.get(f, 0)}
                     for f, n in per_file_walker.items()
                     if n > per_file_attr.get(f, 0)}
    controls["second_instrument_attr_vs_walker"] = {
        "method_1": "обход вверх по отступу (enclosing_context) — допущение: отступ "
                    "следует вложенности; скобки НЕ разбираются вовсе",
        "method_2": "счёт строк, равных ровно `#[test]` — ни отступов, ни скобок",
        "files_where_walker_claims_MORE_test_items_than_attrs_exist": disagreements,
        "verdict": ("согласие: обход не приписал тестовость там, где атрибутов нет"
                    if not disagreements else
                    "РАСХОЖДЕНИЕ: обход насчитал больше тестовых элементов, чем есть "
                    "атрибутов `#[test]` — он приписывает места не тем элементам"),
        "total_test_attr_lines": sum(per_file_attr.values()),
        "files_with_test_attrs": sum(1 for v in per_file_attr.values() if v),
    }
    report["classifier_controls"] = controls

    report["subject_digests"] = {
        os.path.relpath(p, W): sha256_file(p) for p in files
        if os.path.basename(p) in ("native_lifecycle.rs", "native_local_commit.rs",
                                   "native_account.rs", "lib.rs")
    }
    report["read_failures"] = FAIL

    # ---- сводка, выведенная из замера, а не написанная рукой -----------------
    def counts(rows):
        return {"total": len(rows),
                "production": sum(1 for r in rows if r["verdict"] == "ПРОДУКТОВОЕ"),
                "test": sum(1 for r in rows if r["verdict"] == "ТЕСТОВОЕ")}
    def callers(mentions, definitions, decls=()):
        """ВЫЗЫВАЮЩИЕ = продуктовые упоминания МИНУС строки самого определения/объявления.
        Без этого вычитания «продуктовых упоминаний 1» читается как «вызывающий есть»,
        хотя этой единицей может быть сама декларация — ровно это показал арм B."""
        own = {(r["file"], r["line"]) for r in list(definitions) + list(decls)}
        rows = [r for r in mentions
                if r["verdict"] == "ПРОДУКТОВОЕ" and (r["file"], r["line"]) not in own]
        return {"count": len(rows),
                "sites": [{"file": r["file"], "line": r["line"],
                           "enclosing": r["enclosing"].get("name"),
                           "kind": r["enclosing"].get("kind"),
                           "text": r["text"]} for r in rows[:20]]}

    _decl_rx = re.compile(r"\b(?:struct|enum|type)\s+PrivateTicket\b")
    report["B2_private_ticket"]["constructions"] = [
        r for r in classify(files,
            r"PrivateTicket\s*\{|PrivateTicket::new\b|PrivateTicket::from\b", test_mods)
        # объявление типа — НЕ конструкция: `pub struct PrivateTicket {` матчит ту же
        # иглу, и без этого фильтра арм E давал конструкцию там, где её нет (найдено
        # калибровкой, не чтением)
        if not _decl_rx.search(r["text"])]
    report["B2_private_ticket"]["consumptions"] = classify(
        files, r"fn\s+\w+\s*\([^)]*:\s*&?(?:mut\s+)?PrivateTicket\b|"
               r"match\s+\w+\s*\{[^}]*PrivateTicket", test_mods)

    def prod(rows):
        return [r for r in rows if r["verdict"] == "ПРОДУКТОВОЕ"]

    report["production_callers"] = {
        "ticket": callers(report["B1_ticket"]["mentions"], report["B1_ticket"]["definitions"]),
        "private_ticket_constructions": {
            "count": len(prod(report["B2_private_ticket"]["constructions"])),
            "sites": [{"file": r["file"], "line": r["line"],
                       "enclosing": r["enclosing"].get("name"), "text": r["text"]}
                      for r in prod(report["B2_private_ticket"]["constructions"])[:20]]},
        "private_ticket_consumptions": {
            "count": len(prod(report["B2_private_ticket"]["consumptions"])),
            "sites": [{"file": r["file"], "line": r["line"],
                       "enclosing": r["enclosing"].get("name"), "text": r["text"]}
                      for r in prod(report["B2_private_ticket"]["consumptions"])[:20]]},
        "note": ("у ТИПА нет «вызывающих»: считаются КОНСТРУКЦИИ и ПОТРЕБЛЕНИЯ. "
                 "Упоминание в возвращаемом типе не является ни тем, ни другим, и "
                 "включать его значило бы отвечать не на тот вопрос."),
    }
    cc = {
        "claim": "ни у `ticket`, ни у `PrivateTicket` нет ПРОДУКТОВОГО вызывающего (замер 05.11)",
        "ticket_production_callers": report["production_callers"]["ticket"]["count"],
        "private_ticket_production_constructions":
            report["production_callers"]["private_ticket_constructions"]["count"],
        "private_ticket_production_consumptions":
            report["production_callers"]["private_ticket_consumptions"]["count"],
    }
    # вердикт ПО КАЖДОЙ ПОЛОВИНЕ ОТДЕЛЬНО: общий «да/нет» скрывает, какая из них
    # опровергнута, а в арме B это ровно то, что ввело бы в заблуждение
    cc["verdict_ticket"] = ("вызывающих в проде НЕТ" if cc["ticket_production_callers"] == 0
                            else "вызывающие в проде ЕСТЬ: %d" % cc["ticket_production_callers"])
    cc["verdict_private_ticket"] = (
        "в проде не конструируется и не потребляется"
        if cc["private_ticket_production_constructions"] == 0
        and cc["private_ticket_production_consumptions"] == 0
        else "в проде есть: конструкций %d, потреблений %d" % (
            cc["private_ticket_production_constructions"],
            cc["private_ticket_production_consumptions"]))
    cc["claim_holds_in_full"] = (cc["ticket_production_callers"] == 0
        and cc["private_ticket_production_constructions"] == 0
        and cc["private_ticket_production_consumptions"] == 0)
    report["card_claim_under_test"] = cc
    report["summary"] = {
        "ticket_mentions": counts(report["B1_ticket"]["mentions"]),
        "ticket_definitions": counts(report["B1_ticket"]["definitions"]),
        "private_ticket_mentions": counts(report["B2_private_ticket"]["mentions"]),
        "private_ticket_type_decl": counts(report["B2_private_ticket"]["type_decl"]),
        "native_authorized_assign": counts(report["B3_active"]["native_authorized_assign"]),
    }

    os.makedirs(OUT, exist_ok=True)
    raw = os.path.join(OUT, "measure-930-sB-raw.json")
    with open(raw, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print("RAW %s" % raw)
    print("sha256 %s" % sha256_file(raw))
    print("сводка: %s" % json.dumps(report["summary"], ensure_ascii=False))

    # ---- ВОРОТА ПРИБОРА -----------------------------------------------------
    if FAIL:
        print("ОТКАЗ: нечитаемые файлы", file=sys.stderr)
        return 3
    c = controls["known_production_needle"]
    if c["total"] == 0 or c["classified_production"] == 0:
        print("ОТКАЗ: классификатор СЛЕП в продуктовую сторону — ни одно "
              "#[tauri::command] не опознано как продуктовое", file=sys.stderr)
        return 3
    if c["classified_test"] != 0:
        print("ОТКАЗ: классификатор назвал ТЕСТОВЫМ место с #[tauri::command] "
              "(%d шт.) — это невозможно, значит он врёт" % c["classified_test"],
              file=sys.stderr)
        return 3
    si = controls["second_instrument_attr_vs_walker"]
    if si["files_where_walker_claims_MORE_test_items_than_attrs_exist"]:
        print("ОТКАЗ: второй прибор не согласен с первым — %s" % si["verdict"],
              file=sys.stderr)
        return 3

    kt = controls["known_test_needle"]
    if kt["probes_misclassified_as_production"]:
        print("ОТКАЗ: классификатор назвал ПРОДУКТОВЫМ тело функции под #[test] "
              "(%d из %d проб) — слеп в тестовую сторону: %s"
              % (kt["probes_misclassified_as_production"], kt["probes"],
                 kt["misclassified_examples"][0]), file=sys.stderr)
        return 3
    if kt["probes"] == 0:
        print("ОТКАЗ: ни одной пробы `#[test]` не построено — контроль тестовой "
              "стороны НЕ ВЫПОЛНЕН, а его молчание нельзя читать как согласие "
              "(строк cfg(test) в дереве: %d)" % kt["cfg_test_attr_lines"],
              file=sys.stderr)
        return 3

    if not report["B2_private_ticket"]["mentions"]:
        print("ОТКАЗ: `PrivateTicket` не найден вовсе — субъект замера не тот",
              file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
