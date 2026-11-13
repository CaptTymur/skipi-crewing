import { crewingPublicSettingsFixture } from './fixtures/crewing_public_settings.mjs';
// Crewing language-persistence + demo-banner contract harness (BACKLOG No.1881, No.1880).
//
//   node tests/crewing_language_persistence_harness.mjs
//
// No.1881 — a chosen language must outlive the process. localStorage cannot carry it: a
// non-legacy boot gives the view an EPHEMERAL browser context (src-tauri/src/lib.rs
// `configure_boot_windows`, gated on `startup_should_open_db`, which matches only
// LegacyConnected), so a fresh profile loses the key on exit. Each bootApp() below gives a
// FRESH localStorage while the `persisted` store survives — that is exactly the ephemeral
// context, so a test that passes here passes on a fresh profile.
// No.1880 — the demo banner is drawn by the host and used to keep its boot language
// forever, because renderDemoBanner() returned early whenever the node already existed.
//
// Both directions are checked on purpose (ru->restart->ru AND en->restart->en): a one-way
// check cannot tell "remembered the choice" from "always ru".

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
// CREWING_INDEX_HTML lets the same harness be aimed at another build of the page, so the
// negative control (does it go RED on the unfixed page?) costs one env var, not a checkout.
const HTML_PATH = process.env.CREWING_INDEX_HTML || path.join(ROOT, 'dist/index.html');
const HTML = fs.readFileSync(HTML_PATH, 'utf8');

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.error('  ✗ ' + msg); }
};
const section = (title) => console.log('\n# ' + title);

function makeElement(id) {
  return {
    id, innerHTML: '', textContent: '', value: '', style: {}, children: [], className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute(n, v) { this['@' + n] = String(v); },
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this, '@' + n) ? this['@' + n] : null; },
    removeAttribute(n) { delete this['@' + n]; },
    addEventListener() {}, appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); },
    insertBefore(c) { this.children.unshift(c); return c; },
    remove() { this.removed = true; }, focus() {},
    querySelector() { return makeElement(id + '-q'); }, querySelectorAll() { return []; },
    scrollIntoView() {},
  };
}

const script = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1]).reduce((a, b) => (a.length > b.length ? a : b), '');
const bootIndex = script.indexOf('// ------------- boot -------------');
const scriptNoBoot = bootIndex > 0 ? script.slice(0, bootIndex) : script;
ok(bootIndex > 0, 'boot marker found (script compiled without auto-boot)');

// What the Rust side would hold on disk. Survives every bootApp(); localStorage does not.
let persisted = {};
let invokeCalls = [];
let toasts = [];

function bootApp({ demo = false } = {}) {
  const els = new Map();
  const elFor = (id) => { if (!els.has(id)) els.set(id, makeElement(id)); return els.get(id); };
  const docEl = makeElement('html');
  const bodyEl = makeElement('body');
  const store = new Map();
  // The demo flag itself lives in localStorage, so it is seeded BEFORE the script compiles:
  // `var __demoMode = ...localStorage.getItem('skipi_crewing_demo')` runs at compile time.
  if (demo) store.set('skipi_crewing_demo', '1');
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k), clear: () => store.clear(),
  };
  globalThis.document = {
    getElementById: (id) => (els.has(id) ? els.get(id) : null),
    querySelector: () => makeElement('query'), querySelectorAll: () => [],
    createElement: (tag) => makeElement(tag),
    addEventListener() {}, removeEventListener() {},
    head: elFor('head'), body: bodyEl, documentElement: docEl,
  };
  // appendChild must make the node findable by id, or renderDemoBanner can never see
  // an existing banner and the No.1880 drill would pass for the wrong reason.
  bodyEl.appendChild = (child) => { bodyEl.children.push(child); if (child && child.id) els.set(child.id, child); return child; };
  globalThis.window = globalThis;
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'language-harness', onLine: true, language: 'en' },
    configurable: true, writable: true,
  });
  globalThis.location = { hash: '#desktop', reload() {} };
  globalThis.setTimeout = (fn) => { if (typeof fn === 'function') fn(); return 1; };
  globalThis.setInterval = () => 1;
  globalThis.clearTimeout = () => {}; globalThis.clearInterval = () => {};
  globalThis.fetch = async () => ({ ok: false, status: 599, async json() { return {}; }, async text() { return ''; } });

  async function realInvoke(cmd, args = {}) {
    invokeCalls.push([cmd, args]);
    if (cmd === 'get_settings') return crewingPublicSettingsFixture(persisted);
    if (cmd === 'save_settings') {
      if (!args.expectedContext || args.expectedContext !== args.newSettings.connection_context) {
        throw new Error('settings_changed');
      }
      persisted = JSON.parse(JSON.stringify(args.newSettings));
      return crewingPublicSettingsFixture(persisted);
    }
    return null;
  }
  globalThis.__TAURI__ = { core: { invoke: realInvoke, convertFileSrc: (p) => `file://${p}` } };

  // The loader is looked up DEFENSIVELY so this harness fails on BEHAVIOUR, not on a
  // missing symbol: aimed at an unfixed page it must report "the saved choice lost to the
  // fixture", which is the contract, rather than crash on a name my fix happens to use.
  const M = new Function('showToast',
    scriptNoBoot + '\nreturn { state, getUiLang, setUiLang, tr, renderDemoBanner, DEMO, demoMode: __demoMode, UI_STRINGS,'
      + ' loadPersistedUiLanguage: (typeof loadPersistedUiLanguage === "function" ? loadPersistedUiLanguage : null) };'
  )((msg) => { toasts.push(String(msg)); });
  M.bodyEl = bodyEl;
  M.banner = () => (els.has('demo-banner') ? els.get('demo-banner') : null);
  // The exact boot order of the page: the saved language is learned BEFORE the first paint,
  // then state.settings is filled (in the demo, by the fixture).
  M.boot = async () => {
    if (M.loadPersistedUiLanguage) await M.loadPersistedUiLanguage();
    try { M.state.settings = await (globalThis.__demoInvokeForTest || realInvoke)('get_settings'); } catch (e) {}
    if (M.demoMode) M.state.settings = M.DEMO.settings;
    return M;
  };
  return M;
}

