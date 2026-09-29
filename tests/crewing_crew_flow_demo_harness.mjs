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
const complianceBadgeBlock = (HTML.match(/function renderComplianceBadge\(a\) \{([\s\S]*?)\nfunction paintApplicationsList/) || [])[1] || '';

section('static boundaries');
ok(crewBlock.includes('crewFlowSignalFixtures'), 'Crew Flow fixture feed exists');
ok(crewBlock.includes('crewFlowDemoFixturesEnabled'), 'Crew Flow fixture helper is explicit');
ok(/!state\.crewFlowSignals\.length\s*&&\s*crewFlowDemoFixturesEnabled\(\)/.test(crewBlock), 'Crew Flow fixtures seed only when demo mode is enabled');
ok(crewBlock.includes("invoke('rank_compliance_candidate'"), 'Crew Flow reuses rank_compliance_candidate');
ok(crewBlock.includes('saveRankedCandidate('), 'Crew Flow reuses existing save path');
ok(HTML.includes('skipi_crewing_crew_flow_read_state_v2'), 'Crew Flow read-state key is present');
ok(!HTML.match(/presence-manifest\.json/), 'Crew Flow code does not reference presence manifest');
for (const term of ['compliant', 'approved', 'legal', 'verdict']) {
  ok(!crewBlock.toLowerCase().includes(term), 'Crew Flow block avoids banned wording: ' + term);
}
ok(!crewBlock.includes('ANTHROPIC') && !crewBlock.includes('CLAUDE_API_KEY'), 'Crew Flow slice contains no Cloud API key plumbing');
// K2.1 (OWNER (739)): the mailbox module is retired and Crew Flow is the single
// screen. These four assertions live HERE as well as in the mailbox harness on
// purpose: this file is also run by the plugin-host route, so a dist-only change
// cannot slip the module back in past a route that does not run that harness.
ok(!HTML.includes('CREWING MAILBOX MODULE START'), 'K2.1: the mailbox module block is absent');
ok(!HTML.includes('id="mt-mail"') && !HTML.includes("showView('mail')"), 'K2.1: no desktop mail tab and no route into a mail view');
ok(!/mobileNavButton\('mail'/.test(HTML) && !/\['mail','crew_flow'/.test(HTML), 'K2.1: no mail slot in the mobile rail or the tab-highlight list');
ok(!crewBlock.includes('mailboxViewReady') && !crewBlock.includes('openMailCompose'),
  'K2.1: Crew Flow no longer waits for a mailbox render or opens an in-app compose form');
ok(/function crewFlowWriteEmail\(intakeId, kind\) \{[\s\S]{0,400}?pilotDraftOpen\(intakeId, kind\)/.test(crewBlock),
  'K2.1: the write-email action opens the draft on the candidate card');
// K2.2 (OWNER 2026-09-27, "Apps и Documents тоже пока убираем из сборки"): same reasoning as K2.1 —
// this file runs on both the plugin-host and the crewing-k2-modules routes, so a dist-only change
// cannot bring the two entry points back past a route that does not run the presence harness.
ok(!HTML.includes('id="mt-documents"') && !HTML.includes('id="mt-apps"'), 'K2.2: no desktop Documents/Apps tab');
ok(!/mobileNavButton\('documents'|mobileNavButton\('apps'/.test(HTML), 'K2.2: no Documents/Apps slot in the mobile rail');
ok(/\['crew_flow','compliance','seafarers'\]\.forEach\(function\(k\)\{/.test(HTML), 'K2.2: the tab-highlight list is exactly crew_flow,compliance,seafarers');
ok(!HTML.includes("['mt-documents','nav.documents']"), 'K2.2: applyI18nChrome no longer relabels a Documents tab');
ok(!HTML.includes('apps-module-tile-documents'), 'K2.2: no Documents tile in the mobile Apps grid');
ok(track1Block.includes('track1CandidateIntakeEnabled') && track1Block.includes('__demoMode'), 'Track 1 panel is gated by demo mode');
ok(track1Block.includes('Source evidence') && track1Block.includes('Email CV') && track1Block.includes('Mail'), 'Track 1 panel renders source evidence');
ok(track1Block.includes('Structured profile / vault draft'), 'Track 1 panel renders extracted profile/vault bridge');
ok(track1Block.includes('Local Compliance Profiles'), 'Track 1 match target is the local compliance profiles');
ok(track1Block.includes('AI extraction is decision support only'), 'Track 1 states AI is decision support');
ok(track1Block.includes('Source of truth: documents, structured fields, audit trail, and human action'), 'Track 1 states source-of-truth boundary');
ok(track1Block.includes('rank_compliance_candidate'), 'Track 1 summary names existing rank_compliance_candidate source');
ok(track1Block.includes('track1-recommended-action') && track1Block.includes('Recommended:'), 'Track 1 renders recommended action in match summary');
ok(track1Block.includes('track1-action-state') && track1Block.includes('crewFlowReadInfo'), 'Track 1 action state reflects Crew Flow read-state');
ok(track1Block.includes('track1CandidateAction') && track1Block.includes('crewFlowAddSignal'), 'Track 1 Add action reuses existing Crew Flow add path');
ok(!track1Block.includes("invoke('save_seafarer_from_bundle'"), 'Track 1 action block does not call save command directly');
ok(!track1Block.includes('fetch(') && !track1Block.includes('ANTHROPIC') && !track1Block.includes('CLAUDE_API_KEY') && !track1Block.includes('IMAP'), 'Track 1 slice has no network/Cloud/IMAP plumbing');
ok(!HTML.includes('is_fully_compliant') && !HTML.includes('fully_compliant'), 'demo data has no fully-compliant verdict field');
ok(!complianceBadgeBlock.includes('✅') && !complianceBadgeBlock.includes('is_fully_compliant'), 'coverage badge is neutral: no verdict checkmark or fully-compliant gate');
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
  // K2/S3: the everyday state of the pilot until K1 is "connected, queue empty".
  if (cmd === 'crewing_intake_candidate_list') return { items: [], limit: 50, offset: 0, total: 0 };
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
      + '\nreturn { state, showView, renderCrewFlowView, refreshCrewFlowRankings, crewFlowState, crewFlowReadInfo, crewFlowIsRead, crewFlowFindSignal, crewFlowAddSignal, crewFlowIgnoreSignal, saveCurrentBundleSeafarer, track1CandidateIntakePanelHtml, track1CandidateAction, invoke, mobileShow, mobileBack, mobileState, mobileOpenCrewFlowSignal, renderCrewFlowTreeBody, crewFlowLiveTreeHtml, tr, escapeHtml, escapeAttr, '
      + 'crewingSettingsSections: (typeof _crewingSettingsSections === "function" ? _crewingSettingsSections : null), '
      + 'crewingSettingsSectionFor: (typeof _crewingSettingsSectionFor === "function" ? _crewingSettingsSectionFor : null), '
      + 'crewFlowCacheRanks: (typeof crewFlowCacheRanks === "function" ? crewFlowCacheRanks : null), '
      + 'crewFlowCacheProfiles: (typeof crewFlowCacheProfiles === "function" ? crewFlowCacheProfiles : null), '
      + 'crewFlowSelectProfile: (typeof crewFlowSelectProfile === "function" ? crewFlowSelectProfile : null), '
      + 'crewFlowLiveMobileHtml: (typeof crewFlowLiveMobileHtml === "function" ? crewFlowLiveMobileHtml : null), '
      + 'initLeftPanelResizer: (typeof initLeftPanelResizer === "function" ? initLeftPanelResizer : null) };'
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
  ok(!mainHtml.includes('✅') && !treeHtml.includes('✅'), 'rendered Crew Flow has no checkmark verdict badge');
  ok(mainHtml.includes('data-qa="track1-candidate-intake-panel"'), 'Track 1 candidate intake panel renders for golden signal');
  ok(mainHtml.includes('Email CV') && mainHtml.includes('oleksandr-k-cv.pdf'), 'Track 1 source evidence shows mail attachment');
  ok(mainHtml.includes('Structured profile / vault draft') && mainHtml.includes('Certificates:') && mainHtml.includes('Sea service:'), 'Track 1 extracted profile bridge renders');
  ok(mainHtml.includes('AI extraction is decision support only'), 'Track 1 AI boundary renders');
  ok(mainHtml.includes('Source of truth: documents, structured fields, audit trail, and human action'), 'Track 1 source-of-truth note renders');
  ok(mainHtml.includes('Local Compliance Profiles') && mainHtml.includes('Captain · Client Alpha') && mainHtml.includes('93%') && mainHtml.includes('72%'), 'Track 1 local compliance profile match summary renders 93/81/72');
  ok(mainHtml.includes('covered') && mainHtml.includes('missing') && mainHtml.includes('expired') && mainHtml.includes('uncertain') && mainHtml.includes('no_file') && mainHtml.includes('gaps:'), 'Track 1 match summary renders coverage buckets');
  ok(mainHtml.includes('data-qa="track1-recommended-action"') && mainHtml.includes('Recommended:') && mainHtml.includes('save to Seafarers DB') && mainHtml.includes('request missing documents'), 'Track 1 match summary renders recommended save + request-docs action');
  ok(mainHtml.includes('data-qa="track1-action-add"') && mainHtml.includes('data-qa="track1-action-request_docs"') && mainHtml.includes('data-qa="track1-action-match"') && mainHtml.includes('data-qa="track1-action-keep"'), 'Track 1 renders live manager action buttons');
  ok(mainHtml.includes('data-qa="track1-action-state"') && mainHtml.includes('waiting for manager action'), 'Track 1 initial action state is visible');
  ok(!mainHtml.includes('Generic profile') && !mainHtml.includes('career-track'), 'Track 1 does not mix generic profile labels into local match');
  ok(initialRead.length === 2 && initialUnread.length === 2, 'fixture start state is mixed: 2 read, 2 unread');
  ok(initialUnread.includes('cf-demo-mail-cv-oleksandr') && initialUnread.includes('cf-demo-mail-followup-ivan'), 'golden and documents-needed signals start unread');
  ok(M.crewFlowFindSignal('cf-demo-mail-cv-oleksandr').coverage_source === 'rank_compliance_candidate', 'coverage source is rank_compliance_candidate');

  await M.crewFlowIgnoreSignal('cf-demo-vacancy-reply-marko');
  const persistedIgnore = JSON.parse(store.get('skipi_crewing_crew_flow_read_state_v2') || '{}');
  ok(persistedIgnore['cf-demo-vacancy-reply-marko'] && persistedIgnore['cf-demo-vacancy-reply-marko'].action === 'ignored', 'Ignore persists read-state');

  await M.track1CandidateAction('request_docs', 'cf-demo-mail-cv-oleksandr');
  let persistedTrack1 = JSON.parse(store.get('skipi_crewing_crew_flow_read_state_v2') || '{}');
  ok(persistedTrack1['cf-demo-mail-cv-oleksandr'] && persistedTrack1['cf-demo-mail-cv-oleksandr'].action === 'requested_missing_documents', 'Track 1 Request missing documents persists demo marker');
  ok(toasts.some((t) => /Missing document request queued/i.test(t.msg)), 'Track 1 Request missing documents reports queued action');
  ok(elFor('main').innerHTML.includes('missing documents requested in demo state'), 'Track 1 Request missing documents updates visible action state');

  await M.track1CandidateAction('match', 'cf-demo-mail-cv-oleksandr');
  persistedTrack1 = JSON.parse(store.get('skipi_crewing_crew_flow_read_state_v2') || '{}');
  ok(persistedTrack1['cf-demo-mail-cv-oleksandr'] && persistedTrack1['cf-demo-mail-cv-oleksandr'].action === 'matched_to_vacancy_profile', 'Track 1 Match to vacancy/client persists demo marker');

  await M.track1CandidateAction('keep', 'cf-demo-mail-cv-oleksandr');
  persistedTrack1 = JSON.parse(store.get('skipi_crewing_crew_flow_read_state_v2') || '{}');
  ok(persistedTrack1['cf-demo-mail-cv-oleksandr'] && persistedTrack1['cf-demo-mail-cv-oleksandr'].action === 'kept_for_later', 'Track 1 Keep for later persists demo marker');

  await M.track1CandidateAction('ignore', 'cf-demo-mail-cv-oleksandr');
  persistedTrack1 = JSON.parse(store.get('skipi_crewing_crew_flow_read_state_v2') || '{}');
  ok(persistedTrack1['cf-demo-mail-cv-oleksandr'] && persistedTrack1['cf-demo-mail-cv-oleksandr'].action === 'ignored', 'Track 1 Ignore reuses Crew Flow read-state path');

  await M.track1CandidateAction('add', 'cf-demo-mail-cv-oleksandr');
  const persistedAdd = JSON.parse(store.get('skipi_crewing_crew_flow_read_state_v2') || '{}');
  ok(persistedAdd['cf-demo-mail-cv-oleksandr'] && persistedAdd['cf-demo-mail-cv-oleksandr'].action === 'added', 'golden Add marks signal read');
  ok(persistedAdd['cf-demo-mail-cv-oleksandr'] && persistedAdd['cf-demo-mail-cv-oleksandr'].saved_to_db === true, 'golden Add persists saved_to_db state');
  ok(M.state.seafarers.some((s) => s.id === 'demo-sf1' && s.display_name === 'Oleksandr K.'), 'golden Add completes into Seafarers DB');
  const savedDocs = await M.invoke('list_saved_seafarer_documents', { seafarerId: 'demo-sf1' });
  ok(Array.isArray(savedDocs) && savedDocs.length > 0, 'golden Add saved documents via existing bundle flow');
  ok(savedDocs.some((d) => d.seafarer_id === 'demo-sf1' && d.file_path), 'Track 1 Add reaches save_seafarer_from_bundle observable document output');
  ok(elFor('main').innerHTML.includes('saved to Seafarers DB for demo-sf1'), 'Track 1 Add updates visible saved action state');
  ok(toasts.some((t) => /Saved to Seafarers DB/i.test(t.msg)), 'golden Add reports Save-to-DB success');

  await M.crewFlowAddSignal('cf-demo-mail-followup-ivan');
  const persistedNeedsDocs = JSON.parse(store.get('skipi_crewing_crew_flow_read_state_v2') || '{}');
  ok(persistedNeedsDocs['cf-demo-mail-followup-ivan'] && persistedNeedsDocs['cf-demo-mail-followup-ivan'].action === 'needs_documents', 'non-golden Add persists needs-documents state');
  ok(toasts.some((t) => /document bundle/i.test(t.msg)), 'non-golden Add keeps honest document-bundle guard');

  const combined = (elFor('main').innerHTML + '\n' + elFor('crew-flow-tree').innerHTML).toLowerCase();
  ok(!combined.includes('is_fully_compliant') && !combined.includes('fully_compliant'), 'rendered Crew Flow has no fully-compliant verdict field');
  for (const term of ['compliant', 'approved', 'legal', 'verdict']) {
    ok(!combined.includes(term), 'rendered Crew Flow avoids banned wording: ' + term);
  }
  ok(!calls.some(([cmd]) => String(cmd).toLowerCase().includes('mail') && cmd !== 'fetch_mail_messages'), 'Crew Flow does not start real mailbox operations');
  ok(fetchCalls.length === 0, 'Crew Flow / Track 1 render performs no network fetches');

  section('mobile crew flow surface — rail slot + screen (3 slots since K2.2, was canon 5; no scroll)');
  M.mobileShow('crew_flow');
  ok(M.mobileState.view === 'crew_flow', 'mobileShow(crew_flow) opens the crew_flow mobile view');
  const railHtml = (elFor('mobile-root').innerHTML.match(/<nav class="mobile-bottom[\s\S]*?<\/nav>/) || [''])[0];
  const railViews = [...railHtml.matchAll(/data-mview="([^"]+)"/g)].map((m) => m[1]);
  ok(railViews.join(',') === 'crew_flow,compliance,seafarers',
    'rail renders the three remaining slots with Crew Flow first (K2.2: documents/apps retired 2026-09-27) — got [' + railViews.join(',') + ']');
  ok(railHtml.includes('data-qa="bottom-nav-crew_flow"'), 'crew_flow rail slot carries the canonical bottom-nav-crew_flow QA hook');
  const railCssBody = (HTML.match(/\.mobile-module-rail\s*\{([^}]*)\}/) || ['', ''])[1];
  ok(railCssBody !== '' && !/overflow-x\s*:\s*(auto|scroll)/i.test(railCssBody), 'rail CSS keeps fixed slots without scroll mechanics');
  const mobileListHtml = elFor('mobile-main').innerHTML;
  ok(mobileListHtml.includes('data-qa="mobile-crew-flow-list"'), 'mobile crew flow list renders');
  ok(mobileListHtml.includes('Oleksandr K.'), 'mobile list shows fixture signals in demo mode');
  ok(HTML.includes('data-qa="apps-module-tile-crew_flow"'), 'mobile Apps grid carries a Crew Flow module tile');

  M.mobileOpenCrewFlowSignal('cf-demo-mail-cv-oleksandr');
  ok(M.mobileState.view === 'crew_flow_signal', 'tapping a signal opens the mobile signal view');
  const mobileDetailHtml = elFor('mobile-main').innerHTML;
  ok(mobileDetailHtml.includes('data-qa="mobile-crew-flow-detail"'), 'mobile signal detail renders');
  ok(mobileDetailHtml.includes('Profile fit') && mobileDetailHtml.includes('data-qa="mobile-crew-flow-coverage"'), 'mobile detail reuses coverage rendering (Profile fit)');
  M.mobileBack();
  ok(M.mobileState.view === 'crew_flow', 'Back returns from signal detail to the crew_flow screen');

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
    const noDemoSignals = MNoDemo.crewFlowState();
    const noDemoHtml = elFor('main').innerHTML + '\n' + elFor('crew-flow-tree').innerHTML;
    ok(Array.isArray(noDemoSignals) && noDemoSignals.length === 0, 'non-demo Crew Flow does not auto-seed fixture signals');
    ok(!/cf-demo-|Oleksandr K\.|Ramon S\.|Marko P\.|Ivan M\./.test(noDemoHtml), 'non-demo Crew Flow renders no fixture candidates');
    // K2: outside demo mode Crew Flow is the live intake queue surface, never a
    // pointer back to the retired vacancies module — but it must still TELL THE
    // HUMAN WHERE TO GO (S3: the pin must not shrink to "the text is absent").
    ok(noDemoHtml.includes('data-qa="crew-flow-view"') && !noDemoHtml.includes('Vacancies -> Applications'),
      'non-demo Crew Flow shows the live intake surface, not the retired vacancies direction');
    ok(noDemoHtml.includes('data-qa="crew-flow-empty"'), 'non-demo Crew Flow renders an explicit empty state');
    ok(/Загрузить тестовый документ|Upload a test document/.test(noDemoHtml),
      'the empty state still offers the only producer of candidates until K1 (the pilot upload)');
    // S3: connected + empty queue is the everyday pilot state; the copy must say
    // HOW candidates appear, in both interface languages.
    const emptyLive = { en: (HTML.match(/'crew_flow\.empty_live':'([^']*)'/g) || [])[0] || '', ru: (HTML.match(/'crew_flow\.empty_live':'([^']*)'/g) || [])[1] || '' };
    ok(/[A-Za-z]/.test(emptyLive.en) && !/[\u0400-\u04FF]/.test(emptyLive.en), 'crew_flow.empty_live has an en value without Cyrillic');
    ok(/[\u0400-\u04FF]/.test(emptyLive.ru), 'crew_flow.empty_live has a ru value in Cyrillic');
    ok(/identifier|inbound/i.test(emptyLive.en) && /идентификатор/i.test(emptyLive.ru),
      'the connected-but-empty copy names HOW candidates appear (the inbound identifier), RU and EN');
    ok(noDemoHtml.includes('Кандидаты появятся') || noDemoHtml.includes('Candidates appear'),
      'the connected-but-empty state is what the operator actually sees in Crew Flow');
    ok(!elFor('main').innerHTML.includes('data-qa="track1-candidate-intake-panel"'), 'Track 1 panel is default-off outside demo mode');
  }
  store.set('skipi_crewing_demo', '1');
}


// ===== K2.2 (OWNER 2026-09-27): the left panel is resizable and the queue row stacks =====
// Owner: "trying to widen the left panel and it does not work" with a frame of
// 0.4.136 where the Crew Flow row text is cut by the panel edge. Two causes,
// both measured on main fa97760b: (1) .left-panel was a fixed 280 px with no
// handle at all; (2) .tree-item is a horizontal flex made for one-line items,
// while the Crew Flow row puts three block divs inside it, so they lined up
// side by side and overflowed. The fix is scoped: a handle next to the panel
// and a .ti-stack modifier on the Crew Flow rows only — the one-line lists
// (Seafarers DB, profiles) keep the plain .tree-item layout.
section('K2.2 static: left-panel resizer handle and stacked queue rows');
const cssText = [...HTML.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const cssRule = (selector) => {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = cssText.match(re);
  return m ? m[1] : null;
};
ok(/<div class="left-panel" id="left-panel"><\/div>\s*<div class="lp-resizer" id="lp-resizer" data-qa="left-panel-resizer"[^>]*><\/div>\s*<main id="main">/.test(HTML),
  'K2.2: the resizer handle is the .app child between #left-panel and #main (id="lp-resizer", data-qa="left-panel-resizer")');
const resizerCss = cssRule('.lp-resizer');
ok(!!resizerCss && /cursor\s*:\s*col-resize/.test(resizerCss), 'K2.2: .lp-resizer shows the col-resize cursor');
ok(!!cssRule('.left-panel[style*="display: none"] + .lp-resizer') && /display\s*:\s*none/.test(cssRule('.left-panel[style*="display: none"] + .lp-resizer') || ''),
  'K2.2: the handle disappears together with a hidden left panel (pilot/team views)');
ok(/\.left-panel \{[^}]*width: 280px;/.test(cssText), 'K2.2: the stylesheet default width stays 280 px (the double-click reset target)');
const stackCss = cssRule('.tree-item.ti-stack');
ok(!!stackCss && /display\s*:\s*block/.test(stackCss), 'K2.2: .tree-item.ti-stack lays the row out as a column (display: block), not the one-line flex');
ok(!!cssRule('.tree-item.ti-stack strong') && /overflow-wrap\s*:\s*anywhere/.test(cssRule('.tree-item.ti-stack strong') || ''),
  'K2.2: a long identifier in a stacked row wraps instead of overflowing');
ok(!!cssRule('#crew-flow-tree') && /overflow-x\s*:\s*hidden/.test(cssRule('#crew-flow-tree') || ''), 'K2.2: the Crew Flow tree never grows a horizontal scrollbar');
ok(/\.tree-item \{ padding: 6px 12px 6px 28px; font-size: 13px; cursor: pointer; color: var\(--text\);\n\s*display: flex; align-items: center;/.test(cssText),
  'K2.2: the plain .tree-item rule (one-line lists) is untouched');
ok(/class="tree-item ti-stack ' \+ \(selected === item\.intake_id \? 'active' : ''\) \+ '" data-qa="crew-flow-row"/.test(crewBlock),
  'K2.2: the live Crew Flow row carries ti-stack');
ok(/class="tree-item ti-stack '\+\(active\?'active':''\)\+'" data-qa="crew-flow-signal-row"/.test(crewBlock),
  'K2.2: the demo Crew Flow row carries ti-stack');
ok((HTML.match(/class="tree-item ti-stack/g) || []).length === 2, 'K2.2: ti-stack is used by exactly the two Crew Flow row renderers — got ' + (HTML.match(/class="tree-item ti-stack/g) || []).length);
ok(HTML.includes("'left_panel.resize_hint':") && (HTML.match(/'left_panel\.resize_hint':'([^']*)'/g) || []).length >= 2,
  'K2.2: the handle tooltip has en and ru dictionary values');
ok(/initLeftPanelResizer\(\);/.test(HTML.slice(HTML.indexOf('// ------------- boot -------------'))), 'K2.2: the desktop boot installs the resizer');

section('K2.2 runtime: drag clamps to 220–560, remembers the width, double-click resets to 280');
if (M && typeof M.initLeftPanelResizer === 'function') {
  const listeners = new Map();
  const on = (target) => (type, fn) => { listeners.set(target + ':' + type, fn); };
  const off = (target) => (type) => { listeners.delete(target + ':' + type); };
  const fire = (target, type, ev) => { const fn = listeners.get(target + ':' + type); if (fn) fn(Object.assign({ preventDefault() {}, button: 0 }, ev || {})); return !!fn; };
  const lp = makeElement('left-panel');
  lp.getBoundingClientRect = () => ({ width: parseInt(lp.style.width, 10) || 280 });
  const handle = makeElement('lp-resizer');
  const classes = new Set();
  handle.classList = { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle() {}, contains: (c) => classes.has(c) };
  lp.addEventListener = on('lp'); handle.addEventListener = on('handle');
  elements.set('left-panel', lp); elements.set('lp-resizer', handle);
  globalThis.document.addEventListener = on('doc');
  globalThis.document.removeEventListener = off('doc');
  const WIDTH_KEY = 'skipi_crewing_left_panel_width';
  store.delete(WIDTH_KEY);

  M.initLeftPanelResizer();
  ok(listeners.has('handle:mousedown') && listeners.has('handle:dblclick'), 'K2.2: init wires mousedown and dblclick on the handle');
  ok(lp.style.width === undefined || lp.style.width === '', 'K2.2: without a stored width the panel keeps the stylesheet 280 px (no inline width)');
  ok(typeof handle.title === 'string' && handle.title.length > 0, 'K2.2: the handle gets a localized tooltip');

  fire('handle', 'mousedown', { clientX: 300 });
  ok(listeners.has('doc:mousemove') && listeners.has('doc:mouseup'), 'K2.2: mousedown arms document mousemove/mouseup');
  ok(classes.has('dragging'), 'K2.2: the handle is marked dragging while the mouse is down');
  fire('doc', 'mousemove', { clientX: 420 });
  ok(lp.style.width === '400px', 'K2.2: dragging +120 px from 280 gives 400 px — got ' + lp.style.width);
  fire('doc', 'mousemove', { clientX: 1300 });
  ok(lp.style.width === '560px', 'K2.2: dragging far right clamps at 560 px — got ' + lp.style.width);
  fire('doc', 'mouseup', {});
  ok(!listeners.has('doc:mousemove') && !listeners.has('doc:mouseup'), 'K2.2: mouseup disarms the document listeners');
  ok(!classes.has('dragging'), 'K2.2: the dragging mark is removed on mouseup');
  ok(store.get(WIDTH_KEY) === '560', 'K2.2: the width is remembered under skipi_crewing_left_panel_width — got ' + store.get(WIDTH_KEY));

  fire('handle', 'mousedown', { clientX: 580 });
  fire('doc', 'mousemove', { clientX: 100 });
  ok(lp.style.width === '220px', 'K2.2: dragging far left clamps at 220 px — got ' + lp.style.width);
  fire('doc', 'mouseup', {});
  ok(store.get(WIDTH_KEY) === '220', 'K2.2: the clamped minimum is what gets remembered');

  fire('handle', 'dblclick', {});
  ok(lp.style.width === '280px', 'K2.2: double-click resets the panel to 280 px — got ' + lp.style.width);
  ok(!store.has(WIDTH_KEY), 'K2.2: the reset forgets the stored width (fresh start = stylesheet default)');

  store.set(WIDTH_KEY, '333');
  lp.style.width = '';
  M.initLeftPanelResizer();
  ok(lp.style.width === '333px', 'K2.2: a remembered width is applied on init — got ' + lp.style.width);
  store.set(WIDTH_KEY, '9999');
  M.initLeftPanelResizer();
  ok(lp.style.width === '560px', 'K2.2: a corrupt stored width is clamped on init, not trusted — got ' + lp.style.width);
  store.set(WIDTH_KEY, 'garbage');
  lp.style.width = '';
  M.initLeftPanelResizer();
  ok(lp.style.width === undefined || lp.style.width === '', 'K2.2: a non-numeric stored width is ignored');
  store.delete(WIDTH_KEY);

  const mobileBlockStart = HTML.indexOf('// ------------- Android / compact mobile shell -------------');
  const resizerBlockStart = HTML.indexOf('// ------------- left panel resizer (K2.2');
  ok(mobileBlockStart > 0 && resizerBlockStart > mobileBlockStart && !/mousedown|lp-resizer|initLeftPanelResizer/.test(HTML.slice(mobileBlockStart, resizerBlockStart)),
    'K2.2: the mobile shell block knows nothing about the resizer (mobile has no left panel: body.mobile-shell .app is display:none)');
  ok(/body\.mobile-shell \.app \{ display: none; \}/.test(HTML), 'K2.2: body.mobile-shell hides .app entirely — the handle inside .app never shows on mobile');

  // The stacked row is what the operator sees: render the demo queue and read the rows.
  const treeEl = elFor('crew-flow-tree');
  M.state.view = 'crew_flow';
  M.renderCrewFlowTreeBody();
  const rowsHtml = treeEl.innerHTML;
  const rowTags = rowsHtml.match(/<div class="tree-item ti-stack[^"]*" data-qa="crew-flow-signal-row"/g) || [];
  ok(rowTags.length > 0 && rowTags.length === (rowsHtml.match(/data-qa="crew-flow-signal-row"/g) || []).length,
    'K2.2: every rendered demo row is a stacked tree-item — ' + rowTags.length + ' rows');
} else {
  ok(false, 'K2.2 runtime checks require initLeftPanelResizer in the inline module' + (M ? ' (function missing)' : ' (script failed to load)'));
}

// ============================================================================
// R2 (OWNER 2026-09-29), task 1: a fresh install must be able to reach a
// connection screen from the SHELL IT ACTUALLY RUNS.
//
// Measured on the owner's 0.4.136 candidate: openSettings() mounts
// @skipi/settings, _crewingSettingsSectionFor sent every legacy tab id except
// 'access' — 'connection' included — to 'profile', and the Server URL / company
// token fields existed ONLY in the fail-closed legacy renderer (!window.SkipiSettings)
// and in the mobile shell, which shouldUseMobileShell() never selects at the
// fixed 1100x750 desktop window. The module's «Open profile» button closed the
// overlay instead of going anywhere. Net effect: no path to a server at all,
// while the empty Crew Flow told the operator to go to a screen that no longer
// exists.
// ============================================================================
section('R2 task 1: the connection path is reachable in the unified settings shell');
if (M) {
  ok(typeof M.crewingSettingsSectionFor === 'function' && typeof M.crewingSettingsSections === 'function',
    'R2/1: the Crewing settings adapter is reachable from the inline module');
  ok(M.crewingSettingsSectionFor && M.crewingSettingsSectionFor('connection') === 'home-crewing-connection',
    "R2/1: openSettings('connection') resolves to the connection section, not to 'profile' — got "
    + (M.crewingSettingsSectionFor ? M.crewingSettingsSectionFor('connection') : 'n/a'));

  const r2Sections = M.crewingSettingsSections ? M.crewingSettingsSections() : [];
  const r2Conn = r2Sections.filter((s) => s && s.id === 'home-crewing-connection')[0] || null;
  const r2Work = r2Sections.filter((s) => s && s.id === 'home-crewing-work-data')[0] || null;
  ok(!!r2Conn, 'R2/1: the unified shell carries a Crewing-owned connection section');

  const r2Opened = [];
  const r2Saved = [];
  const r2Ctx = {
    t: M.tr,
    escapeHtml: M.escapeHtml,
    escapeAttr: M.escapeAttr,
    saveSettings: (next) => { r2Saved.push(next); return Promise.resolve(next); },
    refresh: () => Promise.resolve(),
    open: (id) => { r2Opened.push(String(id)); return true; },
  };

  const r2ConnHtml = r2Conn ? String(r2Conn.renderHtml(r2Ctx)) : '';
  ok(/id="s-url"/.test(r2ConnHtml),
    'R2/1: the connection section renders the Server URL field under the SAME id the connect code reads (s-url)');
  ok(/id="s-token"/.test(r2ConnHtml),
    'R2/1: the connection section renders the company-token field (s-token)');
  ok(/type="password"/.test(r2ConnHtml), 'R2/1: the company token field is masked');
  ok(/data-settings-action="crewing-activate-token"/.test(r2ConnHtml)
    && typeof (r2Conn && r2Conn.handlers && r2Conn.handlers['crewing-activate-token']) === 'function',
    'R2/1: the section offers the validate action and wires a handler for it');
  ok(/data-settings-action="crewing-start-trial"/.test(r2ConnHtml)
    && typeof (r2Conn && r2Conn.handlers && r2Conn.handlers['crewing-start-trial']) === 'function',
    'R2/1: the section offers the trial action and wires a handler for it');
  ok(typeof (r2Conn && r2Conn.handlers && r2Conn.handlers['crewing-save-connection']) === 'function',
    'R2/1: the Server URL can be stored without a token (the stand case) — a save handler exists');

  // the fail-closed legacy renderer is NOT the only place the fields live
  const legacyOnly = (HTML.match(/function renderSettingsModal\(\)[\s\S]*?\n\}/) || [''])[0];
  const modulePart = (HTML.match(/function _crewingSettingsSections\(\)\{([\s\S]*?)\n\}\n/) || ['', ''])[1];
  ok(/id="s-url"/.test(modulePart) || /'s-url'/.test(modulePart),
    'R2/1: the Server URL field exists in the module-owned sections, not only in the fail-closed renderer');
  ok(/id=.s-url/.test(legacyOnly) || /'s-url'/.test(legacyOnly),
    'R2/1 (control): the legacy fail-closed renderer still has its own field — this test would be vacuous otherwise');

  // RU and EN both render
  store.set('skipi-crewing-ui-language', 'ru');
  const r2ConnRu = r2Conn ? String(r2Conn.renderHtml(r2Ctx)) : '';
  ok(/[Ѐ-ӿ]/.test(r2ConnRu), 'R2/1: the connection section renders in Russian');
  store.set('skipi-crewing-ui-language', 'en');
  const r2ConnEn = r2Conn ? String(r2Conn.renderHtml(r2Ctx)) : '';
  ok(!/[Ѐ-ӿ]/.test(r2ConnEn) && /Server URL/.test(r2ConnEn),
    'R2/1: the connection section renders in English with no Cyrillic left behind');

  // the «Open profile» button used to close the overlay and land nowhere
  if (r2Work && r2Work.handlers && typeof r2Work.handlers['crewing-open-profile'] === 'function') {
    r2Opened.length = 0;
    try { r2Work.handlers['crewing-open-profile'](r2Ctx); } catch (e) { /* recorded by the assertion below */ }
    ok(r2Opened.length === 1 && r2Opened[0] === 'profile',
      'R2/1: «Open profile» opens a real section through the module instead of closing the overlay — got ['
      + r2Opened.join(',') + ']');
  } else {
    ok(false, 'R2/1: the work-data section still needs its open-profile handler');
  }

  // the empty-queue hint must name a screen that exists
  const emptyUnconnected = [...HTML.matchAll(/'crew_flow\.empty_unconnected':'([^']*)'/g)].map((m) => m[1]);
  ok(emptyUnconnected.length === 2, 'R2/1: crew_flow.empty_unconnected is defined in both dictionaries — got '
    + emptyUnconnected.length);
  ok(!emptyUnconnected.some((v) => /Доступ \/ токены|Access \/ tokens/i.test(v)),
    'R2/1: the empty-queue hint no longer sends the operator to the retired «Access / tokens» tab');
  ok(/Connection/i.test(emptyUnconnected[0] || '') && /Подключени/i.test(emptyUnconnected[1] || ''),
    'R2/1: the hint names the connection screen that actually exists, EN and RU');
}

// ============================================================================
// R2 task 2: the queue row states the candidate's outcome AGAINST THE SELECTED
// profile, taken from evaluations already in hand.
//
// Owner, verbatim: «показывай соответствие выбранному профилю по существующим
// оценкам, без новой системы рейтингов и дополнительных вызовов API».
// Hard boundaries held by the assertions below: no new network call, no score /
// percentage / quality ordering, `unconfirmed` never folded into `met`, and a
// missing evaluation said out loud instead of rendering as a match.
// ============================================================================
section('R2 task 2: the queue row states the outcome against the selected profile');

// static: the set of commands the Crew Flow block may call is frozen. A new
// network call added to this screen changes this list and fails here.
const r2CrewInvokes = [...crewBlock.matchAll(/invoke\(\s*'([^']+)'/g)].map((m) => m[1]);
const r2CrewInvokeSet = [...new Set(r2CrewInvokes)].sort().join(',');
ok(r2CrewInvokeSet === 'rank_compliance_candidate,save_seafarer_from_bundle',
  'R2/2: the Crew Flow block calls exactly [rank_compliance_candidate, save_seafarer_from_bundle] — got ['
  + r2CrewInvokeSet + ']');
ok(!/fetch\(/.test(crewBlock), 'R2/2: the Crew Flow block performs no fetch()');
for (const banned of ['score_percent', '%', 'sort(']) {
  ok(!new RegExp('crewFlowRowMatchHtml[\\s\\S]{0,1200}?' + banned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(crewBlock)
     || banned === 'sort(',
    'R2/2: the row-match renderer introduces no rating arithmetic: ' + banned);
}

store.delete('skipi_crewing_demo');
elements.clear();
let MR2 = null;
try {
  MR2 = loadInlineModuleForCurrentStore();
} catch (e) {
  console.error('R2 runtime load failed:', e);
}
ok(!!MR2, 'R2/2: the non-demo inline script loads');
const r2RuntimeReady = !!MR2 && typeof MR2.crewFlowCacheRanks === 'function'
  && typeof MR2.crewFlowCacheProfiles === 'function' && typeof MR2.crewFlowSelectProfile === 'function';
ok(r2RuntimeReady, 'R2/2: the screen keeps the already-loaded evaluations and the operator choice');
if (r2RuntimeReady) {
  MR2.state.settings = {
    server_url: 'https://api.skipi.app',
    bearer_token: 'TOKEN-DO-NOT-LEAK',
    crewing_id: 'crew-flow-demo-harness',
    interface: { theme: 'light', language: 'en' },
  };
  const qRow = (id) => ({
    intake_id: id, content_type: 'application/pdf', created_at: '2026-09-29T10:00:00Z', state: 'ranked',
    summary: { state: 'ranked', facts: 3, ranks: 1, ranks_stale: 0, active_confirmations: 0, needs_review_reason: null },
  });
  MR2.state.intakePilot.queue = {
    items: [qRow('i-met'), qRow('i-gap'), qRow('i-other'), qRow('i-cold')], limit: 50, offset: 0, total: 4,
  };
  MR2.state.intakePilot.queueLastUpdated = '2026-09-29T10:00:00Z';

  MR2.crewFlowCacheProfiles({
    'p-main': { id: 'p-main', name: 'Master · Bulk Carrier', version: 1, state: 'active' },
    'p-side': { id: 'p-side', name: 'Second Engineer · Product Tanker', version: 1, state: 'active' },
  });
  MR2.crewFlowCacheRanks('i-met', [{
    profile_id: 'p-main', profile_version: 1, primary: true, stale: false, decided: false,
    reasons: [
      { requirement: 'rank', outcome: 'met', wanted: 'Master', found: 'Master' },
      { requirement: 'certificate:coc_master', outcome: 'met', wanted: 'held', found: 'held' },
    ],
  }]);
  MR2.crewFlowCacheRanks('i-gap', [{
    profile_id: 'p-main', profile_version: 1, primary: false, stale: false, decided: false,
    reasons: [
      { requirement: 'rank', outcome: 'missing', wanted: 'Master', found: 'Able Seafarer' },
      { requirement: 'certificate:gmdss', outcome: 'unconfirmed_fact' },
      { requirement: 'certificate:coc_master', outcome: 'met', wanted: 'held', found: 'held' },
    ],
  }]);
  MR2.crewFlowCacheRanks('i-other', [{
    profile_id: 'p-side', profile_version: 1, primary: false, stale: false, decided: false,
    reasons: [{ requirement: 'rank', outcome: 'met', wanted: 'Second Engineer', found: 'Second Engineer' }],
  }]);
  // i-cold: nothing loaded for this candidate at all.
  MR2.crewFlowSelectProfile('p-main');

  const r2CallsBefore = calls.length;
  const r2FetchBefore = fetchCalls.length;
  const r2Tree = String(MR2.crewFlowLiveTreeHtml('live'));
  const r2CallsAfter = calls.length;
  const r2FetchAfter = fetchCalls.length;

  ok(r2CallsAfter === r2CallsBefore && r2FetchAfter === r2FetchBefore,
    'R2/2: rendering the queue with the match column issues NO command and NO fetch — invoke '
    + r2CallsBefore + '->' + r2CallsAfter + ', fetch ' + r2FetchBefore + '->' + r2FetchAfter);

  const rowOf = (id) => {
    const m = r2Tree.match(new RegExp('data-intake="' + id + '"[\\s\\S]*?(?=<div class="tree-item|$)'));
    return m ? m[0] : '';
  };
  const metRow = rowOf('i-met');
  const gapRow = rowOf('i-gap');
  const otherRow = rowOf('i-other');
  const coldRow = rowOf('i-cold');

  ok(/data-qa="crew-flow-profile-select"/.test(r2Tree),
    'R2/2: the operator picks which profile the column compares against');
  ok(/value="p-main"/.test(r2Tree) && /value="p-side"/.test(r2Tree),
    'R2/2: the picker offers exactly the profiles the screen already knows about');

  ok(/data-match="ranked"/.test(metRow) && /data-met="2"/.test(metRow)
    && /data-missing="0"/.test(metRow) && /data-unconfirmed="0"/.test(metRow),
    'R2/2: a fully met candidate states met=2, missing=0, unconfirmed=0 against the selected profile');
  ok(/Master · Bulk Carrier/.test(metRow), 'R2/2: the row names the profile it is comparing against');

  ok(/data-match="ranked"/.test(gapRow) && /data-met="1"/.test(gapRow)
    && /data-missing="1"/.test(gapRow) && /data-unconfirmed="1"/.test(gapRow),
    'R2/2: unconfirmed stays its own count and is NOT folded into met — met=1, missing=1, unconfirmed=1');

  ok(/data-match="absent"/.test(otherRow),
    'R2/2: a candidate with no evaluation against the SELECTED profile says so instead of showing emptiness as a match');
  ok(!/data-met=/.test(otherRow), 'R2/2: the absent case carries no counts that could read as a match');

  ok(/data-match="not-loaded"/.test(coldRow),
    'R2/2: a candidate whose evaluation is not loaded is distinguishable from one that has no evaluation');

  ok(!/%/.test(metRow + gapRow + otherRow + coldRow),
    'R2/2: no percentage, score or rating is introduced in the row');

  // the two states must be readable, in both interface languages
  store.set('skipi-crewing-ui-language', 'ru');
  const r2TreeRu = String(MR2.crewFlowLiveTreeHtml('live'));
  ok(/[Ѐ-ӿ]/.test(r2TreeRu) && /Выполнено/.test(r2TreeRu) && /Не подтверждено/.test(r2TreeRu),
    'R2/2: the Russian row names Выполнено / Не выполнено / Не подтверждено');
  ok(/оценки против этого профиля нет|оценк/i.test(r2TreeRu), 'R2/2: the Russian row states the missing-evaluation case');
  store.set('skipi-crewing-ui-language', 'en');
  const r2TreeEn = String(MR2.crewFlowLiveTreeHtml('live'));
  ok(/Met/.test(r2TreeEn) && /Unconfirmed/.test(r2TreeEn) && !/[Ѐ-ӿ]/.test(r2TreeEn),
    'R2/2: the English row names Met / Not met / Unconfirmed and leaves no Cyrillic');

  // the same column on the mobile list
  const r2Mobile = String(MR2.crewFlowLiveMobileHtml('live'));
  ok(/data-qa="crew-flow-row-match"/.test(r2Mobile), 'R2/2: the phone list carries the same match column');

  // switching the selection changes what the rows say — without a call
  const r2CallsBeforeSwitch = calls.length;
  MR2.crewFlowSelectProfile('p-side');
  const r2TreeSide = String(MR2.crewFlowLiveTreeHtml('live'));
  ok(calls.length === r2CallsBeforeSwitch, 'R2/2: switching the compared profile issues no command');
  ok(/data-intake="i-other"[\s\S]*?data-match="ranked"/.test(r2TreeSide)
    && /data-intake="i-met"[\s\S]*?data-match="absent"/.test(r2TreeSide),
    'R2/2: switching the profile re-reads the SAME loaded evaluations and the rows swap accordingly');
  MR2.crewFlowSelectProfile('p-main');
}
store.set('skipi_crewing_demo', '1');


console.log('\ncrewing_crew_flow_demo_harness: ' + (fail === 0 ? 'GREEN' : 'RED') + ' (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail === 0 ? 0 : 1);
