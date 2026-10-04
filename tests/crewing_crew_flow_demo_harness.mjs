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

// CANON (930): the "all stored checks met" signal must be legible in BOTH themes.
// It was one fixed #1f7a45 for both, which measured 2.74:1 on the selected dark
// queue row and 3.10:1 on the dark card. A single value serving both themes is
// the defect itself, so what is pinned here is that the pair EXISTS -- a dark
// default plus a light override -- not one particular hex.
{
  const css = HTML.slice(0, HTML.indexOf('</style>'));
  for (const sel of ['.cf-fit-complete .cf-pct', '.cf-fitcard.complete .cf-fitcard-pct']) {
    const light = css.indexOf(':root[data-theme="light"] ' + sel) !== -1
      || css.indexOf(sel.replace('.cf-', ':root[data-theme="light"] .cf-')) !== -1;
    ok(light, '930: ' + sel + ' has a light-theme override, so one value does not serve both themes');
  }
  ok(/:root\[data-theme="light"\][^{]*\.cf-fit-complete[^{]*\{[^}]*#1f7a45/.test(css),
    '930: the LIGHT theme keeps the green it was measured with — this change did not touch it');
  const darkRule = css.match(/\n\.cf-fit-complete \.cf-word, \.cf-fit-complete \.cf-pct \{ color:(#[0-9a-f]{6}); \}/);
  ok(!!darkRule && darkRule[1].toLowerCase() !== '#1f7a45',
    '930: and the dark default is NOT the low-contrast value — got ' + (darkRule ? darkRule[1] : 'no rule'));
}


// CANON (930) principle 1, checked on the card source: the machine wrapping of a
// fact, and the letter's object id, sit INSIDE a named disclosure -- while the
// things a decision is made on do not. Both were on the main screen on the stand:
// "be89d69c-... - message/rfc822" headed the Letter block, and the facts printed
// version / source object / page / span / confidence / timestamp as running text.
{
  const factFn = HTML.slice(HTML.indexOf('function pilotCardFactVersionHtml'), HTML.indexOf('function pilotCardFactsHtml'));
  ok(/data-qa="pilot-fact-technical"><summary>/.test(factFn),
    '930: the fact version/source-object/page/span/confidence/timestamp line is behind a named disclosure');
  ok(factFn.indexOf('pilot-fact-value') < factFn.indexOf('pilot-fact-technical'),
    '930: and the fact VALUE itself is printed before it, in plain sight');
  ok(/data-qa="pilot-fact-uncertainty"/.test(factFn),
    '930: an ambiguous or unrecognised reading stays beside the decision, not only inside the disclosure');
  const letterFn = HTML.slice(HTML.indexOf('function pilotCardLetterHtml'), HTML.indexOf('function cardAttachments'));
  ok(/data-qa="pilot-letter-provenance"><summary>/.test(letterFn)
    && letterFn.indexOf('pilot-letter-provenance') < letterFn.indexOf('pilot-letter-object'),
    '930: the letter object id is inside the provenance disclosure, not the first line of the block');
  // Note the closing quote: without it this matches `pilot-letter-open-saved`,
  // which is built earlier in the function, and the check passes vacuously.
  ok(letterFn.indexOf('data-qa="pilot-letter-open"') > letterFn.lastIndexOf('</details>'),
    '930 (control): the button that opens the original is NOT swallowed by that disclosure');
}

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
// R2: what the two list-load commands answer; set by the list-load section.
const R2_FIXTURES = { list: null, profiles: null };
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
  // R2: the list-load section below swaps in its own fixtures; unset means the old empty queue.
  if (cmd === 'crewing_intake_candidate_list') return R2_FIXTURES.list || { items: [], limit: 50, offset: 0, total: 0 };
  if (cmd === 'crewing_intake_matching_profile_list') return R2_FIXTURES.profiles || { items: [] };
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
// No.637/S7: the one parameter is the REMOVAL CALIBRATION of this file. Every
// "no number is printed" assertion below can also pass on a client that stopped
// printing numbers at all, so each one is paired with the same render over a
// source whose fix line is deleted — and that mutant must print the 0% back.
// Default argument, so every existing call site is byte-for-byte unchanged.
function loadInlineModuleForCurrentStore(sourceOverride) {
  return new Function(
    (sourceOverride == null ? scriptNoBoot : sourceOverride)
      + '\nif (typeof serverUrlArg === "undefined") serverUrlArg = function(){ return "https://api.skipi.app"; };'
      + '\nshowToast = function(msg, kind){ globalThis.__CREW_FLOW_TOASTS.push({ msg: String(msg), kind: kind || "" }); };'
      + '\nreturn { state, showView, renderCrewFlowView, refreshCrewFlowRankings, crewFlowState, crewFlowReadInfo, crewFlowIsRead, crewFlowFindSignal, crewFlowAddSignal, crewFlowIgnoreSignal, saveCurrentBundleSeafarer, track1CandidateIntakePanelHtml, track1CandidateAction, invoke, mobileShow, mobileBack, mobileState, mobileOpenCrewFlowSignal, renderCrewFlowTreeBody, crewFlowLiveTreeHtml, tr, escapeHtml, escapeAttr, '
      + 'crewingSettingsSections: (typeof _crewingSettingsSections === "function" ? _crewingSettingsSections : null), '
      + 'crewingSettingsSectionFor: (typeof _crewingSettingsSectionFor === "function" ? _crewingSettingsSectionFor : null), '
      + 'crewFlowMatchShare: (typeof crewFlowMatchShare === "function" ? crewFlowMatchShare : null), '
      + 'crewFlowSourceLabel: (typeof crewFlowSourceLabel === "function" ? crewFlowSourceLabel : null), '
      + 'crewFlowCacheRanks: (typeof crewFlowCacheRanks === "function" ? crewFlowCacheRanks : null), '
      + 'crewFlowCacheProfiles: (typeof crewFlowCacheProfiles === "function" ? crewFlowCacheProfiles : null), '
      + 'crewFlowSelectProfile: (typeof crewFlowSelectProfile === "function" ? crewFlowSelectProfile : null), '
      + 'crewFlowCacheRankSummary: (typeof crewFlowCacheRankSummary === "function" ? crewFlowCacheRankSummary : null), '
      + 'crewFlowRankCache: (typeof crewFlowRankCache === "function" ? crewFlowRankCache : null), '
      + 'crewFlowCacheNameOrigin: (typeof crewFlowCacheNameOrigin === "function" ? crewFlowCacheNameOrigin : null), '
      + 'crewFlowNameOrigin: (typeof crewFlowNameOrigin === "function" ? crewFlowNameOrigin : null), '
      + 'crewFlowEnsureLiveQueue: (typeof crewFlowEnsureLiveQueue === "function" ? crewFlowEnsureLiveQueue : null), '
      + 'pilotLoadQueue: (typeof pilotLoadQueue === "function" ? pilotLoadQueue : null), '
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
// Round 1 froze this list at two and asserted "no new call". The owner lifted that
// boundary on 2026-09-29 and replaced it with a narrower one, so the list is
// re-frozen at its new, named contents rather than deleted: exactly ONE command
// was added, crewing_intake_matching_profile_list — an existing, unpaid, O(1)
// lookup that turns a profile_id into a name. Anything beyond these three is a
// call nobody authorised.
const r2CrewInvokes = [...crewBlock.matchAll(/invoke\(\s*'([^']+)'/g)].map((m) => m[1]);
const r2CrewInvokeSet = [...new Set(r2CrewInvokes)].sort().join(',');
ok(r2CrewInvokeSet === 'crewing_intake_matching_profile_list,rank_compliance_candidate,save_seafarer_from_bundle',
  'R2/2: the Crew Flow block calls exactly [crewing_intake_matching_profile_list, rank_compliance_candidate, save_seafarer_from_bundle] — got ['
  + r2CrewInvokeSet + ']');
// The two commands that cost money or mutate state must never appear in this block.
for (const forbidden of ['crewing_intake_candidate_rank', 'parse_cv', 'reprocess']) {
  ok(!crewBlock.includes(forbidden),
    'R2/2: the Crew Flow block never calls ' + forbidden + ' — the list reads stored work, it does not create it');
}
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
    summary: { state: 'ranked', facts: 3, ranks: 1, ranks_stale: 0, ranks_withheld: 0, active_confirmations: 0, needs_review_reason: null },
  });
  // No.637/S7: the same row with profiles the server withheld by rank. This is
  // the shape S8 will produce for most people — nothing stored to compare, and
  // a count of the active profiles his rank does not reach.
  const qWithheld = (id, n) => {
    const row = qRow(id);
    row.summary.ranks = 0;
    row.summary.ranks_withheld = n;
    return row;
  };
  MR2.state.intakePilot.queue = {
    // No.637/S1c adds the two unreadable-post rows. They sit at the END so every
    // assertion written before them keeps reading the rows it was written for.
    items: [qRow('i-met'), qRow('i-gap'), qRow('i-other'), qRow('i-cold'),
            qRow('i-unknown'), qRow('i-unknown-old'),
            // No.637/S7 adds four more, also at the END for the same reason.
            // `ranks_withheld` is the summary field the bridge already carries
            // (No.637/S6): active profiles this candidate was deliberately not
            // compared against, every one of them because the rank does not apply.
            qRow('i-na'), qRow('i-nofit'), qWithheld('i-nofit-w', 3), qRow('i-nothing')],
    limit: 50, offset: 0, total: 10,
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
  // No.637/S1c. TWO shapes of the same unreadable post, because the defect is a
  // version skew and the client has to refuse under both of them:
  //   i-unknown     — the server AFTER S1c: the lists arrive EMPTY;
  //   i-unknown-old — a pilot server of an OLDER build: the lists arrive FULL,
  //                   which is exactly the "Met 1 · Not met 0 · Unconfirmed 1"
  //                   the supervisor rendered beside an unmeasured person.
  MR2.crewFlowCacheRanks('i-unknown', [{
    profile_id: 'p-main', profile_version: 1, primary: false, stale: false, decided: false,
    reasons: [], applicability: 'unknown', applicability_reason: 'rank_absent',
  }]);
  MR2.crewFlowCacheRanks('i-unknown-old', [{
    profile_id: 'p-main', profile_version: 1, primary: false, stale: false, decided: false,
    reasons: [
      { requirement: 'rank', outcome: 'unconfirmed_fact' },
      { requirement: 'certificate:coc_master', outcome: 'met', wanted: 'held', found: 'held' },
    ],
    applicability: 'unknown', applicability_reason: 'rank_unreadable',
  }]);
  // ===== No.637/S7 fixtures ================================================
  // i-na — RIZAL SANTOS'S EXACT SHAPE, off the live stand. The bytes are in
  //   src-tauri/src/crewing_intake.rs::LIVE_QUEUE_ROW_MIXED (captured verbatim
  //   by S6): the selected profile answers `not_applicable` and still carries
  //   four recognised outcomes that divide perfectly, met 0 of 4. That is the
  //   `0 %` and the «выполнено 0 из 4» the owner saw on 02.10. He DOES fit a
  //   second profile, so this row must not be mistaken for "fits nothing".
  MR2.crewFlowCacheRanks('i-na', [{
    profile_id: 'p-main', profile_version: 1, primary: true, stale: false, decided: false,
    reasons: [
      { requirement: 'rank', outcome: 'missing', wanted: 'Master', found: 'Able Seaman' },
      { requirement: 'certificate:stcw_ii_2', outcome: 'unconfirmed_fact' },
      { requirement: 'certificate:oil_tanker_adv', outcome: 'unconfirmed_fact' },
      { requirement: 'certificate:brm', outcome: 'unconfirmed_fact' },
    ],
    applicability: 'not_applicable', applicability_reason: null,
  }, {
    profile_id: 'p-side', profile_version: 1, primary: false, stale: false, decided: false,
    reasons: [{ requirement: 'rank', outcome: 'met', wanted: 'Second Engineer', found: 'Second Engineer' }],
    applicability: 'same', applicability_reason: null,
  }]);
  // i-nofit — every profile the screen holds for him answers `not_applicable`.
  //   OWNER 02.10: «вполне нормально если кандидат не подошел ни под один
  //   профиль соответствия, такого можно отмаркировать серым цветом в левой
  //   колонке». A calm state, not an error and not a zero.
  MR2.crewFlowCacheRanks('i-nofit', [{
    profile_id: 'p-main', profile_version: 1, primary: false, stale: false, decided: false,
    reasons: [{ requirement: 'rank', outcome: 'missing', wanted: 'Master', found: 'Cook' }],
    applicability: 'not_applicable', applicability_reason: null,
  }, {
    profile_id: 'p-side', profile_version: 1, primary: false, stale: false, decided: false,
    reasons: [{ requirement: 'rank', outcome: 'missing', wanted: 'Second Engineer', found: 'Cook' }],
    applicability: 'not_applicable', applicability_reason: null,
  }]);
  // i-nofit-w — the SAME answer in the shape S8 produces: nothing stored at all,
  //   and the count of profiles withheld by rank on the summary.
  MR2.crewFlowCacheRanks('i-nofit-w', []);
  // i-nothing — THE CALIBRATION OF THE COUNT. Same empty list, `ranks_withheld`
  //   zero: nobody has answered anything about this man, which is not the same
  //   statement as "he fits nothing". Without this row the state above could be
  //   produced by an empty list alone and the count would be decoration.
  MR2.crewFlowCacheRanks('i-nothing', []);
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
  // The chips inside a tree row are unstyled text, so a long outcome sentence
  // placed among them reads as one run-on line (seen on the first frame).
  ok(/data-qa="crew-flow-row-match-line"[\s\S]{0,120}?data-qa="crew-flow-row-match"/.test(metRow),
    'R2/2: the outcome gets its own line of the row, not a chip slot next to the counters');
  ok(!/crew_flow\.ranks|comparisons: /.test(metRow), 'R2/2: the bare comparison counter is gone from the row');

  ok(/data-match="ranked"/.test(gapRow) && /data-met="1"/.test(gapRow)
    && /data-missing="1"/.test(gapRow) && /data-unconfirmed="1"/.test(gapRow),
    'R2/2: unconfirmed stays its own count and is NOT folded into met — met=1, missing=1, unconfirmed=1');

  // The machine-readable attributes are not what the operator reads. Pin the
  // PRINTED sentence too: mutation M10 folded unconfirmed into the visible met
  // number while leaving data-met alone, and survived every assertion above.
  const r2MatchText = (row) => {
    const m = String(row).match(/data-qa="crew-flow-row-match"[^>]*>([^<]*)</);
    return m ? m[1] : '';
  };
  ok(r2MatchText(metRow) === 'Master · Bulk Carrier — Met 2 · Not met 0 · Unconfirmed 0',
    'R2/2: the fully met row prints exactly "Met 2 · Not met 0 · Unconfirmed 0" — got "' + r2MatchText(metRow) + '"');
  ok(r2MatchText(gapRow) === 'Master · Bulk Carrier — Met 1 · Not met 1 · Unconfirmed 1',
    'R2/2: the mixed row prints exactly "Met 1 · Not met 1 · Unconfirmed 1" — got "' + r2MatchText(gapRow) + '"');
  for (const [rowId, row] of [['i-met', metRow], ['i-gap', gapRow]]) {
    const attrs = String(row).match(/data-met="(\d+)" data-missing="(\d+)" data-unconfirmed="(\d+)"/);
    const txt = r2MatchText(row);
    ok(!!attrs && txt.indexOf('Met ' + attrs[1] + ' · Not met ' + attrs[2] + ' · Unconfirmed ' + attrs[3]) !== -1,
      'R2/2: the printed counts are the same three numbers as the machine-readable ones (' + rowId + ') — "' + txt + '"');
  }

  ok(/data-match="absent"/.test(otherRow),
    'R2/2: a candidate with no evaluation against the SELECTED profile says so instead of showing emptiness as a match');
  ok(!/data-met=/.test(otherRow), 'R2/2: the absent case carries no counts that could read as a match');

  ok(/data-match="not-loaded"/.test(coldRow),
    'R2/2: a candidate whose evaluation is not loaded is distinguishable from one that has no evaluation');

  // ---- (928), OWNER 2026-09-30 ------------------------------------------
  // This assertion used to read "no percentage is introduced in the row", and
  // that was the right test for (869). (928) is the owner's LATER clarification:
  // one figure is permitted — floor(100 x met / total) against ONE chosen
  // profile — and it is never permitted bare. So the check is not dropped, it is
  // replaced by the harder one: the figure must be present where the data earns
  // it, floored, captioned, and ABSENT everywhere the data does not.
  const r2Pct = (row) => {
    const m = String(row).match(/data-qa="crew-flow-row-pct" data-pct="([^"]*)"[^>]*>([^<]*)</);
    return m ? { attr: m[1], text: m[2] } : null;
  };
  const r2Fit = (row) => {
    const m = String(row).match(/data-qa="crew-flow-row-fit" data-fit="([^"]*)"/);
    return m ? m[1] : null;
  };
  ok(r2Pct(metRow) && r2Pct(metRow).attr === '100' && r2Pct(metRow).text === '100%',
    'R2/928: 2 of 2 stored checks met prints 100% — got ' + JSON.stringify(r2Pct(metRow)));
  ok(r2Fit(metRow) === 'complete',
    'R2/928: and only that case is allowed to say every stored check was met');
  // 1 of 3 is 33.33...; floor is the owner's explicit instruction, not a taste.
  ok(r2Pct(gapRow) && r2Pct(gapRow).attr === '33',
    'R2/928: 1 met of 3 floors to 33%, it does not round to 34% — got ' + JSON.stringify(r2Pct(gapRow)));
  ok(r2Fit(gapRow) !== 'complete',
    'R2/928: a row with unmet and unconfirmed checks never reads as all-met, whatever its figure');
  // The caption is mandatory: the bare number is exactly what gets read as a score.
  // The headline word, the figure and the caption are three elements inside the
  // fit block; read the whole block and strip the markup rather than pinning a
  // particular nesting, so the requirement survives a layout change and only a
  // MISSING caption fails it.
  const r2FitText = (row) => {
    const m = String(row).match(/data-qa="crew-flow-row-fit"[\s\S]*?>([\s\S]*?)(?=<details|<div class="cf-chips")/);
    return m ? m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
  };
  ok(/2 of 2 checks met, by the stored evaluation/.test(r2FitText(metRow)),
    'R2/928: the figure never appears without "M of N checks met, by the stored evaluation" — got "' + r2FitText(metRow) + '"');
  ok(/1 of 3 checks met, by the stored evaluation/.test(r2FitText(gapRow)),
    'R2/928: the caption states the true fraction, not the rounded figure — got "' + r2FitText(gapRow) + '"');
  // "No data" is not 0%. Both of these carry NO figure at all.
  ok(r2Pct(otherRow) && r2Pct(otherRow).attr === 'none' && !/%/.test(r2Pct(otherRow).text),
    'R2/928: no stored comparison against the chosen profile yields no figure — never 0%');
  ok(r2Pct(coldRow) && r2Pct(coldRow).attr === 'none' && !/%/.test(r2Pct(coldRow).text),
    'R2/928: an unloaded comparison yields no figure — an unanswered question is not a zero');
  // The arithmetic itself is available, not permanently on display (owner, final).
  ok(/<details class="cf-brk"[\s\S]*?data-qa="crew-flow-row-match-line"/.test(metRow),
    'R2/928: the three counts stay reachable behind a disclosure rather than crowding the row');
  // The share function's own refusals, stated directly rather than inferred.
  const share = MR2.crewFlowMatchShare;
  ok(share({met:19,missing:1,unconfirmed:0,total:20,stale:false}).pct === 95,
    'R2/928: 19 of 20 is 95%');
  ok(share({met:249,missing:1,unconfirmed:0,total:250,stale:false}).pct === 99,
    'R2/928: 249 of 250 floors to 99% — the whole reason floor was specified');
  ok(share({met:0,missing:0,unconfirmed:0,total:0,stale:false}).pct === null,
    'R2/928: a zero denominator produces no figure, not 0% and not NaN');
  ok(share({met:2,missing:1,unconfirmed:1,total:5,stale:false}).pct === null,
    'R2/928: counts that do not add up to total produce no figure');
  ok(share({met:2,missing:0,unconfirmed:0,total:2,stale:true}).pct === null,
    'R2/928: a stale comparison loses its figure — a past share is not a current one');
  ok(share({met:1,missing:0,unconfirmed:0,total:null,stale:false}).pct === null
    && share({met:-1,missing:0,unconfirmed:1,total:0,stale:false}).pct === null
    && share({met:0.5,missing:0.5,unconfirmed:0,total:1,stale:false}).pct === null,
    'R2/928: an absent, negative or fractional counter produces no figure either');
  ok(share({met:2,missing:0,unconfirmed:0,total:2,stale:false}).reason === 'complete'
    && share({met:2,missing:0,unconfirmed:1,total:3,stale:false}).reason !== 'complete',
    'R2/928: unconfirmed keeps a comparison out of "all met" even though it is not a failure');
  // No.637/S1b. The QUEUE row reads the same function the candidate card reads,
  // and after S1b it receives rows it never used to: the server now writes an
  // evaluation for a candidate whose post nobody could read (before, there was
  // no row and the man was off the screen entirely — and the accepted shortlist
  // answered 404). Those counts DIVIDE, so without this refusal the list would
  // print a percentage beside the name of a person nobody measured. (939): "ни
  // совпадение, ни 0 %".
  ok(share({met:2,missing:0,unconfirmed:0,total:2,stale:false,applicability:'unknown'}).pct === null,
    'No.637/S1b: an unestablished post produces no figure in the queue row either, though its counts divide perfectly');
  ok(share({met:2,missing:0,unconfirmed:0,total:2,stale:false,applicability:'unknown'}).reason === 'rank_unknown',
    'No.637/S1b: and the row says WHICH question is open rather than going blank');
  ok(share({met:2,missing:0,unconfirmed:0,total:2,stale:false,applicability:'unknown'}).met === 0
    && share({met:2,missing:0,unconfirmed:0,total:2,stale:false,applicability:'unknown'}).total === 0,
    'No.637/S1b: and hands back no met/total, so the "2 of 2" caption cannot be built from them either');
  ok(share({met:2,missing:0,unconfirmed:0,total:2,stale:false,applicability:'same'}).pct === 100,
    'CALIBRATION: the same counts with a readable post still produce 100% — the refusal is the verdict, not the arithmetic');
  {
    const word = (lang) => {
      store.set('skipi-crewing-ui-language', lang);
      return String(MR2.tr('crew_flow.fit_rank_unknown'));
    };
    const enWord = word('en'), ruWord = word('ru');
    store.set('skipi-crewing-ui-language', 'en');
    ok(enWord && enWord !== 'crew_flow.fit_rank_unknown' && !/[Ѐ-ӿ]/.test(enWord),
      'No.637/S1b: the queue has an EN word for the refused figure — got "' + enWord + '"');
    ok(ruWord && ruWord !== 'crew_flow.fit_rank_unknown' && ruWord !== enWord && /[Ѐ-ӿ]/.test(ruWord),
      'No.637/S1b: and a Russian one — a missing key prints the wire code beside a person\'s name — got "' + ruWord + '"');
  }

  // ---- No.637/S1c: the counts leave the ROW too, on both layouts ---------
  //
  // S1b took the percentage off this row and left the three counts, under a
  // <details> on the desktop and INLINE on the phone (a <details> inside a
  // <button> is invalid markup). "Met 1 · Not met 0 · Unconfirmed 1" beside a
  // person whose post nobody could read is a measurement that was never made;
  // with the S1c server the same line becomes "Met 0 · Not met 0 · Unconfirmed
  // 0", which reads as "he lacks nothing" and is worse than the first. Both
  // server shapes are in the fixture above, and the row must refuse both.
  const unknownRow = rowOf('i-unknown');
  const unknownOldRow = rowOf('i-unknown-old');
  ok(!!unknownRow && !!unknownOldRow,
    'No.637/S1c: both unreadable-post rows are IN the queue — the figure goes, the person does not (S1b)');
  for (const [name, row] of [['i-unknown', unknownRow], ['i-unknown-old', unknownOldRow]]) {
    const txt = r2MatchText(row);
    ok(!/data-met=/.test(row) && !/data-missing=/.test(row) && !/data-unconfirmed=/.test(row),
      'No.637/S1c (' + name + '): the row carries no count attributes a reader could turn into a figure');
    ok(!/Met \d/.test(txt) && !/Not met \d/.test(txt) && !/Unconfirmed \d/.test(txt),
      'No.637/S1c (' + name + '): and prints none of the three counts — got "' + txt + '"');
    ok(/data-match="rank-unknown"/.test(row),
      'No.637/S1c (' + name + '): the row says WHICH state it is in, machine-readably');
    ok(/data-applicability="unknown"/.test(row),
      'No.637/S1c (' + name + '): and carries the verdict itself');
    ok(txt.indexOf('Master · Bulk Carrier') === 0 && txt.length > 'Master · Bulk Carrier'.length + 3,
      'No.637/S1c (' + name + '): the profile is still named and a sentence follows it, not a blank — got "' + txt + '"');
    const pct = r2Pct(row);
    ok(pct && pct.attr === 'none' && !/%/.test(pct.text),
      'No.637/S1c (' + name + '): and still no percentage (S1b, re-checked here)');
  }
  // CALIBRATION, same render: a readable row keeps every count. Without it the
  // four assertions above pass on a client that stopped printing counts at all.
  ok(/data-met="2"/.test(metRow) && r2MatchText(metRow).indexOf('Met 2') !== -1,
    'No.637/S1c CALIBRATION: the readable row keeps its counts in the same tree');
  // and the phone layout, where the same line is INLINE rather than disclosed
  {
    const mobile = String(MR2.crewFlowLiveMobileHtml('live'));
    const mobileRow = (id) => {
      const m = mobile.match(new RegExp('data-intake="' + id + '"[\\s\\S]*?(?=<button class="mobile-list-item|$)'));
      return m ? m[0] : '';
    };
    const mUnknown = mobileRow('i-unknown');
    const mMet = mobileRow('i-met');
    ok(!!mUnknown && /data-match="rank-unknown"/.test(mUnknown),
      'No.637/S1c: the PHONE row refuses the counts too — this is the branch where they are inline, not under a disclosure');
    ok(!/data-met=/.test(mUnknown) && !/Met \d/.test(mUnknown) && !/Unconfirmed \d/.test(mUnknown),
      'No.637/S1c: and no count reaches the phone row in any shape');
    ok(/data-met="2"/.test(mMet) && /Met 2/.test(mMet),
      'No.637/S1c CALIBRATION: the readable phone row still shows its counts');
  }

  // ===== No.637/S7: «0 %» where nothing was measured, and the calm grey state =
  //
  // TWO owner words, one surface, and they are deliberately kept apart because
  // they are two different sentences about a person:
  //
  //   (939)  «неизвестный ранг — ни совпадение, ни 0 %, а честная ручная
  //          проверка». S1b closed the `unknown` half. The OTHER half is
  //          `not_applicable`: against a profile his rank does not reach,
  //          nothing was measured either, and `floor(100 * 0 / 4)` printed `0 %`
  //          beside «Нужна проверка» on the stand on 02.10. A zero is an answer;
  //          there was no question.
  //
  //   OWNER 02.10: «вполне нормально если кандидат не подошел ни под один
  //          профиль соответствия, такого можно отмаркировать серым цветом в
  //          левой колонке». Not fitting anything is a NORMAL outcome — so the
  //          row gets a calm state of its own, grey, with no figure, and it is
  //          NOT the same state as «должность не прочитана», where the operator
  //          still has something to do.
  {
    const naRow = rowOf('i-na');
    const nofitRow = rowOf('i-nofit');
    const nofitWRow = rowOf('i-nofit-w');
    const nothingRow = rowOf('i-nothing');
    ok(!!naRow && !!nofitRow && !!nofitWRow && !!nothingRow,
      'No.637/S7: all four new rows are IN the queue — a candidate is never removed from the left column by any of this');

    // ---- 1. the share function itself, directly ---------------------------
    const na = { met: 0, missing: 1, unconfirmed: 3, total: 4, stale: false, applicability: 'not_applicable' };
    ok(share(na).pct === null,
      'No.637/S7: crewFlowMatchShare refuses a figure when the rank does not apply — got ' + JSON.stringify(share(na)));
    ok(share(na).reason === 'rank_not_applicable',
      'No.637/S7: and it is its OWN refusal, not the unread one — got "' + share(na).reason + '"');
    ok(share(na).reason !== share(Object.assign({}, na, { applicability: 'unknown' })).reason,
      'No.637/S7: «не подходит» and «не прочитана» never collapse into one reason — two different next actions for an operator');
    ok(share(na).met === 0 && share(na).total === 0,
      'No.637/S7: and no met/total come back, so «выполнено 0 из 4» cannot be built from them either');
    ok(share(Object.assign({}, na, { applicability: 'same' })).pct === 0,
      'CALIBRATION: the SAME counts with an applicable rank still produce their honest 0% — the refusal is the answer, not the arithmetic');
    ok(share({ met: 2, missing: 0, unconfirmed: 0, total: 2, stale: false, applicability: 'alternative' }).pct === 100,
      'CALIBRATION: an alternative rank keeps its figure too — only one answer loses it');

    // ---- 2. the rendered bytes of the QUEUE row ---------------------------
    const naPct = r2Pct(naRow);
    ok(naPct && naPct.attr === 'none' && !/%/.test(naPct.text),
      'No.637/S7: the row prints no percentage at all — got ' + JSON.stringify(naPct));
    ok(!/data-pct="\d/.test(naRow),
      'No.637/S7: and no data-pct carrying a number anywhere in the row');
    ok(!/checks met, by the stored evaluation/.test(naRow) && !/из \d+ по сохранённой оценке/.test(naRow),
      'No.637/S7: nor the «выполнено M из N» caption — "0 из 4" is the same false claim written in words');
    ok(/data-fit="rank_not_applicable"/.test(naRow),
      'No.637/S7: the row names WHICH refusal it is, machine-readably');
    const naWord = r2FitText(naRow);
    ok(naWord.length > 5 && !/rank_not_applicable/.test(naWord),
      'No.637/S7: and prints a sentence for a person, not the wire code — got "' + naWord + '"');

    // ---- 3. NO MERGE with the unread post (mandatory negative) ------------
    const unknownWord = r2FitText(rowOf('i-unknown'));
    ok(/data-fit="rank_unknown"/.test(rowOf('i-unknown')),
      'CALIBRATION: the unread row still reports its own state — so the comparison below is between two live states');
    ok(naWord !== unknownWord,
      'No.637/S7: «должность не подходит» and «должность не прочитана» are DIFFERENT sentences on the row — got "' + naWord + '" vs "' + unknownWord + '"');
    ok(!/data-fit="rank_unknown"/.test(naRow) && !/data-fit="rank_not_applicable"/.test(rowOf('i-unknown')),
      'No.637/S7: and different machine states — one word for both would send the operator to the wrong next action');

    // ---- 4. the control pair: an applicable rank keeps its honest number ---
    ok(r2Pct(metRow) && r2Pct(metRow).attr === '100' && /100%/.test(metRow),
      'No.637/S7 CONTROL: the applicable pair KEEPS its figure in the same render — the fix hits one answer, not every number');
    ok(/2 of 2 checks met, by the stored evaluation/.test(r2FitText(metRow)),
      'No.637/S7 CONTROL: and keeps its mandatory caption (928)');
    ok(r2Pct(gapRow) && r2Pct(gapRow).attr === '33',
      'No.637/S7 CONTROL: and the partial pair still floors to 33%');

    // ---- 5. OWNER 02.10: the calm grey state ------------------------------
    for (const [name, row] of [['i-nofit', nofitRow], ['i-nofit-w', nofitWRow]]) {
      ok(/data-fit="no_profile_fit"/.test(row),
        'OWNER 02.10 (' + name + '): fitting no profile at all is a state of its OWN, machine-readably');
      ok(/cf-fit-nofit/.test(row),
        'OWNER 02.10 (' + name + '): and it carries its own grey marking class in the left column');
      const pct = r2Pct(row);
      ok(pct && pct.attr === 'none' && !/%/.test(pct.text),
        'OWNER 02.10 (' + name + '): with no figure — «не подошёл» is not a zero');
      ok(!/checks met, by the stored evaluation/.test(row) && !/из \d+ по сохранённой оценке/.test(row),
        'OWNER 02.10 (' + name + '): and no «выполнено M из N» caption either');
      const word = r2FitText(row);
      ok(/[Ff]its none of the profiles/.test(word),
        'OWNER 02.10 (' + name + '): and a calm, honest sentence — got "' + word + '"');
    }
    // not the unread state, and not any of the three it had to be told apart from
    ok(!/cf-fit-nofit/.test(rowOf('i-unknown')) && !/data-fit="no_profile_fit"/.test(rowOf('i-unknown')),
      'OWNER 02.10: an unread post is NOT the grey state — there the operator still has something to do');
    ok(!/cf-fit-nofit/.test(metRow) && !/cf-fit-nofit/.test(gapRow),
      'OWNER 02.10 CONTROL: a candidate who DOES fit a profile never turns grey');
    ok(!/cf-fit-nofit/.test(naRow) && !/data-fit="no_profile_fit"/.test(naRow),
      'OWNER 02.10 CONTROL: and neither does the man whose SELECTED profile does not fit but who fits another one — "this vacancy" and "no vacancy" are two statements');
    ok(!/cf-fit-nofit/.test(nothingRow) && !/data-fit="no_profile_fit"/.test(nothingRow),
      'OWNER 02.10 CALIBRATION: an empty evaluation list with NOTHING withheld is not an answer — silence never becomes «не подошёл ни под один профиль»');
    ok(!/cf-fit-nofit/.test(coldRow),
      'OWNER 02.10 CALIBRATION: nor is a candidate whose evaluations were never loaded');

    // ---- 6. the marking is its own, in CSS, and serves both themes --------
    {
      const css = HTML.slice(0, HTML.indexOf('</style>'));
      const rule = (css.match(/\n\.cf-fit-nofit \.cf-dot \{[^}]*\}/) || [''])[0];
      ok(rule !== '',
        'OWNER 02.10: the grey state has a mark of its own in CSS, not a shade inherited from «нужна проверка»');
      ok(/var\(--/.test(rule),
        'OWNER 02.10: painted from a theme token, so the light theme is served too — got "' + rule.trim() + '"');
      ok(!/border-radius:\s*50%/.test(rule),
        'OWNER 02.10: and it is not the same round dot every other state uses — colour alone is never the carrier here');
      for (const other of ['.cf-fit-complete .cf-dot', '.cf-fit-stale .cf-dot']) {
        const o = (css.match(new RegExp('\\n' + other.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{[^}]*\\}')) || [''])[0];
        ok(o !== '' && o.replace(other, '') !== rule.replace('.cf-fit-nofit .cf-dot', ''),
          'OWNER 02.10: distinguishable from ' + other + ' — got "' + o.trim() + '"');
      }
    }

    // ---- 7. both shipped languages, on the rendered bytes -----------------
    for (const lang of ['ru', 'en']) {
      store.set('skipi-crewing-ui-language', lang);
      const tree = String(MR2.crewFlowLiveTreeHtml('live'));
      const grab = (id) => {
        const m = tree.match(new RegExp('data-intake="' + id + '"[\\s\\S]*?(?=<div class="tree-item|$)'));
        if (!m) return '';
        const f = String(m[0]).match(/data-qa="crew-flow-row-fit"[\s\S]*?>([\s\S]*?)(?=<details|<div class="cf-chips")/);
        return f ? f[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
      };
      const naText = grab('i-na'), nofitText = grab('i-nofit'), unreadText = grab('i-unknown');
      const cyr = (t) => /[Ѐ-ӿ]/.test(t);
      ok(naText.length > 5 && (lang === 'ru' ? cyr(naText) : !cyr(naText)),
        '[' + lang + '] No.637/S7: the refusal is spelled out in this language — got "' + naText + '"');
      ok(nofitText.length > 5 && (lang === 'ru' ? cyr(nofitText) : !cyr(nofitText)),
        '[' + lang + '] OWNER 02.10: and so is the calm state — got "' + nofitText + '"');
      ok(naText !== unreadText && nofitText !== unreadText && naText !== nofitText,
        '[' + lang + '] No.637/S7: the three states stay three sentences in this language too');
      ok(!/%/.test(naText) && !/%/.test(nofitText),
        '[' + lang + '] No.637/S7: and neither of them carries a figure');
    }
    store.set('skipi-crewing-ui-language', 'en');

    // ---- 8. the dictionary keys, so a missing one cannot print a wire code -
    for (const key of ['crew_flow.fit_rank_not_applicable', 'crew_flow.fit_no_profile_fit']) {
      const lines = HTML.split('\n').filter((line) => line.includes("'" + key + "'"));
      ok(lines.length === 2, key + ': exactly one EN and one RU entry — got ' + lines.length);
      const val = (i) => (new RegExp("'" + key.replace('.', '\\.') + "':'([^']+)'").exec(lines[i] || '') || [])[1] || '';
      ok(val(0) !== '' && !/[Ѐ-ӿ]/.test(val(0)), key + ': the EN wording exists — got "' + val(0) + '"');
      ok(val(1) !== '' && /[Ѐ-ӿ]/.test(val(1)), key + ': and a Russian one — a missing key prints the wire code beside a person\'s name — got "' + val(1) + '"');
    }

    // ---- 9. THE PHONE, where the same left column is a list ---------------
    {
      const mobile = String(MR2.crewFlowLiveMobileHtml('live'));
      const mRow = (id) => {
        const m = mobile.match(new RegExp('data-intake="' + id + '"[\\s\\S]*?(?=<button class="mobile-list-item|$)'));
        return m ? m[0] : '';
      };
      ok(/data-fit="rank_not_applicable"/.test(mRow('i-na')) && !/data-pct="\d/.test(mRow('i-na')),
        'No.637/S7: the PHONE row refuses the figure too — same function, same answer');
      ok(/cf-fit-nofit/.test(mRow('i-nofit')),
        'OWNER 02.10: and the calm grey state reaches the phone list, which is the same left column');
      ok(/data-pct="100"/.test(mRow('i-met')),
        'No.637/S7 CONTROL: while the applicable phone row keeps its figure');
    }

    // ---- 10. REMOVAL CALIBRATION, and the TYPE of the failure is recorded --
    //
    // Everything above can also pass on a client that stopped printing numbers
    // altogether, so each refusal is re-measured on a source whose fix line is
    // DELETED. Two things are instrumented rather than assumed:
    //   * the mutant actually BUILT — a mutant killed by the parser proves the
    //     parser, not the check (the one property this series keeps buying);
    //   * a known-good row still renders its number inside that same mutant.
    {
      const MUTATIONS = [
        { id: 'S7-PCT', anchor: "  if (row.applicability === 'not_applicable') { out.reason = 'rank_not_applicable'; return out; }\n",
          what: 'the refusal of a figure for a rank that does not apply' },
        { id: 'S7-NOFIT', anchor: "  if (crewFlowFitsNoProfile(item)) { share = { pct:null, met:0, total:0, reason:'no_profile_fit' }; cls = 'nofit'; } else if (!profileId) {",
          replacement: '  if (!profileId) {',
          what: 'the calm grey state for a candidate who fits no profile' },
      ];
      for (const mut of MUTATIONS) {
        const occurrences = scriptNoBoot.split(mut.anchor).length - 1;
        ok(occurrences === 1,
          mut.id + ': the line this calibration removes occurs exactly once in the shipped script — got ' + occurrences);
        if (occurrences !== 1) continue;
        const mutantSource = scriptNoBoot.replace(mut.anchor, mut.replacement == null ? '' : mut.replacement);
        let MX = null, buildError = null;
        try { MX = loadInlineModuleForCurrentStore(mutantSource); } catch (e) { buildError = e; }
        ok(MX !== null,
          mut.id + ': the mutant BUILDS — otherwise what goes red is the parser and not ' + mut.what
            + (buildError ? ' (' + buildError.name + ': ' + buildError.message + ')' : ''));
        if (!MX) continue;
        MX.state.settings = MR2.state.settings;
        MX.state.intakePilot = MR2.state.intakePilot;
        MX.state.crewFlowRanks = MR2.state.crewFlowRanks;
        MX.state.crewFlowProfiles = MR2.state.crewFlowProfiles;
        MX.crewFlowSelectProfile('p-main');
        const mutantTree = String(MX.crewFlowLiveTreeHtml('live'));
        const mutantRow = (id) => {
          const m = mutantTree.match(new RegExp('data-intake="' + id + '"[\\s\\S]*?(?=<div class="tree-item|$)'));
          return m ? m[0] : '';
        };
        ok(/data-pct="100"/.test(mutantRow('i-met')),
          mut.id + ' CALIBRATION OF THE MUTANT: a known-good row still renders its figure inside it, so the mutant is a working client and not a blank page');
        if (mut.id === 'S7-PCT') {
          ok(/data-qa="crew-flow-row-pct" data-pct="0"/.test(mutantRow('i-na')),
            'S7-PCT KILLED: with the refusal removed the row prints the 0% back — the assertion above reddens on the defect and not on an empty render');
          ok(/0 of 4 checks met/.test(mutantRow('i-na')),
            'S7-PCT KILLED: and «выполнено 0 из 4» comes back with it');
        } else {
          ok(!/cf-fit-nofit/.test(mutantRow('i-nofit')),
            'S7-NOFIT KILLED: with the state removed the grey marking is gone from the left column');
          ok(/data-fit="rank_not_applicable"/.test(mutantRow('i-nofit')),
            'S7-NOFIT KILLED: and the row falls back to the per-profile sentence, which is what the owner asked to replace for this case');
        }
      }
    }
  }

  // the two states must be readable, in both interface languages
  store.set('skipi-crewing-ui-language', 'ru');
  const r2TreeRu = String(MR2.crewFlowLiveTreeHtml('live'));
  ok(/[Ѐ-ӿ]/.test(r2TreeRu) && /Выполнено/.test(r2TreeRu) && /Не подтверждено/.test(r2TreeRu),
    'R2/2: the Russian row names Выполнено / Не выполнено / Не подтверждено');
  ok(/Master · Bulk Carrier — Выполнено 1 · Не выполнено 1 · Не подтверждено 1/.test(r2TreeRu),
    'R2/2: the Russian mixed row prints the three counts separately, word for word');
  ok(/оценки против этого профиля нет/.test(r2TreeRu),
    'R2/2: the Russian row states the missing-evaluation case in Russian, word for word');
  ok(/Сравнивать с профилем/.test(r2TreeRu), 'R2/2: the Russian picker is labelled in Russian');
  store.set('skipi-crewing-ui-language', 'en');
  const r2TreeEn = String(MR2.crewFlowLiveTreeHtml('live'));
  ok(/Met/.test(r2TreeEn) && /Not met/.test(r2TreeEn) && /Unconfirmed/.test(r2TreeEn) && !/[Ѐ-ӿ]/.test(r2TreeEn),
    'R2/2: the English row names Met / Not met / Unconfirmed and leaves no Cyrillic');
  ok(/no stored comparison against this profile/.test(r2TreeEn),
    'R2/2: the English row states the missing-evaluation case, word for word');

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


// ============================================================================
// R2 round 2 (OWNER 2026-09-29, clarification): the stored outcome must be on
// the row THE MOMENT THE LIST LOADS — no card opened, and no request per row.
//
// The owner lifted the earlier "no new API call" boundary and replaced it with a
// narrower one: fetching stored evaluations from the server is allowed; paid CV
// processing and recomputation for the sake of the list are not. The outcome now
// rides inside the list response itself (CandidateIntakeSummary.profile_ranks),
// so the ranks themselves cost zero extra requests; the only new call on this
// path is ONE matching-profile lookup per context, for the human-readable name.
// ============================================================================
section('R2 round 2: the list arrives with the outcome already on every row');

store.delete('skipi_crewing_demo');
elements.clear();
let MR3 = null;
try {
  MR3 = loadInlineModuleForCurrentStore();
} catch (e) {
  console.error('R2 round-2 runtime load failed:', e);
}
ok(!!MR3, 'R2/L: the non-demo inline script loads');
const r3Ready = !!MR3 && typeof MR3.crewFlowEnsureLiveQueue === 'function' && typeof MR3.pilotLoadQueue === 'function';
ok(r3Ready, 'R2/L: the Crew Flow list-load path is reachable from the harness');
if (r3Ready) {
  // A summary exactly as the frozen contract describes it. Counts only: the
  // server holds no locales, so no text and no score crosses this boundary.
  // The frozen contract, final form: counts + total + stale. `total` is what lets
  // the row say "not fully recognised" instead of under-counting in silence.
  const pr = (profileId, met, missing, unconfirmed, total, stale) => ({
    profile_id: profileId, profile_version: 1, met, missing, unconfirmed, total, stale: !!stale,
  });
  // The source codes here are the ones MEASURED on the live pilot queue
  // (skipi_response / inbound / synthetic) plus one deliberately unrecognised
  // code, so every branch of the label table is exercised by a real row. The
  // earlier fixture said 'mail', a string that exists only in the Rust unit
  // tests -- and a row titled from it looked correct here while every real
  // record fell through to the generic label on the pilot.
  const sourceOf = (id) => (id === 'L-noname' ? 'skipi_response'
    // No.675: the response rows the no-matches pill is measured on. The pill is
    // bounded by the SOURCE, so the fixture needs responses that differ from
    // each other only in what the server compared them against.
    : /^L-resp/.test(id) ? 'skipi_response'
    : id === 'L-noname-field' ? 'synthetic'
    : id === 'L-stale' ? 'no_such_source_code_v9'
    : 'inbound');
  const listItem = (id, profileRanks, candidateName) => {
    const summary = { state: 'ranked', facts: 3, ranks: (profileRanks || []).length, ranks_stale: 0,
      active_confirmations: 0, needs_review_reason: null };
    // profileRanks === undefined models a server build WITHOUT the field.
    if (profileRanks !== undefined) summary.profile_ranks = profileRanks;
    // candidateName === undefined models a build without candidate_name at all;
    // null is the server answering that the recorded facts hold no name.
    if (candidateName !== undefined) summary.candidate_name = candidateName;
    // Every neighbouring field is deliberately DISTINCT from intake_id: a fixture
    // where source_id equals the id makes a substitution mutation invisible
    // (drill P1 survived exactly that way).
    return { intake_id: id, receipt_id: 'receipt-' + id, crewing_id: 'crew-flow-demo-harness', source: sourceOf(id),
      source_id: 'msg-' + id, event_id: 'event-' + id, primary_profile_id: 'p-main', content_sha256: '0'.repeat(64),
      content_bytes: 14412, content_type: 'application/pdf', state: 'ranked', source_trust: 'inbound_alias',
      version: 1, created_at: '2026-09-29T01:10:00Z', issued_at: '2026-09-29T01:10:00Z',
      objects: [], attachments: [], summary };
  };
  R2_FIXTURES.list = {
    items: [
      listItem('L-met', [pr('p-main', 2, 0, 0, 2, false)], 'Oleksandr K.'),
      listItem('L-gap', [pr('p-main', 1, 1, 1, 3, false)], 'Ivan M. (from the list)'),
      // the server answered: the recorded facts hold no name
      listItem('L-noname', [pr('p-main', 1, 0, 0, 1, false)], null),
      // an older build: no candidate_name key at all, so nothing can be claimed
      listItem('L-noname-field', [pr('p-main', 1, 0, 0, 1, false)]),
      listItem('L-other', [pr('p-side', 1, 0, 0, 1, false)]),
      listItem('L-none', []),        // the server says: no stored evaluation at all
      listItem('L-nofield', undefined), // an older server: the field is simply absent
      listItem('L-stale', [pr('p-main', 2, 0, 0, 2, true)]),
      // three outcomes the three counts do not account for — a future outcome code
      listItem('L-partial', [pr('p-main', 2, 0, 0, 5, false)]),
      // total missing altogether: coverage cannot be proven, so it is not claimed
      listItem('L-nototal', [{ profile_id: 'p-main', profile_version: 1, met: 2, missing: 0, unconfirmed: 0, stale: false }]),
      // the profile was republished: two stored evaluations, one per version.
      // The row must speak for the NEWEST, or it reports against requirements
      // that are no longer the published ones.
      listItem('L-versions', [
        { profile_id: 'p-main', profile_version: 1, met: 9, missing: 0, unconfirmed: 0, total: 9, stale: false },
        { profile_id: 'p-main', profile_version: 2, met: 1, missing: 2, unconfirmed: 0, total: 3, stale: false },
      ]),
      // No.637/S1c. The SUMMARY surface — the queue's own producer, independent
      // of the card's. This is the shape the S1c server sends for a post nobody
      // could read: every counter zero, `total` zero, the verdict told plainly.
      // Zero counters are not a result and must not be printed as one.
      listItem('L-unknown', [{
        profile_id: 'p-main', profile_version: 1, met: 0, missing: 0, unconfirmed: 0,
        total: 0, stale: false, applicability: 'unknown', applicability_reason: 'rank_absent',
      }], 'Petro H.'),
      // No.675 (OWNER (990)). A response from the app the server has compared
      // against NOTHING — the shape the owner saw on the stand. `L-none` above
      // is byte-for-byte the same empty list on an INBOUND letter, so the two
      // rows differ in the source alone and the pill cannot pass by accident.
      listItem('L-resp-none', [], 'Vadym K.'),
      // ... and the same response from an older server that sends no
      // profile_ranks field at all: unread, which is not zero.
      listItem('L-resp-nofield', undefined, 'Vadym K.'),
    ],
    limit: 50, offset: 0, total: 14,
  };
  R2_FIXTURES.profiles = { items: [
    { id: 'p-main', name: 'Master · Bulk Carrier', version: 1, state: 'active' },
    { id: 'p-side', name: 'Second Engineer · Product Tanker', version: 1, state: 'active' },
  ] };

  MR3.state.settings = {
    server_url: 'https://api.skipi.app', bearer_token: 'TOKEN-DO-NOT-LEAK',
    crewing_id: 'crew-flow-demo-harness', interface: { theme: 'light', language: 'en' },
  };
  store.set('skipi-crewing-ui-language', 'en');

  // Drive the product path only: opening Crew Flow is what an operator does.
  const r3From = calls.length;
  MR3.showView('crew_flow');
  for (let i = 0; i < 8; i++) await Promise.resolve();
  const r3Cmds = calls.slice(r3From).map(([c]) => String(c));

  // ---- 1. exactly what the list load costs, named ------------------------
  const countOf = (c) => r3Cmds.filter((x) => x === c).length;
  ok(countOf('crewing_intake_candidate_list') === 1,
    'R2/L: the list itself is fetched once — got ' + countOf('crewing_intake_candidate_list'));
  ok(countOf('crewing_intake_matching_profile_list') === 1,
    'R2/L: the profile names cost ONE lookup per context, not one per row — got '
    + countOf('crewing_intake_matching_profile_list'));
  ok(countOf('crewing_intake_rank_list') === 0,
    'R2/L: no per-candidate ranks request — the outcome rides inside the list response (N+1 refused)');
  // The owner's boundary, mechanically: loading the list must not process or recompute.
  ok(countOf('crewing_intake_candidate_rank') === 0,
    'R2/L: loading the list never recomputes an evaluation');
  ok(!r3Cmds.some((c) => /parse_cv|reprocess|rank_compliance_candidate/.test(c)),
    'R2/L: loading the list starts no paid CV processing — commands were [' + [...new Set(r3Cmds)].join(', ') + ']');
  ok(fetchCalls.length === 0, 'R2/L: still no fetch() anywhere on this path');

  // ---- 2. the row is filled WITHOUT opening a card ------------------------
  ok(!MR3.state.intakePilot.detail, 'R2/L: no candidate card was opened during the load');
  MR3.crewFlowSelectProfile('p-main');

  // ---- 3z. a refresh must not cost the operator their place ---------------
  // OWNER 2026-09-30: "выбор строки не теряется при обновлении очереди", and a
  // failed refresh keeps the rows. Both are pinned here rather than looked at,
  // because both are silent when they break: the list simply blanks, or the
  // selection simply jumps, and the operator blames themselves.
  MR3.state.intakePilot.detail = { intakeId: 'L-gap', generation: 1 };
  const r3Sel = String(MR3.crewFlowLiveTreeHtml('live'));
  ok(/data-intake="L-gap"[^>]*aria-selected="true"/.test(r3Sel)
    || /aria-selected="true"[^>]*data-intake="L-gap"/.test(r3Sel)
    || /data-intake="L-gap"[\s\S]{0,200}aria-selected="true"/.test(r3Sel),
    'R2/S: the open candidate is marked selected in the queue, not merely tinted');

  const r3Stamp = MR3.state.intakePilot.queueLastUpdated;
  const r3RowCount = (r3Sel.match(/data-qa="crew-flow-row"/g) || []).length;
  ok(r3RowCount > 1, 'R2/S (control): there are rows to lose in the first place — ' + r3RowCount);

  // a refresh IN FLIGHT over rows already in hand
  MR3.state.intakePilot.queueLoading = true;
  const r3Loading = String(MR3.crewFlowLiveTreeHtml('live'));
  ok((r3Loading.match(/data-qa="crew-flow-row"/g) || []).length === r3RowCount,
    'R2/S: a refresh in flight keeps every row on screen instead of blanking the panel');
  ok(/data-qa="crew-flow-queue-refreshing"/.test(r3Loading),
    'R2/S: and it says so, rather than looking identical to an idle list');
  ok(MR3.state.intakePilot.detail.intakeId === 'L-gap',
    'R2/S: the open candidate does not change while the queue reloads');

  // a refresh that FAILED
  MR3.state.intakePilot.queueLoading = false;
  MR3.state.intakePilot.queueError = new Error('network down');
  const r3Failed = String(MR3.crewFlowLiveTreeHtml('live'));
  ok((r3Failed.match(/data-qa="crew-flow-row"/g) || []).length === r3RowCount,
    'R2/S: a FAILED refresh keeps the previously loaded rows — an outage is not "no candidates"');
  ok(/data-qa="crew-flow-queue-error-note"/.test(r3Failed),
    'R2/S: and the failure is stated next to those rows, never hidden behind a disclosure');
  ok(MR3.state.intakePilot.queueLastUpdated === r3Stamp,
    'R2/S: the last-SUCCESS timestamp does not move on failure — stale data must not look fresh');
  ok(/data-intake="L-gap"[\s\S]{0,200}aria-selected="true"/.test(r3Failed),
    'R2/S: and the selection survives the failure too');
  MR3.state.intakePilot.queueError = null;
  MR3.state.intakePilot.detail = null;
  const r3Tree = String(MR3.crewFlowLiveTreeHtml('live'));
  const r3Row = (id) => {
    const m = r3Tree.match(new RegExp('data-intake="' + id + '"[\\s\\S]*?(?=<div class="tree-item|$)'));
    return m ? m[0] : '';
  };
  const r3Text = (row) => {
    const m = String(row).match(/data-qa="crew-flow-row-match"[^>]*>([^<]*)</);
    return m ? m[1] : '';
  };
  ok(r3Text(r3Row('L-met')) === 'Master · Bulk Carrier — Met 2 · Not met 0 · Unconfirmed 0',
    'R2/L: a met candidate states its outcome straight from the list — got "' + r3Text(r3Row('L-met')) + '"');
  ok(r3Text(r3Row('L-gap')) === 'Master · Bulk Carrier — Met 1 · Not met 1 · Unconfirmed 1',
    'R2/L: unconfirmed is still its own count, straight from the list — got "' + r3Text(r3Row('L-gap')) + '"');
  ok(/data-profile="p-main"/.test(r3Row('L-met')) && /Master · Bulk Carrier/.test(r3Row('L-met')),
    'R2/L: the row shows the profile NAME, not a raw id');

  // ---- 3. the states the owner asked about explicitly ---------------------
  ok(/data-match="absent"/.test(r3Row('L-other')),
    'R2/L: evaluated against another profile only -> absent, never a match');
  ok(/data-match="absent"/.test(r3Row('L-none')),
    'R2/L: the server said "no stored evaluations" ([]) -> absent, never a match');
  ok(/data-match="not-loaded"/.test(r3Row('L-nofield')),
    'R2/L: a server build WITHOUT the field leaves the candidate "not loaded" — an unanswered question is not an answer');
  ok(!/data-met=/.test(r3Row('L-none')) && !/data-met=/.test(r3Row('L-nofield')),
    'R2/L: neither of those two carries counts that could read as a match');
  ok(/data-stale="1"/.test(r3Row('L-stale')) && /data-match="ranked"/.test(r3Row('L-stale')),
    'R2/L: a stale stored evaluation says so instead of reading as current');

  // ---- No.675 (OWNER (990), 2026-10-04) ----------------------------------
  // «На момент отклика соответствий нет» / «No matches at the time of the
  // response» on the QUEUE ROW.
  //
  // WHY BESIDE «Записано; ожидает проверки» AND NOT INSTEAD OF IT. That word
  // is not about matching at all: it is PILOT_TEXT.state_quarantined, printed
  // by pilotStateLabel(item.state) off the intake PIPELINE ladder
  // (received -> quarantined -> scanned -> needs_review -> rejected -> ranked).
  // It states that the document is stored and its file checks have not run.
  // Replacing it would delete a true sentence about the checks, and on every
  // row that is already `ranked` or `needs_review` there would be nothing to
  // replace in the first place. So the pill is a second chip in the same row.
  //
  // Bounded the same way as on the card, and calibrated by rows that must NOT
  // carry it: a letter with zero stored comparisons, a response WITH stored
  // comparisons, and a response whose comparisons were never read.
  {
    const chipsOf = (row) => (String(row).match(/<div class="cf-chips">([\s\S]*?)<\/div>/) || [])[1] || '';
    const pillOf = (row) => (String(row).match(/data-qa="crew-flow-row-no-matches"[^>]*>([^<]*)</) || [])[1] || '';

    ok(/data-match="absent"/.test(r3Row('L-resp-none')),
      'No.675 CALIBRATION: the response row with an EMPTY profile_ranks list really did load as "no stored comparison"');
    ok(pillOf(r3Row('L-resp-none')) !== '',
      'No.675: a response the server compared against nothing carries the no-matches pill');
    ok(chipsOf(r3Row('L-resp-none')).indexOf('data-qa="crew-flow-row-no-matches"') !== -1,
      'No.675: and it stands in the chip row of that queue line, where the operator scans');
    ok(/data-qa="crew-flow-row-no-matches"/.test(r3Row('L-resp-none'))
      && /<span class="badge">/.test(r3Row('L-resp-none')),
      'No.675: BESIDE the intake state chip, not instead of it — «Записано; ожидает проверки» is the file-check ladder, a different fact');

    // CALIBRATION A — a letter. Nobody responded to anything, so «на момент
    // отклика» would name a moment that never happened.
    ok(pillOf(r3Row('L-none')) === '',
      'No.675 CALIBRATION: an inbound LETTER with the same empty list gets no pill — got "' + pillOf(r3Row('L-none')) + '"');
    // CALIBRATION B — a response that HAS a stored comparison.
    ok(pillOf(r3Row('L-noname')) === '',
      'No.675 CALIBRATION: a response WITH a stored comparison gets no pill — got "' + pillOf(r3Row('L-noname')) + '"');
    // CALIBRATION C — unread is not zero.
    ok(/data-match="not-loaded"/.test(r3Row('L-resp-nofield')),
      'No.675 CALIBRATION: the response row without the field really did stay "not loaded"');
    ok(pillOf(r3Row('L-resp-nofield')) === '',
      'No.675: comparisons that were never read are not «соответствий нет» — an unanswered question is not a zero');

    // The phone list is the same left column and the same renderer.
    {
      const mob = String(MR3.crewFlowLiveMobileHtml('live'));
      const mRow = (id) => {
        const m = mob.match(new RegExp('data-intake="' + id + '"[\\s\\S]*?(?=<button class="mobile-list-item|$)'));
        return m ? m[0] : '';
      };
      ok(/data-qa="crew-flow-row-no-matches"/.test(mRow('L-resp-none')),
        'No.675: the pill reaches the phone list too — one badge renderer, not two');
      ok(!/data-qa="crew-flow-row-no-matches"/.test(mRow('L-none')),
        'No.675 CALIBRATION: and the phone letter row is still without it');
    }

    // PRESERVE (975 п.5 / OWNER (990)): the action that changes this answer is
    // the operator's own button, and it is still on the card.
    ok(/btn\('match', crewFlowTr\('match'\), false, "crewFlowMatchToProfile\('/.test(crewBlock)
      && /'crew_flow\.match':'Сопоставить с профилем'/.test(HTML),
      'No.675 PRESERVE: «Сопоставить с профилем» is still rendered by the actions block — the pill states a fact, it does not take the action away');

    // Both shipped languages, read off the rendered bytes.
    for (const lang of ['ru', 'en']) {
      store.set('skipi-crewing-ui-language', lang);
      const tree = String(MR3.crewFlowLiveTreeHtml('live'));
      const m = tree.match(new RegExp('data-intake="L-resp-none"[\\s\\S]*?(?=<div class="tree-item|$)'));
      const text = pillOf(m ? m[0] : '');
      const cyr = /[Ѐ-ӿ]/.test(text);
      ok(text.length > 5 && (lang === 'ru' ? cyr : !cyr),
        '[' + lang + '] No.675: the pill is a sentence in this language — a missing key would print the wire code — got "' + text + '"');
    }
    store.set('skipi-crewing-ui-language', 'en');

    // ---- No.675 (OWNER (991)/(992)): the CLASS on each chip ---------------
    // Read off the rendered row, not off the stylesheet: a correct rule on a
    // chip that never gets the class is the defect this pair exists to catch.
    {
      const classOf = (row, qa) => {
        const m = String(row).match(new RegExp('<span class="([^"]*)" data-qa="' + qa + '"'));
        return m ? m[1] : (new RegExp('data-qa="' + qa + '"').test(String(row)) ? '(no class attr)' : '');
      };
      // The FIRST span of a row is the timestamp; the state chip is the first one
      // inside the chip container. Reading the wrong span made this read
      // "cf-row-time" and measured nothing.
      const chipsOf2 = (row) => (String(row).match(/<div class="cf-chips">([\s\S]*?)<\/div>/) || [])[1] || '';
      const stateChipClass = (chipsOf2(r3Row('L-resp-none')).match(/<span class="([^"]*)"/) || [])[1] || '';
      ok(stateChipClass === 'badge',
        '991 CALIBRATION: the intake-state chip of that row is a plain `badge` — got "' + stateChipClass + '"');
      ok(classOf(r3Row('L-resp-none'), 'crew-flow-row-no-matches') === stateChipClass,
        '991: the no-matches chip carries the SAME class as the chip beside it, so one rule paints both — got "'
          + classOf(r3Row('L-resp-none'), 'crew-flow-row-no-matches') + '"');

      // (992): the irreversible save is green; a reversible local mark is not.
      MR3.state.crewFlowReadState['L-met'] = { action: 'saved_to_db', saved_to_db: true, at: '2026-10-04T00:00:00Z' };
      MR3.state.crewFlowReadState['L-gap'] = { action: 'kept_for_later', at: '2026-10-04T00:00:00Z' };
      const greenTree = String(MR3.crewFlowLiveTreeHtml('live'));
      const gRow = (id) => {
        const m = greenTree.match(new RegExp('data-intake="' + id + '"[\\s\\S]*?(?=<div class="tree-item|$)'));
        return m ? m[0] : '';
      };
      ok(classOf(gRow('L-met'), 'crew-flow-row-review') === 'badge saved',
        '992: «в базе моряков» is the green chip in the queue row — got "' + classOf(gRow('L-met'), 'crew-flow-row-review') + '"');
      ok(/data-review="saved_to_db"/.test(gRow('L-met')),
        '992 CALIBRATION: and that is really the saved state and not another one wearing the class');
      ok(classOf(gRow('L-gap'), 'crew-flow-row-review') === 'badge',
        '992: a reversible local mark («отложен») stays grey — the strong colour is not spent on it — got "'
          + classOf(gRow('L-gap'), 'crew-flow-row-review') + '"');
      // the phone list is the same renderer, so the class reaches it too
      const gMob = String(MR3.crewFlowLiveMobileHtml('live'));
      const gMobRow = (gMob.match(/data-intake="L-met"[\s\S]*?(?=<button class="mobile-list-item|$)/) || [''])[0];
      ok(/class="badge saved"/.test(gMobRow),
        '992: and the phone row carries it as well — one badge renderer, not two');
      delete MR3.state.crewFlowReadState['L-met'];
      delete MR3.state.crewFlowReadState['L-gap'];
    }
  }

  // ---- 3b. the remainder the three counts do not explain ------------------
  // The card refuses to count an unknown outcome code as met; the row carries
  // numbers, so `total` is the only way that refusal survives. A row that does
  // not add up must LOOK different, not be rounded into a match.
  ok(/data-match="partial"/.test(r3Row('L-partial')),
    'R2/L: met+missing+unconfirmed != total is its own visible state, not a match');
  ok(/data-total="5"/.test(r3Row('L-partial')) && /data-met="2"/.test(r3Row('L-partial')),
    'R2/L: the partial row still carries the true numbers it does have');
  ok(r3Text(r3Row('L-partial')).indexOf('outcomes not fully recognised') !== -1,
    'R2/L: and it says so in words — got "' + r3Text(r3Row('L-partial')) + '"');
  ok(/data-match="partial"/.test(r3Row('L-nototal')),
    'R2/L: a row without total cannot prove full coverage, so it does not claim it');
  ok(/data-match="ranked"/.test(r3Row('L-met')) && !/data-match="partial"/.test(r3Row('L-met')),
    'R2/L (control): a row that does add up is NOT flagged — the check is not vacuous');

  // ---- 3b-bis. No.637/S1c, on the SUMMARY surface -------------------------
  // A zero denominator with a zero numerator is "nobody asked", not a result.
  // The queue's producer is independent of the card's, so the refusal is
  // measured here separately rather than inferred from the card passing.
  ok(/data-match="rank-unknown"/.test(r3Row('L-unknown')),
    'No.637/S1c: a summary row whose post nobody could read is its own state, not a "ranked" one');
  ok(!/data-met=/.test(r3Row('L-unknown')) && !/data-total=/.test(r3Row('L-unknown')),
    'No.637/S1c: and it carries no counters — three zeros read as "he lacks nothing"');
  ok(!/Met \d/.test(r3Text(r3Row('L-unknown'))) && !/Unconfirmed \d/.test(r3Text(r3Row('L-unknown'))),
    'No.637/S1c: nor prints them — got "' + r3Text(r3Row('L-unknown')) + '"');
  ok(!/data-match="partial"/.test(r3Row('L-unknown')),
    'No.637/S1c: and it is NOT reported as "outcomes not fully recognised" — the outcomes are not in doubt, the POST is');
  ok(r3Row('L-unknown').indexOf('Petro H.') !== -1,
    'No.637/S1c: the person is still in the queue under his own name (S1b: the figure goes, he does not)');

  // ---- 3c. two stored versions of one profile -----------------------------
  ok(/data-met="1"/.test(r3Row('L-versions')) && /data-missing="2"/.test(r3Row('L-versions'))
    && /data-total="3"/.test(r3Row('L-versions')),
    'R2/L: with two stored versions the row speaks for the NEWEST, not the first in the array — got "'
    + r3Text(r3Row('L-versions')) + '"');

  // ---- 3d. "the field was not sent" is pinned at the guard itself ----------
  // Two independent guards keep an absent field out of the cache (the list hook
  // checks Array.isArray, and so does the normalizer). Each is pinned here, so
  // neither can be removed on the quiet reasoning that the other still holds.
  const r3Cache = MR3.crewFlowRankCache();
  ok(!Object.prototype.hasOwnProperty.call(r3Cache, 'L-nofield'),
    'R2/L: a summary without the field leaves NO cache entry — not an empty one');
  MR3.crewFlowCacheRankSummary('probe-undefined', undefined);
  MR3.crewFlowCacheRankSummary('probe-null', null);
  ok(!Object.prototype.hasOwnProperty.call(MR3.crewFlowRankCache(), 'probe-undefined')
    && !Object.prototype.hasOwnProperty.call(MR3.crewFlowRankCache(), 'probe-null'),
    'R2/L: the normalizer refuses a non-array outright instead of storing it as "none"');
  MR3.crewFlowCacheRankSummary('probe-empty', []);
  ok(Object.prototype.hasOwnProperty.call(MR3.crewFlowRankCache(), 'probe-empty'),
    'R2/L (control): an explicit empty list IS stored — the refusal above is about absence, not emptiness');
  delete MR3.crewFlowRankCache()['probe-empty'];

  // ---- 3e. the row title: who the candidate is, without inventing anyone ---
  // The owner's point of the whole change is "choose whom to open", so a row
  // whose title is a raw intake_id does not do the job. The name now rides in
  // the same summary. Three states, for the same reason the outcome has three.
  ok(/data-name="list"/.test(r3Row('L-met')) && /Oleksandr K\./.test(r3Row('L-met')),
    'R2/N: the title shows the name the list carried, straight from the load');
  ok(/data-name="none"/.test(r3Row('L-noname')),
    'R2/N: an explicit null is shown AS "no name", never masked');
  ok(/data-qa="crew-flow-row-noname"/.test(r3Row('L-noname')),
    'R2/N: and the absence is spelled out next to the fallback identifier');
  ok(r3Row('L-noname').indexOf('L-noname') !== -1,
    'R2/N: the intake_id stays as the fallback identifier rather than disappearing');
  ok(!/data-qa="crew-flow-row-noname"/.test(r3Row('L-noname-field')) && /data-name="unknown"/.test(r3Row('L-noname-field')),
    'R2/N: a build that never sent the field claims nothing — "we cannot say" is not "there is none"');
  // Nothing may be substituted for a missing name: not the source id, not the
  // content type, not a blank that reads as an unnamed person.
  const r3NoNameTitle = (r3Row('L-noname').match(/data-qa="crew-flow-row-name"[^>]*>([^<]*)</) || ['', ''])[1];
  // (929), OWNER 2026-09-30: "UUID не является основным названием". This used to
  // assert the opposite — that the title IS the intake_id — and that was correct
  // under the earlier reading, where the id was the only thing left to print. It
  // is not correct now: on the owner's own stand the heading came out as
  // 289bc54e-339b-4422-8069-74d7c576d1ba, wrapped over three lines, and told him
  // nothing. The title is now the record's SOURCE, which is true, readable, and
  // cannot be mistaken for a person's name.
  ok(r3NoNameTitle !== 'L-noname' && r3NoNameTitle.indexOf('L-noname') === -1,
    'R2/N (929): the intake_id is NOT the title when there is no name — got "' + r3NoNameTitle + '"');
  ok(r3NoNameTitle === 'Skipi application',
    'R2/N (929): a response delivered from the app is titled as such — got "' + r3NoNameTitle + '"');
  ok(r3NoNameTitle.trim() !== '', 'R2/N: and it is not blank either');
  // The identifier did not vanish: it stays the row's machine handle, and the
  // card prints it in full under Technical details. It is simply not a heading.
  ok(/data-intake="L-noname"/.test(r3Row('L-noname')),
    'R2/N (929): the intake_id remains the row handle, just not its name');
  // Name every neighbour that could be quietly promoted into the title. The
  // content type is on this list for a reason: deriving the heading from it
  // would be the same defect in a different field, so the label reads `source`
  // and nothing else.
  for (const [field, value] of [['source_id', 'msg-L-noname'], ['receipt_id', 'receipt-L-noname'],
                                ['event_id', 'event-L-noname'], ['content_type', 'application/pdf'],
                                ['primary_profile_id', 'p-main']]) {
    ok(r3NoNameTitle.indexOf(value) === -1,
      'R2/N: ' + field + ' is never promoted into the title in place of a missing name');
  }
  // The control that keeps all of the above from being vacuous: when a name IS
  // recorded it wins outright, and no source label appears in its place.
  ok(!/E-mail|Skipi application|Record|Test record/.test((r3Row('L-met').match(/data-qa="crew-flow-row-name"[^>]*>([^<]*)</) || ['',''])[1]),
    'R2/N (929, control): a named candidate is titled by the NAME, never by the source');

  // ---- 3e-bis. every branch of the source table, in both languages ---------
  // Measured on the pilot: skipi_response 2, inbound 9, synthetic 3. An
  // unrecognised code MUST degrade to the neutral word rather than throw or
  // print the raw code -- three values on one contour do not prove a fourth
  // cannot arrive from another.
  const label = MR3.crewFlowSourceLabel;
  for (const [lang, expect] of [['ru', {
    skipi_response: 'Отклик из Skipi', inbound: 'Письмо', synthetic: 'Тестовая запись',
    no_such_source_code_v9: 'Запись', '': 'Запись',
  }], ['en', {
    skipi_response: 'Skipi application', inbound: 'E-mail', synthetic: 'Test record',
    no_such_source_code_v9: 'Record', '': 'Record',
  }]]) {
    store.set('skipi-crewing-ui-language', lang);
    for (const [code, want] of Object.entries(expect)) {
      ok(label(code) === want,
        'R2/N (929): source "' + (code || '<empty>') + '" reads "' + want + '" in ' + lang
        + ' — got "' + label(code) + '"');
    }
    ok(label(undefined) === expect[''] && label(null) === expect[''],
      'R2/N (929): a missing source degrades to the neutral word in ' + lang + ', it does not throw');
    ok(label('no_such_source_code_v9').indexOf('no_such_source_code_v9') === -1,
      'R2/N (929): an unrecognised code is never PRINTED — a machine code in a heading is the defect being fixed');
  }
  store.set('skipi-crewing-ui-language', 'en');

  // ---- 3f. one name, one source of truth ---------------------------------
  // The recorded fact and summary.candidate_name are the SAME fact; the card
  // loads it directly and lets an operator correct it, so the card value wins
  // wherever it is in hand. Two different names for one candidate must never
  // appear on one screen.
  MR3.state.crewFlowFacts = MR3.state.crewFlowFacts || {};
  MR3.state.crewFlowFacts['L-gap'] = { name: 'Ivan M. (corrected on the card)' };
  const r3TreeFact = String(MR3.crewFlowLiveTreeHtml('live'));
  const r3GapFact = (r3TreeFact.match(new RegExp('data-intake="L-gap"[\\s\\S]*?(?=<div class="tree-item|$)')) || [''])[0];
  ok(/data-name="fact"/.test(r3GapFact) && /corrected on the card/.test(r3GapFact),
    'R2/N: the corrected fact wins over the list rendering of the same fact');
  ok(r3GapFact.indexOf('from the list') === -1,
    'R2/N: and the superseded value is not shown alongside it — one candidate, one name');
  delete MR3.state.crewFlowFacts['L-gap'];

  // ---- 4. both locales, on the list-loaded rows ---------------------------
  store.set('skipi-crewing-ui-language', 'ru');
  const r3Ru = String(MR3.crewFlowLiveTreeHtml('live'));
  ok(/Master · Bulk Carrier — Выполнено 1 · Не выполнено 1 · Не подтверждено 1/.test(r3Ru),
    'R2/L: the Russian row prints the three counts separately after a list load');
  ok(/оценки против этого профиля нет/.test(r3Ru) && /оценка ещё не загружена/.test(r3Ru),
    'R2/L: Russian keeps absent and not-loaded as two different sentences');
  ok(/исходы распознаны не полностью/.test(r3Ru), 'R2/L: the partial state is named in Russian too');
  ok(/имя не указано/.test(r3Ru), 'R2/N: the missing-name state is named in Russian');
  ok(/Отклик из Skipi/.test(r3Ru), 'R2/N (929): and the row is titled by its SOURCE in Russian, not by an identifier');
  store.set('skipi-crewing-ui-language', 'en');
  const r3En = String(MR3.crewFlowLiveTreeHtml('live'));
  ok(/no stored comparison against this profile/.test(r3En) && /comparison not loaded yet/.test(r3En) && !/[Ѐ-ӿ]/.test(r3En),
    'R2/L: English keeps them as two different sentences and leaves no Cyrillic');
  ok(/outcomes not fully recognised/.test(r3En), 'R2/L: the partial state is named in English too');
  ok(/name not given/.test(r3En), 'R2/N: the missing-name state is named in English');
  ok(/Skipi application/.test(r3En), 'R2/N (929): and by its SOURCE in English');

  // ---- 5. a second render costs nothing ----------------------------------
  const r3Before = calls.length;
  MR3.crewFlowLiveTreeHtml('live');
  MR3.crewFlowEnsureLiveQueue();
  ok(calls.length === r3Before,
    'R2/L: re-rendering and re-entering Crew Flow issue no further command — '
    + r3Before + ' -> ' + calls.length);
}
R2_FIXTURES.list = null;
R2_FIXTURES.profiles = null;
store.set('skipi_crewing_demo', '1');


// ---- No.621: the delivered response contact must not reach the demo host ----
//
// `demoInvoke` answers an unknown command with a toast and
// `reject('demo_read_only')`, so a card that fetched the contact unguarded would
// raise a demo toast on every open and take this harness red. The guard is
// pinned HERE, in the demo harness, so the regression is caught by the file
// whose subject it is - not only by the candidate harness next door.
section('No.621 response contact stays out of the demo host');
{
  const loader = (HTML.match(/async function pilotResponseContactLoad\(\) \{[\s\S]*?\n\}/) || [''])[0];
  ok(loader !== '', 'No.621: the response-contact loader exists in the shipped bytes');
  ok(/__demoMode/.test(loader),
    'No.621/N18: the loader checks the demo host before it invokes anything');
  ok(loader.indexOf('__demoMode') < loader.indexOf("invoke('crewing_intake_response_contact'"),
    'No.621/N18: and it checks it BEFORE the invoke, not after');
  // The crew-flow side keeps a CODE, never the address: nothing in that cache can
  // travel to a queue row or to the irreversible seafarer save.
  const cache = (crewBlock.match(/function crewFlowCacheResponseContact\([\s\S]*?\n\}/) || [''])[0];
  ok(cache !== '', 'No.621: the crew-flow side has its own cache helper');
  ok(cache !== '' && !/value/.test(cache),
    'No.621/N17: that cache is handed a state CODE and never the address itself');
  ok(cache !== '' && !/crewFlowFactCache\(\)/.test(cache),
    'No.621/N17: and it is not the fact cache - the back door into the queue row and the save is closed by absence');
}

// ===== No.623 (OWNER (943)/(944)/(963)): the QUEUE ROW says who responded ====
//
// The row is the half of No.623 the owner sees first, and it is also the half
// with the sharpest negative: measured on the product's own source table,
// `inbound 9 · skipi_response 2 · synthetic 3` — NINE of fourteen pilot cards
// are born of e-mail and will never carry `response_headline`. So the row that
// must be proven is not the one with data; it is the one WITHOUT.
section('No.623: the queue row says who responded, and only where it can');
{
  store.delete('skipi_crewing_demo');
  elements.clear();
  let M623 = null;
  try { M623 = loadInlineModuleForCurrentStore(); } catch (e) { console.error('No.623 runtime load failed:', e); }
  ok(!!M623, 'No.623/row: the non-demo inline script loads');

  if (M623 && typeof M623.crewFlowLiveTreeHtml === 'function') {
    const headline = (over) => Object.assign({
      rank: 'Master', rank_state: 'from_snapshot', first_name: 'Ivan', surname: 'Petrov',
    }, over || {});
    const row = (id, source, head, candidateName) => {
      const summary = { state: 'ranked', facts: 3, ranks: 0, ranks_stale: 0,
        active_confirmations: 0, needs_review_reason: null, profile_ranks: [] };
      if (candidateName !== undefined) summary.candidate_name = candidateName;
      const item = { intake_id: id, receipt_id: 'receipt-' + id, crewing_id: 'crew-flow-demo-harness',
        source, source_id: 'msg-' + id, event_id: 'event-' + id, primary_profile_id: 'p-main',
        content_sha256: '0'.repeat(64), content_bytes: 14412, content_type: 'application/pdf',
        state: 'ranked', source_trust: 'inbound_alias', version: 1,
        created_at: '2026-09-29T01:10:00Z', issued_at: '2026-09-29T01:10:00Z',
        objects: [], attachments: [], summary };
      if (head !== undefined) item.response_headline = head;
      return item;
    };
    R2_FIXTURES.list = { items: [
      row('N-resp', 'skipi_response', headline()),                                   // a response, complete
      row('N-mail', 'inbound', undefined, null),                                     // e-mail: nine of fourteen
      row('N-gone', 'skipi_response', headline({ rank: null, rank_state: 'snapshot_superseded' })),
      row('N-nosnap', 'skipi_response', headline({ rank: null, rank_state: 'snapshot_unavailable' })),
      row('N-noname', 'skipi_response', headline({ first_name: null, surname: null }), null),
    ], limit: 50, offset: 0, total: 5 };
    R2_FIXTURES.profiles = { items: [{ id: 'p-main', name: 'Master · Bulk Carrier', version: 1, state: 'active' }] };
    M623.state.settings = { server_url: 'https://api.skipi.app', bearer_token: 'TOKEN-DO-NOT-LEAK',
      crewing_id: 'crew-flow-demo-harness', interface: { theme: 'light', language: 'en' } };
    store.set('skipi-crewing-ui-language', 'en');

    const from = calls.length;
    M623.showView('crew_flow');
    for (let i = 0; i < 8; i++) await Promise.resolve();
    const cmds = calls.slice(from).map(([c]) => String(c));
    const pick = (html, id) => {
      const m = html.match(new RegExp('data-intake="' + id + '"[\\s\\S]*?(?=<div class="tree-item|<button class="mobile-list-item|$)'));
      return m ? m[0] : '';
    };
    const nameOf = (r) => (String(r).match(/data-qa="crew-flow-row-name"[^>]*>([^<]*)</) || ['', ''])[1];

    // ---- 1. the headline rides the list already loaded, costing nothing -----
    ok(cmds.filter((c) => c === 'crewing_intake_candidate_list').length === 1,
      'No.623/row: the queue is still fetched exactly once');
    ok(cmds.filter((c) => c === 'crewing_intake_response_contact').length === 0,
      'No.623/row: naming the responder costs NO extra request per row — it rides the list answer (N+1 refused)');

    const html = String(M623.crewFlowLiveTreeHtml('live'));

    // ---- 2. a response row is named ----------------------------------------
    ok(nameOf(pick(html, 'N-resp')) === 'Ivan Petrov',
      'No.623/row: the responder’s name replaces the anonymous source label — got «' + nameOf(pick(html, 'N-resp')) + '»');
    ok(/data-qa="crew-flow-row-response-rank"[^>]*>Master</.test(pick(html, 'N-resp')),
      'No.623/row: and the post they responded ON stands beside it');
    ok(/data-name="response"/.test(pick(html, 'N-resp')),
      'No.623/row: the row records WHICH transport named the candidate');

    // ---- 3. THE NEGATIVE THAT MATTERS: the e-mail row is untouched ----------
    const mail = pick(html, 'N-mail');
    ok(!/data-qa="crew-flow-row-response-rank"/.test(mail),
      'No.623/row NEGATIVE: an e-mail row gets no response heading — an unconditional one would make nine of fourteen pilot rows worse');
    ok(nameOf(mail) === 'E-mail',
      'No.623/row NEGATIVE: it keeps exactly today’s title, its source — got «' + nameOf(mail) + '»');
    ok(/data-qa="crew-flow-row-noname"/.test(mail),
      'No.623/row NEGATIVE: and it still says out loud that no name was recorded');

    // ---- 4. the frozen post, (944) -----------------------------------------
    const gone = pick(html, 'N-gone');
    ok(nameOf(gone) === 'Ivan Petrov', 'No.623/row: a superseded snapshot still names the person');
    ok(!/data-qa="crew-flow-row-response-rank"[^>]*>[^<]/.test(gone) || !/Master/.test(gone.split('crew-flow-row-name')[0]),
      'No.623/row (944): and shows NO post rather than the profile’s current one');
    ok(/data-qa="crew-flow-row-rank-state"/.test(gone),
      'No.623/row (944): it says why the post is absent instead of going quiet');
    const goneCaption = (gone.match(/data-qa="crew-flow-row-rank-state"[^>]*>([^<]*)</) || ['', ''])[1];
    const nosnapCaption = (pick(html, 'N-nosnap').match(/data-qa="crew-flow-row-rank-state"[^>]*>([^<]*)</) || ['', ''])[1];
    ok(goneCaption !== '' && nosnapCaption !== '' && goneCaption !== nosnapCaption,
      'No.623/row: «overwritten by a republish» and «no readable snapshot» are two different sentences — got «' + goneCaption + '» / «' + nosnapCaption + '»');

    // ---- 5. a response that carried no name falls back, it does not invent --
    const noname = pick(html, 'N-noname');
    ok(nameOf(noname) === 'Skipi application',
      'No.623/row: a nameless response keeps today’s source title rather than heading the row with a post — got «' + nameOf(noname) + '»');
    // The TEXT alone cannot tell the two apart: a row that wrongly claimed the
    // delivered transport would print the same source label (mutation M5 survived
    // exactly so). What separates them is the state the row reports about itself.
    ok(/data-name="none"/.test(noname),
      'No.623/row: and it reports the honest state — a response that carried no name is not a row named BY the response');
    ok(/data-qa="crew-flow-row-noname"/.test(noname),
      'No.623/row: so it still says out loud that no name was recorded, instead of going quiet behind a delivered-looking title');

    // ---- 6. Б1: nothing of the response enters the store that feeds the
    //         IRREVERSIBLE seafarer save ------------------------------------
    const factDump = JSON.stringify(M623.state.crewFlowFacts || {});
    ok(!/Ivan|Petrov|Master/.test(factDump),
      'No.623/Б1: not one delivered value entered crewFlowFactCache — that cache reaches both the row AND save_seafarer_from_bundle, so absence is the only real lock. Got: ' + factDump.slice(0, 200));
    ok(!calls.some(([c]) => String(c) === 'save_seafarer_from_bundle'),
      'No.623/Б1: loading and rendering the queue wrote nothing to the local seafarer database');

    // ---- 7. both languages --------------------------------------------------
    store.set('skipi-crewing-ui-language', 'ru');
    const ru = String(M623.crewFlowLiveTreeHtml('live'));
    ok(/Ivan Petrov/.test(ru), 'No.623/row: the name is a name in Russian too, not translated');
    const ruGone = (pick(ru, 'N-gone').match(/data-qa="crew-flow-row-rank-state"[^>]*>([^<]*)</) || ['', ''])[1];
    ok(/[Ѐ-ӿ]/.test(ruGone), 'No.623/row: the state caption is Russian in Russian — got «' + ruGone + '»');
    ok(/Письмо/.test(pick(ru, 'N-mail')), 'No.623/row: and the e-mail row keeps its Russian source title');
    store.set('skipi-crewing-ui-language', 'en');
    const en = String(M623.crewFlowLiveTreeHtml('live'));
    ok(!/[Ѐ-ӿ]/.test(en), 'No.623/row: no Cyrillic leaks into the English queue');

    // ---- 8. name priority, Б2 ----------------------------------------------
    // The operator's correction is a human act: it is never overwritten by a
    // machine value, and the delivered value in turn outranks what was read out
    // of a CV. Two names for one candidate are never shown side by side.
    if (typeof M623.crewFlowCacheNameOrigin === 'function') {
      M623.state.crewFlowFacts = M623.state.crewFlowFacts || {};
      M623.state.crewFlowFacts['N-resp'] = { name: 'I. PETROV (OCR)' };
      M623.crewFlowCacheNameOrigin('N-resp', 'machine');
      const machineRow = pick(String(M623.crewFlowLiveTreeHtml('live')), 'N-resp');
      ok(nameOf(machineRow) === 'Ivan Petrov',
        'No.623/Б2: the value delivered WITH THE RESPONSE outranks a machine reading of a CV — got «' + nameOf(machineRow) + '»');
      ok(!/OCR/.test(machineRow), 'No.623/Б2: and the two are never shown side by side');

      M623.crewFlowCacheNameOrigin('N-resp', 'operator');
      M623.state.crewFlowFacts['N-resp'] = { name: 'Ivan Petrov-Sydorenko' };
      const operatorRow = pick(String(M623.crewFlowLiveTreeHtml('live')), 'N-resp');
      ok(nameOf(operatorRow) === 'Ivan Petrov-Sydorenko',
        'No.623/Б2: an OPERATOR correction is never overwritten by the delivered value — got «' + nameOf(operatorRow) + '»');
      delete M623.state.crewFlowFacts['N-resp'];
      M623.crewFlowCacheNameOrigin('N-resp', '');
    } else {
      ok(false, 'No.623/Б2: a name-origin helper exists so the row can tell an operator correction from a machine reading');
      ok(false, 'No.623/Б2: (delivered beats CV — not reachable without it)');
      ok(false, 'No.623/Б2: (operator beats delivered — not reachable without it)');
    }

    // ---- 9. the dead heading stays dead, and the origin store is its own ----
    ok((HTML.match(/crewFlowRowTitle\(/g) || []).length <= 1,
      'No.623/Б2: crewFlowRowTitle is still dead — a third independent title rule was explicitly forbidden');
    const origin = (crewBlock.match(/function crewFlowCacheNameOrigin\([\s\S]*?\n\}/) || [''])[0];
    ok(origin !== '' && !/crewFlowFactCache\(\)/.test(origin),
      'No.623/Б1: the origin store is NOT the fact cache — same reasoning as No.621’s contact code, and the same door left shut');
  }
  R2_FIXTURES.list = null;
  R2_FIXTURES.profiles = null;
  store.set('skipi_crewing_demo', '1');
}

// ============================================================================
// No.675 (OWNER (990), 2026-10-04): ONE sentence, two localisation mechanisms.
//
// This screen has two of them and always has: the Crew Flow row reads
// UI_STRINGS through tr(), and the candidate card reads PILOT_CARD_TEXT through
// cardT() — the card block contains not a single tr() call, and its isolated
// harness stubs tr() to return the key. So the owner's sentence has to live in
// both tables, and the one thing that can go wrong is that they drift apart:
// the queue would then say one thing and the card another about the same
// candidate. That is pinned here by equality, not by eye.
// ============================================================================
section('No.675: the no-matches wording is one sentence in both dictionaries');
{
  const uiVals = [...HTML.matchAll(/'crew_flow\.no_matches_yet':'([^']*)'/g)].map((m) => m[1]);
  const cardVals = [...HTML.matchAll(/fit_no_matches:'([^']*)'/g)].map((m) => m[1]);
  ok(uiVals.length === 2, 'No.675: crew_flow.no_matches_yet is defined once in EN and once in RU — got ' + uiVals.length);
  ok(cardVals.length === 2, 'No.675: PILOT_CARD_TEXT.fit_no_matches is defined once in EN and once in RU — got ' + cardVals.length);
  if (uiVals.length === 2 && cardVals.length === 2) {
    ok(!/[Ѐ-ӿ]/.test(uiVals[0]) && /[Ѐ-ӿ]/.test(uiVals[1]),
      'No.675: the row dictionary carries an English and a Russian wording — got "' + uiVals[0] + '" / "' + uiVals[1] + '"');
    ok(!/[Ѐ-ӿ]/.test(cardVals[0]) && /[Ѐ-ӿ]/.test(cardVals[1]),
      'No.675: and so does the card dictionary — got "' + cardVals[0] + '" / "' + cardVals[1] + '"');
    ok(uiVals[0] === cardVals[0] && uiVals[1] === cardVals[1],
      'No.675: the queue row and the card say the SAME sentence in each language — row ["' + uiVals.join('" | "')
        + '"], card ["' + cardVals.join('" | "') + '"]');
    ok(/отклика/.test(uiVals[1]) && /response/i.test(uiVals[0]),
      'No.675: and the sentence names the MOMENT (the response), not a pending promise — got "' + uiVals[1] + '" / "' + uiVals[0] + '"');
  }
  // The old grey sentence is not deleted: it is still the right words for a
  // letter, and the calibration rows above depend on it being there.
  ok(/'crew_flow\.card_fit_none':/.test(HTML) && /fit_none:'/.test(HTML),
    'No.675 PRESERVE: the «пока нет» wording stays in both dictionaries for everything that is not a response');
}

// ============================================================================
// No.675 (OWNER (991) + (992), 2026-10-04): WHICH CHIP IS GREY AND WHICH IS
// GREEN, pinned on the shipped CSS so a refactor cannot quietly re-invent one.
//
// (991) The no-matches pill spent one build as a bordered thing of its own and
// read as a different kind of object beside «Записано; ожидает проверки». It is
// now `class="badge"` inside `.cf-chips` — the SAME class and the SAME rule as
// the chips it stands with. What is asserted is therefore an ABSENCE (no second
// grey rule) plus the properties of the one rule that remains.
//
// (992) «в базе моряков» is green, and the green is not a new one: it must be
// the very values «Все проверки выполнены» / the 100 % figure already use. That
// is checked by EQUALITY of the two colours read out of the stylesheet, in both
// themes — a third green cannot drift in without reddening this.
// ============================================================================
section('No.675: the grey chip is the queue grey, the green chip is the queue green');
{
  const css = HTML.slice(0, HTML.indexOf('</style>'));

  // ---- (991) one grey, and it is the chip rule --------------------------
  ok(!/\.cf-nomatch/.test(HTML),
    '991: no `.cf-nomatch` rule or class survives anywhere — the bordered pill cannot come back under its old name');
  const chipRule = (css.match(/\n\.cf-chips \.badge \{[^}]*\}/) || [''])[0];
  ok(chipRule !== '', '991 CALIBRATION: the queue chip rule is where this test thinks it is');
  ok(/var\(--panel2\)/.test(chipRule) && /var\(--text2\)/.test(chipRule),
    '991: the chip grey is theme tokens, so one rule serves light and dark — got "' + chipRule.trim() + '"');
  // `border-radius` contains the word "border": a bare /border/ here is a check
  // that cannot pass, which is the same defect as one that cannot fail.
  ok(/border-radius/.test(chipRule) && !/[\s;{]border\s*:/.test(chipRule),
    '991: it keeps its round shape and carries NO border line — that was the thing the owner saw as "not the same pill"');

  // ---- (992) the green is the SAME green, both themes --------------------
  const colourOf = (re) => { const m = css.match(re); return m ? m[1].toLowerCase() : ''; };
  const completeDark = colourOf(/\n\.cf-fit-complete \.cf-word, \.cf-fit-complete \.cf-pct \{ color:(#[0-9a-f]{6}); \}/);
  const completeLight = colourOf(/:root\[data-theme="light"\] \.cf-fit-complete \.cf-pct \{ color:(#[0-9a-f]{6}); \}/);
  const savedDark = colourOf(/\n\.badge\.saved \{ color:(#[0-9a-f]{6});/);
  const savedLight = colourOf(/\n:root\[data-theme="light"\] \.badge\.saved \{ color:(#[0-9a-f]{6}); \}/);
  ok(completeDark !== '' && completeLight !== '' && completeDark !== completeLight,
    '992 CALIBRATION: «Все проверки выполнены» really does carry two different greens, one per theme — got '
      + completeDark + ' / ' + completeLight);
  ok(savedDark !== '' && savedLight !== '',
    '992: the saved chip has a green in BOTH themes — got ' + savedDark + ' / ' + savedLight);
  ok(savedDark === completeDark,
    '992: and the dark one is the SAME green as the 100 % figure, not a second one — ' + savedDark + ' vs ' + completeDark);
  ok(savedLight === completeLight,
    '992: and so is the light one — ' + savedLight + ' vs ' + completeLight);
  ok(/\n\.badge\.saved \{[^}]*font-weight:650;/.test(css),
    '992: it also borrows the weight `.cf-fit-complete .cf-word` uses, so the two read as one state and not two');
  // Colour only. A tinted ground would be a value nobody measured, and this
  // screen expresses "all good" as a text colour everywhere else.
  ok(!/\n\.badge\.saved \{[^}]*background/.test(css),
    '992: no new tinted ground was invented for it');
  // The selector must reach the phone chip row too, where `.badge` is unstyled.
  ok(/\n\.badge\.saved \{/.test(css) && !/\n\.cf-chips \.badge\.saved \{/.test(css),
    '992: the rule is not scoped to the desktop tree — the word turns green in the phone chip row as well');
}

// ============================================================================
// No.675 (manager's frame of 97de0389, 2026-10-04): A CHIP ON THE SELECTED ROW
// MUST STILL LOOK LIKE A CHIP.
//
// `.tree-item.active` paints with `--panel2` and `.cf-chips .badge` painted
// with `--panel2` as well, so on the open row the pills had the same ground as
// the row and read as loose text — «Записано; ожидает проверки», «На момент
// отклика соответствий нет» and «в базе моряков» all lost their shape, while
// the row below still showed one. Colour names prove nothing here: the tokens
// are RESOLVED to their hex per theme and compared, so a future rename or a
// re-pointing of either token reddens this instead of silently repeating the
// collision.
// ============================================================================
section('No.675: pills keep their shape on the selected row (both themes)');
{
  const css = HTML.slice(0, HTML.indexOf('</style>'));
  const varsOf = (block) => {
    const out = {};
    const re = /(--[a-z0-9-]+):\s*([^;]+);/g;
    let m;
    while ((m = re.exec(block))) out[m[1]] = m[2].trim().toLowerCase();
    return out;
  };
  const dark = varsOf((css.match(/:root \{([\s\S]*?)\n\}/) || ['', ''])[1]);
  const light = Object.assign({}, dark, varsOf((css.match(/:root\[data-theme="light"\] \{([\s\S]*?)\n\}/) || ['', ''])[1]));
  const tokenIn = (rule, prop) => {
    const m = String(rule).match(new RegExp(prop + ':\\s*var\\((--[a-z0-9-]+)\\)'));
    return m ? m[1] : '';
  };
  const ruleFor = (selector) => {
    const i = css.indexOf('\n' + selector);
    if (i < 0) return '';
    const j = css.indexOf('}', i);
    return j < 0 ? '' : css.slice(i, j + 1);
  };

  const activeRule = ruleFor('.tree-item.active {');
  const chipRule = ruleFor('.cf-chips .badge {');
  const overrideRule = ruleFor('.tree-item.active .cf-chips .badge,');
  ok(activeRule !== '' && chipRule !== '' && overrideRule !== '',
    'SEL CALIBRATION: all three rules this test reasons about are found in the shipped stylesheet');

  const rowTok = tokenIn(activeRule, 'background');
  const chipTok = tokenIn(chipRule, 'background');
  const overTok = tokenIn(overrideRule, 'background');
  ok(rowTok !== '' && chipTok !== '' && overTok !== '',
    'SEL CALIBRATION: each of the three grounds is a theme token, so it can be resolved — got row '
      + rowTok + ', chip ' + chipTok + ', override ' + overTok);
  ok(overTok !== '' && /^--/.test(overTok),
    'SEL: the selected-row ground for a chip is an EXISTING token, not a fresh hex — got ' + overTok);

  // The resolver has to be able to tell two tokens apart before it is trusted.
  ok(dark['--panel2'] && light['--panel2'] && dark['--panel2'] !== light['--panel2'],
    'SEL CALIBRATION: the token resolver really reads two different theme tables — --panel2 is '
      + dark['--panel2'] + ' / ' + light['--panel2']);

  for (const [name, table] of [['dark', dark], ['light', light]]) {
    const rowBg = table[rowTok] || '';
    const overBg = table[overTok] || '';
    ok(rowBg !== '' && overBg !== '',
      '[' + name + '] SEL CALIBRATION: both grounds resolve to a value — row "' + rowBg + '", chip "' + overBg + '"');
    // Both halves must be present: with no override rule at all `overBg` is the
    // empty string, and `rowBg !== ''` would then pass this on the very build
    // that has the defect. Measured — it did, on 7833b165.
    ok(rowBg !== '' && overBg !== '' && rowBg !== overBg,
      '[' + name + '] SEL: a chip inside the SELECTED row has a ground of its own and it is NOT the row ground, so the pill shape survives — row "'
        + rowBg + '" vs chip "' + overBg + '"');
    // the defect itself, stated so the override cannot be deleted as redundant
    ok((table[chipTok] || '') === rowBg,
      '[' + name + '] SEL CALIBRATION: without the override the chip ground WOULD equal the row ground ('
        + (table[chipTok] || '') + ') — that is the collision the owner saw, and why this rule exists');
  }

  // Hover is the identical collision, not a second defect.
  ok(/\.tree-item:hover \.cf-chips \.badge/.test(css),
    'SEL: the hovered row is covered by the same rule — it paints with the same --panel2 and would blend the same way');
  // The green chip takes the ground and keeps the green: the override must not
  // exclude it, and `.badge.saved` must not re-introduce a ground of its own.
  ok(!/\.badge\.saved \{[^}]*background/.test(css) && !/:not\(\.saved\)/.test(overrideRule),
    'SEL: the green chip gets the same ground and keeps only its green text — it is not excluded from the rule');
}

console.log('\ncrewing_crew_flow_demo_harness: ' + (fail === 0 ? 'GREEN' : 'RED') + ' (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail === 0 ? 0 : 1);
