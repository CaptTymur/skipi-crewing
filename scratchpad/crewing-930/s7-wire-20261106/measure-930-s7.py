#!/usr/bin/env python3
"""ЗАМЕР ПО КОДУ (No.930, стадия 2, первый шаг): куда и в какой форме клиент
отправляет ВТОРУЮ СТУПЕНЬ входа.

Отвечает ровно на четыре вопроса карточки
(TASKCARD-2026-11-04-crewing-930-session-activation.md, раздел
«СЛОЙ ОСНОВАНИЯ ПОНИЖЕН», абзац «СЛЕДУЮЩИЙ ШАГ СТАДИИ 2 ЗАМЕНЁН»):

  Q1  полный URL с префиксом,
  Q2  имя поля, разбираемого как идентификатор рабочего места,
  Q3  принимает ли клиент ПЛОСКУЮ форму или требует вложенную / берёт workspace_id,
  Q4  если префикс /api/app — ОТКУДА он берётся.

Слой всех выводов: НАЙДЕНО В КЛИЕНТСКОМ КОДЕ на названном SHA. Ни одного живого
запроса, ни одного стенда. Ничего не пишет в продуктовые файлы.

Правило прибора: КАЖДОЕ ожидание «ноль» несёт положительный контроль в ТОМ ЖЕ
проходе по ТОМУ ЖЕ набору файлов. Контроль, давший ноль, означает СЛЕПОЙ зонд, и
тогда скрипт падает (rc 3), а не докладывает «ноль вхождений».
"""
import hashlib
import json
import os
import re
import subprocess
import sys

W = os.environ["W"]            # рабочее дерево
OUT = os.environ["OUT"]        # каталог вывода стадии
BASE_SHA = os.environ["BASE_SHA"]  # живой main, на котором пиннуты субъекты

SRC = os.path.join(W, "src-tauri", "src")
FAIL = []


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def scan_set():
    """Набор файлов замера: весь клиентский rust, фронтенд и конфигурация сборки."""
    files = []
    for root, _dirs, names in os.walk(SRC):
        for n in sorted(names):
            if n.endswith(".rs"):
                files.append(os.path.join(root, n))
    for extra in (
        os.path.join(W, "dist", "index.html"),
        os.path.join(W, "src-tauri", "tauri.conf.json"),
        os.path.join(W, "src-tauri", "build.rs"),
        os.path.join(W, "src-tauri", "Cargo.toml"),
    ):
        if os.path.isfile(extra):
            files.append(extra)
    return sorted(set(files))


def hits(files, pattern, flags=0):
    """Список попаданий: путь, номер строки, текст. Единица — ВХОЖДЕНИЕ, не строка;
    строка с двумя вхождениями даёт две записи (класс ошибок grep -c против -o)."""
    rx = re.compile(pattern, flags)
    out = []
    for path in files:
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                for i, line in enumerate(fh, 1):
                    for m in rx.finditer(line):
                        out.append({
                            "file": os.path.relpath(path, W),
                            "line": i,
                            "match": m.group(0),
                            "text": line.strip()[:240],
                        })
        except OSError as exc:
            FAIL.append("нечитаемый файл %s: %s" % (path, exc))
    return out


