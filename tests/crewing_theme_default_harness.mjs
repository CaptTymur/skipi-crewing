// Crewing light-theme-default contract harness (skipi-ops BACKLOG №62).
//
// Canon = @skipi/settings commit 1a6748e (harness/theme-contract.mjs + CONTRACT.md):
//   1. No saved choice -> first boot is LIGHT.
//   2. A chosen dark applies immediately and survives restart.
//   3. A chosen light persists the same way.
//   4. No forced hardcoded dark anywhere — including plugin-bridge fallbacks.
//   5. Changes live strictly on the theme path. Normalization is case-insensitive
//      (legacy 'DARK' counts as dark, per canon); every other non-dark value
//      ('', 'system', 'blue', null) resolves to light.
//
//   node tests/crewing_theme_default_harness.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'dist/index.html'), 'utf8');

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) {
    pass++;
    console.log('  ✓ ' + msg);
  } else {
    fail++;
    console.error('  ✗ ' + msg);
  }
};
const section = (title) => console.log('\n# ' + title);

// =====================================================================
// (a) Static markup: the document itself ships light, never dark.
// =====================================================================
section('static markup');
ok(/<html\s+lang="ru"\s+data-theme="light">/.test(HTML), 'html tag carries data-theme="light"');
ok(!/<html[^>]*data-theme="dark"/.test(HTML), 'html tag never ships data-theme="dark"');

// =====================================================================
// (d) Plugin bridge: NO dark fallbacks anywhere in the document.
// The only legitimate 'dark' is an exact comparison against a saved value
// (=== 'dark' / ternary arms / option lists). Init values and || / return
// fallbacks must be 'light'.
// =====================================================================
section('plugin bridge — no dark fallbacks');
ok(!/theme\s*=\s*'dark'\s*[,;]/.test(HTML), "no init assignment theme = 'dark' (shim boot value must be light)");
ok(!/\|\|\s*'dark'/.test(HTML), "no || 'dark' fallback anywhere (init-message theme fallback must be light)");
ok(!/return\s+'dark'/.test(HTML), "no return 'dark' fallback anywhere (host themeApi stub must return light)");
// Positive shape of the fix: the three bridge spots fall back to light.
ok(/var slug = null, theme = 'light'/.test(HTML), "shim init: var ... theme = 'light'");
ok(/theme = m\.theme \|\| 'light'/.test(HTML), "shim init-message: theme = m.theme || 'light'");
ok(/\{ get: function \(\) \{ return 'light'; \} \}/.test(HTML), "runtime themeApi default: { get: ... return 'light' }");

