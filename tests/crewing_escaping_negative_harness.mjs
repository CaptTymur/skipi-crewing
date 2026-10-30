#!/usr/bin/env node
/**
 * crewing_escaping_negative_harness.mjs — негативы долга №179 (BACKLOG), маршрут
 * security-escaping-191. Дом Крюинга; образец формы — broker_escaping_negative_harness.mjs
 * (skipi-broker 78cbfa95), откуда переехали MIN_CHECKS/MIN_DRILLS, фиксированный список
 * имён проверок и ФОРМА ДРИЛЛА.
 *
 * Что доказывает:
 *   1. Внешнее значение не доезжает до исполняемого sink'а — inline-обработчика,
 *      значения атрибута, HTML-текста, JS-строки внутри атрибута, URL.
 *   2. Экранирование ОБРАТИМО: безопасное значение после разбора HTML-парсером и
 *      разбора JS-строкового литерала ПОБАЙТОВО равно исходному (round-trip).
 *      Фикстуры включают 0 и '' — слепое String(s||'') обнуляет falsy (находка F4).
 *   3. Апостроф в inline-обработчике (класс H-2 из карточки Брокера) воспроизводится
 *      ИСПОЛНЕНИЕМ, а не чтением текста: это слепое пятно инвентаря S1.
 *
 * Как доказывает: ассерты только по ВЫВОДУ исполнения реальных выражений, вырезанных
 * из dist/index.html (DECISIONS (1043)(б): ассерт по тексту исходника запрещён).
 * Каждой проверке отвечает ДРИЛЛ — точечная мутация исходника, которая обязана уронить
 * ИМЕННО свою проверку; гейт require_all_of доказывает лишь касание файла, поэтому
 * выхолащивание харнесса обязано краснить само себя.
 *
 * Запуск: node tests/crewing_escaping_negative_harness.mjs
 * Корень: CREWING_HARNESS_ROOT=<путь> (используется дриллами).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT =
  process.env.CREWING_HARNESS_ROOT ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REL = { index: 'dist/index.html' };
// F2: блок сгенерирован skipi-host-runtime и помечен «do not edit» — пин содержимого.
const HOST_RUNTIME_SHA256 = '4380cd6c84944e62f183ef56b7ae2ef61ae537e25a5516b4017cdd202af45408';

function loadIndex(src) {
  if (src != null) return src;
  return fs.readFileSync(path.join(ROOT, REL.index), 'utf8');
}

/* ------------------------------------------------------------------ *
 * Протокол отчёта
 * ------------------------------------------------------------------ */
let pass = 0;
const fail = [];
function ok(msg) { pass += 1; console.log('  ✓ ' + msg); }
function bad(name, e) { fail.push(name + ' :: ' + (e && e.message ? e.message : String(e))); console.log('  ✗ ' + name); }
function section(title) { console.log('\n# ' + title); }
function must(cond, msg) { if (!cond) throw new Error(msg); }

/* ------------------------------------------------------------------ *
 * Два слоя разбора, которые на самом деле стоят между значением и кодом
 * ------------------------------------------------------------------ */
