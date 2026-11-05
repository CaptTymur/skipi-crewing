#!/usr/bin/env python3
"""Резка блоков `#[test]` по СТРОКОВЫМ анкерам. ЕДИНИЦА ОБЪЯВЛЕНА:
от начала строки `#[test]` до строки с закрывающей `}` включительно, БЕЗ хвостового \n.
Контроль нарезчика: число блоков обязано совпасть с сырым счётом `#[test]`."""
import sys, re, json, hashlib, pathlib
src = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
out = {}
for m in re.finditer(r'(?m)^[ \t]*#\[test\][ \t]*\n[ \t]*fn[ \t]+(\w+)', src):
    name = m.group(1); i = src.index('{', m.end()); d = 0; j = i
    while j < len(src):
        if src[j] == '{': d += 1
        elif src[j] == '}':
            d -= 1
            if d == 0: break
        j += 1
    blk = src[m.start():j+1]
    assert not blk.endswith('\n'), 'unit violated: block must not end with a newline'
    out[name] = {"sha256": hashlib.sha256(blk.encode()).hexdigest(), "bytes": len(blk.encode())}
raw = len(re.findall(r'#\[test\]', src))
assert len(out) == raw, f'cutter control failed: {len(out)} blocks vs {raw} raw #[test]'
json.dump({"unit": "from the `#[test]` line through the line with the closing brace, NO trailing newline",
           "cutter_control": {"blocks": len(out), "raw_test_attrs": raw}, "blocks": out},
          open(sys.argv[2], 'w'), ensure_ascii=False, indent=1)
print(f'cut {len(out)} blocks (raw #[test] = {raw})')
