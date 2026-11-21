// Regression guard: the entitlement gate is PRESENT, WIRED INTO BOOT, and shaped as the
// owner decided on 21.11.2026 (task 006): access is the account's right, renewed through
// the product — never through contacting the owner. So this harness pins the ABSENCE of
// what used to be here as much as the presence of what is:
//   - trialGateApply() is called in the boot path and its 'blocked' result is consumed;
//   - no installation-local two-week clock (localStorage), no warning banner, no
//     «free period over — contact …» overlay, no contact email/phone anywhere in dist;
//   - a live right → 'free'; an expired right → 'blocked' AND the sign-in screen;
//   - no account session, or unreadable settings → 'free' (never blocked by a clock).
// Checks run against a COMMENT-STRIPPED view of dist/index.html (2026-07-11 hardening).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { crewingPublicSettingsFixture } from './fixtures/crewing_public_settings.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(here, '..', 'dist', 'index.html'), 'utf8');

function stripComments(src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return noBlock.split('\n').map((line) => {
    let inS = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inS) { if (c === inS && line[i - 1] !== '\\') inS = null; continue; }
      if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
      if (c === '/' && line[i + 1] === '/' && line[i - 1] !== ':') return line.slice(0, i);
    }
    return line;
  }).join('\n');
}
const html = stripComments(raw);

const present = [
  ['trialPhase() defined', /function\s+trialPhase\s*\(/],
  ['trialGateApply() defined', /function\s+trialGateApply\s*\(/],
  ['trialGateApply() WIRED into boot (result consumed: === \'blocked\')', /await\s+trialGateApply\s*\(\)\s*===\s*['"]blocked['"]/],
  ['sign-in path out of a blocked right', /function trialGoSignIn\(/],
];
const absent = [
  ['no installation-local trial clock', /skipi_trial_started_at|TRIAL_STARTED_KEY|trialLocalPhase|trialDaysSince/],
  ['no «free period over» overlay', /trial-block-overlay|Бесплатный период закончился/],
  ['no warning banner', /trial-warning-banner|trialShowWarningBanner/],
  ['no owner contact email', /info@tymur\.org/],
  ['no owner contact phone', /\+?357\s*97\s*617\s*412|35797617412/],
  ['no license-token field or key', /trial-license|skipi_license_token/],
];
let fail = 0;
for (const [name, re] of present) { if (re.test(html)) console.log('OK:', name); else { console.error('FAIL: gate missing/unwired —', name); fail = 1; } }
for (const [name, re] of absent) { if (!re.test(html)) console.log('OK:', name); else { console.error('FAIL: retired surface still shipped —', name); fail = 1; } }

function slice(startMarker, endMarker) {
  const start = raw.indexOf(startMarker);
  const end = raw.indexOf(endMarker, start);
  assert.ok(start > 0 && end > start, 'marker present: ' + startMarker);
  return raw.slice(start, end);
}
function extractTrialScript() { return slice('// ---------- Entitlement gate ----------', '// ------------- left panel resizer'); }
function extractSessionDeps() {
  return slice('function crewingAccountSessionActive(s){', 'var __entryNext = null;')
    + '\n' + slice('function crewingIsPublicSettings(s) {', 'var convertFileSrc =');
}
function projection(accountSession, entitlementExpiresAt) {
  return crewingPublicSettingsFixture({
    server_url: 'https://api.skipi.app', connection_context: 'ctx_trial_fixture',
    crewing_id: 'crew-1', has_bearer_token: true,
    account_session: accountSession, entitlement_source: 'approved_free',
    entitlement_expires_at: entitlementExpiresAt,
  });
}
function loadTrialContext({ serverMode }) {
  const nav = [];
  const expiredAt = new Date(Date.now() - 86400000).toISOString();
  const liveAt = new Date(Date.now() + 30 * 86400000).toISOString();
  const ctx = {
    console, Date, nav,
    setTimeout(fn) { if (typeof fn === 'function') fn(); return 1; },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: { getElementById() { return null; }, createElement() { return { style: {} }; }, body: { appendChild() {} } },
    window: {},
    __demoMode: false,
    state: { settings: serverMode === 'unreachable' ? projection('none', null)
      : projection(serverMode === 'expired' ? 'expired' : 'active', serverMode === 'expired' ? expiredAt : liveAt) },
    isMobileShellActive() { return false; },
    mobileShow(v) { nav.push('mobileShow:' + v); },
    renderEntryChoice() { nav.push('renderEntryChoice'); },
    entryShowLogin() { nav.push('entryShowLogin'); },
    async invoke(cmd) {
      if (cmd === 'get_settings') {
        if (serverMode === 'unreachable') throw new Error('settings_unavailable');
        return projection(serverMode === 'expired' ? 'expired' : 'active', serverMode === 'expired' ? expiredAt : liveAt);
      }
      throw new Error(`unexpected invoke ${cmd}`);
    },
  };
  vm.createContext(ctx);
  vm.runInContext(`${extractSessionDeps()}\n${extractTrialScript()}\nthis.__trial = { trialGateApply, trialPhase, trialEntitlementPhase };`, ctx);
  return ctx;
}

async function runtimeChecks() {
  let ctx = loadTrialContext({ serverMode: 'active' });
  assert.equal(await ctx.__trial.trialGateApply(), 'free', 'a live right opens the app');
  assert.deepEqual(ctx.nav, [], 'a live right never routes to sign-in');

  ctx = loadTrialContext({ serverMode: 'expired' });
  assert.equal(await ctx.__trial.trialGateApply(), 'blocked', 'an expired right blocks the app');
  assert.ok(ctx.nav.includes('renderEntryChoice') && ctx.nav.includes('entryShowLogin'),
    'an expired right routes to the sign-in screen (the server names the refusal there), got: ' + JSON.stringify(ctx.nav));

  ctx = loadTrialContext({ serverMode: 'unreachable' });
  assert.equal(await ctx.__trial.trialGateApply(), 'free', 'no account session and unreadable settings: nothing to gate, nothing blocks');
  assert.deepEqual(ctx.nav, []);

  ctx = loadTrialContext({ serverMode: 'active' });
  ctx.invoke = async (cmd) => { if (cmd === 'get_settings') throw new Error('settings_unavailable'); throw new Error(cmd); };
  assert.equal(await ctx.__trial.trialGateApply(), 'free', 'a failed refresh does not revoke a live right already in state');
  console.log('OK: runtime gate — live right opens, expired right goes to sign-in, nothing else ever blocks');
}
await runtimeChecks();
process.exit(fail);
