// Crew Flow demo slice harness.
//
// Protects the fixture-only operator feed:
// incoming signals -> existing rank_compliance_candidate -> feed cards
// -> Add/Ignore read-state. No real Claude, IMAP, server changes, or Crew Flow
// backend queue is exercised in this demo slice.
//
//   node tests/crewing_crew_flow_demo_harness.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'dist/index.html'), 'utf8');

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

const crewBlock = (HTML.match(/\/\/ CREW FLOW MODULE START([\s\S]*?)\/\/ CREW FLOW MODULE END/) || [])[1] || '';
const track1Block = (HTML.match(/\/\/ TRACK 1 CANDIDATE INTAKE DEMO START([\s\S]*?)\/\/ TRACK 1 CANDIDATE INTAKE DEMO END/) || [])[1] || '';

section('static boundaries');
ok(crewBlock.includes('crewFlowSignalFixtures'), 'Crew Flow fixture feed exists');
ok(crewBlock.includes("invoke('rank_compliance_candidate'"), 'Crew Flow reuses rank_compliance_candidate');
ok(crewBlock.includes('saveRankedCandidate('), 'Crew Flow reuses existing save path');
ok(HTML.includes('skipi_crewing_crew_flow_read_state_v2'), 'Crew Flow read-state key is present');
ok(!HTML.match(/presence-manifest\.json/), 'Crew Flow code does not reference presence manifest');
for (const term of ['compliant', 'approved', 'legal', 'verdict']) {
  ok(!crewBlock.toLowerCase().includes(term), 'Crew Flow block avoids banned wording: ' + term);
}
ok(!crewBlock.includes('ANTHROPIC') && !crewBlock.includes('CLAUDE_API_KEY'), 'Crew Flow slice contains no Cloud API key plumbing');
ok(track1Block.includes('track1CandidateIntakeEnabled') && track1Block.includes('__demoMode'), 'Track 1 panel is gated by demo mode');
ok(track1Block.includes('Source evidence') && track1Block.includes('Email CV') && track1Block.includes('Mail'), 'Track 1 panel renders source evidence');
ok(track1Block.includes('Structured profile / vault draft'), 'Track 1 panel renders extracted profile/vault bridge');
ok(track1Block.includes('Local Compliance Profiles'), 'Track 1 match target is local Compliance Profiles');
ok(track1Block.includes('AI extraction is decision support only'), 'Track 1 states AI is decision support');
ok(track1Block.includes('Source of truth: documents, structured fields, audit trail, and human action'), 'Track 1 states source-of-truth boundary');
ok(track1Block.includes('rank_compliance_candidate'), 'Track 1 summary names existing rank_compliance_candidate source');
ok(!track1Block.includes('save_seafarer_from_bundle'), 'Track 1 slice does not add new save wiring');
ok(!track1Block.includes('fetch(') && !track1Block.includes('ANTHROPIC') && !track1Block.includes('CLAUDE_API_KEY') && !track1Block.includes('IMAP'), 'Track 1 slice has no network/Cloud/IMAP plumbing');
for (const term of ['compliant', 'approved', 'legal', 'verdict']) {
  ok(!track1Block.toLowerCase().includes(term), 'Track 1 block avoids banned wording: ' + term);
}

section('runtime demo feed');
function makeElement(id) {
  let outer = '';
  return {
    id,
    style: {},
    dataset: {},
    children: [],
    className: '',
    classList: {
      toggle() {},
      add() {},
      remove() {},
      contains() { return false; },
    },
    appendChild(child) { this.children.push(child); return child; },
    remove() {},
    removeChild(child) { this.children = this.children.filter((x) => x !== child); },
    querySelector() { return makeElement(id + '-query'); },
    querySelectorAll() { return []; },
    addEventListener() {},
    setAttribute(name, value) { this[name] = String(value); },
    getAttribute(name) { return this[name] || ''; },
    focus() {},
    textContent: '',
    innerHTML: '',
    value: '',
    checked: false,
    get outerHTML() { return outer || this.innerHTML; },
    set outerHTML(v) { outer = String(v); this.innerHTML = String(v); },
  };
}

const elements = new Map();
function elFor(id) {
  if (!elements.has(id)) elements.set(id, makeElement(id));
  return elements.get(id);
}

const store = new Map();
store.set('skipi_crewing_demo', '1');
const toasts = [];
const calls = [];
const fetchCalls = [];