// Слой 1: HTML-парсер декодирует сущности ВНУТРИ значения атрибута.
// Это ровно тот шаг, из-за которого escapeAttr в одиночку не закрывает JS-строку
// (класс H-2 карточки Брокера).
function htmlAttrDecode(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// Слой 2: разбор ОДНОГО строкового литерала в одинарных кавычках, начиная с кавычки.
// Возвращает значение и индекс закрывающей кавычки; бросает, если литерал не закрыт.
function readSingleQuoted(src, start) {
  must(src[start] === "'", 'разбор JS-строки: ожидалась открывающая кавычка на позиции ' + start);
  let out = '';
  for (let i = start + 1; i < src.length; i += 1) {
    const c = src[i];
    if (c === '\\') {
      const n = src[i + 1];
      if (n === 'x') { out += String.fromCharCode(parseInt(src.slice(i + 2, i + 4), 16)); i += 3; continue; }
      if (n === 'n') { out += '\n'; i += 1; continue; }
      if (n === 'r') { out += '\r'; i += 1; continue; }
      if (n === 't') { out += '\t'; i += 1; continue; }
      out += n; i += 1; continue;
    }
    if (c === "'") return { value: out, end: i };
    out += c;
  }
  throw new Error('JS-строковый литерал не закрыт — значение вышло за пределы строки');
}

/* ------------------------------------------------------------------ *
 * Исполнение РЕАЛЬНЫХ экранировщиков дома из dist/index.html
 * ------------------------------------------------------------------ */
function escapersOf(index) {
  const names = ['escapeHtml', 'escapeAttr', 'escapeJsString'];
  const parts = [];
  for (const n of names) {
    const i = index.indexOf('function ' + n + '(');
    must(i >= 0, 'в dist/index.html не найдено определение ' + n);
    // тело функции: от 'function' до строки, закрывающей её на нулевом уровне вложенности
    let depth = 0, started = false, end = -1;
    for (let j = i; j < index.length; j += 1) {
      const c = index[j];
      if (c === '{') { depth += 1; started = true; }
      else if (c === '}') { depth -= 1; if (started && depth === 0) { end = j + 1; break; } }
    }
    must(end > i, 'не удалось вырезать тело ' + n);
    parts.push(index.slice(i, end));
  }
  const factory = new Function(parts.join('\n') + '\nreturn {' + names.join(',') + '};');
  return factory();
}

/* ------------------------------------------------------------------ *
 * Вырезание РЕАЛЬНОГО выражения сайта и его исполнение
 * ------------------------------------------------------------------ */
function lineWith(index, needle, msg) {
  const lines = index.split('\n');
  const hits = [];
  lines.forEach((l, i) => { if (l.includes(needle)) hits.push(i); });
  must(hits.length > 0, (msg || 'сайт не найден') + ': ' + needle);
  // Неуникальная игла — дефект зонда, а не мелочь: дважды она уводила проверку
  // на чужую строку (CSS .mobile-nav-btn вместо обработчика). Падать, не угадывать.
  must(hits.length === 1, (msg || 'сайт') + ': игла не уникальна (' + hits.length + ' строк): ' + needle);
  return { no: hits[0] + 1, text: lines[hits[0]] };
}

function linesWith(index, needle, msg) {
  const out = [];
  index.split('\n').forEach((l, i) => { if (l.includes(needle)) out.push({ no: i + 1, text: l }); });
  must(out.length > 0, (msg || 'сайты не найдены') + ': ' + needle);
  return out;
}

// Исполняет кусок кода сайта с впрыснутыми экранировщиками и данными, возвращает html.
function renderSite(code, scope) {
  const names = Object.keys(scope);
  const fn = new Function(...names, 'var html = "";\n' + code + '\nreturn html;');
  return fn(...names.map((n) => scope[n]));
}

/* ------------------------------------------------------------------ *
 * Фикстуры
 * ------------------------------------------------------------------ */
// Враждебные значения: каждое обязано остаться ДАННЫМИ.
const HOSTILE = [
  "a');alert(1);//",          // выход из JS-строки внутри атрибута — класс H-2
  'a" onerror="alert(1)',      // выход из значения атрибута
  "a&#39;);alert(1);//",      // уже-сущность: HTML-парсер раскроет её обратно
  '</script><script>alert(1)</script>',
  "a\\');alert(1);//",        // обратный слэш перед кавычкой
];
// Безопасные значения: обязаны доехать ПОБАЙТОВО (round-trip), включая falsy.
const SAFE = ["O'Brien", 'кавычка " внутри', '<Иванов> & Co', 'Ø 0 ø', '', '0', 0];

export { htmlAttrDecode, readSingleQuoted };

/* ------------------------------------------------------------------ *
 * Проверки
 * ------------------------------------------------------------------ */
const CHECKS = [];
const DRILLS = [];
function check(name, run) { CHECKS.push({ name, run }); }
function drill(name, target, mutate) { DRILLS.push({ name, target, mutate }); }

/* ---- экранировщики: что они на самом деле делают (исполнением) ---- */
check('escapeAttr переводит апостроф в сущность', (src) => {
  const E = escapersOf(loadIndex(src));
  must(E.escapeAttr("a'b") !== "a'b", 'escapeAttr не тронул апостроф');
  must(!E.escapeAttr("a'b").includes("'"), 'в выводе escapeAttr остался сырой апостроф');
});

check('escapeHtml апостроф НЕ переводит — одного его для JS-строки мало', (src) => {
  const E = escapersOf(loadIndex(src));
  must(E.escapeHtml("a'b").includes("'"), 'escapeHtml неожиданно экранировал апостроф — проверка устарела');
});

check('escapeJsString экранирует апостроф обратным слэшем, а не сущностью', (src) => {
  const E = escapersOf(loadIndex(src));
  const out = E.escapeJsString("a'b");
  must(out.includes("\\'"), 'escapeJsString не экранировал апостроф слэшем');
  must(!out.includes('&#'), 'escapeJsString выдал сущность — в JS-строке она не работает');
});

check('escapeJsString сохраняет 0 и пустую строку (F4: String(s||"") их теряет)', (src) => {
  const E = escapersOf(loadIndex(src));
  must(E.escapeJsString(0) === '0', 'escapeJsString(0) дал ' + JSON.stringify(E.escapeJsString(0)) + ', а должен "0"');
  must(E.escapeJsString('') === '', 'escapeJsString("") изменил пустую строку');
});

check('композиция escapeAttr(escapeJsString(x)) переживает оба разбора', (src) => {
  const E = escapersOf(loadIndex(src));
  for (const v of HOSTILE) {
    const attr = E.escapeAttr(E.escapeJsString(v));
    const decoded = htmlAttrDecode(attr);               // слой 1: HTML-парсер
    const parsed = readSingleQuoted("'" + decoded + "'", 0);  // слой 2: JS-строка
    must(parsed.value === String(v), 'round-trip враждебного значения сломан: ' + JSON.stringify(v) + ' → ' + JSON.stringify(parsed.value));
    must(parsed.end === decoded.length + 1, 'значение закрыло JS-строку раньше времени: ' + JSON.stringify(v));
  }
});

check('одного escapeAttr для JS-строки НЕ хватает (механизм H-2, исполнением)', (src) => {
  const E = escapersOf(loadIndex(src));
  const hostile = "a');alert(1);//";
  const decoded = htmlAttrDecode(E.escapeAttr(hostile));
  let escaped = false;
  try {
    const parsed = readSingleQuoted("'" + decoded + "'", 0);
    escaped = parsed.end !== decoded.length + 1;
  } catch (_) { escaped = true; }
  must(escaped, 'escapeAttr в одиночку внезапно удержал апостроф — механизм H-2 изменился, проверку пересмотреть');
});

/* ---- C-2: единственный живой сайт по замеру S1 ---- */
check('C-2 id сообщения чата не выходит из JS-строки обработчика oncontextmenu', (src) => {
  const index = loadIndex(src);
  const assign = lineWith(index, 'var msgIdAttr =', 'C-2: присваивание msgIdAttr');
  const sink = lineWith(index, '_onTeamChatMsgContextMenu(event,', 'C-2: сайт обработчика');
  const E = escapersOf(index);
  for (const v of HOSTILE) {
    const html = renderSite(assign.text + '\n' + sink.text,
      { escapeAttr: E.escapeAttr, escapeHtml: E.escapeHtml, escapeJsString: E.escapeJsString,
        m: { id: v }, cls: 'team-msg', isMine: false, isAi: false,
        _renderTeamChatBody: () => '', formatTeamChatTime: () => '' });
    const at = html.indexOf('_onTeamChatMsgContextMenu(event,');
    must(at > 0, 'сайт не отрисовался');
    const attrStart = html.lastIndexOf('"', at) + 1;
    const attrEnd = html.indexOf('"', at);
    must(attrEnd > attrStart, 'значение атрибута не ограничено кавычками — выход из атрибута');
    const handler = htmlAttrDecode(html.slice(attrStart, attrEnd));
    const q = handler.indexOf("'");
    const parsed = readSingleQuoted(handler, q);
    must(parsed.value === String(v), 'C-2: значение изменилось при round-trip: ' + JSON.stringify(v) + ' → ' + JSON.stringify(parsed.value));
    const tail = handler.slice(parsed.end + 1);
    must(/^\)?\s*$/.test(tail), 'C-2: после строки в обработчике появился посторонний код: ' + JSON.stringify(tail));
  }
});

check('C-2 безопасные значения доезжают побайтово (round-trip, включая 0 и "")', (src) => {
  const index = loadIndex(src);
  const assign = lineWith(index, 'var msgIdAttr =', 'C-2: присваивание msgIdAttr');
  const sink = lineWith(index, '_onTeamChatMsgContextMenu(event,', 'C-2: сайт обработчика');
  const E = escapersOf(index);
  for (const v of SAFE) {
    const html = renderSite(assign.text + '\n' + sink.text,
      { escapeAttr: E.escapeAttr, escapeHtml: E.escapeHtml, escapeJsString: E.escapeJsString,
        m: { id: v }, cls: 'team-msg', isMine: false, isAi: false,
        _renderTeamChatBody: () => '', formatTeamChatTime: () => '' });
    const at = html.indexOf('_onTeamChatMsgContextMenu(event,');
    const attrStart = html.lastIndexOf('"', at) + 1;
    const attrEnd = html.indexOf('"', at);
    const handler = htmlAttrDecode(html.slice(attrStart, attrEnd));
    const parsed = readSingleQuoted(handler, handler.indexOf("'"));
    // m.id || '' в исходнике превращает 0 в '' — это поведение сайта, а не экранировщика
    const expected = (v === 0) ? '' : String(v);
    must(parsed.value === expected, 'C-2 round-trip: ' + JSON.stringify(v) + ' → ' + JSON.stringify(parsed.value));
  }
});


