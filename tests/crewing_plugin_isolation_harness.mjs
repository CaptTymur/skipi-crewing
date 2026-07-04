// Headless harness for Crewing's first-consumer shared plugin host runtime.
//
// It reuses the shared _host-runtime §1 contract without weakening assertions,
// then verifies Crewing-specific glue: Apps entry points remain visible, the
// bundled demo pack is integrity-checked, fail-closed cases stay closed, and the
// demo plugin bytes are delivered only to a sandboxed iframe.
//
// The trailing sections cover the Apps compact launcher standard placement
// (cross-home Compact Plugin Launcher v2, accepted 2026-07-02): canonical QA
// hooks, installed-only search, gear -> manage -> detail -> back navigation,
// install/open/disable/enable transitions, honest empty/offline/error states,
// additive mobile rail hooks, and the unchanged candidate/team-token
// default-deny posture.
//
//   node tests/crewing_plugin_isolation_harness.mjs

import fs from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TextEncoder } from 'node:util';
import { runIsolationContract } from '../../skipi-plugins/_host-runtime/harness/isolation-contract.mjs';
import { installFakeDom } from '../../skipi-plugins/_host-runtime/harness/fake-dom.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'dist', 'index.html'), 'utf8');
const RUNTIME_VERSION = fs.readFileSync('/home/linux/Developer/skipi-plugins/_host-runtime/dist/RUNTIME_VERSION', 'utf8').trim();
const EXPECTED_RUNTIME_VERSION = '1.0.1';
const EXPECTED_RUNTIME_SHA = 'edd0ba5f8b21f05fcf55485b13b1dafc963173b2d2aa79e261611297283c307a';

try { if (!globalThis.crypto) globalThis.crypto = webcrypto; } catch (_) {}
try { if (!globalThis.TextEncoder) globalThis.TextEncoder = TextEncoder; } catch (_) {}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const section = (t) => console.log('\n# ' + t);
const tick = () => new Promise((r) => setTimeout(r, 0));

function extractRuntimeSource() {
  const m = HTML.match(/<!-- BEGIN skipi-host-runtime[\s\S]*?<script>\n([\s\S]*?)\n<\/script>\n<!-- END skipi-host-runtime -->/);
  if (!m) throw new Error('embedded shared runtime block not found');
  return m[1];
}

function extractAppsBlock() {
  const start = HTML.indexOf('// ===================== Apps / Plugin host');
  const end = HTML.indexOf('// ------------- Android / compact mobile shell -------------', start);
  if (start < 0 || end < 0) throw new Error('Crewing Apps/plugin block not found');
  return HTML.slice(start, end);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;' }[c]));
}

function makeSharedLoader(slug, permissions) {
  const js = "/* SKIPI_FIXTURE_PLUGIN CREWING */ window.SkipiPlugins=window.SkipiPlugins||{};"
    + "window.SkipiPlugins['" + slug + "']={manifest:{id:'" + slug + "'},mount:function(){},unmount:function(){}};";
  return {
    async install() {
      return {
        ok: true,
        source: 'crewing-shared-contract-fixture',
        pack: {
          id: slug,
          name: 'Crewing Fixture',
          version: '0.0.0',
          supported_hosts: ['crewing'],
          entrypoints: { ui: 'index.js', style: 'index.css' },
          files: { 'index.js': js, 'index.css': '/* crewing fixture */' },
          permissions: permissions.slice(),
          distribution: { mode: 'bundled_first_party', remote_code: false },
          network: 'none',
          data_access: 'none',
        },
      };
    },
  };
}

function makeSharedHost() {
  const key = (slug, k) => 'skipi_plugin_' + slug + '_' + k;
  return {
    id: 'crewing',
    storage: {
      get: (slug, k) => globalThis.localStorage.getItem(key(slug, k)),
      set: (slug, k, v) => globalThis.localStorage.setItem(key(slug, k), String(v)),
      remove: (slug, k) => globalThis.localStorage.removeItem(key(slug, k)),
    },
    theme: { get: () => 'dark', subscribe: () => () => {} },
    navigation: { setTitle: () => {}, closePlugin: () => {} },
  };
}

const runtimeSource = extractRuntimeSource();
const appsBlock = extractAppsBlock();

