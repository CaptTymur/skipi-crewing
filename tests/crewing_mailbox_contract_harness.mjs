// Crewing mailbox contract harness.
//
// Protects Step 1: generic mailbox layer in Crewing without broker CRM drift.
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

section('static module boundary');
const mailBlock = (HTML.match(/\/\/ CREWING MAILBOX MODULE START([\s\S]*?)\/\/ CREWING MAILBOX MODULE END/) || [])[1] || '';
ok(mailBlock.length > 1000, 'mailbox module block exists');
for (const term of ['case', 'bazaar', 'circular', 'counterpart', 'signal']) {
  ok(!mailBlock.toLowerCase().includes(term), 'mailbox block has no broker-only token: ' + term);
}
ok(HTML.includes('id="mt-mail"'), 'desktop mail nav exists');
ok(HTML.includes("showView('mail')"), 'desktop mail route is wired');
ok(HTML.includes('get_mailbox_status'), 'mailbox status command is referenced');
ok(HTML.includes('fetch_mail_messages'), 'message list command is referenced');
ok(HTML.includes('send_mail'), 'send command is referenced');

section('credential boundary');
ok(API.includes('fn primary_api_base'), 'api has explicit primary/origin resolver');
ok(/if configured == RU_API[\s\S]*PRIMARY_API\.to_string\(\)/.test(API), 'RF URL is mapped back to primary for protected mailbox calls');
ok(/fn save_mailbox_config[\s\S]*api::put_json_primary/.test(RUST), 'save_mailbox_config uses primary/origin PUT');
ok(/fn test_mailbox[\s\S]*api::post_json_primary/.test(RUST), 'test_mailbox uses primary/origin POST');
ok(!/fn save_mailbox_config[\s\S]*api::put_json\(/.test(RUST), 'save_mailbox_config does not use failover PUT');
ok(!/fn test_mailbox[\s\S]*api::post_json\(/.test(RUST), 'test_mailbox does not use failover POST');

section('runtime smoke');
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
globalThis.__TAURI__ = { core: { invoke: async () => null, convertFileSrc: (p) => `file://${p}` } };
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'mailbox-harness', onLine: true },
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
  if (cmd === 'get_mailbox_status') return { configured: true, status: 'active', email_masked: 'o***@example.com', has_password: true };
  if (cmd === 'fetch_mail_messages') return {
    folder: args.folder || 'INBOX',
    total: 1,
    messages: [{ id: 'm1', from: 'captain@example.com', from_name: 'Captain One', subject: 'CV package', date_received: '2026-07-06T08:00:00Z', is_read: false }],
  };
  if (cmd === 'fetch_mail_message') return {
    id: args.messageId,
    folder: 'INBOX',
    from: 'captain@example.com',
    from_name: 'Captain One',
    to: 'ops@example.com',
    subject: 'CV package',
    body_text: 'Please review attached documents.',
    date_received: '2026-07-06T08:00:00Z',
    attachments: [{ filename: 'cv.pdf' }],
  };
  if (cmd === 'poll_mail') return { status: 'ok', fetched: 1, new_in_cache: 1 };
  if (cmd === 'test_mailbox') return { ok: true };
  if (cmd === 'save_mailbox_config') return { configured: true, status: 'active', email_masked: 'o***@example.com' };
  if (cmd === 'send_mail') {
    ok(args.payload && args.payload.to === 'crew@example.com', 'send payload carries recipient');
    ok(args.payload && args.payload.subject === 'Re: CV package', 'send payload carries subject');
    return { sent: true, status: 'ok' };
  }
  if (cmd === 'disconnect_mailbox') return { ok: true };
  return null;
}
globalThis.__TAURI__.core.invoke = invoke;

const script = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).reduce((a, b) => (a.length > b.length ? a : b), '');
const bootIndex = script.indexOf('// ------------- boot -------------');
const scriptNoBoot = bootIndex > 0 ? script.slice(0, bootIndex) : script;
const M = new Function(
  'invoke',
  'showToast',
  scriptNoBoot + '\nreturn { state, showView, refreshMail, openMailMessage, openMailCompose, sendMailFromCompose, openMailboxSettings, testMailboxSettings, saveMailboxSettings, disconnectMailbox };'
)(invoke, () => {});

M.state.settings = {
  server_url: 'https://api.skipi.app',
  bearer_token: 'TOKEN-DO-NOT-LEAK',
  crewing_id: 'mailbox-harness',
  token_scopes: ['applications:read'],
  interface: { theme: 'light', language: 'en' },
};

M.showView('mail');
await Promise.resolve();
await Promise.resolve();
await M.refreshMail(false);
ok(calls.some(([cmd]) => cmd === 'get_mailbox_status'), 'mail route checks mailbox status');
ok(calls.some(([cmd]) => cmd === 'fetch_mail_messages'), 'mail route loads message list');

await M.openMailMessage('m1');
ok(elFor('main').innerHTML.includes('CV package'), 'open message renders selected mail');

M.openMailboxSettings();
elFor('mail-address').value = 'ops@example.com';
elFor('mail-username').value = 'ops@example.com';
elFor('mail-password').value = 'app-password';
elFor('mail-imap-host').value = 'imap.example.com';
elFor('mail-imap-port').value = '993';
elFor('mail-smtp-host').value = 'smtp.example.com';
elFor('mail-smtp-port').value = '465';
await M.testMailboxSettings();
await M.saveMailboxSettings();
ok(calls.some(([cmd]) => cmd === 'test_mailbox'), 'connect smoke tests mailbox settings');
ok(calls.some(([cmd]) => cmd === 'save_mailbox_config'), 'connect smoke saves mailbox settings');

await M.openMailMessage('m1');
M.openMailCompose('m1');
elFor('mail-compose-to').value = 'crew@example.com';
elFor('mail-compose-subject').value = 'Re: CV package';
elFor('mail-compose-body').value = 'Thanks, received.';
await M.sendMailFromCompose('m1');
ok(calls.some(([cmd]) => cmd === 'send_mail'), 'compose smoke sends mail');

console.log('\ncrewing_mailbox_contract_harness: ' + (fail === 0 ? 'GREEN' : 'RED') + ' (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail === 0 ? 0 : 1);
