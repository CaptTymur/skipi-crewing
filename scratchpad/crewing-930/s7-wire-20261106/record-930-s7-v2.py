#!/usr/bin/env python3
"""Сборка записи замера из ИЗМЕРЕННОГО JSON — ни одно число не набирается рукой.

Выдаёт:
  MEASURE-930-s7-wire.md  — запись в ОБЯЗАТЕЛЬНОЙ ФОРМЕ карточки: ДВА СПИСКА
                            (что проверяет КОД / что подтвердил СТЕНД), второй
                            пуст и сказано, почему именно пуст.
  дописывает WORKLOG.md   — только дописывает; пред-образ остаётся байтовым
                            префиксом пост-образа, это проверяет драйвер.

Четыре ответа выводятся МЕХАНИЧЕСКИ из замера, а не пишутся прозой: если замер
не даёт ответа, в записи стоит UNKNOWN с названной причиной, а не догадка.
"""
import hashlib
import io
import json
import os
import re
import sys

OUT = os.environ["OUT"]
WL = os.environ["WORKLOG"]
RAW = os.path.join(OUT, "measure-930-s7-raw.json")

d = json.load(io.open(RAW, encoding="utf-8"))
n = d["needles"]
shape = d["response_shape"]


def occ(k):
    return n[k]["occurrences"]


def where(k, limit=8):
    seen, rows = set(), []
    for h in n[k]["hits"]:
        key = (h["file"], h["line"])
        if key in seen:
            continue
        seen.add(key)
        rows.append("`%s:%d`" % (h["file"], h["line"]))
        if len(rows) >= limit:
            break
    extra = n[k]["occurrences"] - len(rows)
    return ", ".join(rows) + (" (+%d ещё)" % extra if extra > 0 else "")


# ---- Q1: полный URL ----------------------------------------------------------
origins = sorted({h["match"] for h in n["host_literal"]["hits"]})
paths = sorted({h["match"] for h in n["prefix_api_app"]["hits"]})
q1 = ("хост-литерал(ы): %s; путевые литералы: %s" % (
    ", ".join("`%s`" % x for x in origins) or "НЕ НАЙДЕНО",
    ", ".join("`%s`" % x for x in paths) or "НЕ НАЙДЕНО"))

# ---- Q2: имя поля идентификатора рабочего места -------------------------------
idfields = []


def walk(node, path=""):
    if not node or not node.get("found"):
        return
    for f in node.get("fields", []):
        here = (path + "." + f["name"]).lstrip(".")
        if re.search(r"(crewing|workspace|organization|workplace)_id", f["name"]):
            idfields.append({"path": here, "type": f["type"],
                             "optional": f["optional"], "attrs": f["attrs"],
                             "in_struct": node["name"],
                             "at": "%s:%d" % (node["file"], node["decl_line"])})
    for k, sub in node.get("nested", {}).items():
        walk(sub, (path + "." + k).lstrip("."))


walk(shape)
q2 = ("; ".join("`%s` (%s, в `%s`, %s%s)" % (
    f["path"], f["type"], f["in_struct"], f["at"],
    ", аттрибуты: " + " ".join(f["attrs"]) if f["attrs"] else "") for f in idfields)
      or "UNKNOWN — ни одно поле структуры ответа не названо по образцу "
         "(crewing|workspace|organization|workplace)_id")

# ---- Q3: плоская форма или вложенная -----------------------------------------
nested_required = []
for f in shape.get("fields", []):
    # `nested` ключуется ИМЕНЕМ ПОЛЯ, а не именем типа: сверка по типу
    # давала ложное «форма плоская» при явно вложенной структуре
    if f["name"] in shape.get("nested", {}):
        nested_required.append(f)
flatten_count = occ("serde_flatten")
alias_count = occ("serde_alias")
if nested_required:
    q3 = ("ВЛОЖЕННУЮ. Десериализатор требует поля-структуры: %s. "
          "`#[serde(flatten)]` в наборе замера: %d вхождений; `#[serde(alias` : %d. "
          "Плоские семь ключей в такую структуру НЕ укладываются — это свойство "
          "типа, а не строгости проверок." % (
              ", ".join("`%s: %s`%s" % (f["name"], f["type"],
                                        " (Option — необязательно)" if f["optional"] else "")
                        for f in nested_required),
              flatten_count, alias_count))
else:
    q3 = ("ПЛОСКУЮ: ни одно поле `%s` не является локальной структурой "
          "(вложенных типов не найдено)." % shape.get("name"))

# ---- Q4: откуда берётся префикс ----------------------------------------------
consts = [h for h in d["url_assembly"]["str_consts"]
          if "skipi" in h["text"] or "api" in h["text"]]
q4_parts = []
if occ("const_account_origin"):
    q4_parts.append("константа `ACCOUNT_ORIGIN` — %s" % where("const_account_origin", 4))
if consts:
    q4_parts.append("строковые константы адреса: " + ", ".join(
        "`%s:%d` %s" % (c["file"], c["line"], c["text"][:90]) for c in consts[:4]))
q4_parts.append("перекрытие средой: `env!/option_env!` %d вхождений, "
                "`env::var` %d вхождений" % (occ("env_override_macro"),
                                             occ("env_override_runtime")))
q4 = "; ".join(q4_parts)

# ---- запись ------------------------------------------------------------------
zero_rows = []
for k, e in n.items():
    if e.get("expectation_declared") == "0":
        c = e.get("control") or {}
        zero_rows.append("| `%s` | %d | `%s` = %s | %s |" % (
            e["pattern"], e["occurrences"], c.get("needle"), c.get("occurrences"),
            e.get("verdict", "")))