section('shared _host-runtime isolation contract');
const shared = await runIsolationContract({
  runtimeSource,
  slug: 'crewing-host-demo',
  secretKey: 'skipi_crewing_bearer_token',
  secretVal: 'SECRET-CREWING-BEARER-TOKEN-DO-NOT-LEAK',
  makeLoader: (perms) => makeSharedLoader('crewing-host-demo', perms),
  makeHost: makeSharedHost,
});
pass += shared.pass;
fail += shared.fail;

section('static Crewing host glue');
ok(HTML.includes('id="mt-apps"') && /showView\('apps'\)/.test(HTML), 'desktop Apps tab remains reachable');
ok(/mobileNavButton\('apps', navView, '[^']+', 'Apps'\)/.test(HTML), 'mobile bottom Apps rail item remains reachable');
ok(HTML.includes('BEGIN skipi-host-runtime v' + EXPECTED_RUNTIME_VERSION + ' sha256:' + EXPECTED_RUNTIME_SHA), 'embedded runtime records shared version/hash');
ok(RUNTIME_VERSION === EXPECTED_RUNTIME_VERSION + '\nsha256:' + EXPECTED_RUNTIME_SHA, 'shared RUNTIME_VERSION matches embedded runtime hash');
ok(/SkipiPluginRuntime\.create/.test(appsBlock) && /rt\.open\(id, c\)/.test(appsBlock), 'Crewing mount path uses shared runtime open()');
ok(!/function crewingHostApi/.test(appsBlock) && !/reg\.mount\(c/.test(appsBlock), 'old inline host API and direct reg.mount path are removed');
ok(/enabled:true/.test(appsBlock.replace(/\s/g, '')), 'bundled runtime is enabled for the local Apps path');
ok(!/noCsp\s*:/.test(appsBlock), 'production runtime config does not enable noCsp');
ok(!/permissions\s*:\s*\[[^\]]*(candidate|vacancy|contact|chat|team|token)/i.test(appsBlock), 'demo plugin grants no candidate/vacancy/contact/chat/team/token permissions');
ok(/connect-src 'none'/.test(runtimeSource), "embedded runtime frame CSP forbids direct network with connect-src 'none'");
ok(/setAttribute\('sandbox', 'allow-scripts'\)/.test(runtimeSource) && !/allow-scripts allow-same-origin/.test(runtimeSource), 'embedded runtime sandbox is allow-scripts only');

section('real Crewing bundled loader fail-closed behavior');
const ctx = installFakeDom();
new Function(runtimeSource)();
const M = new Function('showToast', 'escapeHtml', 'isMobileShellActive',
  appsBlock + '\nreturn {'
  + 'CREWING_PLUGIN_HOST_RUNTIME_VERSION, CREWING_PLUGIN_HOST_RUNTIME_SHA256, CREWING_PLUGIN_BUNDLES,'
  + 'crewingBundledLoader, crewingClonePack, crewingInstallBundledPack, crewingPluginRuntime'
  + '};')(() => {}, escapeHtml, () => false);

ok(M.CREWING_PLUGIN_HOST_RUNTIME_VERSION === EXPECTED_RUNTIME_VERSION, 'Crewing records shared runtime version ' + EXPECTED_RUNTIME_VERSION);
ok(M.CREWING_PLUGIN_HOST_RUNTIME_SHA256 === EXPECTED_RUNTIME_SHA, 'Crewing records shared runtime sha256');

const installed = await M.crewingBundledLoader.install('crewing-host-demo');
ok(installed && installed.ok && installed.pack.files['index.js'].includes('CREWING_HOST_DEMO_PLUGIN'), 'known demo plugin installs from verified bundled bytes');
ok(installed && installed.pack.permissions.join(',') === 'local_storage,theme', 'demo grants only local_storage and theme');

const unknown = await M.crewingBundledLoader.install('missing-plugin');
ok(unknown && unknown.ok === false && unknown.stage === 'install', 'unknown plugin is fail-closed at install');

const missingManifest = await M.crewingInstallBundledPack('crewing-host-demo', { id: 'crewing-host-demo' }, 'test:bad-manifest');
ok(missingManifest && missingManifest.ok === false && missingManifest.stage === 'manifest', 'missing manifest/entrypoints fail closed');

const badGrant = M.crewingClonePack(M.CREWING_PLUGIN_BUNDLES['crewing-host-demo']);
badGrant.permissions = ['candidate.read'];
const grantDenied = await M.crewingInstallBundledPack('crewing-host-demo', badGrant, 'test:bad-grant');
ok(grantDenied && grantDenied.ok === false && grantDenied.stage === 'policy', 'candidate/vacancy/contact/chat/team-style grants are denied');

const tampered = M.crewingClonePack(M.CREWING_PLUGIN_BUNDLES['crewing-host-demo']);
tampered.files['index.js'] += '\n// tamper';
const badIntegrity = await M.crewingInstallBundledPack('crewing-host-demo', tampered, 'test:tampered');
ok(badIntegrity && badIntegrity.ok === false && badIntegrity.stage === 'integrity', 'tampered plugin byte fails integrity before mount');

section('demo plugin mounts only through the sandbox runtime');
const TOKEN = 'SECRET-CREWING-SETTINGS-TOKEN-DO-NOT-LEAK';
ctx.store.set('skipi_crewing_bearer_token', TOKEN);
const rt = M.crewingPluginRuntime();
const mountEl = ctx.makeMountEl();
const opened = rt.open('crewing-host-demo', mountEl);
const ifr = mountEl._child;
ok(ifr && ifr._tag === 'iframe', 'runtime created an iframe for the demo plugin');
ok(ifr.attrs.sandbox === 'allow-scripts', 'demo iframe sandbox="allow-scripts"');
ok(!/allow-same-origin/.test(ifr.attrs.sandbox || ''), 'demo iframe has no allow-same-origin');
ok(/default-src 'none'/.test(ifr.srcdoc) && /connect-src 'none'/.test(ifr.srcdoc), 'demo iframe srcdoc has strict CSP and no direct network');
ok(!ifr.srcdoc.includes(TOKEN), 'Crewing bearer token is not present in demo iframe srcdoc');
const token = JSON.parse(ifr.srcdoc.match(/__SKIPI_TOKEN__=("[0-9a-f]+")/)[1]);

ctx.framePosts.length = 0;
for (let i = 0; i < 8; i++) await tick();
ctx.emit({ ch: 'skipi-plugin', v: 1, token, type: 'ready' });
let init = null;
for (let i = 0; i < 8; i++) {
  await tick();
  init = ctx.framePosts.find((m) => m.type === 'init');
  if (init) break;
}
ok(!!init, 'host sends init to the sandbox frame after integrity verification');
ok(init && init.hostId === 'crewing', 'init exposes only non-secret host id');
ok(init && init.js.includes('CREWING_HOST_DEMO_PLUGIN'), 'init carries demo plugin JS to the frame, not the host document');
ok(init && !JSON.stringify(init).includes(TOKEN), 'init message contains no Crewing bearer token');

ctx.framePosts.length = 0;
ctx.emit({ ch: 'skipi-plugin', v: 1, token, type: 'storage.set', key: 'opens', value: '7' });
ctx.emit({ ch: 'skipi-plugin', v: 1, token, type: 'storage.get', id: 77, key: 'opens' });
await tick();
const got = ctx.framePosts.find((m) => m.type === 'storage.result' && m.id === 77);
ok(got && got.value === '7', 'demo storage round-trips through the bridge');
ok(ctx.store.get('skipi_plugin_crewing-host-demo_opens') === '7', 'demo storage is host-side and plugin-scoped');
ok(ctx.store.get('skipi_crewing_bearer_token') === TOKEN, 'demo storage did not touch Crewing bearer token');

ctx.emit({ ch: 'skipi-plugin', v: 1, token, type: 'mounted', height: 240, selfcheck: { parentDomAccess: false, storageBlocked: true, fetchBlocked: true } });
const mounted = await opened;
ok(mounted && mounted.ok && mounted.selfcheck.fetchBlocked === true, 'demo open resolves after frame self-check reports network blocked');

let navCloseError = null;
try { ctx.emit({ ch: 'skipi-plugin', v: 1, token, type: 'nav.close' }); } catch (e) { navCloseError = e; }
await tick();
ok(!navCloseError, 'plugin nav.close does not throw after host-side close/unmount');
ok(rt._active() === null, 'plugin nav.close tears down the active frame');

// ===== Apps compact launcher standard placement (Compact Plugin Launcher v2) =====

function escapeAttr(s) {
  return String(s == null ? '' : s).replace(/[&'"<>]/g, (c) => '&#' + c.charCodeAt(0) + ';');
}
const settle = async (n = 12) => { for (let i = 0; i < n; i++) await tick(); };

section('launcher static: canonical QA hooks present, existing hooks intact');
ok(/id="mt-apps" data-qa="crewing-module-apps"/.test(HTML), 'desktop Apps tab carries canonical crewing-module-apps hook additively (id="mt-apps" kept)');
ok(HTML.includes('data-qa="apps-search-input"'), 'launcher search input hook apps-search-input present');
ok(HTML.includes('data-qa="plugins-settings-open"'), 'launcher gear hook plugins-settings-open present');
ok(HTML.includes("data-qa=\"plugin-tile-'+escapeHtml(p.id)+'\""), 'launcher tiles carry plugin-tile-<id> hook');
ok(HTML.includes("data-qa=\"plugin-open-'+escapeHtml(p.id)+'\""), 'launcher tiles carry plugin-open-<id> hook');
ok(HTML.includes("data-qa=\"plugin-settings-'+escapeHtml(p.id)+'\""), 'manage tiles carry plugin-settings-<id> hook');
ok(HTML.includes('data-qa="plugin-empty-state"'), 'plugin-empty-state hook present');
ok(HTML.includes('data-qa="plugin-offline-state"'), 'plugin-offline-state hook present');
ok(HTML.includes('data-qa="plugin-error-state"'), 'plugin-error-state hook present');
ok(/data-qa="bottom-nav-more" onclick="mobileOpenSettingsHome\(\)"/.test(HTML), 'mobile rail has additive bottom-nav-more entry (settings home)');
ok(HTML.includes("'mobile.nav.more':'More'") && HTML.includes("'mobile.nav.more':'Ещё'"), 'mobile.nav.more label translated (EN + RU)');
ok(/navigator\.onLine===false/.test(HTML), 'offline state is driven by real navigator.onLine only');

section('launcher mobile rail hooks (rendered via mobileNavButton)');
{
  const start = HTML.indexOf('var MOBILE_RAIL_QA');
  const end = HTML.indexOf('function mobileUpdateModuleRailHint', start);
  ok(start > 0 && end > start, 'MOBILE_RAIL_QA + mobileNavButton block found');
  const navBtn = new Function('escapeAttr', 'escapeHtml', HTML.slice(start, end) + '\nreturn mobileNavButton;')(escapeAttr, escapeHtml);
  const home = navBtn('vacancies', 'vacancies', '&#8962;', 'Vacancies');
  ok(home.includes('data-qa="bottom-nav-home"'), 'vacancies rail button carries bottom-nav-home');
  ok(home.includes('data-mview="vacancies"') && home.includes('active'), 'vacancies rail button keeps data-mview hook and active state');
  ok(navBtn('mailings', 'vacancies', '✉', 'Mailings').includes('data-qa="bottom-nav-workspace"'), 'mailings rail button carries bottom-nav-workspace');
  ok(navBtn('apps', 'vacancies', '🧩', 'Apps').includes('data-qa="bottom-nav-apps"'), 'apps rail button carries bottom-nav-apps');
  const docs = navBtn('documents', 'vacancies', '📄', 'Docs');
  ok(!/bottom-nav-/.test(docs) && docs.includes('data-mview="documents"'), 'non-canonical rail buttons get no bottom-nav hook and keep data-mview');
}

section('launcher behavioral: launcher / manage / detail / lifecycle');
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
const launcherToasts = [];
const L = new Function('showToast', 'escapeHtml', 'isMobileShellActive',
  appsBlock + '\nreturn {'
  + 'getState: function(){ return appsState; },'
  + 'CREWING_PLUGINS, CREWING_PLUGIN_BUNDLES, CREWING_PLUGIN_SCOPE_DENY, CREWING_PLUGIN_ALLOWED_PERMISSIONS,'
  + 'crewingPermissionAllowed, crewingInstallBundledPack, crewingClonePack,'
  + 'pluginMeta, pluginTileState, installedPluginIds, crewingRefreshLauncherIntegrity,'
  + 'appsLauncherHtml, appsLauncherBodyHtml, appsFilter, appsManageHtml, appsDetailHtml, appsHostHtml,'
  + 'appsOpenManage, appsBackToLauncher, appsOpenDetail, appsBackToManage,'
  + 'appsInstall, appsDisable, appsEnable, appsOpen, pluginCloseHost, renderAppsView,'
  + 'crewingRuntimeHost, pluginNotifyTheme, crewingPluginRuntime'
  + '};')((m) => launcherToasts.push(m), escapeHtml, () => false);

ok(L.getState().screen === 'launcher', 'initial Apps screen is the compact launcher');
ok(L.installedPluginIds().length === 0, 'fresh vault has no installed plugins');

let launcherHtml = L.appsLauncherHtml();
ok(launcherHtml.includes('data-qa="apps-search-input"') && launcherHtml.includes('data-qa="plugins-settings-open"'), 'launcher renders search input and settings gear');
ok(launcherHtml.includes('data-qa="plugin-empty-state"') && launcherHtml.includes('appsOpenManage()'), 'empty launcher shows honest empty state with CTA to plugin settings');
ok(!launcherHtml.includes('plugin-tile-') && !launcherHtml.includes('interview-checklist'), 'empty launcher shows no tiles and no catalog/coming-soon entries');

L.appsOpenManage();
ok(L.getState().screen === 'manage', 'gear opens the manage screen');
const manageHtml = L.appsManageHtml();
ok(manageHtml.includes('data-qa="plugin-settings-crewing-host-demo"'), 'manage view exposes plugin-settings-<id> hook');
ok(manageHtml.includes('appsBackToLauncher()'), 'manage view has back-to-launcher control');
ok(manageHtml.includes('interview-checklist') && manageHtml.includes('candidate-redaction'), 'manage view lists the full catalog (incl. coming-soon)');
L.appsBackToLauncher();
ok(L.getState().screen === 'launcher', 'back from manage returns to the launcher');

L.appsOpenDetail('crewing-host-demo');
ok(L.getState().screen === 'detail', 'manage tile opens plugin detail');
let detailHtml = L.appsDetailHtml('crewing-host-demo');
ok(detailHtml.includes("appsInstall('crewing-host-demo')") && detailHtml.includes('appsBackToManage()'), 'detail offers Install and back-to-manage before install');
ok(/local_storage/.test(detailHtml) && /theme/.test(detailHtml), 'detail shows granted permissions');
ok(/cannot read or write candidate data|no candidate/i.test(detailHtml), 'detail keeps honest data-access copy');

L.appsInstall('crewing-host-demo');
ok(L.pluginTileState(L.pluginMeta('crewing-host-demo')) === 'installed', 'install persists installed+enabled state');
detailHtml = L.appsDetailHtml('crewing-host-demo');
ok(detailHtml.includes("appsOpen('crewing-host-demo')") && detailHtml.includes("appsDisable('crewing-host-demo')"), 'detail offers Open and Disable once installed');

let launcherBody = L.appsLauncherBodyHtml();
ok(launcherBody.includes('data-qa="plugin-tile-crewing-host-demo"') && launcherBody.includes('data-qa="plugin-open-crewing-host-demo"'), 'installed plugin appears as a launcher tile with open hook');
ok(!launcherBody.includes('plugin-empty-state'), 'launcher empty state is gone after install');

section('launcher behavioral: installed-only search');
L.appsFilter('host');
ok(L.appsLauncherBodyHtml().includes('plugin-tile-crewing-host-demo'), 'search matches installed plugin by name');
L.appsFilter('interview');
launcherBody = L.appsLauncherBodyHtml();
ok(launcherBody.includes('data-qa="plugin-empty-state"') && !launcherBody.includes('interview-checklist'), 'search does NOT surface non-installed catalog plugins (installed-only)');
L.appsFilter('zzz-no-match');
ok(L.appsLauncherBodyHtml().includes('data-qa="plugin-empty-state"'), 'no-result search shows honest empty state');
L.appsFilter('');
ok(L.appsLauncherBodyHtml().includes('plugin-tile-crewing-host-demo'), 'clearing search restores installed tiles');

section('launcher behavioral: open/close, disable/enable');
L.renderAppsView();
L.appsOpen('crewing-host-demo');
ok(L.getState().screen === 'host', 'launcher tile open mounts the host screen');
ok(L.appsHostHtml('crewing-host-demo').includes('apps-host-container'), 'host screen renders the isolated plugin container');
L.pluginCloseHost();
ok(L.getState().screen === 'launcher', 'closing a launcher-opened plugin returns to the launcher');
L.appsOpenDetail('crewing-host-demo');
L.appsOpen('crewing-host-demo');
L.pluginCloseHost();
ok(L.getState().screen === 'detail', 'closing a detail-opened plugin returns to detail');

L.appsDisable('crewing-host-demo');
ok(L.pluginTileState(L.pluginMeta('crewing-host-demo')) === 'disabled', 'disable persists disabled state');
ok(L.installedPluginIds().length === 0, 'disabled plugin leaves the installed set');
ok(L.appsLauncherBodyHtml().includes('data-qa="plugin-empty-state"'), 'disabled plugin disappears from the launcher (installed-only)');
launcherToasts.length = 0;
L.appsOpen('crewing-host-demo');
ok(L.getState().screen !== 'host' && launcherToasts.length > 0, 'open is refused while the plugin is disabled');
L.appsEnable('crewing-host-demo');
ok(L.pluginTileState(L.pluginMeta('crewing-host-demo')) === 'installed', 're-enable restores installed state');
ok(L.appsLauncherBodyHtml().includes('plugin-tile-crewing-host-demo'), 're-enabled plugin returns to the launcher');

section('launcher behavioral: honest offline / error states');
globalThis.navigator.onLine = false;
launcherBody = L.appsLauncherBodyHtml();
ok(launcherBody.includes('data-qa="plugin-offline-state"') && !launcherBody.includes('plugin-tile-'), 'navigator.onLine=false renders the offline state');
globalThis.navigator.onLine = true;
ok(!L.appsLauncherBodyHtml().includes('plugin-offline-state'), 'offline state clears when the connection is back');

const launcherBundle = L.CREWING_PLUGIN_BUNDLES['crewing-host-demo'];
const launcherOriginalJs = launcherBundle.files['index.js'];
launcherBundle.files['index.js'] += '\n// tampered by harness';
L.crewingRefreshLauncherIntegrity();
await settle();
ok(L.appsLauncherBodyHtml().includes('data-qa="plugin-error-state"'), 'real sha256 mismatch renders the integrity error state');
launcherBundle.files['index.js'] = launcherOriginalJs;
L.crewingRefreshLauncherIntegrity();
await settle();
ok(!L.appsLauncherBodyHtml().includes('plugin-error-state'), 'error state clears after integrity is restored (no simulated errors)');

section('launcher: candidate/team-token default-deny unchanged');
ok(L.CREWING_PLUGIN_ALLOWED_PERMISSIONS.join(',') === 'local_storage,theme', 'allowed permissions remain exactly local_storage,theme');
['candidate.read', 'vacancy.read', 'contact.list', 'chat.read', 'team:write', 'token-read', 'crew.list', 'message.send'].forEach((p) => {
  ok(L.crewingPermissionAllowed(p) === false, 'permission denied by default: ' + p);
});
{
  const badGrantPack = L.crewingClonePack(L.CREWING_PLUGIN_BUNDLES['crewing-host-demo']);
  badGrantPack.permissions = ['team:read'];
  const res = await L.crewingInstallBundledPack('crewing-host-demo', badGrantPack, 'test:launcher-bad-grant');
  ok(res && res.ok === false && res.stage === 'policy', 'team-token style grant still fails closed at install policy');
}
ok(globalThis.__SKIPI_CREWING_PLUGIN_TEST__ && typeof globalThis.__SKIPI_CREWING_PLUGIN_TEST__.launcher.installedPluginIds === 'function',
  'QA test hook exposes launcher state for built-artifact QA');

// ===== Fresh-install light theme invariant (Homes sweep 2026-07-03) =====
// The app must first-launch LIGHT with empty settings/localStorage even under
// OS dark mode; an explicitly saved dark preference stays dark; the plugin
// theme bridge reports light on fresh launch (runtime dark fallbacks unreachable).

section('light theme static invariants');
ok(/^<html lang="ru" data-theme="light">/m.test(HTML), 'static <html> ships data-theme="light" — first paint is light');
ok(!/prefers-color-scheme/.test(HTML), 'no prefers-color-scheme anywhere — OS dark mode cannot influence the app');
ok(!/matchMedia/.test(HTML), 'no matchMedia — no OS theme sniffing');
ok((HTML.match(/setAttribute\('data-theme'/g) || []).length === 1, 'applyTheme is the only writer of data-theme');
ok(HTML.includes("selectCtrl('i-theme', iface.theme||'light'"), 'desktop settings theme picker defaults to light');
ok(HTML.includes("(iface.theme==='dark'?'Dark':'Light')"), 'desktop settings header shows Light unless explicitly dark');
ok(/\(\(s\.interface && s\.interface\.theme\) \|\| 'light'\)/.test(HTML), 'mobile settings theme derives with light default');
ok(HTML.includes("(((s.interface&&s.interface.theme)||'light')==='dark'?'Dark':'Light')"), 'mobile settings list shows Light unless explicitly dark');

const LIB_RS = fs.readFileSync(path.join(ROOT, 'src-tauri', 'src', 'lib.rs'), 'utf8');
ok(/#\[derive\([^)]*Default[^)]*\)\]\s*#\[serde\(default\)\]\s*pub struct InterfacePrefs/.test(LIB_RS), 'Rust InterfacePrefs uses derived Default — fresh settings theme is empty string (-> light in JS)');
ok(!/"dark"\.to_string|default\s*=\s*"dark"/.test(LIB_RS), 'no dark default anywhere in Rust settings');

section('light theme behavioral: applyTheme');
const themeFnStart = HTML.indexOf('function applyTheme()');
const themeFnEnd = HTML.indexOf('// ===================== Apps / Plugin host', themeFnStart);
ok(themeFnStart > 0 && themeFnEnd > themeFnStart, 'applyTheme source found');
function runApplyTheme(settings) {
  const attrs = { 'data-theme': 'light' };  // static <html> default
  const doc = { documentElement: { getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = v; } } };
  new Function('state', 'document', HTML.slice(themeFnStart, themeFnEnd) + '\napplyTheme();')({ settings }, doc);
  return attrs['data-theme'];
}
ok(runApplyTheme(undefined) === 'light', 'fresh install (settings load failed) starts light');
ok(runApplyTheme({}) === 'light', 'fresh install (empty settings) starts light');
ok(runApplyTheme({ interface: { theme: '' } }) === 'light', 'empty theme string starts light');
ok(runApplyTheme({ interface: { theme: 'dark' } }) === 'dark', 'explicitly saved dark preference still starts dark');
ok(runApplyTheme({ interface: { theme: 'Dark' } }) === 'dark', 'saved dark is case-insensitive');
ok(runApplyTheme({ interface: { theme: 'system' } }) === 'light', 'unknown/legacy values (e.g. system) fall to light, never dark');
ok(runApplyTheme({ interface: { theme: 'light' } }) === 'light', 'saved light stays light');

section('light theme behavioral: plugin host theme bridge');
// Replace the fake-dom fixed-dark documentElement with a stateful stub seeded
// like the real static <html data-theme="light"> so host wiring is exercised.
const themeAttrs = { 'data-theme': 'light' };
globalThis.document.documentElement = { getAttribute: (k) => (k in themeAttrs ? themeAttrs[k] : null), setAttribute: (k, v) => { themeAttrs[k] = v; } };
ok(L.crewingRuntimeHost().theme.get() === 'light', 'host theme adapter reports light on fresh launch');

const rtTheme = L.crewingPluginRuntime();
const themeMountEl = ctx.makeMountEl();
ctx.framePosts.length = 0;
rtTheme.open('crewing-host-demo', themeMountEl);
const themeIfr = themeMountEl._child;
ok(themeIfr && themeIfr._tag === 'iframe', 'theme check mounts through the sandbox runtime');
const themeToken = JSON.parse(themeIfr.srcdoc.match(/__SKIPI_TOKEN__=("[0-9a-f]+")/)[1]);
await settle(8);
ctx.emit({ ch: 'skipi-plugin', v: 1, token: themeToken, type: 'ready' });
let themeInit = null;
for (let i = 0; i < 8; i++) { await tick(); themeInit = ctx.framePosts.find((m) => m.type === 'init'); if (themeInit) break; }
ok(!!themeInit, 'bridge init reached the frame');
ok(themeInit && themeInit.theme === 'light', "bridge init carries theme:'light' on fresh launch — runtime dark fallbacks never fire");

// explicit dark still propagates (user choice preserved end-to-end)
themeAttrs['data-theme'] = 'dark';
ctx.framePosts.length = 0;
L.pluginNotifyTheme();
await tick();
const themePush = ctx.framePosts.find((m) => m.type === 'theme');
ok(themePush && themePush.theme === 'dark', 'explicitly saved dark still propagates over the bridge');
ok(L.crewingRuntimeHost().theme.get() === 'dark', 'host adapter respects saved dark');
themeAttrs['data-theme'] = 'light';
rtTheme.close();

console.log('\n' + (fail === 0 ? 'ALL GREEN' : 'FAILURES') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
