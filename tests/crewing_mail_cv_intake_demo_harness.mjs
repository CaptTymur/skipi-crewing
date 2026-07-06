// Crewing Mail Step 2 demo harness.
//
// Protects the demo-only CV-intake enrichment slice:
// incoming CV-like mail -> local fixture extraction -> local profile coverage
// -> badge/detail in Mail. No real IMAP, Claude key, server persistence, or
// Crew Flow surface is exercised in this step.
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
const mailBlock = (HTML.match(/\/\/ CREWING MAILBOX MODULE START([\s\S]*?)\/\/ CREWING MAILBOX MODULE END/) || [])[1] || '';

section('static boundaries');
ok(mailBlock.includes('classifyMailCvMessage'), 'local CV classifier exists in mailbox block');
ok(mailBlock.includes('mailCandidateEnrichmentForMessage'), 'candidate enrichment helper exists');
ok(mailBlock.includes('Profile coverage'), 'UI names coverage without hard verdict wording');
for (const term of ['compliant', 'approved', 'legal', 'verdict']) {
  ok(!mailBlock.toLowerCase().includes(term), 'mail CV block avoids banned wording: ' + term);
}
for (const term of ['case', 'bazaar', 'circular', 'counterpart', 'signal']) {
  ok(!mailBlock.toLowerCase().includes(term), 'mail CV block avoids broker-only token: ' + term);
}
ok(!mailBlock.includes("invoke('rank_compliance_candidate'"), 'demo slice does not call real rank endpoint');
ok(!mailBlock.includes("invoke('save_seafarer_from_bundle'"), 'demo slice does not persist parsed CV to server/local DB');
ok(!mailBlock.includes('ANTHROPIC') && !mailBlock.includes('CLAUDE_API_KEY'), 'demo slice contains no Cloud API key plumbing');

section('runtime demo flow');
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
  value: { userAgent: 'mail-cv-demo-harness', onLine: true },
  configurable: true,
  writable: true,
});
globalThis.location = { hash: '#desktop', reload() {} };
globalThis.setTimeout = (fn) => { if (typeof fn === 'function') fn(); return 1; };
globalThis.setInterval = () => 1;
globalThis.clearTimeout = () => {};
globalThis.fetch = async () => ({ ok: false, status: 599, async json() { return {}; }, async text() { return ''; } });

const cvEnrichment = {
  source: 'demo-fixture',
  is_cv: true,
  rank: 'Captain',
  nationality: 'Ukraine',
  available_from: '2026-07-08',
  trust: { label: 'demo-seeded', score: 0.74 },
  extracted_profile: {
    display_name: 'Oleksandr K.',
    rank: 'Captain',
    nationality: 'Ukraine',
    available_from: '2026-07-08',
    certs_summary: ['coc_master', 'gmdss_goc', 'bst', 'ecdis', 'sso'],
    service_record_summary: '84 months in rank; bulk carrier background',
  },
  rankings: [
    { profile_name: 'Captain · Client Alpha (Dry Bulk)', score_percent: 93, gaps: ['brm'] },
    { profile_name: 'Captain · Client Beta (Product Tanker)', score_percent: 81, gaps: ['brm', 'tanker_familiarization', 'advanced_tanker'] },
    { profile_name: 'Captain · Client Gamma (LNG / IGF)', score_percent: 72, gaps: ['brm', 'igf_code', 'hazmat'] },
  ],
};
const cvMessage = {
  id: 'cv-mail',
  from: 'captain@example.com',
  from_name: 'Oleksandr K.',
  to: 'ops@example.com',
  subject: 'CV for Captain vacancy',
  body_preview: 'Available from 2026-07-08. Certificates: CoC Master, GMDSS GOC, BST, ECDIS, SSO. Service record: 84 months in rank on bulk carriers.',
  body_text: 'Attached CV. Available from 2026-07-08. Certificates: CoC Master, GMDSS GOC, BST, ECDIS, SSO. Service record: 84 months in rank on bulk carriers.',
  date_received: '2026-07-06T08:00:00Z',
  attachments: [{ filename: 'oleksandr-k-cv.pdf' }],
  cv_enrichment: cvEnrichment,
};
const nonCvMessage = {
  id: 'non-cv-mail',
  from: 'chief@example.com',
  from_name: 'Ivan M.',
  to: 'ops@example.com',
  subject: 'Availability update',
  body_preview: 'I can join next month if you have a suitable opening.',
  body_text: 'I can join next month if you have a suitable opening.',
  date_received: '2026-07-06T08:10:00Z',
  attachments: [],
};
const calls = [];
async function invoke(cmd, args = {}) {
  calls.push([cmd, args]);
  if (cmd === 'get_settings') return {};
  if (cmd === 'get_mailbox_status') return { configured: true, status: 'active', email_masked: 'o***@example.com', has_password: true };
  if (cmd === 'fetch_mail_messages') return { folder: args.folder || 'INBOX', total: 2, messages: [cvMessage, nonCvMessage] };
  if (cmd === 'fetch_mail_message') return args.messageId === nonCvMessage.id ? nonCvMessage : cvMessage;
  if (cmd === 'poll_mail') return { status: 'ok', fetched: 2, new_in_cache: 0 };
  return null;
}
globalThis.__TAURI__.core.invoke = invoke;

