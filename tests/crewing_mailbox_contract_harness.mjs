// Crewing mailbox contract harness — after K2.1: ONE row, one operation.
//
// Step 1 gave Crewing a generic mailbox layer. OWNER (739) retired that module:
// candidates arrive on the server and are worked on the candidate card. This file
// is not deleted, and two things in it are not weakened either:
//
//   1. the credential boundary below — the mailbox commands that still exist in
//      the native layer must keep using the primary/origin API, never the
//      failover one (a password must not be offered to a mirror);
//   2. the one surviving user path — company settings show whether a mailbox is
//      still connected and can disconnect it. Without that row the credentials of
//      a connected mailbox would stay on the fleet server with no way back: the
//      web cabinet offers no disconnect (crewing_proxy shim), so retiring the
//      module WITHOUT this row would silently strand them.
//
// Everything that asserted the module EXISTS is inverted: the module must now be
// absent, and its absence is measured, not assumed.
//
//   node tests/crewing_mailbox_contract_harness.mjs

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

const htmlPath = path.join(ROOT, 'dist/index.html');
const rustPath = path.join(ROOT, 'src-tauri/src/lib.rs');
const apiPath = path.join(ROOT, 'src-tauri/src/api.rs');
const HTML = fs.readFileSync(htmlPath, 'utf8');
const RUST = fs.readFileSync(rustPath, 'utf8');
const API = fs.readFileSync(apiPath, 'utf8');

section('static module boundary — the module is gone (K2.1, OWNER (739))');
const mailBlock = (HTML.match(/\/\/ CREWING MAILBOX MODULE START([\s\S]*?)\/\/ CREWING MAILBOX MODULE END/) || [])[1] || '';
ok(mailBlock === '', 'the mailbox module block is absent from the shipped HTML');
ok(!HTML.includes('id="mt-mail"'), 'the desktop mail nav is absent');
ok(!HTML.includes("showView('mail')"), 'no route into a mail view is wired');
// Measured at the CALL SITES, not by the bare name: the demo fixtures
// (DEMO_READS) keep their keys by design — they are answers, not calls — so a
// name search would read them as a live mailbox and pass the wrong thing.
for (const gone of ['fetch_mail_messages', 'fetch_mail_message', 'send_mail', 'poll_mail', 'delete_mail_message', 'save_mailbox_config', 'test_mailbox']) {
  ok(!HTML.includes("invoke('" + gone + "'"), 'the screen no longer calls the mailbox command: ' + gone);
}
// The closed set is the nine commands of the native layer (lib.rs). A pattern
// like /mail/ would also swallow the mailing-request commands and open_mailto,
// which belong to other modules and are none of this harness's business.
const MAILBOX_COMMANDS = ['get_mailbox_status', 'save_mailbox_config', 'test_mailbox', 'disconnect_mailbox',
  'fetch_mail_messages', 'fetch_mail_message', 'poll_mail', 'send_mail', 'delete_mail_message'];
const stillCalled = MAILBOX_COMMANDS.filter((c) => HTML.includes("invoke('" + c + "'")).sort();
ok(stillCalled.join(',') === 'disconnect_mailbox,get_mailbox_status',
  'the ONLY mailbox calls left in the screen are the status read and the disconnect — got [' + stillCalled.join(',') + ']');
ok(!HTML.includes('id="mail-imap-host"') && !HTML.includes('id="mail-smtp-host"') && !HTML.includes('id="mail-password"'),
  'the mailbox connect form (IMAP/SMTP/password fields) left with the module');
ok(!HTML.includes('id="mail-compose-to"'), 'the in-app compose form left with the module');
// The native side is deliberately untouched by K2.1: the nine commands stay in
// lib.rs byte for byte, so a mailbox connected by an older build stays revocable.
for (const command of ['get_mailbox_status', 'save_mailbox_config', 'test_mailbox', 'disconnect_mailbox',
  'fetch_mail_messages', 'fetch_mail_message', 'poll_mail', 'send_mail', 'delete_mail_message']) {
  ok(new RegExp('fn ' + command + '\\(').test(RUST), 'the native command survives untouched: ' + command);
}

