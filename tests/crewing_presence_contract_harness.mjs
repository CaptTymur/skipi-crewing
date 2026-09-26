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

const HARNESS_SOURCE = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');

const REQUIRED_FLOOR = ['crew_flow', 'compliance', 'seafarers', 'documents', 'apps', 'settings'];
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
      // Canonical 5-slot rail (CANON-mobile-unified-standard-v1): modules off
      // the rail (compliance/documents) stay reachable via the mobile Apps-grid
      // module tiles; Settings enters only via the header gear. The manifest is
      // untouched — this assert accepts any of those navigation sources.
      const routePattern = nav.route === 'settings'
        ? /onclick="mobileOpenSettingsHome\(\)"/
        : new RegExp("mobileNavButton\\('" + escapeRe(nav.route) + "'|data-qa=\"apps-module-tile-" + escapeRe(nav.route) + '"');
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
      if (cmd === 'save_settings') return 'ok';
      if (cmd === 'sync_crewing_profile') return 'synced';
      if (cmd === 'activate_crewing_token') return {
        crewing_id: 'presence-harness',
        organization_id: 'org-presence',
        display_name: 'Presence Harness Crewing',
        scopes: ['applications:read'],
        expires_at: '2026-12-31T00:00:00Z',
      };
      if (cmd === 'issue_crewing_trial_token') return {
        token: 'TRIAL-TOKEN',
        crewing_id: 'trial-crewing',
        organization_id: 'trial-org',
        scopes: ['applications:read'],
        expires_at: '2026-08-07T00:00:00Z',
      };
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
  'closeSettings',
  'saveSettings',
  'mobileShow',
  'mobileOpenSettings',
  'mobileOpenSettingsHome',
  'mobileSaveConnection',
  'mobileSetTheme',
  'mobileSetLanguage',
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
      if (cmd === 'save_settings') return 'ok';
      if (cmd === 'sync_crewing_profile') return 'synced';
      if (cmd === 'activate_crewing_token') return {
        crewing_id: 'presence-harness',
        organization_id: 'org-presence',
        display_name: 'Presence Harness Crewing',
        scopes: ['applications:read'],
        expires_at: '2026-12-31T00:00:00Z',
      };
      if (cmd === 'issue_crewing_trial_token') return {
        token: 'TRIAL-TOKEN',
        crewing_id: 'trial-crewing',
        organization_id: 'trial-org',
        scopes: ['applications:read'],
        expires_at: '2026-08-07T00:00:00Z',
      };
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