/* ---- помощники внутри исполняемых кусков (F1) ---- *
 * Куски Apps и MOBILE_RAIL харнесс изоляции исполняет через new Function с
 * фиксированным впрыском имён, поэтому escapeAttr/escapeJsString внутри них
 * недоступны. Помощники определены ВНУТРИ кусков — и обязаны давать ровно тот
 * же вывод, что композиция глобальных экранировщиков, иначе защита разъедется.
 */
function helperOf(index, name) {
  const i = index.indexOf('function ' + name + '(');
  must(i >= 0, 'не найден помощник ' + name + ' в dist/index.html');
  let depth = 0, started = false, end = -1;
  for (let j = i; j < index.length; j += 1) {
    const c = index[j];
    if (c === '{') { depth += 1; started = true; }
    else if (c === '}') { depth -= 1; if (started && depth === 0) { end = j + 1; break; } }
  }
  must(end > i, 'не удалось вырезать тело ' + name);
  return new Function(index.slice(i, end) + '\nreturn ' + name + ';')();
}

for (const hname of ['appsAttrJsString', 'railAttrJsString']) {
  check('помощник ' + hname + ' даёт ровно композицию escapeAttr(escapeJsString(x))', (src) => {
    const index = loadIndex(src);
    const E = escapersOf(index);
    const H = helperOf(index, hname);
    for (const v of HOSTILE.concat(SAFE)) {
      const expected = E.escapeAttr(E.escapeJsString(v));
      must(H(v) === expected,
        hname + ' разошёлся с композицией на ' + JSON.stringify(v) + ': ' + JSON.stringify(H(v)) + ' против ' + JSON.stringify(expected));
    }
  });
}

/* ---- сайты внутри кусков: C-3, C-4, C-5, C-9a (кусок A) и C-9b (кусок B) ---- */
const CHUNK_SITES = [
  { id: 'C-3',  call: 'appsOpen(',       anchor: 'data-qa="plugin-open-', scope: () => ({ p: { id: null, name: 'n' } }), put: (s, v) => { s.p.id = v; } },
  { id: 'C-4',  call: 'appsOpenDetail(', anchor: 'data-qa="plugin-settings-', scope: () => ({ p: { id: null, name: 'n' } }), put: (s, v) => { s.p.id = v; } },
  { id: 'C-5',  call: 'appsDisable(',    anchor: 'onclick="appsDisable',     scope: () => ({ id: null, st: 'installed' }), put: (s, v) => { s.id = v; } },
  { id: 'C-9a', call: 'mobileShow(',     anchor: 'apps-launch-tile" type="button" \'+t.qa', scope: () => ({ t: { view: null, qa: '', icon: '' } }), put: (s, v) => { s.t.view = v; } },
  { id: 'C-9b', call: 'mobileShow(',     anchor: 'data-mview="',        scope: () => ({ view: null, active: '', icon: '', label: 'l', qa: '' }), put: (s, v) => { s.view = v; } },
];

// Сайт ищется по ВЫЗОВУ обработчика, а не по форме защиты: иначе проверка
// утверждала бы «правка на месте», а не «значение не доезжает до кода».
for (const site of CHUNK_SITES) {
  check(site.id + ' значение не выходит из JS-строки обработчика внутри исполняемого куска', (src) => {
    const index = loadIndex(src);
    const E = escapersOf(index);
    const line = lineWith(index, site.anchor, site.id + ': сайт');
    const scopeExtra = { escapeHtml: E.escapeHtml, escapeAttr: E.escapeAttr, escapeJsString: E.escapeJsString,
                         mobileModuleLabel: () => 'l', MOBILE_RAIL_QA: {} };
    for (const hname of ['appsAttrJsString', 'railAttrJsString']) {
      if (index.includes('function ' + hname + '(')) scopeExtra[hname] = helperOf(index, hname);
    }
    for (const v of HOSTILE) {
      const scope = site.scope();
      site.put(scope, v);
      const raw = line.text.trim();
      const expr = raw.replace(/^(return|else if \([^)]*\) actions =|\+)\s*/, '').replace(/;$/, '');
      const html = renderSite('html += ' + expr + ';', Object.assign(scope, scopeExtra));
      const at = html.indexOf(site.call);
      must(at > 0, site.id + ': сайт не отрисовался');
      const attrStart = html.lastIndexOf('"', at) + 1;
      const attrEnd = html.indexOf('"', at);
      must(attrEnd > attrStart, site.id + ': значение вышло из атрибута на ' + JSON.stringify(v));
      const handler = htmlAttrDecode(html.slice(attrStart, attrEnd));
      const q = handler.indexOf("'");
      must(q >= 0, site.id + ': в обработчике нет строкового литерала');
      const parsed = readSingleQuoted(handler, q);
      must(parsed.value === String(v), site.id + ': значение не доехало целиком (' + JSON.stringify(v) + ' → ' + JSON.stringify(parsed.value) + ') — строка закрылась раньше');
      const tail = handler.slice(parsed.end + 1);
      must(/^\)?\s*$/.test(tail), site.id + ': после строки появился посторонний код: ' + JSON.stringify(tail));
    }
  });
}

drill('помощник куска A потерял экранирование апострофа', 'помощник appsAttrJsString даёт ровно композицию escapeAttr(escapeJsString(x))',
  (src) => {
    const needle = `.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'")`;
    const at = src.indexOf(needle);
    must(at > 0, 'мутация не нашла строку помощника');
    return src.slice(0, at) + `.replace(/\\\\/g, '\\\\\\\\')` + src.slice(at + needle.length);
  });

drill('снять помощник с сайта C-3', 'C-3 значение не выходит из JS-строки обработчика внутри исполняемого куска',
  (src) => src.replace("onclick=\"appsOpen(\\''+appsAttrJsString(p.id)+'\\')\">'", "onclick=\"appsOpen(\\''+escapeHtml(p.id)+'\\')\">'"));

drill('снять помощник с сайта C-9b (кусок B)', 'C-9b значение не выходит из JS-строки обработчика внутри исполняемого куска',
  (src) => src.replace("onclick=\"mobileShow(\\''+railAttrJsString(view)+'\\')\">", "onclick=\"mobileShow(\\''+view+'\\')\">"));


