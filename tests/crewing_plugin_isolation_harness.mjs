// Headless harness for Crewing's first-consumer shared plugin host runtime.
//
// It reuses the shared _host-runtime §1 contract without weakening assertions,
// then verifies Crewing-specific glue: Apps entry points remain visible, the
// bundled demo pack is integrity-checked, fail-closed cases stay closed, and the
// demo plugin bytes are delivered only to a sandboxed iframe.
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
const EXPECTED_RUNTIME_SHA = '93c8eff840d6de252dc3c76f03e7a4a0823ed4907f67a28dc92b3e46214a98c7';

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
ok(HTML.includes('BEGIN skipi-host-runtime v1.0.0 sha256:' + EXPECTED_RUNTIME_SHA), 'embedded runtime records shared version/hash');
ok(RUNTIME_VERSION === '1.0.0\nsha256:' + EXPECTED_RUNTIME_SHA, 'shared RUNTIME_VERSION matches embedded runtime hash');
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

ok(M.CREWING_PLUGIN_HOST_RUNTIME_VERSION === '1.0.0', 'Crewing records shared runtime version 1.0.0');
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
rt.close();
ok(rt._active() === null, 'demo runtime close tears down the active frame');

console.log('\n' + (fail === 0 ? 'ALL GREEN' : 'FAILURES') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
