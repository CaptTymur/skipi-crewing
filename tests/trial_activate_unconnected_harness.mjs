// Regression guard, lineage BACKLOG №105 → No.880/(1495) → task 006 (owner 21.11.2026).
// What №105 protected: a device without an accredited identity must never send an
// activation with an empty account_id. What remains of that surface today: there is no
// activation, no token, no overlay — an expired right routes to the account sign-in and
// nothing is posted anywhere, with or without a local identity. This harness drives the
// shipped gate script (node:vm) in both states and asserts exactly that.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { crewingPublicSettingsFixture } from './fixtures/crewing_public_settings.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(here, '..', 'dist', 'index.html'), 'utf8');
function slice(startMarker, endMarker) {
  const start = raw.indexOf(startMarker); const end = raw.indexOf(endMarker, start);
  assert.ok(start > 0 && end > start, 'marker present: ' + startMarker);
  return raw.slice(start, end);
}
const script = slice('function crewingAccountSessionActive(s){', 'var __entryNext = null;')
  + '\n' + slice('function crewingIsPublicSettings(s) {', 'var convertFileSrc =')
  + '\n' + slice('// ---------- Entitlement gate ----------', '// ------------- left panel resizer');

function loadCtx({ crewingId }) {
  const posts = []; const nav = [];
  const expired = crewingPublicSettingsFixture({
    server_url: 'https://api.skipi.app', connection_context: 'ctx_trial_fixture', crewing_id: crewingId,
    has_bearer_token: !!crewingId, account_session: 'expired', entitlement_source: 'approved_free',
    entitlement_expires_at: new Date(Date.now() - 86400000).toISOString(),
  });
  const ctx = {
    console, Date, posts, nav,
    setTimeout(fn) { if (typeof fn === 'function') fn(); return 1; },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: { getElementById() { return null; }, createElement() { return { style: {} }; }, body: { appendChild() {} } },
    window: {}, __demoMode: false,
    state: { settings: expired },
    isMobileShellActive() { return false; },
    mobileShow(v) { nav.push('mobile:' + v); },
    renderEntryChoice() { nav.push('renderEntryChoice'); },
    entryShowLogin() { nav.push('entryShowLogin'); },
    async fetch(url, opts) { posts.push({ url, body: (opts && opts.body) || null }); return { ok: true, async json() { return {}; } }; },
    async invoke(cmd) { if (cmd === 'get_settings') return expired; posts.push({ invoke: cmd }); throw new Error('unexpected invoke ' + cmd); },
  };
  vm.createContext(ctx);
  vm.runInContext(`${script}\nthis.__trial = { trialGateApply, trialGoSignIn };`, ctx);
  return ctx;
}

for (const crewingId of ['', 'crew-42']) {
  const ctx = loadCtx({ crewingId });
  const phase = await ctx.__trial.trialGateApply();
  assert.equal(phase, 'blocked', 'an expired right blocks (' + (crewingId ? 'with' : 'without') + ' a local identity)');
  assert.equal(ctx.posts.length, 0, 'nothing is posted or activated — no token path exists');
  assert.ok(ctx.nav.includes('renderEntryChoice') && ctx.nav.includes('entryShowLogin'),
    'the only way out is the account sign-in, got: ' + JSON.stringify(ctx.nav));
  console.log('OK:', crewingId ? 'with identity' : 'no identity', '— expired right → sign-in, no request, no token');
}
assert.ok(!/trial-license|skipi_license_token|info@tymur\.org/.test(raw), 'no license field, no license key, no owner contact in dist');
console.log('\nALL PASS: an expired right leads to signing in; nothing is activated and nobody is asked to call the owner.');
