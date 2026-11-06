#!/usr/bin/env python3
"""РАЗБОР предиката `cfg`, а не поиск подстроки.

Повод: `#[cfg(all(test, target_os = "linux"))]` НЕ содержит подстроки `cfg(test)`,
поэтому проверка подстрокой приняла весь тестовый модуль за продуктовый и выдала
ложное опровержение утверждения карточки No.930. Класс был у меня записан как
пройденный, и всё равно сработал — поэтому теперь предикат разбирается.

`cfg_gates_test(attr)` отвечает: включается ли элемент ТОЛЬКО под тестом, то есть
входит ли токен `test` в предикат ПОЛОЖИТЕЛЬНО (не под `not`).
"""
import re

CFG_RX = re.compile(r"#\s*\[\s*cfg\s*\((.*)\)\s*\]\s*$")


def _leaf(name, stack):
    """Лист предиката: `test` считается положительным, если ни один объемлющий
    оператор не `not`."""
    return name.strip() == "test" and "not" not in stack


def cfg_expr_has_positive_test(expr):
    stack, name, positive = [], "", False
    for ch in expr:
        if ch.isalnum() or ch == "_":
            name += ch
            continue
        if ch == "(":
            stack.append(name.strip())
            name = ""
            continue
        if ch == ")":
            if _leaf(name, stack):
                positive = True
            name = ""
            if stack:
                stack.pop()
            continue
        if ch == ",":
            if _leaf(name, stack):
                positive = True
            name = ""
            continue
        # пробелы, `=`, кавычки — завершают лист
        if _leaf(name, stack):
            positive = True
        name = ""
    if _leaf(name, stack):
        positive = True
    return positive


def cfg_gates_test(attr):
    """attr — строка атрибута целиком, например `#[cfg(all(test, unix))]`."""
    attr = attr.strip()
    if attr.startswith("#[test]"):
        return True
    m = CFG_RX.match(attr)
    if not m:
        return False
    return cfg_expr_has_positive_test(m.group(1))


CASES = [
    ("#[test]", True),
    ("#[cfg(test)]", True),
    ('#[cfg(all(test, target_os = "linux"))]', True),      # ФОРМА, КОТОРАЯ ВСЁ СЛОМАЛА
    ("#[cfg(any(test, feature = \"x\"))]", True),
    ("#[cfg(all(any(test, unix), not(windows)))]", True),
    ("#[cfg(not(test))]", False),                          # только НЕ под тестом
    ("#[cfg(all(not(test), unix))]", False),
    ("#[cfg(target_os = \"linux\")]", False),
    ("#[cfg(feature = \"testing\")]", False),              # `testing` != `test`
    ("#[derive(Debug)]", False),
    ("#[cfg(all(unix, test))]", True),
    ("#[cfg(debug_assertions)]", False),
]

if __name__ == "__main__":
    bad = 0
    for attr, want in CASES:
        got = cfg_gates_test(attr)
        ok = got == want
        bad += (not ok)
        print("%-5s %-46s ожидали %-5s получили %s" % ("OK" if ok else "ПЛОХО",
                                                       attr, want, got))
    pos = sum(1 for _, w in CASES if w)
    print("\nслучаев %d: положительных %d, отрицательных %d — обе стороны задействованы"
          % (len(CASES), pos, len(CASES) - pos))
    print("ИТОГ: %s" % ("парсер прошёл все случаи" if not bad else "ОШИБОК %d" % bad))
    raise SystemExit(1 if bad else 0)
