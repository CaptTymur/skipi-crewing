// Regression guard (BACKLOG №105): License activation on an UNCONNECTED device.
//
// Bug: trialActivateLicense() sent POST /api/trial/activate with
// `account_id: s.crewing_id || ''`. On a device that is not connected to an
// accredited crewing, crewing_id is empty → the server (account_id min_length=1)
// rejects ANY valid token with 422 → the blocked-overlay shows "неверный токен".
// A real user with an expired LOCAL trial and no connected profile could never
// activate. See TASKCARD-2026-08-09-crewing-trial-activate-unconnected.md.
//
// This test proves BEHAVIOURALLY (node:vm), by extracting the shipped trial
// script from dist/index.html and driving the real functions:
//   1. Unconnected (empty crewing_id): trialActivateLicense() must NOT POST, and
//      must surface a "connect a company token" message.
//   2. The blocked-overlay for an unconnected device must render a connect-CTA
//      (trialGoConnect) instead of the dead License field.
//   3. Connected (non-empty crewing_id): activation still POSTs with a NON-EMPTY
//      account_id and succeeds (PRESERVE).
//
// It is designed to FAIL on the pre-fix baseline: on baseline, case 1 POSTs with
// an empty account_id, and the overlay always renders the License field. (Both
// runs are recorded in the task card WORKLOG.)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(here, '..', 'dist', 'index.html'), 'utf8');

function makeLocalStorage() {
  const store = new Map();
  store.set('skipi_trial_started_at', new Date(Date.now() - 60 * 86400000).toISOString());
  return {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
    dump() { return Object.fromEntries(store.entries()); },
  };
}

function makeDocument() {
  const nodes = Object.create(null);
  const body = {
    appendChild(el) { el.parentNode = body; if (el.id) nodes[el.id] = el; },
    removeChild(el) { if (el && el.id) delete nodes[el.id]; if (el) el.parentNode = null; },
  };
  return {
    nodes, body,
    createElement(tag) {
      return { tag, id: '', style: {}, innerHTML: '', textContent: '', value: '', disabled: false, parentNode: null,
        classList: { add() {}, remove() {} }, focus() {} };
    },
    getElementById(id) { return nodes[id] || null; },
    setNode(id, props = {}) {
      nodes[id] = Object.assign({ id, style: {}, value: '', innerHTML: '', textContent: '', disabled: false, parentNode: body,
        classList: { add() {}, remove() {} }, focus() {} }, props);
      return nodes[id];
    },
  };
}

function extractTrialScript() {
  const start = raw.indexOf('var TRIAL_STARTED_KEY');
  const end = raw.indexOf('// ------------- boot -------------', start);
  assert.ok(start > 0 && end > start, 'trial script markers present');
  return raw.slice(start, end);
}

function loadCtx({ crewingId }) {
  const document = makeDocument();
  const posts = [];
  const nav = [];
  const ctx = {
    console, Date,
    setTimeout(fn) { if (typeof fn === 'function') fn(); return 1; },
    localStorage: makeLocalStorage(),
    document,
    window: {},
    posts, nav,
    state: { settings: { server_url: 'https://api.skipi.app', bearer_token: 'crew-token', crewing_id: crewingId } },
    escapeHtml(v) { return String(v == null ? '' : v); },
    showToast() {},
    shouldUseMobileShell() { return false; },
    mobileHasConnection() { return false; },
    mobileShow(view) { nav.push('mobile:' + view); },
    openSettings(tab) { nav.push('openSettings:' + tab); },
    async bootDesktopMain() { nav.push('bootDesktopMain'); },
    async fetch(url, opts) {
      let body = null;
      try { body = JSON.parse((opts && opts.body) || 'null'); } catch (e) {}
      posts.push({ url, body });
      return { ok: true, async json() { return { active: true }; } };
    },
  };
  vm.createContext(ctx);
  // trialGoConnect may not exist on the pre-fix baseline; export it only if defined
  // so this harness fails on a clean behavioural assertion, not a load-time crash.
  vm.runInContext(
    `${extractTrialScript()}\nthis.__trial = { trialActivateLicense, trialShowBlockedOverlay,`
      + ` trialGoConnect: (typeof trialGoConnect === 'function' ? trialGoConnect : null) };`,
    ctx,
  );
  return ctx;
}