section('settings 5-section shell anti-regression');
if (M) {
  M.state.settings = {
    server_url: 'https://api.skipi.app',
    bearer_token: 'TOKEN-DO-NOT-LEAK',
    crewing_id: 'presence-harness',
    organization_id: 'org-presence',
    company_name: 'Presence Harness Crewing',
    reply_to: 'hr@example.test',
    vault_path: '/tmp/skipi-crewing-vault',
    recent_vaults: ['/tmp/skipi-crewing-old-vault'],
    token_scopes: ['team:read', 'team:write'],
    token_expires_at: '2026-12-31T00:00:00Z',
    profile: {
      legal_name: 'Presence Harness LLC',
      jurisdiction: 'GE',
      registration_number: 'REG-123',
      mlc_cert_number: 'MLC-123',
      mlc_cert_valid_to: '2027-01-01',
      contact_email: 'contact@example.test',
      contact_phone: '+995 555',
      slug: 'presence-harness',
      public_description: 'Harness profile',
    },
    interface: { theme: 'light', language: 'en' },
  };

  store.delete('skipi_crewing_settings5');
  await M.openSettings();
  const legacyDesktop = elFor('modal-host').innerHTML;
  ok(!legacyDesktop.includes('settings5-shell'), 'flag-off desktop keeps legacy settings renderer');
  // K2 (OWNER (654)/(658)): the legacy work settings page retired with the
  // vacancies/mailings modules; the remaining legacy sections still must exist.
  ['Организация', 'Данные организации', 'Сопряжённые устройства', 'Доступ / токены', 'Приложение'].forEach((label) => {
    ok(legacyDesktop.includes(label), 'flag-off legacy desktop settings still includes ' + label);
  });
  M.mobileOpenSettingsHome();
  const legacyMobileList = elFor('mobile-main').innerHTML;
  ok(legacyMobileList.includes('Данные организации'), 'flag-off mobile keeps the legacy organization-data settings page');

  store.set('skipi_crewing_settings5', '1');
  await M.openSettings('modules');
  const fiveDesktop = elFor('modal-host').innerHTML;
  ok(fiveDesktop.includes('data-qa="settings5-shell"'), 'flag-on desktop renders settings5 shell');
  const topLevelRootMatches = fiveDesktop.match(/data-qa="settings\.(modules|identity|storage|appearance|paid)\.root"/g) || [];
  ok(topLevelRootMatches.length === 5, 'flag-on desktop exposes exactly five top-level settings sections');
  ['Modules / Apps', 'Identity / Access', 'Storage / Vault', 'Appearance / Language', 'Paid Service'].forEach((label) => {
    ok(fiveDesktop.includes(label), 'flag-on desktop top-level label present: ' + label);
  });
  ok(fiveDesktop.includes('data-qa="settings.modules.sources"'), 'Sources is nested under Modules / Apps');
  ok(fiveDesktop.includes('data-qa="settings.about.footer"'), 'Diagnostics/About is a footer, not top-level');
  ok(!fiveDesktop.includes('settings.sources.root') && !fiveDesktop.includes('settings.privacy.root') && !fiveDesktop.includes('settings.diagnostics.root'), 'Sources/Privacy/Diagnostics are not top-level QA roots');
  ok(!fiveDesktop.includes('Вакансии / Рассылки'), 'flag-on desktop shell does not carry legacy work-content tab');

  const desktopSections = {
    modules: {
      ids: ['s-reply'],
      tokens: ['openMailboxSettings', "showView('apps')", 'settings.modules.sources'],
    },
    identity: {
      ids: ['s-company', 'p-email', 'p-phone', 'p-legal', 'p-jur', 'p-reg', 'p-mlc', 'p-mlc-to', 'p-slug', 'p-public-desc', 's-url', 's-token', 's-crewing-id'],
      tokens: ['activateCompanyToken', 'Login model', 'RBAC hierarchy', 'Trust Score', 'settings.identity.privacy'],
    },
    storage: {
      ids: [],
      tokens: ['createNamedCrewingVault', 'openVaultPickerInline', "switchToVault('')", 'forgetVault', "openConnectDialog({context:'device'})", 'settings.storage.sync'],
    },
    appearance: {
      ids: ['i-theme', 'i-lang'],
      tokens: ['Appearance / Language'],
    },
    paid: {
      ids: [],
      tokens: ['startTrialAccess', 'Paid Service', 'AI Assistant'],
    },
  };
  for (const [sectionId, spec] of Object.entries(desktopSections)) {
    await M.openSettings(sectionId);
    const html = elFor('modal-host').innerHTML;
    for (const id of spec.ids) ok(html.includes('id="' + id + '"'), 'settings5 desktop ' + sectionId + ' mounts #' + id);
    for (const token of spec.tokens) ok(html.includes(token), 'settings5 desktop ' + sectionId + ' contains ' + token);
    ok(html.includes('data-qa="app-build-sha"'), 'settings5 desktop ' + sectionId + ' keeps app-build-sha in footer');
    ok(html.includes('checkForUpdatesManual') && html.includes("openFeedbackDialog('about')"), 'settings5 desktop ' + sectionId + ' keeps About actions in footer');
  }

  let saveErr = null;
  try {
    await M.openSettings('identity');
    await M.saveSettings();
  } catch (e) {
    saveErr = e;
  }
  ok(!saveErr, 'settings5 desktop saveSettings path does not throw' + (saveErr ? ' — ' + saveErr : ''));

  M.mobileOpenSettingsHome();
  const fiveMobileList = elFor('mobile-main').innerHTML;
  ['Modules / Apps', 'Identity / Access', 'Storage / Vault', 'Appearance / Language', 'Paid Service'].forEach((label) => {
    ok(fiveMobileList.includes(label), 'flag-on mobile top-level label present: ' + label);
  });
  ok(fiveMobileList.includes('data-qa="settings.about.footer"'), 'flag-on mobile nests Diagnostics/About footer');
  ok(!fiveMobileList.includes('Вакансии / Рассылки'), 'flag-on mobile shell does not carry legacy work-content row');

  const mobileSections = {
    modules: ['id="m-reply"', 'openMailboxSettings', 'settings.modules.sources'],
    identity: ['id="m-company"', 'id="m-server-url"', 'id="m-token"', 'id="m-crewing-id"', 'Login model', 'RBAC hierarchy', 'Trust Score', 'settings.identity.privacy'],
    storage: ["openConnectDialog({context:'device'})", 'settings.storage.sync'],
    appearance: ['mobileSetTheme', 'mobileSetLanguage'],
    paid: ['mobileStartTrialAccess', 'Paid Service'],
  };
  for (const [sectionId, tokens] of Object.entries(mobileSections)) {
    M.mobileOpenSettings(sectionId);
    const html = elFor('mobile-main').innerHTML;
    for (const token of tokens) ok(html.includes(token), 'settings5 mobile ' + sectionId + ' contains ' + token);
  }

  elFor('m-server-url').value = 'https://api.skipi.app';
  elFor('m-token').value = 'TOKEN-DO-NOT-LEAK';
  elFor('m-crewing-id').value = 'presence-harness';
  elFor('m-company').value = 'Presence Harness Crewing';
  let mobileSaveErr = null;
  try {
    M.mobileOpenSettings('identity');
    await M.mobileSaveConnection(false);
    await M.mobileSetTheme('dark');
    await M.mobileSetLanguage('en');
  } catch (e) {
    mobileSaveErr = e;
  }
  ok(!mobileSaveErr, 'settings5 mobile save/theme/language paths do not throw' + (mobileSaveErr ? ' — ' + mobileSaveErr : ''));

  // K2 (owner654/658, 2026-09-24): the legacy work modules (vacancies, mailings) are retired from the product;
  // the presence floor for them is intentionally dropped together with the manifest entries (PR-P).
  for (const id of ['vacancies', 'mailings']) {
    ok(!modIds.includes(id), 'retired work module is no longer listed in the presence manifest (K2): ' + id);
  }

  // K2.1 (owner739, 2026-09-26): the personal mailbox module (mail) is retired as well — intake lives on the
  // server and letters surface in Crew Flow; its floor entry leaves together with the manifest entry (PR-P2).
  ok(!modIds.includes('mail'), 'retired mailbox module is no longer listed in the presence manifest (K2.1): mail');
}

