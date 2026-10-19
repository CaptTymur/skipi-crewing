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

const REQUIRED_FLOOR = ['crew_flow', 'compliance', 'seafarers', 'settings'];
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
  'mobileBack',
  'mobileState',
  '_crewingSettingsSections',
  '_crewingSettingsSectionFor',
  // An expression, not a bare name: before the fix exists this identifier is undeclared,
  // and a bare name here throws at construction, nulls M and cancels ~250 unrelated
  // assertions — a failing-first test must not take the rest of the suite with it.
  'uiPluralCategory: (typeof uiPluralCategory === "function" ? uiPluralCategory : null)',
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
      tokens: ['openMailboxSettings', 'settings.modules.sources'],
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
    // K2.2 L1: the settings5 "Open Apps" row left with the module — no route into Apps from Settings.
    if (sectionId === 'modules') ok(!/showView\(['"]apps['"]\)|Open Apps|Apps launcher/.test(html), 'settings5 desktop modules has no Open Apps entry (K2.2 L1)');
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
    if (sectionId === 'modules') ok(!/mobileShow\(['"]apps['"]\)|Open Apps|Apps launcher/.test(html), 'settings5 mobile modules has no Open Apps entry (K2.2 L1)');
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

  // K2.2 (OWNER 2026-09-27, "Apps и Documents тоже пока убираем из сборки"): Documents and Apps leave the
  // build — their floor entries leave with the manifest entries (presence-only PR-P3); the dist follows in
  // PR-K22a on the crewing-k2-modules route, where the bar, the rail and the Apps-grid tile are removed.
  for (const id of ['documents', 'apps']) {
    ok(!modIds.includes(id), 'retired module is no longer listed in the presence manifest (K2.2): ' + id);
  }
  ok(modIds.join(',') === 'crew_flow,compliance,seafarers,settings',
    'the presence floor after K2.2 is exactly crew_flow,compliance,seafarers,settings — got [' + modIds.join(',') + ']');
  // PR-K22a: the dist follows the manifest — bar, rail and Apps-grid tile lose Documents/Apps.
  ok(!HTML.includes('id="mt-documents"') && !HTML.includes('id="mt-apps"'), 'K2.2: the desktop bar has no Documents/Apps tab');
  ok(!/mobileNavButton\('documents'|mobileNavButton\('apps'/.test(HTML), 'K2.2: the mobile rail builds no Documents/Apps slot');

  // K2.2 B1 (Supervisor, 2026-09-27): a retired module must not stay reachable through "Back".
  // The mobile shell has two return tables — the mobileParentView map and the explicit branches of
  // mobileBack() — plus detail-screen fallbacks that jump to a list. The property, not a pin: every
  // return target is a module the manifest still lists, or one of the two onboarding hubs
  // (connection, work_role) that are screens, not modules. A module retired tomorrow drops out of
  // the manifest and its return entries turn red here on their own.
  const RETURN_HUBS = ['connection', 'work_role'];
  const allowedReturnTargets = new Set([...modIds, ...RETURN_HUBS]);
  const parentMapSrc = (HTML.match(/function mobileParentView\(view\) \{\s*var map = \{([\s\S]*?)\};/) || [])[1] || '';
  ok(parentMapSrc.length > 0, 'B1: the mobileParentView map is found');
  const parentEntries = [...parentMapSrc.matchAll(/([a-z_]+):\s*'([a-z_]+)'/g)].map((m) => ({ view: m[1], parent: m[2] }));
  // L2 (Supervisor): an exact key list, not a floor — a vanished entry must turn red, not shrink the count.
  const EXPECTED_PARENT_KEYS = ['vacancy', 'mailing', 'mailing_new', 'compliance_profile', 'compliance_form', 'seafarer', 'document', 'crew_flow_signal', 'draft', 'intake_pilot', 'member_join', 'work_role'];
  ok(parentEntries.map((e) => e.view).join(',') === EXPECTED_PARENT_KEYS.join(','),
    'B1/L2: the mobileParentView map has exactly the expected keys in order — got [' + parentEntries.map((e) => e.view).join(',') + ']');
  for (const e of parentEntries) {
    ok(allowedReturnTargets.has(e.parent), 'B1: Back from "' + e.view + '" returns to a listed module or hub, not to a retired one — parent is "' + e.parent + '"');
  }
  const backSrc = (HTML.match(/function mobileBack\(\) \{([\s\S]*?)\n\}/) || [])[1] || '';
  ok(backSrc.length > 0, 'B1: mobileBack() is found');
  const backTargets = [...backSrc.matchAll(/mobileShow\('([a-z_]+)'\)/g)].map((m) => m[1]);
  ok(backTargets.length >= 1, 'B1: mobileBack() has explicit branches — got ' + backTargets.length);
  for (const t of [...new Set(backTargets)]) {
    ok(allowedReturnTargets.has(t), 'B1: an explicit mobileBack() branch returns to a listed module or hub — target is "' + t + '"');
  }
  // Retired modules (K2: vacancies, mailings; K2.1: mail; K2.2: documents, apps) must have NO navigation
  // call site left anywhere in the dist — not a Back branch, not a detail-screen fallback, not a link.
  const RETIRED_MODULES = ['vacancies', 'mailings', 'mail', 'documents', 'apps'];
  for (const id of RETIRED_MODULES) {
    ok(!modIds.includes(id), 'B1: retired module is not in the manifest (list kept in sync): ' + id);
    // Textual, quote-form tolerant ('x', "x", \'x\' inside JS strings) — a supplement to the behavioural
    // probe below, never the proof on its own (Supervisor B2: a variable, join('') or a wrapper slips past text).
    // Mobile driver: every retired module. Desktop driver: the K2.2 modules; the desktop showView('vacancies'/
    // 'mailings') sites inside the retired K2 screens themselves are the L3 sanitary debt (Supervisor audit
    // 2026-09-27 §4), not a live entry — the behavioural scan below renders the live desktop screens instead.
    const drivers = (id === 'documents' || id === 'apps') ? '(mobileShow|showView)' : 'mobileShow';
    const sites = HTML.match(new RegExp(drivers + "\\(\\\\?[\"']" + id + "\\\\?[\"']\\)", 'g')) || [];
    ok(sites.length === 0, 'B1: no ' + drivers + '(\'' + id + '\') call site in any quote form remains in the dist — got ' + sites.length);
  }

  // ===== B2/B3 (Supervisor audits 2d5632db, 605b14b7; 2026-09-27): BEHAVIOURAL, not textual =====
  // WHAT THIS BLOCK HOLDS — and what it does not.
  // (a) the real mobileBack() is called on every mobile view (every `if (view === 'X') return mobileRender…`
  //     branch of mobileShow, the mobileParentView keys and the two hubs) and the landing mobileState.view
  //     is read after TWO microtask turns, so a navigation deferred through Promise.resolve().then() is
  //     seen too; the landing must be a module the presence manifest still lists, one of the two
  //     onboarding hubs (connection, work_role) or the view itself.
  // (b) every screen the mobile shell can render (the same enumeration, minus the retired modules' own
  //     screens), the desktop routes of the manifest and the settings pages of both shells in both flag
  //     states are rendered in the fake DOM, and the RENDERED html is scanned for the identifiers of the
  //     retired modules as VALUES — in onclick arguments, data-* attributes and any quoted literal —
  //     regardless of what the function that performs the jump is called (mobileShow, showView, an alias,
  //     a delegated handler reading data-*).
  // Calibrated on a known fact: main ff9a3866 lands 6 Backs on retired modules and renders the
  // documents/apps rail on every mobile screen; the candidate must land 0 and render 0 (see WORKLOG).
  // LIMIT — read before relying on this block: a harness on a fake DOM has a ceiling. This block protects
  // against an ACCIDENTAL regression (a leftover parent, branch, rail slot or button) and against the
  // deliberate forms enumerated in the audits (variable/join('') targets, double quotes, escaped literals,
  // a hub forward, an alias, a data-* delegated button, a navigation deferred by a microtask, a screen
  // outside a hand-written list). It does NOT prove a retired module is unreachable in general. Forms it
  // does not cover (audit 605b14b7): a target assembled with join() and jumped to after more than two
  // microtasks or through a real timer; navigation through CustomEvent / event listeners whose target
  // never appears in the rendered html; a hash/location router; screens whose entry depends on data the
  // fake DOM never has; desktop screens outside the manifest routes (the pilot); a real browser click or
  // Android tap. Wording like "never reachable" is deliberately absent here.
  section('B2/B3 behavioural — Back landings and rendered screens never reach a retired module (within the limit above)');
  if (M && typeof M.mobileBack === 'function' && M.mobileState) {
    // B3: the retired ids as VALUES — preceded by a quote, an opening paren or '=' (onclick args, data-*
    // attributes, string literals) and followed by a quote/paren/space/'>'/';'/',' — not by function name.
    const RETIRED_NAV = /(['"(=])(vacancies|mailings|mail|documents|apps)(?=['")\s>;,])/g;
    const b2 = { badBack: [], rendered: [], errors: [] };
    M.state.settings = { server_url: 'https://api.skipi.app', bearer_token: 'TOKEN-DO-NOT-LEAK', crewing_id: 'presence-harness', interface: { theme: 'light', language: 'en' } };
    const mobileShowSrc = (HTML.match(/function mobileShow\(view\) \{([\s\S]*?)\nfunction mobileBack\(\)/) || [])[1] || '';
    const renderViews = [...new Set([...mobileShowSrc.matchAll(/if \(view === '([a-z_]+)'\) return mobileRender/g)].map((m) => m[1]))];
    ok(renderViews.length >= 18, 'B2: the mobileShow render branches are enumerated from the source — got ' + renderViews.length);
    const backViews = [...new Set([...renderViews, ...parentEntries.map((e) => e.view), ...RETURN_HUBS])];
    for (const v of backViews) {
      let landed = null, err = null;
      try { M.mobileState.view = v; M.state.view = 'mobile-' + v; M.mobileBack(); await Promise.resolve(); await Promise.resolve(); landed = M.mobileState.view; } catch (e) { err = e; }
      if (err) b2.errors.push(v + ': ' + err);
      const fine = !err && (allowedReturnTargets.has(landed) || landed === v);
      if (!fine && !err) b2.badBack.push(v + ' -> ' + landed);
      ok(fine, 'B2: Back from "' + v + '" lands on a listed module or hub (or stays) — landed on "' + landed + '"' + (err ? ' — threw ' + err : ''));
    }
    const scan = (label, html) => {
      const hits = [...String(html).matchAll(RETIRED_NAV)].map((m) => m[1] + m[2]);
      if (hits.length) b2.rendered.push(label + ': ' + hits.join(', '));
      ok(hits.length === 0, 'B2: rendered "' + label + '" carries no navigation into a retired module — ' + (hits.length ? hits.join(', ') : 'none'));
    };
    // B3: every screen the shell can render, from the source enumeration — not a hand-written list. The
    // retired modules' own screens are excluded (they are the thing that must be unreachable, not a path).
    const MOBILE_SCREENS = renderViews.filter((v) => !RETIRED_MODULES.includes(v));
    ok(MOBILE_SCREENS.length >= 14, 'B3: screens under scan come from the mobileShow enumeration — ' + MOBILE_SCREENS.length + ' screens: ' + MOBILE_SCREENS.join(','));
    for (const v of MOBILE_SCREENS) {
      try { elFor('mobile-root').innerHTML = ''; elFor('mobile-main').innerHTML = ''; M.mobileShow(v); } catch (e) { b2.errors.push('render ' + v + ': ' + e); }
      scan('mobile ' + v, elFor('mobile-root').innerHTML + '\n' + elFor('mobile-main').innerHTML);
    }
    for (const flag of ['0', '1']) {
      if (flag === '1') store.set('skipi_crewing_settings5', '1'); else store.delete('skipi_crewing_settings5');
      for (const page of ['modules', 'identity', 'storage', 'appearance', 'paid', 'org', 'work_data']) {
        try { elFor('mobile-main').innerHTML = ''; M.mobileOpenSettings(page); } catch (e) { b2.errors.push('mobile settings ' + page + ': ' + e); }
        scan('mobile settings/' + page + ' flag=' + flag, elFor('mobile-main').innerHTML);
        try { elFor('modal-host').innerHTML = ''; await M.openSettings(page); } catch (e) { b2.errors.push('desktop settings ' + page + ': ' + e); }
        scan('desktop settings/' + page + ' flag=' + flag, elFor('modal-host').innerHTML);
      }
    }
    store.delete('skipi_crewing_settings5');
    for (const m of manifest.required_modules || []) {
      const d = m.desktop_navigation || {};
      if (d.route_driver !== 'showView') continue;
      try { elFor('main').innerHTML = ''; elFor('left-panel').innerHTML = ''; M.showView(d.route); } catch (e) { b2.errors.push('desktop ' + d.route + ': ' + e); }
      scan('desktop ' + d.route, elFor('main').innerHTML + '\n' + elFor('left-panel').innerHTML + '\n' + elFor('crew-flow-tree').innerHTML);
    }
    ok(b2.errors.length === 0, 'B2: no screen or Back threw in the fake DOM' + (b2.errors.length ? ' — ' + b2.errors.join(' | ') : ''));
    console.log('  B2 findings: badBack=' + b2.badBack.length + ' renderedScreensWithRetiredNav=' + b2.rendered.length + ' total=' + (b2.badBack.length + b2.rendered.length)
      + (b2.badBack.length ? '\n    ' + b2.badBack.join('\n    ') : '') + (b2.rendered.length ? '\n    ' + b2.rendered.join('\n    ') : ''));
  } else {
    ok(false, 'B2 behavioural checks require mobileBack/mobileState in the inline module');
  }
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
//   from K2.2 (OWNER 2026-09-27 "Apps и Documents тоже пока убираем из сборки"):
//     Documents and Apps leave the build; the rail keeps the three remaining
//     modules in the same order and Settings still enters only via the gear:
//       crew_flow · compliance · seafarers.
//     The "5 fixed slots" figure of CANON-mobile-unified-standard-v1 is thus not
//     met by Crewing since K2.2 — by the owner's word, recorded here, not by drift.
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
ok(/K2\.2/.test(RAIL_PROVENANCE) && /2026-09-27/.test(RAIL_PROVENANCE) && /crew_flow · compliance · seafarers\./.test(RAIL_PROVENANCE),
  'the rail provenance comment records the K2.2 decision (owner 2026-09-27) and the three-slot composition');

section('mobile rail canon — 3 slots since K2.2 (was 5), canonical QA, no scroll');
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
  ok(railViews.join(',') === 'crew_flow,compliance,seafarers',
    'rail renders exactly 3 buttons in canonical order crew_flow,compliance,seafarers (K2.2) — got [' + railViews.join(',') + ']');
  const railQa = railBtns.map((b) => (b[0].match(/data-qa="([^"]+)"/) || [])[1] || '(none)');
  ok(railQa.join(',') === 'bottom-nav-crew_flow,bottom-nav-compliance,bottom-nav-seafarers',
    'rail buttons carry canonical bottom-nav-<view> QA slugs — got [' + railQa.join(',') + ']');
  ok(!railHtml.includes('data-mview="apps"') && !railHtml.includes('data-mview="documents"') && !railHtml.includes('bottom-nav-apps') && !railHtml.includes('bottom-nav-documents'),
    'K2.2: the rail has no Apps or Documents slot');
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

  // Mobile Apps grid: module tiles precede plugins. K2.2: Documents lost its tile with the module.
  const bodyEl = elFor('body');
  const origContains = bodyEl.classList.contains;
  bodyEl.classList.contains = (c) => c === 'mobile-shell';
  M.mobileShow('apps');
  bodyEl.classList.contains = origContains;
  const appsHtml = elFor('mobile-main').innerHTML;
  const tileOrder = [...appsHtml.matchAll(/data-qa="apps-module-tile-([a-z_]+)"/g)].map((m) => m[1]);
  ok(tileOrder.join(',') === 'seafarers,crew_flow,compliance',
    'mobile Apps grid shows module tiles seafarers,crew_flow,compliance (K2.2) — got [' + tileOrder.join(',') + ']');
  const firstModuleTile = appsHtml.indexOf('data-qa="apps-module-tile-');
  const pluginRegion = appsHtml.indexOf('id="apps-launch-body"');
  ok(firstModuleTile !== -1 && pluginRegion !== -1 && firstModuleTile < pluginRegion,
    'module tiles precede the plugin region in the mobile Apps grid');
  const complianceTile = (appsHtml.match(/<button[^>]*data-qa="apps-module-tile-compliance"[^>]*>/) || [''])[0];
  const documentsTile = (appsHtml.match(/<button[^>]*data-qa="apps-module-tile-documents"[^>]*>/) || [''])[0];
  ok(complianceTile.includes("mobileShow('compliance')"), 'Requirements tile routes via mobileShow(compliance)');
  ok(documentsTile === '' && !appsHtml.includes('apps-module-tile-documents'), 'K2.2: no Documents tile in the mobile Apps grid');
} else {
  ok(false, 'mobile rail canon checks require runtime module (script failed to load)');
}

// ── No.765: settings tab «Crew Flow» (OWNER 1067; manager R2 + alias, 2026-10-16) ──
// The tab lives in appSpecificSections, reached through the two exports added above and
// NOT through openSettings(): this harness installs no window.SkipiSettings, so
// openSettings() here takes the legacy fallback renderer and would assert about a
// different screen than the product actually shows.
section('No.765 settings tab «Crew Flow»');
const SEC_ID = 'home-crewing-crew-flow';
if (M && typeof M._crewingSettingsSections === 'function' && typeof M._crewingSettingsSectionFor === 'function') {
  ok(M._crewingSettingsSectionFor('work_data') === SEC_ID,
    'No.765-1: legacy tab id work_data still resolves to ' + SEC_ID + ' (got ' + M._crewingSettingsSectionFor('work_data') + ')');
  ok(M._crewingSettingsSectionFor('crew_flow') === SEC_ID,
    'No.765-2: new tab id crew_flow resolves to ' + SEC_ID + ' (got ' + M._crewingSettingsSectionFor('crew_flow') + ')');
  // Not a tautology against the two above: 'profile' is the default arm, so this shows
  // the switch still HAS a default and the two ids above are not matching everything.
  ok(M._crewingSettingsSectionFor('no-such-tab') === 'profile',
    'No.765-3: an unknown tab id still falls to profile (the default arm survives)');

  const secs = M._crewingSettingsSections();
  const mine = secs.filter((s) => s && s.id === SEC_ID);
  ok(mine.length === 1, 'No.765-4: exactly one ' + SEC_ID + ' section (got ' + mine.length + ')');
  ok(secs.filter((s) => s && s.id === 'home-crewing-work-data').length === 0,
    'No.765-5: the work-data section id is gone, not left alongside');
  const sec = mine[0] || {};
  ok(sec.labelKey === 'settings.crewing.crew_flow',
    'No.765-6: the section carries labelKey settings.crewing.crew_flow (got ' + sec.labelKey + ')');
  ok(typeof sec.renderHtml === 'function', 'No.765-7: the section HAS a renderHtml');

  // ctx.t returns the key, so the rendered HTML names the keys it asked for — these
  // assertions are about which rows the tab builds, independent of any translation.
  const ctx = {
    t: (k) => k,
    escapeAttr: (s) => String(s == null ? '' : s),
    escapeHtml: (s) => String(s == null ? '' : s),
    refresh: () => Promise.resolve(),
  };
  const renderWith = (pilot) => {
    M.state.intakePilot = pilot;
    try { return String(sec.renderHtml ? sec.renderHtml(ctx) : ''); } catch (e) { return 'THREW: ' + e; }
  };

  // Three POPULATION-MATCHED renders. A single render could not tell «the copy control is
  // absent because the address is not revealed» from «the copy control was never built».
  const ADDR = 'intake+765harness@skipi.app';
  const htmlRevealed = renderWith({
    aliases: [{ id: 'a1', generation: 3, state: 'active' }],
    aliasLoading: false, addressChecked: true, revealPending: false,
    revealedAddress: { aliasId: 'a1', generation: 3, address: ADDR, reason: null, copied: false },
  });
  const htmlAbsent = renderWith({ aliases: [], addressChecked: true });
  const htmlSilent = renderWith({});

  // Each of the four assertions below carries its own «there is a subject» condition.
  // Without it they report green on a tree where the section does not exist at all:
  // nothing throws, nothing shows an address and nothing calls the queue.
  const built = typeof sec.renderHtml === 'function';
  ok(built && !htmlRevealed.startsWith('THREW:') && !htmlAbsent.startsWith('THREW:') && !htmlSilent.startsWith('THREW:'),
    'No.765-8: the section exists and renders in all three address states without throwing');
  ok(htmlRevealed !== '' && htmlAbsent !== '' && htmlSilent !== '',
    'No.765-9: the section renders a non-empty body in all three address states');

  // (1) the schema: six steps, each named, so a missing one is reported by name
  // OWNER (1070): the prose steps are replaced by the diagram. The five nodes and the
  // second entrance must all be present — the tab's job is still to explain the route.
  const nodeKeys = ['n1','n2','n3','n4','n5','n2b'].map((k) => 'settings.crewing.cf.' + k);
  const missingNodes = nodeKeys.filter((k) => !htmlRevealed.includes(k));
  ok(missingNodes.length === 0,
    'No.765-10: the diagram renders all five nodes and the second entrance — missing [' + missingNodes.join(',') + ']');
  ok(htmlRevealed.includes('data-qa="cf-schema"') && htmlRevealed.includes('data-qa="cf-second-entrance"'),
    'No.765-11: the diagram and the second entrance carry their own QA slugs');

  // (2) the inbound address — the value is this harness's own fixture, so a hit proves
  // the tab read the SHARED reveal state and did not store or invent a second one.
  ok(htmlRevealed.includes('data-qa="crew-flow-settings-address"'),
    'No.765-12: the tab renders the inbound-address block');
  ok(htmlRevealed.includes(ADDR),
    'No.765-13: a revealed address is shown from the shared state (the fixture value appears)');
  ok(htmlRevealed.includes('data-settings-action="crew-flow-settings-address-copy"'),
    'No.765-14: a revealed address offers the copy action');
  ok(htmlAbsent !== '' && htmlSilent !== '' && !htmlAbsent.includes(ADDR) && !htmlSilent.includes(ADDR),
    'No.765-15: a rendered tab shows no address when none is revealed — not a cached literal');
  ok(htmlSilent.includes('data-settings-action="crew-flow-settings-address-reveal"'),
    'No.765-16: an unrevealed address offers the reveal action');

  // (3) contact_email keeps its row AND gains the only-from caption
  ok(htmlRevealed.includes('crewing-set-contact-email'),
    'No.765-17: the sender-address input survives (node 2, second setting)');
  // The caption key moved from settings.crewing.contact_email.only_from to
  // settings.crewing.cf.from_note when the section was rebuilt. The GUARD follows the
  // meaning, it is not deleted: losing the «only from this address» rule would be the
  // worse bug, and the old key is now removed from the tables so nothing can pass on it.
  ok(htmlRevealed.includes('settings.crewing.cf.from_note'),
    'No.765-18: the sender section carries the «accepted only from this address» rule');

  // (4) the five prior rows, under the disclosure, keys and operations unchanged (739)
  ok(htmlRevealed.includes('settings.crewing.agency_data'),
    'No.765-19: the agency-data disclosure is present');
  const legacyRows = ['settings.crewing.company', 'settings.crewing.mlc',
                      'settings.crewing.vault', 'settings.mailbox_legacy'];
  const missingRows = legacyRows.filter((k) => !htmlRevealed.includes(k));
  ok(missingRows.length === 0,
    'No.765-20: the prior rows keep their keys — missing [' + missingRows.join(',') + ']');
  const h = sec.handlers || {};
  ok(typeof h['crewing-mailbox-disconnect'] === 'function' && typeof h['crewing-open-profile'] === 'function',
    'No.765-21: the mailbox-disconnect and open-profile operations are unchanged (OWNER 739)');

  // The STOP from this task's PREP, and its ground is measured: «Crew Flow» as plain text
  // is already an unfalsifiable marker (42 occurrences, 23 of them in comments), so
  // data-qa="crew-flow-view" is the ONLY surface marker of module crew_flow that can still
  // fail. A settings tab carrying it would retire that last check too. The non-empty guard
  // is deliberate — an empty render lacks the marker as well, and would prove nothing.
  ok(htmlRevealed !== '' && !htmlRevealed.includes('data-qa="crew-flow-view"'),
    'No.765-22: a rendered tab does NOT carry the module marker data-qa="crew-flow-view"'
    + (htmlRevealed === '' ? ' — VACUOUS: nothing rendered' : ''));

  // The queue must not load from a settings screen: if it did, the tab's own step 4
  // («press Refresh queue») would be false on the very screen that states it.
  // Line comments are stripped first. Without that these two matched the very comment
  // that explains why the calls are absent — a class check catching its own prose, and
  // it failed on the first candidate for exactly that reason. Only // comments are
  // stripped, so a '//' inside a string literal would still be seen; there is none in
  // these functions, and a false POSITIVE here is loud, never silent.
  const decomment = (f) => String(f).replace(/^[ \t]*\/\/.*$/gm, '');
  const QUEUE_CALL = /renderCrewFlowView\s*\(|crewFlowEnsureLiveQueue\s*\(/;
  ok(built && !QUEUE_CALL.test(decomment(sec.renderHtml)),
    'No.765-23: the tab body exists and neither repaints Crew Flow nor loads the candidate queue');
  const handlerSrc = Object.keys(h).map((k) => decomment(h[k])).join('\n');
  ok(Object.keys(h).length > 0 && !QUEUE_CALL.test(handlerSrc),
    'No.765-24: the tab HAS handlers and none repaints Crew Flow or loads the candidate queue');
  // A positive control, because an always-true regex would pass both of the above:
  // the real crewFlowRevealAddress wrapper DOES repaint, and this must see it.
  ok(QUEUE_CALL.test('function w(){ renderCrewFlowView(); }'),
    'No.765-23a: the queue/repaint detector is not blind — it fires on a call that is there');
  M.state.intakePilot = null;
} else {
  ok(false, 'No.765 checks require _crewingSettingsSections/_crewingSettingsSectionFor exports');
}

// The label is the owner's word (1067): «Crew Flow», untranslated in BOTH tables.
{
  const hits = HTML.match(/["']settings\.crewing\.crew_flow["']\s*:\s*["']Crew Flow["']/g) || [];
  ok(hits.length === 2,
    'No.765-25: BOTH language tables carry «Crew Flow» untranslated (OWNER 1067) — got ' + hits.length);
}
ok(!/["']settings\.crewing\.work_data["']\s*:/.test(HTML),
  'No.765-26: the old settings.crewing.work_data label key is gone from the string tables');

// ── No.765b: the stand defect of 2026-10-16 — a wide control squeezed the row label into a
// one-to-two-letter column («Вхо/дя/щи/й/адр/ес»). Cause, read from the vendored CSS: the
// row is `grid-template-columns: minmax(0,1fr) auto` with `min-width:0` on the copy column
// and `overflow-wrap:anywhere` on the label, so a control with a wide natural width
// collapses the text column and the label then breaks mid-word.
//
// A PIXEL WIDTH CANNOT BE ASSERTED HERE and I will not pretend otherwise: this harness has
// no layout engine — makeElement returns objects with an empty `style` and no geometry. So
// the proof is a PAIR: the markup declares the module's stack layout, AND the module's
// stylesheet really defines that layout as a single column. Either alone would be a token:
// an attribute nothing acts on, or a rule nothing uses.
section('No.765b settings row layout — the stand squeeze');
if (M && typeof M._crewingSettingsSections === 'function') {
  const secs765b = M._crewingSettingsSections();
  const sec765b = secs765b.filter((s) => s && s.id === 'home-crewing-crew-flow')[0] || {};
  const ctx765b = {
    t: (k) => k,
    escapeAttr: (s) => String(s == null ? '' : s),
    escapeHtml: (s) => String(s == null ? '' : s),
    refresh: () => Promise.resolve(),
  };
  M.state.intakePilot = {
    aliases: [{ id: 'a1', generation: 3, state: 'active' }],
    aliasLoading: false, addressChecked: true, revealPending: false,
    revealedAddress: { aliasId: 'a1', generation: 3, address: 'intake+765b@skipi.app', reason: null, copied: false },
  };
  M.state.settings = Object.assign({}, M.state.settings, { vault_path: '/home/op/vaults/a-very-long-vault-path-that-squeezes' });
  const h765b = typeof sec765b.renderHtml === 'function' ? String(sec765b.renderHtml(ctx765b)) : '';
  ok(h765b !== '', 'No.765b-27: the tab renders, so the layout assertions below have a subject');

  // Split into rows and keep each row's own markup, so an assertion can say WHICH row.
  const rowsOf = (html) => html.split('<div class="skipi-settings__row"').slice(1)
    .map((chunk) => chunk.split('<div class="skipi-settings__row"')[0]);
  const rows765b = rowsOf(h765b);
  const rowWith = (needle) => rows765b.filter((r) => r.includes(needle))[0] || '';
  const isStack = (r) => r.startsWith(' data-layout="stack"');
  ok(rows765b.length >= 5, 'No.765b-28: the tab renders at least five rows — got ' + rows765b.length);

  // The address row: stack, and no label of its own — the group heading already names it,
  // and on the stand the two stood one under the other saying the same words.
  const addrRow = rowWith('crew-flow-settings-address-copy') || rowWith('intake+765b@skipi.app');
  ok(addrRow !== '', 'No.765b-29: the address row is identifiable in the markup');
  ok(isStack(addrRow), 'No.765b-30: the address row declares data-layout="stack"');
  ok(!addrRow.includes('skipi-settings__row-label'),
    'No.765b-31: the address row carries no label of its own (the group heading names it)');

  // Contact email: the label goes, the RULE stays. Losing the caption would be the worse bug.
  const mailRow = rowWith('crewing-set-contact-email');
  ok(mailRow !== '', 'No.765b-32: the contact-email row is identifiable');
  ok(!mailRow.includes('skipi-settings__row-label'),
    'No.765b-33: the contact-email row no longer repeats the group heading');
  ok(mailRow.includes('settings.crewing.cf.from_note'),
    'No.765b-34: the «accepted only from this address» rule SURVIVES the rebuild (key moved to cf.from_note)');

  // The other unbounded values. MLC is deliberately left alone: its value is number + date,
  // and leaving it is what makes this a discrimination rather than a blanket.
  ok(isStack(rowWith('settings.crewing.company')), 'No.765b-35: the company row declares stack');
  ok(isStack(rowWith('settings.crewing.vault')), 'No.765b-36: the vault row declares stack');
  ok(!isStack(rowWith('settings.crewing.mlc')),
    'No.765b-37: the MLC row does NOT declare stack — the attribute is applied to rows with unbounded values, not sprayed over all of them');
  M.state.intakePilot = null;
} else {
  ok(false, 'No.765b checks require _crewingSettingsSections');
}

// (b) The other half of the pair: the module's stylesheet must really define that layout as
// a single column. dist/skipi-settings.css is READ here and not edited — reading does not
// put it in the changed set, so the route is unaffected. If someone later drops the rule
// from the vendored file, this fails instead of leaving a green assertion about an
// attribute that no longer does anything.
{
  const cssPath = path.join(ROOT, 'dist', 'skipi-settings.css');
  let css = '';
  try { css = fs.readFileSync(cssPath, 'utf8'); } catch (e) { css = ''; }
  ok(css !== '', 'No.765b-38: dist/skipi-settings.css is readable — the mechanism can be checked');
  const stackIdx = css.indexOf('[data-layout="stack"]');
  ok(stackIdx !== -1, 'No.765b-39: the module defines a [data-layout="stack"] rule');
  const stackBody = stackIdx === -1 ? '' : css.slice(stackIdx, css.indexOf('}', stackIdx));
  ok(/grid-template-columns:\s*minmax\(\s*0\s*,\s*1fr\s*\)\s*;/.test(stackBody),
    'No.765b-40: the stack rule collapses the row to ONE column — that is what stops the label being squeezed');
  // Not vacuous: the DEFAULT row rule must still be the two-column grid that caused the
  // defect, so assertion 40 is a real difference and not a restatement.
  const baseIdx = css.indexOf('.skipi-settings__row {');
  const baseBody = baseIdx === -1 ? '' : css.slice(baseIdx, css.indexOf('}', baseIdx));
  ok(/grid-template-columns:\s*minmax\(\s*0\s*,\s*1fr\s*\)\s+auto\s*;/.test(baseBody),
    'No.765b-41: the DEFAULT row is still the two-column grid — so stack is a real difference, not a restatement');
}

// ── No.765 slice 2 (OWNER 1070/1071): the diagram, and the promise that this tab is READ-ONLY
// about the queue. Node 4 says «only on Refresh»; if opening Settings fetched the queue,
// the tab's own caption would be false on the screen that states it.
section('No.765c settings diagram — statuses from loaded client state only');
if (M && typeof M._crewingSettingsSections === 'function') {
  const sec765c = M._crewingSettingsSections().filter((s) => s && s.id === 'home-crewing-crew-flow')[0] || {};
  // `t` returns the key WITH a {n} placeholder, so fill() can substitute and the COUNT
  // becomes assertable. With a plain key-returning stub there is no {n} to replace, the
  // number never reaches the markup, and an assertion about it can only be vacuous — which
  // is exactly what my first version of 765c-46 was: `(A && B) || html.indexOf('3') !== -1`.
  const ctx765c = { t:(k)=>k+'|{n}', escapeAttr:(s)=>String(s==null?'':s), escapeHtml:(s)=>String(s==null?'':s), refresh:()=>Promise.resolve() };
  const ALIAS = { aliases:[{id:'a1',generation:3,state:'active'}], aliasLoading:false, addressChecked:true,
                  revealPending:false, revealedAddress:{aliasId:'a1',generation:3,address:'svc@in.skipi.app',reason:null,copied:false} };
  const render = (pilot) => { M.state.intakePilot = pilot; try { return String(sec765c.renderHtml(ctx765c)); } catch(e){ return 'THREW: '+e; } };

  // (1) no server call, no queue load — asserted on the SOURCE of the body and handlers,
  // with comments stripped so an explanatory comment cannot satisfy or break it.
  const strip = (f) => String(f).replace(/^[ \t]*\/\/.*$/gm, '');
  const FETCHY = /\binvoke\s*\(|crewFlowEnsureLiveQueue\s*\(|pilotLoadQueue\s*\(|crewFlowRefreshQueue\s*\(/;
  ok(typeof sec765c.renderHtml === 'function' && !FETCHY.test(strip(sec765c.renderHtml)),
    'No.765c-42: the tab body issues no server call and does not load the queue');
  const h765c = sec765c.handlers || {};
  const hsrc = Object.keys(h765c).map((k) => strip(h765c[k])).join('\n');
  ok(Object.keys(h765c).length > 0 && !FETCHY.test(hsrc),
    'No.765c-43: no handler of the tab fetches or loads the queue');
  ok(FETCHY.test('function f(){ pilotLoadQueue(0); }'),
    'No.765c-43a: the fetch detector is not blind — it fires on a call that is there');

  // (2) queue never loaded -> say so, and show no counts invented from nothing
  const htmlUnloaded = render(Object.assign({}, ALIAS));
  ok(htmlUnloaded.includes('settings.crewing.cf.s_unloaded'),
    'No.765c-44: with no queue loaded the diagram says «the queue has not been loaded yet»');
  ok(!htmlUnloaded.includes('settings.crewing.cf.s_mail7'),
    'No.765c-45: and shows no 7-day count when there is nothing to count from');

  // (3) the counters, on a fixture whose answer is known by construction
  const now = Date.now();
  const iso = (daysAgo) => new Date(now - daysAgo*24*3600*1000).toISOString();
  const withQueue = Object.assign({}, ALIAS, {
    queueLastUpdated: new Date(now).toISOString(),
    queue: { offset:0, limit:50, total:6, items: [
      { intake_id:'m1', source:'inbound',        created_at: iso(1) },
      { intake_id:'m2', source:'inbound',        created_at: iso(6) },
      { intake_id:'m3', source:'inbound',        created_at: iso(30) },   // outside 7 days
      { intake_id:'a1', source:'skipi_response', created_at: iso(2) },
      { intake_id:'s1', source:'synthetic',      created_at: iso(1) },    // a TEST record
      { intake_id:'d1', source:'inbound',        created_at: iso(3) },
    ]},
  });
  M.state.crewFlowReadState = { d1: { action:'ignored' }, m1: { action:'draft_opened' } };
  const htmlQ = render(withQueue);
  // 3 inbound inside 7 days: m1, m2, d1 — m3 is older, s1 is synthetic and counts nowhere
  // Exact counts, by construction of the fixture:
  //   inbound within 7 days: m1, m2, d1 = 3   (m3 is 30 days old; s1 is synthetic)
  //   skipi_response within 7 days: a1 = 1
  //   awaiting: 6 items minus d1 (ignored) = 5; m1 is draft_opened, which is activity
  // The key now carries the plural form (No.765d), so these read the NUMBER out of
  // whichever form was chosen: the count is this block's claim, the form is 765d's. Reading
  // it form-agnostically also keeps them independent of the active language.
  const countFor = (html, base) => {
    const m = html.match(new RegExp(base.replace(/\./g, '\\.') + '_(?:one|few|many)\\|(\\d+)'));
    return m ? Number(m[1]) : null;
  };
  ok(countFor(htmlQ, 'settings.crewing.cf.s_mail7') === 3,
    'No.765c-46: exactly 3 letters in 7 days — the 30-day-old one and the synthetic are excluded');
  ok(countFor(htmlQ, 'settings.crewing.cf.s_app7') === 1,
    'No.765c-47: exactly 1 application in 7 days, counted separately from letters');
  ok(countFor(htmlQ, 'settings.crewing.cf.s_waiting') === 5,
    'No.765c-48: exactly 5 awaiting a decision — only the ignored one is decided, draft_opened is not');
  // Non-vacuous by construction, and this is why the premise is asserted beside the
  // outcome: the old form of this control compared against «s_mail7|4», a string the
  // form-bearing key can no longer produce, so it would have passed for the wrong reason
  // and gone on passing had the synthetic ever been folded in.
  const synthInWindow = withQueue.queue.items.some((it) =>
    it.source === 'synthetic' && Date.parse(it.created_at) >= now - 7*24*3600*1000);
  ok(synthInWindow && countFor(htmlQ, 'settings.crewing.cf.s_mail7') === 3,
    'No.765c-48a: a synthetic record DOES sit inside the window and is still not folded into the letter count');

  // (4) the orange signal: an address IS issued and nothing arrived in seven days
  const htmlQuiet = render(Object.assign({}, ALIAS, {
    queueLastUpdated: new Date(now).toISOString(),
    queue: { offset:0, limit:50, total:0, items: [] },
  }));
  ok(htmlQuiet.includes('#b45309'),
    'No.765c-49: address issued and zero letters in 7 days is flagged, not shown as normal');
  M.state.intakePilot = null; M.state.crewFlowReadState = {};
} else {
  ok(false, 'No.765c checks require _crewingSettingsSections');
}

// The service-address rule must be stated on the tab, in both tables, and the old
// «give it to the candidate» reading must be gone from the file entirely.
ok(/["']settings\.crewing\.cf\.where_note["']/.test(HTML),
  'No.765c-50: the «service address, do not give it to candidates» note exists');
{
  const bad = (HTML.match(/Дайте этот адрес кандидату|Give that address to the candidate/g) || []).length;
  ok(bad === 0, 'No.765c-51: no text tells the operator to give the inbound address to a candidate — found ' + bad);
}

// ── No.765d: a numeral must agree with the noun it counts.
// The manager's stand reading of frames 11/12/13/14: «1 кандидатов ждут решения» — the
// number does not decline. Russian takes three forms (1 / 2-4 / 5+ and 0), and the teens
// 11-14 take the many-form although they end in 1-4; English takes two. The agreement is
// part of the TEXT and not of the number — the verb moves too (ждёт -> ждут) — so each
// form is its own KEY, and the name of the chosen key reaches the markup. That is what
// makes the choice assertable rather than merely plausible: a render can be asked which
// form it picked instead of being pattern-matched for a word.
section('No.765d numeral agreement — the count chooses the form, and the form is a key');

// (1) the rule itself, on the numbers the card named plus the boundaries that defeat the
// naive `n === 1` and `n % 10` implementations: the teens, and the tens that return to the
// one-form (21, 101).
if (M && typeof M.uiPluralCategory === 'function') {
  const cat = (n, lang) => M.uiPluralCategory(n, lang);
  const RU = [[1,'one'],[2,'few'],[5,'many'],[11,'many'],[21,'one'],[0,'many'],
              [12,'many'],[13,'many'],[14,'many'],[22,'few'],[25,'many'],
              [101,'one'],[102,'few'],[111,'many'],[114,'many'],[1002,'few']];
  const ruBad = RU.filter((r) => cat(r[0],'ru') !== r[1])
                  .map((r) => r[0] + ' wanted ' + r[1] + ' got ' + cat(r[0],'ru'));
  ok(ruBad.length === 0,
    'No.765d-52: the Russian rule is right on 1/2/5/11/21/0 and on the teens and tens — wrong [' + ruBad.join('; ') + ']');

  const EN = [[1,'one'],[2,'many'],[5,'many'],[11,'many'],[21,'many'],[0,'many']];
  const enBad = EN.filter((r) => cat(r[0],'en') !== r[1])
                  .map((r) => r[0] + ' wanted ' + r[1] + ' got ' + cat(r[0],'en'));
  ok(enBad.length === 0,
    'No.765d-53: the English rule is right on the same numbers — wrong [' + enBad.join('; ') + ']');

  // Not vacuous: a rule that returned one constant could not fail the lists above by
  // accident, so the distinctions are asserted in both directions.
  ok(new Set([cat(1,'ru'), cat(2,'ru'), cat(5,'ru')]).size === 3,
    'No.765d-54: Russian genuinely distinguishes three forms for 1, 2 and 5');
  ok(new Set([cat(1,'en'), cat(2,'en')]).size === 2 && cat(2,'en') === cat(5,'en'),
    'No.765d-55: English distinguishes exactly two forms — and 2 and 5 share one');

  // A negative is a real number: 0 and a negative count must not throw or invent a form.
  ok(['one','few','many'].indexOf(cat(-1,'ru')) !== -1 && ['one','few','many'].indexOf(cat(-5,'ru')) !== -1,
    'No.765d-56: a negative count still yields a known form rather than throwing');
  ok(cat(NaN,'ru') === 'many' && cat(undefined,'ru') === 'many',
    'No.765d-57: an unreadable count falls to the many-form, which is the one that reads as a plain total');

  // (2) A language whose own table does not carry these keys falls back to the ENGLISH
  // text, so the ENGLISH rule is the right one for it. The form must follow the STRING
  // that will be shown, not the language the operator picked. The premise — that tl/hi/id
  // carry none of these keys — is asserted separately by 765d-59's count of exactly two.
  const fellBack = ['tl','hi','id'].filter((l) => [1,2,5,11,21,0].some((n) => cat(n,l) !== cat(n,'en')));
  ok(fellBack.length === 0,
    'No.765d-58: a language that falls back to the English text uses the English rule — differs for [' + fellBack.join(',') + ']');
} else {
  ok(false, 'No.765d-52..58: the numeral rule is not exported as uiPluralCategory');
}

// (3) the forms must EXIST as keys, in the tables that need them, and the old
// form-blind keys must be gone so a leftover cannot silently serve the old text.
{
  const vals = (key) => {
    const re = new RegExp('"' + key.replace(/\./g, '\\.') + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"', 'g');
    const out = []; let m;
    while ((m = re.exec(HTML)) !== null) out.push(m[1]);
    return out;   // file order: the en table precedes the ru table
  };
  const BASES = ['settings.crewing.cf.s_waiting','settings.crewing.cf.s_mail7','settings.crewing.cf.s_app7'];
  const missing = [];
  BASES.forEach((b) => {
    if (vals(b + '_one').length !== 2) missing.push(b + '_one x' + vals(b + '_one').length);
    if (vals(b + '_many').length !== 2) missing.push(b + '_many x' + vals(b + '_many').length);
    if (vals(b + '_few').length !== 1) missing.push(b + '_few x' + vals(b + '_few').length + ' (ru only)');
  });
  ok(missing.length === 0,
    'No.765d-59: one/many in both tables and few in Russian only, for all three counted nouns — wrong [' + missing.join('; ') + ']');
  const leftovers = BASES.filter((b) => vals(b).length !== 0);
  ok(leftovers.length === 0,
    'No.765d-60: the form-blind keys are gone from the tables — still present [' + leftovers.join(',') + ']');

  // (4) and the forms must carry the right agreement, which is the defect itself: the
  // card specified the words, so they are asserted as words, in both languages.
  const ru = (k) => { const v = vals(k); return v.length === 2 ? v[1] : ''; };
  const en = (k) => { const v = vals(k); return v.length >= 1 ? v[0] : ''; };
  const ruFew = (k) => { const v = vals(k); return v.length === 1 ? v[0] : ''; };
  ok(ru('settings.crewing.cf.s_waiting_one').indexOf('кандидат ждёт решения') !== -1
     && ruFew('settings.crewing.cf.s_waiting_few').indexOf('кандидата ждут решения') !== -1
     && ru('settings.crewing.cf.s_waiting_many').indexOf('кандидатов ждут решения') !== -1,
    'No.765d-61: Russian «кандидат ждёт» / «кандидата ждут» / «кандидатов ждут» — the verb agrees too');
  ok(ru('settings.crewing.cf.s_mail7_one').indexOf('письмо') !== -1
     && ruFew('settings.crewing.cf.s_mail7_few').indexOf('письма') !== -1
     && ru('settings.crewing.cf.s_mail7_many').indexOf('писем') !== -1,
    'No.765d-62: Russian письмо / письма / писем');
  ok(ru('settings.crewing.cf.s_app7_one').indexOf('отклик') !== -1
     && ruFew('settings.crewing.cf.s_app7_few').indexOf('отклика') !== -1
     && ru('settings.crewing.cf.s_app7_many').indexOf('откликов') !== -1,
    'No.765d-63: Russian отклик / отклика / откликов');
  ok(en('settings.crewing.cf.s_waiting_one').indexOf('candidate awaiting a decision') !== -1
     && en('settings.crewing.cf.s_waiting_many').indexOf('candidates awaiting a decision') !== -1,
    'No.765d-64: English candidate / candidates awaiting a decision');
  // every form keeps its {n}, or the number disappears from the sentence
  const nogap = [];
  let formsSeen = 0;
  BASES.forEach((b) => ['_one','_few','_many'].forEach((s) => {
    vals(b + s).forEach((v, i) => { formsSeen++; if (v.indexOf('{n}') === -1) nogap.push(b + s + '[' + i + ']'); });
  }));
  // The count of the population is part of the assertion: without it this passes while no
  // form exists at all, which is exactly how it read on the first failing-first run.
  ok(formsSeen === 15 && nogap.length === 0,
    'No.765d-65: all 15 forms exist (3 nouns x en{one,many} + ru{one,few,many}) and every one carries {n} — saw '
      + formsSeen + ', missing {n} in [' + nogap.join(',') + ']');
}

// (5) the wiring: a rendered tab must carry the CHOSEN form at BOTH places that count
// candidates — node 5's caption and the queue row. One site converted and the other
// missed would show here as a count of 1 instead of 2.
if (M && typeof M._crewingSettingsSections === 'function') {
  const sec765d = M._crewingSettingsSections().filter((s) => s && s.id === 'home-crewing-crew-flow')[0] || {};
  const ctx765d = { t:(k)=>k+'|{n}', escapeAttr:(s)=>String(s==null?'':s), escapeHtml:(s)=>String(s==null?'':s), refresh:()=>Promise.resolve() };
  const ALIAS765d = { aliases:[{id:'a1',generation:3,state:'active'}], aliasLoading:false, addressChecked:true,
    revealPending:false, revealedAddress:{aliasId:'a1',generation:3,address:'svc@in.skipi.app',reason:null,copied:false} };
  const LANGK = 'skipi-crewing-ui-language';
  const prevLang = globalThis.localStorage.getItem(LANGK);
  // 30 days old, so the 7-day counters stay 0 and only `waiting` varies with n
  const stale = new Date(Date.now() - 30*24*3600*1000).toISOString();
  const renderN = (n, lang) => {
    globalThis.localStorage.setItem(LANGK, lang);
    const items = [];
    for (let i = 0; i < n; i++) items.push({ intake_id:'w'+i, source:'inbound', created_at: stale });
    M.state.crewFlowReadState = {};
    M.state.intakePilot = Object.assign({}, ALIAS765d, {
      queueLastUpdated: new Date().toISOString(),
      queue: { offset:0, limit:50, total:n, items },
    });
    try { return String(sec765d.renderHtml(ctx765d)); } catch (e) { return 'THREW: ' + e; }
  };
  const WANT = [[1,'one'],[2,'few'],[5,'many'],[11,'many'],[21,'one'],[0,'many']];
  const wrong = [];
  WANT.forEach((r) => {
    const html = renderN(r[0], 'ru');
    const needle = 'settings.crewing.cf.s_waiting_' + r[1] + '|' + r[0];
    const hits = html.split(needle).length - 1;
    if (hits < 2) wrong.push(r[0] + ' -> ' + r[1] + ' (' + hits + ' of 2 sites)');
  });
  ok(wrong.length === 0,
    'No.765d-66: both counting sites render the chosen form for 1/2/5/11/21/0 — wrong [' + wrong.join('; ') + ']');

  // not vacuous: the one-form render must carry ONLY the one-form, so a helper that
  // emitted every form and let CSS hide the rest would fail here.
  const h1 = renderN(1, 'ru');
  ok(h1.indexOf('settings.crewing.cf.s_waiting_one|1') !== -1
     && h1.indexOf('settings.crewing.cf.s_waiting_few') === -1
     && h1.indexOf('settings.crewing.cf.s_waiting_many') === -1,
    'No.765d-67: the one-form render carries only the one-form, not every form at once');

  // English is wired through the same helper and must move at 1 -> 2, where Russian does too
  ok(renderN(1,'en').indexOf('settings.crewing.cf.s_waiting_one|1') !== -1
     && renderN(2,'en').indexOf('settings.crewing.cf.s_waiting_many|2') !== -1,
    'No.765d-68: English picks one at 1 and many at 2 through the same helper');

  // the 7-day counters decline as well — the card asked for the same helper where it applies
  const h3 = renderN(0, 'ru');
  ok(h3.indexOf('settings.crewing.cf.s_mail7_many|0') !== -1,
    'No.765d-69: «за 7 дней: 0 писем» keeps the many-form — the orange empty-route status still reads right');

  if (prevLang === null) globalThis.localStorage.removeItem(LANGK); else globalThis.localStorage.setItem(LANGK, prevLang);
  M.state.intakePilot = null; M.state.crewFlowReadState = {};
} else {
  ok(false, 'No.765d-66..69: the wiring checks require _crewingSettingsSections');
}


section('No.635 single-user Team retirement — real callers, unchanged connection');
{
  const oldNative = globalThis.__TAURI__.core.invoke;
  const oldConfirm = globalThis.confirm;
  let confirmations = 0;
  globalThis.confirm = () => { confirmations++; return true; };
  const savedRole = localStorage.getItem('skipi_crewing_work_role');
  const savedEntry = localStorage.getItem('skipi_crewing_entry');
  const savedDemo = localStorage.getItem('skipi_crewing_demo');
  const savedLang = localStorage.getItem('skipi-crewing-ui-language');
  let fixture = {};
  const calls = [];
  let deferIdentity = false;
  const identities = [];
  globalThis.__TAURI__.core.invoke = async (cmd, args) => {
    calls.push(cmd);
    if (cmd === 'get_settings') return fixture;
    if (cmd === 'get_my_identity') {
      if (deferIdentity) return new Promise((resolve) => identities.push(resolve));
      return { user_id: 'synthetic-single-user' };
    }
    if (cmd === 'save_settings') throw new Error('unexpected settings write from retired Team entrypoint');
    if (cmd === 'get_mailbox_status') return { configured: false };
    if (cmd.startsWith('fetch_') || cmd.startsWith('list_')) return [];
    return {};
  };
  localStorage.removeItem('skipi_crewing_demo');
  localStorage.setItem('skipi_crewing_entry', 'use');
  const names = [
    'renderEntryChoice', '_crewingTeamRemoveMember',
    'seedRetiredTeamCache: function(){ _crewingTeamMemberCache = [{ user_id: "synthetic-other-user", role: "member" }]; }',
    'state', 'mobileState', 'hasTeamAccess', 'crewingSettingsHost', '_crewingSettingsSectionFor',
    'showView', 'mobileShow', 'shouldShowTeamOnboarding', 'maybeShowTeamOnboarding',
    'openTeamOnboarding', 'closeTeamOnboarding', 'renderTeamOnboarding',
    'renderTeamView', 'renderTeamTree', 'renderTeamMain', 'mobileRenderTeam',
    'shouldShowMobileWorkRoleChoice', 'mobileChooseWorkRole', 'mobileChangeWorkRole',
    'mobileRenderWorkRoleChoice', 'mobileRenderMemberJoin', 'mobileConnectionIntroHtml',
    'mobileSettingsOrgHtml', 'mobileSettingsFiveIdentityHtml',
    'claimOwnerAccess', 'addTeamMember', 'removeTeamMember', 'refreshTeamMembers',
    'startTeamChatPoll', 'teamChatPollOnce', 'copyIssuedTeamToken'
  ];
  let C;
  const pendingRenders = [];
  try {
    C = new Function('invoke', 'showToast', '__testConfirm', '__testPending',
      'requestAnimationFrame', 'clearInterval',
      scriptNoBoot + '\ninAppConfirm = __testConfirm;'
      + '\nfunction _recomputeTeamChatUnread() {}'
      + '\nfunction renderTeamChatUnread() {}'
      + '\nfunction _hideTeamChatNewBadge() {}'
      + '\nfunction _playTeamChatBeep() {}'
      + '\nvar __oldTeamRender = renderTeamView;'
      + '\nrenderTeamView = function(){ var p = Promise.resolve(__oldTeamRender.apply(this, arguments)); p.catch(function(){}); __testPending.push(p); return p; };'
      + '\nvar __oldTeamPoll = teamChatPollOnce;'
      + '\nteamChatPollOnce = function(){ var p = Promise.resolve(__oldTeamPoll.apply(this, arguments)); p.catch(function(){}); __testPending.push(p); return p; };'
      + '\nreturn {' + names.join(',') + '};')(
        globalThis.__TAURI__.core.invoke, () => {}, async () => true, pendingRenders,
        () => 0, () => {});
    const teamRpc = new Set([
      'list_team_members', 'claim_team_owner', 'add_team_member', 'remove_team_member',
      'fetch_team_chat_messages', 'send_team_chat_message'
    ]);
    const teamMarkup = /team-onboarding-modal|team-onboarding-id|team-onboarding-choice|team-members-table|team-chat-stream|mobile-role-choice|mobile-team-user-id/;
    for (const lang of ['ru', 'en']) {
      for (const variant of [
        { name: 'fresh', role: '', scopes: [], connected: false },
        { name: 'owner', role: 'owner', scopes: ['*'], connected: true },
        { name: 'member', role: 'member', scopes: ['team:read', 'team:write'], connected: true }
      ]) {
        const label = '635/' + lang + '/' + variant.name;
        fixture = {
          server_url: 'https://synthetic.invalid',
          bearer_token: variant.connected ? 'SYNTHETIC-PRIVATE' : '',
          crewing_id: variant.connected ? 'own-company' : '',
          organization_id: variant.connected ? 'own-org' : '',
          company_name: 'Synthetic company', team_role: variant.role,
          token_scopes: variant.scopes, token_expires_at: null,
          profile: { contact_email: 'synthetic@example.invalid', legal_name: 'Synthetic company' },
          interface: { theme: 'light', language: lang }
        };
        C.state.settings = fixture;
        C.state.myIdentity = { user_id: 'synthetic-single-user' };
        localStorage.setItem('skipi-crewing-ui-language', lang);
        localStorage.setItem('skipi_crewing_work_role', variant.role || 'member');
        calls.length = 0;
        const before = JSON.stringify(fixture);
        // Exercise the real first-run renderer; the permissive shared fake DOM
        // otherwise always reports an overlay as already mounted.
        const oldLookup = document.getElementById;
        const oldAppend = document.body.appendChild;
        let entryOverlay = null;
        document.getElementById = (id) => id === 'entry-choice-overlay' ? null : oldLookup(id);
        document.body.appendChild = (child) => {
          if (child.id === 'entry-choice-overlay') entryOverlay = child;
          return child;
        };
        try { C.renderEntryChoice(() => {}); }
        finally {
          document.getElementById = oldLookup;
          document.body.appendChild = oldAppend;
        }
        ok(!!entryOverlay && /id="ec-create"/.test(entryOverlay.innerHTML)
          && !/team|команд/i.test(entryOverlay.innerHTML),
          label + ': real first-run entry choice never offers a team');
        ok(!C.hasTeamAccess(), label + ': old Team scopes do not enable a retired module');
        ok(!C.crewingSettingsHost().team, label + ': shared Settings receives no Team capability');
        ok(C._crewingSettingsSectionFor('team') === 'profile'
          && C._crewingSettingsSectionFor('access') === 'profile',
          label + ': old Settings aliases land on Profile');
        ok(C._crewingSettingsSectionFor('connection') === 'home-crewing-connection',
          label + ': existing connection stays reachable');
        ok(!C.shouldShowTeamOnboarding() && !C.shouldShowMobileWorkRoleChoice(),
          label + ': neither first-run role gate can reopen');
        C.showView('team');
        ok(C.state.view === 'crew_flow', label + ': desktop Team alias lands on Crew Flow');
        for (const route of ['work_role', 'member_join']) {
          C.mobileShow(route);
          ok(C.mobileState.view === 'connection', label + ': mobile ' + route + ' is inert');
        }
        for (const render of ['renderTeamView', 'renderTeamTree', 'renderTeamMain']) {
          const container = render === 'renderTeamTree' ? 'left-panel' : 'main';
          elFor(container).innerHTML = '';
          await C[render]();
          const rendered = elFor(container).innerHTML;
          ok(!teamMarkup.test(rendered) && !/openTeamOnboarding|refreshTeamMembers/.test(rendered), label + ': direct ' + render + ' cannot restore Team');
        }
        for (const render of ['mobileRenderWorkRoleChoice', 'mobileRenderMemberJoin', 'mobileRenderTeam']) {
          elFor('mobile-main').innerHTML = '';
          await C[render]();
          ok(!teamMarkup.test(elFor('mobile-main').innerHTML), label + ': direct ' + render + ' cannot restore Team');
        }
        const roleHtml = C.mobileConnectionIntroHtml() + C.mobileSettingsOrgHtml()
          + C.mobileSettingsFiveIdentityHtml();
        ok(!/mobileChangeWorkRole|member_join|mobileChooseWorkRole/.test(roleHtml),
          label + ': connection and both fallback settings have no membership controls');
        elFor('team-new-user-id').value = 'synthetic-other-user';
        await C.claimOwnerAccess();
        await C.addTeamMember();
        await C.removeTeamMember('synthetic-other-user');
        await C.refreshTeamMembers(true);
        C.seedRetiredTeamCache();
        const helperCallStart = calls.length;
        const confirmsBefore = confirmations;
        await Promise.resolve(C._crewingTeamRemoveMember('synthetic-other-user')).catch(() => {});
        ok(confirmations === confirmsBefore
          && !calls.slice(helperCallStart).includes('remove_team_member'),
          label + ': cached direct Team remove helper does not confirm or revoke access');
        C.startTeamChatPoll();
        await C.teamChatPollOnce(true, true);
        const settled = await Promise.allSettled(pendingRenders.splice(0));
        ok(settled.every((r) => r.status === 'fulfilled'),
          label + ': all started Team render/poll calls terminate without setup errors');
        ok(!calls.some((cmd) => teamRpc.has(cmd)), label + ': stale Team callers issue no Team RPC');
        ok(!calls.includes('save_settings') && JSON.stringify(C.state.settings) === before,
          label + ': credential, tenant, profile and role are preserved without a settings write');
      }
    }
    // A pre-existing member onboarding callback must not resurrect the removed screen
    // after it has been closed. The real native boundary is delayed, not its renderer.
    fixture = { server_url: 'https://synthetic.invalid', bearer_token: '', crewing_id: '',
      organization_id: '', token_scopes: [], profile: {}, interface: { language: 'en' } };
    C.state.settings = fixture;
    C.state.myIdentity = null;
    deferIdentity = true;
    elFor('modal-host').innerHTML = '';
    C.openTeamOnboarding('member');
    await C.closeTeamOnboarding(false);
    for (const resolve of identities.splice(0)) resolve({ user_id: 'late-synthetic-user' });
    for (let turn = 0; turn < 10; turn++) await Promise.resolve();
    ok(!teamMarkup.test(elFor('modal-host').innerHTML),
      '635: delayed identity completion cannot recreate Member onboarding after close');
  } finally {
    globalThis.__TAURI__.core.invoke = oldNative;
    if (oldConfirm === undefined) delete globalThis.confirm; else globalThis.confirm = oldConfirm;
    for (const [key, value] of [
      ['skipi_crewing_work_role', savedRole], ['skipi_crewing_entry', savedEntry],
      ['skipi_crewing_demo', savedDemo], ['skipi-crewing-ui-language', savedLang]
    ]) {
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
    }
  }
}

console.log('\ncrewing_presence_contract_harness: ' + (fail === 0 ? 'GREEN' : 'RED') + ' (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail === 0 ? 0 : 1);