// --- Case 1: unconnected device (empty crewing_id) → NO POST, connect-CTA message.
{
  const ctx = loadCtx({ crewingId: '' });
  const document = ctx.document;
  document.setNode('trial-license', { value: 'valid-license-token' });
  document.setNode('trial-license-error');
  document.setNode('trial-license-btn');
  await ctx.__trial.trialActivateLicense();
  assert.equal(ctx.posts.length, 0,
    'unconnected device must NOT POST /api/trial/activate (would send empty account_id → 422)');
  const errText = document.getElementById('trial-license-error').textContent || '';
  assert.ok(/подключите токен компании/i.test(errText),
    'unconnected device must surface a "connect a company token" message, got: ' + JSON.stringify(errText));
  console.log('OK: unconnected device — trialActivateLicense does not POST, shows connect message');
}

// --- Case 2: blocked-overlay on unconnected device renders connect-CTA, not the License field.
{
  const ctx = loadCtx({ crewingId: '' });
  ctx.__trial.trialShowBlockedOverlay('');
  const overlay = ctx.document.getElementById('trial-block-overlay');
  assert.ok(overlay, 'blocked overlay present on unconnected device');
  const html = overlay.innerHTML;
  assert.ok(/trialGoConnect\(\)/.test(html),
    'unconnected overlay must expose a connect-CTA (trialGoConnect)');
  assert.ok(!/id="trial-license"/.test(html),
    'unconnected overlay must NOT render the dead License-token input');
  // The connect-CTA actually routes to the existing connection screen (desktop here).
  assert.ok(typeof ctx.__trial.trialGoConnect === 'function',
    'trialGoConnect() must be defined (routes the connect-CTA to the connection screen)');
  ctx.__trial.trialGoConnect();
  assert.ok(ctx.nav.includes('openSettings:connection'),
    'connect-CTA must route to the existing connection screen (desktop openSettings), got: ' + JSON.stringify(ctx.nav));
  console.log('OK: unconnected overlay — connect-CTA present, no License field, routes to connection');
}

// --- Case 3 (PRESERVE): connected device still POSTs with a NON-EMPTY account_id and succeeds.
{
  const ctx = loadCtx({ crewingId: 'crew-42' });
  const document = ctx.document;
  ctx.__trial.trialShowBlockedOverlay('');
  const overlay = ctx.document.getElementById('trial-block-overlay');
  assert.ok(/id="trial-license"/.test(overlay.innerHTML),
    'connected overlay must still render the License field (PRESERVE)');
  document.setNode('trial-license', { value: 'valid-license-token' });
  document.setNode('trial-license-error');
  document.setNode('trial-license-btn');
  await ctx.__trial.trialActivateLicense();
  const activatePosts = ctx.posts.filter((p) => /\/api\/trial\/activate$/.test(p.url));
  assert.equal(activatePosts.length, 1, 'connected device POSTs to /api/trial/activate exactly once');
  assert.ok(activatePosts[0].body && activatePosts[0].body.account_id === 'crew-42',
    'connected device POSTs with the NON-EMPTY crewing_id as account_id, got: '
      + JSON.stringify(activatePosts[0].body));
  assert.equal(ctx.document.getElementById('trial-block-overlay'), null,
    'connected activation success removes the blocked overlay (PRESERVE)');
  assert.equal(ctx.localStorage.dump().skipi_license_token, 'valid-license-token',
    'connected activation stores the license token (PRESERVE)');
  console.log('OK: connected device — POST with non-empty account_id, overlay removed (PRESERVE)');
}

console.log('\nALL PASS: trial license activation on unconnected device is guarded (BACKLOG №105).');
