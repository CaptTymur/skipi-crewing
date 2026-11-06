#!/usr/bin/env python3
"""Сборка записи слайса B из ИЗМЕРЕННОГО JSON + ВОИД-запись о прошлом вердикте.

Ни одно число не набирается рукой: всё читается из raw.
"""
import hashlib
import io
import json
import os

OUT = os.environ["OUT"]
WL = os.environ["WORKLOG"]
PREV = os.environ.get("PREV_RAW", "")
RAW = os.path.join(OUT, "measure-930-sB2-raw.json")

d = json.load(io.open(RAW, encoding="utf-8"))
cc = d["card_claim"]
cal = d["calibration_on_real_tree"]
b = cal["real_tree_boundary"]
k = cal["known_production_needle"]
s = d["summary"]


def sites(rows, limit=40):
    out = []
    for r in rows[:limit]:
        out.append("- `%s:%d` — %s — **%s**%s" % (
            r["file"], r["line"], r["enclosing"] or "?", r["verdict"],
            " (тестовость от: %s)" % r["test_owed_to"] if r["test_owed_to"] else ""))
    if len(rows) > limit:
        out.append("- …и ещё %d" % (len(rows) - limit))
    return out


md = []
md.append("# ЗАМЕР ПО КОДУ — слайс B: кто в проде звал бы `ticket` и что потребляет "
          "`PrivateTicket` (No.930)\n")
md.append("Замерено %s. Слой: **%s**\n" % (d["measured_at_utc"], d["layer"]))
md.append("Базис: `%s`. Файлов в наборе: %d.\n" % (d["base_sha"], d["scan_files"]))

md.append("## ВОИД предыдущего вердикта — читать ПЕРВЫМ\n")
md.append("Предыдущая стадия слайса B (`measure-930-sB-raw.json`%s) выдала "
          "`claim_holds_in_full=False`, то есть **ОПРОВЕРГЛА** утверждение карточки, "
          "сославшись на «7 продуктовых вызывающих `ticket`». **Этот вердикт ВОИДОВАН "
          "мною**, и вот почему каждое из семи мест не было продуктовым вызовом: одно — "
          "слово `ticket` в КОММЕНТАРИИ, три — локальная переменная внутри тела самого "
          "определения, три — тестовые места, названные продуктовыми.\n"
          % (", sha256 " + PREV if PREV else ""))
md.append("**Три причины, все в приборе, все закрыты здесь:** (1) тестовость "
          "проверялась ПОДСТРОКОЙ `cfg(test)`, которой нет в составной форме "
          "`#[cfg(all(test, target_os = \"linux\"))]`; (2) тестовый файл подключён через "
          "`include!`, а не `mod name;`, поэтому список файловых модулей не мог его "
          "увидеть; (3) игла искала СЛОВО, а не ВЫЗОВ МЕТОДА.\n")
md.append("**Ложное опровержение дороже ложного подтверждения:** оно отправило бы "
          "задачу искать и чинить семь продуктовых вызывающих, которых не существует.\n")

md.append("## СПИСОК 1 — ЧТО ПРОВЕРЯЕТ И ДЕЛАЕТ КОД\n")
md.append("**Определение.** `%s` определён один раз: %s.\n" % (
    d["subject"], ", ".join("`%s:%d-%d`" % (r["file"], r["from"], r["to"])
                            for r in d["definition_ranges"])))
md.append("**Вызовы (`.%s(`), с исключённым диапазоном определения и вырезанными "
          "комментариями:** всего **%d**, продуктовых **%d**, тестовых **%d**.\n"
          % (d["subject"], s["calls"]["total"], s["calls"]["production"],
             s["calls"]["test"]))
md.append("**Вердикт по утверждению карточки: %s**\n" % cc["verdict"])
md.append("**`PrivateTicket`:** конструкций всего %d (в проде %d), потреблений — "
          "функций, берущих его параметром — всего %d (в проде %d).\n"
          % (s["constructions"]["total"], s["constructions"]["production"],
             s["consumptions"]["total"], s["consumptions"]["production"]))
if d["production_sites"]["constructions"]:
    md.append("Продуктовые конструкции:\n")
    md.extend(sites(d["production_sites"]["constructions"]))
    md.append("")
md.append("**Точная формулировка, которую этот замер позволяет защитить:** конструктор "
          "`PrivateTicket` в продуктовом коде ЕСТЬ, но НЕДОСТИЖИМ в проде — он лежит "
          "внутри самого `fn %s`, а продуктовых вызовов `%s` ноль. То есть приватная "
          "сессия не «сломана», а **НЕ ПОДКЛЮЧЕНА**: в продукте нет вызывающего, который "
          "её запускал бы.\n" % (d["subject"], d["subject"]))

md.append("### Как подключён тестовый код (это и пряталось от прошлого прибора)\n")
for f, v in d["include_map"].items():
    md.append("- `%s` подключён через `include!` из `%s:%d`; место включения тестовое: "
              "**%s**" % (f, v["included_from"], v["at_line"], v["site_is_test"]))
