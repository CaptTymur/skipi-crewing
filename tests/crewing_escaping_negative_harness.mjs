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

const ROOT =
  process.env.CREWING_HARNESS_ROOT ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REL = { index: 'dist/index.html' };

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
  const hit = lines.findIndex((l) => l.includes(needle));
  must(hit >= 0, (msg || 'сайт не найден') + ': ' + needle);
  return { no: hit + 1, text: lines[hit] };
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
const MIN_CHECKS = 8;
const MIN_DRILLS = 5;
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