NEEDLES = [
    # id,                      регексп,                                 ожидание, контроль
    ("host_literal",           r"assistant\.skipi\.app",                ">0",  None),
    ("prefix_api_app",         r"/api/app",                             ">0",  None),
    ("path_login",             r"/api/app/login",                       ">0",  None),
    ("path_bootstrap",         r"/api/app/crewing/bootstrap",           ">0",  None),
    ("path_logout",            r"/api/app/logout",                      ">0",  None),
    ("const_account_origin",   r"ACCOUNT_ORIGIN",                       ">0",  None),
    # ожидания НОЛЯ — каждое со своим положительным контролем
    ("server_internal_prefix", r"/api/internal",                        "0",   "prefix_api_app"),
    ("field_workspace_id",     r"workspace_id",                         "0",   "field_crewing_id"),
    ("field_crewing_id",       r"crewing_id",                           ">0",  None),
    ("field_device_id",        r"device_id",                            "0",   "field_crewing_id"),
    # откуда берётся адрес: перекрывается ли он средой/конфигом
    ("env_override_macro",     r"option_env!|env!\s*\(",                "?",   None),
    ("env_override_runtime",   r"std::env::var|env::var\s*\(",          "?",   None),
    # форма разбора
    ("serde_deny_unknown",     r"deny_unknown_fields",                  "?",   None),
    ("serde_rename",           r"#\[serde\(rename",                     "?",   None),
    ("serde_alias",            r"#\[serde\(alias",                      "?",   None),
    ("serde_flatten",          r"#\[serde\(flatten",                    "?",   None),
    ("deserialize_calls",      r"from_str::<|from_slice::<|serde_json::from_|\.json::<", "?", None),
]


def struct_block(files, name):
    """Блок `struct <name> { ... }` вместе с атрибутами НАД ним.
    Границей служит строка, начинающаяся с '}' в нулевой колонке."""
    rx = re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+" + re.escape(name) + r"\b")
    for path in files:
        if not path.endswith(".rs"):
            continue
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()
        for i, line in enumerate(lines):
            if not rx.match(line):
                continue
            # атрибуты над объявлением
            start = i
            while start > 0 and lines[start - 1].lstrip().startswith(("#[", "///", "//")):
                start -= 1
            end = i
            while end < len(lines) - 1 and not lines[end].startswith("}"):
                end += 1
            return {
                "file": os.path.relpath(path, W),
                "decl_line": i + 1,
                "first_line": start + 1,
                "last_line": end + 1,
                # атрибуты КОНТЕЙНЕРА — только те, что НАД объявлением:
                # всё, что внутри тела, принадлежит полям, а не структуре
                "attrs_before": [l.strip() for l in lines[start:i]
                                 if l.strip().startswith("#[")],
                "body": "".join(lines[i:end + 1]),
            }
    return None


FIELD_RX = re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?([A-Za-z_]\w*)\s*:\s*([^,]+),?\s*$")


def fields_of(body):
    """Поля структуры с их serde-атрибутами. Атрибут привязывается к СЛЕДУЮЩЕМУ полю."""
    out = []
    pending = []
    for raw in body.splitlines():
        s = raw.strip()
        if s.startswith("#["):
            pending.append(s)
            continue
        if re.match(r"^(pub(\([^)]*\))?\s+)?struct\s", s):
            pending = []          # атрибуты над объявлением — контейнерные, не полевые
            continue
        if s.startswith(("///", "//", "}", "{")) or not s:
            continue
        m = FIELD_RX.match(raw)
        if m:
            ty = m.group(2).strip()
            out.append({
                "name": m.group(1),
                "type": ty,
                "optional": ty.startswith("Option<"),
                "attrs": list(pending),
            })
            pending = []
    return out


def resolve_shape(files, root_name, depth=0, seen=None):
    """Форма ответа, как её ТРЕБУЕТ десериализатор: рекурсивно по локальным типам."""
    seen = seen or set()
    if root_name in seen or depth > 4:
        return None
    seen.add(root_name)
    blk = struct_block(files, root_name)
    if blk is None:
        return {"name": root_name, "found": False}
    flds = fields_of(blk["body"])
    node = {
        "name": root_name,
        "found": True,
        "file": blk["file"],
        "decl_line": blk["decl_line"],
        "lines": [blk["first_line"], blk["last_line"]],
        "container_attrs": blk["attrs_before"],
        "fields": flds,
        "nested": {},
    }
    for f in flds:
        inner = re.sub(r"^Option<|>$|^Vec<", "", f["type"]).strip()
        inner = inner.split("<")[0].strip()
        if re.match(r"^[A-Z]\w*$", inner) and inner not in (
                "String", "Option", "Vec", "Value", "Url", "Duration", "DateTime", "Utc"):
            sub = resolve_shape(files, inner, depth + 1, seen)
            if sub and sub.get("found"):
                node["nested"][f["name"]] = sub
    return node