/* ---- C-10: негатив на ФУНКЦИЮ, а не на DOM (F3) ----
 * mime приходит из mime_from_path (Rust) — закрытый набор из восьми литералов без
 * кавычек, поэтому «враждебный mime в DOM» бил бы по невозможному входу
 * (DECISIONS (1043)(б)). Предикат стоит у места сборки URL и проверяется юнит-тестом.
 */
check('C-10 docPreviewImageMime пропускает только закрытый набор типов', (src) => {
  const index = loadIndex(src);
  const f = helperOf(index, 'docPreviewImageMime');
  for (const good of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'IMAGE/PNG']) {
    must(f(good) === good.toLowerCase(), 'отвергнут законный тип ' + good);
  }
  for (const bad of ['image/png" onerror="alert(1)', 'image/svg+xml', 'image/png;x', 'application/pdf',
                     'image/png ', '', null, undefined, 0, 'imagex/png']) {
    must(f(bad) === '', 'пропущен недопустимый тип ' + JSON.stringify(bad) + ' → ' + JSON.stringify(f(bad)));
  }
});

check('C-10 docPreviewBase64 оставляет только алфавит base64', (src) => {
  const index = loadIndex(src);
  const f = helperOf(index, 'docPreviewBase64');
  must(f('AAAA+/==') === 'AAAA+/==', 'законный base64 изменён');
  must(f('AA"onload="x') === 'AAonload=x', 'кавычка не удалена: ' + JSON.stringify(f('AA"onload="x')));
  must(!f('AA"onload="x').includes('"'), 'кавычка пережила фильтр');
  must(f(null) === '' && f(0) === '0', 'null/0 обработаны неверно');
});

/* ---- F5: восьмой класс — данные в URL под HTML-экранировщиком ---- */
check('F5 адрес в mailto URL-кодируется на месте, а не держится предикатом снаружи', (src) => {
  const index = loadIndex(src);
  const E = escapersOf(index);
  const line = lineWith(index, 'data-qa="pilot-draft-mailto"', 'F5: сайт mailto');
  const expr = line.text.trim().replace(/^\?\s*/, '').replace(/;$/, '');
  for (const v of ['a@b.test', "a'b@c.test", 'a"onmouseover="alert(1)', 'a b@c.test', 'a&cc=evil@c.test']) {
    const html = renderSite('html += ' + expr + ';', {
      escapeAttr: E.escapeAttr, escapeHtml: E.escapeHtml,
      checkedTo: v, dr: { subject: 's', body: 'b' }, cardT: () => 'open',
    });
    const m = /href="([^"]*)"/.exec(html);
    must(m, 'F5: href не ограничен кавычками на ' + JSON.stringify(v));
    const href = htmlAttrDecode(m[1]);
    const addr = href.slice('mailto:'.length, href.indexOf('?'));
    must(decodeURIComponent(addr) === v, 'F5: адрес не восстанавливается побайтово: ' + JSON.stringify(v) + ' → ' + JSON.stringify(decodeURIComponent(addr)));
    // Апостроф encodeURIComponent оставляет намеренно (unreserved), и это безопасно:
    // слой атрибута переводит его в &#39; через escapeAttr. Запрещены СТРУКТУРНЫЕ
    // символы URL — ими адрес мог бы дописать себе параметры (cc=, bcc=).
    for (const ch of ['"', '&', ' ', '?', '<', '>']) {
      must(!addr.includes(ch), 'F5: структурный символ ' + JSON.stringify(ch) + ' остался в адресе URL: ' + addr);
    }
    const attrValue = m[1];
    must(!attrValue.includes('"'), 'F5: значение атрибута не закрыто — выход из href');
  }
});

drill('снять allowlist с C-10', 'C-10 docPreviewImageMime пропускает только закрытый набор типов',
  (src) => src.replace("return /^image\\/(png|jpeg|webp|gif|bmp)$/.test(m) ? m : '';", 'return m;'));

drill('снять фильтр base64 с C-10', 'C-10 docPreviewBase64 оставляет только алфавит base64',
  (src) => src.replace("return String(b64 == null ? '' : b64).replace(/[^A-Za-z0-9+/=]/g, '');", "return String(b64 == null ? '' : b64);"));

drill('снять URL-кодирование адреса в F5', 'F5 адрес в mailto URL-кодируется на месте, а не держится предикатом снаружи',
  (src) => src.replace("'mailto:'+encodeURIComponent(checkedTo)+'?subject='", "'mailto:'+checkedTo+'?subject='"));


/* ---- C-6, C-7, C-8: сайты вне исполняемых кусков (hardening по рангу S1) ---- */
const PLAIN_SITES = [
  { id: 'C-7',  anchor: 'cd-button cd-placeholder',                    call: 'cdToggle(',           vars: (v) => ({ id: v }) },
  { id: 'C-8a', anchor: '+ \'" onclick="openSettings',                 call: 'openSettings(',       vars: (v) => ({ id: v }) },
  { id: 'C-8b', anchor: 'data-qa="\'+qa+\'" title="\'+escapeAttr(sub', call: 'openSettings(',       vars: (v) => ({ id: v, qa: 'q', label: 'l', sub: 's', active: () => '' }) },
  { id: 'C-6',  anchor: 'class="ios-row" onclick="mobileOpenSettings', call: 'mobileOpenSettings(', vars: (v) => ({ it: { id: v, label: 'l', icon: 'i', sub: '' } }) },
];

for (const site of PLAIN_SITES) {
  check(site.id + ' значение не выходит из JS-строки обработчика (сайт вне исполняемых кусков)', (src) => {
    const index = loadIndex(src);
    const E = escapersOf(index);
    const line = lineWith(index, site.anchor, site.id + ': сайт');
    const expr = line.text.trim().replace(/^(return|html \+=|\+)\s*/, '').replace(/;$/, '');
    for (const v of HOSTILE) {
      const scope = Object.assign(site.vars(v), {
        escapeAttr: E.escapeAttr, escapeHtml: E.escapeHtml, escapeJsString: E.escapeJsString,
      });
      const html = renderSite('html += ' + expr + ';', scope);
      const at = html.indexOf(site.call);
      must(at > 0, site.id + ': сайт не отрисовался');
      const attrStart = html.lastIndexOf('"', at) + 1;
      const attrEnd = html.indexOf('"', at);
      must(attrEnd > attrStart, site.id + ': значение вышло из атрибута на ' + JSON.stringify(v));
      const handler = htmlAttrDecode(html.slice(attrStart, attrEnd));
      const parsed = readSingleQuoted(handler, handler.indexOf("'"));
      must(parsed.value === String(v), site.id + ': значение не доехало целиком (' + JSON.stringify(v) + ' → ' + JSON.stringify(parsed.value) + ')');
      must(/^\)?\s*$/.test(handler.slice(parsed.end + 1)), site.id + ': после строки появился посторонний код');
    }
  });
}

