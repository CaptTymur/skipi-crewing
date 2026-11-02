// Regression guard: the 2-week trial gate must be PRESENT and WIRED INTO BOOT.
//
// Catches the "reported done but not actually inserted" class: an agent claims the
// trial is implemented, but trialGateApply() is never called in the boot path, or the
// contacts/constants are missing — so users never see the banner/block. This is exactly
// the regression pattern the curator caught by hand (2026-07-10).
//
// Hardened (2026-07-11, grok C1): all checks run against a COMMENT-STRIPPED view of the
// HTML, so a commented-out wiring line (`// await trialGateApply()...`) no longer counts
// as wired. The WIRED check additionally requires the return value to be CONSUMED
// (`=== 'blocked'`), matching the real guard `if (await trialGateApply() === 'blocked') return;`
// — a bare/ignored dead call does not satisfy it.
// Residual (not covered): a call buried in `if(false){...}` dead code, and true runtime
// reachability — those need a headless boot smoke (Slice 4). Documented, not silently missed.
//
// Asserts against dist/index.html (the shipped monolithic frontend).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { crewingPublicSettingsFixture } from './fixtures/crewing_public_settings.mjs';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(here, '..', 'dist', 'index.html'), 'utf8');

// Strip comments so commented-out code cannot satisfy a check. Heuristic but safe for the
// non-minified inline JS in dist: remove /* ... */ blocks, then drop // line-comments that
// are NOT part of a scheme (spare http://, https:// by requiring the // not be preceded by ':').
function stripComments(src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return noBlock.split('\n').map((line) => {
    let inS = null; // track ' " ` to avoid cutting // inside strings
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

const checks = [
  ['trialPhase() defined', /function\s+trialPhase\s*\(/],
  ['trialGateApply() defined', /function\s+trialGateApply\s*\(/],
  // WIRED = the result is actually consumed to gate boot, not a bare/dead call.
  ['trialGateApply() WIRED into boot (result consumed: === \'blocked\')',
    /await\s+trialGateApply\s*\(\)\s*===\s*['"]blocked['"]/],
  ['blocked overlay present', /trial-block-overlay/],
  ['warning banner present', /trial-warning-banner/],
  ['contact email info@tymur.org', /info@tymur\.org/],
  ['contact phone +357 97 617 412', /\+?357\s*97\s*617\s*412|35797617412/],
  ['TRIAL_DAYS constant', /TRIAL_DAYS\s*=/],
  ['TRIAL_WARNING_FROM_DAY constant', /TRIAL_WARNING_FROM_DAY\s*=/],
  // No.880/(1495): активации по лицензионному токену больше нет — ни поля, ни
  // эндпоинта. Вместо неё требуется путь входа аккаунтом из оверлея блокировки.
  ['sign-in path out of the blocked overlay', /function trialGoSignIn\(/],
];

let fail = 0;
for (const [name, re] of checks) {
  if (re.test(html)) {
    console.log('OK:', name);
  } else {
    console.error('FAIL: trial gate missing/unwired —', name);
    fail = 1;
  }
}
if (fail) {
  console.error('\n>>> Trial gate is NOT fully wired. Users would not see the banner/block.');
  console.error('>>> This is the "reported done but not inserted" regression. See project_trial_gate.');
}

function makeLocalStorage(startedDaysAgo) {
  const store = new Map();
  store.set('skipi_trial_started_at', new Date(Date.now() - startedDaysAgo * 86400000).toISOString());
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
    appendChild(el) {
      el.parentNode = body;
      if (el.id) nodes[el.id] = el;
    },
    removeChild(el) {
      if (el && el.id) delete nodes[el.id];
      if (el) el.parentNode = null;
    },
  };
  return {
    nodes,
    body,
    createElement(tag) {
      return { tag, id: '', style: {}, innerHTML: '', textContent: '', disabled: false, parentNode: null, focus() {} };
    },
    getElementById(id) { return nodes[id] || null; },
    setNode(id, props = {}) {
      nodes[id] = Object.assign({ id, style: {}, value: '', textContent: '', disabled: false, parentNode: body, focus() {} }, props);
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

// No.880 пункт 4: фаза права читает ПРЕДИКАТ аккаунт-сессии, а обновление —
// ВАЛИДАТОР публичной проекции. В продукте это одна область видимости; стенд,
// который её не воспроизводит, ловил бы ReferenceError внутри try и читал его
// как «настройки нечитаемы» — то есть был бы зелёным при неработающем пути.
function slice(startMarker, endMarker) {
  const start = raw.indexOf(startMarker);
  const end = raw.indexOf(endMarker, start);
  assert.ok(start > 0 && end > start, `slice markers present: ${startMarker}`);
  return raw.slice(start, end);
}
function extractSessionDeps() {
  return slice('function crewingAccountSessionActive(s){', 'var __entryNext = null;')
    + '\n' + slice('function crewingIsPublicSettings(s) {', 'var convertFileSrc =');
}

// Проекция, какой её отдаёт Rust. Форма берётся из ОБЩЕЙ фикстуры дома, чтобы
// состав DTO жил в одном месте, а не расходился по стендам.
function projection(accountSession, entitlementExpiresAt) {
  return crewingPublicSettingsFixture({
    server_url: 'https://api.skipi.app', connection_context: 'ctx_trial_fixture',
    crewing_id: 'crew-1', has_bearer_token: true,
    account_session: accountSession, entitlement_source: 'approved_free',
    entitlement_expires_at: entitlementExpiresAt,
  });
}

function loadTrialContext({ serverMode, startedDaysAgo }) {
  const document = makeDocument();
  const localStorage = makeLocalStorage(startedDaysAgo);
  const ctx = {
    console,
    Date,
    setTimeout(fn) { if (typeof fn === 'function') fn(); return 1; },
    localStorage,
    document,
    window: {},
    __demoMode: false,
    // Начальное состояние соответствует режиму. Для 'unreachable' сессии нет
    // вовсе — именно это и есть случай «настройки не прочитались и о праве
    // ничего не известно». Устаревшая, но ДЕЙСТВИТЕЛЬНАЯ проекция сохраняет
    // свой ответ намеренно: право не отзывается тем, что обновление не удалось.
    state: { settings: serverMode === 'unreachable' ? projection('none', null)
      : projection(serverMode === 'expired' ? 'expired' : 'active',
        serverMode === 'expired' ? new Date(Date.now() - 86400000).toISOString()
                                 : new Date(Date.now() + 30 * 86400000).toISOString()) },
    bootCalls: 0,
    escapeHtml(v) { return String(v == null ? '' : v); },
    showToast() {},
    shouldUseMobileShell() { return false; },
    // No.880: имена приведены к продукту — гейт переименован в S1, а выход на
    // вход идёт через общее действие.
    isMobileShellActive() { return false; },
    mobileHasAccountSession() { return true; },
    renderEntryChoice() {},
    entryShowLogin() {},
    trialHideOverlay() {},
    mobileShow() {},
    async bootDesktopMain() { ctx.bootCalls += 1; },
    async fetch() { return { ok: true, async json() { return { active: true }; } }; },
    async invoke(cmd, args) {
      // No.880: отдельной команды проверки права больше нет — свежесть даёт
      // перечитывание публичной проекции, и Rust сравнивает срок с живым
      // временем сам. Режим стенда задаёт ровно то, что отдаёт проекция.
      if (cmd === 'get_settings') {
        if (serverMode === 'unreachable') throw new Error('settings_unavailable');
        return projection(serverMode === 'expired' ? 'expired' : 'active',
          serverMode === 'expired' ? new Date(Date.now() - 86400000).toISOString()
                                   : new Date(Date.now() + 30 * 86400000).toISOString());
      }
      if (cmd === 'save_settings') {
        ctx.state.settings = args.newSettings;
        return args.newSettings;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    },
  };
  // No.880: оверлей блокировки теперь берёт тексты из словаря (tr) и экранирует их,
  // поэтому в контекст добавлены те же два помощника, что есть в продукте.
  ctx.tr = (key) => String(key);
  ctx.escapeHtml = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  vm.createContext(ctx);
  vm.runInContext(`${extractSessionDeps()}\n${extractTrialScript()}\nthis.__trial = { trialGateApply, trialPhase, trialGoSignIn, trialShowBlockedOverlay, trialEntitlementPhase };`, ctx);
  return ctx;
}

async function runtimeChecks() {
  // No.880: предмет тот же — право перевешивает местный отсчёт в ОБЕ стороны;
  // сменился источник: поле аккаунт-сессии в проекции вместо активации токена.
  let ctx = loadTrialContext({ serverMode: 'active', startedDaysAgo: 20 });
  assert.equal(await ctx.__trial.trialGateApply(), 'free', 'a live entitlement overrides an expired local trial');
  assert.equal(ctx.document.getElementById('trial-block-overlay'), null, 'a live entitlement removes the blocked overlay');

  ctx = loadTrialContext({ serverMode: 'expired', startedDaysAgo: 0 });
  assert.equal(await ctx.__trial.trialGateApply(), 'blocked', 'an expired entitlement blocks despite a fresh local clock');
  assert.ok(ctx.document.getElementById('trial-block-overlay'), 'an expired entitlement shows the blocked overlay');

  // ТРЕТИЙ исход назван отдельно: нечитаемые настройки — это НЕ «право есть» и
  // не «право истекло»; решение отдаётся местному отсчёту, и это видно полем
  // reason, а не классом ошибки.
  ctx = loadTrialContext({ serverMode: 'unreachable', startedDaysAgo: 0 });
  assert.equal(await ctx.__trial.trialGateApply(), 'free', 'unreadable settings with no known session fall through to the local clock, not to blocked');
  ctx = loadTrialContext({ serverMode: 'unreachable', startedDaysAgo: 20 });
  assert.equal(await ctx.__trial.trialGateApply(), 'blocked', 'unreadable settings let an expired local trial block');
  // И ОБРАТНЫЙ ОБЪЕКТ, измеренный, а не предположенный: если обновление не
  // удалось, но в состоянии лежит ДЕЙСТВУЮЩЕЕ право, ответ остаётся 'free' —
  // неудача чтения права не отзывает.
  ctx = loadTrialContext({ serverMode: 'active', startedDaysAgo: 20 });
  ctx.invoke = async (cmd) => { if (cmd === 'get_settings') throw new Error('settings_unavailable'); throw new Error(cmd); };
  assert.equal(await ctx.__trial.trialGateApply(), 'free', 'a failed refresh does not revoke a live entitlement already in state');

  // No.880: «истёкшее право блокирует приложение» — покрытие сохранено целиком;
  // ушёл только способ разблокировки: не активация лицензионного токена, а вход
  // аккаунтом. Оверлей обязан увести на экран входа и не оставить токенных полей.
  ctx = loadTrialContext({ serverMode: 'expired', startedDaysAgo: 20 });
  await ctx.__trial.trialGateApply();
  const blocked = ctx.document.getElementById('trial-block-overlay');
  assert.ok(blocked, 'expired right still blocks the app');
  const blockedHtml = String(blocked.innerHTML || '');
  assert.ok(!/trial-license/.test(blockedHtml), 'the blocked overlay offers no license-token field');
  assert.ok(!/токен|token/i.test(blockedHtml), 'the blocked overlay asks for no token at all');
  assert.ok(/trialGoSignIn\(\)/.test(blockedHtml), 'the blocked overlay offers the sign-in path instead');
  console.log('OK: runtime trial gate — active overrides, expired blocks, unblocking is sign-in');
}

await runtimeChecks();
process.exit(fail);