// =====================================================================
section('No.1881 (a) the SAVED language outranks the demo fixture');
// The fixture ships English; a person who chose Russian must get Russian.
{
  // The fixture's own value is READ, never assumed, and the saved choice is deliberately
  // set to the OPPOSITE one. The contract is "the saved choice wins over the fixture",
  // whatever the fixture happens to ship — No.1882 changed that value once already, and a
  // control pinned to 'en' would be measuring the fixture instead of the contract.
  persisted = {};
  const probe = await bootApp({ demo: true }).boot();
  const fixtureLang = probe.DEMO.settings.interface.language;
  const other = fixtureLang === 'ru' ? 'en' : 'ru';
  ok(!!probe.UI_STRINGS[fixtureLang], `the demo fixture ships a known language (${fixtureLang}) — control`);
  ok(probe.demoMode === true, 'demo mode is active for these cases (control: the flag was read)');

  persisted = { interface: { theme: 'light', language: other } };
  const M = await bootApp({ demo: true }).boot();
  ok(M.getUiLang() === other, `saved ${other} beats the fixture ${fixtureLang}`);

  // The mirror direction, so a pass cannot mean "always ${other}".
  persisted = { interface: { theme: 'light', language: fixtureLang } };
  const M2 = await bootApp({ demo: true }).boot();
  ok(M2.getUiLang() === fixtureLang, `saved ${fixtureLang} is honoured too (not "always ${other}")`);
}

section('No.1881 (b) a choice survives a RESTART, both directions');
for (const chosen of ['en', 'ru']) {
  persisted = { interface: { theme: 'light', language: chosen === 'en' ? 'ru' : 'en' } };
  const first = await bootApp({ demo: false }).boot();
  first.setUiLang(chosen);
  await new Promise((r) => setImmediate(r)); // the write is fire-and-forget
  // A restart: a FRESH localStorage (the ephemeral context) and the same disk store.
  const second = await bootApp({ demo: false }).boot();
  ok(second.getUiLang() === chosen, `${chosen}: chosen, then restart -> still ${chosen}`);
  ok(persisted.interface.language === chosen, `${chosen}: the DISK copy carries it (interface.language)`);
}

section('No.1881 (c) what is written, and that it is built from REAL settings');
{
  persisted = { interface: { theme: 'dark', language: 'ru' }, server_url: 'https://api.skipi.app', crewing_id: 'company-635' };
  const M = await bootApp({ demo: true }).boot();
  invokeCalls = [];
  M.setUiLang('en');
  await new Promise((r) => setImmediate(r));
  const saves = invokeCalls.filter(([cmd]) => cmd === 'save_settings');
  ok(saves.length === 1, 'exactly one save_settings call (the durable copy)');
  const sent = saves.length ? saves[0][1].newSettings : {};
  ok(saves.length > 0 && saves[0][1].expectedContext === sent.connection_context,
    'expectedContext matches the settings it was read from (the staleness token)');
  ok(sent.interface && sent.interface.language === 'en', 'the saved language is the chosen one');
  ok(sent.interface && sent.interface.theme === 'dark', 'the theme is PRESERVED, not reset to light');
  // The decisive safety property: in the demo, state.settings is the FIXTURE. If the write
  // were built from it, fixture values would land in a real profile — on a legacy profile
  // save_settings accepts far more than `interface`.
  ok(sent.server_url === 'https://api.skipi.app', 'the write carries the REAL server_url, not the fixture’s');
  ok(sent.crewing_id === 'company-635', 'the write carries the REAL crewing_id, not the fixture’s');
  ok(!toasts.some((t) => /demonstration|демонстрация/i.test(t)),
    'no "changes are not available" toast: the language bypasses the demo bridge');
}

section('No.1880 the demo banner follows the language');
{
  persisted = { interface: { theme: 'light', language: 'ru' } };
  const M = await bootApp({ demo: true }).boot();
  M.renderDemoBanner();
  const node = M.banner();
  ok(!!node, 'the banner node exists after the first render');
  const ru = M.UI_STRINGS.ru['demo.banner'];
  const en = M.UI_STRINGS.en['demo.banner'];
  ok(!!ru && !!en && ru !== en, 'the two banner strings exist and differ (calibration of the probe)');
  ok(node.innerHTML.includes(ru), 'at ru the banner shows the RUSSIAN text (positive control)');
  // The defect: a second render used to return early and leave the boot language.
  M.setUiLang('en');
  ok(M.banner().innerHTML.includes(en), 'after switching to en the banner shows the ENGLISH text');
  ok(!M.banner().innerHTML.includes(ru), 'and no longer shows the Russian text');
  M.setUiLang('ru');
  ok(M.banner().innerHTML.includes(ru), 'switching back to ru returns the Russian text');
  ok(!M.banner().innerHTML.includes(en), 'zero English banner strings on glass at ru');
  const before = M.bodyEl.children.length;
  M.renderDemoBanner();
  ok(M.bodyEl.children.length === before, 'repeated renders do not append a second banner');
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