// ===== mobile rail canon (CANON-mobile-unified-standard-v1; Crewing layout =====
// OWNER 23.07 + 07.08 + №101 19.08 "Крю флоу занимает зарезервированный слот"):
// exactly 5 fixed slots, Apps last, canonical bottom-nav-<view> QA, no "More"
// slot, no rail scroll mechanics; off-rail modules reachable from the mobile
// Apps grid whose module tiles precede plugin tiles.
// History of the composition, kept in full — the rule above never changed, only
// which five modules fill it:
//   until K2 (OWNER 23.07 / 07.08 / №101 19.08): Vacancies · Mailings ·
//     Seafarers · Crew Flow · Apps, with Requirements/Documents off the rail.
//   from K2 (OWNER (654) composition + (658) "K2 first", 2026-09-24): the work
//     modules (vacancies, mailings) are retired from the product, Crew Flow
//     becomes the home module and takes the first slot, and the freed slots go
//     to Compliance and Documents:
//       crew_flow · compliance · seafarers · documents · apps.
//     №101's guarantee is unchanged: Crew Flow still holds a reserved slot.
// S4: the comment block above is the only record of WHY the rail is what it is;
// a canon change that leaves it untouched silently rewrites history. Scoped to
// the CONSECUTIVE comment lines of that block only — a looser match would read
// these assertions themselves and pass on its own source (measured, 2026-09-24).
const RAIL_PROVENANCE = (() => {
  const lines = HARNESS_SOURCE.split('\n');
  const start = lines.findIndex((l) => l.startsWith('// ===== mobile rail canon'));
  if (start < 0) return '';
  const out = [];
  for (let i = start; i < lines.length && lines[i].startsWith('//'); i += 1) out.push(lines[i]);
  return out.join('\n');
})();
ok(RAIL_PROVENANCE !== '', 'the rail provenance comment block is present');
ok(/\(654\)/.test(RAIL_PROVENANCE) && /\(658\)/.test(RAIL_PROVENANCE),
  'the rail provenance comment records the K2 decision (654)/(658)');
ok(/crew_flow[\s\S]*compliance[\s\S]*seafarers[\s\S]*documents[\s\S]*apps/.test(RAIL_PROVENANCE),
  'the provenance comment states the rail composition it is protecting');
ok(/23\.07/.test(RAIL_PROVENANCE) && /07\.08/.test(RAIL_PROVENANCE) && /\u2116101/.test(RAIL_PROVENANCE),
  'the older rail provenance (OWNER 23.07 / 07.08 / \u2116101) is kept, not replaced');

