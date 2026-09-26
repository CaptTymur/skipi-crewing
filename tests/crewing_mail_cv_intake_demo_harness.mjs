// Crewing Mail Step 2 demo harness — after K2.1: the module is RETIRED.
//
// This file used to protect the demo-only CV-intake enrichment slice that lived
// inside the mailbox module. OWNER (739) retired that module: candidates arrive on
// the server and are worked on one screen, the candidate card.
//
// The file is NOT deleted and it does not pretend the old slice still works. It
// is deleted from nothing: `crewing_mail_cv_intake_demo` is still a harness
// command of the live K2 route in skipi-guard, so a missing file would make that
// route fail closed forever (node on an absent path exits 1). What it measures
// now is the retirement itself, plus the one thing the retirement had to keep
// alive: the Track 1 demo panel, which used to borrow its enrichment from the
// module and now reads the demo fixture directly.
//
//   node tests/crewing_mail_cv_intake_demo_harness.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

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

const HTML = fs.readFileSync(path.join(ROOT, 'dist/index.html'), 'utf8');

section('the mailbox module is retired (K2.1, OWNER (739))');
ok(!HTML.includes('CREWING MAILBOX MODULE START') && !HTML.includes('CREWING MAILBOX MODULE END'),
  'the mailbox module block is gone from the shipped HTML');
for (const gone of ['classifyMailCvMessage', 'mailCandidateEnrichmentForMessage', 'mailEnrichmentBadgeHtml',
  'mailEnrichmentDetailHtml', 'demoExtractCandidateProfile', 'demoRankCandidateProfile', 'mailCvCheckText',
  'renderMailboxTree', 'openMailCompose', 'sendMailFromCompose', 'openMailboxSettings()']) {
  ok(!HTML.includes(gone + '('), 'the retired demo/module function is gone: ' + gone);
}
ok(!HTML.includes('id="mt-mail"') && !HTML.includes("showView('mail')"),
  'no desktop tab and no route into a mail view');
ok(!HTML.includes('CV intake enrichment'),
  'the mail-only enrichment panel left with the module');
// The one surviving piece of the retired module, and the reason it survived: a
// mailbox that is still connected keeps its credentials on the fleet server.
ok(HTML.includes('CREWING LEGACY MAILBOX ROW (K2.1) START') && HTML.includes("invoke('disconnect_mailbox')"),
  'exactly one operation survives: disconnecting a mailbox that is still connected');

section('the Track 1 demo panel survived the removal');
const track1Block = (HTML.match(/\/\/ TRACK 1 CANDIDATE INTAKE DEMO START([\s\S]*?)\/\/ TRACK 1 CANDIDATE INTAKE DEMO END/) || [])[1] || '';
ok(track1Block.length > 500, 'the Track 1 demo block is bounded and present');
ok(!track1Block.includes('mailCandidateEnrichmentForMessage'),
  'Track 1 no longer calls the retired enrichment helper');
ok(/cv_enrichment && msg\.cv_enrichment\.is_cv/.test(track1Block),
  'Track 1 reads the enrichment from the demo fixture instead');
ok(track1Block.includes('__demoMode'), 'Track 1 stays gated by demo mode');
// The fixture is the source the panel now depends on; if it lost cv_enrichment the
// panel would render an empty profile and nothing would say so.
const fixture = (HTML.match(/fetch_mail_messages: function\(a\)\{ return \{[\s\S]*?\}; \},/) || [''])[0];
ok(/cv_enrichment:\{[\s\S]*?is_cv:true/.test(fixture), 'the demo fixture still carries cv_enrichment with is_cv');
ok(/score_percent:93/.test(fixture) && /Captain/.test(fixture), 'the demo fixture still carries the ranked coverage numbers');

section('the shipped script still loads, without the module');
function makeElement(id) {
  return {
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    style: {},
    children: [],
    className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute(name, value) { this[name] = String(value); },
    getAttribute(name) { return this[name] || null; },
    removeAttribute(name) { delete this[name]; },
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
globalThis.__TAURI__ = { core: { invoke: async () => null, convertFileSrc: (p) => `file://${p}` } };
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'mail-cv-retired-harness', onLine: true, clipboard: { writeText: async () => {} } },
  configurable: true,
  writable: true,
});
globalThis.location = { hash: '#desktop', reload() {} };
globalThis.setTimeout = (fn) => { if (typeof fn === 'function') fn(); return 1; };
globalThis.setInterval = () => 1;
globalThis.clearTimeout = () => {};
globalThis.fetch = async () => ({ ok: false, status: 599, async json() { return {}; }, async text() { return ''; } });

const calls = [];
async function invoke(cmd, args = {}) {
  calls.push([cmd, args]);
  if (cmd === 'get_settings') return {};
  return null;
}
globalThis.__TAURI__.core.invoke = invoke;

const script = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).reduce((a, b) => (a.length > b.length ? a : b), '');
const bootIndex = script.indexOf('// ------------- boot -------------');
const scriptNoBoot = bootIndex > 0 ? script.slice(0, bootIndex) : script;
let M = null;
let loadError = null;
try {
  M = new Function(
    'invoke',
    'showToast',
    scriptNoBoot + '\nreturn { state, showView, track1CandidateIntakePanelHtml, defined: (name) => typeof globalThis[name] !== "undefined" || (() => { try { return eval("typeof " + name) !== "undefined"; } catch (e) { return false; } })() };',
  )(invoke, () => {});
} catch (e) {
  loadError = e;
}
ok(!!M && !loadError, 'the desktop inline script still parses and runs without the mailbox module' + (loadError ? ' — ' + loadError.message : ''));

if (M) {
  // The absence probe is calibrated on a function that certainly EXISTS: an
  // `eval("typeof x")` that always answered "undefined" would turn this whole
  // section into a row of false greens.
  ok(M.defined('showView') === true, 'the absence probe is calibrated: a surviving function reads as defined');
  ok(M.defined('legacyMailboxDisconnect') === true, 'the absence probe sees the surviving disconnect path as defined');
  for (const name of ['classifyMailCvMessage', 'mailCandidateEnrichmentForMessage', 'refreshMail', 'openMailMessage', 'openMailCompose']) {
    ok(M.defined(name) === false, 'the retired function is not defined at runtime either: ' + name);
  }
  // Outside demo mode the Track 1 panel renders nothing — the same contract as
  // before the removal, measured on the surviving code path.
  ok(M.track1CandidateIntakePanelHtml({ id: 'cf-demo-mail-cv-oleksandr' }) === '',
    'Track 1 panel stays default-off outside demo mode');
  ok(!calls.some(([cmd]) => ['fetch_mail_messages', 'fetch_mail_message', 'poll_mail', 'send_mail', 'delete_mail_message'].includes(cmd)),
    'loading the script starts no mailbox traffic');
}

console.log('\ncrewing_mail_cv_intake_demo_harness: ' + (fail === 0 ? 'GREEN' : 'RED') + ' (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail === 0 ? 0 : 1);