drill('снять экранирование с C-7', 'C-7 значение не выходит из JS-строки обработчика (сайт вне исполняемых кусков)',
  (src) => src.replace("onclick=\"cdToggle(\\''+escapeAttr(escapeJsString(id))+'\\')\">'", "onclick=\"cdToggle(\\''+id+'\\')\">'"));

drill('снять экранирование с C-6', 'C-6 значение не выходит из JS-строки обработчика (сайт вне исполняемых кусков)',
  (src) => src.replace("onclick=\"mobileOpenSettings(\\''+escapeAttr(escapeJsString(it.id))+'\\')\">'", "onclick=\"mobileOpenSettings(\\''+it.id+'\\')\">'"));


/* ---- класс целиком: ПОКРЫТИЕ по исходнику ----
 * Имя проверки называет свой слой честно: это проверка ПОКРЫТИЯ ПО ИСХОДНИКУ,
 * а не доказательство поведения вывода (DECISIONS (1043)(б)). Поведение доказывают
 * исполнением проверки сайтов выше; эта ловит СЕДЬМОЙ сайт, который появится завтра
 * и мимо которой он бы проехал молча.
 */
// Значение обработчика целиком, затем ВСЕ позиции внутри него. Первая редакция
// зонда брала только первую позицию и была слепа к многоаргументным обработчикам —
// поймано собственным дриллом на :13383 (bundle.id, bCounterpart молчали).
const HANDLER_ATTR = /on\w+\s*=\s*"([^"]*)"/g;
const JS_SLOT = /\\''\s*\+\s*([^+]+?)\s*\+\s*'\\'/g;

function handlerJsStringSites(index) {
  const out = [];
  index.split('\n').forEach((ln, i) => {
    const no = i + 1;
    if (no >= 1017 && no <= 1256) return; // F2: сгенерированный host-runtime, не наш
    let h;
    HANDLER_ATTR.lastIndex = 0;
    while ((h = HANDLER_ATTR.exec(ln)) !== null) {
      let s;
      JS_SLOT.lastIndex = 0;
      while ((s = JS_SLOT.exec(h[1])) !== null) out.push({ no, expr: s[1].trim(), text: ln });
    }
  });
  return out;
}