globalThis.localStorage = {
  getItem(k) { return store.has(k) ? store.get(k) : null; },
  setItem(k, v) { store.set(k, String(v)); },
  removeItem(k) { store.delete(k); },
  clear() { store.clear(); },
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
  value: { userAgent: 'crew-flow-demo-harness', onLine: false },
  configurable: true,
  writable: true,
});
globalThis.location = { hash: '#desktop', reload() {} };
globalThis.setTimeout = (fn) => { if (typeof fn === 'function') fn(); return 1; };
globalThis.setInterval = () => 1;
globalThis.clearTimeout = () => {};
globalThis.fetch = async (...args) => {
  fetchCalls.push(args);
  throw new Error('network disabled in crew-flow demo harness');
};

async function invoke(cmd, args = {}) {
  calls.push([cmd, args]);
  if (cmd === 'get_settings') return {};
  if (cmd === 'rank_compliance_candidate') {
    return {
      candidate_rank: 'Captain',
      rank_source: 'summary',
      items: [
        {
          profile_id: 'alpha',
          profile_name: 'Captain · Client Alpha (Dry Bulk)',
          profile_rank: 'Captain',
          score_percent: 93,
          required_total: 14,
          blockers: 1,
          covered: ['passport', 'sid'],
          missing: ['brm'],
          expired: [],
          uncertain: [],
          no_file: [],
          gaps: ['brm'],
        },
        {
          profile_id: 'beta',
          profile_name: 'Captain · Client Beta (Product Tanker)',
          profile_rank: 'Captain',
          score_percent: 81,
          required_total: 16,
          blockers: 3,
          covered: ['passport', 'sid'],
          missing: ['brm', 'tanker_familiarization', 'advanced_tanker'],
          expired: [],
          uncertain: [],
          no_file: [],
          gaps: ['brm', 'tanker_familiarization', 'advanced_tanker'],
        },
        {
          profile_id: 'gamma',
          profile_name: 'Captain · Client Gamma (LNG / IGF)',
          profile_rank: 'Captain',
          score_percent: 72,
          required_total: 18,
          blockers: 5,
          covered: ['passport', 'sid'],
          missing: ['brm', 'igf_code', 'hazmat'],
          expired: [],
          uncertain: [],
          no_file: [],
          gaps: ['brm', 'igf_code', 'hazmat'],
        },
      ],
    };
  }
  if (cmd === 'fetch_attachments_for_application') {
    if (args.applicationId === 'demo-a1') {
      return [{
        id: 'demo-a1-documents-bundle',
        application_id: 'demo-a1',
        from_user_id: 'demo-sf1',
        to_user_id: 'crew-flow-demo-harness',
        original_filename: 'oleksandr-k-documents-bundle.zip',
        mime_type: 'application/zip',
        size_bytes: 1843200,
        sent_at: '2026-06-19T14:24:00Z',
      }];
    }
    return [];
  }
  if (cmd === 'fetch_messages') {
    if (args.applicationId === 'demo-a1') {
      return [{
        id: 'demo-msg-a1-docs',
        application_id: 'demo-a1',
        from_user_id: 'demo-sf1',
        sent_at: '2026-06-19T14:24:00Z',
        plaintext: '[skipi:doc_bundle] {"id":"demo-a1-documents-bundle","filename":"oleksandr-k-documents-bundle.zip","size":1843200}',
      }];
    }
    return [];
  }
  if (cmd === 'download_encrypted_attachment') return '/tmp/skipi-demo-a1-documents-bundle.zip';
  if (cmd === 'extract_documents_bundle') {
    return {
      extracted_to: '/tmp/skipi-demo-a1-documents',
      manifest: {
        exported_by: { name: 'Oleksandr K.', rank: 'Captain', messaging_user_id: 'demo-sf1' },
        skipi_identity: { messaging_user_id: 'demo-sf1' },
        documents: [{ title: 'Passport', template_id: 'passport', has_file: true, file_path: 'Identity/passport.pdf' }],
      },
    };
  }
  if (cmd === 'save_seafarer_from_bundle') return { seafarer: { id: 'demo-sf1', display_name: 'Oleksandr K.' }, saved_documents: 1 };
  if (cmd === 'list_saved_seafarers') return [];
  if (cmd === 'register_my_pubkey') return null;
  return null;
}
globalThis.__TAURI__.core.invoke = invoke;
globalThis.__CREW_FLOW_TOASTS = toasts;

const script = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .reduce((a, b) => (a.length > b.length ? a : b), '');
const bootIndex = script.indexOf('// ------------- boot -------------');
const scriptNoBoot = bootIndex > 0 ? script.slice(0, bootIndex) : script;