// =====================================================================
// (e) Nothing removes or force-resets data-theme: exactly one guarded
// setter (applyTheme) and zero removals of the attribute.
// =====================================================================
section('data-theme attribute is never dropped or forced');
const setters = HTML.match(/setAttribute\(\s*['"]data-theme['"]/g) || [];
ok(setters.length === 1, 'exactly one data-theme setter in the app (found ' + setters.length + ')');
ok(/setAttribute\('data-theme',\s*t === 'dark' \? 'dark' : 'light'\)/.test(HTML),
   'the single setter is the guarded applyTheme ternary (dark only for saved dark)');
ok(!/removeAttribute\(\s*['"]data-theme['"]/.test(HTML), 'no code removes the data-theme attribute');

// =====================================================================
// Boot + desktop settings path (static wiring).
// =====================================================================
section('boot + desktop settings wiring');
// Boot reads are the try/catch-wrapped hydrations in bootMobile + the boot IIFE.
// (Mid-session refreshes — claimOwnerAccess, openSettings lazy hydrate — are not
// boots, never touch interface.theme, and the single-setter assert above already
// guarantees they cannot flip data-theme.)
const bootReads = [...HTML.matchAll(/try \{ state\.settings = await invoke\('get_settings'\); \} catch/g)];
ok(bootReads.length === 2, 'both boot paths (mobile + desktop) hydrate state.settings from get_settings (found ' + bootReads.length + ')');
ok(bootReads.length === 2 && bootReads.every((m) => {
  const tail = HTML.slice(m.index, m.index + 300);
  return tail.includes('applyTheme()');
}), 'each boot-time get_settings read is followed by applyTheme() (persisted choice applied on restart)');

const ssStart = HTML.indexOf('async function saveSettings()');
const ssEnd = HTML.indexOf('function escapeHtml', ssStart);
const ssBody = ssStart !== -1 && ssEnd !== -1 ? HTML.slice(ssStart, ssEnd) : '';
ok(ssStart !== -1, 'desktop saveSettings() exists');
ok(/theme:\s*pick\('i-theme',\s*iface\.theme\|\|'light'\)/.test(ssBody),
   "desktop saveSettings picks interface.theme from the settings dialog with a light fallback");
ok(ssBody.includes("await invoke('save_settings', { newSettings: newSettings })"),
   'desktop saveSettings persists via save_settings');
ok(ssBody.indexOf('applyTheme()') > ssBody.indexOf("invoke('save_settings'"),
   'desktop saveSettings applies the theme immediately after saving (no restart needed)');

// =====================================================================
// Runtime stand: compile the app script (boot section cut) against a
// recording DOM stub, exactly like the sibling harnesses do.
// =====================================================================
function makeElement(id) {
  return {
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    style: {},
    children: [],
    className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute(name, value) { this['@' + name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this, '@' + name) ? this['@' + name] : null; },
    removeAttribute(name) { delete this['@' + name]; },
    addEventListener() {},
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter((c) => c !== child); },
    insertBefore(child) { this.children.unshift(child); return child; },
    remove() {},
    focus() {},
    querySelector() { return makeElement(id + '-q'); },
    querySelectorAll() { return []; },
    scrollIntoView() {},
  };
}

const script = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .reduce((a, b) => (a.length > b.length ? a : b), '');
const bootIndex = script.indexOf('// ------------- boot -------------');
const scriptNoBoot = bootIndex > 0 ? script.slice(0, bootIndex) : script;
ok(bootIndex > 0, 'boot marker found (script compiled without auto-boot)');

// Cross-"restart" persistence: what the tauri backend would keep on disk.
let persisted = {};
const invokeCalls = [];

function bootApp() {
  // Fresh document/localStorage per boot; persisted settings survive.
  const els = new Map();
  const elFor = (id) => { if (!els.has(id)) els.set(id, makeElement(id)); return els.get(id); };
  const docEl = makeElement('html');
  docEl.setAttribute('data-theme', 'light'); // static markup ships light
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  globalThis.document = {
    getElementById: (id) => elFor(id),
    querySelector: () => makeElement('query'),
    querySelectorAll: () => [],
    createElement: (tag) => makeElement(tag),
    addEventListener() {},
    removeEventListener() {},
    head: elFor('head'),
    body: elFor('body'),
    documentElement: docEl,
  };
  globalThis.window = globalThis;
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'theme-harness', onLine: true, language: 'en' },
    configurable: true,
    writable: true,
  });
  globalThis.location = { hash: '#desktop', reload() {} };
  globalThis.setTimeout = (fn) => { if (typeof fn === 'function') fn(); return 1; };
  globalThis.setInterval = () => 1;
  globalThis.clearTimeout = () => {};
  globalThis.clearInterval = () => {};
  globalThis.fetch = async () => ({ ok: false, status: 599, async json() { return {}; }, async text() { return ''; } });

  async function invoke(cmd, args = {}) {
    invokeCalls.push([cmd, args]);
    if (cmd === 'get_settings') return JSON.parse(JSON.stringify(persisted));
    if (cmd === 'save_settings') { persisted = JSON.parse(JSON.stringify(args.newSettings || {})); return null; }
    return null;
  }
  globalThis.__TAURI__ = { core: { invoke, convertFileSrc: (p) => `file://${p}` } };

  const M = new Function(
    'invoke',
    'showToast',
    scriptNoBoot + '\nreturn { state, applyTheme, mobileSetTheme, saveSettings };'
  )(invoke, () => {});
  M.docEl = docEl;
  M.elFor = elFor;
  // Replicate the app boot theme sequence (the exact lines both boot paths run):
  //   state.settings = await invoke('get_settings'); applyTheme();
  M.boot = async () => { M.state.settings = await invoke('get_settings'); M.applyTheme(); };
  return M;
}

// =====================================================================
// (b) applyTheme matrix: light default, garbage -> light, saved dark -> dark.
// =====================================================================
section('runtime: applyTheme normalization matrix');
{
  const M = bootApp();
  await M.boot(); // persisted = {} -> first boot, no saved choice
  ok(M.docEl.getAttribute('data-theme') === 'light', 'first boot with no saved settings -> light');

  const cases = [
    [undefined, 'light', 'missing interface.theme -> light'],
    ['', 'light', "'' -> light"],
    ['system', 'light', "'system' -> light"],
    ['blue', 'light', "'blue' -> light"],
    [null, 'light', 'null -> light'],
    ['dark', 'dark', "exact 'dark' -> dark"],
    ['DARK', 'dark', "legacy 'DARK' normalizes to dark (canon: case-insensitive)"],
    ['light', 'light', "'light' -> light"],
  ];
  for (const [value, expected, label] of cases) {
    M.state.settings = { interface: { theme: value, language: 'en' } };
    M.applyTheme();
    ok(M.docEl.getAttribute('data-theme') === expected, 'applyTheme: ' + label);
  }
}

// =====================================================================
// (c) Mobile choice: dark saves + applies immediately, survives restart;
// switching back to light persists the same way.
// =====================================================================
section('runtime: mobile choice persists across restarts');
{
  persisted = {};
  let M = bootApp();
  await M.boot();
  ok(M.docEl.getAttribute('data-theme') === 'light', 'fresh install boots light');

  await M.mobileSetTheme('dark');
  const savedDark = invokeCalls.filter(([c]) => c === 'save_settings').pop();
  ok(!!savedDark && savedDark[1].newSettings.interface.theme === 'dark',
     "mobileSetTheme('dark') persists interface.theme='dark' via save_settings");
  ok(M.docEl.getAttribute('data-theme') === 'dark', "mobileSetTheme('dark') applies dark immediately (no restart)");

  M = bootApp(); // restart: fresh DOM, persisted settings survive
  ok(M.docEl.getAttribute('data-theme') === 'light', 'restart starts from static light markup');
  await M.boot();
  ok(M.docEl.getAttribute('data-theme') === 'dark', 'restart with saved dark -> dark (choice survives)');

  await M.mobileSetTheme('light');
  const savedLight = invokeCalls.filter(([c]) => c === 'save_settings').pop();
  ok(!!savedLight && savedLight[1].newSettings.interface.theme === 'light',
     "mobileSetTheme('light') persists interface.theme='light'");
  ok(M.docEl.getAttribute('data-theme') === 'light', 'switching back to light applies immediately');

  M = bootApp();
  await M.boot();
  ok(M.docEl.getAttribute('data-theme') === 'light', 'restart with saved light -> light');
}

// =====================================================================
// Desktop choice: settings dialog Save persists interface.theme and
// applies immediately (contract p.2 for the desktop path).
// =====================================================================
section('runtime: desktop settings Save applies + persists');
{
  persisted = {};
  let M = bootApp();
  await M.boot();
  M.elFor('i-theme').value = 'dark';
  M.elFor('i-lang').value = 'en';
  await M.saveSettings();
  const saved = invokeCalls.filter(([c]) => c === 'save_settings').pop();
  ok(!!saved && saved[1].newSettings.interface.theme === 'dark',
     "desktop Save persists interface.theme='dark' via save_settings");
  ok(M.docEl.getAttribute('data-theme') === 'dark', 'desktop Save applies dark immediately (no restart)');

  M = bootApp();
  await M.boot();
  ok(M.docEl.getAttribute('data-theme') === 'dark', 'restart after desktop dark Save -> dark');
}

console.log('\ncrewing_theme_default_harness: ' + (fail === 0 ? 'GREEN' : 'RED') + ' (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail === 0 ? 0 : 1);