const script = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).reduce((a, b) => (a.length > b.length ? a : b), '');
const bootIndex = script.indexOf('// ------------- boot -------------');
const scriptNoBoot = bootIndex > 0 ? script.slice(0, bootIndex) : script;
const M = new Function(
  'invoke',
  'showToast',
  scriptNoBoot + '\nreturn { state, showView, refreshMail, openMailMessage, classifyMailCvMessage, mailCandidateEnrichmentForMessage };'
)(invoke, () => {});

M.state.settings = {
  server_url: 'https://api.skipi.app',
  bearer_token: 'TOKEN-DO-NOT-LEAK',
  crewing_id: 'mail-cv-demo-harness',
  token_scopes: ['applications:read'],
  interface: { theme: 'light', language: 'en' },
};

ok(M.classifyMailCvMessage(cvMessage).is_cv === true, 'CV-like mail is classified as CV');
ok(M.classifyMailCvMessage(nonCvMessage).is_cv === false, 'non-CV mail is not classified as CV');
const enriched = M.mailCandidateEnrichmentForMessage(cvMessage);
ok(enriched && enriched.rank === 'Captain', 'extracted candidate rank is available');
ok(enriched && enriched.rankings && enriched.rankings[0].score_percent === 93, 'top profile coverage fixture is ranked');
ok(!M.mailCandidateEnrichmentForMessage(nonCvMessage), 'non-CV mail has no enrichment');

M.showView('mail');
await Promise.resolve();
await M.refreshMail(false);
const treeHtml = elFor('mailbox-tree').innerHTML;
ok(treeHtml.includes('Captain') && treeHtml.includes('93%') && treeHtml.includes('81%'), 'mail list shows CV enrichment badge');
ok(!treeHtml.match(/Availability update[\s\S]*93%/), 'non-CV row has no CV badge');

await M.openMailMessage('cv-mail');
const cvDetail = elFor('main').innerHTML;
ok(cvDetail.includes('CV intake enrichment'), 'CV detail shows enrichment panel');
ok(cvDetail.includes('Captain · Client Alpha') && cvDetail.includes('93%'), 'CV detail shows ranked profile coverage');
ok(cvDetail.includes('demo-seeded'), 'Trust placeholder is visibly marked demo-seeded');

await M.openMailMessage('non-cv-mail');
const nonCvDetail = elFor('main').innerHTML;
ok(!nonCvDetail.includes('CV intake enrichment'), 'non-CV detail has no enrichment panel');
ok(!calls.some(([cmd]) => cmd === 'rank_compliance_candidate'), 'runtime demo does not call real rank command');
ok(!calls.some(([cmd]) => cmd === 'save_seafarer_from_bundle'), 'runtime demo does not persist parsed CV');

console.log('\ncrewing_mail_cv_intake_demo_harness: ' + (fail === 0 ? 'GREEN' : 'RED') + ' (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail === 0 ? 0 : 1);