section('mobile rail canon — 5 fixed slots, canonical QA, no scroll');
if (M) {
  M.state.settings = {
    server_url: 'https://api.skipi.app',
    bearer_token: 'TOKEN-DO-NOT-LEAK',
    crewing_id: 'presence-harness',
    interface: { theme: 'light', language: 'en' },
  };
  M.mobileShow('vacancies');
  const chrome = elFor('mobile-root').innerHTML;
  const railHtml = (chrome.match(/<nav class="mobile-bottom[\s\S]*?<\/nav>/) || [''])[0];
  ok(!!railHtml, 'mobile chrome renders the bottom rail');
  const railBtns = [...railHtml.matchAll(/<button[^>]*data-mview="([^"]+)"[^>]*>/g)];
  const railViews = railBtns.map((b) => b[1]);
  ok(railViews.join(',') === 'crew_flow,compliance,seafarers,documents,apps',
    'rail renders exactly 5 buttons in canonical order crew_flow,compliance,seafarers,documents,apps — got [' + railViews.join(',') + ']');
  const railQa = railBtns.map((b) => (b[0].match(/data-qa="([^"]+)"/) || [])[1] || '(none)');
  ok(railQa.join(',') === 'bottom-nav-crew_flow,bottom-nav-compliance,bottom-nav-seafarers,bottom-nav-documents,bottom-nav-apps',
    'rail buttons carry canonical bottom-nav-<view> QA slugs — got [' + railQa.join(',') + ']');
  ok(railViews[railViews.length - 1] === 'apps' && railQa[railQa.length - 1] === 'bottom-nav-apps',
    'last rail slot is Apps');
  ok(!railHtml.includes('bottom-nav-more') && !railHtml.includes('data-mview="settings"') && !railHtml.includes('mobileOpenSettingsHome'),
    'rail has no "More"/Settings slot (settings enters only via header gear)');
  ok(!railHtml.includes('bottom-nav-home') && !railHtml.includes('bottom-nav-workspace'),
    'no legacy bottom-nav-home / bottom-nav-workspace slugs on the rail');
  const headerHtml = (chrome.match(/<header[\s\S]*?<\/header>/) || [''])[0];
  ok(/class="mobile-top-home[^"]*"[^>]*onclick="mobileShow\('crew_flow'\)"/.test(headerHtml),
    'header keeps home button (mobile-top-home → crew_flow)');
  ok(headerHtml.includes('mobileOpenSettingsHome()'), 'header keeps settings gear (mobileOpenSettingsHome)');

  // Rail scroll mechanics removed: no horizontal overflow, no scroll-snap, no hint arrows.
  const railRules = RULES.filter((r) => r.selector.includes('.mobile-module-rail'));
  ok(railRules.length > 0, 'rail CSS rules exist');
  const scrollRules = railRules.filter((r) => /overflow-x\s*:\s*(auto|scroll)/i.test(r.body));
  ok(scrollRules.length === 0, 'rail CSS has no overflow-x auto/scroll' + (scrollRules.length ? ' — ' + scrollRules[0].selector : ''));
  const snapRules = RULES.filter((r) => (r.selector.includes('.mobile-module-rail') || r.selector.includes('.mobile-nav-btn')) && /scroll-snap/i.test(r.body));
  ok(snapRules.length === 0, 'rail CSS has no scroll-snap' + (snapRules.length ? ' — ' + snapRules[0].selector : ''));
  ok(!HTML.includes('.mobile-module-rail-wrap::before') && !HTML.includes('.mobile-module-rail-wrap::after'),
    'rail scroll hint arrows (::before/::after) removed');

  // Mobile Apps grid: module tiles (incl. Requirements/Documents off the rail) precede plugins.
  const bodyEl = elFor('body');
  const origContains = bodyEl.classList.contains;
  bodyEl.classList.contains = (c) => c === 'mobile-shell';
  M.mobileShow('apps');
  bodyEl.classList.contains = origContains;
  const appsHtml = elFor('mobile-main').innerHTML;
  const tileOrder = [...appsHtml.matchAll(/data-qa="apps-module-tile-([a-z_]+)"/g)].map((m) => m[1]);
  ok(tileOrder.join(',') === 'seafarers,crew_flow,compliance,documents',
    'mobile Apps grid shows module tiles seafarers,crew_flow,compliance,documents — got [' + tileOrder.join(',') + ']');
  const firstModuleTile = appsHtml.indexOf('data-qa="apps-module-tile-');
  const pluginRegion = appsHtml.indexOf('id="apps-launch-body"');
  ok(firstModuleTile !== -1 && pluginRegion !== -1 && firstModuleTile < pluginRegion,
    'module tiles precede the plugin region in the mobile Apps grid');
  const complianceTile = (appsHtml.match(/<button[^>]*data-qa="apps-module-tile-compliance"[^>]*>/) || [''])[0];
  const documentsTile = (appsHtml.match(/<button[^>]*data-qa="apps-module-tile-documents"[^>]*>/) || [''])[0];
  ok(complianceTile.includes("mobileShow('compliance')"), 'Requirements tile routes via mobileShow(compliance)');
  ok(documentsTile.includes("mobileShow('documents')"), 'Documents tile routes via mobileShow(documents)');
} else {
  ok(false, 'mobile rail canon checks require runtime module (script failed to load)');
}

console.log('\ncrewing_presence_contract_harness: ' + (fail === 0 ? 'GREEN' : 'RED') + ' (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail === 0 ? 0 : 1);