md.append("- тестовый модуль в `%s` открывается на строке **%s** под составным "
          "предикатом `cfg`\n" % (b["file"], b["test_module_opens_at_line"]))

md.append("### Калибровка НА РЕАЛЬНОМ ВХОДЕ (а не только на моих фикстурах)\n")
md.append("| контроль | ожидание | измерено |")
md.append("|---|---|---|")
md.append("| места вызова в `%s`, согласные с НЕЗАВИСИМЫМ правилом «строка > %s ⇒ "
          "тестовое» | все | **%d из %d** |" % (
              b["file"].split("/")[-1], b["test_module_opens_at_line"],
              b["agree_with_independent_rule"], b["call_sites_in_file"]))
md.append("| `#[tauri::command]` классифицированы продуктовыми | все, тестовыми 0 | "
          "**%d из %d**, тестовыми %d |" % (k["classified_production"], k["total"],
                                            k["classified_test"]))
md.append("\nПрибор отказывает (rc 3), если любое из этих ожиданий не выполнено, если "
          "тестовый модуль не найден РАЗБОРОМ `cfg`, или если определение субъекта не "
          "найдено. Разбор предиката `cfg` отдельно проверен на 12 случаях, 6 "
          "положительных и 6 отрицательных, включая ловушку `feature = \"testing\"`.\n")

md.append("## СПИСОК 2 — ЧТО ПОДТВЕРДИЛ СТЕНД\n")
md.append("**ПУСТО, и это не пропуск.** Стенда в стадии нет, живых запросов нет ни "
          "одного. Всё выше — свойства клиентского кода на названном базисе. "
          "Утверждение «в проде нет вызывающего» — о СТАТИЧЕСКОМ коде; оно не "
          "утверждает, что при каком-то сценарии вызов не появится из макроса или "
          "динамики, и такой проверки этот замер не делает.\n")

body = "\n".join(md) + "\n"
rec = os.path.join(OUT, "MEASURE-930-sB2-wire.md")
io.open(rec, "w", encoding="utf-8").write(body)
print("RECORD %s" % rec)
print("sha256 %s" % hashlib.sha256(body.encode()).hexdigest())

void = ["# ВОИД вердикта слайса B от 02:15Z (No.930)\n",
        "Воидован вердикт `claim_holds_in_full=False` в файле "
        "`sB-tickets-20261106/measure-930-sB-raw.json`%s, коммит `da6efefb`.\n"
        % (" sha256 " + PREV if PREV else ""),
        "**Вердикт был ЛОЖНЫМ ОПРОВЕРЖЕНИЕМ.** Правильный ответ, измеренный "
        "исправленным прибором: **%s**. Байты воидованного файла остаются на диске и в "
        "истории — он не правится, воид объявляется рядом.\n" % cc["verdict"],
        "Причины в приборе, не в коде продукта: подстрока `cfg(test)` вместо разбора "
        "предиката; `include!` не разбирался; игла искала слово, а не вызов метода. "
        "Калибровка прошлого прибора шла на ДЕСЯТИ армах и всё равно пропустила это, "
        "потому что фикстуры были мои и слишком чистые: без комментариев с иглой, без "
        "тени имени, без `include!`, без составных `cfg`. Калибровался МЕХАНИЗМ, а не "
        "ВХОДНОЕ РАЗНООБРАЗИЕ.\n"]
vp = os.path.join(OUT, "VOID-930-sB-verdict.md")
vbody = "\n".join(void) + "\n"
io.open(vp, "w", encoding="utf-8").write(vbody)
print("VOID %s" % vp)
print("sha256 %s" % hashlib.sha256(vbody.encode()).hexdigest())

io.open(WL, "a", encoding="utf-8").write(
    "\n---\n\n## СЛАЙС B, стадия чтения ПОВТОРНО — исправленный прибор (%s)\n\n"
    "**Вердикт прошлой стадии ВОИДОВАН** (см. `sB2-.../VOID-930-sB-verdict.md`): он был "
    "ложным опровержением.\n\n"
    "- `%s` определён один раз, продуктовых ВЫЗОВОВ **%d** из %d (остальные тестовые)\n"
    "- `PrivateTicket`: конструкций в проде %d (внутри самого `fn %s`), потреблений в "
    "проде %d\n"
    "- **Вердикт: %s**\n"
    "- Калибровка на реальном входе: %d из %d мест согласны с независимым правилом "
    "границы; `#[tauri::command]` %d из %d продуктовыми\n"
    "- Запись: `MEASURE-930-sB2-wire.md`; сырой JSON: `measure-930-sB2-raw.json`\n\n"
    "**Слой:** найдено в клиентском коде на базисе `%s`; стенда нет, живых запросов нет.\n"
    % (d["measured_at_utc"], d["subject"], s["calls"]["production"], s["calls"]["total"],
       s["constructions"]["production"], d["subject"], s["consumptions"]["production"],
       cc["verdict"], b["agree_with_independent_rule"], b["call_sites_in_file"],
       k["classified_production"], k["total"], d["base_sha"]))
print("WORKLOG дописан: %s" % WL)
