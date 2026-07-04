// Presence contract for Skipi Crewing required modules.
//
// Closes the "module silently disappears from UI" regression class before
// light-theme and Family UI work. A required module removed, renamed, hidden
// inline, hidden by stylesheet, or dropped from the manifest turns this red.
//
//   node tests/crewing_presence_contract_harness.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const REQUIRED_FLOOR = ['vacancies', 'mailings', 'compliance', 'team', 'seafarers', 'documents', 'apps', 'settings'];
const GLOBAL_CSS_TOKENS = ['.mod-tab', '.modules-bar', '.mobile-nav-btn', '.mobile-bottom-nav', '.mobile-module-rail'];
const ALLOWED_HIDING_SCOPES = ['body.launching', 'body.mobile-shell'];

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

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'presence-manifest.json'), 'utf8'));
const HTML = fs.readFileSync(path.join(ROOT, manifest.artifact || 'dist/index.html'), 'utf8');

section('manifest integrity — required floor cannot be dropped');
ok(manifest.schema_version === 'skipi.presence-manifest.v1', 'schema_version is skipi.presence-manifest.v1');
ok(manifest.home === 'crewing', 'home is crewing');
ok(manifest.artifact === 'dist/index.html', 'artifact is dist/index.html');
const modIds = (manifest.required_modules || []).map((m) => m.id);
for (const id of REQUIRED_FLOOR) ok(modIds.includes(id), 'manifest still lists required module: ' + id);
for (const m of manifest.required_modules || []) {
  const desktop = m.desktop_navigation || {};
  ok(!!(m.id && m.name && desktop.route && desktop.nav_selector && desktop.route_driver),
    (m.id || '?') + ': manifest entry has id/name/desktop route/nav_selector/route_driver');
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function selectorToken(selector) {
  const s = String(selector || '').trim();
  let m = s.match(/^\[([A-Za-z0-9_-]+)="([^"]*)"\]$/);
  if (m) return { kind: 'attr', token: m[1] + '="' + m[2] + '"' };
  m = s.match(/^#([A-Za-z0-9_-]+)$/);
  if (m) return { kind: 'id', token: 'id="' + m[1] + '"' };
  m = s.match(/^\.([A-Za-z0-9_-]+)$/);
  if (m) return { kind: 'class', token: m[1] };
  return { kind: 'raw', token: s };
}

function openingTagForSelector(selector) {
  const { kind, token } = selectorToken(selector);
  let re;
  if (kind === 'class') {
    re = new RegExp('<[^>]*class\\s*=\\s*"[^"]*\\b' + escapeRe(token) + '\\b[^"]*"[^>]*>');
  } else {
    re = new RegExp('<[^>]*' + escapeRe(token) + '[^>]*>');
  }
  const m = HTML.match(re);
  return m ? m[0] : null;
}

const HIDING_DECL = /(?:^|[;{\s])(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d])|(?:width|height)\s*:\s*0(?:px)?\s*(?:;|$))/i;

function tagIsHidden(tag) {
  const style = (tag.match(/style\s*=\s*"([^"]*)"/i) || [])[1] || '';
  if (/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d])/i.test(style)) return 'inline style hides it: ' + style;
  if (/\shidden(?=[\s>=])/i.test(tag) && !/aria-hidden/i.test(tag.match(/\shidden[^\s>]*/i)[0])) return 'hidden attribute';
  if (/aria-hidden\s*=\s*"true"/i.test(tag)) return 'aria-hidden="true"';
  const cls = (tag.match(/class\s*=\s*"([^"]*)"/i) || [])[1] || '';
  if (/\b(hidden|is-hidden|sr-only)\b/.test(cls)) return 'hiding class: ' + cls;
  return null;
}

function cssRules() {
  const styles = [...HTML.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const flat = styles.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '\n');
  const rules = [];
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) rules.push({ selector: m[1].trim(), body: m[2] });
  return rules;
}
const RULES = cssRules();

function cssHidesToken(token) {
  return RULES.filter((r) =>
    r.selector.includes(token) &&
    !ALLOWED_HIDING_SCOPES.some((scope) => r.selector.includes(scope)) &&
    !r.selector.includes('::') &&
    HIDING_DECL.test(r.body)
  );
}

section('static perimeter — nav present, not hidden inline, not hidden by CSS');
for (const token of GLOBAL_CSS_TOKENS) {
  const bad = cssHidesToken(token);
  ok(bad.length === 0, 'no stylesheet rule hides shared chrome ' + token + (bad.length ? ' — ' + bad[0].selector : ''));
}