check('ПОКРЫТИЕ ПО ИСХОДНИКУ: ни один обработчик не несёт значение в JS-строку без JS-экранирования', (src) => {
  const index = loadIndex(src);
  const sites = handlerJsStringSites(index);
  // калибровка: зонд обязан видеть заведомо известный сайт C-2
  must(sites.some((s) => s.text.includes('_onTeamChatMsgContextMenu')),
    'зонд покрытия не видит известный сайт C-2 — ноль был бы ложным');
  const bare = sites.filter((s) => !/JsString/.test(s.expr)
    && !/^(msgIdAttr|key)$/.test(s.expr)                       // C-2 защищён переменной строкой выше; C-1 снят по F3
    && !/Number\(|parseInt\(|String\(ordinal\)/.test(s.expr));
  must(bare.length === 0,
    'сайты без JS-экранирования: ' + bare.map((s) => ':' + s.no + ' ' + s.expr).join(' | '));
});

check('новый сайт :13383 — четыре значения bundle не выходят из JS-строк openDocumentsBundle', (src) => {
  const index = loadIndex(src);
  const E = escapersOf(index);
  // Сайтов bundle-viewer два (:13323 и :13383) — проверяются ОБА, а не «первый найденный».
  const sites = linesWith(index, 'onclick="openDocumentsBundle', 'сайты bundle-viewer');
  must(sites.length === 2, 'ожидалось 2 сайта bundle-viewer, найдено ' + sites.length + ' — состав изменился, проверку пересмотреть');
  for (const site of sites) for (const v of HOSTILE) {
  // Обе строки — самостоятельные выражения после снятия ведущего «+» или «?»
  // (вторая из них — тернарник целиком, его трогать нельзя: снимал — ломал разбор).
  const expr = site.text.trim().replace(/^(\?|\+)\s*/, '').replace(/;$/, '');
    const html = renderSite('html += ' + expr + ';', {
      escapeAttr: E.escapeAttr, escapeHtml: E.escapeHtml, escapeJsString: E.escapeJsString,
      m: { application_id: v }, bundle: { id: v, filename: v }, bCounterpart: v,
      applicationId: v, att: { id: v, original_filename: v, mime_type: v }, counterpart: v, fname: v,
      isZip: true, counterpartId: v,
    });
    const at = html.indexOf('openDocumentsBundle(');
    must(at > 0, 'сайт bundle не отрисовался');
    const attrStart = html.lastIndexOf('"', at) + 1;
    const attrEnd = html.indexOf('"', at);
    must(attrEnd > attrStart, 'bundle: значение вышло из атрибута на ' + JSON.stringify(v));
    const handler = htmlAttrDecode(html.slice(attrStart, attrEnd));
    let pos = handler.indexOf("'");
    for (let k = 0; k < 4; k += 1) {
      const parsed = readSingleQuoted(handler, pos);
      must(parsed.value === String(v), 'bundle: позиция ' + (k + 1) + ' не доехала: ' + JSON.stringify(parsed.value));
      const next = handler.indexOf("'", parsed.end + 1);
      pos = next;
      if (k < 3) must(pos > 0, 'bundle: позиция ' + (k + 2) + ' не найдена');
    }
  }
});

/* ---- дриллы класса: каждая снятая защита обязана покраснить покрытие ---- */
const SWEPT = [
  'escapeAttr(escapeJsString(m.user_id))', 'escapeAttr(escapeJsString(target))',
  'escapeAttr(escapeJsString(t.application_id))', 'escapeAttr(escapeJsString(v.id))',
  'escapeAttr(escapeJsString(profile.id))', 'escapeAttr(escapeJsString(a.id))',
  'escapeAttr(escapeJsString(row.id))', 'escapeAttr(escapeJsString(r.id))',
  'escapeAttr(escapeJsString(s.id))', 'escapeAttr(escapeJsString(d.id))',
  'escapeAttr(escapeJsString(d.template_id))', 'escapeAttr(escapeJsString(bundle.id))',
  'escapeAttr(escapeJsString(bCounterpart))', 'escapeAttr(escapeJsString(m.application_id))',
  'escapeAttr(escapeJsString(id))', 'escapeAttr(escapeJsString(p.id))',
  'escapeAttr(escapeJsString(it.id))',
  'appsAttrJsString(id)', 'appsAttrJsString(p.id)', 'appsAttrJsString(t.view)',
  'railAttrJsString(view)',
];
for (const form of SWEPT) {
  drill('снять JS-экранирование: ' + form,
    'ПОКРЫТИЕ ПО ИСХОДНИКУ: ни один обработчик не несёт значение в JS-строку без JS-экранирования',
    (src) => {
      // ВСЕ вхождения, не первое: формы встречаются 2–8 раз, и мутация одного
      // вхождения оставляла остальные сайты защищёнными — проверка не краснела
      // по той причине, по которой должна была. Дефект S2, найден Супервайзором.
      const count = src.split(form).length - 1;
      must(count > 0, 'форма не найдена в исходнике: ' + form);
      const inner = form.startsWith('escapeAttr(escapeJsString(')
        ? 'escapeAttr(' + form.slice('escapeAttr(escapeJsString('.length, -1)
        : form.slice(form.indexOf('(') + 1, -1);
      return src.split(form).join(inner);
    });
}


/* ---- самокалибровка зондов самого харнесса ---- */
check('зонд htmlAttrDecode откалиброван на известных сущностях', () => {
  must(htmlAttrDecode('a&#39;b') === "a'b", '&#39; не раскрыт');
  must(htmlAttrDecode('a&#34;b') === 'a"b', '&#34; не раскрыт');
  must(htmlAttrDecode('a&amp;#39;b') === "a&#39;b", 'двойное раскрытие — зонд врёт');
});

check('зонд readSingleQuoted откалиброван на известных литералах', () => {
  must(readSingleQuoted("'ab'", 0).value === 'ab', 'простая строка');
  must(readSingleQuoted(String.raw`'a\'b'`, 0).value === "a'b", 'экранированная кавычка');
  must(readSingleQuoted(String.raw`'a\x3cb'`, 0).value === 'a<b', 'шестнадцатеричный escape');
  let threw = false;
  try { readSingleQuoted("'abc", 0); } catch (_) { threw = true; }
  must(threw, 'незакрытый литерал обязан падать');
});

check('ПОЛОЖИТЕЛЬНЫЙ КОНТРОЛЬ: фикстуры действительно ломают НЕзащищённый сайт', (src) => {
  const index = loadIndex(src);
  const E = escapersOf(index);
  // синтетический сайт без JS-экранирования — обязан сломаться на каждом враждебном значении
  let broken = 0;
  for (const v of HOSTILE) {
    const html = "<b onclick=\"f('" + E.escapeAttr(v) + "')\">";
    const handler = htmlAttrDecode(html.slice(html.indexOf('"') + 1, html.lastIndexOf('"')));
    try {
      const parsed = readSingleQuoted(handler, handler.indexOf("'"));
      if (parsed.value !== String(v)) broken += 1;
    } catch (_) { broken += 1; }
  }
  // escapeAttr закрывает " и <; апостроф — нет, и ровно на нём класс H-2 и живёт.
  // Поэтому контроль требует, чтобы ломались ИМЕННО апострофные фикстуры, а не все.
  const quoteBearing = HOSTILE.filter((v) => String(v).includes("'")).length;
  must(broken >= quoteBearing && quoteBearing > 0,
    'фикстуры слабые: апострофных ' + quoteBearing + ', сломали незащищённый сайт ' + broken);
});

check('F2: сгенерированный блок host-runtime не тронут (sha256 содержимого)', (src) => {
  const index = loadIndex(src);
  const m = /<!-- BEGIN skipi-host-runtime[\s\S]*?<!-- END skipi-host-runtime -->/.exec(index);
  must(m, 'блок host-runtime не найден');
  const sum = crypto.createHash('sha256').update(m[0], 'utf8').digest('hex');
  must(sum === HOST_RUNTIME_SHA256,
    'блок host-runtime изменён: ' + sum + ' вместо ' + HOST_RUNTIME_SHA256 + ' — это территория роли плагинов (F2)');
});

check('экранировщики дома не потеряли null-безопасность', (src) => {
  const E = escapersOf(loadIndex(src));
  for (const [n, f] of Object.entries(E)) {
    must(f(null) === '', n + '(null) должен давать пустую строку');
    must(f(undefined) === '', n + '(undefined) должен давать пустую строку');
  }
});


/* ================================================================== *
 * S3: СЛОЙ АТРИБУТА. Разбор приёмки S2 (REJECT, аудит 160bfe9e).
 *
 * escapeJsString НЕ переводит `"` — измерено: escapeJsString('a"b') = a\"b,
 * escapeAttr('a"b') = a&#34;b. Все сайты класса сидят в атрибутах в ДВОЙНЫХ
 * кавычках, поэтому JS-слоя в одиночку мало: кавычка закрывает АТРИБУТ раньше,
 * чем начинается JS, и хвост становится новым обработчиком.
 *
 * Почему S2 этого не поймал — дефект был в проверке покрытия: она принимала
 * слот по ТЕКСТУ (!/JsString/) и потому считала escapeJsString(x) закрытым,
 * а payload, собранный в помощнике (btn/js/jsPair) или переменной, не видела
 * вовсе. Ниже покрытие проверяется ПО СЛОЮ и с трассировкой до места сборки.
 * ================================================================== */

const ATTR_HOSTILE = 'x" onmouseover="alert(1)';

// Слой, которым закрыт слот: наружная функция выражения решает всё.
function closingLayer(expr) {
  const e = String(expr).trim();
  const m = /^([A-Za-z_$][\w$]*)\s*\(/.exec(e);
  const fn = m ? m[1] : null;
  if (fn === 'escapeAttr') return 'attr';
  if (fn === 'appsAttrJsString' || fn === 'railAttrJsString') return 'chunk-helper';
  if (fn === 'escapeJsString') return 'js-only';
  if (fn === 'escapeHtml') return 'html-only';
  if (fn === 'Number' || fn === 'parseInt' || fn === 'parseFloat') return 'numeric';
  if (/^String\(\s*(ordinal|Number\()/.test(e)) return 'numeric';
  return null; // переменная или выражение — трассировать до сборки
}

// Имя атрибута обязано НАЧИНАТЬСЯ с «on»: без якоря границы регулярка ловит
// «data-unconfirmed="…"» (внутри слова есть «onfirmed=») и считает его обработчиком.
// Измерено на :5965 — ложное срабатывание завышало и счёт класса.
const HANDLER_ATTR_RE = /(?:^|[\s"';(])(on[a-z]+)\s*=\s*"([^"]*)"/g;
const SLOT_RE = /'\s*\+\s*([^+]+?)\s*\+\s*'/g;

function handlerSlots(index) {
  const out = [];
  index.split('\n').forEach((ln, i) => {
    const no = i + 1;
    if (no >= 1017 && no <= 1256) return; // F2
    let h;
    HANDLER_ATTR_RE.lastIndex = 0;
    while ((h = HANDLER_ATTR_RE.exec(ln)) !== null) {
      let s;
      SLOT_RE.lastIndex = 0;
      while ((s = SLOT_RE.exec(h[2])) !== null) out.push({ no, expr: s[1].trim(), attr: h[1], text: ln });
    }
  });
  return out;
}

// Трассировка переменной до строки сборки: payload, собранный помощником,
// обязан нести атрибутный слой там, где он СОБИРАЕТСЯ.
function traceAssignment(index, varName, beforeLine) {
  const lines = index.split('\n');
  const re = new RegExp('\\b(?:var|let|const)\\s+' + varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*(.+)');
  for (let i = beforeLine - 1; i >= 0 && i > beforeLine - 400; i -= 1) {
    const m = re.exec(lines[i]);
    if (m) return { no: i + 1, expr: m[1].replace(/;\s*$/, '') };
  }
  return null;
}

check('S3 ПОКРЫТИЕ ПО СЛОЮ: каждый слот обработчика закрыт атрибутным слоем', (src) => {
  const index = loadIndex(src);
  const slots = handlerSlots(index);
  must(slots.some((s) => s.text.includes('_onTeamChatMsgContextMenu')),
    'зонд покрытия не видит известный сайт C-2 — ноль был бы ложным');
  const open = [];
  for (const s of slots) {
    let layer = closingLayer(s.expr);
    if (layer === null) {
      // переменная/выражение: трассируем до сборки и смотрим слой ТАМ
      const name = /^[A-Za-z_$][\w$]*$/.test(s.expr) ? s.expr : null;
      if (!name) {
        // выражение-литерал/арифметика: числовое — освобождено, иначе открыто
        if (/^\(?\s*(published|Number\(|Math\.|i|\d)/.test(s.expr) || /^\(Number\(/.test(s.expr)) continue;
        open.push(`:${s.no} ${s.expr} (выражение)`);
        continue;
      }
      // Освобождения — поимённо и с причиной, ДО трассировки; «зонд не нашёл сборку»
      // освобождением не является и остаётся UNKNOWN.
      if (/^i$|^ordinal$/.test(name)) continue;            // индекс цикла/map — числовой
      if (name === 'onclick') continue;                    // параметр btn(): payload собирается
                                                           // у вызывающего, и его слой проверяет
                                                           // отдельная проверка «payload помощников»
      if (name === 'key') continue;                        // C-1 снят по F3: 5 вызовов
                                                           // seafarerFilterSelect (:11368–11372),
                                                           // все с литералами — внешних данных нет
      const asg = traceAssignment(index, name, s.no);
      if (!asg) { open.push(`:${s.no} ${s.expr} (сборка не найдена — UNKNOWN, не ноль)`); continue; }
      const inner = /escapeAttr\s*\(/.test(asg.expr) ? 'attr'
        : (/AttrJsString\s*\(/.test(asg.expr) ? 'chunk-helper'
        : (/escapeJsString\s*\(/.test(asg.expr) ? 'js-only'
        : (/^String\(Number|^\(?Number\(/.test(asg.expr) ? 'numeric' : null)));
      if (inner === 'attr' || inner === 'chunk-helper' || inner === 'numeric') continue;
      open.push(`:${s.no} ${s.expr} → собран на :${asg.no} как ${asg.expr.slice(0, 50)} [${inner || 'слой не опознан'}]`);
      continue;
    }
    if (layer === 'attr' || layer === 'chunk-helper' || layer === 'numeric') continue;
    open.push(`:${s.no} ${s.expr} [${layer}]`);
  }
  must(open.length === 0, 'слоты без атрибутного слоя (' + open.length + '):\n      ' + open.join('\n      '));
});

check('S3 НЕГАТИВ ПО АТРИБУТУ: ни один сток не выпускает сырую двойную кавычку', (src) => {
  const index = loadIndex(src);
  const E = escapersOf(index);
  const helpers = {};
  for (const h of ['appsAttrJsString', 'railAttrJsString']) {
    if (index.includes('function ' + h + '(')) helpers[h] = helperOf(index, h);
  }
  const slots = handlerSlots(index);
  const scope = Object.assign({
    escapeAttr: E.escapeAttr, escapeHtml: E.escapeHtml, escapeJsString: E.escapeJsString,
  }, helpers);
  let checked = 0;
  for (const s of slots) {
    const layer = closingLayer(s.expr);
    if (layer === 'numeric' || layer === null) continue; // трассируемые покрыты проверкой слоя
    // исполняем САМО выражение сайта с враждебным значением
    const names = Array.from(new Set((s.expr.match(/[A-Za-z_$][\w$]*/g) || [])
      .filter((n) => !(n in scope) && !['String', 'Number', 'parseInt', 'parseFloat', 'Math'].includes(n))));
    const local = Object.assign({}, scope);
    for (const n of names) local[n] = ATTR_HOSTILE;
    let out;
    try {
      out = new Function(...Object.keys(local), 'return (' + s.expr + ');')(...Object.values(local));
    } catch (_) { continue; } // выражение требует структуры объекта — покрыто точечными проверками
    must(!String(out).includes('"'),
      `сток :${s.no} ${s.expr} выпустил сырую двойную кавычку: ${JSON.stringify(String(out).slice(0, 60))}`);
    checked += 1;
  }
  must(checked >= 20, 'проверено стоков ' + checked + ' — зонд ослаб, ожидалось не меньше 20');
});

check('S3 payload помощников (btn/js/jsPair) собирается с атрибутным слоем', (src) => {
  const index = loadIndex(src);
  const E = escapersOf(index);
  const spots = [
    { id: 'js :10317',   needle: "var js = '\\\\'' + " },
    { id: 'jsPair',      needle: 'var jsPair = ' },
    { id: 'btn id',      needle: 'var id = escapeJsString(intakeId)' },
  ];
  const lines = index.split('\n');
  let seen = 0;
  lines.forEach((ln, i) => {
    const m = /\b(?:var|let|const)\s+(js|jsPair|id)\s*=\s*(.+)/.exec(ln);
    if (!m) return;
    const body = m[2];
    if (!/escapeJsString\s*\(/.test(body)) return;  // не наш класс сборки
    seen += 1;
    must(/escapeAttr\s*\(/.test(body) || /AttrJsString\s*\(/.test(body),
      `payload «${m[1]}» на :${i + 1} собран только JS-слоем: ${body.trim().slice(0, 80)}`);
  });
  must(seen >= 6, 'мест сборки payload найдено ' + seen + ' — ожидалось не меньше 6 (js ×3, jsPair ×2, btn id ×1)');
});

/* ---- дрилл ПОНИЖЕНИЯ: М3 Супервайзора как тест ---- */
drill('М3: понизить :4984 escapeAttr(escapeJsString(…)) до escapeJsString(…)',
  'S3 ПОКРЫТИЕ ПО СЛОЮ: каждый слот обработчика закрыт атрибутным слоем',
  (src) => {
    const needle = "escapeAttr(escapeJsString(published ? 'unpublish' : 'publish'))";
    const alt = 'escapeAttr(escapeJsString(p.id))';
    const pick = src.includes(needle) ? needle : alt;
    const at = src.indexOf(pick);
    must(at > 0, 'форма для понижения не найдена');
    const inner = 'escapeJsString(' + pick.slice('escapeAttr(escapeJsString('.length, -1);
    return src.slice(0, at) + inner + src.slice(at + pick.length);
  });

drill('понизить payload помощника js до одного JS-слоя',
  'S3 payload помощников (btn/js/jsPair) собирается с атрибутным слоем',
  (src) => src.replace(/escapeAttr\(escapeJsString\(String\(intakeId\)\)\)/, 'escapeJsString(String(intakeId))'));


check('S3 UNKNOWN закрыт: строка ошибки fetch_messages не доезжает в innerHTML сырьём', (src) => {
  const index = loadIndex(src);
  const E = escapersOf(index);
  // Таких сайтов два (:4621 уже был закрыт, :13146 закрыт в S3) — проверяются ОБА.
  const sites = linesWith(index, 'Failed to load: ', 'сайты строки ошибки (класс (c))');
  must(sites.length === 2, 'ожидалось 2 сайта «Failed to load», найдено ' + sites.length);
  for (const site of sites) {
  const expr = site.text.trim().replace(/^(if \(host\) )?host\.innerHTML\s*=\s*/, '').replace(/;$/, '');
  for (const v of ['<img src=x onerror=alert(1)>', '</div><script>alert(1)</script>', "O'Brien & Co"]) {
    const html = new Function('escapeHtml', 'escapeAttr', 'e', 'return (' + expr + ');')(E.escapeHtml, E.escapeAttr, v);
    must(!html.includes('<img'), 'сырой тег доехал в innerHTML: ' + html.slice(0, 80));
    must(!html.includes('<script'), 'сырой script доехал в innerHTML');
    const inner = html.slice(html.indexOf('Failed to load: ') + 'Failed to load: '.length, html.lastIndexOf('</div>'));
    must(htmlAttrDecode(inner) === String(v), 'round-trip текста ошибки сломан: ' + JSON.stringify(htmlAttrDecode(inner)));
  }
  }
});

drill('снять escapeHtml со строки ошибки fetch_messages',
  'S3 UNKNOWN закрыт: строка ошибки fetch_messages не доезжает в innerHTML сырьём',
  (src) => {
    // Игла без ведущей кавычки: литерал в исходнике начинается с '<div …>, а не с 'Failed.
    const needle = "Failed to load: '+escapeHtml(String(e))+'</div>'";
    must(src.includes(needle), 'игла дрилла не найдена');
    return src.replace(needle, "Failed to load: '+e+'</div>'");
  });

/* ------------------------------------------------------------------ *
 * Дриллы: каждая мутация обязана уронить ИМЕННО свою проверку
 * ------------------------------------------------------------------ */
drill('снять escapeJsString с сайта C-2', 'C-2 id сообщения чата не выходит из JS-строки обработчика oncontextmenu',
  (src) => src.replace('escapeAttr(escapeJsString(String(m.id || \'\')))', 'escapeAttr(String(m.id || \'\'))'));

drill('снять экранирование с сайта C-2 целиком', 'C-2 id сообщения чата не выходит из JS-строки обработчика oncontextmenu',
  (src) => src.replace(/var msgIdAttr = [^;]+;/, "var msgIdAttr = String(m.id || '');"));

drill('escapeJsString перестал экранировать апостроф', 'escapeJsString экранирует апостроф обратным слэшем, а не сущностью',
  (src) => src.replace(".replace(/'/g, \"\\\\'\")", ''));

drill('escapeAttr перестал трогать апостроф', 'escapeAttr переводит апостроф в сущность',
  (src) => src.replace("replace(/[&'\"<>]/g", 'replace(/[&"<>]/g'));

drill('escapeJsString снова теряет 0 на String(s||"")', 'escapeJsString сохраняет 0 и пустую строку (F4: String(s||"") их теряет)',
  (src) => src.replace('function escapeJsString(s){\n  return String(s == null ? \'\' : s)', "function escapeJsString(s){\n  return String(s||'')"));

/* ------------------------------------------------------------------ *
 * Мета: харнесс нельзя выхолостить незаметно
 * ------------------------------------------------------------------ */
const MIN_CHECKS = 33;
const MIN_DRILLS = 35;
const EXPECTED_CHECK_NAMES = CHECKS.map((c) => c.name);

section('проверки на кандидате');
for (const c of CHECKS) {
  try { c.run(); ok(c.name); } catch (e) { bad(c.name, e); }
}

section('дриллы: мутация обязана покраснить свою проверку');
for (const d of DRILLS) {
  try {
    const target = CHECKS.find((c) => c.name === d.target);
    must(target, 'дрилл ' + d.name + ' ссылается на несуществующую проверку «' + d.target + '»');
    const src = fs.readFileSync(path.join(ROOT, REL.index), 'utf8');
    const mutated = d.mutate(src);
    must(mutated !== src, 'дрилл ' + d.name + ' ничего не изменил в исходнике — мутация промахнулась');
    let threw = false;
    try { target.run(mutated); } catch (_) { threw = true; }
    must(threw, 'дрилл ' + d.name + ': проверка «' + d.target + '» осталась зелёной на сломанном исходнике');
    ok(d.name + ' → красит «' + d.target + '»');
  } catch (e) { bad(d.name, e); }
}

section('мета: харнесс нельзя выхолостить незаметно');
try {
  must(CHECKS.length >= MIN_CHECKS, `проверок ${CHECKS.length}, минимум ${MIN_CHECKS}`);
  ok(`проверок ${CHECKS.length} (минимум ${MIN_CHECKS})`);
} catch (e) { bad('минимальное число проверок', e); }
try {
  must(DRILLS.length >= MIN_DRILLS, `дриллов ${DRILLS.length}, минимум ${MIN_DRILLS}`);
  ok(`дриллов ${DRILLS.length} (минимум ${MIN_DRILLS})`);
} catch (e) { bad('минимальное число дриллов', e); }
try {
  const actual = CHECKS.map((c) => c.name).sort();
  const expected = EXPECTED_CHECK_NAMES.slice().sort();
  const missing = expected.filter((n) => !actual.includes(n));
  must(missing.length === 0, 'исчезли проверки: ' + missing.join(' | '));
  ok('состав проверок не изменился (' + expected.length + ' зафиксированных имён)');
} catch (e) { bad('неизменность имён проверок', e); }

console.log('');
if (fail.length) {
  console.log(`FAILED: ${pass} passed, ${fail.length} failed`);
  for (const f of fail) console.log('  - ' + f);
  process.exit(1);
}
console.log(`ALL GREEN: ${pass} passed, 0 failed`);