section('credential boundary');
ok(API.includes('fn primary_api_base'), 'api has explicit primary/origin resolver');
ok(/if configured == RU_API[\s\S]*PRIMARY_API\.to_string\(\)/.test(API), 'RF URL is mapped back to primary for protected mailbox calls');
ok(/fn save_mailbox_config[\s\S]*api::put_json_primary/.test(RUST), 'save_mailbox_config uses primary/origin PUT');
ok(/fn test_mailbox[\s\S]*api::post_json_primary/.test(RUST), 'test_mailbox uses primary/origin POST');
ok(!/fn save_mailbox_config[\s\S]*api::put_json\(/.test(RUST), 'save_mailbox_config does not use failover PUT');
ok(!/fn test_mailbox[\s\S]*api::post_json\(/.test(RUST), 'test_mailbox does not use failover POST');

section('the surviving settings row (R1)');
const legacyBlock = (HTML.match(/\/\/ CREWING LEGACY MAILBOX ROW \(K2\.1\) START([\s\S]*?)\/\/ CREWING LEGACY MAILBOX ROW \(K2\.1\) END/) || [])[1] || '';
ok(legacyBlock !== '', 'the legacy-mailbox block is bounded');
ok(legacyBlock.includes("invoke('get_mailbox_status')") && legacyBlock.includes("invoke('disconnect_mailbox')"),
  'the row is built on the two existing commands and nothing else');
ok(MAILBOX_COMMANDS.filter((c) => c !== 'get_mailbox_status' && c !== 'disconnect_mailbox')
  .every((c) => !legacyBlock.includes(c)), 'the row calls no other mailbox command');
ok(/inAppConfirm\(tr\('confirm\.mailbox_disconnect'\)/.test(legacyBlock), 'disconnecting is confirmed first');
ok((HTML.match(/data-qa="settings\.mailbox\.legacy"/g) || []).length === 2,
  'the row exists exactly twice: the desktop settings shell and the mobile one');
ok((HTML.match(/'settings\.mailbox_legacy':'[^']*'/g) || []).length === 2,
  'the row label is in both dictionaries');

section('runtime smoke: the row reads the status and can revoke');
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
  value: { userAgent: 'mailbox-harness', onLine: true, clipboard: { writeText: async () => {} } },
  configurable: true,
  writable: true,
});
globalThis.location = { hash: '#desktop', reload() {} };
globalThis.setTimeout = (fn) => { if (typeof fn === 'function') fn(); return 1; };
globalThis.setInterval = () => 1;
globalThis.clearTimeout = () => {};
globalThis.fetch = async () => ({ ok: false, status: 599, async json() { return {}; }, async text() { return ''; } });

const calls = [];
let mailbox = { configured: true, status: 'active', email_masked: 'o***@example.com', has_password: true };
async function invoke(cmd, args = {}) {
  calls.push([cmd, args]);
  if (cmd === 'get_settings') return {};
  if (cmd === 'get_mailbox_status') return mailbox;
  if (cmd === 'disconnect_mailbox') return { ok: true };
  return null;
}
globalThis.__TAURI__.core.invoke = invoke;
globalThis.__CONFIRM_ANSWER = true;

const script = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).reduce((a, b) => (a.length > b.length ? a : b), '');
const bootIndex = script.indexOf('// ------------- boot -------------');
const scriptNoBoot = bootIndex > 0 ? script.slice(0, bootIndex) : script;
// inAppConfirm builds a real overlay and waits for a click that a stub DOM can
// never deliver, so the harness replaces it the same way the crew-flow harness
// replaces showToast — inside the module scope, not around it.
const M = new Function(
  'invoke',
  'showToast',
  scriptNoBoot
    + '\ninAppConfirm = async function(){ return globalThis.__CONFIRM_ANSWER; };'
    + '\nreturn { state, openSettings, closeSettings, legacyMailboxState, legacyMailboxStatusText, legacyMailboxConfigured, openMailboxSettings, legacyMailboxDisconnect };',
)(invoke, () => {});

M.state.settings = {
  server_url: 'https://api.skipi.app',
  bearer_token: 'TOKEN-DO-NOT-LEAK',
  crewing_id: 'mailbox-harness',
  token_scopes: ['applications:read'],
  interface: { theme: 'light', language: 'ru' },
};
store.set('skipi_crewing_settings5', '1');
await M.openSettings('modules');
// The status read is a promise chain of its own (invoke -> assign -> paint); one
// or two microtask hops is not enough, and a check that measured too early would
// read "status not checked" and call it a defect.
for (let i = 0; i < 10; i += 1) await Promise.resolve();

const settingsHtml = elFor('modal-host').innerHTML;
ok(settingsHtml.includes('data-qa="settings.mailbox.legacy"'), 'the settings modules section renders the legacy-mailbox row');
ok(settingsHtml.includes('Личный ящик (устаревший)'), 'the row carries the RU label the owner will read');
ok(settingsHtml.includes('data-qa="settings.mailbox.legacy-disconnect"') && settingsHtml.includes('onclick="openMailboxSettings()"'),
  'the row carries exactly one control, wired to the surviving entry point');
ok(!settingsHtml.includes('Mailbox settings') && !settingsHtml.includes('id="mail-imap-host"'),
  'the settings section offers no connect form any more');
ok(calls.some(([cmd]) => cmd === 'get_mailbox_status'), 'rendering the row asks the server for the status');
ok(calls.filter(([cmd]) => cmd === 'get_mailbox_status').length === 1, 'the status is asked once, not once per render');
ok(/o\*\*\*@example\.com/.test(elFor('legacy-mailbox-status').textContent), 'the painted status carries the masked address');
ok(elFor('legacy-mailbox-disconnect').getAttribute('disabled') === null, 'with a connected mailbox the control is enabled');

globalThis.__CONFIRM_ANSWER = false;
await M.openMailboxSettings();
ok(!calls.some(([cmd]) => cmd === 'disconnect_mailbox'), 'a refused confirmation disconnects nothing');

globalThis.__CONFIRM_ANSWER = true;
await M.openMailboxSettings();
ok(calls.some(([cmd]) => cmd === 'disconnect_mailbox'), 'a confirmed disconnect calls disconnect_mailbox');
ok(M.legacyMailboxConfigured() === false, 'after the disconnect the row stops claiming a connected mailbox');
ok(elFor('legacy-mailbox-disconnect').getAttribute('disabled') === 'disabled', 'and the control goes back to disabled');
const before = calls.filter(([cmd]) => cmd === 'disconnect_mailbox').length;
await M.openMailboxSettings();
ok(calls.filter(([cmd]) => cmd === 'disconnect_mailbox').length === before,
  'with nothing connected there is nothing left to disconnect');

console.log('\ncrewing_mailbox_contract_harness: ' + (fail === 0 ? 'GREEN' : 'RED') + ' (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail === 0 ? 0 : 1);