for (const m of manifest.required_modules || []) {
  const navs = [m.desktop_navigation, m.mobile_navigation].filter(Boolean);
  for (const nav of navs) {
    if (nav.route_driver === 'mobileShow' || nav.route_driver === 'mobileOpenSettingsHome') {
      const routePattern = nav.route === 'settings'
        ? /data-mview="settings"[\s\S]*mobileOpenSettingsHome\(\)/
        : new RegExp("mobileNavButton\\('" + escapeRe(nav.route) + "'");
      ok(routePattern.test(HTML), m.name + ': mobile navigation source exists for ' + nav.route);
    } else {
      const tag = openingTagForSelector(nav.nav_selector);
      ok(!!tag, m.name + ': desktop nav element exists (' + nav.nav_selector + ')');
      if (tag) {
        const hidden = tagIsHidden(tag);
        ok(!hidden, m.name + ': desktop nav element is not hidden' + (hidden ? ' — ' + hidden : ''));
      }
    }
  }
  for (const token of m.css_tokens || []) {
    const bad = cssHidesToken(token);
    ok(bad.length === 0, m.name + ': no stylesheet rule hides "' + token + '"' + (bad.length ? ' — ' + bad[0].selector : ''));
  }
}

section('static surface markers');
for (const m of manifest.required_modules || []) {
  for (const marker of m.surface_markers || []) {
    ok(HTML.includes(marker), m.name + ': source contains surface marker ' + JSON.stringify(marker));
  }
}

// Lightweight runtime smoke: load the real script without the boot IIFE, install
// a permissive fake DOM, then call desktop/mobile route drivers. The goal is to
// catch deleted route drivers or routes that throw immediately.
function makeElement(id) {
  return {
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    style: {},
    children: [],
    className: '',
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; },
    },
    setAttribute(name, value) { this[name] = String(value); },
    getAttribute(name) { return this[name] || null; },
    addEventListener() {},
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter((c) => c !== child); },
    remove() {},
    focus() {},
    querySelector() { return makeElement(id + '-q'); },
    querySelectorAll() { return []; },
  };
}
const els = new Map();
function elFor(id) {
  if (!els.has(id)) els.set(id, makeElement(id));
  return els.get(id);
}
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
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
  documentElement: { getAttribute: () => 'light', setAttribute() {} },
};
globalThis.window = globalThis;
globalThis.__TAURI__ = {
  core: {
    invoke: async (cmd) => {
      if (cmd === 'get_settings') return {};
      if (cmd === 'fetch_my_vacancies') return [];
      if (cmd === 'fetch_my_mailing_requests') return [];
      if (cmd === 'fetch_compliance_profiles') return [];
      if (cmd === 'list_saved_seafarers') return [];
      if (cmd === 'list_documents') return [];
      if (cmd === 'list_team_members') return [];
      return null;
    },
    convertFileSrc: (path) => `file://${path}`,
  },
};
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'presence-harness', onLine: true },
  configurable: true,
  writable: true,
});
globalThis.location = { hash: '#desktop', reload() {} };
globalThis.setTimeout = (fn) => { if (typeof fn === 'function') fn(); return 1; };
globalThis.setInterval = () => 1;
globalThis.clearTimeout = () => {};
globalThis.fetch = async () => ({ ok: false, status: 599, async json() { return {}; }, async text() { return ''; } });

const blocks = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const script = blocks.reduce((a, b) => (a.length > b.length ? a : b), '');
const bootIndex = script.indexOf('// ------------- boot -------------');
const scriptNoBoot = bootIndex > 0 ? script.slice(0, bootIndex) : script;
const exportsNeeded = [
  'state',
  'showView',
  'openSettings',
  'mobileShow',
  'mobileOpenSettingsHome',
];
let M = null;
try {
  M = new Function(
    'invoke',
    'showToast',
    scriptNoBoot + '\nreturn {' + exportsNeeded.join(',') + '};'
  )(
    async (cmd) => {
      if (cmd === 'get_settings') return {};
      if (cmd === 'fetch_my_vacancies') return [];
      if (cmd === 'fetch_my_mailing_requests') return [];
      if (cmd === 'fetch_compliance_profiles') return [];
      if (cmd === 'list_saved_seafarers') return [];
      if (cmd === 'list_documents') return [];
      if (cmd === 'list_team_members') return [];
      return null;
    },
    () => {}
  );
} catch (e) {
  console.error('runtime load failed:', e);
}

section('runtime route drivers');
ok(!!M, 'real inline script loads without boot IIFE');
if (M) {
  M.state.settings = {
    server_url: 'https://api.skipi.app',
    bearer_token: 'TOKEN-DO-NOT-LEAK',
    crewing_id: 'presence-harness',
    token_scopes: ['team:read', 'team:write'],
    interface: { theme: 'light', language: 'en' },
  };
  for (const m of manifest.required_modules || []) {
    const desktop = m.desktop_navigation || {};
    let err = null;
    try {
      if (desktop.route_driver === 'openSettings') M.openSettings();
      else M.showView(desktop.route);
    } catch (e) {
      err = e;
    }
    ok(!err, m.name + ': desktop route runs without throwing' + (err ? ' — ' + err : ''));

    const mobile = m.mobile_navigation || null;
    if (mobile) {
      err = null;
      try {
        if (mobile.route_driver === 'mobileOpenSettingsHome') M.mobileOpenSettingsHome();
        else M.mobileShow(mobile.route);
      } catch (e) {
        err = e;
      }
      ok(!err, m.name + ': mobile route runs without throwing' + (err ? ' — ' + err : ''));
    }
  }
}

console.log('\ncrewing_presence_contract_harness: ' + (fail === 0 ? 'GREEN' : 'RED') + ' (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail === 0 ? 0 : 1);