def url_assembly(files):
    """Q1/Q4: где собирается URL второй ступени и из чего."""
    path_literals = hits(files, r"/api/[a-z/]*")
    str_consts = hits(files, r"(?:const|static)\s+[A-Z0-9_]+\s*:\s*&(?:'static\s+)?str\s*=\s*\"[^\"]*\"")
    assembly = hits(files, r"format!\s*\(\s*\"\{\}/api|\.join\(|push_str\s*\(")
    return {"path_literals": path_literals, "str_consts": str_consts,
            "assembly_sites": assembly}


def main():
    files = scan_set()
    report = {
        "measured_at_utc": subprocess.run(
            ["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"], capture_output=True, text=True,
            check=True).stdout.strip(),
        "layer": "НАЙДЕНО В КЛИЕНТСКОМ КОДЕ (чтение названного SHA). Не «проверено в работе».",
        "base_sha_live_main": BASE_SHA,
        "worktree": W,
        "scan_set": {
            "files": [os.path.relpath(p, W) for p in files],
            "count": len(files),
        },
        "needles": {},
        "blind_probes": [],
    }

    counts = {}
    for nid, pat, expect, _ctrl in NEEDLES:
        h = hits(files, pat)
        counts[nid] = len(h)
        report["needles"][nid] = {
            "pattern": pat,
            "expectation_declared": expect,
            "occurrences": len(h),
            "lines": len({(x["file"], x["line"]) for x in h}),
            "hits": h[:40],
            "hits_truncated": max(0, len(h) - 40),
        }

    # положительные контроли для каждого ожидания «ноль»
    for nid, _pat, expect, ctrl in NEEDLES:
        if expect != "0":
            continue
        got = counts[nid]
        cval = counts.get(ctrl, 0) if ctrl else None
        report["needles"][nid]["control"] = {"needle": ctrl, "occurrences": cval}
        if ctrl and not cval:
            report["blind_probes"].append(
                "зонд %s СЛЕПОЙ: контроль %s дал 0 на том же наборе файлов" % (nid, ctrl))
        report["needles"][nid]["verdict"] = (
            "ноль ПОДТВЕРЖДЁН контролем" if (got == 0 and cval) else
            "НЕ ноль: %d вхождений" % got if got else "ноль БЕЗ контроля — не принимать")

    report["response_shape"] = resolve_shape(files, "BootstrapResponse")
    report["url_assembly"] = url_assembly(files)

    report["subject_digests"] = {
        rel: sha256_file(os.path.join(W, rel))
        for rel in ("src-tauri/src/native_account.rs",
                    "src-tauri/src/native_lifecycle.rs",
                    "src-tauri/src/native_local_commit.rs")
        if os.path.isfile(os.path.join(W, rel))
    }
    report["read_failures"] = FAIL

    os.makedirs(OUT, exist_ok=True)
    raw = os.path.join(OUT, "measure-930-s7-raw.json")
    with open(raw, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1, sort_keys=False)
        fh.write("\n")
    print("RAW %s" % raw)
    print("sha256 %s" % sha256_file(raw))

    if FAIL:
        print("ОТКАЗ: нечитаемые файлы в наборе замера", file=sys.stderr)
        return 3
    if report["blind_probes"]:
        for b in report["blind_probes"]:
            print("ОТКАЗ: %s" % b, file=sys.stderr)
        return 3
    if not report["response_shape"] or not report["response_shape"].get("found"):
        print("ОТКАЗ: структура BootstrapResponse не найдена — субъект замера не тот",
              file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