md = []
md.append("# ЗАМЕР ПО КОДУ — вторая ступень входа: адрес и форма (No.930, стадия 2)\n")
md.append("Замерено %s. Слой: **%s**\n" % (d["measured_at_utc"], d["layer"]))
md.append("Базис: `%s` — живой main ПО МОЕМУ `ls-remote`, снятому ДО стадии; это мой "
          "REPORT, а не заверенный гейтом факт: сетевых действий не делают ни стадия, "
          "ни координатор. В стадии базис проверен ЛОКАЛЬНО — объект есть в "
          "репозитории, и субъект замера байт-в-байт равен `git show <базис>:<файл>`. "
          "В наборе замера файлов: %d (весь `src-tauri/src`, фронтенд "
          "`dist/index.html`, конфигурация сборки).\n"
          % (d["base_sha_live_main"], d["scan_set"]["count"]))
md.append("Суммы субъектов на момент замера:\n")
for rel, sha in d["subject_digests"].items():
    md.append("- `%s` — `%s`" % (rel, sha))
md.append("")

md.append("## СПИСОК 1 — ЧТО ПРОВЕРЯЕТ И ДЕЛАЕТ КОД\n")
md.append("**Q1. Полный URL второй ступени.** %s\n" % q1)
md.append("Места путевых литералов: %s\n" % where("prefix_api_app", 10))
md.append("**Q2. Поле, разбираемое как идентификатор рабочего места.** %s\n" % q2)
md.append("**Q3. Плоская форма или вложенная.** %s\n" % q3)
md.append("**Q4. Откуда берётся префикс.** %s\n" % q4)

md.append("### Форма ответа, как её ТРЕБУЕТ десериализатор\n")


def render(node, depth=0):
    if not node or not node.get("found"):
        md.append("%s- `%s` — НЕ НАЙДЕНА" % ("  " * depth, (node or {}).get("name")))
        return
    md.append("%s- **`%s`** (`%s:%d`), контейнерные аттрибуты: %s" % (
        "  " * depth, node["name"], node["file"], node["decl_line"],
        " ".join("`%s`" % a for a in node["container_attrs"]) or "нет"))
    for f in node["fields"]:
        md.append("%s  - `%s: %s`%s%s" % (
            "  " * depth, f["name"], f["type"],
            " — Option" if f["optional"] else "",
            " " + " ".join("`%s`" % a for a in f["attrs"]) if f["attrs"] else ""))
    for k, sub in node["nested"].items():
        md.append("%s  вложено в поле `%s`:" % ("  " * depth, k))
        render(sub, depth + 2)


render(shape)
md.append("")

md.append("### Ожидания НОЛЯ и их положительные контроли\n")
md.append("| игла | вхождений | контроль | вердикт |")
md.append("|---|---|---|---|")
md.extend(zero_rows)
md.append("\nНоль без живого контроля записью не является: прибор в этом случае "
          "отказывает (rc 3), а не докладывает ноль. Калибровка трёх арм — "
          "`calibration-930-s7.md`.\n")

md.append("## СПИСОК 2 — ЧТО ПОДТВЕРДИЛ СТЕНД\n")
md.append("**ПУСТО, и это не пропуск.** Стенда в этой стадии нет, живых запросов нет "
          "ни одного: разрешение владельца на один немутирующий запрос израсходовано "
          "05.11, повтор требует нового слова. Стенд 04.11 в этот список не "
          "переносится — карточка измерила, что он был **зеркалом**: заглушка отвечала "
          "В ФОРМЕ КЛИЕНТА, поэтому девять проверок `BootstrapResponse::validate` "
          "ни разу не встречались с настоящим ответом сервера.\n")
md.append("Следствие для чтения этой записи: всё выше — **свойства клиентского кода**. "
          "Ни одна строка не утверждает, что боевой сервер отвечает так или иначе; "
          "расхождение с сервером (№956 BLOCKER) закрывается решением владельца об "
          "адресе, а не этим замером.\n")

body = "\n".join(md) + "\n"
rec = os.path.join(OUT, "MEASURE-930-s7-wire.md")
io.open(rec, "w", encoding="utf-8").write(body)
print("RECORD %s" % rec)
print("sha256 %s" % hashlib.sha256(body.encode("utf-8")).hexdigest())

# ---- дописывание WORKLOG (только append) -------------------------------------
wl_add = []
wl_add.append("\n---\n")
wl_add.append("## СТАДИЯ 2, первый шаг — ЗАМЕР ПО КОДУ адреса и формы второй ступени "
              "(%s)\n" % d["measured_at_utc"])
wl_add.append("Запись замера: `%s` (две списка, второй пуст и объяснён)." % os.path.relpath(rec, os.path.dirname(WL)))
wl_add.append("Сырой JSON: `%s`.\n" % os.path.relpath(RAW, os.path.dirname(WL)))
wl_add.append("- **Q1 URL:** %s" % q1)
wl_add.append("- **Q2 поле рабочего места:** %s" % q2)
wl_add.append("- **Q3 форма:** %s" % q3)
wl_add.append("- **Q4 происхождение префикса:** %s" % q4)
wl_add.append("\n**Слой:** найдено в клиентском коде на базисе `%s` (живой main по моему "
              "ls-remote ДО стадии, в стадии проверен локально); "
              "против боевого сервера НЕ проверено ни раз. Стенд в стадии не "
              "поднимался, живых запросов нет.\n" % d["base_sha_live_main"])
io.open(WL, "a", encoding="utf-8").write("\n".join(wl_add) + "\n")
print("WORKLOG дописан: %s" % WL)
sys.exit(0)