let M = null;
function loadInlineModuleForCurrentStore() {
  return new Function(
    scriptNoBoot
      + '\nif (typeof serverUrlArg === "undefined") serverUrlArg = function(){ return "https://api.skipi.app"; };'
      + '\nshowToast = function(msg, kind){ globalThis.__CREW_FLOW_TOASTS.push({ msg: String(msg), kind: kind || "" }); };'
      + '\nreturn { state, showView, renderCrewFlowView, refreshCrewFlowRankings, crewFlowState, crewFlowReadInfo, crewFlowIsRead, crewFlowFindSignal, crewFlowAddSignal, crewFlowIgnoreSignal, saveCurrentBundleSeafarer, track1CandidateIntakePanelHtml, invoke };'
  )();
}

try {
  M = loadInlineModuleForCurrentStore();
} catch (e) {
  console.error('runtime load failed:', e);
}

ok(!!M, 'real desktop inline script loads without boot IIFE');

if (M) {
  M.state.settings = {
    server_url: 'https://api.skipi.app',
    bearer_token: 'TOKEN-DO-NOT-LEAK',
    crewing_id: 'crew-flow-demo-harness',
    token_scopes: ['applications:read'],
    interface: { theme: 'light', language: 'en' },
  };
  M.state.myIdentity = { user_id: 'crew-flow-demo-harness' };
  M.state.applications = [];
  M.state.applicationsByVacancy = {
    'demo-v1': [{
      id: 'demo-a1',
      vacancy_id: 'demo-v1',
      received_at: '2026-06-19T14:20:00Z',
      contact_for_reply: 'master.candidate@example.com',
      message: 'Documents ready.',
      status: 'new',
      seafarer_user_id: 'demo-sf1',
      summary: {
        name: 'Oleksandr K.',
        rank: 'Captain',
        nationality: 'Ukraine',
        available_from: '2026-07-08',
      },
    }],
  };
  M.state.attachmentsByApp = {};
  M.state.messagesByApp = {};
  M.state.seafarers = [];
  M.state.seafarerDocsById = {};

  M.showView('crew_flow');
  await M.refreshCrewFlowRankings();
  const mainHtml = elFor('main').innerHTML;
  const treeHtml = elFor('crew-flow-tree').innerHTML;
  const initialSignals = M.crewFlowState();
  const initialRead = initialSignals.filter((s) => M.crewFlowIsRead(s.id)).map((s) => s.id);
  const initialUnread = initialSignals.filter((s) => !M.crewFlowIsRead(s.id)).map((s) => s.id);

  ok(mainHtml.includes('data-qa="crew-flow-view"'), 'Crew Flow view renders');
  ok(treeHtml.includes('Email CV') && treeHtml.includes('Vacancy reply'), 'feed renders mixed signal types');
  ok(treeHtml.includes('Mail') && treeHtml.includes('Application'), 'feed renders channels');
  ok(treeHtml.includes('Trust 74%') || mainHtml.includes('Trust 74%'), 'Trust Score stub is visible');
  ok(mainHtml.includes('Profile fit') && mainHtml.includes('93%') && mainHtml.includes('81%'), 'coverage rankings render in detail');
  ok(mainHtml.includes('data-qa="track1-candidate-intake-panel"'), 'Track 1 candidate intake panel renders for golden signal');
  ok(mainHtml.includes('Email CV') && mainHtml.includes('oleksandr-k-cv.pdf'), 'Track 1 source evidence shows mail attachment');
  ok(mainHtml.includes('Structured profile / vault draft') && mainHtml.includes('Certificates:') && mainHtml.includes('Sea service:'), 'Track 1 extracted profile bridge renders');
  ok(mainHtml.includes('AI extraction is decision support only'), 'Track 1 AI boundary renders');
  ok(mainHtml.includes('Source of truth: documents, structured fields, audit trail, and human action'), 'Track 1 source-of-truth note renders');
  ok(mainHtml.includes('Local Compliance Profiles') && mainHtml.includes('Captain · Client Alpha') && mainHtml.includes('93%') && mainHtml.includes('72%'), 'Track 1 local profile match summary renders 93/81/72');
  ok(mainHtml.includes('covered') && mainHtml.includes('missing') && mainHtml.includes('expired') && mainHtml.includes('uncertain') && mainHtml.includes('no_file') && mainHtml.includes('gaps:'), 'Track 1 match summary renders coverage buckets');
  ok(mainHtml.includes('Request missing documents') && mainHtml.includes('Match to vacancy/client profile') && mainHtml.includes('Keep for later'), 'Track 1 shows manager action places without new handlers');
  ok(!mainHtml.includes('Generic profile') && !mainHtml.includes('career-track'), 'Track 1 does not mix generic profile labels into local match');
  ok(initialRead.length === 2 && initialUnread.length === 2, 'fixture start state is mixed: 2 read, 2 unread');
  ok(initialUnread.includes('cf-demo-mail-cv-oleksandr') && initialUnread.includes('cf-demo-mail-followup-ivan'), 'golden and documents-needed signals start unread');
  ok(M.crewFlowFindSignal('cf-demo-mail-cv-oleksandr').coverage_source === 'rank_compliance_candidate', 'coverage source is rank_compliance_candidate');

  await M.crewFlowIgnoreSignal('cf-demo-vacancy-reply-marko');
  const persistedIgnore = JSON.parse(store.get('skipi_crewing_crew_flow_read_state_v2') || '{}');
  ok(persistedIgnore['cf-demo-vacancy-reply-marko'] && persistedIgnore['cf-demo-vacancy-reply-marko'].action === 'ignored', 'Ignore persists read-state');

  await M.crewFlowAddSignal('cf-demo-mail-cv-oleksandr');
  const persistedAdd = JSON.parse(store.get('skipi_crewing_crew_flow_read_state_v2') || '{}');
  ok(persistedAdd['cf-demo-mail-cv-oleksandr'] && persistedAdd['cf-demo-mail-cv-oleksandr'].action === 'added', 'golden Add marks signal read');
  ok(persistedAdd['cf-demo-mail-cv-oleksandr'] && persistedAdd['cf-demo-mail-cv-oleksandr'].saved_to_db === true, 'golden Add persists saved_to_db state');
  ok(M.state.seafarers.some((s) => s.id === 'demo-sf1' && s.display_name === 'Oleksandr K.'), 'golden Add completes into Seafarers DB');
  const savedDocs = await M.invoke('list_saved_seafarer_documents', { seafarerId: 'demo-sf1' });
  ok(Array.isArray(savedDocs) && savedDocs.length > 0, 'golden Add saved documents via existing bundle flow');
  ok(toasts.some((t) => /Saved to Seafarers DB/i.test(t.msg)), 'golden Add reports Save-to-DB success');

  await M.crewFlowAddSignal('cf-demo-mail-followup-ivan');
  const persistedNeedsDocs = JSON.parse(store.get('skipi_crewing_crew_flow_read_state_v2') || '{}');
  ok(persistedNeedsDocs['cf-demo-mail-followup-ivan'] && persistedNeedsDocs['cf-demo-mail-followup-ivan'].action === 'needs_documents', 'non-golden Add persists needs-documents state');
  ok(toasts.some((t) => /document bundle/i.test(t.msg)), 'non-golden Add keeps honest document-bundle guard');

  const combined = (elFor('main').innerHTML + '\n' + elFor('crew-flow-tree').innerHTML).toLowerCase();
  for (const term of ['compliant', 'approved', 'legal', 'verdict']) {
    ok(!combined.includes(term), 'rendered Crew Flow avoids banned wording: ' + term);
  }
  ok(!calls.some(([cmd]) => String(cmd).toLowerCase().includes('mail') && cmd !== 'fetch_mail_messages'), 'Crew Flow does not start real mailbox operations');
  ok(fetchCalls.length === 0, 'Crew Flow / Track 1 render performs no network fetches');

  store.delete('skipi_crewing_demo');
  elements.clear();
  let MNoDemo = null;
  try {
    MNoDemo = loadInlineModuleForCurrentStore();
  } catch (e) {
    console.error('default-off runtime load failed:', e);
  }
  ok(!!MNoDemo, 'default-off inline script loads');
  if (MNoDemo) {
    MNoDemo.state.settings = M.state.settings;
    MNoDemo.state.myIdentity = M.state.myIdentity;
    MNoDemo.state.applicationsByVacancy = M.state.applicationsByVacancy;
    MNoDemo.showView('crew_flow');
    await MNoDemo.refreshCrewFlowRankings();
    ok(!elFor('main').innerHTML.includes('data-qa="track1-candidate-intake-panel"'), 'Track 1 panel is default-off outside demo mode');
  }
  store.set('skipi_crewing_demo', '1');
}

console.log('\ncrewing_crew_flow_demo_harness: ' + (fail === 0 ? 'GREEN' : 'RED') + ' (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail === 0 ? 0 : 1);
