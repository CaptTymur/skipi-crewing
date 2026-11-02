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
    state: { settings: { server_url: 'https://api.skipi.app', has_bearer_token: true, connection_context: 'ctx_trial_fixture', crewing_id: crewingId } },
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
  // trialGoSignIn ведёт на развилку (десктоп) или на мобильный экран входа —
  // обе ветки стабятся, чтобы проверялся МАРШРУТ, а не рендер чужого экрана.
  ctx.isMobileShellActive = () => false;
  ctx.renderEntryChoice = () => { ctx.nav.push('renderEntryChoice'); };
  ctx.entryShowLogin = () => { ctx.nav.push('entryShowLogin'); };
  ctx.mobileShow = (v) => { ctx.nav.push('mobileShow:' + v); };
  ctx.tr = (key) => String(key);
  ctx.escapeHtml = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  vm.runInContext(
    `${extractTrialScript()}\nthis.__trial = { trialShowBlockedOverlay,`
      + ` trialGoSignIn: (typeof trialGoSignIn === 'function' ? trialGoSignIn : null) };`,
    ctx,
  );
  return ctx;
}

// No.880/(1495): активации по лицензионному токену больше нет — ни функции, ни поля,
// ни эндпоинта. Свойство, которое защищала эта карточка (BACKLOG No.105 — устройство
// без аккредитации НЕ должно слать активацию с пустым account_id), сохранено в более
// сильной форме: оверлей блокировки не шлёт НИЧЕГО и не просит токен НИ В ОДНОМ
// состоянии, а единственный выход из него — вход аккаунтом.

// --- Случай 1: без локальной идентичности — ни одного запроса, ни одного поля токена.
{
  const ctx = loadCtx({ crewingId: '' });
  ctx.__trial.trialShowBlockedOverlay('');
  const overlay = ctx.document.getElementById('trial-block-overlay');
  assert.ok(overlay, 'blocked overlay present without a local identity');
  const html = String(overlay.innerHTML || '');
  assert.equal(ctx.posts.length, 0, 'the blocked overlay sends no request at all');
  assert.ok(!/id="trial-license"/.test(html), 'no license-token input is rendered');
  assert.ok(!/токен|token/i.test(html), 'the overlay asks for no token in any wording');
  assert.ok(/trialGoSignIn\(\)/.test(html), 'the only way out is the sign-in path');
  console.log('OK: no identity — overlay blocks, asks nothing, offers sign-in');
}

// --- Случай 2: с локальной идентичностью — поведение то же, без исключений.
{
  const ctx = loadCtx({ crewingId: 'crew-42' });
  ctx.__trial.trialShowBlockedOverlay('');
  const overlay = ctx.document.getElementById('trial-block-overlay');
  assert.ok(overlay, 'blocked overlay present with a local identity');
  const html = String(overlay.innerHTML || '');
  assert.equal(ctx.posts.length, 0, 'still no request — an identity does not unlock a token path');
  assert.ok(!/id="trial-license"/.test(html), 'still no license-token input');
  assert.ok(/trialGoSignIn\(\)/.test(html), 'still the sign-in path, same as without an identity');
  console.log('OK: with identity — same overlay, no token path, sign-in only');
}

// --- Случай 3: выход из оверлея ведёт именно на экран входа.
{
  const ctx = loadCtx({ crewingId: '' });
  assert.ok(typeof ctx.__trial.trialGoSignIn === 'function',
    'trialGoSignIn() must be defined (routes the overlay out to the account form)');
  ctx.__trial.trialShowBlockedOverlay('');
  ctx.__trial.trialGoSignIn();
  assert.equal(ctx.document.getElementById('trial-block-overlay'), null,
    'the sign-in path hides the blocking overlay before showing the form');
  assert.ok(ctx.nav.includes('renderEntryChoice') && ctx.nav.includes('entryShowLogin'),
    'the sign-in path opens the entry fork and its login door, got: ' + JSON.stringify(ctx.nav));
  console.log('OK: the overlay routes out to the account sign-in, not to a connection screen');
}

console.log('\nALL PASS: an expired right blocks the app and the only way out is signing in (No.105 preserved).');
