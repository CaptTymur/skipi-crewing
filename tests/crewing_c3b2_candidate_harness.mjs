// Crewing Pilot C3b-2 — candidate card, facts, stored comparisons, shortlist decisions.
// Bounded behavioral harness on isolated renderer/state copies. Network, clipboard,
// files and dialogs are recording stubs; nothing here contacts a server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('dist/index.html', 'utf8');
const rust = fs.readFileSync('src-tauri/src/crewing_intake.rs', 'utf8');
const lib = fs.readFileSync('src-tauri/src/lib.rs', 'utf8');
const workflow = fs.readFileSync('.github/workflows/skipi-guard.yml', 'utf8');
// K2.1: contact.rs is NEW in this candidate. A missing file must read as a RED
// assertion, not as an import-time crash that hides every other check.
const contactRs = fs.existsSync('src-tauri/src/contact.rs') ? fs.readFileSync('src-tauri/src/contact.rs', 'utf8') : '';

const c3b1Start = html.indexOf('// ================= C3b-1 SYNTHETIC INTAKE PILOT START =================');
const c3b1End = html.indexOf('// ================== C3b-1 SYNTHETIC INTAKE PILOT END ==================', c3b1Start);
const c3b2Start = html.indexOf('// ================= C3b-2 CANDIDATE CARD START =================', c3b1End);
const c3b2End = html.indexOf('// ================== C3b-2 CANDIDATE CARD END ==================', c3b2Start);
assert.ok(c3b1Start > 0 && c3b1End > c3b1Start && c3b2Start > c3b1End && c3b2End > c3b2Start, 'bounded C3b-1 and C3b-2 UI blocks exist in order');
const c3b1Source = html.slice(c3b1Start, c3b1End);
const c3b2Source = html.slice(c3b2Start, c3b2End);
// No.632: the profile-shortlist block is sliced the same way and may be ABSENT —
// an absent block must read as a RED assertion below, never as an import crash
// that would hide every other check in this file.
const s632Start = html.indexOf('// ================= No.632 PROFILE SHORTLIST START =================');
const s632End = html.indexOf('// ================== No.632 PROFILE SHORTLIST END ==================', s632Start);
const s632Source = (s632Start > 0 && s632End > s632Start) ? html.slice(s632Start, s632End) : '';

let passed = 0;
let failed = 0;
function ok(condition, message) {
  if (!condition) { failed += 1; console.log('  ✗', message); throw new assert.AssertionError({ message }); }
  passed += 1;
  console.log('  ✓', message);
}
function softOk(condition, message) {
  if (!condition) { failed += 1; console.log('  ✗', message); return false; }
  passed += 1;
  console.log('  ✓', message);
  return true;
}

console.log('# static bridge, registration and workflow pins');
const commands = [
  'crewing_intake_candidate_get', 'crewing_intake_fact_list', 'crewing_intake_fact_record', 'crewing_intake_fact_correct',
  'crewing_intake_candidate_rank', 'crewing_intake_rank_list', 'crewing_intake_shortlist_confirm', 'crewing_intake_shortlist_withdraw',
  'crewing_intake_matching_profile_list',
];
for (const command of commands) {
  ok(rust.includes(`pub(crate) async fn ${command}(`), `${command} is a fixed native command`);
  ok(lib.includes(`crewing_intake::${command},`), `${command} is registered in Tauri`);
}
ok(rust.includes('fn send_no_content(') && rust.includes('status == StatusCode::NO_CONTENT && bytes.is_empty()'), 'explicit empty-204 adapter exists and accepts only an empty 204');
ok(/fn crewing_intake_shortlist_withdraw[\s\S]*?send_no_content\(&context, Method::DELETE, url\)/.test(rust), 'withdraw goes through the no-content adapter, never the JSON decoder');
ok(!/api::(?:get|post|api_bases|primary_api_base)/.test(rust), 'pilot still avoids fallback/retry API helpers');
for (const code of ['rank_not_found', 'profile_not_active', 'profile_version_stale', 'already_confirmed', 'not_confirmed', 'already_withdrawn', 'withdraw_not_permitted', 'fact_no_source_object', 'fact_shape']) {
  ok(rust.includes(`"${code}",`), `safe allowlist carries domain code ${code}`);
}
ok(/repository: CaptTymur\/skipi-host-runtime\n\s+ref: d6238191c554bc370983366672c41b41116754ce/.test(workflow), 'runtime pin d6238191 is unchanged');
// S5: exactly ONE accepted guard pin. A list of three quietly accepts two
// superseded gate configurations — the pin then proves nothing about WHICH
// gate ran. The accepted configuration is aa3b2efb (K2 route plus the K2.1
// single-screen route); the superseded b72a59ca must not be accepted.
ok(/repository: CaptTymur\/skipi-guard\n\s+ref: aa3b2efb19cb4448226075be36b3f8c7b302c3df\n/.test(workflow), 'the workflow pins exactly the accepted guard SHA (K2 + K2.1 routes)');
ok(!c3b2Source.includes('localStorage'), 'card block never persists card state');
ok((c3b1Source.match(/PILOT_REASON_TEXT\s*=\s*\{/g) || []).length === 1 && !c3b2Source.includes('PILOT_REASON_TEXT ='), 'queue reason catalogue stays single');
ok(/data-qa="pilot-open-card"/.test(c3b1Source), 'queue rows expose an explicit Open control');

// --------- P2/S1: the profile card gets a vessel type and ONE publish button
//
// Static, and deliberately so: the compliance screen lives OUTSIDE the two
// bounded C3b blocks this harness runs in a vm, and the publication route it
// calls is a pilot bridge command, which is what this section of the file is
// about. What is asserted is the wiring — the command exists, it is
// registered, its two refusal words are on the safe allowlist, the vessel
// type reaches the server on the legacy draft as well, and the card actually
// carries the control. Behaviour on the server side is drilled by
// tests/test_crewing_p2_s1_profile_publication.py in skipi-server.
console.log('# P2/S1 profile publication wiring');
ok(rust.includes('pub(crate) async fn crewing_intake_matching_profile_publication('),
  'publication is a fixed native command');
ok(lib.includes('crewing_intake::crewing_intake_matching_profile_publication,'),
  'publication is registered in Tauri');
ok(/fn crewing_intake_matching_profile_publication[\s\S]*?json!\(\{ "published": published \}\)/.test(rust),
  'the client posts only the boolean: the server owns the vocabulary');
ok(/fn crewing_intake_matching_profile_publication[\s\S]*?&\["matching-profiles", profile_id\.as_str\(\), "publication"\]/.test(rust),
  'publication goes to the matching-profile surface, which owns the version');
for (const word of ['publication needs a rank on the profile', 'publication needs a vessel type on the profile']) {
  ok(rust.includes(`"${word}",`), `safe allowlist carries the refusal word: ${word}`);
}
ok(/pub vessel_type: Option<String>,/.test(lib), 'the legacy draft/profile carry vessel_type');
ok(/"vessel_type": draft\.vessel_type/.test(lib), 'create sends vessel_type');
ok(/body\.insert\(\s*"vessel_type"\.into\(\)/.test(lib), 'update sends vessel_type');
ok(/id="cp-vessel-type"/.test(html), 'the profile editor has a vessel-type control');
ok(/data-qa="profile-publish-button"/.test(html), 'the profile card has the publish button');
ok(/data-qa="profile-publication-state"/.test(html), 'the profile card shows the publication state separately from active/archived');
ok(/'profile.publish':'Publish'/.test(html) && /'profile.publish':'Опубликовать'/.test(html),
  'the button is translated in both shipped languages');
ok(/PROFILE_PUBLISH_REFUSALS/.test(html) && /publication needs a vessel type on the profile/.test(html),
  'the card reads the refusal WORD, not just the status');
ok(!/publication_state[^\n]*(paused|'archived')/.test(html),
  'publication is never expressed through the matching state or the legacy status');

// ---------------------------------------------------------------------------
// Isolated runtime: both UI blocks in a vm context with recording stubs.
// ---------------------------------------------------------------------------
function freshPilotState() {
  return {
    generation: 0, contextKey: '', aliasDraft: '', aliases: [], aliasLoading: false, aliasError: null,
    aliasRequest: 0, aliasActionRequest: 0, aliasPending: false, oneTimeAlias: null,
    queue: { items: [], limit: 50, offset: 0, total: 0 }, queueLoading: false,
    queueError: null, queueRequest: 0, queueLastUpdated: null,
    uploadAttempt: null, uploadReceipt: null, uploadError: null, uploadPending: false,
    detail: null, detailGeneration: 0,
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// In-memory fake of the accepted C3a API, reachable only through the recorded
// `invoke` stub. It answers the nine typed commands; refusals are the typed
// PilotBridgeError objects the native bridge would deliver.
function makeServer(options = {}) {
  const server = {
    card: { intake_id: 'intake-A', receipt_id: 'receipt-A', crewing_id: 'crew-synthetic', source: 'desktop', source_id: 'desktop-synthetic', event_id: 'e1', primary_profile_id: null, content_sha256: 'abc', content_bytes: 12, content_type: 'text/plain', state: 'quarantined', source_trust: 'unverified', version: 1, created_at: '2026-09-23T01:00:00', issued_at: '2026-09-23T01:00:00', objects: [{ id: 'obj-1', content_type: 'text/plain' }, { id: 'obj-2', content_type: 'application/pdf' }], summary: { state: 'quarantined', facts: 0, ranks: 0, ranks_stale: 0, active_confirmations: 0, needs_review_reason: null } },
    profiles: options.profiles || [
      { id: 'prof-A', crewing_id: 'crew-synthetic', name: 'Master · A', version: 1, state: 'active', rank: 'Master', certs: ['coc_master'] },
      { id: 'prof-B', crewing_id: 'crew-synthetic', name: 'Chief Officer · B', version: 1, state: 'active', rank: 'Chief Officer', certs: ['coc_master'] },
      { id: 'prof-C', crewing_id: 'crew-synthetic', name: 'Master · C', version: 1, state: 'active', rank: 'Master', certs: ['radio_operator'] },
    ],
    facts: {}, ranks: [], confirmations: [], seq: 0, user: 'user-op-1', adminUser: false,
    reject(status, detail) { return { kind: 'server', status, detail, ambiguous: false }; },
    latestFacts() { const known = {}; for (const [field, versions] of Object.entries(this.facts)) known[field] = versions[0].value; return known; },
    score(profile, known) {
      const reasons = []; const met = []; const missing = []; const unconfirmed = [];
      const wanted = [['rank', profile.rank]];
      if (profile.certs == null) wanted.push(['mandatory_certs', null]); else for (const c of profile.certs) wanted.push([`certificate:${c}`, 'held']);
      for (const [req, want] of wanted) {
        const found = known[req] ?? null; let outcome;
        if (want == null) { unconfirmed.push(req); outcome = 'unconfirmed_requirement'; }
        else if (found == null) { unconfirmed.push(req); outcome = 'unconfirmed_fact'; }
        else if (found === want) { met.push(req); outcome = 'met'; }
        else { missing.push(req); outcome = 'missing'; }
        reasons.push({ requirement: req, outcome, wanted: want, found });
      }
      return { met: met.sort(), missing: missing.sort(), unconfirmed: unconfirmed.sort(), reasons, decided: !missing.length && !unconfirmed.length };
    },
    ranksView() {
      return this.ranks.map((r) => { const p = this.profiles.find((x) => x.id === r.profile_id); let stale = false, stale_reason = null; if (p.state !== 'active') { stale = true; stale_reason = 'profile_not_active'; } else if (p.version > r.profile_version) { stale = true; stale_reason = 'profile_version'; } return { ...r, stale, stale_reason }; });
    },
    handle(command, args) {
      const b = this;
      switch (command) {
        case 'crewing_intake_candidate_get': return { ...b.card, summary: { ...b.card.summary, facts: Object.keys(b.facts).length, ranks: b.ranks.length, active_confirmations: b.confirmations.filter((c) => c.withdrawn_at == null).length } };
        case 'crewing_intake_fact_list': return { items: Object.keys(b.facts).sort().map((field) => ({ field, versions: b.facts[field].slice() })) };
        case 'crewing_intake_fact_record': case 'crewing_intake_fact_correct': {
          const f = args.fact;
          if (command === 'crewing_intake_fact_correct' && args.field !== f.field) throw b.reject(422, 'fact_shape');
          if (!b.card.objects.some((o) => o.id === f.source_object)) throw b.reject(422, 'fact_no_source_object');
          const versions = b.facts[f.field] || (b.facts[f.field] = []);
          const row = { field: f.field, value: f.value, version: versions.length + 1, source_object: f.source_object, page: f.page ?? null, span: f.span ?? null, confidence: null, uncertainty: 'operator_entered', corrected_by: b.user, created_at: `2026-09-23T01:0${versions.length + 1}:00` };
          versions.unshift(row); return { ...row };
        }
        case 'crewing_intake_candidate_rank': {
          const active = b.profiles.filter((p) => p.state === 'active');
          if (!active.length) return { ranked: 0, written: 0, reason: 'no_active_profiles', profiles: [] };
          const known = b.latestFacts(); let written = 0;
          for (const p of active) { const scored = b.score(p, known); const existing = b.ranks.find((r) => r.profile_id === p.id && r.profile_version === p.version); if (existing) Object.assign(existing, scored); else { b.ranks.push({ profile_id: p.id, profile_version: p.version, primary: false, ...scored }); written += 1; } }
          b.card.state = 'ranked';
          return { ranked: active.length, written, reason: 'ranked', profiles: active.map((p) => p.id) };
        }
        case 'crewing_intake_rank_list': return { items: b.ranksView(), unranked_active_profiles: b.profiles.filter((p) => p.state === 'active' && !b.ranks.some((r) => r.profile_id === p.id)).map((p) => ({ profile_id: p.id, name: p.name })), confirmations: b.confirmations.map((c) => ({ ...c })) };
        case 'crewing_intake_shortlist_confirm': {
          const { profile_id, profile_version } = args.pair;
          const rank = b.ranks.find((r) => r.profile_id === profile_id && r.profile_version === profile_version);
          if (!rank) throw b.reject(404, 'rank_not_found');
          const p = b.profiles.find((x) => x.id === profile_id);
          if (!p || p.state !== 'active') throw b.reject(409, 'profile_not_active');
          if (p.version !== profile_version) throw b.reject(409, 'profile_version_stale');
          if (b.confirmations.some((c) => c.profile_id === profile_id && c.profile_version === profile_version && c.withdrawn_at == null)) throw b.reject(409, 'already_confirmed');
          const row = { id: `decision-${++b.seq}`, profile_id, profile_version, confirmed_by: b.user, confirmed_at: `2026-09-23T02:0${b.seq}:00`, withdrawn_by: null, withdrawn_at: null };
          b.confirmations.push(row); return { profile_id, profile_version, confirmed_by: row.confirmed_by, confirmed_at: row.confirmed_at };
        }
        case 'crewing_intake_shortlist_withdraw': {
          const { profile_id, profile_version } = args.pair;
          const rows = b.confirmations.filter((c) => c.profile_id === profile_id && c.profile_version === profile_version);
          const live = rows.filter((c) => c.withdrawn_at == null);
          if (!live.length) throw rows.length ? b.reject(409, 'already_withdrawn') : b.reject(404, 'not_confirmed');
          if (!b.adminUser && live[0].confirmed_by !== b.user) throw b.reject(403, 'withdraw_not_permitted');
          live[0].withdrawn_by = b.user; live[0].withdrawn_at = '2026-09-23T03:00:00'; return null;
        }
        case 'crewing_intake_matching_profile_list': return { items: b.profiles.map((p) => ({ id: p.id, crewing_id: p.crewing_id, name: p.name, version: p.version, state: p.state })) };
        // No.621. Every intake of THIS context is an ordinary letter, so the honest
        // answer is the route's 404 - "this letter carries no response binding".
        // Answering it here rather than falling into `default` matters: an
        // undefined command would arrive as a transport failure and the card would
        // correctly render "could not be loaded", which is not what these fixtures
        // are about.
        case 'crewing_intake_response_contact': throw b.reject(404, 'candidate intake not found');
        case 'crewing_intake_alias_list': return { items: [] };
        case 'crewing_intake_candidate_list': return { items: [{ ...b.card, summary: b.card.summary }], limit: 50, offset: args.offset || 0, total: 1 };
        default: throw new Error(`unexpected invoke ${command}`);
      }
    },
  };
  return server;
}

function makeContext({ source = c3b2Source, c3b1 = c3b1Source, server = makeServer(), invokeImpl, confirmImpl, language = 'en' } = {}) {
  const nodes = new Map();
  nodes.set('main', { id: 'main', innerHTML: '', style: {} });
  const calls = [];
  const listeners = [];
  let lang = language;
  const context = {
    console, Promise, Date, Math, JSON, Number, String, Array, Object, Uint8Array,
    __demoMode: false,
    state: { view: 'intake_pilot', settings: { server_url: 'http://127.0.0.1:43123', bearer_token: 'synthetic-token', crewing_id: 'crew-synthetic' }, intakePilot: freshPilotState() },
    window: { crypto: { randomUUID: () => 'event-fixed-1', getRandomValues: (arr) => arr.fill(7) } },
    navigator: { clipboard: { writeText: async () => {} } },
    document: {
      getElementById(id) { return nodes.get(id) || null; },
      addEventListener(name, fn) { listeners.push({ name, fn }); },
    },
    FileReader: class {},
    getUiLang() { return lang; },
    setLang(value) { lang = value; },
    tr(key) { return key; },
    escapeHtml: esc, escapeAttr: esc,
    escapeJsString(value) { return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); },
    humanSize(bytes) { return `${bytes} B`; },
    inAppConfirm: async (...a) => (confirmImpl ? confirmImpl(...a) : true),
    async invoke(command, args) {
      calls.push({ command, args: structuredClone(args) });
      if (invokeImpl) { const handled = invokeImpl(command, args, calls); if (handled !== undefined) return handled; }
      return server.handle(command, args);
    },
    calls, nodes, listeners, server,
    setTimeout, clearTimeout, queueMicrotask,
  };
  vm.createContext(context);
  vm.runInContext(`${c3b1}\n${source}\nthis.__pilot = { pilotEnter, pilotLeave, renderIntakePilot, pilotLoadQueue, pilotOpenCard, pilotCloseCard, pilotCardRefreshAll, pilotCardLoad, pilotFactsLoad, pilotRanksLoad, pilotFactSubmit, pilotFactStartCorrection, pilotRankNow, pilotShortlistConfirm, pilotShortlistWithdraw, pilotCardKeydown, pilotDetail, cardT, PILOT_CARD_TEXT, PILOT_CARD_REFUSAL_TEXT, PILOT_CARD_OUTCOME_TEXT, PILOT_CARD_STALE_TEXT };`, context);
  return context;
}
// ===========================================================================
// No.632: an isolated copy of the PROFILE-SHORTLIST block.
//
// It is a separate sandbox from the candidate card for the reason the block is
// separate code: it renders inside the matching-profile screen, which the
// candidate card never enters. C3b-1 is loaded with it because the context
// helpers (`pilotExpected`, `pilotParseError`) live there, and C3b-2 because
// the row REUSES the six-element helpers No.623 already built rather than
// growing a second set of them.
// ===========================================================================
function makeProfileServer() {
  return {
    user: 'user-op-1',
    profileVersion: 2,
    items: [
      // in the selection, decided against the CURRENT version
      { id: 'dec-1', intake_id: 'intake-1', profile_version: 2, confirmed_by: 'user-op-1', confirmed_at: '2026-10-01T05:00:00',
        on_hold: false, held_by: null, held_at: null, in_selection: true, needs_recompare: false },
      // set aside
      { id: 'dec-2', intake_id: 'intake-2', profile_version: 2, confirmed_by: 'user-op-1', confirmed_at: '2026-10-01T05:01:00',
        on_hold: true, held_by: 'user-op-1', held_at: '2026-10-01T06:00:00', in_selection: false, needs_recompare: false },
      // decided against an OLDER version: the decision stands and is marked
      { id: 'dec-3', intake_id: 'intake-3', profile_version: 1, confirmed_by: 'user-op-1', confirmed_at: '2026-09-30T05:00:00',
        on_hold: false, held_by: null, held_at: null, in_selection: true, needs_recompare: true },
      // the row whose own details will not load
      { id: 'dec-4', intake_id: 'intake-4', profile_version: 2, confirmed_by: 'user-op-1', confirmed_at: '2026-10-01T05:03:00',
        on_hold: false, held_by: null, held_at: null, in_selection: true, needs_recompare: false },
    ],
    cards: {
      'intake-1': {
        intake_id: 'intake-1', receipt_id: 'r1', crewing_id: 'crew-synthetic', source: 'response', source_id: 's1', event_id: 'e1',
        primary_profile_id: null, content_sha256: 'x', content_bytes: 10, content_type: 'application/pdf', state: 'ranked',
        source_trust: 'unverified', version: 1, created_at: '2026-10-01T04:00:00', issued_at: '2026-10-01T04:00:00',
        objects: [], attachments: [{ ordinal: 0, filename: 'Ivan_CV.pdf', declared_type: 'application/pdf', measured_type: 'application/pdf', byte_size: 1200, verdict: 'accepted', reason: null, eligible: true }],
        summary: { facts: 0, ranks: 1, ranks_stale: 0, active_confirmations: 1 },
        response_summary: { rank: 'Master', rank_state: 'from_snapshot', first_name: 'Ivan', surname: 'Petrenko',
          age_years: 43, age_precision: 'day', citizenship: 'Ukrainian', citizenship_code: 'UKR',
          experience_rank: 'Master', experience_days: 520, experience_state: 'in_rank',
          last_vessel_name: 'MT Odesa Dawn', last_vessel_sign_off: '2026-07-01' },
      },
      'intake-2': {
        intake_id: 'intake-2', receipt_id: 'r2', crewing_id: 'crew-synthetic', source: 'response', source_id: 's2', event_id: 'e2',
        primary_profile_id: null, content_sha256: 'x', content_bytes: 10, content_type: 'application/pdf', state: 'ranked',
        source_trust: 'unverified', version: 1, created_at: '2026-09-30T04:00:00', issued_at: '2026-09-30T04:00:00',
        objects: [], attachments: [{ ordinal: 0, filename: 'Petro_CV.pdf', declared_type: 'application/pdf', measured_type: 'application/pdf', byte_size: 900, verdict: 'accepted', reason: null, eligible: true }],
        summary: { facts: 0, ranks: 1, ranks_stale: 0, active_confirmations: 1 },
        response_summary: { rank: 'Master', rank_state: 'from_snapshot', first_name: 'Petro', surname: 'Shevchuk',
          age_years: 39, age_precision: 'day', citizenship: 'Ukrainian', citizenship_code: 'UKR',
          experience_rank: 'Master', experience_days: 1160, experience_state: 'in_rank',
          last_vessel_name: 'MT Black Sea', last_vessel_sign_off: null },
      },
      // BORN OF E-MAIL: nine of the fourteen pilot cards are, and they carry no
      // response summary at all. Nothing may be drawn unconditionally over this.
      'intake-3': {
        intake_id: 'intake-3', receipt_id: 'r3', crewing_id: 'crew-synthetic', source: 'mail', source_id: 's3', event_id: 'e3',
        primary_profile_id: null, content_sha256: 'x', content_bytes: 10, content_type: 'message/rfc822', state: 'ranked',
        source_trust: 'unverified', version: 1, created_at: '2026-09-27T04:00:00', issued_at: '2026-09-27T04:00:00',
        objects: [], attachments: [],
        summary: { facts: 0, ranks: 1, ranks_stale: 0, active_confirmations: 1 },
      },
    },
    facts: {
      'intake-1': [{ field: 'name', versions: [{ value: 'Ivan Petrenko', version: 1, corrected_by: 'user-op-1' }] },
                   { field: 'contact:email', versions: [{ value: 'ivan.petrenko@example.com', version: 1, corrected_by: 'user-op-1' }] },
                   { field: 'contact:phone', versions: [{ value: '+380501112233', version: 1, corrected_by: 'user-op-1' }] }],
      'intake-2': [{ field: 'name', versions: [{ value: 'Petro Shevchuk', version: 1, corrected_by: 'user-op-1' }] },
                   { field: 'contact:email', versions: [{ value: 'petro@example.com', version: 1, corrected_by: 'user-op-1' }] },
                   { field: 'contact:phone', versions: [{ value: '+380502223344', version: 1, corrected_by: 'user-op-1' }] }],
      // e-mail only: no phone, so the number button is dark and SAYS so
      'intake-3': [{ field: 'name', versions: [{ value: 'Oleh Marchenko', version: 1, corrected_by: 'user-op-1' }] },
                   { field: 'contact:email', versions: [{ value: 'oleh@example.com', version: 1, corrected_by: 'user-op-1' }] }],
    },
    responseContacts: {},
    reject(status, detail) { return { kind: 'server', status, detail }; },
    handle(command, args) {
      const b = this;
      switch (command) {
        case 'crewing_intake_profile_shortlist': {
          if (args.profileId !== 'prof-A') throw b.reject(404, 'matching profile not found');
          return {
            profile_id: 'prof-A', profile_version: b.profileVersion, profile_state: 'active',
            items: b.items.map((i) => ({ ...i })),
            counts: {
              selected: b.items.length,
              in_selection: b.items.filter((i) => i.in_selection).length,
              on_hold: b.items.filter((i) => i.on_hold).length,
            },
          };
        }
        case 'crewing_intake_candidate_get': {
          const card = b.cards[args.intakeId];
          if (!card) throw b.reject(500, null);
          return { ...card };
        }
        case 'crewing_intake_fact_list': {
          const rows = b.facts[args.intakeId];
          if (!rows) throw b.reject(500, null);
          return { items: rows.map((r) => ({ ...r })) };
        }
        case 'crewing_intake_response_contact': {
          const rc = b.responseContacts ? b.responseContacts[args.intakeId] : undefined;
          // DEFAULT IS TODAY'S BEHAVIOUR: no entry means 404, which the card's own
          // grammar reads as "this letter carries no response binding".
          if (rc === undefined) throw b.reject(404, 'candidate intake not found');
          if (rc === 'failed') throw b.reject(500, null);
          return { value: rc.value, is_email: rc.is_email, offer_email: rc.offer_email };
        }
        case 'crewing_intake_shortlist_confirm': {
          return { profile_id: args.pair.profile_id, profile_version: args.pair.profile_version,
            confirmed_by: b.user, confirmed_at: '2026-10-01T08:00:00' };
        }
        case 'crewing_intake_shortlist_hold': {
          const row = b.items.find((i) => i.intake_id === args.intakeId);
          if (!row) throw b.reject(404, 'not_confirmed');
          if (row.on_hold) throw b.reject(409, 'already_on_hold');
          row.on_hold = true; row.held_by = b.user; row.held_at = '2026-10-01T07:00:00'; row.in_selection = false;
          return { id: row.id, intake_id: row.intake_id, profile_id: 'prof-A', profile_version: row.profile_version,
            confirmed_by: row.confirmed_by, confirmed_at: row.confirmed_at, on_hold: true, held_by: row.held_by,
            held_at: row.held_at, withdrawn_by: null, withdrawn_at: null };
        }
        case 'crewing_intake_shortlist_release': {
          const row = b.items.find((i) => i.intake_id === args.intakeId);
          if (!row) throw b.reject(404, 'not_confirmed');
          if (!row.on_hold) throw b.reject(409, 'not_on_hold');
          row.on_hold = false; row.held_by = null; row.held_at = null; row.in_selection = true;
          return null;
        }
        case 'crewing_intake_shortlist_withdraw': {
          const at = b.items.findIndex((i) => i.intake_id === args.intakeId);
          if (at < 0) throw b.reject(404, 'not_confirmed');
          b.items.splice(at, 1);
          return null;
        }
        case 'open_mailto': return null;
        default: throw new Error(`unexpected invoke ${command}`);
      }
    },
  };
}

function makeProfileContext({ server = makeProfileServer(), invokeImpl, language = 'en', profileId = 'prof-A', autoload = true } = {}) {
  if (!s632Source) throw new Error('No.632 block absent');
  const nodes = new Map();
  nodes.set('profile-shortlist-host', { id: 'profile-shortlist-host', innerHTML: '', style: {} });
  nodes.set('main', { id: 'main', innerHTML: '', style: {} });
  const calls = [];
  const copied = [];
  const toasts = [];
  let lang = language;
  const context = {
    console, Promise, Date, Math, JSON, Number, String, Array, Object, Uint8Array,
    __demoMode: false,
    state: {
      view: 'compliance',
      settings: { server_url: 'http://127.0.0.1:43123', bearer_token: 'synthetic-token', crewing_id: 'crew-synthetic' },
      intakePilot: freshPilotState(),
      selectedComplianceProfile: { id: profileId, name: 'Master — Crude Oil Tanker', version: 2, status: 'active' },
    },
    window: { crypto: { randomUUID: () => 'event-fixed-1', getRandomValues: (arr) => arr.fill(7) } },
    navigator: { clipboard: { writeText: async (text) => { copied.push(text); } } },
    // `querySelector` exists here because of a defect the vm could not see: the
    // section re-renders on every keystroke, which REPLACES the input the
    // operator is typing into, and only the first character ever landed. The
    // fake element records focus and caret calls so the fix is measurable.
    document: {
      getElementById(id) { return nodes.get(id) || null; },
      querySelector(sel) {
        if (!/profile-letter-to/.test(String(sel))) return null;
        if (!nodes.has('__to_input')) {
          nodes.set('__to_input', { value: '', selectionStart: 0, focused: 0, caret: [],
            focus() { this.focused += 1; }, setSelectionRange(a) { this.caret.push(a); } });
        }
        return nodes.get('__to_input');
      },
      addEventListener() {},
    },
    FileReader: class {},
    getUiLang() { return lang; },
    tr(key) { return key; },
    escapeHtml: esc, escapeAttr: esc,
    escapeJsString(value) { return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); },
    humanSize(bytes) { return `${bytes} B`; },
    showToast(msg, kind) { toasts.push({ msg, kind }); },
    inAppConfirm: async () => true,
    async invoke(command, args) {
      calls.push({ command, args: structuredClone(args) });
      if (invokeImpl) { const handled = invokeImpl(command, args, calls); if (handled !== undefined) return handled; }
      return server.handle(command, args);
    },
    calls, nodes, server, copied, toasts,
    setTimeout, clearTimeout, queueMicrotask,
  };
  vm.createContext(context);
  vm.runInContext(`${c3b1Source}\n${c3b2Source}\n${s632Source}\nthis.__s632 = { profileShortlistLoad, profileShortlistSectionHtml, profileShortlistRerender, profileShortlistHold, profileShortlistRelease, profileShortlistRemove, profileShortlistEmail, profileShortlistCopyPhone, profileShortlistStateFor, profileShortlistT };
this.__s632b = {
  ensure: typeof profileShortlistEnsure === 'function' ? profileShortlistEnsure : null,
  invalidate: typeof profileShortlistInvalidate === 'function' ? profileShortlistInvalidate : null,
  confirm: pilotShortlistConfirm, withdraw: pilotShortlistWithdraw,
};
this.__s632c = {
  prepare: typeof profileLetterPrepare === 'function' ? profileLetterPrepare : null,
  pick: typeof profileLetterPick === 'function' ? profileLetterPick : null,
  unpick: typeof profileLetterUnpick === 'function' ? profileLetterUnpick : null,
  setTo: typeof profileLetterSetTo === 'function' ? profileLetterSetTo : null,
  setBody: typeof profileLetterSetBody === 'function' ? profileLetterSetBody : null,
  editToggle: typeof profileLetterEditToggle === 'function' ? profileLetterEditToggle : null,
  compose: typeof profileLetterCompose === 'function' ? profileLetterCompose : null,
  seaTime: typeof profileLetterSeaTime === 'function' ? profileLetterSeaTime : null,
  section: typeof profileLetterSectionHtml === 'function' ? profileLetterSectionHtml : null,
};`, context);
  if (autoload) { context.__s632.profileShortlistLoad(profileId); }
  return context;
}

async function flush(rounds = 6) {
  for (let i = 0; i < rounds; i += 1) { await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); }
}
const main = (ctx) => ctx.nodes.get('main').innerHTML;
const detail = (ctx) => ctx.state.intakePilot.detail;
const attempts = (ctx) => detail(ctx).attempts;
const mutationCalls = (ctx) => ctx.calls.filter((c) => /fact_record|fact_correct|candidate_rank|shortlist_confirm|shortlist_withdraw/.test(c.command));
function rankRow(ctx, profileId, version) {
  const re = new RegExp(`<div class="pilot-rank-row" data-qa="pilot-rank-row" data-profile="${profileId}" data-version="${version}">([\\s\\S]*?)<div class="pilot-actions">`);
  const m = re.exec(main(ctx));
  return m ? m[1] : null;
}
function historyRow(ctx, id) {
  const re = new RegExp(`<div class="pilot-history-row" data-qa="pilot-history-row" data-id="${id}">([\\s\\S]*?)</div></div>`);
  const m = re.exec(main(ctx));
  return m ? m[1] : null;
}
async function openCard(ctx, intakeId = 'intake-A') { ctx.__pilot.pilotOpenCard(intakeId); await flush(); }
async function positiveChainUntilRank(ctx) {
  await openCard(ctx);
  const d = detail(ctx);
  d.form = { mode: 'record', field: 'rank', value: 'Mastre', source_object: 'obj-1', page: '1', span: '' };
  await ctx.__pilot.pilotFactSubmit(); await flush();
  ctx.__pilot.pilotFactStartCorrection('rank');
  detail(ctx).form.value = 'Master'; detail(ctx).form.source_object = 'obj-1';
  await ctx.__pilot.pilotFactSubmit(); await flush();
  detail(ctx).form = { mode: 'record', field: 'certificate:coc_master', value: 'held', source_object: 'obj-2', page: '', span: '' };
  await ctx.__pilot.pilotFactSubmit(); await flush();
  await ctx.__pilot.pilotRankNow(); await flush();
}
// C3c-1: the mobile shell sets state.view = 'mobile-<view>' and renders into #mobile-main
// (#main is display:none under body.mobile-shell). Same renderers, mobile container.
function mobilize(ctx) {
  ctx.nodes.set('mobile-main', { id: 'mobile-main', innerHTML: '', style: {} });
  ctx.state.view = 'mobile-intake_pilot';
  return ctx;
}
const mobileContext = (opts = {}) => mobilize(makeContext(opts));
const mobileMain = (ctx) => ctx.nodes.get('mobile-main').innerHTML;
async function mobileCardChain(ctx) {
  ctx.__pilot.pilotEnter(); await flush();
  assert.ok(/data-qa="crewing-intake-pilot-view"/.test(mobileMain(ctx)), 'pilot queue view rendered into #mobile-main under the mobile shell');
  assert.equal(main(ctx), '', 'nothing rendered into the hidden desktop #main');
  assert.ok(!ctx.state.intakePilot.queueLoading && ctx.state.intakePilot.queueLastUpdated !== null && /data-qa="pilot-open-card"/.test(mobileMain(ctx)), 'queue load completed under the mobile view (context still current)');
  await openCard(ctx);
  assert.ok(/data-qa="crewing-intake-card-view" data-intake="intake-A"/.test(mobileMain(ctx)) && detail(ctx).card !== null && /data-qa="pilot-section-facts"/.test(mobileMain(ctx)) && /data-qa="pilot-section-ranks"/.test(mobileMain(ctx)) && /data-qa="pilot-section-history"/.test(mobileMain(ctx)), 'card with its three sections rendered into #mobile-main');
  ctx.__pilot.pilotCardKeydown({ key: 'Escape' }); await flush();
  assert.ok(detail(ctx) === null && /data-qa="crewing-intake-pilot-view"/.test(mobileMain(ctx)), 'Escape closes the mobile card back to the queue');
}

console.log('# positive chain on isolated copies: card → facts → correction → rank → confirm → withdraw → re-add');
{
  const ctx = makeContext();
  ctx.__pilot.pilotEnter(); await flush();
  ok(/data-qa="pilot-open-card"/.test(main(ctx)) && /pilotOpenCard\('intake-A'\)/.test(main(ctx)), 'queue row renders an Open control wired to the exact intake id');
  await openCard(ctx);
  ok(/data-qa="crewing-intake-card-view" data-intake="intake-A"/.test(main(ctx)), 'card view replaces the queue for the opened intake');
  // No.621 makes this FIVE: the delivered response contact is fetched with the
  // card, by its own route, once per opened card. The set stays pinned - the point
  // of this line is that a card issues exactly these reads and no others.
  ok(ctx.calls.slice(-5).map((c) => c.command).sort().join(',') === 'crewing_intake_candidate_get,crewing_intake_fact_list,crewing_intake_matching_profile_list,crewing_intake_rank_list,crewing_intake_response_contact', 'opening a card issues exactly the five typed reads (No.621 added the response contact) — got ' + ctx.calls.slice(-5).map((c) => c.command).sort().join(','));
  ok(/Document unverified · synthetic data only/.test(main(ctx)), 'source trust is shown as unverified, not as a scan certificate');
  ok(/data-qa="pilot-object">obj-1 · text\/plain/.test(main(ctx)) && /obj-2 · application\/pdf/.test(main(ctx)), 'objects list shows only id and content type');
  ok(/data-qa="pilot-facts-empty"/.test(main(ctx)) && /data-qa="pilot-ranks-empty"/.test(main(ctx)) && /data-qa="pilot-history-empty"/.test(main(ctx)), 'empty successful reads render as empty, not as errors');
  ok(/data-qa="pilot-unranked"/.test(main(ctx)) && /Master · A \(prof-A\)/.test(main(ctx)), 'active profiles without a stored comparison are listed as gaps');
  const d = detail(ctx);
  d.form = { mode: 'record', field: 'rank', value: 'Mastre', source_object: 'obj-1', page: '1', span: '' };
  await ctx.__pilot.pilotFactSubmit(); await flush();
  const rec = ctx.calls.find((c) => c.command === 'crewing_intake_fact_record');
  ok(rec && rec.args.intakeId === 'intake-A' && JSON.stringify(rec.args.fact) === JSON.stringify({ field: 'rank', value: 'Mastre', source_object: 'obj-1', page: 1, span: null }), 'fact record dispatches the typed body with the selected object and numeric page');
  ok(!('confidence' in rec.args.fact) && !('uncertainty' in rec.args.fact) && !('corrected_by' in rec.args.fact), 'no confidence/uncertainty/actor is sent by the client');
  ok(attempts(ctx)[0].outcome === 'acked' && attempts(ctx)[0].readback === 'ok', 'fact record is ACKED and read back');
  ok(/data-qa="pilot-fact-field" data-field="rank"/.test(main(ctx)) && /data-version="1"/.test(main(ctx)) && /Entered by a team member/.test(main(ctx)) && /Team member user-op-1/.test(main(ctx)), 'fact version 1 renders with operator origin and seat user id');
  ctx.__pilot.pilotFactStartCorrection('rank');
  ok(/data-qa="pilot-correcting"/.test(main(ctx)) && /readonly/.test(main(ctx)), 'correction mode fixes the field');
  detail(ctx).form.value = 'Master'; detail(ctx).form.source_object = 'obj-1';
  await ctx.__pilot.pilotFactSubmit(); await flush();
  const corr = ctx.calls.find((c) => c.command === 'crewing_intake_fact_correct');
  ok(corr && corr.args.field === 'rank' && corr.args.fact.field === 'rank' && corr.args.fact.value === 'Master', 'correction dispatches the same field in path and body');
  const rankField = /data-field="rank">([\s\S]*?)<\/div><\/div><div class="pilot-fact-field"|data-field="rank">([\s\S]*?)$/.exec(main(ctx));
  ok(/data-version="2"[\s\S]*Master[\s\S]*data-version="1"[\s\S]*Mastre/.test(main(ctx)), 'version 2 is shown newest-first with version 1 preserved underneath');
  detail(ctx).form = { mode: 'record', field: 'certificate:coc_master', value: 'held', source_object: 'obj-2', page: '', span: '' };
  await ctx.__pilot.pilotFactSubmit(); await flush();
  ok(ctx.calls.filter((c) => c.command === 'crewing_intake_candidate_rank').length === 0, 'no ranking runs before the explicit button');
  await ctx.__pilot.pilotRankNow(); await flush();
  const rank = ctx.calls.find((c) => c.command === 'crewing_intake_candidate_rank');
  ok(rank && Object.keys(rank.args).sort().join(',') === 'expectedContext,intakeId', 'rank is an explicit typed action with no profile filter');
  ok(/Ranking request completed: Ranking completed · 3\/3/.test(main(ctx)), 'rank ACK reports completion of the request, not freshness');
  const rowA = rankRow(ctx, 'prof-A', 1), rowB = rankRow(ctx, 'prof-B', 1), rowC = rankRow(ctx, 'prof-C', 1);
  ok(rowA && rowB && rowC, 'three stored comparisons render');
  ok(/data-group="met" data-requirement="rank"/.test(rowA) && /data-group="met" data-requirement="certificate:coc_master"/.test(rowA) && /Every stated requirement is compared; this is not a suitability/.test(rowA), 'A: rank and certificate met; decided text carries no suitability claim');
  ok(/data-group="missing" data-requirement="rank"[^<]*Requirement not met · wanted: Chief Officer · entered: Master/.test(rowB), 'B: rank missing with literal wanted/found');
  ok(/data-group="unconfirmed" data-requirement="certificate:radio_operator"[^<]*Fact not entered/.test(rowC) && !/data-group="missing" data-requirement="certificate:radio_operator"/.test(rowC), 'C: unconfirmed fact stays unconfirmed, never rendered as missing');
  ok([rowA, rowB, rowC].every((r) => /data-qa="pilot-rank-freshness">Fact freshness for this comparison is unverified/.test(r)), 'every stored comparison states fact freshness is unverified');
  ok([rowA, rowB, rowC].every((r) => /Profile version used: 1/.test(r) && /(Master|Chief Officer) · [ABC] <span class="pilot-note">\(prof-[ABC] · current version 1 · state active\)/.test(r)), 'rows show the profile version used and the current profile name/version/state');
  ok(!/data-qa="pilot-unranked"/.test(main(ctx)), 'no unranked gap remains after ranking every active profile');
  ok(/quarantined|ranked/.test(main(ctx)) && /Document unverified · synthetic data only/.test(main(ctx)), 'ranked state does not upgrade source trust');
  // confirm a decided=false pair (B)
  await ctx.__pilot.pilotShortlistConfirm('prof-B', 1); await flush();
  const confirm = ctx.calls.find((c) => c.command === 'crewing_intake_shortlist_confirm');
  ok(confirm && JSON.stringify(confirm.args.pair) === JSON.stringify({ profile_id: 'prof-B', profile_version: 1 }), 'confirm sends exactly the viewed pair');
  ok(attempts(ctx).slice(-1)[0].outcome === 'acked', 'a decided=false pair can be shortlisted for further consideration');
  const hist1 = historyRow(ctx, 'decision-1');
  ok(hist1 && /Active decision/.test(hist1) && /Team member user-op-1/.test(hist1) && /Profile version used: 1/.test(hist1) && /UTC/.test(hist1), 'history shows id, seat user, UTC time, pair and active state');
  ok(/data-group="missing" data-requirement="rank"/.test(rankRow(ctx, 'prof-B', 1)) && /data-qa="pilot-withdraw"/.test(main(ctx)), 'after confirmation the missing reason and freshness caveat remain; withdraw is offered');
  ok(/Decision history · original comparison was not preserved/.test(main(ctx)), 'history header states the original comparison is not preserved');
  // double confirm -> already_confirmed
  await ctx.__pilot.pilotShortlistConfirm('prof-B', 1); await flush();
  ok(attempts(ctx).slice(-1)[0].outcome === 'refused' && /data-qa="pilot-attempt-refused">Already on the shortlist/.test(main(ctx)), 'already_confirmed is a refusal with the domain text, not a generic 409');
  // close / reopen -> server persistence
  ctx.__pilot.pilotCloseCard(); await flush();
  ok(/data-qa="crewing-intake-pilot-view"/.test(main(ctx)) && ctx.state.intakePilot.detail === null, 'Back returns to the queue view and clears the card state');
  await openCard(ctx);
  ok(historyRow(ctx, 'decision-1') !== null && attempts(ctx).length === 0, 'reopen reads history from the server with a fresh attempt ledger');
  await ctx.__pilot.pilotShortlistWithdraw('prof-B', 1); await flush();
  const withdraw = ctx.calls.find((c) => c.command === 'crewing_intake_shortlist_withdraw');
  ok(withdraw && JSON.stringify(withdraw.args.pair) === JSON.stringify({ profile_id: 'prof-B', profile_version: 1 }) && attempts(ctx).slice(-1)[0].outcome === 'acked', 'withdraw 204 (null result) is ACKED without any JSON');
  ok(/Withdrawn: Team member user-op-1/.test(historyRow(ctx, 'decision-1')), 'withdrawn row stays in history with withdrawn_by/at');
  await ctx.__pilot.pilotShortlistConfirm('prof-B', 1); await flush();
  ok(historyRow(ctx, 'decision-2') !== null && historyRow(ctx, 'decision-1') !== null, 're-adding creates a second decision row with a distinct id while the first remains');
  ok(ctx.state.intakePilot.detail.card.summary.active_confirmations === 1, 'card read-back shows one active confirmation');
  // Escape closes only outside dialogs
  ctx.__pilot.pilotCardKeydown({ key: 'Escape' }); await flush();
  ok(ctx.state.intakePilot.detail === null, 'Escape returns to the queue');
}

console.log('# RU/EN, nullable values, unknown codes and refusal precedence');
{
  const ctx = makeContext({ language: 'ru' });
  await positiveChainUntilRank(ctx);
  ok(/Карточка кандидата/.test(main(ctx)) && /Сведения и источники/.test(main(ctx)) && /Сохранённые оценки/.test(main(ctx)) && /История решений · исходная оценка не сохранена/.test(main(ctx)), 'Russian section titles');
  ok(/Актуальность фактов для этой оценки не подтверждена/.test(main(ctx)) && /Версия профиля в оценке: 1/.test(main(ctx)) && /Сведения не внесены/.test(main(ctx)) && /Введено сотрудником/.test(main(ctx)) && /Запрос пересчёта выполнен/.test(main(ctx)) && /Добавить в шортлист для дальнейшего рассмотрения/.test(main(ctx)) && /Документ не проверен · только синтетические данные/.test(main(ctx)), 'Russian mandatory honesty strings');
  detail(ctx).form.value = 'draft survives'; ctx.setLang('en'); ctx.__pilot.renderIntakePilot();
  ok(/Fact freshness for this comparison is unverified/.test(main(ctx)) && /draft survives/.test(main(ctx)), 'language switch re-renders in English and keeps the form draft');
  const s = ctx.server;
  s.profiles[0].version = 2; s.profiles[2].state = 'paused'; s.profiles.push({ id: 'prof-D', crewing_id: 'crew-synthetic', name: 'Bosun · D', version: 1, state: 'active', rank: 'Bosun', certs: null });
  s.facts.rank.unshift({ field: 'rank', value: '', version: 3, source_object: 'obj-1', page: 0, span: null, confidence: 0, uncertainty: 'future_code', corrected_by: null, created_at: '2026-09-23T01:09:00' });
  s.ranks.push({ profile_id: 'prof-B', profile_version: 1, primary: true, met: [], missing: [], unconfirmed: [], reasons: [{ requirement: 'future:thing', outcome: 'future_outcome', wanted: null, found: null }], decided: false });
  s.ranks.splice(1, 1);
  await ctx.__pilot.pilotCardRefreshAll(); await flush();
  ok(/data-qa="pilot-rank-stale">Profile changed — compare again/.test(rankRow(ctx, 'prof-A', 1)), 'profile_version staleness has its own badge');
  ok(/data-qa="pilot-rank-stale">Profile is not active/.test(rankRow(ctx, 'prof-C', 1)), 'profile_not_active staleness has its own badge');
  ok(/Bosun · D \(prof-D\)/.test(main(ctx)), 'a profile created after the run is listed as unranked');
  ok(/data-version="3"[\s\S]*?data-qa="pilot-fact-confidence">confidence 0<\/span> · Unknown reason: future_code/.test(main(ctx)), 'confidence 0 renders as measured zero and an unknown uncertainty code stays visible');
  ok(/data-version="2"[\s\S]*?confidence unknown/.test(main(ctx)), 'confidence null renders as unknown');
  ok(/data-group="unknown" data-requirement="future:thing"[^<]*Unknown result: future_outcome/.test(rankRow(ctx, 'prof-B', 1)) && /primary profile/.test(rankRow(ctx, 'prof-B', 1)), 'unknown outcome is shown as unknown, and primary is labelled');
  ok(/Profile changed — compare again/.test(rankRow(ctx, 'prof-A', 1)) && /data-qa="pilot-rank-freshness"/.test(rankRow(ctx, 'prof-A', 1)), 'profile staleness and fact freshness are two separate statements');
  // refusal precedence: domain code before generic 404/403
  await ctx.__pilot.pilotShortlistConfirm('prof-D', 1); await flush();
  ok(/data-qa="pilot-attempt-refused">This candidate has not been scored for this compliance profile/.test(main(ctx)) && !/Section unavailable/.test(main(ctx)), 'rank_not_found 404 is the domain refusal, not "section unavailable"');
  await ctx.__pilot.pilotShortlistConfirm('prof-A', 1); await flush();
  ok(/data-qa="pilot-attempt-refused">The compliance profile has changed — compare again/.test(main(ctx)), 'profile_version_stale 409');
  await ctx.__pilot.pilotShortlistConfirm('prof-C', 1); await flush();
  ok(/data-qa="pilot-attempt-refused">The compliance profile is not active/.test(main(ctx)), 'profile_not_active 409');
  s.user = 'user-op-2';
  await ctx.__pilot.pilotShortlistConfirm('prof-B', 1); await flush();
  s.user = 'user-op-1';
  await ctx.__pilot.pilotShortlistWithdraw('prof-B', 1); await flush();
  ok(/data-qa="pilot-attempt-refused">Only the person who confirmed it, or an administrator, can withdraw/.test(main(ctx)) && historyRow(ctx, 'decision-1') && /Active decision/.test(historyRow(ctx, 'decision-1')), 'withdraw_not_permitted 403 keeps the refusal and the other member\'s active decision');
  ok(/Team member user-op-2/.test(historyRow(ctx, 'decision-1')), 'history labels the confirming seat by user id, not by name or token');
  // generic 403 (named seat) and flag-off 404 still map generically
  const ctx403 = makeContext({ invokeImpl: (command) => (command === 'crewing_intake_fact_record' ? Promise.reject({ kind: 'server', status: 403, detail: 'not authorised for this crewing', ambiguous: false }) : undefined) });
  await openCard(ctx403); detail(ctx403).form = { mode: 'record', field: 'rank', value: 'x', source_object: 'obj-1', page: '', span: '' };
  await ctx403.__pilot.pilotFactSubmit(); await flush();
  ok(/data-qa="pilot-attempt-refused">Access denied\./.test(main(ctx403)) && !/data-qa="pilot-fact-field"/.test(main(ctx403)), 'company-wide token write 403 is an honest refusal with no fact shown');
  const ctx404 = makeContext({ invokeImpl: () => Promise.reject({ kind: 'server', status: 404, detail: 'Not Found', ambiguous: false }) });
  await openCard(ctx404);
  ok(/data-qa="pilot-card-error">Card could not be loaded\. Section unavailable\./.test(main(ctx404)) && /data-qa="pilot-facts-error"/.test(main(ctx404)) && /data-qa="pilot-ranks-error"/.test(main(ctx404)) && !/data-qa="pilot-facts-empty"/.test(main(ctx404)), 'flag-off 404 reads are errors, never successful empties');
  const ctx422 = makeContext({ invokeImpl: (command) => (command === 'crewing_intake_fact_record' ? Promise.reject({ kind: 'server', status: 422, detail: 'fact_no_source_object', ambiguous: false }) : undefined) });
  await openCard(ctx422); detail(ctx422).form = { mode: 'record', field: 'rank', value: 'x', source_object: 'obj-1', page: '', span: '' };
  await ctx422.__pilot.pilotFactSubmit(); await flush();
  ok(/A fact must cite a document of THIS candidate/.test(main(ctx422)), 'fact_no_source_object 422 uses the domain text');
  const ctxList = makeContext({ invokeImpl: (command) => (command === 'crewing_intake_fact_record' ? Promise.reject({ kind: 'server', status: 422, detail: null, ambiguous: false }) : undefined) });
  await openCard(ctxList); detail(ctxList).form = { mode: 'record', field: 'rank', value: 'x', source_object: 'obj-1', page: '', span: '' };
  await ctxList.__pilot.pilotFactSubmit(); await flush();
  ok(/Server refused the request \(422\)/.test(main(ctxList)), 'a list/unknown detail is not printed as a code');
  const ctxNoObj = makeContext(); ctxNoObj.server.card.objects = [];
  await openCard(ctxNoObj);
  ok(/data-qa="pilot-no-objects"/.test(main(ctxNoObj)) && !/data-qa="pilot-fact-form"/.test(main(ctxNoObj)), 'a card without objects blocks fact entry with an explanation');
  detail(ctxNoObj).form = { mode: 'record', field: 'rank', value: 'x', source_object: 'obj-foreign', page: '', span: '' };
  await ctxNoObj.__pilot.pilotFactSubmit(); await flush();
  ok(mutationCalls(ctxNoObj).length === 0, 'a foreign object id is refused before any dispatch');
  const ctxProfiles = makeContext({ invokeImpl: (command) => (command === 'crewing_intake_matching_profile_list' ? Promise.reject({ kind: 'server', status: 403, detail: 'token scope denied', ambiguous: false }) : undefined) });
  await positiveChainUntilRank(ctxProfiles);
  ok(/Profile prof-A; name unavailable/.test(main(ctxProfiles)) && /data-qa="pilot-profiles-unavailable"/.test(main(ctxProfiles)) && rankRow(ctxProfiles, 'prof-A', 1), 'profile lookup 403 keeps facts/ranks usable with an honest id fallback');
  const ctxBig = makeContext(); await openCard(ctxBig);
  await ctxBig.__pilot.pilotShortlistConfirm('prof-A', 9007199254740993); await flush();
  ok(mutationCalls(ctxBig).length === 0 && /data-qa="pilot-form-error"/.test(main(ctxBig)), 'an unsafe integer version is refused rather than rounded onto another pair');
}

console.log('# fences: pending, context change, A→B, A→B→A, request identity');
{
  const ctx = makeContext(); await openCard(ctx);
  const gate = deferred();
  ctx.server.handle = ((orig) => function (command, args) { if (command === 'crewing_intake_candidate_rank') return gate.promise; return orig.call(this, command, args); })(ctx.server.handle);
  const first = ctx.__pilot.pilotRankNow(); const second = ctx.__pilot.pilotRankNow();
  ok(mutationCalls(ctx).length === 1 && /data-qa="pilot-rank-now"[^>]*disabled/.test(main(ctx)), 'duplicate clicks dispatch one write and the button is disabled while pending');
  gate.resolve({ ranked: 0, written: 0, reason: 'no_active_profiles', profiles: [] }); await first; await second; await flush();
  ok(/Ranking request completed: No active compliance profiles · 0\/0/.test(main(ctx)) && attempts(ctx)[0].outcome === 'acked', 'no_active_profiles is a successful answer without a computation, not a refusal');
}
{
  const ctx = makeContext(); await openCard(ctx);
  detail(ctx).form.value = 'typed';
  const previous = ctx.state.settings; const next = { ...previous, bearer_token: 'other' }; ctx.state.settings = next;
  vm.runInContext('pilotSettingsChanged', ctx)(previous, next); await flush();
  ok(ctx.state.intakePilot.detail === null, 'settings save purges the card, form and outcomes');
}
{
  const ctx = makeContext(); await openCard(ctx);
  const gate = deferred();
  ctx.server.handle = ((orig) => function (command, args) { if (command === 'crewing_intake_fact_record') return gate.promise; return orig.call(this, command, args); })(ctx.server.handle);
  detail(ctx).form = { mode: 'record', field: 'rank', value: 'x', source_object: 'obj-1', page: '', span: '' };
  const pending = ctx.__pilot.pilotFactSubmit();
  ctx.__pilot.pilotCloseCard(); await openCard(ctx);
  gate.resolve({ field: 'rank', value: 'x', version: 1, source_object: 'obj-1', created_at: '2026' }); await pending; await flush();
  ok(attempts(ctx).length === 0 && detail(ctx).pending === false, 'a write answered after close/reopen does not appear in the new card ledger');
}

// ---------------------------------------------------------------------------
// C3c-1: pilot screens inside the mobile shell (Android). One entry: a tile in
// the mobile Apps grid with a NON-canonical hook; the 5-slot rail is untouched.
// ---------------------------------------------------------------------------
console.log('# C3c-1 mobile shell: view intake_pilot reachable and renders the card');
{
  const ctx = mobileContext();
  await mobileCardChain(ctx);
  ok(true, 'mobile shell: queue → card → Escape chain runs on the same renderers inside #mobile-main');
  const desktop = makeContext(); desktop.__pilot.pilotEnter(); await flush(); await openCard(desktop);
  ok(/data-qa="crewing-intake-card-view"/.test(main(desktop)) && desktop.nodes.get('mobile-main') === undefined, 'desktop view still renders into #main');
  const slice = (from, to) => { const a = html.indexOf(from); assert.ok(a > 0, `anchor missing: ${from}`); const b = html.indexOf(to, a); assert.ok(b > a, `end anchor missing: ${to}`); return html.slice(a, b); };
  const mobileShowSource = slice('function mobileShow(view) {', '\nfunction mobileBack()');
  ok(/if \(view === 'intake_pilot'\) return mobileRenderIntakePilot\(\);/.test(mobileShowSource), 'mobileShow routes intake_pilot to the mobile pilot renderer');
  ok(/if \(pilotIsHostView\(mobileState\.view\) && !pilotIsHostView\(view\)\) pilotLeave\(\);/.test(mobileShowSource), 'leaving every mobile pilot host view resets pilot state (pilotLeave; K2 hosts are intake_pilot + crew_flow)');
  ok(/function mobileRenderIntakePilot\(\)\{ pilotEnter\(\); \}/.test(html), 'mobile pilot renderer is pilotEnter on the same C3b-1/C3b-2 renderers (no second renderer)');
  const tiles = slice('function appsMobileModuleTilesHtml()', '\nfunction appsLauncherHtml()');
  // K2 (OWNER (654)/(658)): the pilot lost its Apps tile — it is entered only
  // from Crew Flow, which still gives it no canonical rail/module-tile hook.
  ok(!/view:'intake_pilot'/.test(tiles), 'the mobile Apps grid no longer carries an intake_pilot tile');
  ok(/data-qa="crew-flow-open-pilot"/.test(html), 'the pilot is entered from Crew Flow (crew-flow-open-pilot)');
  ok(!html.includes('bottom-nav-intake_pilot') && !html.includes('apps-module-tile-intake_pilot') && !html.includes('apps-pilot-tile-intake_pilot'), 'the pilot claims no canonical rail slot or module-tile hook');
  ok(/var MOBILE_RAIL_QA = \{ crew_flow: 'bottom-nav-crew_flow', compliance: 'bottom-nav-compliance', seafarers: 'bottom-nav-seafarers' \};/.test(html), 'rail QA map is the three K2.2 slots (K2 composition minus documents/apps, owner 2026-09-27)');
  const chrome = slice('function mobileRenderChrome(view) {', '\nfunction mobileParentView');
  ok((chrome.match(/mobileNavButton\('/g) || []).length === 3 && !chrome.includes("mobileNavButton('intake_pilot'"), 'rail renders exactly 3 slots (K2.2), none for intake_pilot');
  ok(/intake_pilot: 'crew_flow',/.test(slice('function mobileParentView(view) {', '\n}')), 'mobile Back from the pilot returns to Crew Flow (K2.2 B1: Apps is retired, Back must not reach it)');
  ok(/intake_pilot: 'nav\.intake_pilot',/.test(slice('function mobileModuleLabel(view) {', '\n}')), 'tile label uses the localized nav.intake_pilot string (RU/EN)');
  ok(html.includes("if (view === 'intake_pilot') return [tr('nav.intake_pilot'), mobileApiHostLabel()];"), 'mobile header title is nav.intake_pilot with the API host as subtitle');
  ok(/@media \(max-width: 980px\) \{ \.pilot-grid \{ grid-template-columns:1fr; \} \}/.test(html), 'narrow layout: pilot grid collapses to one column');
}

// ---------------------------------------------------------------------------
// M01–M12, M15, M16, M17–M19: isolated mutation controls. Each row: known-good GREEN,
// mutant RED, clean restore GREEN. Every anchor must be unique in the block.
// M13/M14 and the native half of M15 live in `cargo test` (send_no_content).
// ---------------------------------------------------------------------------
function mutate(source, edits) {
  let out = source;
  for (const [anchor, replacement] of edits) {
    const count = out.split(anchor).length - 1;
    assert.equal(count, 1, `mutation anchor must occur exactly once (found ${count}): ${anchor.slice(0, 70)}`);
    out = out.replace(anchor, replacement);
  }
  assert.notEqual(out, source, 'mutant differs from the clean source');
  return out;
}
const controls = [
  {
    id: 'M01', defect: 'after rerank UNKNOWN freshness replaced by "current"',
    edits: [["  return '<div class=\"pilot-card-freshness\" data-qa=\"pilot-rank-freshness\">'+escapeHtml(cardT('freshness_unverified'))+'</div>';",
      "  var __d = pilotDetail(); if (__d && __d.attempts.some(function(a){ return a.op === 'rank' && a.outcome === 'acked'; })) return '<div data-qa=\"pilot-rank-current\">current</div>';\n  return '<div class=\"pilot-card-freshness\" data-qa=\"pilot-rank-freshness\">'+escapeHtml(cardT('freshness_unverified'))+'</div>';"]],
    async sensor(ctx) {
      await positiveChainUntilRank(ctx); await ctx.__pilot.pilotRankNow(); await flush();
      assert.ok(attempts(ctx).slice(-1)[0].outcome === 'acked', 'rerank acked');
      const row = rankRow(ctx, 'prof-A', 1);
      assert.ok(/data-qa="pilot-rank-freshness">Fact freshness for this comparison is unverified/.test(row), 'freshness stays unverified after rerank ACK and GET');
      assert.ok(!/pilot-rank-current/.test(main(ctx)), 'no "current" marker anywhere');
    },
  },
  {
    id: 'M02', defect: 'unconfirmed_fact placed into missing',
    edits: [["unconfirmed_requirement:'unconfirmed', unconfirmed_fact:'unconfirmed' };", "unconfirmed_requirement:'unconfirmed', unconfirmed_fact:'missing' };"]],
    async sensor(ctx) {
      await positiveChainUntilRank(ctx);
      const row = rankRow(ctx, 'prof-C', 1);
      assert.ok(/data-group="unconfirmed" data-requirement="certificate:radio_operator"[^<]*Fact not entered/.test(row), 'unknown fact stays in the unconfirmed list');
      assert.ok(!/data-group="missing" data-requirement="certificate:radio_operator"/.test(row), 'no negative statement for an unknown fact');
    },
  },
  {
    id: 'M03', defect: 'unconfirmed_requirement placed into missing',
    edits: [["unconfirmed_requirement:'unconfirmed', unconfirmed_fact:'unconfirmed' };", "unconfirmed_requirement:'missing', unconfirmed_fact:'unconfirmed' };"]],
    async sensor(ctx) {
      ctx.server.profiles.push({ id: 'prof-N', crewing_id: 'crew-synthetic', name: 'No certs · N', version: 1, state: 'active', rank: 'Master', certs: null });
      await positiveChainUntilRank(ctx);
      const row = rankRow(ctx, 'prof-N', 1);
      assert.ok(/data-group="unconfirmed" data-requirement="mandatory_certs"[^<]*Requirement not stated in the profile/.test(row), 'unstated requirement stays a separate unknown');
      assert.ok(!/data-group="missing" data-requirement="mandatory_certs"/.test(row), 'unstated requirement is not counted as violated');
    },
  },
  {
    id: 'M04', defect: 'correction hides previous version N',
    edits: [["versions.map(function(v, index){ return pilotCardFactVersionHtml(v, index === 0); }).join('')", "versions.slice(0, 1).map(function(v, index){ return pilotCardFactVersionHtml(v, index === 0); }).join('')"]],
    async sensor(ctx) {
      await positiveChainUntilRank(ctx);
      assert.ok(/data-version="2"[\s\S]*?data-qa="pilot-fact-value">Master</.test(main(ctx)), 'version 2 visible');
      assert.ok(/data-version="1"[\s\S]*?data-qa="pilot-fact-value">Mastre</.test(main(ctx)), 'version 1 with its old value visible underneath');
    },
  },
  {
    id: 'M05', defect: 'confidence=null displayed as 0',
    edits: [["  if (confidence == null) return escapeHtml(cardT('confidence_unknown'));", "  confidence = confidence || 0;"]],
    async sensor(ctx) {
      await openCard(ctx);
      ctx.server.facts.rank = [
        { field: 'rank', value: 'A', version: 2, source_object: 'obj-1', page: 0, span: null, confidence: 0, uncertainty: 'operator_entered', corrected_by: 'u', created_at: '2026-09-23T01:02:00' },
        { field: 'rank', value: 'B', version: 1, source_object: 'obj-1', page: null, span: null, confidence: null, uncertainty: 'operator_entered', corrected_by: 'u', created_at: '2026-09-23T01:01:00' },
      ];
      await ctx.__pilot.pilotFactsLoad(); await flush();
      assert.ok(/data-version="1"[\s\S]*?data-qa="pilot-fact-confidence">confidence unknown</.test(main(ctx)), 'null confidence is shown as unknown');
      assert.ok(/data-version="2"[\s\S]*?data-qa="pilot-fact-confidence">confidence 0</.test(main(ctx)), 'measured zero confidence stays 0');
    },
  },
  {
    id: 'M06', defect: 'current reasons attributed to an old decision',
    edits: [["    + (row.withdrawn_at != null ? ' · '+escapeHtml(cardT('withdrawn'))+': '+escapeHtml(cardMember(row.withdrawn_by))+' · '+escapeHtml(pilotFormatTime(row.withdrawn_at)) : '')+'</div></div>';",
      "    + (row.withdrawn_at != null ? ' · '+escapeHtml(cardT('withdrawn'))+': '+escapeHtml(cardMember(row.withdrawn_by))+' · '+escapeHtml(pilotFormatTime(row.withdrawn_at)) : '')+'</div>'+(function(){ var __d = pilotDetail(); var __r = __d.ranks.items.filter(function(x){ return x.profile_id === row.profile_id; }); return __r.length ? '<div data-qa=\"pilot-history-reason\">'+escapeHtml(__r[0].reasons.map(function(z){ return z.requirement+'='+z.outcome; }).join(',') )+'</div>' : ''; })()+'</div>';"]],
    async sensor(ctx) {
      await positiveChainUntilRank(ctx); await ctx.__pilot.pilotShortlistConfirm('prof-B', 1); await flush();
      const row = historyRow(ctx, 'decision-1');
      assert.ok(row && /Team member user-op-1/.test(row) && /Profile version used: 1/.test(row), 'history row carries decision fields');
      assert.ok(!/pilot-history-reason/.test(row) && !/certificate:|=missing|=met|unconfirmed/.test(row), 'history row carries no current reason marker');
    },
  },
  {
    id: 'M07', defect: 'source_object projected from another object',
    edits: [["  else attempt = await pilotCardWrite('fact_record', fact.field, 'crewing_intake_fact_record', {intakeId:d.intakeId, fact:fact}, [pilotFactsLoad, pilotCardLoad]);",
      "  else attempt = await pilotCardWrite('fact_record', fact.field, 'crewing_intake_fact_record', {intakeId:d.intakeId, fact:Object.assign({}, fact, {source_object:objects[0].id})}, [pilotFactsLoad, pilotCardLoad]);"]],
    async sensor(ctx) {
      await openCard(ctx);
      detail(ctx).form = { mode: 'record', field: 'rank', value: 'Master', source_object: 'obj-2', page: '', span: '' };
      await ctx.__pilot.pilotFactSubmit(); await flush();
      const rec = ctx.calls.find((c) => c.command === 'crewing_intake_fact_record');
      assert.equal(rec.args.fact.source_object, 'obj-2', 'stub recorded exactly the selected object of this card');
    },
  },
  {
    id: 'M08', defect: 'profile_id projected from a neighbouring pair',
    edits: [["'crewing_intake_shortlist_confirm', {intakeId:d.intakeId, pair:{profile_id:String(profileId), profile_version:version}}", "'crewing_intake_shortlist_confirm', {intakeId:d.intakeId, pair:{profile_id:String(d.ranks.items[0].profile_id), profile_version:version}}"]],
    async sensor(ctx) {
      await positiveChainUntilRank(ctx);
      const buttons = [...main(ctx).matchAll(/onclick="(pilotShortlistConfirm\('prof-C',1\))"/g)];
      // TWO since No.632, and the number stays load-bearing rather than being
      // loosened to ">= 1": the compact fit card gained the add button the owner
      // asked for (968), and the full-comparison row below keeps the one it
      // already had — an accepted screen is not redone to make a count tidy.
      // Both must address prof-C and nothing else, which is what this control is
      // for; the click below exercises the first of them.
      assert.equal(buttons.length, 2, 'C has its own confirm control on BOTH surfaces of the card — the fit card and the full comparison row');
      vm.runInContext(buttons[0][1], ctx); await flush();
      const call = ctx.calls.find((c) => c.command === 'crewing_intake_shortlist_confirm');
      assert.equal(call.args.pair.profile_id, 'prof-C', 'stub recorded the clicked profile id, not the first row');
    },
  },
  {
    id: 'M09', defect: 'profile_version projected from a neighbouring version',
    edits: [["'crewing_intake_shortlist_confirm', {intakeId:d.intakeId, pair:{profile_id:String(profileId), profile_version:version}}", "'crewing_intake_shortlist_confirm', {intakeId:d.intakeId, pair:{profile_id:String(profileId), profile_version:Number(d.ranks.items[0].profile_version)}}"]],
    async sensor(ctx) {
      await positiveChainUntilRank(ctx);
      ctx.server.profiles[0].version = 2; await ctx.__pilot.pilotRankNow(); await flush();
      assert.ok(rankRow(ctx, 'prof-A', 1) && rankRow(ctx, 'prof-A', 2), 'A v1 and A v2 both render');
      const button = /onclick="(pilotShortlistConfirm\('prof-A',2\))"/.exec(main(ctx));
      vm.runInContext(button[1], ctx); await flush();
      const call = ctx.calls.find((c) => c.command === 'crewing_intake_shortlist_confirm');
      assert.equal(call.args.pair.profile_version, 2, 'stub recorded exactly the viewed version 2');
    },
  },
  {
    id: 'M10', defect: 'response of card A applied while B is selected',
    edits: [["d.intakeId === token.intakeId && d.generation === token.generation", "true"], ["    d.card = result; d.cardLoading = false; renderIntakePilot();", "    pilotDetail().card = result; pilotDetail().cardLoading = false; renderIntakePilot();"]],
    async sensor(ctx) {
      const gateA = deferred();
      ctx.server.handle = ((orig) => function (command, args) { if (command === 'crewing_intake_candidate_get' && args.intakeId === 'intake-A') return gateA.promise; if (command === 'crewing_intake_candidate_get') return { ...orig.call(this, command, args), intake_id: 'intake-B', receipt_id: 'receipt-B' }; return orig.call(this, command, args); })(ctx.server.handle);
      await openCard(ctx, 'intake-A'); await openCard(ctx, 'intake-B');
      gateA.resolve({ ...ctx.server.card, intake_id: 'intake-A', receipt_id: 'receipt-LATE-A' }); await flush();
      assert.equal(detail(ctx).intakeId, 'intake-B'); assert.equal(detail(ctx).card.receipt_id, 'receipt-B', 'B keeps its own card');
      assert.ok(!/receipt-LATE-A/.test(main(ctx)), 'late A data is absent from the DOM');
    },
  },
  {
    id: 'M11', defect: 'old generation accepted after A→B→A',
    edits: [["d.intakeId === token.intakeId && d.generation === token.generation", "d.intakeId === token.intakeId"], ["    d.card = result; d.cardLoading = false; renderIntakePilot();", "    pilotDetail().card = result; pilotDetail().cardLoading = false; renderIntakePilot();"]],
    async sensor(ctx) {
      const gates = [];
      ctx.server.handle = ((orig) => function (command, args) { if (command === 'crewing_intake_candidate_get' && args.intakeId === 'intake-A') { const g = deferred(); gates.push(g); return g.promise; } if (command === 'crewing_intake_candidate_get') return { ...orig.call(this, command, args), intake_id: 'intake-B' }; return orig.call(this, command, args); })(ctx.server.handle);
      await openCard(ctx, 'intake-A'); await openCard(ctx, 'intake-B'); await openCard(ctx, 'intake-A');
      assert.equal(gates.length, 2);
      gates[0].resolve({ ...ctx.server.card, receipt_id: 'receipt-OLD-GEN' }); await flush();
      assert.equal(detail(ctx).card, null, 'old-generation response for the same intake is ignored');
      gates[1].resolve({ ...ctx.server.card, receipt_id: 'receipt-NEW-GEN' }); await flush();
      assert.equal(detail(ctx).card.receipt_id, 'receipt-NEW-GEN'); assert.ok(!/receipt-OLD-GEN/.test(main(ctx)));
    },
  },
  {
    id: 'M12', defect: 'previous request-id accepted for the same intake/generation',
    edits: [["    if (!pilotDetailStillCurrent(token) || requestId !== d.factsRequest) return false;\n    d.facts =", "    if (!pilotDetailStillCurrent(token)) return false;\n    d.facts ="]],
    async sensor(ctx) {
      await openCard(ctx);
      const gates = [];
      ctx.server.handle = ((orig) => function (command, args) { if (command === 'crewing_intake_fact_list') { const g = deferred(); gates.push(g); return g.promise; } return orig.call(this, command, args); })(ctx.server.handle);
      const r1 = ctx.__pilot.pilotFactsLoad(); const r2 = ctx.__pilot.pilotFactsLoad();
      gates[1].resolve({ items: [{ field: 'rank', versions: [{ field: 'rank', value: 'NEWER', version: 1, source_object: 'obj-1', created_at: '2026' }] }] }); await flush();
      gates[0].resolve({ items: [{ field: 'rank', versions: [{ field: 'rank', value: 'OLDER', version: 1, source_object: 'obj-1', created_at: '2026' }] }] }); await r1; await r2; await flush();
      assert.equal(detail(ctx).facts[0].versions[0].value, 'NEWER', 'the newer request wins even when the older answers last');
      assert.ok(!/OLDER/.test(main(ctx)));
    },
  },
  {
    id: 'M15', defect: 'documented 403 shown as success (UI half; native half in cargo test)',
    edits: [["    attempt.error = err; attempt.outcome = (err.ambiguous || err.kind === 'unexpected_success') ? 'unknown' : 'refused';",
      "    attempt.error = err; attempt.outcome = err.status === 403 ? 'acked' : ((err.ambiguous || err.kind === 'unexpected_success') ? 'unknown' : 'refused'); if (err.status === 403 && attempt.op === 'withdraw') { var __c = pilotCardActiveConfirmation({profile_id:attempt.target.split('@')[0], profile_version:Number(attempt.target.split('@')[1])}); if (__c) __c.withdrawn_at = '2026-09-23T09:00:00'; }"]],
    async sensor(ctx) {
      await positiveChainUntilRank(ctx);
      ctx.server.user = 'user-op-2'; await ctx.__pilot.pilotShortlistConfirm('prof-B', 1); await flush(); ctx.server.user = 'user-op-1';
      await ctx.__pilot.pilotShortlistWithdraw('prof-B', 1); await flush();
      const last = attempts(ctx).slice(-1)[0];
      assert.equal(last.outcome, 'refused', 'withdraw_not_permitted stays a refusal');
      assert.ok(/data-qa="pilot-attempt-refused">Only the person who confirmed it/.test(main(ctx)), 'refusal text visible');
      assert.ok(!/data-outcome="acked" data-op="withdraw"/.test(main(ctx)), 'no success for the withdraw');
      assert.ok(/Active decision/.test(historyRow(ctx, 'decision-1')) && detail(ctx).ranks.confirmations[0].withdrawn_at == null, 'history unchanged: the other member\'s decision stays active');
    },
  },
  {
    id: 'M16', defect: 'UNKNOWN triggers an automatic second write',
    edits: [["    d.pending = false; renderIntakePilot();\n    return attempt;\n  }\n}", "    if (attempt.outcome === 'unknown') { invoke(command, Object.assign(pilotExpected(token.context), args)).catch(function(){}); }\n    d.pending = false; renderIntakePilot();\n    return attempt;\n  }\n}"]],
    async sensor(ctx) {
      await openCard(ctx);
      ctx.server.handle = ((orig) => function (command, args) { if (command === 'crewing_intake_candidate_rank') return Promise.reject({ kind: 'network', status: null, detail: null, ambiguous: true }); return orig.call(this, command, args); })(ctx.server.handle);
      await ctx.__pilot.pilotRankNow(); await flush();
      assert.equal(attempts(ctx)[0].outcome, 'unknown');
      await ctx.__pilot.pilotCardRefreshAll(); await flush();
      assert.equal(mutationCalls(ctx).length, 1, 'exactly one mutation dispatch; refresh adds none');
    },
  },
  {
    id: 'M17', block: 'c3b1', defect: 'mobile view treated as a stale context (pilotContextStillCurrent desktop-only)',
    edits: [["  return pilotViewActive() && pilotContextKey(context) === pilotContextKey(pilotContextSnapshot());",
      "  return state.view === 'intake_pilot' && pilotContextKey(context) === pilotContextKey(pilotContextSnapshot());"]],
    async sensor(ctx) { await mobileCardChain(mobilize(ctx)); },
  },
  {
    id: 'M18', block: 'c3b1', defect: 'pilot renders into the hidden desktop #main under the mobile shell',
    edits: [["function pilotContainer() { return document.getElementById(pilotHostIsMobile() ? 'mobile-main' : 'main'); }",
      "function pilotContainer() { return document.getElementById('main'); }"]],
    async sensor(ctx) { await mobileCardChain(mobilize(ctx)); },
  },
  {
    id: 'M19', defect: 'Escape ignores the mobile card view',
    edits: [["  if (!ev || ev.key !== 'Escape' || !pilotViewActive() || !pilotDetail()) return;",
      "  if (!ev || ev.key !== 'Escape' || state.view !== 'intake_pilot' || !pilotDetail()) return;"]],
    async sensor(ctx) { await mobileCardChain(mobilize(ctx)); },
  },
];

// Runner: known-good → mutant → restore. The mutation itself is applied OUTSIDE the
// sensor try: an anchor that does not occur exactly once is a runner failure
// (ANCHOR_MISSING), never a "mutant RED".
async function runControl(control) {
  let cleanBefore = false, mutantRed = false, cleanAfter = false, mutantMessage = '';
  try { await control.sensor(makeContext()); cleanBefore = true; } catch (error) { mutantMessage = `known-good failed: ${error.message}`; }
  let anchorMissing = false;
  if (cleanBefore) {
    let mutantSource = null;
    const block = control.block === 'c3b1' ? c3b1Source : c3b2Source;
    try { mutantSource = mutate(block, control.edits); } catch (error) { anchorMissing = true; mutantMessage = `ANCHOR_MISSING: ${error.message}`; }
    if (mutantSource !== null) {
      try { await control.sensor(makeContext(control.block === 'c3b1' ? { c3b1: mutantSource } : { source: mutantSource })); mutantMessage = 'mutant survived'; } catch (error) { mutantRed = true; mutantMessage = error.message; }
    }
    try { await control.sensor(makeContext()); cleanAfter = true; } catch (error) { mutantMessage += ` / restore failed: ${error.message}`; }
  }
  const verdict = anchorMissing ? 'ANCHOR_MISSING' : (cleanBefore && mutantRed && cleanAfter ? 'KILLED' : 'FAIL');
  return { id: control.id, defect: control.defect, cleanBefore, mutantRed, cleanAfter, anchorMissing, verdict, detail: mutantMessage };
}

console.log('# runner self-check: a mutant whose anchor does not exist must never count as KILLED');
{
  const phantom = { id: 'SELF', defect: 'runner self-check (phantom anchor)', edits: [['/* this anchor does not exist in the C3b-2 block */', '']], sensor: controls[0].sensor };
  const result = await runControl(phantom);
  ok(result.verdict === 'ANCHOR_MISSING' && result.mutantRed === false, `phantom-anchor control reports ANCHOR_MISSING (got ${result.verdict}: ${result.detail.slice(0, 80)})`);
}

console.log('# isolated mutation controls M01–M12, M15, M16, M17–M19 (known-good → mutant RED → clean GREEN)');
const controlResults = [];
for (const control of controls) {
  const result = await runControl(control);
  controlResults.push(result);
  softOk(result.verdict === 'KILLED', `${result.id} ${result.defect}: clean=${result.cleanBefore ? 'GREEN' : 'RED'} mutant=${result.mutantRed ? 'RED' : 'GREEN'} restore=${result.cleanAfter ? 'GREEN' : 'RED'} (${result.detail.slice(0, 90)})`);
}

// ---------------------------------------------------------------------------
// R01–R07: ordinary reconciliation scenarios, one assertion set each.
// ---------------------------------------------------------------------------
console.log('# reconciliation R01–R07');
{
  // R01 fact_record ACK -> failed GET
  const ctx = makeContext(); await openCard(ctx);
  let fail = false;
  ctx.server.handle = ((orig) => function (command, args) { if (fail && command === 'crewing_intake_fact_list') return Promise.reject({ kind: 'network', status: null, detail: null, ambiguous: false }); return orig.call(this, command, args); })(ctx.server.handle);
  detail(ctx).form = { mode: 'record', field: 'rank', value: 'Master', source_object: 'obj-1', page: '', span: '' };
  fail = true; await ctx.__pilot.pilotFactSubmit(); await flush();
  const a = attempts(ctx)[0];
  ok(a.outcome === 'acked' && a.readback === 'failed' && /data-qa="pilot-attempt-refresh-failed">Write confirmed; refresh failed/.test(main(ctx)) && /data-qa="pilot-facts-error"/.test(main(ctx)) && mutationCalls(ctx).length === 1, 'R01: ACK kept, refresh error shown separately, no second write');
}
{
  // R02 fact_record UNKNOWN -> empty GET
  const ctx = makeContext(); await openCard(ctx);
  ctx.server.handle = ((orig) => function (command, args) { if (command === 'crewing_intake_fact_record') return Promise.reject({ kind: 'network', status: null, detail: null, ambiguous: true }); return orig.call(this, command, args); })(ctx.server.handle);
  detail(ctx).form = { mode: 'record', field: 'rank', value: 'Master', source_object: 'obj-1', page: '', span: '' };
  await ctx.__pilot.pilotFactSubmit(); await flush();
  await ctx.__pilot.pilotFactsLoad(); await flush();
  ok(attempts(ctx)[0].outcome === 'unknown' && detail(ctx).facts.length === 0 && /data-qa="pilot-facts-empty"/.test(main(ctx)) && /Write outcome is unknown\. You can check the current state/.test(main(ctx)) && !/Refused|not performed|failed/.test(main(ctx).replace(/refresh failed|could not be loaded/g, '')), 'R02: data empty, outcome UNKNOWN, no claim that the write did not happen');
}
{
  // R03 candidate_rank UNKNOWN -> unchanged GET
  const ctx = makeContext(); await positiveChainUntilRank(ctx);
  ctx.server.handle = ((orig) => function (command, args) { if (command === 'crewing_intake_candidate_rank') return Promise.reject({ kind: 'network', status: null, detail: null, ambiguous: true }); return orig.call(this, command, args); })(ctx.server.handle);
  await ctx.__pilot.pilotRankNow(); await flush();
  const before = JSON.stringify(detail(ctx).ranks);
  await ctx.__pilot.pilotRanksLoad(); await flush();
  ok(attempts(ctx).slice(-1)[0].outcome === 'unknown' && JSON.stringify(detail(ctx).ranks) === before && /data-outcome="unknown" data-op="rank"/.test(main(ctx)), 'R03: unchanged GET leaves the rank attempt UNKNOWN (no run id, no recovered ACK)');
}
{
  // R04 shortlist_confirm UNKNOWN -> GET shows the matching active pair
  const ctx = makeContext(); await positiveChainUntilRank(ctx);
  ctx.server.handle = ((orig) => function (command, args) { if (command === 'crewing_intake_shortlist_confirm') { orig.call(this, command, args); return Promise.reject({ kind: 'network', status: null, detail: null, ambiguous: true }); } return orig.call(this, command, args); })(ctx.server.handle);
  await ctx.__pilot.pilotShortlistConfirm('prof-B', 1); await flush();
  await ctx.__pilot.pilotRanksLoad(); await flush();
  ok(attempts(ctx).slice(-1)[0].outcome === 'unknown' && historyRow(ctx, 'decision-1') && /Active decision/.test(historyRow(ctx, 'decision-1')) && /data-outcome="unknown" data-op="confirm"/.test(main(ctx)), 'R04: the matching pair is observed state; the original attempt stays UNKNOWN');
}
{
  // R05 fact_correct UNKNOWN -> failed GET
  const ctx = makeContext(); await openCard(ctx);
  detail(ctx).form = { mode: 'record', field: 'rank', value: 'Mastre', source_object: 'obj-1', page: '', span: '' };
  await ctx.__pilot.pilotFactSubmit(); await flush();
  ctx.server.handle = ((orig) => function (command, args) { if (command === 'crewing_intake_fact_correct') return Promise.reject({ kind: 'malformed_response', status: 200, detail: null, ambiguous: true }); if (command === 'crewing_intake_fact_list') return Promise.reject({ kind: 'network', status: null, detail: null, ambiguous: false }); return orig.call(this, command, args); })(ctx.server.handle);
  ctx.__pilot.pilotFactStartCorrection('rank'); detail(ctx).form.value = 'Master'; detail(ctx).form.source_object = 'obj-1';
  await ctx.__pilot.pilotFactSubmit(); await flush();
  await ctx.__pilot.pilotFactsLoad(); await flush();
  ok(attempts(ctx).slice(-1)[0].outcome === 'unknown' && /data-qa="pilot-facts-error"/.test(main(ctx)) && /data-outcome="unknown" data-op="fact_correct"/.test(main(ctx)) && mutationCalls(ctx).length === 2, 'R05: UNKNOWN plus a separate read error; no success and no automatic replay');
}
{
  // R06 shortlist_withdraw UNKNOWN -> late GET of a previous request id
  const ctx = makeContext(); await positiveChainUntilRank(ctx);
  await ctx.__pilot.pilotShortlistConfirm('prof-B', 1); await flush();
  const gates = [];
  ctx.server.handle = ((orig) => function (command, args) { if (command === 'crewing_intake_shortlist_withdraw') return Promise.reject({ kind: 'network', status: null, detail: null, ambiguous: true }); if (command === 'crewing_intake_rank_list') { const g = deferred(); gates.push({ g, value: orig.call(this, command, args) }); return g.promise; } return orig.call(this, command, args); })(ctx.server.handle);
  const first = ctx.__pilot.pilotRanksLoad();
  await ctx.__pilot.pilotShortlistWithdraw('prof-B', 1); await flush();
  const second = ctx.__pilot.pilotRanksLoad();
  gates[1].g.resolve(gates[1].value); await second; await flush();
  const shown = main(ctx); const outcome = attempts(ctx).slice(-1)[0].outcome;
  gates[0].g.resolve({ items: [], unranked_active_profiles: [], confirmations: [{ id: 'decision-LATE', profile_id: 'prof-B', profile_version: 1, confirmed_by: 'x', confirmed_at: '2026', withdrawn_by: null, withdrawn_at: null }] }); await first; await flush();
  ok(outcome === 'unknown' && attempts(ctx).slice(-1)[0].outcome === 'unknown' && main(ctx) === shown && !/decision-LATE/.test(main(ctx)), 'R06: late callback of the previous request id is ignored; outcome and shown data unchanged');
}
{
  // R07 candidate_rank UNKNOWN -> new explicit action
  const prompts = [];
  const ctx = makeContext({ confirmImpl: async (message) => { prompts.push(message); return true; } }); await positiveChainUntilRank(ctx);
  let failRank = true;
  ctx.server.handle = ((orig) => function (command, args) { if (command === 'crewing_intake_candidate_rank' && failRank) return Promise.reject({ kind: 'network', status: null, detail: null, ambiguous: true }); return orig.call(this, command, args); })(ctx.server.handle);
  await ctx.__pilot.pilotRankNow(); await flush();
  const unknownId = attempts(ctx).slice(-1)[0].id;
  ok(/data-outcome="unknown" data-op="rank"/.test(main(ctx)), 'R07: previous uncertainty is visible before the new action');
  failRank = false; await ctx.__pilot.pilotRankNow(); await flush();
  const old = attempts(ctx).find((a) => a.id === unknownId); const fresh = attempts(ctx).slice(-1)[0];
  ok(prompts.length === 1 && /The previous write may have completed\. Perform a new action\?/.test(prompts[0]) && fresh.id !== unknownId && fresh.outcome === 'acked' && old.outcome === 'unknown' && mutationCalls(ctx).filter((c) => c.command === 'crewing_intake_candidate_rank').length === 3, 'R07: new explicit attempt after the dialog; the old attempt keeps UNKNOWN, no recovered ACK');
  const declined = makeContext({ confirmImpl: async () => false }); await openCard(declined);
  declined.server.handle = ((orig) => function (command, args) { if (command === 'crewing_intake_candidate_rank') return Promise.reject({ kind: 'network', status: null, detail: null, ambiguous: true }); return orig.call(this, command, args); })(declined.server.handle);
  await declined.__pilot.pilotRankNow(); await flush(); await declined.__pilot.pilotRankNow(); await flush();
  ok(mutationCalls(declined).length === 1 && attempts(declined).length === 1, 'R07: declining the dialog dispatches nothing');
}

// ---------------------------------------------------------------------------
// # labels №440/№433 — RU/EN interface strings live in the dictionaries.
// Card A (2026-09-23): every string named by PREP §2 in the §0 revision must be
// served by tr()/mobileTr()/pilotT() from UI_STRINGS / PILOT_TEXT, with both an
// `en` and a `ru` value, and the two values must differ byte for byte.
// ---------------------------------------------------------------------------
console.log('# labels №440/№433: RU/EN strings served by the dictionaries');
{
  const cut = (from, to) => {
    const a = html.indexOf(from); assert.ok(a > 0, `labels anchor missing: ${from}`);
    const b = html.indexOf(to, a); assert.ok(b > a, `labels end anchor missing: ${to}`);
    return html.slice(a, b);
  };
  const dictStart = html.indexOf('var UI_STRINGS = {');
  const dictEnd = html.indexOf('// ── @skipi/settings v0.3.0 dictionary', dictStart);
  assert.ok(dictStart > 0 && dictEnd > dictStart, 'labels: the UI_STRINGS block is bounded');
  const dict = html.slice(dictStart, dictEnd);
  const anchor = (re) => { const m = re.exec(dict); assert.ok(m, `labels: dictionary anchor missing ${re}`); return m.index; };
  const iEn = anchor(/\n[ \t]*en: \{/), iRu = anchor(/\n[ \t]*ru: \{/), iTl = anchor(/\n[ \t]*tl: \{/);
  assert.ok(iEn < iRu && iRu < iTl, 'labels: en/ru/tl dictionaries keep their order');
  const enBlock = dict.slice(iEn, iRu);
  const ruBlock = dict.slice(iRu, iTl);
  const outsideDict = (literal) => {
    const hits = [];
    for (let i = html.indexOf(literal); i !== -1; i = html.indexOf(literal, i + 1)) {
      if (i < dictStart || i >= dictEnd) hits.push(i);
    }
    return hits;
  };
  const NEW_KEYS = [
    'vacancies.empty_select','vacancies.sort.open_first','vacancies.sort.with_replies','vacancies.sort.stale','vacancies.sort.newest','vacancies.sort.oldest',
    'entry.tagline','entry.open_profile','entry.open_profile_desc','entry.create_profile','entry.create_profile_desc','entry.show_demo','entry.show_demo_desc','entry.demo_note',
    'connect.title','connect.lead_device','connect.lead_profile','connect.close','connect.tab_token','connect.tab_qr','connect.token_label','connect.token_placeholder','connect.help','connect.clear','connect.submit','connect.qr_text','connect.qr_note','connect.enter_manually','connect.err_already','connect.err_token','connect.err_server','connect.err_generic',
    'common.cancel','common.ok',
    'confirm.team_remove','confirm.profile_archive','confirm.profile_archive_note','confirm.mailbox_disconnect','confirm.mailing_close','confirm.mailing_close_note','confirm.mailing_delete','confirm.document_delete','confirm.document_delete_note','confirm.vacancy_close','confirm.vacancy_close_note','confirm.vacancy_delete','confirm.vacancy_delete_note','confirm.vacancy_delete_hint','confirm.vault_folder','confirm.vault_folder_note',
    'confirm.remove','confirm.archive','confirm.disconnect','confirm.delete','confirm.delete_forever','confirm.close','confirm.close_request','confirm.close_vacancy','confirm.use_folder',
    'about.verification_unavailable','about.verification_mismatch',
    'mobile.apps_title','mobile.apps_sub',
    'demo.toast','demo.banner','demo.exit',
  ];
  // Values carry no apostrophes by construction, so a non-greedy single-quoted read is exact.
  const valueOf = (block, key) => {
    const m = new RegExp("'" + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "':'([^']*)'").exec(block);
    return m ? m[1] : null;
  };

  // 1. Strings moved into the dictionary occur nowhere else in the product.
  const MOVED = [
    ['A1 vacancies.empty_select', 'Select a vacancy on the left to view details and applications.'],
    ['A2 vacancies.sort.open_first', 'Открытые сначала'],
    ['A4 entry.tagline', 'Вакансии, заявки и база моряков для крюинговых компаний.'],
    ['A4b connect.err_token', 'Токен недействителен или истёк.'],
    ['A8 mobile.apps_sub', 'Plugins for your team'],
    ['A10 demo.banner', 'DEMO — демонстрационные данные'],
    ['A10 demo.toast', 'Это демонстрация — изменения недоступны.'],
  ];
  for (const [name, literal] of MOVED) {
    ok(outsideDict(literal).length === 0, `1 (${name}): the literal lives only inside UI_STRINGS`);
  }

  // 2. The RU sort label is a ru-dictionary value, not markup.
  ok(ruBlock.includes("'vacancies.sort.open_first':'Открытые сначала'"), '2 (A2): "Открытые сначала" is a UI_STRINGS.ru value');
  ok(!enBlock.includes('Открытые сначала'), '2 (A2): the RU sort label does not sit in the en dictionary');
  ok(/sortOptions\.map|\[\s*'open_first'/.test(html) && /\['open_first',\s*tr\('vacancies\.sort\.open_first'\)\]/.test(html), '2 (A2): the sort table reads all labels through tr()');
  for (const key of ['with_replies','stale','newest','oldest']) {
    ok(new RegExp("\\['" + key + "',\\s*tr\\('vacancies\\.sort\\." + key + "'\\)\\]").test(html), `2 (A2): sort option ${key} reads its label through tr()`);
  }

  // 3. The pilot subtitle describes the screen, with no internal roadmap words.
  const subtitles = [...html.matchAll(/\n\s*title:'[^']*', subtitle:'([^']*)',/g)].map((m) => m[1]);
  ok(subtitles.length === 2, '3 (A3): PILOT_TEXT still carries exactly one en and one ru subtitle');
  for (const word of ['slice', 'этап', 'следующ', 'next', 'parsed', 'разбир', 'экстрактор']) {
    ok(subtitles.every((s) => !s.toLowerCase().includes(word)), `3 (A3): no subtitle contains "${word}"`);
  }

  // 4. The live confirm dialog has no hardcoded default button labels. The
  //    legacy customConfirm() below is dead code (definition only, zero call
  //    sites) and stays out of this route by PREP F8 — asserted, not assumed.
  const confirmBody = cut('function inAppConfirm(msg, opts) {', '\nasync function closeVacancy(id){');
  ok((confirmBody.match(/opts\.(?:cancelLabel|confirmLabel)\s*\|\|\s*['"]/g) || []).length === 0, '4 (A5): inAppConfirm defaults are not string literals');
  ok((html.match(/customConfirm\(/g) || []).length === 1, '4 (A5): legacy customConfirm stays dead code — definition only, no call site');

  // 5. No confirm call site opens with a literal message.
  ok((html.match(/inAppConfirm\(\s*['"]/g) || []).length === 0, '5 (A6): no inAppConfirm call site passes a literal message');

  // 6. The mobile Apps subtitle is a dictionary value; the rail label and the
  //    settings "Modules / Apps" literals stay as they are (pinned by the
  //    isolation and presence harnesses — №433 stays open on them).
  ok(enBlock.includes("'mobile.apps_sub':'Plugins for your team'"), '6 (A8): mobile.apps_sub is an en dictionary value');
  ok(/if \(view === 'apps'\) return \[mobileTr\('apps_title'\), mobileTr\('apps_sub'\)\];/.test(html), '6 (A8): the mobile Apps header reads both strings through mobileTr()');
  ok(!/mobileNavButton\('apps'/.test(html), '6 (A8, K2.2): the Apps rail slot is retired — its pinned label literal left with it');

  // 7. Key parity: every new key exists in both en and ru.
  for (const key of NEW_KEYS) {
    const en = valueOf(enBlock, key);
    const ru = valueOf(ruBlock, key);
    ok(en !== null && en !== '' && ru !== null && ru !== '', `7: key ${key} has a value in both en and ru`);
  }

  // 8. Stack verification status is localized; the provenance identifier is not.
  ok(/return APP_BUILD_METADATA\.verification_status==='mismatch'\?tr\('about\.verification_mismatch'\):tr\('about\.verification_unavailable'\);/.test(html), "8 (A7′): stackVerificationLabel returns tr() for both statuses");
  ok(/\+' · Source '\+buildSourceLabel\(\)/.test(html) && /'Component '\+APP_BUILD_METADATA\.component/.test(html), "8 (A7′): the stackAboutSummary identifier stays unlocalized");

  // 9 (S2). The confirm defaults come from the dictionary and are escaped.
  ok(/escapeHtml\(opts\.cancelLabel\|\|tr\('common\.cancel'\)\)/.test(html), "9 (S2): the cancel button renders escapeHtml(opts.cancelLabel||tr('common.cancel'))");
  ok(/escapeHtml\(opts\.confirmLabel\|\|tr\('common\.ok'\)\)/.test(html), "9 (S2): the confirm button renders escapeHtml(opts.confirmLabel||tr('common.ok'))");

  // 10. Every new key really differs between ru and en (no copied English).
  const ALLOWED_EQUAL = [];
  for (const key of NEW_KEYS) {
    const en = valueOf(enBlock, key);
    const ru = valueOf(ruBlock, key);
    if (ALLOWED_EQUAL.includes(key)) continue;
    ok(en !== null && ru !== null && Buffer.from(ru, 'utf8').compare(Buffer.from(en, 'utf8')) !== 0, `10: ru differs from en for ${key}`);
  }
  // A11: the pilot tab label is translated in ru.
  ok(/intake:'Приём'/.test(html) && !/intake:'Intake', receipt:'Квитанция'/.test(html), '10 (A11): PILOT_TEXT.ru.intake is translated');
  ok(/intake:'Intake', receipt:'Receipt'/.test(html), '10 (A11): PILOT_TEXT.en.intake stays English');

  // S1. The entry screen and the connect dialog hold no Cyrillic literals.
  const entryBody = cut('function renderEntryChoice(next){', '\nfunction demoToast(msg){');
  const connectBody = cut('function openConnectDialog(opts){', '\nfunction closeConnectDialog(){');
  const CYR_LITERAL = /'[^']*[А-Яа-яЁё][^']*'/g;
  ok((entryBody.match(CYR_LITERAL) || []).length === 0, 'S1 (A4): renderEntryChoice carries no Cyrillic string literal');
  ok((connectBody.match(CYR_LITERAL) || []).length === 0, 'S1 (A4b): openConnectDialog carries no Cyrillic string literal');
  ok((entryBody.match(/tr\('entry\./g) || []).length >= 8, 'S1 (A4): the entry screen renders eight entry.* dictionary strings');
  ok((connectBody.match(/tr\('connect\./g) || []).length >= 13, 'S1 (A4b): the connect dialog renders the connect.* dictionary strings');
  ok((connectBody.match(/escapeAttr\(tr\('connect\./g) || []).length >= 2, 'S1 (A4b): dictionary values interpolated into attributes go through escapeAttr()');
  const friendly = cut('function connectFriendlyError(e){', '\nasync function connectSubmitToken(){');
  ok((friendly.match(CYR_LITERAL) || []).length === 0 && (friendly.match(/tr\('connect\.err_/g) || []).length === 4, 'S1 (A4b): all four connect errors come from connect.err_* keys');

  // R3. Runtime: the mobile Apps header differs between RU and EN.
  const langBlock = cut("var UI_LANG_KEY = 'skipi-crewing-ui-language';", '// ── @skipi/settings v0.3.0 dictionary');
  const trBlock = cut('function getUiLang() {', 'function setUiLang(lang) {');
  const mobileTrBlock = cut('function mobileTr(key) {', 'function mobileModuleLabel(view) {');
  const titleBlock = cut('function mobileViewChromeTitle(view) {', 'function mobileApiHostLabel() {');
  const titleFor = (lang) => {
    const context = vm.createContext({ localStorage: { getItem: () => lang }, state: { settings: {} } });
    vm.runInContext(`${langBlock}\n${trBlock}\n${mobileTrBlock}\n${titleBlock}\nthis.__t = mobileViewChromeTitle('apps');`, context);
    return context.__t;
  };
  const titleEn = titleFor('en');
  const titleRu = titleFor('ru');
  ok(titleEn[0] === 'Apps' && titleEn[1] === 'Plugins for your team', 'R3: the mobile Apps header renders the en values at runtime');
  ok(titleRu[0] === 'Приложения' && titleRu[1] === 'Плагины для вашей команды', 'R3: the mobile Apps header renders the ru values at runtime');
  ok(titleRu[0] !== titleEn[0] && titleRu[1] !== titleEn[1], 'R3: the mobile Apps header actually changes with the interface language');
}

// ---------------------------------------------------------------------------
// # K2 modules/crew-flow (OWNER (654)/(658), 2026-09-24; PREP §5 checks 1–10)
// Crew Flow becomes the home module: it shows the live pilot intake queue with
// an operator action panel, the retired work modules (vacancies, mailings) and
// the Team/Intake-pilot tabs leave the navigation, and the client requirement
// profiles are renamed to the compliance profile. Every check here is RED on
// the K2 base commit and GREEN on the candidate.
// ---------------------------------------------------------------------------
console.log('# K2 modules/crew-flow');
{
  const k2slice = (from, to) => {
    const a = html.indexOf(from);
    if (a < 0) return '';
    const b = html.indexOf(to, a);
    return b > a ? html.slice(a, b) : '';
  };
  const count = (re) => (html.match(re) || []).length;

  // --- 1. retired entries are gone from the shipped HTML ---------------------
  softOk(!html.includes('id="mt-vacancies"'), 'K2-1: desktop vacancies tab is gone');
  softOk(!html.includes('id="mt-mailings"'), 'K2-1: desktop mailings tab is gone');
  softOk(!html.includes('id="mt-team"'), 'K2-1: desktop team tab is gone');
  softOk(!html.includes('nav-vacancies-badge'), 'K2-1: vacancies nav badge is gone');
  softOk(!html.includes('id="mt-intake_pilot"'), 'K2-1: desktop intake-pilot tab is gone');
  softOk(count(/mobileNavButton\('vacancies'/g) === 0 && count(/mobileNavButton\('mailings'/g) === 0,
    'K2-1: the mobile rail builds no vacancies/mailings slot');
  softOk(!html.includes('apps-module-tile-vacancies') && !html.includes('apps-module-tile-mailings'),
    'K2-1: the mobile Apps grid carries no vacancies/mailings module tile');
  softOk(!html.includes('apps-pilot-tile-intake_pilot'), 'K2-1: the mobile Apps grid carries no intake-pilot tile');

  // --- 2. the new canonical rail and the pilot entry inside Crew Flow --------
  softOk(/var MOBILE_RAIL_QA = \{ crew_flow: 'bottom-nav-crew_flow', compliance: 'bottom-nav-compliance', seafarers: 'bottom-nav-seafarers' \};/.test(html),
    'K2-2/K2.2: MOBILE_RAIL_QA is the three remaining D3 slots crew_flow·compliance·seafarers (documents/apps retired 2026-09-27)');
  const k2chrome = k2slice('function mobileRenderChrome(view) {', '\nfunction mobileParentView');
  const k2railOrder = [...k2chrome.matchAll(/mobileNavButton\('([a-z_]+)'/g)].map((m) => m[1]);
  softOk(k2railOrder.join(',') === 'crew_flow,compliance,seafarers',
    'K2-2/K2.2: mobileRenderChrome renders exactly the three remaining D3 slots in order — got [' + k2railOrder.join(',') + ']');
  softOk(count(/data-qa="crew-flow-open-pilot"/g) >= 2,
    'K2-2: the pilot entry data-qa="crew-flow-open-pilot" exists in both the desktop and the mobile Crew Flow render');
  // must-keep tokens introduced by PR-P (presence contract for crew_flow)
  softOk(html.includes('data-qa="crew-flow-view"') && html.includes('id="mt-crew_flow"') && html.includes("crew_flow: 'bottom-nav-crew_flow'"),
    'K2-2: PR-P must-keep crew_flow presence tokens survive the K2 dist');
  // S11: Team stays reachable from Settings → Доступ / токены (only token issuer)
  const k2access = k2slice("} else if (settingsTab==='access') {", "} else if (settingsTab==='app') {");
  softOk(k2access.includes('data-qa="settings-team-access-open"') && /showView\(\\?'team\\?'\)/.test(k2access) && k2access.includes('hasTeamAccess()'),
    'K2-2/S11: Settings → Доступ / токены keeps a gated entry into the team view');

  // --- 3. start view and fallbacks --------------------------------------------
  softOk(/var state = \{\s*\n\s*view: 'crew_flow',/.test(html), 'K2-3: the desktop start view is crew_flow');
  const k2showView = k2slice('function showView(v) {', '\nfunction renderVacanciesTree');
  softOk(k2showView !== '' && !/v = 'vacancies';/.test(k2showView), 'K2-3: showView no longer falls back to vacancies');
  softOk(/v = 'crew_flow';/.test(k2showView), 'K2-3: the team gate in showView falls back to crew_flow');
  softOk(k2slice('async function bootDesktopMain(){', '\n(async function(){').includes("showView('crew_flow');"),
    'K2-3: desktop boot opens crew_flow');
  softOk(count(/mobileShow\(mobileHasConnection\(\) \? 'crew_flow' : 'connection'\)/g) === 2,
    'K2-3: both mobile boot paths open crew_flow when connected');
  const k2mobileShow = k2slice('function mobileShow(view) {', '\nfunction mobileBack()');
  softOk(k2mobileShow !== '' && !/return mobileRenderVacancies\(\);/.test(k2mobileShow),
    'K2-3: mobileShow no longer defaults to the vacancies renderer');
  softOk(!/view = 'vacancies';/.test(k2mobileShow), 'K2-3: mobileShow no longer rewrites a view to vacancies');
  softOk(/if \(view === 'team'\) view = 'crew_flow';/.test(k2mobileShow), 'K2-3: the mobile team fallback is crew_flow');
  // S-входы: the three live entries named by the supervisor
  softOk(/class="mobile-top-home[^"]*"[^>]*onclick="mobileShow\(\\?'crew_flow\\?'\)/.test(html),
    'K2-3/S: the mobile header home button opens crew_flow');
  softOk(k2slice('function connectSubmit', '\nfunction connectShowError').includes("mobileShow('crew_flow')")
      || /state\.vacancies = \[\];\s*\n\s*if \(isMobileShellActive\(\)\) mobileShow\('crew_flow'\);/.test(html),
    'K2-3/S: navigation after a successful company token lands on crew_flow');
  softOk(!/renderTeamOnboarding[\s\S]{0,4000}?showView\('team'\)/.test(html)
      || k2slice('async function teamOnboardingShowTeam() {', '\nasync function syncTeamRoleFromMembers') === ''
      || !html.includes('onclick="teamOnboardingShowTeam()"'),
    'K2-3/S: the fresh-install team onboarding no longer routes into the hidden team view');

  // --- 7. rename: compliance profile -----------------------------------------
  const markerLine = '<!-- Presence-contract compatibility marker; not visible UI: Compliance Profiles / Профили соответствия -->';
  const htmlNoMarker = html.split(markerLine).join('');
  const renameRe = /Профил[ьи] требований|профил[ьияей]+ требований|Профилей требований|[Rr]equirement [Pp]rofiles?|Client Requirement/g;
  const leftovers = htmlNoMarker.match(renameRe) || [];
  softOk(leftovers.length === 0, 'K2-7: no "client requirement profile" wording outside the presence marker — got ' + leftovers.length + ' [' + [...new Set(leftovers)].join(' | ') + ']');
  softOk(/'nav\.compliance':'Compliance Profile'/.test(html) && /'nav\.compliance':'Профиль соответствия'/.test(html),
    'K2-7: nav.compliance is Compliance Profile / Профиль соответствия in the en and ru dictionaries');
  softOk(html.includes(markerLine), 'K2-7: the presence compatibility marker comment is untouched');

  // --- 8. legacy work settings section ---------------------------------------
  softOk(!html.includes('Вакансии / Рассылки'), 'K2-8: the legacy "Вакансии / Рассылки" settings label is gone');
  softOk(!/navItem\('work'/.test(html), 'K2-8: the legacy desktop work settings nav item is gone');
  softOk(!/id:'work'/.test(html) && !/if \(page === 'work'\)/.test(html), 'K2-8: the legacy mobile work settings page is gone');
  softOk(count(/inputCtrl\('s-reply'/g) >= 1 && count(/id="m-reply"/g) >= 1,
    'K2-8: the reply-to email field keeps a home in settings (value is never cleared)');

  // --- 10. hiding is not deleting --------------------------------------------
  const k2crew = k2slice('// CREW FLOW MODULE START', '// CREW FLOW MODULE END');
  softOk(k2crew !== '' && !/delete_vacancy_remote|delete_mailing_request_remote|delete_document|localStorage\.removeItem/.test(k2crew),
    'K2-10: the Crew Flow module deletes nothing — retired modules are hidden, not wiped');

  // ------------------------------------------------------------------ runtime
  // 4/5/6: isolated vm over the Crew Flow + C3b-1 + C3b-2 blocks with a recording
  // invoke stub serving a synthetic queue of three candidates.
  const mobileCrewBlock = k2slice('function mobileRenderCrewFlow() {', '\nfunction mobileRenderSeafarers()');
  // K2.1 (OWNER (739)): the receipt carries the attachment METADATA list (S3) and
  // the rfc822 object of the original letter. Bytes are never in the card.
  const K2_ATTACHMENTS = [
    { ordinal: 1, filename: 'oleh-cv.pdf', declared_type: 'application/pdf', measured_type: 'application/pdf', byte_size: 210000, verdict: 'accepted', reason: null, eligible: true },
    { ordinal: 2, filename: 'payload.exe', declared_type: 'application/pdf', measured_type: 'application/x-dosexec', byte_size: 4096, verdict: 'rejected', reason: 'type_mismatch', eligible: false },
  ];
  // Hostile-by-construction names: the product must show them as TEXT.
  const K2_ATTACHMENTS_HOSTILE = [
    { ordinal: 1, filename: '<img src=x onerror=1>.pdf', declared_type: 'application/pdf', measured_type: 'application/pdf', byte_size: 11, verdict: 'accepted', reason: null, eligible: true },
    { ordinal: 2, filename: "a'b\"c.pdf", declared_type: 'application/pdf', measured_type: 'application/pdf', byte_size: 12, verdict: 'needs_review', reason: 'scanner_unavailable', eligible: true },
    { ordinal: 3, filename: '', declared_type: 'application/octet-stream', measured_type: 'application/octet-stream', byte_size: 0, verdict: 'rejected', reason: 'empty', eligible: false },
  ];
  const K2_HEAD_TEXT = 'Return-Path: <bounce@example.test>\r\nFrom: =?utf-8?B?0J7Qu9C10LMg0JI=?= <letter-from@example.test>\r\nDate: Wed, 24 Sep 2026 09:00:00 +0000\r\nSubject: =?utf-8?Q?CV_=D0=9C=D0=B0=D1=81=D1=82=D0=B5=D1=80?=\r\n\t<2/O>\r\n\r\nbody must never be parsed as a header\r\nSubject: forged\r\n';
  function k2Server({ contactMode = 'both', attachments = K2_ATTACHMENTS, contactEmail = 'oleh@example.test' } = {}) {
    const items = [
      { intake_id: 'intake-1', receipt_id: 'r1', crewing_id: 'crew-synthetic', content_type: 'message/rfc822', content_bytes: 120, state: 'quarantined', created_at: '2026-09-24T09:00:00', objects: [{ id: 'o1', content_type: 'application/pdf' }, { id: 'o-letter', content_type: 'message/rfc822' }], attachments, summary: { state: 'quarantined', facts: 3, ranks: 1, ranks_stale: 0, active_confirmations: 0, needs_review_reason: null } },
      { intake_id: 'intake-2', receipt_id: 'r2', crewing_id: 'crew-synthetic', content_type: 'application/pdf', content_bytes: 140, state: 'ranked', created_at: '2026-09-24T08:00:00', objects: [{ id: 'o2', content_type: 'application/pdf' }], summary: { state: 'ranked', facts: 2, ranks: 2, ranks_stale: 0, active_confirmations: 1, needs_review_reason: null } },
      { intake_id: 'intake-3', receipt_id: 'r3', crewing_id: 'crew-synthetic', content_type: 'text/plain', content_bytes: 90, state: 'needs_review', created_at: '2026-09-24T07:00:00', objects: [{ id: 'o3', content_type: 'text/plain' }], summary: { state: 'needs_review', facts: 1, ranks: 0, ranks_stale: 0, active_confirmations: 0, needs_review_reason: 'unreadable_source' } },
    ];
    const facts = {
      'intake-1': [{ field: 'name', versions: [{ field: 'name', value: 'Oleh V.', version: 1, source_object: 'o1', created_at: '2026-09-24T09:05:00' }] },
        { field: 'rank', versions: [{ field: 'rank', value: 'Master', version: 1, source_object: 'o1', created_at: '2026-09-24T09:06:00' }] },
        ...(contactMode === 'both' || contactMode === 'contact'
          ? [{ field: 'contact:email', versions: [{ field: 'contact:email', value: contactEmail, version: 1, source_object: 'o1', uncertainty: 'operator_entered', created_at: '2026-09-24T09:07:00' }] },
            { field: 'contact:phone', versions: [{ field: 'contact:phone', value: '+380 50 000 00 00', version: 1, source_object: 'o1', created_at: '2026-09-24T09:07:30' }] }]
          : []),
        ...(contactMode === 'both' || contactMode === 'legacy'
          ? [{ field: 'email', versions: [{ field: 'email', value: 'old-card@example.test', version: 1, source_object: 'o1', created_at: '2026-09-24T09:07:00' }] }]
          : []),
        { field: 'rank_as_written', versions: [{ field: 'rank_as_written', value: 'Mastre', version: 1, source_object: 'o1', uncertainty: 'rank_ambiguous', created_at: '2026-09-24T09:08:00' }] }],
      'intake-2': [{ field: 'name', versions: [{ field: 'name', value: 'Ramon S.', version: 1, source_object: 'o2', created_at: '2026-09-24T08:05:00' }] },
        { field: 'rank', versions: [{ field: 'rank', value: 'Chief Officer', version: 1, source_object: 'o2', created_at: '2026-09-24T08:06:00' }] }],
      'intake-3': [{ field: 'name', versions: [{ field: 'name', value: 'Marko P.', version: 1, source_object: 'o3', created_at: '2026-09-24T07:05:00' }] }],
    };
    return { items, facts };
  }
  function makeCrewContext({ language = 'en', settings, demo = false, native = true, noProfiles = false, confirmAnswer = true, noTauri = false, webShell = false,
    contactMode = 'both', attachments, bytes404 = false, mailtoFails = false, realEscaping = false, mailbox,
    contactEmail = 'oleh@example.test',
    // No.621. `undefined` is the server's 404 (this intake carries no binding);
    // an object is the 200 body; `{ __throw: err }` is any OTHER failure, which
    // the screen must not confuse with an absence (N14).
    responseContact } = {}) {
    const srv = k2Server({ contactMode, attachments, contactEmail });
    const nodes = new Map();
    for (const id of ['main', 'mobile-main', 'left-panel', 'crew-flow-tree']) nodes.set(id, { id, innerHTML: '', style: {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false } });
    const calls = [];
    const toasts = [];
    const views = [];
    const timeline = [];
    const store = new Map();
    let lang = language;
    const ctx = {
      console, Promise, Date, Math, JSON, Number, String, Array, Object, Uint8Array, RegExp, Boolean, isNaN, parseInt, parseFloat,
      __demoMode: demo,
      state: {
        view: 'crew_flow',
        settings: settings === undefined ? { server_url: 'http://127.0.0.1:43123', bearer_token: 'synthetic-token', crewing_id: 'crew-synthetic' } : settings,
        intakePilot: freshPilotState(),
        crewFlowSignals: [], crewFlowReadState: {}, applicationsByVacancy: {}, attachmentsByApp: {}, messagesByApp: {},
      },
      window: { crypto: { randomUUID: () => 'ev-1', getRandomValues: (a) => a.fill(7) } },
      navigator: { clipboard: { writeText: async () => {} } },
      localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
      document: { getElementById(id) { return nodes.get(id) || null; }, addEventListener() {}, body: { classList: { contains: () => false, add() {}, remove() {} } } },
      FileReader: class {},
      getUiLang() { return lang; },
      setLang(v) { lang = v; },
      tr(key) { const d = ctx.__K2_STRINGS; return (d[lang] && d[lang][key]) || d.en[key] || key; },
      mobileTr(key) { return ctx.tr('mobile.' + key); },
      escapeHtml: esc, escapeAttr: esc,
      escapeJsString(v) { return String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); },
      humanSize(b) { return `${b} B`; },
      certLabelById(id) { return String(id); },
      showToast(msg, kind) { toasts.push([msg, kind]); },
      showView(v) {
        views.push(v); ctx.state.view = v;
      },
      mobileShow(v) { views.push('mobile:' + v); ctx.state.view = 'mobile-' + v; },
      mobileMain(htmlStr) { nodes.get('mobile-main').innerHTML = htmlStr; },
      isMobileShellActive() { return String(ctx.state.view || '').indexOf('mobile-') === 0; },
      saveCrewFlowReadState() {
        for (const [id, row] of Object.entries(ctx.state.crewFlowReadState || {})) timeline.push('read-state:' + (row && row.action));
        store.set('skipi_crewing_crew_flow_read_state_v2', JSON.stringify(ctx.state.crewFlowReadState));
      },
      async refreshCrewFlowRankings() { return null; },
      async ensureCrewFlowRankings() { return null; },
      findApplicationById() { return null; },
      latestPdfAttachmentFromSender() { return null; },
      sUidOf() { return ''; },
      async saveRankedCandidate() { return null; },
      async saveCurrentBundleSeafarer() { return null; },
      inAppConfirm: async (msg) => { timeline.push('confirm:' + String(msg).slice(0, 24)); return confirmAnswer; },
      async invoke(command, args) {
        calls.push({ command, args: JSON.parse(JSON.stringify(args ?? null)) });
        if (command === 'crewing_intake_rank_list' && noProfiles) return { items: [], unranked_active_profiles: [], confirmations: [] };
        if (command === 'crewing_intake_matching_profile_list' && noProfiles) return { items: [] };
        if (command === 'crewing_intake_candidate_list') return { items: srv.items, limit: 50, offset: 0, total: srv.items.length };
        if (command === 'crewing_intake_alias_list') return { items: [] };
        if (command === 'crewing_intake_candidate_get') return srv.items.find((i) => i.intake_id === args.intakeId) || srv.items[0];
        if (command === 'crewing_intake_fact_list') return { items: srv.facts[args.intakeId] || [] };
        if (command === 'crewing_intake_rank_list') return { items: [], unranked_active_profiles: [{ profile_id: 'p1', name: 'Master · Alpha' }, { profile_id: 'p2', name: 'Master · Beta' }], confirmations: [] };
        if (command === 'crewing_intake_matching_profile_list') return { items: [{ id: 'p1', crewing_id: 'crew-synthetic', name: 'Master · Alpha', version: 1, state: 'active' }, { id: 'p2', crewing_id: 'crew-synthetic', name: 'Master · Beta', version: 1, state: 'active' }] };
        if (command === 'crewing_intake_candidate_rank') {
          timeline.push('invoke:rank');
          return noProfiles
            ? { ranked: 0, written: 0, reason: 'no_active_profiles', profiles: [] }
            : { ranked: 2, written: 2, reason: 'ranked', profiles: ['p1', 'p2'] };
        }
        if (command === 'save_seafarer_from_bundle') return { id: 'sf-1', display_name: 'Oleh V.' };
        // K2.1 byte routes: one audited request per press; 404 is the server's
        // answer for an ineligible/absent part and must reach the operator as a
        // human sentence, not as a silent nothing.
        if (command === 'crewing_intake_object_download') {
          if (bytes404) throw { kind: 'server', status: 404, detail: null, ambiguous: false };
          timeline.push('invoke:object_download');
          return { path: '/home/op/Downloads/Skipi/Crewing/intake-1/letter-intake-1.eml', bytes: 2048, sha256: 'a'.repeat(64), head_text: K2_HEAD_TEXT };
        }
        if (command === 'crewing_intake_attachment_download') {
          if (bytes404) throw { kind: 'server', status: 404, detail: null, ambiguous: false };
          timeline.push('invoke:attachment_download:' + String(args && args.ordinal));
          return { path: '/home/op/Downloads/Skipi/Crewing/intake-1/attachment-' + String(args && args.ordinal) + '.pdf', bytes: 1024, sha256: 'b'.repeat(64) };
        }
        if (command === 'crewing_intake_open_saved') { timeline.push('invoke:open_saved:' + String(args && args.path)); return null; }
        if (command === 'open_mailto') {
          if (mailtoFails) throw 'no mail client';
          timeline.push('invoke:open_mailto');
          return null;
        }
        if (command === 'crewing_intake_response_contact') {
          if (responseContact === undefined) {
            throw { kind: 'server', status: 404, detail: 'candidate intake not found', ambiguous: false };
          }
          if (responseContact && responseContact.__throw) throw responseContact.__throw;
          return responseContact;
        }
        if (command === 'get_mailbox_status') return mailbox === undefined ? { configured: true, status: 'active', email_masked: 'o***@crewing.example' } : mailbox;
        if (command === 'disconnect_mailbox') { timeline.push('invoke:disconnect_mailbox'); return null; }
        return null;
      },
      calls, nodes, toasts, views, store, timeline,
      setTimeout, clearTimeout, queueMicrotask, atob, TextDecoder, Uint8Array,
      __K2_STRINGS: { en: {}, ru: {} },
    };
    // real dictionaries so the RU/EN crew_flow.* strings are exercised
    const dictStart2 = html.indexOf('var UI_STRINGS = {');
    const dictEnd2 = html.indexOf('// ── @skipi/settings v0.3.0 dictionary', dictStart2);
    vm.createContext(ctx);
    vm.runInContext(html.slice(dictStart2, dictEnd2) + '\nthis.__K2_STRINGS = UI_STRINGS;', ctx);
    // Three transports, not two: a real browser has NO __TAURI__ at all, the fleet
    // web shim defines only core, and an explicit web marker must win over both.
    if (noTauri) delete ctx.window.__TAURI__;
    else if (native) ctx.window.__TAURI__ = { core: { invoke: () => {} }, dialog: {}, event: {} };
    else ctx.window.__TAURI__ = { core: { invoke: () => {} } };
    if (webShell) ctx.window.__SKIPI_WEB_SHELL__ = true;
    // K2.1 check 13: `esc` above escapes an apostrophe, the product's escapeHtml
    // does NOT (only escapeAttr does). A stub that escapes more than the product
    // cannot see an attribute-escaping defect, so the two real one-line
    // definitions are installed FROM THE SHIPPED BYTES when a check needs them.
    if (realEscaping) {
      const defs = (html.match(/function escapeAttr\(s\)\{[^\n]*\n/) || [''])[0] + (html.match(/function escapeHtml\(s\)\{[^\n]*\n/) || [''])[0];
      if (!/escapeAttr/.test(defs) || !/escapeHtml/.test(defs)) throw new Error('escaping definitions not found in dist');
      vm.runInContext(defs, ctx);
    }
    vm.runInContext(
      `${k2crew}\n${c3b1Source}\n${c3b2Source}\n${mobileCrewBlock}\n` +
      'this.__crew = { renderCrewFlowView, renderCrewFlowDetail, renderCrewFlowTreeBody, crewFlowState, crewFlowReadInfo, pilotEnter, pilotLoadQueue, pilotOpenCard, pilotCloseCard, renderIntakePilot, mobileRenderCrewFlow };',
      ctx,
    );
    return ctx;
  }

  // An async runtime failure must be REPORTED like a synchronous one: an
  // unhandled rejection kills the process and hides every later check, which is
  // exactly what happened when this file first measured the K2.1 base.
  // The product's own caption for a key, read out of the shipped dictionary in the
  // context's current language: a check must not re-spell a user-facing sentence.
  const cardText = (ctx, key) => vm.runInContext('PILOT_CARD_TEXT[getUiLang() === \'ru\' ? \'ru\' : \'en\'][' + JSON.stringify(key) + ']', ctx);
  const tryRun = (ctx, code) => {
    try {
      const result = vm.runInContext(code, ctx);
      if (result && typeof result.then === 'function') {
        return result.catch((e) => { console.log('    (K2 runtime async: ' + (e && (e.message || e)) + ')'); return undefined; });
      }
      return result;
    } catch (e) { console.log('    (K2 runtime: ' + (e && e.message) + ')'); return undefined; }
  };

  // 4. live queue in Crew Flow
  let liveCtx = null;
  try { liveCtx = makeCrewContext({}); } catch (e) { console.error('  K2 runtime load failed:', e && e.message); }
  softOk(!!liveCtx, 'K2-4: the Crew Flow + pilot blocks load together in an isolated vm');
  if (liveCtx) {
    liveCtx.__crew.renderCrewFlowView();
    await flush();
    const mainHtml = liveCtx.nodes.get('main').innerHTML + '\n' + liveCtx.nodes.get('crew-flow-tree').innerHTML;
    const rows = (mainHtml.match(/data-qa="crew-flow-row"/g) || []).length;
    softOk(rows === 3, 'K2-4: Crew Flow renders one row per live intake candidate — got ' + rows);
    // K2.2 (OWNER 27.09): the row is a column (identifier · type/date · badges), never the one-line flex that cut the text at 280 px.
    const stackedRows = (liveCtx.nodes.get('crew-flow-tree').innerHTML.match(/<div class="tree-item ti-stack[^"]*" data-qa="crew-flow-row"/g) || []).length;
    softOk(stackedRows === 3, 'K2.2: every live queue row carries ti-stack (stacked layout) — got ' + stackedRows);
    softOk(liveCtx.calls.some((c) => c.command === 'crewing_intake_candidate_list'), 'K2-4: the live source is crewing_intake_candidate_list');
    softOk(!liveCtx.calls.some((c) => c.command === 'fetch_my_vacancies'), 'K2-4: Crew Flow never asks for vacancies');
    softOk(mainHtml.includes('data-qa="crew-flow-live"'), 'K2-4: the live Crew Flow surface is marked');
    liveCtx.__crew.pilotOpenCard('intake-1');
    await flush();
    const cardHtml = liveCtx.nodes.get('main').innerHTML;
    softOk(/data-qa="crewing-intake-card-view"/.test(cardHtml) && liveCtx.state.view === 'crew_flow',
      'K2-4: opening a row hosts the C3b-2 candidate card inside #main while state.view stays crew_flow');
    const actionIds = [...cardHtml.matchAll(/data-qa="crew-flow-action-([a-z_]+)"/g)].map((m) => m[1]);
    softOk(cardHtml.includes('data-qa="crew-flow-actions"'), 'K2-4: the operator action panel renders on the card');
    softOk(['save', 'email', 'request_docs', 'match', 'ignore', 'later'].every((id) => actionIds.includes(id)),
      'K2-5: the action panel carries the five operator actions (email/request-docs is one action, two controls) — got [' + actionIds.join(',') + ']');

    // 5. individual actions
    // K2.1 (OWNER (739)): "write email" no longer routes into a mail module — it
    // opens the draft ON the card. It is therefore enabled with or without a
    // recorded contact: a missing address is answered with a dialog (check 7),
    // never with a dead button.
    const emailBtn = (cardHtml.match(/<button[^>]*data-qa="crew-flow-action-email"[^>]*>/) || [''])[0];
    softOk(emailBtn !== '' && !/disabled/.test(emailBtn), 'K2-5: "write email" is enabled when the contact fact exists');
    liveCtx.__crew.pilotCloseCard();
    await flush();
    liveCtx.__crew.pilotOpenCard('intake-3');
    await flush();
    const noEmailCard = liveCtx.nodes.get('main').innerHTML;
    const noEmailBtn = (noEmailCard.match(/<button[^>]*data-qa="crew-flow-action-email"[^>]*>/) || [''])[0];
    softOk(noEmailBtn !== '' && !/disabled/.test(noEmailBtn) && /data-qa="crew-flow-email-hint"/.test(noEmailCard),
      'K2.1/K2-5: without a contact fact the action stays reachable and the panel says the address is missing');

    const mailCtx = makeCrewContext({});
    mailCtx.__crew.renderCrewFlowView(); await flush();
    mailCtx.__crew.pilotOpenCard('intake-1'); await flush();
    await tryRun(mailCtx, "crewFlowWriteEmail('intake-1','reply');");
    await flush();
    softOk(!mailCtx.views.includes('mail'), 'K2.1/K2-5: "write email" no longer routes into the retired Mail module');
    softOk(/data-qa="pilot-draft"/.test(mailCtx.nodes.get('main').innerHTML),
      'K2.1/K2-5: "write email" opens the draft on the candidate card');

    const ignCtx = makeCrewContext({});
    ignCtx.__crew.renderCrewFlowView(); await flush();
    tryRun(ignCtx, "crewFlowIgnoreSignal('intake-1');");
    await flush();
    const readState = JSON.parse(ignCtx.store.get('skipi_crewing_crew_flow_read_state_v2') || '{}');
    softOk(readState['intake-1'] && readState['intake-1'].action === 'ignored', 'K2-5: "ignore" writes the ignored read-state for the intake id');
    const afterIgnore = ignCtx.nodes.get('main').innerHTML + '\n' + ignCtx.nodes.get('crew-flow-tree').innerHTML;
    softOk((afterIgnore.match(/data-qa="crew-flow-row"/g) || []).length === 2, 'K2-5: an ignored candidate leaves the main list');

    const saveCtx = makeCrewContext({});
    saveCtx.__crew.renderCrewFlowView(); await flush();
    saveCtx.__crew.pilotOpenCard('intake-1'); await flush();
    await tryRun(saveCtx, "crewFlowSaveToSeafarers('intake-1');");
    await flush();
    const saveCall = saveCtx.calls.find((c) => c.command === 'save_seafarer_from_bundle');
    softOk(!!saveCall && saveCall.args.applicationId === 'intake:intake-1', 'K2-5: "save to seafarers DB" uses application_id intake:<intake_id>');
    softOk(!!saveCall && saveCall.args.applicantSummary && saveCall.args.applicantSummary.rank === 'Master', 'K2-5: the saved applicant summary carries the rank fact');
    softOk(!!saveCall && saveCall.args.manifest && saveCall.args.manifest.exported_by && saveCall.args.manifest.exported_by.messaging_user_id === 'intake:intake-1',
      'K2-5/U1: the manifest messaging_user_id is the intake: namespace');

    const matchCtx = makeCrewContext({});
    matchCtx.__crew.renderCrewFlowView(); await flush();
    matchCtx.__crew.pilotOpenCard('intake-2'); await flush();
    await tryRun(matchCtx, "crewFlowMatchToProfile('intake-2');");
    await flush();
    softOk(matchCtx.calls.some((c) => c.command === 'crewing_intake_candidate_rank'), 'K2-5: "match against a profile" dispatches crewing_intake_candidate_rank');

    // S-web: the save action is native-transport only until K3
    const webCtx = makeCrewContext({ native: false });
    webCtx.__crew.renderCrewFlowView(); await flush();
    webCtx.__crew.pilotOpenCard('intake-1'); await flush();
    const webCard = webCtx.nodes.get('main').innerHTML;
    const webSaveBtn = (webCard.match(/<button[^>]*data-qa="crew-flow-action-save"[^>]*>/) || [''])[0];
    softOk(/disabled/.test(webSaveBtn) && /data-qa="crew-flow-save-hint"/.test(webCard),
      'K2-5/S-web: on the web shim "save to seafarers DB" is disabled with an explicit K3 note');
    const nativeCard = liveCtx.nodes.get('main').innerHTML;
    softOk(!/disabled/.test((nativeCard.match(/<button[^>]*data-qa="crew-flow-action-save"[^>]*>/) || [''])[0]),
      'K2-5/S-web: on the native transport the same action is enabled');

    // mobile shell hosts the same live list
    const mobCtx = makeCrewContext({});
    mobCtx.state.view = 'mobile-crew_flow';
    tryRun(mobCtx, "state.view = 'mobile-crew_flow'; mobileRenderCrewFlow();");
    await flush();
    const mobHtml = mobCtx.nodes.get('mobile-main').innerHTML;
    softOk((mobHtml.match(/data-qa="crew-flow-row"/g) || []).length === 3 && mobHtml.includes('data-qa="crew-flow-live"'),
      'K2-4: the mobile shell renders the same live queue into #mobile-main');
    softOk(/if \(view === 'crew_flow'\) return mobileRenderCrewFlow\(\);/.test(k2mobileShow), 'K2-4: mobileShow routes crew_flow to the mobile Crew Flow renderer');

    // 6. honest empty state without a connection
    // R2 (OWNER 2026-09-29): the needle changed because the screen it named
    // changed. Until R2 the hint sent the operator to «Настройки → Доступ /
    // токены», a tab that the unified settings shell no longer renders — the
    // operator followed the instruction and arrived at a screen with no Server
    // URL and no token field. The hint now names the Crewing-owned connection
    // section (home-crewing-connection) that openSettings('connection') opens,
    // and the retired wording is asserted absent so it cannot come back.
    for (const [lang, needle, retired] of [['ru', 'Подключение', 'Доступ / токены'], ['en', 'Connection', 'Access / tokens']]) {
      const emptyCtx = makeCrewContext({ language: lang, settings: {} });
      emptyCtx.__crew.renderCrewFlowView();
      await flush();
      const emptyHtml = emptyCtx.nodes.get('main').innerHTML + '\n' + emptyCtx.nodes.get('crew-flow-tree').innerHTML;
      softOk(emptyHtml.includes(needle) && emptyHtml.includes('data-qa="crew-flow-empty"'),
        `K2-6: without a connection the ${lang} empty state points at Settings (${needle})`);
      softOk(!emptyHtml.includes(retired),
        `K2-6/R2: the ${lang} empty state no longer names the retired «${retired}» tab`);
      softOk(!emptyHtml.includes('Vacancies -> Applications'), `K2-6: the ${lang} empty state no longer mentions the retired vacancies direction`);
      softOk(!emptyCtx.calls.some((c) => c.command === 'crewing_intake_candidate_list'), `K2-6: no queue request is made without a connection (${lang})`);
    }
  const fxSlice = (from, to) => {
      const a = html.indexOf(from);
      if (a < 0) return '';
      const b = html.indexOf(to, a);
      return b > a ? html.slice(a, b) : '';
    };

    // ---- S1 (K2.1): the draft replaces the mailbox chain -----------------------
    // The old S1a/S1b measured a module that no longer exists (one in-flight
    // get_mailbox_status; a compose form surviving an unawaited mailbox render).
    // What must be measured now is the SAME property on the surviving path: the
    // review state is a claim about what the operator did, so it is written only
    // after the external client actually accepted the draft. Both directions are
    // in the K2.1 section below (checks 6 and 15); nothing is dropped silently.
    {
      softOk(!html.includes('function mailboxViewReady(') && !html.includes('function loadMailboxStatus('),
        'S1/K2.1: the mailbox render chain the old S1 measured is gone from the shipped HTML');
    }

    // ---- A2 (supervisor acceptance): three mutants that survived all 16 -----
    // (a) the confirm before the irreversible save must exist AND its refusal
    //     must stop the write; (b) a real browser has no __TAURI__ at all and
    //     must be treated as web; (c) an explicit web marker must win.
    {
      const askCtx = makeCrewContext({});
      askCtx.__crew.renderCrewFlowView(); await flush();
      askCtx.__crew.pilotOpenCard('intake-1'); await flush();
      await tryRun(askCtx, "crewFlowSaveToSeafarers('intake-1');");
      await flush(10);
      softOk(askCtx.timeline.some((e) => e.startsWith('confirm:')),
        'A2a: the irreversible save asks for confirmation first');
      const iConfirm = askCtx.timeline.findIndex((e) => e.startsWith('confirm:'));
      const savedAt = askCtx.calls.findIndex((c) => c.command === 'save_seafarer_from_bundle');
      softOk(iConfirm !== -1 && savedAt !== -1, 'A2a: and then writes');

      const noCtx = makeCrewContext({ confirmAnswer: false });
      noCtx.__crew.renderCrewFlowView(); await flush();
      noCtx.__crew.pilotOpenCard('intake-1'); await flush();
      await tryRun(noCtx, "crewFlowSaveToSeafarers('intake-1');");
      await flush(10);
      softOk(noCtx.timeline.some((e) => e.startsWith('confirm:')), 'A2a: a declined save still asked');
      softOk(!noCtx.calls.some((c) => c.command === 'save_seafarer_from_bundle'),
        'A2a: declining the confirm writes NOTHING to the seafarer database');
      const rsNo = JSON.parse(noCtx.store.get('skipi_crewing_crew_flow_read_state_v2') || '{}');
      softOk(!(rsNo['intake-1'] && rsNo['intake-1'].saved_to_db), 'A2a: and marks nothing as saved');

      for (const [name, opts] of [['a real browser (no __TAURI__)', { noTauri: true }],
                                  ['an explicit web shell marker', { webShell: true, native: true }]]) {
        const webCtx = makeCrewContext(opts);
        webCtx.__crew.renderCrewFlowView(); await flush();
        webCtx.__crew.pilotOpenCard('intake-1'); await flush();
        const btn = (webCtx.nodes.get('main').innerHTML.match(/<button[^>]*data-qa="crew-flow-action-save"[^>]*>/) || [''])[0];
        softOk(/disabled/.test(btn), 'A2b/c: on ' + name + ' the save action is disabled');
        await tryRun(webCtx, "crewFlowSaveToSeafarers('intake-1');");
        await flush(10);
        softOk(!webCtx.calls.some((c) => c.command === 'save_seafarer_from_bundle'),
          'A2b/c: on ' + name + ' the handler itself refuses to write, not only the button');
      }
    }
    // ---- A1: the candidate card must not call into the retired module -------
    {
      const cardTexts = fxSlice('var PILOT_CARD_TEXT = {', 'var PILOT_CARD_OUTCOME_GROUP');
      softOk(cardTexts !== '', 'A1: the candidate-card dictionaries are bounded');
      const hits = cardTexts.match(/[Vv]acanc\w*|[Вв]аканси\w*/g) || [];
      softOk(hits.length === 0,
        'A1: the candidate card names compliance profiles, not vacancies — got ' + hits.length + ' [' + [...new Set(hits)].join(',') + ']');
      // \w is ASCII-only in JS — a Cyrillic class has to be spelled out, or the
      // probe silently measures nothing (measured: it failed on correct text).
      softOk(/compliance profile/i.test(cardTexts) && /профил[а-яё]* соответствия/i.test(cardTexts),
        'A1: and says so in both languages');
    }

    // ---- fix-up 2 (counselor close N6 + the manager's live acceptance) -------
    // C1: "matched" is a claim about the SERVER. It may be written only after the
    // server confirms a comparison was made, and never when there is nothing to
    // compare against.
    {
      const okCtx = makeCrewContext({});
      okCtx.__crew.renderCrewFlowView(); await flush();
      okCtx.__crew.pilotOpenCard('intake-2'); await flush();
      await tryRun(okCtx, "crewFlowMatchToProfile('intake-2');");
      await flush(10);
      const tl = okCtx.timeline;
      const iRank = tl.indexOf('invoke:rank');
      const iMark = tl.indexOf('read-state:matched');
      softOk(iRank !== -1, 'C1: "match against a profile" dispatches the rank command');
      softOk(iMark !== -1 && iRank < iMark,
        'C1: the matched review state is written AFTER the server answers — timeline [' + tl.join(' > ') + ']');
      const noneCtx = makeCrewContext({ noProfiles: true });
      noneCtx.__crew.renderCrewFlowView(); await flush();
      noneCtx.__crew.pilotOpenCard('intake-2'); await flush();
      await tryRun(noneCtx, "crewFlowMatchToProfile('intake-2');");
      await flush(10);
      const rsNone = JSON.parse(noneCtx.store.get('skipi_crewing_crew_flow_read_state_v2') || '{}');
      softOk(!(rsNone['intake-2'] && rsNone['intake-2'].action === 'matched'),
        'C1: with no compliance profiles nothing is marked as compared');
      softOk(noneCtx.toasts.some(([m]) => /profile|профил/i.test(String(m))),
        'C1: with no compliance profiles the operator is told why, not left with a false label');
    }
    // C2: the confirm must state the truth of the product — a saved seafarer
    // cannot be deleted anywhere, not only "not from Crew Flow".
    softOk(!/нельзя отменить из Crew Flow|cannot be undone from Crew Flow/.test(html),
      'C2: the save confirm no longer claims the limit is only Crew Flow');
    softOk(/'crew_flow\.save_confirm':'[^']*базе моряков/.test(html) && /'crew_flow\.save_confirm':'[^']*seafarer database/.test(html),
      'C2: the save confirm says a saved seafarer cannot be deleted anywhere (RU and EN)');
    // C3: no internal card identifiers in user-facing copy.
    softOk(!/K3/.test((html.match(/'crew_flow\.save_web_note':'[^']*'/g) || []).join(' ')),
      'C3: the web-version note carries no internal identifier');
    softOk((html.match(/'crew_flow\.save_web_note':'[^']*'/g) || []).length === 2,
      'C3: the web-version note exists in both dictionaries');
    // C4: ignore / keep-for-later are device-local until there is server state.
    softOk((html.match(/'crew_flow\.local_decision':'[^']*'/g) || []).length === 2,
      'C4: the local-decision note exists in both dictionaries');
    softOk(/data-qa="crew-flow-local-note"/.test(html),
      'C4: the action panel carries the local-decision note');
    // C5: the connection screen must not promise a vacancies list any more.
    softOk(!/first screen is your vacancies|первым экраном станет список ваших вакансий/.test(html),
      'C5: the connection screen no longer promises a vacancies list');
    softOk((html.match(/'mobile\.connect_desc':'[^']*Crew Flow/g) || []).length === 2,
      'C5: the connection screen names Crew Flow as the first screen (RU and EN)');
    // C6: the chrome i18n table must not carry retired tab ids.
    {
      const chromeTable = fxSlice('function applyI18nChrome() {', '\n}');
      softOk(chromeTable !== '', 'C6: the applyI18nChrome table is bounded');
      for (const id of ['mt-vacancies', 'mt-mailings', 'mt-team', 'mt-intake_pilot']) {
        softOk(!chromeTable.includes(id), 'C6: the chrome i18n table no longer lists ' + id);
      }
      softOk(chromeTable.includes('mt-compliance') && chromeTable.includes('mt-seafarers'),
        'C6: the surviving modules stay in the chrome i18n table');
    }

    // ---- S2: surviving copy must not send the operator to a deleted module ----
    {
      const screens = [
        ['compliance list', fxSlice('function renderComplianceProfilesEmptyMain', '\nfunction renderComplianceProfileDetail')],
        ['compliance tree', fxSlice('function renderComplianceProfilesTree', '\nfunction renderComplianceProfilesEmptyMain')],
        ['compliance detail', fxSlice('function renderComplianceProfileDetail', '\nfunction renderComplianceProfileForm')],
        ['compliance form', fxSlice('function renderComplianceProfileForm', '\nasync function saveComplianceProfile')],
        ['settings org', fxSlice("  if (settingsTab==='org') {", "  } else if (settingsTab==='data') {")],
        ['settings access', fxSlice("  } else if (settingsTab==='access') {", "  } else if (settingsTab==='app') {")],
      ];
      const nav = /вакансии|вакансию|вакансий|вакансиях|вакансия|Vacanc|vacanc/;
      for (const [name, slice] of screens) {
        softOk(slice !== '', 'S2: the "' + name + '" screen slice is bounded');
        const hits = (slice.match(new RegExp(nav.source, 'g')) || []);
        softOk(hits.length === 0, 'S2: "' + name + '" no longer points at the retired vacancies module — got ' + hits.length + ' [' + [...new Set(hits)].join(',') + ']');
      }
      softOk(/Crew Flow/.test(fxSlice('function renderComplianceProfilesEmptyMain', '\nfunction renderComplianceProfileDetail')),
        'S2: the compliance empty state (the pilot operator’s first screen) names Crew Flow as the real destination');
    }

    // ---- S5: one guard pin, one localized team row ---------------------------
    {
      const pins = (workflow.match(/repository: CaptTymur\/skipi-guard\n\s+ref: ([0-9a-f]{40})/) || [])[1];
      softOk(pins === 'aa3b2efb19cb4448226075be36b3f8c7b302c3df', 'S5: the workflow pins exactly the accepted guard SHA');
      // The needles are assembled from halves on purpose: a probe that spells a
      // SHA out reads its own source and can never pass (self-referential-probe
      // class — measured three times in this session, this line included).
      // b72a59ca joined the list with the K2.1 pin bump (PR #54): it is the gate
      // configuration WITHOUT the K2.1 route, so accepting it would mean the
      // workflow could run a gate that never heard of this task. RISKS №497: a pin
      // bump touching more than one file skips assert-config-superset, so a
      // downgrade of the pin passes CI green — this line is what notices.
      const superseded = ['93b1a51e' + 'b59d0dff5f2db3f2289b8afb09761f39', '7bd93006' + '01e5445a9a60f1136d2fd57a9e9b32c5', 'b72a59ca' + '947ddb6a70a07b0328b61f9a29eca090'];
      const selfSrc = fs.readFileSync('tests/crewing_c3b2_candidate_harness.mjs', 'utf8');
      softOk(superseded.every((sha) => !selfSrc.includes(sha) && !workflow.includes(sha)),
        'S5: neither the harness nor the workflow still accepts a superseded guard pin');
      softOk(!html.includes('Vacancies -> Applications'), 'S5: the three unreachable "Vacancies -> Applications" strings are gone');
      const access = fxSlice("  } else if (settingsTab==='access') {", "  } else if (settingsTab==='app') {");
      softOk(/tr\('settings\.team_access[^']*'\)/.test(access) || /crewFlowTr|tr\('team\./.test(access),
        'S5: the team-access settings row is served through tr(), not a Russian literal');
    }

    // ---- S7: the mobile Crew Flow subtitle is localized -----------------------
    {
      softOk(!/if \(view === 'crew_flow'\) return \[mobileModuleLabel\('crew_flow'\), 'Incoming candidate signals'\];/.test(html),
        'S7: the mobile Crew Flow subtitle is no longer a hardcoded English literal');
      softOk(/'crew_flow\.mobile_subtitle':'[^'Ѐ-ӿ]+'/.test(html) && /'crew_flow\.mobile_subtitle':'[^']*[Ѐ-ӿ]/.test(html),
        'S7: crew_flow.mobile_subtitle exists in both the en and the ru dictionary');
    }

    // 9. demo mode is untouched
    const demoCtx = makeCrewContext({ demo: true });
    try { demoCtx.__crew.renderCrewFlowView(); } catch (e) { console.log('    (K2 demo render: ' + (e && e.message) + ')'); }
    await flush();
    const demoHtml = demoCtx.nodes.get('main').innerHTML + '\n' + demoCtx.nodes.get('crew-flow-tree').innerHTML;
    softOk(demoHtml.includes('Oleksandr K.') && !demoCtx.calls.some((c) => c.command === 'crewing_intake_candidate_list'),
      'K2-9: demo mode still renders the fixture signals and never calls the live queue');

    // -----------------------------------------------------------------------
    // # K2.1 single screen (OWNER (739) п.2–5; card D1 checks 1–18)
    // The mailbox module is retired and the candidate card becomes THE screen:
    // the original letter, its attachments, the contacts as written, the stored
    // comparisons, and one draft that leaves through an external client. Every
    // check below is RED on the K2.1 base commit.
    // -----------------------------------------------------------------------
    console.log('# K2.1 single screen');

    // ---- 1. the module is gone from the shipped HTML ------------------------
    softOk(!html.includes('id="mt-mail"'), 'K2.1-1: the desktop mail tab is gone');
    softOk(!html.includes("showView('mail')") && !/\['mail','crew_flow'/.test(html),
      'K2.1-1: no route into a mail view and no mail slot in the tab-highlight list');
    softOk(!html.includes('CREWING MAILBOX MODULE START') && !html.includes('CREWING MAILBOX MODULE END'),
      'K2.1-1: the mailbox module block is gone');
    for (const gone of ['function mailboxViewReady(', 'function openMailCompose(', 'function classifyMailCvMessage(',
      'function mailCandidateEnrichmentForMessage(', 'function renderMailboxTree(', 'function sendMailFromCompose(',
      'function deleteMailMessage(', 'function saveMailboxSettings(', 'function mailboxPayloadFromForm(']) {
      softOk(!html.includes(gone), 'K2.1-1: ' + gone.slice(9, -1) + ' left with the module');
    }
    softOk(!/mobileNavButton\('mail'/.test(html) && !html.includes("mail: 'bottom-nav-mail'"),
      'K2.1-1: the mobile rail builds no mail slot');
    softOk(html.includes('data-qa="crew-flow-view"') && html.includes('id="mt-crew_flow"') && html.includes('data-mview="'),
      'K2.1-1: the must-keep Crew Flow presence tokens survive');

    // ---- 2/3/13. the four blocks, eligibility and escaping -----------------
    {
      const cardCtx = makeCrewContext({});
      cardCtx.__crew.renderCrewFlowView(); await flush();
      cardCtx.__crew.pilotOpenCard('intake-1'); await flush();
      const cardHtml2 = cardCtx.nodes.get('main').innerHTML;
      softOk(/data-qa="pilot-section-letter"/.test(cardHtml2) && /data-qa="pilot-section-attachments"/.test(cardHtml2)
        && /data-qa="pilot-section-contacts"/.test(cardHtml2) && /data-qa="pilot-section-ranks"/.test(cardHtml2),
        'K2.1-2: the card renders the four blocks letter · attachments · contacts · comparisons');
      softOk(/data-qa="pilot-letter-object">o-letter · message\/rfc822/.test(cardHtml2) && /data-qa="pilot-letter-open"/.test(cardHtml2),
        'K2.1-2: the letter block names the rfc822 object and offers the original');
      softOk(cardCtx.calls.filter((c) => /download/.test(c.command)).length === 0,
        'K2.1-2: opening a card asks for NO bytes — the byte routes are explicit presses only');
      const rows = [...cardHtml2.matchAll(/data-qa="pilot-attachment" data-ordinal="(\d+)"/g)].map((m) => m[1]);
      softOk(rows.join(',') === '1,2', 'K2.1-2: attachment rows render in ordinal order — got [' + rows.join(',') + ']');
      softOk(/oleh-cv\.pdf/.test(cardHtml2) && /210000 B/.test(cardHtml2) && /accepted/.test(cardHtml2),
        'K2.1-2: an attachment row carries filename, size and the verdict in words');
      const dl = [...cardHtml2.matchAll(/data-qa="pilot-attachment-download" data-ordinal="(\d+)"/g)].map((m) => m[1]);
      softOk(dl.join(',') === '1', 'K2.1-3: only the eligible attachment offers a download — got [' + dl.join(',') + ']');
      softOk(/data-qa="pilot-attachment-blocked"[^>]*>[^<]*declared type does not match the content/.test(cardHtml2),
        'K2.1-3: the ineligible attachment states its reason instead of a button');
      softOk(/Eligibility is not an antivirus verdict/.test(cardHtml2),
        'K2.1-3: the block says eligibility is not an antivirus verdict (no green tick)');
      // 13: real escaping, hostile filenames, empty filename
      const hostileCtx = makeCrewContext({ realEscaping: true, attachments: K2_ATTACHMENTS_HOSTILE });
      hostileCtx.__crew.renderCrewFlowView(); await flush();
      hostileCtx.__crew.pilotOpenCard('intake-1'); await flush();
      const hostile = hostileCtx.nodes.get('main').innerHTML;
      softOk(!/<img src=x/.test(hostile) && /&lt;img src=x onerror=1&gt;\.pdf/.test(hostile),
        'K2.1-13: a filename that is markup is rendered as text, not as markup');
      softOk(!/data-ordinal="2"[^>]*a'b/.test(hostile) && /a&#39;b&quot;c\.pdf|a&#39;b&#34;c\.pdf/.test(hostile),
        'K2.1-13: quotes and apostrophes in a filename are escaped for their attribute');
      softOk(/without a name/.test(hostile), 'K2.1-13: an empty filename gets an explicit caption, not an empty cell');
      softOk(/scanner unavailable/.test(hostile) && /data-qa="pilot-attachment-download" data-ordinal="2"/.test(hostile),
        'K2.1-13: needs_review + scanner_unavailable stays eligible and says why');
    }

    // ---- 4/16. contacts as written, and WHICH address is the addressee ------
    {
      const bothCtx = makeCrewContext({});
      bothCtx.__crew.renderCrewFlowView(); await flush();
      bothCtx.__crew.pilotOpenCard('intake-1'); await flush();
      const bothHtml = bothCtx.nodes.get('main').innerHTML;
      softOk(/data-qa="pilot-contact-email"[^>]*>[^<]*oleh@example\.test/.test(bothHtml) && /\+380 50 000 00 00/.test(bothHtml),
        'K2.1-4: the contact facts are shown as written');
      softOk(/data-qa="pilot-contact-add"/.test(bothHtml) && /pilotContactStart\('contact:phone'\)|pilotContactStart\('contact:email'\)/.test(bothHtml),
        'K2.1-4: "specify" leads into the existing operator fact form');
      // The original is fetched FIRST, so the letter's own From is on the card
      // when the draft opens: without that the "addressee is not the From" check
      // would be measuring a value the screen never had.
      await tryRun(bothCtx, "pilotLetterDownload();"); await flush(10);
      softOk(/letter-from@example\.test/.test(bothCtx.nodes.get('main').innerHTML),
        'K2.1-5: the letter From is on the card (the address the draft must NOT use)');
      await tryRun(bothCtx, "crewFlowWriteEmail('intake-1','reply');"); await flush();
      const draftSection = (htmlStr) => (htmlStr.match(/<section class="pilot-card" data-qa="pilot-draft">[\s\S]*?<\/section>/) || [''])[0];
      const bothDraft = draftSection(bothCtx.nodes.get('main').innerHTML);
      softOk(/data-qa="pilot-draft-to"[^>]*>[^<]*oleh@example\.test/.test(bothDraft) && !/old-card@example\.test/.test(bothDraft),
        'K2.1-16: with both facts present the addressee is contact:email, never the old card field');
      softOk(bothDraft !== '' && !/letter-from@example\.test/.test(bothDraft),
        'K2.1-5: the addressee is the recorded contact, never the From of the letter');
      const legacyCtx = makeCrewContext({ contactMode: 'legacy' });
      legacyCtx.__crew.renderCrewFlowView(); await flush();
      legacyCtx.__crew.pilotOpenCard('intake-1'); await flush();
      await tryRun(legacyCtx, "crewFlowWriteEmail('intake-1','reply');"); await flush();
      const legacyDraft = draftSection(legacyCtx.nodes.get('main').innerHTML);
      softOk(/data-qa="pilot-draft-to"[^>]*>[^<]*old-card@example\.test/.test(legacyDraft) && /data-qa="pilot-draft-legacy"/.test(legacyDraft)
        && /address from the old card/.test(legacyDraft),
        'K2.1-16: with only the pre-S2 field the draft uses it AND says the address comes from the old card');
    }

    // ---- 5/6. the draft leaves through an external client, state after Ok ---
    {
      const okCtx = makeCrewContext({});
      okCtx.__crew.renderCrewFlowView(); await flush();
      okCtx.__crew.pilotOpenCard('intake-1'); await flush();
      await tryRun(okCtx, "crewFlowWriteEmail('intake-1','reply');"); await flush();
      const draftHtml = okCtx.nodes.get('main').innerHTML;
      softOk(/data-qa="pilot-draft-subject"/.test(draftHtml) && /data-qa="pilot-draft-body"/.test(draftHtml)
        && /data-qa="pilot-draft-open-client"/.test(draftHtml),
        'K2.1-5: the draft carries an editable subject, an editable body and one control that opens the client');
      softOk(/Master · Alpha/.test(draftHtml) || /Master/.test(draftHtml),
        'K2.1-5: the autotext names the chosen compliance profile');
      const beforeState = JSON.parse(okCtx.store.get('skipi_crewing_crew_flow_read_state_v2') || '{}');
      softOk(!(beforeState['intake-1'] && beforeState['intake-1'].action === 'draft_opened'),
        'K2.1-6: opening the draft alone marks nothing');
      await tryRun(okCtx, "pilotDraftOpenClient();"); await flush(10);
      const mailtoCall = okCtx.calls.find((c) => c.command === 'open_mailto');
      softOk(!!mailtoCall && mailtoCall.args.to === 'oleh@example.test' && typeof mailtoCall.args.subject === 'string' && typeof mailtoCall.args.body === 'string',
        'K2.1-5: the client is opened through open_mailto with the draft recipient, subject and body');
      softOk(!!mailtoCall && !('attachment' in mailtoCall.args) && !('attachments' in mailtoCall.args) && !/attachment=/.test(String(mailtoCall.args.body)),
        'K2.1-5: nothing is attached to the draft — mailto carries no files');
      const afterState = JSON.parse(okCtx.store.get('skipi_crewing_crew_flow_read_state_v2') || '{}');
      softOk(afterState['intake-1'] && afterState['intake-1'].action === 'draft_opened',
        'K2.1-6: the draft_opened review state is written after the client accepted the draft');
      softOk(/data-qa="pilot-draft-state"/.test(okCtx.nodes.get('main').innerHTML),
        'K2.1-6: the card shows the draft-opened state');
      const errCtx = makeCrewContext({ mailtoFails: true });
      errCtx.__crew.renderCrewFlowView(); await flush();
      errCtx.__crew.pilotOpenCard('intake-1'); await flush();
      await tryRun(errCtx, "crewFlowWriteEmail('intake-1','reply');"); await flush();
      await tryRun(errCtx, "pilotDraftOpenClient();"); await flush(10);
      const errState = JSON.parse(errCtx.store.get('skipi_crewing_crew_flow_read_state_v2') || '{}');
      softOk(!(errState['intake-1'] && errState['intake-1'].action === 'draft_opened'),
        'K2.1-6: a refused client marks nothing');
      softOk(errCtx.toasts.some(([m]) => String(m) === cardText(errCtx, 'draft_failed')),
        'K2.1-6: a refused client is explained to the operator');
      softOk(!/data-qa="pilot-draft-state"/.test(errCtx.nodes.get('main').innerHTML),
        'K2.1-6: no draft-opened state is shown when the client refused');
    }

    // ---- 7. no contact -> a dialog, not a refusal ---------------------------
    {
      const noneCtx = makeCrewContext({ contactMode: 'none' });
      noneCtx.__crew.renderCrewFlowView(); await flush();
      noneCtx.__crew.pilotOpenCard('intake-1'); await flush();
      await tryRun(noneCtx, "crewFlowWriteEmail('intake-1','reply');"); await flush();
      const noneHtml = noneCtx.nodes.get('main').innerHTML;
      softOk(/data-qa="pilot-draft-need-contact"/.test(noneHtml) && /data-qa="pilot-draft-contact-input"/.test(noneHtml)
        && /data-qa="pilot-draft-contact-save"/.test(noneHtml),
        'K2.1-7: without a contact the draft asks for the address in a dialog');
      softOk(!noneCtx.toasts.some(([m]) => /address|адрес/i.test(String(m))),
        'K2.1-7: the missing address is not answered with a refusal toast');
      await tryRun(noneCtx, "state.intakePilot.detail.draft.contactValue = 'typed@example.test'; pilotDraftContactSave();"); await flush(12);
      const factCall = noneCtx.calls.find((c) => c.command === 'crewing_intake_fact_record');
      softOk(!!factCall && factCall.args.fact && factCall.args.fact.field === 'contact:email' && factCall.args.fact.value === 'typed@example.test',
        'K2.1-7: the typed address is recorded as the operator fact contact:email');
      softOk(!!factCall && factCall.args.fact.source_object === 'o1',
        'K2.1-7: the operator fact cites an object of THIS candidate');
    }

    // ---- 8. labels for rank_as_written and for the uncertainty codes --------
    for (const [lang, field, code] of [['en', 'as written', 'the rank is written ambiguously'], ['ru', 'написание в документе', 'ранг записан неоднозначно']]) {
      const labCtx = makeCrewContext({ language: lang });
      labCtx.__crew.renderCrewFlowView(); await flush();
      labCtx.__crew.pilotOpenCard('intake-1'); await flush();
      const labHtml = labCtx.nodes.get('main').innerHTML;
      softOk(labHtml.includes(field), 'K2.1-8: rank_as_written has a ' + lang + ' caption');
      softOk(labHtml.includes(code), 'K2.1-8: the rank_ambiguous code has a ' + lang + ' caption');
      softOk(!/unknown_reason|причина неизвестна/.test(labHtml), 'K2.1-8: no raw "unknown reason: <code>" is shown (' + lang + ')');
    }

    // ---- 9. the web shell: a mailto link, and byte buttons disabled ---------
    {
      const webCtx2 = makeCrewContext({ webShell: true, native: false });
      webCtx2.__crew.renderCrewFlowView(); await flush();
      webCtx2.__crew.pilotOpenCard('intake-1'); await flush();
      const webHtml = webCtx2.nodes.get('main').innerHTML;
      softOk(/<button[^>]*data-qa="pilot-letter-open"[^>]*disabled/.test(webHtml)
        && /<button[^>]*data-qa="pilot-attachment-download"[^>]*disabled/.test(webHtml),
        'K2.1-9: on the web shell the byte controls are disabled with a note');
      softOk(/data-qa="pilot-bytes-web-note"/.test(webHtml), 'K2.1-9: the web shell explains why the byte controls are off');
      await tryRun(webCtx2, "crewFlowWriteEmail('intake-1','reply');"); await flush();
      const webDraft = webCtx2.nodes.get('main').innerHTML;
      softOk(/data-qa="pilot-draft-mailto"[^>]*href="mailto:oleh@example\.test\?subject=/.test(webDraft),
        'K2.1-9: on the web shell the draft is a mailto: link the browser can open');
      softOk(!webCtx2.calls.some((c) => c.command === 'open_mailto'),
        'K2.1-9: the web shell never calls the native open_mailto');
    }

    // ---- 10. the review-state key was renamed, in both dictionaries ---------
    softOk(!/'crew_flow\.state_emailed'/.test(html), 'K2.1-10: crew_flow.state_emailed is gone');
    softOk((html.match(/'crew_flow\.state_draft_opened':'[^']*'/g) || []).length === 2,
      'K2.1-10: crew_flow.state_draft_opened exists in both dictionaries');
    softOk(/'crew_flow\.state_draft_opened':'[^'Ѐ-ӿ]+'/.test(html) && /'crew_flow\.state_draft_opened':'[^']*[Ѐ-ӿ]/.test(html),
      'K2.1-10: the draft-opened caption is localized, not one language twice');

    // ---- 11. RFC 2047 best effort, on the letter the server returns ---------
    {
      const decCtx = makeCrewContext({});
      decCtx.__crew.renderCrewFlowView(); await flush();
      decCtx.__crew.pilotOpenCard('intake-1'); await flush();
      await tryRun(decCtx, "pilotLetterDownload();"); await flush(10);
      const decHtml = decCtx.nodes.get('main').innerHTML;
      softOk(decCtx.calls.some((c) => c.command === 'crewing_intake_object_download' && c.args.objectId === 'o-letter'),
        'K2.1-11: the original is fetched by the id of the rfc822 object');
      softOk(/data-qa="pilot-letter-from"[^>]*>[^<]*Олег В/.test(decHtml),
        'K2.1-11: a base64 encoded-word in From is decoded (B, utf-8)');
      softOk(/data-qa="pilot-letter-subject"[^>]*>[^<]*CV Мастер/.test(decHtml),
        'K2.1-11: a quoted-printable encoded-word in Subject is decoded and the folded line is joined (Q, utf-8)');
      softOk(/data-qa="pilot-letter-date"[^>]*>[^<]*Wed, 24 Sep 2026/.test(decHtml), 'K2.1-11: Date is read from the header part');
      softOk(!/forged/.test(decHtml), 'K2.1-11: only the header part is parsed — a header-looking line in the body is not read');
      softOk(/data-qa="pilot-letter-saved"/.test(decHtml) && /data-qa="pilot-letter-open-saved"/.test(decHtml),
        'K2.1-11: the saved copy is named and can be opened');
      await tryRun(decCtx, "pilotLetterOpenSaved();"); await flush();
      softOk(decCtx.calls.some((c) => c.command === 'crewing_intake_open_saved' && /Downloads\/Skipi\/Crewing/.test(String(c.args.path))),
        'K2.1-11: the saved copy is opened through the typed command with the path the server write returned');
    }

    // ---- 18. a 404 from either byte route reaches the operator --------------
    {
      const gone404 = makeCrewContext({ bytes404: true });
      gone404.__crew.renderCrewFlowView(); await flush();
      gone404.__crew.pilotOpenCard('intake-1'); await flush();
      await tryRun(gone404, "pilotLetterDownload();"); await flush(10);
      softOk(gone404.toasts.some(([m]) => String(m) === cardText(gone404, 'bytes_unavailable')),
        'K2.1-18: a 404 on the original is told to the operator');
      softOk(!/data-qa="pilot-letter-saved"/.test(gone404.nodes.get('main').innerHTML),
        'K2.1-18: a refused original leaves no saved-copy claim on the card');
      await tryRun(gone404, "pilotAttachmentDownload(1);"); await flush(10);
      softOk(gone404.toasts.some(([m]) => String(m) === cardText(gone404, 'attach_unavailable')),
        'K2.1-18: a 404 on an attachment is told to the operator too');
    }

    // ---- 15. the ONE surviving mailbox row (R1) -----------------------------
    {
      const desktopRow = fxSlice("  if (section === 'modules') {", "  } else if (section === 'identity') {");
      const mobileRow = fxSlice('function mobileSettingsFiveModulesHtml() {', '\nfunction mobileSettingsFiveIdentityHtml');
      for (const [name, slice] of [['desktop settings5', desktopRow], ['mobile settings', mobileRow]]) {
        softOk(slice !== '', 'K2.1-15: the "' + name + '" modules slice is bounded');
        softOk(/legacyMailboxRowHtml\('(desktop|mobile)'\)/.test(slice),
          'K2.1-15: "' + name + '" renders the one legacy-mailbox row (one source; check 20 owns its markup and its reachability)');
        softOk(!/mail-imap-host|mail-smtp-host|mail-password/.test(slice),
          'K2.1-15: "' + name + '" carries no mailbox connect form any more');
      }
      softOk(/'settings\.mailbox_legacy':'[^']*Личный ящик \(устаревший\)/.test(html) && /'settings\.mailbox_legacy':'[^'Ѐ-ӿ]+'/.test(html),
        'K2.1-15: the row label exists in both dictionaries (RU "Личный ящик (устаревший)")');
      const mbSlice = fxSlice('function legacyMailboxState() {', '// CREWING LEGACY MAILBOX ROW (K2.1) END');
      softOk(mbSlice !== '', 'K2.1-15: the legacy-mailbox slice is bounded');
      const runRow = async (box, confirmAnswer) => {
        const calls = [];
        const toasts = [];
        const nodes = new Map();
        const ctx = vm.createContext({
          console, Promise, String, Object, Array, JSON, Number, setTimeout,
          state: {},
          getUiLang: () => 'ru',
          tr: (k) => k,
          showToast: (m, kind) => toasts.push([String(m), kind]),
          inAppConfirm: async () => { toasts.push(['confirm', 'ask']); return confirmAnswer; },
          document: { getElementById: (id) => nodes.get(id) || null },
          async invoke(cmd) { calls.push(cmd); if (cmd === 'get_mailbox_status') return box; return null; },
        });
        vm.runInContext(mbSlice + '\nthis.__mb = { legacyMailboxEnsureStatus, legacyMailboxDisconnect, legacyMailboxConfigured, legacyMailboxStatusText, openMailboxSettings };', ctx);
        return { ctx, calls, toasts };
      };
      try {
        const live = await runRow({ configured: true, status: 'active', email_masked: 'o***@crewing.example' }, true);
        live.ctx.__mb.legacyMailboxEnsureStatus();
        live.ctx.__mb.legacyMailboxEnsureStatus();
        await flush(8);
        softOk(live.calls.filter((c) => c === 'get_mailbox_status').length === 1,
          'K2.1-15: the row asks the status ONCE, through get_mailbox_status — got ' + live.calls.length);
        softOk(live.ctx.__mb.legacyMailboxConfigured() === true && /o\*\*\*@crewing\.example/.test(live.ctx.__mb.legacyMailboxStatusText()),
          'K2.1-15: a connected mailbox is shown as connected, with the masked address');
        await live.ctx.__mb.openMailboxSettings();
        await flush(8);
        softOk(live.toasts.some(([m]) => m === 'confirm') && live.calls.includes('disconnect_mailbox'),
          'K2.1-15: disconnecting asks for a confirmation and then calls disconnect_mailbox');
        softOk(live.ctx.__mb.legacyMailboxConfigured() === false,
          'K2.1-15: after a disconnect the row no longer claims a connected mailbox');

        const refused = await runRow({ configured: true, status: 'active' }, false);
        refused.ctx.__mb.legacyMailboxEnsureStatus(); await flush(8);
        await refused.ctx.__mb.legacyMailboxDisconnect(); await flush(8);
        softOk(!refused.calls.includes('disconnect_mailbox'), 'K2.1-15: a refused confirmation disconnects nothing');

        const empty = await runRow({ configured: false, status: 'not_configured' }, true);
        empty.ctx.__mb.legacyMailboxEnsureStatus(); await flush(8);
        await empty.ctx.__mb.legacyMailboxDisconnect(); await flush(8);
        softOk(!empty.calls.includes('disconnect_mailbox') && empty.ctx.__mb.legacyMailboxConfigured() === false,
          'K2.1-15: with nothing connected there is nothing to disconnect');
      } catch (e) {
        softOk(false, 'K2.1-15: the legacy-mailbox row runs in isolation — ' + (e && (e.message || e)));
      }
    }

    // ---- 19. copying is not opening (Советник N68) -------------------------
    // On a phone the clipboard is the ONLY path out of the draft. Printing
    // "draft opened in the mail client" there is a sentence the product cannot
    // back: no client was opened. The two events get two states.
    {
      softOk((html.match(/'crew_flow\.state_draft_copied':'[^']*'/g) || []).length === 2,
        'K2.1-19: crew_flow.state_draft_copied exists in both dictionaries');
      softOk(/'crew_flow\.state_draft_copied':'[^'Ѐ-ӿ]+'/.test(html) && /'crew_flow\.state_draft_copied':'[^']*[Ѐ-ӿ]/.test(html),
        'K2.1-19: the copied caption is localized, not one language twice');
      for (const lang of ['ru', 'en']) {
        const copyCtx = makeCrewContext({ language: lang });
        copyCtx.state.view = 'mobile-crew_flow';
        tryRun(copyCtx, "state.view = 'mobile-crew_flow'; mobileRenderCrewFlow();"); await flush();
        copyCtx.__crew.pilotOpenCard('intake-1'); await flush();
        await tryRun(copyCtx, "crewFlowWriteEmail('intake-1','reply');"); await flush();
        await tryRun(copyCtx, "pilotDraftCopy();"); await flush(10);
        const readState = JSON.parse(copyCtx.store.get('skipi_crewing_crew_flow_read_state_v2') || '{}');
        softOk(readState['intake-1'] && readState['intake-1'].action === 'draft_copied',
          'K2.1-19: the clipboard path records draft_copied (' + lang + ') — got ' + JSON.stringify((readState['intake-1'] || {}).action));
        const openedText = copyCtx.__K2_STRINGS[lang]['crew_flow.state_draft_opened'];
        const copiedText = copyCtx.__K2_STRINGS[lang]['crew_flow.state_draft_copied'];
        const screen = copyCtx.nodes.get('mobile-main').innerHTML + '\n' + copyCtx.nodes.get('main').innerHTML;
        softOk(!!copiedText && screen.includes(copiedText),
          'K2.1-19: after copying the candidate reads as copied (' + lang + ')');
        softOk(!!openedText && !screen.includes(openedText),
          'K2.1-19: after copying NOTHING on the screen claims a mail client was opened (' + lang + ')');
        softOk(copyCtx.toasts.some(([m]) => String(m) === cardText(copyCtx, 'draft_copied')),
          'K2.1-19: the copy toast still tells the operator to paste it (' + lang + ')');
        softOk(!copyCtx.calls.some((c) => c.command === 'open_mailto'),
          'K2.1-19: the clipboard path opens no mail client (' + lang + ')');
        // and the other direction: the client path still says "opened"
        const clientCtx = makeCrewContext({ language: lang });
        clientCtx.__crew.renderCrewFlowView(); await flush();
        clientCtx.__crew.pilotOpenCard('intake-1'); await flush();
        await tryRun(clientCtx, "crewFlowWriteEmail('intake-1','reply');"); await flush();
        await tryRun(clientCtx, "pilotDraftOpenClient();"); await flush(10);
        const clientState = JSON.parse(clientCtx.store.get('skipi_crewing_crew_flow_read_state_v2') || '{}');
        softOk(clientState['intake-1'] && clientState['intake-1'].action === 'draft_opened',
          'K2.1-19: the mail-client path still records draft_opened (' + lang + ')');
        softOk(clientCtx.nodes.get('main').innerHTML.includes(openedText),
          'K2.1-19: and the card says the client was opened (' + lang + ')');
      }
    }

    // ---- 20. the row must be on the screen the product ACTUALLY shows ------
    // Supervisor REJECT on e05a3c4c: the row existed only in the settings5
    // preview shell, and the product never sets that flag. Reachability, not
    // presence: with the module gone, an unreachable row means a connected
    // mailbox can never be revoked from the product again.
    {
      const legacyDesktopOrg = fxSlice("  if (settingsTab==='org') {", "  } else if (settingsTab==='data') {");
      const legacyMobileOrg = fxSlice('function mobileSettingsOrgHtml() {', '\nfunction mobileSettingsDataHtml');
      for (const [name, slice] of [['legacy desktop org', legacyDesktopOrg], ['legacy mobile org', legacyMobileOrg]]) {
        softOk(slice !== '', 'K2.1-20: the "' + name + '" slice is bounded');
        softOk(/legacyMailboxRowHtml\(/.test(slice),
          'K2.1-20: the unflagged settings screen renders the legacy-mailbox row (' + name + ')');
      }
      softOk(!/setItem\(\s*SETTINGS5_FLAG_KEY|setItem\('skipi_crewing_settings5'/.test(html),
        'K2.1-20: the product still never sets the settings5 flag — which is exactly why a row only in that shell is unreachable');
      const rowFn = fxSlice('function legacyMailboxRowInnerHtml(', '\nasync function legacyMailboxDisconnect');
      softOk(rowFn !== '' && (rowFn.match(/data-qa="settings\.mailbox\.legacy"/g) || []).length === 1
        && (rowFn.match(/data-qa="settings\.mailbox\.legacy-disconnect"/g) || []).length === 2
        && /data-settings-action="crewing-mailbox-disconnect"/.test(rowFn)
        && /onclick="openMailboxSettings\(\)"/.test(rowFn),
        'K2.1-20: the row carries its QA hook and a disconnect control in all three shapes (two fallback, one module)');
      const disconnectFn = fxSlice('async function legacyMailboxDisconnect', '\n// The historic name');
      softOk(/function openMailboxSettings\(\) \{ return legacyMailboxDisconnect\(\); \}/.test(html)
        && /invoke\('disconnect_mailbox'\)/.test(disconnectFn) && /inAppConfirm/.test(disconnectFn),
        'K2.1-20: and the byte chain runs row -> openMailboxSettings -> legacyMailboxDisconnect -> confirm -> disconnect_mailbox');
      softOk((html.match(/data-qa="settings\.mailbox\.legacy"/g) || []).length >= 1
        && (html.match(/legacyMailboxRowHtml\('(desktop|mobile)'\)/g) || []).length === 4,
        'K2.1-20: the same row is rendered by all four settings surfaces (two unflagged, two preview) from ONE source');
    }

    // ---- 21/22. the address the web path puts into a mailto: URL -----------
    // Supervisor: the strict form lived only in Rust, and the web shell never
    // goes there — `oleh@example.test?bcc=silent@attacker.test` became a hidden
    // Bcc built out of a stranger's CV. And a leading "-" makes xdg-email fail,
    // so "draft opened" would be written for a draft nobody ever saw.
    {
      const HOSTILE = [
        ['bcc', 'oleh@example.test?bcc=silent@attacker.test'],
        ['cc', 'oleh@example.test?cc=silent@attacker.test'],
        ['attach', 'oleh@example.test?attach=/etc/passwd'],
        ['crlf', 'oleh@example.test%0d%0aBcc:silent@attacker.test'],
        ['comma', '"a,b"@c.test'],
        ['quote', "a'b@c.test"],
        ['leading dash', '-x@y.test'],
      ];
      for (const [label, addr] of HOSTILE) {
        const webCtx = makeCrewContext({ webShell: true, native: false, realEscaping: true, contactEmail: addr });
        webCtx.__crew.renderCrewFlowView(); await flush();
        webCtx.__crew.pilotOpenCard('intake-1'); await flush();
        await tryRun(webCtx, "crewFlowWriteEmail('intake-1','reply');"); await flush();
        const draft = webCtx.nodes.get('main').innerHTML;
        softOk(!/data-qa="pilot-draft-mailto"/.test(draft) && /data-qa="pilot-draft-to-invalid"/.test(draft),
          'K2.1-21: the web shell builds no mailto: link from a ' + label + ' address, and says so');
        softOk(!/href="mailto:/.test(draft),
          'K2.1-21: no mailto href exists at all for a ' + label + ' address');
        // the native path refuses the same address, without inventing a state
        const nativeCtx = makeCrewContext({ realEscaping: true, contactEmail: addr });
        nativeCtx.__crew.renderCrewFlowView(); await flush();
        nativeCtx.__crew.pilotOpenCard('intake-1'); await flush();
        await tryRun(nativeCtx, "crewFlowWriteEmail('intake-1','reply');"); await flush();
        await tryRun(nativeCtx, "pilotDraftOpenClient();"); await flush(10);
        const state21 = JSON.parse(nativeCtx.store.get('skipi_crewing_crew_flow_read_state_v2') || '{}');
        softOk(!nativeCtx.calls.some((c) => c.command === 'open_mailto'),
          'K2.1-22: a ' + label + ' address never reaches open_mailto');
        softOk(!(state21['intake-1'] && /draft_/.test(String(state21['intake-1'].action)))
          && !/data-qa="pilot-draft-state"/.test(nativeCtx.nodes.get('main').innerHTML),
          'K2.1-22: and nothing is marked as a draft for a ' + label + ' address');
      }
      // the honest address still works, and the href is built with encodeURIComponent
      const goodWeb = makeCrewContext({ webShell: true, native: false, realEscaping: true });
      goodWeb.__crew.renderCrewFlowView(); await flush();
      goodWeb.__crew.pilotOpenCard('intake-1'); await flush();
      await tryRun(goodWeb, "crewFlowWriteEmail('intake-1','reply');"); await flush();
      const goodDraft = goodWeb.nodes.get('main').innerHTML;
      const rawHref = (goodDraft.match(/data-qa="pilot-draft-mailto" href="([^"]*)"/) || [])[1] || '';
      // The attribute is escaped by escapeAttr, so `&` arrives as `&#38;`. What the
      // browser will follow is the DECODED url; both halves are measured.
      const href = rawHref.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
      softOk(href.startsWith('mailto:oleh@example.test?subject=') && href.includes('&body='),
        'K2.1-21: a valid address still gets its mailto link — got ' + href.slice(0, 64));
      // The BODY legitimately carries %0A (a multi-line message); what must never
      // carry one is the ADDRESS part, where it would be a header injection.
      const addressPart = href.slice('mailto:'.length).split('?')[0];
      softOk(addressPart === 'oleh@example.test' && !/%0d|%0a|%2c|%3f|%26/i.test(addressPart),
        'K2.1-21: the address part of the link is exactly the checked address — got ' + addressPart);
      softOk(!/[ <>"']/.test(rawHref) && !/[ <>"']/.test(href) && href.indexOf(String.fromCharCode(10)) === -1 && href.indexOf(String.fromCharCode(13)) === -1,
        'K2.1-21: the link carries no raw space, quote, angle bracket, CR or LF, escaped or not');
      softOk(!/data-qa="pilot-draft-to-invalid"/.test(goodDraft),
        'K2.1-21: and the valid address is not refused');
    }
    softOk(/fn checked_recipient/.test(contactRs) && /starts_with\('-'\)/.test(contactRs),
      'K2.1-22: the Rust recipient check refuses a leading dash (xdg-email would read it as a flag)');
    softOk(/-x@y\.test/.test(contactRs),
      'K2.1-22: and carries the unit test for it');
    softOk(/function cardCheckedRecipient\(/.test(html),
      'K2.1-21: the screen has ONE recipient check of its own, next to the Rust one');

    // ---- 23/25/26. the entry the product actually uses, and two states -----
    // Supervisor REJECT on ffe0573c: the row had moved from one unreachable
    // surface to four. `dist/index.html:844` loads the vendored settings module,
    // and when it is there `openSettings` mounts IT — the four renderers I had
    // patched are the fallback for a module that failed to load. The row has to
    // be in `_crewingSettingsSections()`, which is what reaches the module.
    {
      const sections = fxSlice('function _crewingSettingsSections(){', '\n// Role helper');
      softOk(sections !== '', 'K2.1-23: the app-specific settings sections slice is bounded');
      softOk(/legacyMailboxRowHtml\('module'\)/.test(sections),
        'K2.1-23: the sections handed to SkipiSettings.mount render the legacy-mailbox row (same source as every other surface)');
      softOk(/'crewing-mailbox-disconnect': function/.test(sections),
        'K2.1-23: with a handler behind the module-contract action (the rendered control is measured at runtime in the mailbox harness)');
      softOk(/legacyMailboxDisconnect\(\)/.test(sections) && /legacyMailboxEnsureStatus\(\)/.test(sections),
        'K2.1-23: the handler goes to the same revoke path, and the row reads the status');
      // 25: without a checked recipient there must be NO link at all — the old
      // guard let `mailto:null?subject=…` through whenever the contact was missing.
      const noneWeb = makeCrewContext({ webShell: true, native: false, realEscaping: true, contactMode: 'none' });
      noneWeb.__crew.renderCrewFlowView(); await flush();
      noneWeb.__crew.pilotOpenCard('intake-1'); await flush();
      await tryRun(noneWeb, "crewFlowWriteEmail('intake-1','reply');"); await flush();
      const noneDraft = noneWeb.nodes.get('main').innerHTML;
      softOk(!/mailto:null/.test(noneDraft) && !/data-qa="pilot-draft-mailto"/.test(noneDraft),
        'K2.1-25: with no contact the web shell builds no mailto link at all (not even mailto:null)');
      softOk(/data-qa="pilot-draft-need-contact"/.test(noneDraft),
        'K2.1-25: it asks for the address instead');
      // 26: the revoke attempt must survive an unknown status. A mailbox whose
      // status failed to load is not a mailbox that is known to be disconnected.
      const mbSlice26 = fxSlice('function legacyMailboxState() {', '// CREWING LEGACY MAILBOX ROW (K2.1) END');
      const runRow26 = async (box, confirmAnswer) => {
        const calls = [];
        const toasts = [];
        const nodes = new Map();
        const ctx = vm.createContext({
          console, Promise, String, Object, Array, JSON, Number, setTimeout,
          state: {}, getUiLang: () => 'en', tr: (k) => k,
          escapeHtml: (v) => String(v == null ? '' : v).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])),
          escapeAttr: (v) => String(v == null ? '' : v).replace(/[&'"<>]/g, (c) => '&#' + c.charCodeAt(0) + ';'),
          showToast: (m, kind) => toasts.push([String(m), kind]),
          inAppConfirm: async () => { toasts.push(['confirm', 'ask']); return confirmAnswer; },
          document: { getElementById: (id) => nodes.get(id) || null },
          async invoke(cmd) { calls.push(cmd); if (cmd === 'get_mailbox_status') { if (box === 'throw') throw new Error('unreachable'); return box; } return null; },
        });
        vm.runInContext(mbSlice26 + '\nthis.__mb = { legacyMailboxEnsureStatus, legacyMailboxDisconnect, legacyMailboxRevokeBlocked, legacyMailboxRowHtml };', ctx);
        ctx.__mb.legacyMailboxEnsureStatus();
        await flush(8);
        return { ctx, calls, toasts };
      };
      try {
        for (const [label, box] of [['an error status', { configured: false, status: 'error' }], ['an unreachable status', 'throw'], ['an unknown code', { configured: false, status: 'future_code' }]]) {
          const probe = await runRow26(box, true);
          softOk(probe.ctx.__mb.legacyMailboxRevokeBlocked() === false,
            'K2.1-26: the revoke attempt stays available with ' + label);
          softOk(/legacy-mailbox-disconnect/.test(probe.ctx.__mb.legacyMailboxRowHtml('desktop'))
            && /legacy-mailbox-disconnect/.test(probe.ctx.__mb.legacyMailboxRowHtml('mobile'))
            && /crewing-mailbox-disconnect/.test(probe.ctx.__mb.legacyMailboxRowHtml('module')),
            'K2.1-26: and the control is rendered, in all three shapes, with ' + label);
          await probe.ctx.__mb.legacyMailboxDisconnect();
          await flush(8);
          softOk(probe.calls.includes('disconnect_mailbox'),
            'K2.1-26: and pressing it actually asks the server with ' + label);
        }
        const plain = await runRow26({ configured: false, status: 'not_configured' }, true);
        softOk(plain.ctx.__mb.legacyMailboxRevokeBlocked() === true
          && !/legacy-mailbox-disconnect/.test(plain.ctx.__mb.legacyMailboxRowHtml('desktop'))
          && !/crewing-mailbox-disconnect/.test(plain.ctx.__mb.legacyMailboxRowHtml('module')),
          'K2.1-26: a server that says plainly "not connected" leaves NO control at all — not even a disabled one');
        await plain.ctx.__mb.legacyMailboxDisconnect();
        await flush(8);
        softOk(!plain.calls.includes('disconnect_mailbox'),
          'K2.1-26: and then nothing is asked of the server');
        const live = await runRow26({ configured: true, status: 'active' }, true);
        softOk(live.ctx.__mb.legacyMailboxRevokeBlocked() === false && /legacy-mailbox-disconnect/.test(live.ctx.__mb.legacyMailboxRowHtml('desktop')),
          'K2.1-26: a connected mailbox is of course revocable, and its control is there');
      } catch (e) {
        softOk(false, 'K2.1-26: the legacy-mailbox row runs in isolation — ' + (e && (e.message || e)));
      }
    }

    // ---- 27/28. the paint must move the CONTROL, not just the text --------
    // Supervisor L1/L3 on dde59326: the row markup was decided once, at
    // !loaded, and the paint could only rewrite the status text — so at
    // not_configured the «Отключить» button was on screen for the first open of
    // every session and answered with a toast. And nothing in tests/ mentioned
    // legacyMailboxPaint at all, so his SV-M10 (paint one id again) stayed green.
    {
      const mbSlice27 = fxSlice('function legacyMailboxState() {', '// CREWING LEGACY MAILBOX ROW (K2.1) END');
      const paintProbe = async (box) => {
        const nodes = new Map();
        for (const id of ['legacy-mailbox-row-desktop', 'legacy-mailbox-row-mobile', 'legacy-mailbox-row-module']) {
          nodes.set(id, { id, innerHTML: '', textContent: '', setAttribute() {}, removeAttribute() {}, getAttribute: () => null });
        }
        const calls = [];
        const ctx = vm.createContext({
          console, Promise, String, Object, Array, JSON, Number, setTimeout,
          state: {}, getUiLang: () => 'en', tr: (k) => k,
          escapeHtml: (v) => String(v == null ? '' : v).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])),
          escapeAttr: (v) => String(v == null ? '' : v).replace(/[&'"<>]/g, (c) => '&#' + c.charCodeAt(0) + ';'),
          showToast: () => {}, inAppConfirm: async () => true,
          document: { getElementById: (id) => nodes.get(id) || null },
          async invoke(cmd) { calls.push(cmd); if (cmd === 'get_mailbox_status') return box; return null; },
        });
        vm.runInContext(mbSlice27 + '\nthis.__mb = { legacyMailboxEnsureStatus, legacyMailboxPaint, legacyMailboxRowHtml, legacyMailboxInvalidate, legacyMailboxState };', ctx);
        ctx.__mb.legacyMailboxEnsureStatus();
        await flush(8);
        return { ctx, nodes, calls };
      };
      const CONTROL = 'crewing-mailbox-disconnect';
      try {
        const live = await paintProbe({ configured: true, status: 'active', email_masked: 'o***@example.com' });
        const ids = ['legacy-mailbox-row-desktop', 'legacy-mailbox-row-mobile', 'legacy-mailbox-row-module'];
        softOk(ids.every((id) => live.nodes.get(id).innerHTML !== ''),
          'K2.1-27: the paint repaints every row site, not one of them');
        softOk(ids.every((id) => live.nodes.get(id).innerHTML.includes('o***@example.com')),
          'K2.1-27: each site shows the status that came back');
        softOk(ids.every((id) => live.nodes.get(id).innerHTML.includes(CONTROL) || /legacy-mailbox-disconnect/.test(live.nodes.get(id).innerHTML)),
          'K2.1-27: and each site carries the control while a mailbox is connected');
        const gone = await paintProbe({ configured: false, status: 'not_configured' });
        softOk(ids.every((id) => gone.nodes.get(id).innerHTML !== ''),
          'K2.1-28: the row itself stays when the server says nothing is connected');
        softOk(ids.every((id) => !gone.nodes.get(id).innerHTML.includes(CONTROL) && !/legacy-mailbox-disconnect/.test(gone.nodes.get(id).innerHTML)),
          'K2.1-28: and the control is GONE from every site — the paint moves the control, not only the text');
        // first open of a session: the markup is decided before the answer, so
        // what matters is the state the operator is left looking at.
        softOk(!/disabled/.test(gone.ctx.__mb.legacyMailboxRowHtml('desktop')) === false
          || !gone.nodes.get('legacy-mailbox-row-desktop').innerHTML.includes(CONTROL),
          'K2.1-28: after the first open settles there is no dead button at not_configured');
      } catch (e) {
        softOk(false, 'K2.1-27: the paint runs in isolation — ' + (e && (e.message || e)));
      }
    }
    // ---- 29. the status is re-read on every open --------------------------
    // A mailbox connected in the web cabinet after the app started must become
    // revocable without restarting the app: one live call per settings open.
    softOk(/function legacyMailboxInvalidate\(/.test(html),
      'K2.1-29: there is an explicit status invalidation');
    {
      // …and it does something: an invalidation that only exists as a call site
      // is the same session-long cache with a nicer name (this is what m25 does).
      const nodes = new Map();
      const calls = [];
      const mbSlice29 = fxSlice('function legacyMailboxState() {', '// CREWING LEGACY MAILBOX ROW (K2.1) END');
      const ctx29 = vm.createContext({
        console, Promise, String, Object, Array, JSON, Number, setTimeout,
        state: {}, getUiLang: () => 'en', tr: (k) => k,
        escapeHtml: (v) => String(v == null ? '' : v), escapeAttr: (v) => String(v == null ? '' : v),
        showToast: () => {}, inAppConfirm: async () => true,
        document: { getElementById: (id) => nodes.get(id) || null },
        async invoke(cmd) { calls.push(cmd); if (cmd === 'get_mailbox_status') return { configured: true, status: 'active' }; return null; },
      });
      try {
        vm.runInContext(mbSlice29 + '\nthis.__mb = { legacyMailboxEnsureStatus, legacyMailboxInvalidate, legacyMailboxState };', ctx29);
        ctx29.__mb.legacyMailboxEnsureStatus(); await flush(8);
        ctx29.__mb.legacyMailboxEnsureStatus(); await flush(8);
        softOk(calls.filter((c) => c === 'get_mailbox_status').length === 1, 'K2.1-29: without an invalidation the answer is reused');
        ctx29.__mb.legacyMailboxInvalidate();
        softOk(ctx29.__mb.legacyMailboxState().loaded === false, 'K2.1-29: the invalidation actually clears the cached answer');
        ctx29.__mb.legacyMailboxEnsureStatus(); await flush(8);
        softOk(calls.filter((c) => c === 'get_mailbox_status').length === 2, 'K2.1-29: and the next look asks the server again');
      } catch (e) {
        softOk(false, 'K2.1-29: the invalidation runs in isolation — ' + (e && (e.message || e)));
      }
    }
    {
      const openFn = fxSlice('async function openSettings(tab) {', '\nfunction closeSettings');
      softOk(openFn !== '' && /legacyMailboxInvalidate\(\)/.test(openFn),
        'K2.1-29: opening the settings invalidates the cached mailbox status (both the module and the fallback path go through here)');
      const mobileOpen = fxSlice('function mobileOpenSettings(id){', '\nfunction mobileBackToSettingsList');
      softOk(mobileOpen !== '' && /legacyMailboxInvalidate\(\)/.test(mobileOpen),
        'K2.1-29: and so does opening them on the phone');
      const disconnectFn29 = fxSlice('async function legacyMailboxDisconnect', '\n// The historic name');
      softOk(/catch \(e\) \{[\s\S]{0,200}legacyMailboxInvalidate\(\)/.test(disconnectFn29),
        'K2.1-29: a refused disconnect drops the cached status too — the next look asks the server');
    }

    // ---- 30/31. the window while the answer is in flight ------------------
    // Supervisor R2 on d0da5542: for the ~900 ms the status request is in the
    // air the row said «статус не проверен» AND offered the control, so a press
    // sent disconnect_mailbox at a mailbox that was not connected and the toast
    // still said «Ящик отключён.» — a false sentence on screen. The ban lasts
    // exactly as long as the flight; a cached "not connected" is a different
    // state and keeps its own rule (check 26).
    {
      const mbSlice30 = fxSlice('function legacyMailboxState() {', '// CREWING LEGACY MAILBOX ROW (K2.1) END');
      const inFlightProbe = async (box, opts) => {
        opts = opts || {};
        const calls = [];
        const toasts = [];
        let release = null;
        const nodes = new Map();
        for (const id of ['legacy-mailbox-row-desktop', 'legacy-mailbox-row-mobile', 'legacy-mailbox-row-module']) {
          nodes.set(id, { id, innerHTML: '', textContent: '' });
        }
        const ctx = vm.createContext({
          console, Promise, String, Object, Array, JSON, Number, setTimeout,
          state: {}, getUiLang: () => (opts.lang || 'en'), tr: (k) => k,
          escapeHtml: (v) => String(v == null ? '' : v), escapeAttr: (v) => String(v == null ? '' : v),
          showToast: (m, kind) => toasts.push([String(m), kind]),
          inAppConfirm: async () => true,
          document: { getElementById: (id) => nodes.get(id) || null },
          async invoke(cmd) {
            calls.push(cmd);
            if (cmd === 'get_mailbox_status') {
              if (opts.hold) { await new Promise((r) => { release = r; }); }
              return box;
            }
            if (cmd === 'disconnect_mailbox' && opts.disconnectThrows) throw new Error('refused');
            return null;
          },
        });
        vm.runInContext(mbSlice30 + '\nthis.__mb = { legacyMailboxEnsureStatus, legacyMailboxDisconnect, legacyMailboxRevokeBlocked, legacyMailboxRowHtml, legacyMailboxStatusText, legacyMailboxInvalidate, legacyMailboxState };', ctx);
        return { ctx, calls, toasts, nodes, release: () => release && release() };
      };
      try {
        // 30: the answer is held in the air; the row must offer nothing yet.
        const flight = await inFlightProbe({ configured: false, status: 'not_configured' }, { hold: true });
        const rowDuringFlight = flight.ctx.__mb.legacyMailboxRowHtml('desktop');
        await flush(4);
        softOk(flight.ctx.__mb.legacyMailboxRevokeBlocked() === true,
          'K2.1-30: while the status request is in the air the revoke is not offered');
        // Not pressable in either shape — said differently only because the
        // presence contract pins the token in the rendered fallback section.
        softOk(/data-qa="settings\.mailbox\.legacy-disconnect"[^>]* disabled/.test(rowDuringFlight),
          'K2.1-30: the fallback control in that window is rendered DISABLED, not live');
        softOk(!/crewing-mailbox-disconnect/.test(flight.ctx.__mb.legacyMailboxRowHtml('module')),
          'K2.1-30: and the module shape, which has no disabled button, renders no control at all');
        const pressed = flight.calls.filter((c) => c === 'disconnect_mailbox').length;
        await flight.ctx.__mb.legacyMailboxDisconnect();
        await flush(6);
        softOk(flight.calls.filter((c) => c === 'disconnect_mailbox').length === pressed,
          'K2.1-30: and a press in that window sends nothing to the server');
        softOk(!flight.toasts.some(([m]) => m === 'settings.mailbox_legacy_done' || m === 'settings.mailbox_legacy_none'),
          'K2.1-30: nor does it claim anything about a mailbox nobody has heard about yet');
        // `/check/i` would also match "status not checked" — the never-asked
        // text — so the two are compared against each other, not against a word.
        const neverProbe = await inFlightProbe({ configured: false, status: 'not_configured' });
        const neverText = neverProbe.ctx.__mb.legacyMailboxStatusText();
        const flightText = flight.ctx.__mb.legacyMailboxStatusText();
        softOk(flightText !== neverText && /checking/i.test(flightText),
          'K2.1-30: the row says the status is BEING checked, which is not the never-checked text — got "' + flightText + '" vs "' + neverText + '"');
        flight.release();
        await flush(8);
        softOk(flight.ctx.__mb.legacyMailboxRevokeBlocked() === true && !/legacy-mailbox-disconnect/.test(flight.nodes.get('legacy-mailbox-row-desktop').innerHTML),
          'K2.1-30: once the answer says "not connected" the control stays away');
        const flight2 = await inFlightProbe({ configured: true, status: 'active' }, { hold: true });
        flight2.ctx.__mb.legacyMailboxRowHtml('desktop');
        await flush(4);
        softOk(flight2.ctx.__mb.legacyMailboxRevokeBlocked() === true, 'K2.1-30: the same window applies when the mailbox turns out to be connected');
        flight2.release();
        await flush(8);
        softOk(/legacy-mailbox-disconnect/.test(flight2.nodes.get('legacy-mailbox-row-desktop').innerHTML),
          'K2.1-30: and after the answer the control appears');
        // 31: the sentence after the command must match what the server said.
        const wasConnected = await inFlightProbe({ configured: true, status: 'active' });
        wasConnected.ctx.__mb.legacyMailboxEnsureStatus(); await flush(8);
        await wasConnected.ctx.__mb.legacyMailboxDisconnect(); await flush(8);
        softOk(wasConnected.calls.includes('disconnect_mailbox')
          && wasConnected.toasts.some(([m]) => m === 'settings.mailbox_legacy_done'),
          'K2.1-31: disconnecting a CONNECTED mailbox says it was disconnected');
        const wasNot = await inFlightProbe({ configured: false, status: 'error' });
        wasNot.ctx.__mb.legacyMailboxEnsureStatus(); await flush(8);
        await wasNot.ctx.__mb.legacyMailboxDisconnect(); await flush(8);
        softOk(wasNot.calls.includes('disconnect_mailbox'),
          'K2.1-31: an unknown status still lets the operator try (check 26 holds)');
        softOk(!wasNot.toasts.some(([m]) => m === 'settings.mailbox_legacy_done'),
          'K2.1-31: but a mailbox that was not connected is NEVER reported as disconnected');
        softOk(wasNot.toasts.some(([m]) => m === 'settings.mailbox_legacy_none'),
          'K2.1-31: the operator is told what actually happened instead');
        // the invalidation effect, measured at the refusal branch (site 3 of 3)
        const refused = await inFlightProbe({ configured: true, status: 'active' }, { disconnectThrows: true });
        refused.ctx.__mb.legacyMailboxEnsureStatus(); await flush(8);
        const statusBefore = refused.calls.filter((c) => c === 'get_mailbox_status').length;
        await refused.ctx.__mb.legacyMailboxDisconnect(); await flush(10);
        softOk(refused.calls.filter((c) => c === 'get_mailbox_status').length === statusBefore + 1,
          'K2.1-29/site3: a refused disconnect re-asks the server for the status — the EFFECT, not the token');
        softOk(refused.toasts.some(([m]) => /mailbox_legacy_failed/.test(String(m))),
          'K2.1-31: and the refusal is reported as a refusal');
      } catch (e) {
        softOk(false, 'K2.1-30: the in-flight window runs in isolation — ' + (e && (e.message || e)));
      }
    }

    // ---- 12/14/17. the native side the screen depends on -------------------
    softOk(/#\[serde\(default\)\]\s*\n\s*pub attachments: Vec<CandidateIntakeAttachment>/.test(rust),
      'K2.1-12: the receipt struct carries the attachments list (without it the typed command drops it silently)');
    softOk(/pub\(crate\) struct CandidateIntakeAttachment \{[\s\S]*?pub ordinal[\s\S]*?pub filename[\s\S]*?pub declared_type[\s\S]*?pub measured_type[\s\S]*?pub byte_size[\s\S]*?pub verdict[\s\S]*?pub reason[\s\S]*?pub eligible/.test(rust),
      'K2.1-12: the attachment row carries exactly the S3 fields');
    for (const command of ['crewing_intake_object_download', 'crewing_intake_attachment_download', 'crewing_intake_open_saved']) {
      softOk(rust.includes(`pub(crate) async fn ${command}(`), 'K2.1-12: ' + command + ' is a fixed native command');
      softOk(lib.includes(`crewing_intake::${command},`), 'K2.1-12: ' + command + ' is registered in Tauri');
    }
    softOk(contactRs !== '' && /pub\(crate\) fn checked_recipient\(/.test(contactRs) && /pub fn open_mailto\(/.test(contactRs),
      'K2.1-14: contact.rs exists and exposes the checked recipient and open_mailto');
    softOk(lib.includes('mod contact;') && lib.includes('contact::open_mailto,'),
      'K2.1-14: open_mailto is registered in Tauri and the module is declared');
    softOk(/fn compose_escape\(/.test(contactRs) && /replace\('%', "%25"\)/.test(contactRs),
      'K2.1-14: the Thunderbird compose value escapes the percent FIRST');
    softOk(/#\[cfg\(test\)\]/.test(contactRs) && /a@b\.test%2Cattachment/.test(contactRs) && /Bcc/.test(contactRs),
      'K2.1-17: contact.rs carries the negative unit tests for the recipient form');
    softOk(/fn resolved_saved_path\(/.test(rust) && /#\[cfg\(test\)\]/.test(rust) && /canonicalize/.test(rust),
      'K2.1-12: the saved-copy path guard is a canonicalizing function with unit tests');
    softOk(/fn open_saved_with<F>/.test(rust) && /open_saved_with\(&root, &path, crate::open_with_default_app\)/.test(rust),
      'K2.1-12: the open command goes through the guard with the opener injected, so the guard can be drilled with the side effect stubbed');
    softOk(!/mailto:/.test(rust) || !/attachment/.test((rust.match(/fn crewing_intake_open_saved[\s\S]*?\n}/) || [''])[0]),
      'K2.1-12: the byte commands carry no mailto/attachment coupling');
  }
  // ====================================================================== No.621
  // The contact the seafarer DELIVERED with his response reaches the screen.
  //
  // OWNER (938). Until this card the queue said "no contact has been recorded"
  // beside a letter whose own From WAS that contact — the screen contradicted
  // itself. What is drilled here is not only that the address appears, but the
  // four ways this could be finished honestly and still be wrong:
  //
  //  * a FAILED request rendered as an absence ("no contact recorded" over a
  //    live contact) — the one thing CANON (930) forbids outright (N14);
  //  * the delivered value smuggled into the FACT CACHE, from where it reaches
  //    the queue row and the IRREVERSIBLE seafarer save by the back door (N17);
  //  * an address the agency may not write to (its own, or one at our own inbound
  //    domain) quietly pre-filling the draft (N7 from the client side);
  //  * a second copy of the resolution order, so the card and the queue disagree
  //    about who the addressee is.
  console.log('\n# No.621 delivered response contact');

  const RC_ADDRESSABLE = { value: 'delivered-621@example.test', is_email: true, offer_email: true };
  const RC_REFUSED = { value: 'desk@crewing.example', is_email: true, offer_email: false };
  const RC_NOT_EMAIL = { value: '+995 555 12 34 56', is_email: false, offer_email: false };
  // A right-to-left override inside an address-shaped string. escapeHtml does not
  // touch it, so a screen that prints the value verbatim reorders on the operator.
  const RC_BIDI = { value: 'a\u202Eexe.moc@example.test', is_email: false, offer_email: false };

  // ---- static: one command, one struct, one resolver -------------------------
  softOk(rust.includes('pub(crate) async fn crewing_intake_response_contact('),
    'No.621: the contact is a fixed native command');
  softOk(lib.includes('crewing_intake::crewing_intake_response_contact,'),
    'No.621: the command is registered in Tauri');
  {
    const struct = (rust.match(/pub\(crate\) struct CandidateResponseContact \{[\s\S]*?\n\}/) || [''])[0];
    softOk(struct !== '', 'No.621: the answer has a struct of its own, not a Value');
    softOk((struct.match(/#\[serde\(default\)\]/g) || []).length === 3,
      'N10: all three fields carry #[serde(default)], so a server build without the key does not fail the parse — got '
        + (struct.match(/#\[serde\(default\)\]/g) || []).length);
    softOk(/fn a_response_contact_body_without_the_keys_still_parses\(\)/.test(rust),
      'N10: and that is measured by a unit test rather than only declared');
    softOk(/&\["response-contact"\]/.test(rust),
      'No.621: the command asks for the response-contact tail of THIS intake');
  }
  {
    // ONE resolver. The order lives in exactly one function; every consumer calls
    // it. Two copies is how the card and the queue end up naming two addressees.
    const resolverCount = (c3b2Source.match(/function cardContactResolved\(/g) || []).length;
    softOk(resolverCount === 1, 'No.621: exactly one resolver function exists — got ' + resolverCount);
    const draftOpen = (c3b2Source.match(/function pilotDraftOpen\(intakeId, kind\) \{[\s\S]*?\n\}/) || [''])[0];
    softOk(/cardContactResolved\(/.test(draftOpen),
      'No.621: pilotDraftOpen reads the resolver and not the facts directly');
    const draftSave = (c3b2Source.match(/async function pilotDraftContactSave\(\) \{[\s\S]*?\n\}/) || [''])[0];
    softOk(/cardContactResolved\(/.test(draftSave),
      'No.621: pilotDraftContactSave recomputes through the SAME resolver');
    const contactsHtml = (c3b2Source.match(/function pilotCardContactsHtml\(\) \{[\s\S]*?\n\}/) || [''])[0];
    softOk(/cardResponseContact\(|cardContactResolved\(/.test(contactsHtml),
      'No.621: the Contacts block reads the delivered contact through the same two helpers');
    softOk(!/contact_as_written[\s\S]{0,200}pilot-contact-response/.test(contactsHtml),
      'No.621: the delivered contact is NOT captioned "as written in the document" — it came from the response, not the CV');
  }
  {
    // THE FORBIDDEN PATH, pinned as a literal. The irreversible write to the
    // operator's own seafarer database is a question that went to the owner; until
    // he answers it, this function is byte for byte what it was.
    const save = (k2crew.match(/async function crewFlowSaveToSeafarers\(intakeId\) \{[\s\S]*?\n\}/) || [''])[0];
    softOk(save !== '', 'No.621: the seafarer-save path is found in the shipped bytes');
    softOk(!/response|resolved|delivered|offer_email/i.test(save),
      'No.621/N8: crewFlowSaveToSeafarers mentions nothing of the delivered contact — the irreversible copy is NOT in this card');
    softOk(/email: facts\.email \|\| ''/.test(save),
      'No.621/N8: it still writes only the legacy `email` FACT, exactly as before this card');
    const cache = (k2crew.match(/function crewFlowFactsFor\(intakeId\) \{[\s\S]*?\n\}/) || [''])[0];
    softOk(cache !== '' && !/response|resolved|delivered/i.test(cache),
      'No.621/N17: the fact cache is never fed the delivered contact — the back door into the queue row and the save is closed by ABSENCE, not by a promise');
  }

  // ---- runtime ---------------------------------------------------------------
  const rcOpen = async (opts) => {
    const ctx = makeCrewContext(opts);
    ctx.__crew.renderCrewFlowView();
    await flush();
    ctx.__crew.pilotOpenCard('intake-1');
    await flush(10);
    return ctx;
  };
  const rcMain = (ctx) => ctx.nodes.get('main').innerHTML;
  const rcDetail = (ctx) => ctx.state.intakePilot.detail;

  {
    // R1 — the OUTCOME of the card, and the one check that must be red on the base.
    const ctx = await rcOpen({ contactMode: 'none', responseContact: RC_ADDRESSABLE });
    const out = rcMain(ctx);
    softOk(ctx.calls.some((c) => c.command === 'crewing_intake_response_contact'),
      'No.621 R1: opening a card asks the server for the delivered contact');
    softOk(out.includes('data-qa="pilot-contact-response"'),
      'No.621 R1: the Contacts block carries a row for the delivered contact');
    softOk(out.includes(RC_ADDRESSABLE.value),
      'No.621 R1: and the address is on the screen');
    softOk(!out.includes('data-qa="pilot-contacts-empty"'),
      'No.621 R1: "no contact has been recorded" is gone when a contact was delivered');
    const caption = cardText(ctx, 'contact_from_response');
    softOk(!!caption && out.includes(esc(caption)),
      'No.621 R1: the row says WHERE it came from, in the product\'s own words — ' + JSON.stringify(caption));
    // and the draft it feeds
    vm.runInContext("pilotDraftOpen('intake-1','reply')", ctx);
    await flush();
    const draft = rcDetail(ctx).draft || {};
    softOk(draft.to === RC_ADDRESSABLE.value,
      'No.621 R1: "Write email" opens a draft addressed to the delivered contact — got ' + JSON.stringify(draft.to));
    softOk(draft.needContact === false,
      'No.621 R1: and it does not ask for an address it already has');
    softOk(rcMain(ctx).includes('data-qa="pilot-draft-to"'),
      'No.621 R1: the addressee is rendered on the card (the mail client is NOT launched here)');
  }
  {
    // R2 — N14, the finding of the counselor: a failure is not an absence.
    for (const [label, err] of [
      ['403', { kind: 'server', status: 403, detail: 'not authorised for this crewing', ambiguous: false }],
      ['500', { kind: 'server', status: 500, detail: null, ambiguous: false }],
      ['network', { kind: 'network', status: null, detail: null, ambiguous: false }],
    ]) {
      const ctx = await rcOpen({ contactMode: 'none', responseContact: { __throw: err } });
      const out = rcMain(ctx);
      softOk(out.includes('data-qa="pilot-contact-response-failed"'),
        'No.621 R2/N14 (' + label + '): the screen says the contact could not be loaded');
      softOk(!out.includes('data-qa="pilot-contacts-empty"'),
        'No.621 R2/N14 (' + label + '): and it does NOT say "no contact has been recorded" — CANON (930) п.1');
      const retry = cardText(ctx, 'contact_response_failed');
      softOk(!!retry && out.includes(esc(retry)),
        'No.621 R2/N14 (' + label + '): in the product\'s own words — ' + JSON.stringify(retry));
    }
  }
  {
    // R3 — a real 404 keeps today's honest sentence and today's button.
    const ctx = await rcOpen({ contactMode: 'none', responseContact: undefined });
    const out = rcMain(ctx);
    softOk(out.includes('data-qa="pilot-contacts-empty"'),
      'No.621 R3/N2: a 404 — and only a 404 — keeps "no contact has been recorded"');
    softOk(!out.includes('data-qa="pilot-contact-response-failed"'),
      'No.621 R3/N2: and it is not reported as a failure either');
    softOk(out.includes('data-qa="pilot-contact-add"'),
      'No.621 R3: the manual fallback path is untouched');
  }
  {
    // R4 — N7 from the client side, and it is the combination the server-side
    // drill cannot see: the value IS delivered, and the draft must still refuse it.
    const ctx = await rcOpen({ contactMode: 'none', responseContact: RC_REFUSED });
    const out = rcMain(ctx);
    softOk(out.includes(RC_REFUSED.value),
      'No.621 R4/N7: a refused address is still SHOWN — it is what the seafarer sent');
    const line = cardText(ctx, 'contact_response_refused');
    softOk(!!line && out.includes(esc(line)),
      'No.621 R4/N7: with an honest line saying no letter is prepared to it');
    vm.runInContext("pilotDraftOpen('intake-1','reply')", ctx);
    await flush();
    const draft = rcDetail(ctx).draft || {};
    softOk(draft.to === '', 'No.621 R4/N7: draft.to is EMPTY — got ' + JSON.stringify(draft.to));
    softOk(draft.needContact === true,
      'No.621 R4/N7: and the card asks for an address instead of silently using a forbidden one');
  }
  {
    // R5 — not an address at all.
    const ctx = await rcOpen({ contactMode: 'none', responseContact: RC_NOT_EMAIL });
    const out = rcMain(ctx);
    softOk(out.includes('+995 555 12 34 56'), 'No.621 R5/N4: a non-address contact is shown');
    const line = cardText(ctx, 'contact_response_not_email');
    softOk(!!line && out.includes(esc(line)),
      'No.621 R5/N4: with the honest line that this is not an e-mail');
    vm.runInContext("pilotDraftOpen('intake-1','reply')", ctx);
    await flush();
    softOk((rcDetail(ctx).draft || {}).needContact === true,
      'No.621 R5/N4: and no draft is addressed with it');
  }
  {
    // R6 — N13: the operator's correction wins, and the delivered value stays
    // visible as the second source rather than disappearing.
    const ctx = await rcOpen({ contactMode: 'contact', contactEmail: 'operator@example.test', responseContact: RC_ADDRESSABLE });
    const out = rcMain(ctx);
    softOk(out.includes('operator@example.test') && out.includes(RC_ADDRESSABLE.value),
      'No.621 R6/N13: both sources are on the screen');
    vm.runInContext("pilotDraftOpen('intake-1','reply')", ctx);
    await flush();
    softOk((rcDetail(ctx).draft || {}).to === 'operator@example.test',
      'No.621 R6/N13: the operator fact wins the draft — got ' + JSON.stringify((rcDetail(ctx).draft || {}).to));
  }
  {
    // R7 — N11: the screen does not say two different things at once.
    const ctx = await rcOpen({ contactMode: 'none', responseContact: RC_ADDRESSABLE });
    const out = rcMain(ctx);
    softOk(!out.includes('data-qa="crew-flow-email-hint"'),
      'No.621 R7/N11: with a delivered contact there is no "no address received" under the action buttons');
    const absent = await rcOpen({ contactMode: 'none', responseContact: undefined });
    softOk(rcMain(absent).includes('data-qa="crew-flow-email-hint"'),
      'No.621 R7/N11: and the hint is still there when nothing was delivered — the check is not vacuous');
    // R7b — the GAP. An answered absence and an unasked question are different
    // things, and the hint belongs only to the first. Folded together, the panel
    // says "no address received" for one frame before the address arrives: an
    // unknown wearing the clothes of an absence, which (930) п.1 forbids. Measured
    // on an intake whose contact was never asked about.
    const gap = vm.runInContext("crewFlowActionsHtml('intake-2')", absent);
    softOk(!/data-qa="crew-flow-email-(hint|not-usable|unknown)"/.test(String(gap)),
      'No.621 R7b: an intake whose contact has not been asked about yet gets NO address sentence at all');
    softOk(/data-qa="crew-flow-actions"/.test(String(gap)),
      'No.621 R7b: and the panel itself still renders — the check is about the sentence, not the panel');
  }
  {
    // R8 — N17, the back door. Three places the value must NOT be, measured after
    // the card has been open and the irreversible save has been pressed.
    const ctx = await rcOpen({ contactMode: 'none', responseContact: RC_ADDRESSABLE });
    const cacheDump = JSON.stringify(ctx.state.crewFlowFacts || {});
    softOk(!cacheDump.includes(RC_ADDRESSABLE.value),
      'No.621 R8/N17: the delivered value is absent from crewFlowFactCache()');
    softOk(!ctx.nodes.get('crew-flow-tree').innerHTML.includes(RC_ADDRESSABLE.value),
      'No.621 R8/N17: absent from the queue row');
    await vm.runInContext("crewFlowSaveToSeafarers('intake-1')", ctx);
    await flush();
    const saves = ctx.calls.filter((c) => c.command === 'save_seafarer_from_bundle');
    softOk(saves.length === 1, 'No.621 R8/N17: the save was actually pressed — ' + saves.length + ' call(s)');
    softOk(saves.length === 1 && !JSON.stringify(saves[0].args).includes(RC_ADDRESSABLE.value),
      'No.621 R8/N17: and the delivered value is absent from what went to the seafarer database');
    softOk(saves.length === 1 && saves[0].args.applicantSummary.email === '',
      'No.621 R8/N17: the saved email is what it was before this card — empty, because no email FACT exists');
  }
  {
    // R9 — N12: a bidi override must not be handed to the markup verbatim.
    const ctx = await rcOpen({ contactMode: 'none', responseContact: RC_BIDI });
    const out = rcMain(ctx);
    softOk(!out.includes('\u202E'),
      'No.621 R9/N12: the right-to-left override does not reach the rendered markup');
    softOk(/data-qa="pilot-contact-response"/.test(out),
      'No.621 R9/N12: the row is still rendered — the value is neutralised, not swallowed');
  }
  {
    // R9b — the same class on the row NEXT DOOR, and it is not hypothetical.
    // MEASURED in app/crewing_facts.py: an operator-entered fact value is checked
    // for type, length and NUL and for NOTHING ELSE - no printability, no
    // directional controls. So a `contact:email` FACT could carry a right-to-left
    // override and was rendered verbatim before this card. The provenance caption
    // and the value sanitiser are one edit to one shared row() helper, and leaving
    // the neighbouring row unsanitised would be deliberately keeping a known path
    // open in the block being edited.
    const ctx = await rcOpen({ contactMode: 'contact', contactEmail: 'a\u202Eexe.moc@example.test', responseContact: undefined });
    const out = rcMain(ctx);
    const contactRow = (out.match(/<div class="pilot-note" data-qa="pilot-contact-email">[\s\S]*?<\/div>/) || [''])[0];
    softOk(contactRow !== '', 'No.621 R9b: the operator contact row is rendered');
    softOk(contactRow !== '' && !contactRow.includes('\u202E'),
      'No.621 R9b: and the shared row() helper neutralises a bidi override in it too');
    // THE BOUNDARY, stated rather than hidden, because the check above would read
    // as more than it is. The SAME value is ALSO printed by the facts block
    // (pilotCardFactsHtml), which this card does not touch and which renders every
    // fact value with escapeHtml only - so the override still reaches the markup
    // there. That is a PRE-EXISTING path of the same class, it is not introduced
    // here, and closing it means editing the renderer of every fact value. It is
    // reported to the manager as a finding for the backlog, not widened into this
    // diff: the card's own rule is that incidental repair happens only when a
    // named criterion or the safety of THIS action requires it, and N12 is about
    // the delivered contact, which IS neutralised (R9).
    softOk(out.includes('\u202E'),
      'No.621 R9b (boundary, not a fix): the facts block still prints the override verbatim - pre-existing, outside this card, reported for the backlog');
  }
  {
    // R10 — N18: the demo host never reaches the command, so it never gets the
    // `demo_read_only` toast that would take the demo harness red.
    const ctx = makeCrewContext({ demo: true, responseContact: RC_ADDRESSABLE });
    ctx.__crew.renderCrewFlowView();
    await flush();
    ctx.__crew.pilotOpenCard('intake-1');
    await flush(10);
    softOk(!ctx.calls.some((c) => c.command === 'crewing_intake_response_contact'),
      'No.621 R10/N18: the demo host issues no response-contact command');
    softOk(!ctx.toasts.some(([m]) => /demo/i.test(String(m))),
      'No.621 R10/N18: and no demo toast is raised by this card');
  }
  {
    // R11 — both shipped languages, from the dictionaries rather than re-spelled.
    for (const lang of ['en', 'ru']) {
      const ctx = await rcOpen({ language: lang, contactMode: 'none', responseContact: RC_ADDRESSABLE });
      const out = rcMain(ctx);
      for (const key of ['contact_from_response', 'contact_response_failed', 'contact_response_refused', 'contact_response_not_email']) {
        const text = cardText(ctx, key);
        softOk(!!text, 'No.621 R11 (' + lang + '): ' + key + ' is translated — ' + JSON.stringify(text));
      }
      softOk(out.includes(esc(cardText(ctx, 'contact_from_response'))),
        'No.621 R11 (' + lang + '): the rendered caption is the dictionary one');
    }
  }
  {
    // R12 — N6 from the client side: the queue never carries the value, and the
    // list command is not the one that fetched it.
    const ctx = await rcOpen({ contactMode: 'none', responseContact: RC_ADDRESSABLE });
    const listCalls = ctx.calls.filter((c) => c.command === 'crewing_intake_candidate_list');
    softOk(listCalls.length >= 1, 'No.621 R12/N6: the queue was loaded');
    softOk(!ctx.nodes.get('crew-flow-tree').innerHTML.includes(RC_ADDRESSABLE.value),
      'No.621 R12/N6: no queue row carries the delivered address');
    const contactCalls = ctx.calls.filter((c) => c.command === 'crewing_intake_response_contact');
    softOk(contactCalls.length === 1 && contactCalls[0].args.intakeId === 'intake-1',
      'No.621 R12/N6: exactly one contact request, for the card that was opened — got ' + contactCalls.length);
  }
}

// # K2.1a — attachment ordinal: the client floor against the 0-based server contract
// (BACKLOG №504, 2026-09-27). The server counts attachments FROM ZERO — skipi-server
// `docs/crewing-baseline/c3a-api-contract.md` §attachments (rows "ordered by
// `ordinal`"; a one-attachment letter carries `ordinal: 0`) and
// `routers/candidate_intake.py _ordinal_or_404`: "the floor is 0, not 1". K2.1
// shipped a client floor of 1: pressing Download on the first — often the only —
// attachment toasted ordinal_out_of_range while a live GET /attachments/0 answered
// 200 with 898 bytes. The static checks below read the shipped bytes on both sides
// of the bridge so the two contracts cannot drift apart silently again.
console.log('\n# K2.1a attachment ordinal: client floor vs 0-based server contract');
{
  // the bound, wherever it lives: `if ordinal < <floor> || ordinal > <ceiling>` → ordinal_out_of_range
  const bound = rust.match(/if ordinal < (-?\d+) \|\| ordinal > (\d+) \{\s*\n\s*return Err\(invalid_request\("ordinal_out_of_range"\)\);/);
  softOk(!!bound, 'K2.1a-1: the attachment ordinal range check exists and refuses with ordinal_out_of_range');
  softOk(!!bound && Number(bound[1]) === 0,
    'K2.1a-1: the client floor admits ordinal 0 — the server counts attachments from zero (c3a-api-contract.md; _ordinal_or_404 "the floor is 0, not 1"); measured floor = ' + (bound ? bound[1] : 'none'));
  softOk(!!bound && Number(bound[2]) === 9999, 'K2.1a-1: the ceiling stays 9999');
  // the bound is a pure function with its own unit test, and the download command goes through it
  softOk(/fn checked_attachment_ordinal\(ordinal: i64\) -> Result<i64, PilotBridgeError>/.test(rust) && /fn the_first_attachment_is_ordinal_zero\(\)/.test(rust),
    'K2.1a-1: the bound is a pure function with a unit test that holds ordinal 0 to the contract');
  // №504-b: the body is a sync function measured by unit tests on the REAL request line
  // (`attachment_download_asks_the_server_for_the_ordinal_it_issued` — a `+ 1` after the
  // check or the old `< 1` guard put back both turn that test red); the command is a
  // pass-through. The token checks below only pin WHERE the behaviour lives, the
  // behaviour itself is held by `cargo test --lib`.
  const body = (rust.match(/\nfn download_attachment\([\s\S]*?\n\}\n/) || [''])[0];
  softOk(/let ordinal = checked_attachment_ordinal\(ordinal\)\?;/.test(body) && /&\["attachments", &ordinal\.to_string\(\)\]/.test(body),
    'K2.1a-1: download_attachment routes the ordinal through the checked bound before building /attachments/{ordinal}');
  const cmd = (rust.match(/pub\(crate\) async fn crewing_intake_attachment_download\([\s\S]*?\n\}\n/) || [''])[0];
  softOk(/download_attachment\(&context, &intake_id, ordinal, expected_bytes\)/.test(cmd) && !/ordinal\s*[+\-]|[+\-]\s*ordinal|ordinal <|ordinal >/.test(cmd),
    'K2.1a-1: the download command calls download_attachment(&context, &intake_id, ordinal, expected_bytes) and carries no `+ - < >` on ordinal (this regex does NOT see method calls: a live `ordinal.max(1)` / `.abs()` in the wrapper passed it and cargo 28/28 alike — Supervisor 66c66fd9, 2026-09-27)');
  // №504-b L1: the wrapper has no runtime test (it needs a Tauri State), so its WHOLE body is held
  // as a literal, whitespace-normalized. Any insertion — arithmetic, a method call such as
  // `.max(1)` / `.abs()`, a rename, a second statement — changes the literal and fails here.
  // This is a source pin, not runtime coverage: it says the wrapper is exactly the pass-through,
  // the behaviour itself is measured on download_attachment by `cargo test --lib`.
  const wrapperLiteral = "pub(crate) async fn crewing_intake_attachment_download( expected_context: PilotExpectedContext, intake_id: String, ordinal: i64, expected_bytes: Option<u64>, state: tauri::State<'_, AppState>, ) -> Result<CandidateIntakeDownload, PilotBridgeError> { let context = context_from_state(state, &expected_context)?; without_blocking_ui(move || { download_attachment(&context, &intake_id, ordinal, expected_bytes) }) .await }";
  const wrapperNormalized = cmd.replace(/\s+/g, ' ').trim();
  softOk(wrapperNormalized === wrapperLiteral,
    'K2.1a-1: the whole wrapper body equals the pass-through literal (whitespace-normalized) — any insertion into the command fails this line; measured RED on live `ordinal.max(1)`, `.abs()` and `+ 1`; got: ' + JSON.stringify(wrapperNormalized).slice(0, 400));
  softOk(/fn attachment_download_asks_the_server_for_the_ordinal_it_issued\(\)/.test(rust) && /fn out_of_range_ordinals_are_refused_before_any_dispatch\(\)/.test(rust),
    'K2.1a-1: the request line of download_attachment is measured by unit tests (ordinal 0 dispatched unshifted; -1/10000 refused before dispatch)');
  // dist: the row's ordinal reaches the bridge exactly as the server issued it — no ±1 on the client
  const dl = (c3b2Source.match(/async function pilotAttachmentDownload\(ordinal\) \{[\s\S]*?\n\}/) || [''])[0];
  softOk(dl !== '' && /ordinal:Number\(ordinal\)\s*,/.test(dl),
    'K2.1a-2: dist hands the row ordinal to the bridge as Number(ordinal) — unshifted');
  softOk(dl !== '' && !/[+\-]\s*\d|\d\s*[+\-]|\+\+|--/.test(dl),
    'K2.1a-2: no arithmetic anywhere in the download path — a client-side shift would re-create the off-by-one');
  softOk(/var ordinal = Number\(a\.ordinal \|\| 0\);/.test(c3b2Source) && /onclick="pilotAttachmentDownload\('\+String\(ordinal\)\+'\)"/.test(c3b2Source),
    'K2.1a-2: the attachment row passes its server ordinal to the download as-is');

}

// ===== No.623 (OWNER (943)/(944)/(963)): after a response, the card says WHO ====
//
// Six elements reach the card through `response_summary` on the candidate GET.
// What is drilled here is not "the renderer can print a name" — a fixture pushed
// into a renderer proves that and nothing else (card: «зелёный тест, где поле
// поставлено в фикстуру напрямую, приёмкой не является»). What is drilled is the
// SHAPE OF THE ANSWER: that the key survives the typed Tauri bridge at all, that
// the heading stays CONDITIONAL, that three states stay three, and that not one
// of the six reaches the irreversible seafarer database.
console.log('\n# No.623: the card says who responded');
{
  const RESP = {
    rank: 'Master', rank_state: 'from_snapshot',
    first_name: 'Ivan', surname: 'Petrov',
    age_years: 41, age_precision: 'exact',
    citizenship: 'Ukraine', citizenship_code: 'UA',
    experience_rank: 'Master', experience_days: 1170, experience_state: 'matches_response_rank',
    last_vessel_name: 'MV Southern Cross', last_vessel_sign_off: '2026-03-14',
  };
  const withSummary = (over) => Object.assign({}, RESP, over || {});
  const openWith = async (summary, opts) => {
    const srv = makeServer();
    if (summary !== undefined) srv.card.response_summary = summary;
    if (opts && opts.facts) srv.facts = opts.facts;
    const ctx = makeContext(Object.assign({ server: srv }, (opts && opts.ctx) || {}));
    ctx.__pilot.pilotOpenCard('intake-A');
    await flush();
    return ctx;
  };
  const between = (html, from, to) => {
    const a = html.indexOf(from); if (a < 0) return '';
    const b = to ? html.indexOf(to, a) : -1;
    return b < 0 ? html.slice(a) : html.slice(a, b);
  };

  // ---- 1. the typed bridge. Without this the six never leave Rust -----------
  // `send` decodes into CandidateIntakeReceipt; serde DROPS a key the struct does
  // not declare, silently and without failing the parse. So the installed No.621
  // candidate against an upgraded server renders NOTHING — and every renderer
  // test above it stays green while it does. This is the first thing that breaks.
  softOk(/pub response_summary: Option<CandidateResponseSummary>/.test(rust),
    'No.623/bridge: CandidateIntakeReceipt declares response_summary — otherwise serde drops the key before the webview sees it');
  softOk(/pub response_headline: Option<CandidateResponseHeadline>/.test(rust),
    'No.623/bridge: CandidateIntakeReceipt declares response_headline for the queue row');
  {
    const sumStruct = (rust.match(/pub\(crate\) struct CandidateResponseSummary \{[\s\S]*?\n\}/) || [''])[0];
    for (const field of ['rank', 'rank_state', 'first_name', 'surname', 'age_years', 'age_precision',
      'citizenship', 'citizenship_code', 'experience_rank', 'experience_days', 'experience_state',
      'last_vessel_name', 'last_vessel_sign_off']) {
      softOk(new RegExp('pub ' + field + ':').test(sumStruct), 'No.623/bridge: the summary carries ' + field);
    }
    // The contract is FROZEN: thirteen names, and a fourteenth would be a field
    // about a person that nobody agreed to (card STOP: «поле о человеке сверх шести»).
    const declared = (sumStruct.match(/\n {4}pub [a-z_]+:/g) || []).length;
    // No.632/S5: thirteen plus the three keys of the career map the server now
    // answers (experience_days_by_rank / _for_rank / _for_rank_state). The count
    // is kept EXACT rather than loosened to ">= 13", so it still catches a
    // fourteenth field about a person that nobody agreed to.
    softOk(declared === 16, 'No.623/bridge: the summary declares exactly the sixteen frozen names — thirteen of No.623 plus the three of the No.632 career map — got ' + declared);
    const headStruct = (rust.match(/pub\(crate\) struct CandidateResponseHeadline \{[\s\S]*?\n\}/) || [''])[0];
    const headDeclared = (headStruct.match(/\n {4}pub [a-z_]+:/g) || []).length;
    softOk(headDeclared === 4, 'No.623/bridge: the queue headline declares exactly four — the card shape must not ride the list — got ' + headDeclared);
    softOk(!/last_vessel|age_years|citizenship|experience_days/.test(headStruct),
      'No.623/bridge: no card-only element is declared on the queue headline');
  }
  // A server that does not carry the keys must not fail the parse of everything
  // else — the rule already written on `profile_ranks`.
  softOk(/#\[serde\(default[^\]]*\)\]\s*\n\s*pub response_summary/.test(rust)
    && /#\[serde\(default[^\]]*\)\]\s*\n\s*pub response_headline/.test(rust),
    'No.623/bridge: both are #[serde(default)] — an older pilot server still parses');
  softOk(!/deny_unknown_fields/.test(rust),
    'No.623/bridge: nothing in the intake bridge denies unknown fields');

  // ---- 2. THE HEADING IS CONDITIONAL --------------------------------------
  // Measured on the product (`dist/index.html` source table): inbound 9 ·
  // skipi_response 2 · synthetic 3. NINE of fourteen pilot cards are born of
  // e-mail and will never carry these fields. An unconditional heading makes the
  // majority of the queue WORSE, so the negative here is the load-bearing one.
  {
    const withResp = await openWith(RESP);
    const html = withResp.nodes.get('main').innerHTML;
    softOk(/data-qa="pilot-card-name"[^>]*>Ivan Petrov</.test(html),
      'No.623/1: the heading names the person who responded');
    softOk(/data-qa="pilot-card-response-rank"[^>]*>Master</.test(html),
      'No.623/1: and the post THEY RESPONDED ON stands beside the name');
    const headIdx = html.indexOf('data-qa="pilot-card-response-rank"');
    const nameIdx = html.indexOf('data-qa="pilot-card-name"');
    softOk(headIdx > 0 && nameIdx > headIdx, 'No.623/1: the order is «post · name», as the owner asked');

    const noResp = await openWith(undefined);
    const plain = noResp.nodes.get('main').innerHTML;
    softOk(!/data-qa="pilot-card-response-rank"/.test(plain),
      'No.623/1 NEGATIVE: a mail-born card (no response_summary) gets NO new heading — nine of fourteen pilot rows are this case');
    softOk(!/data-qa="pilot-response-summary"/.test(plain),
      'No.623/1 NEGATIVE: and no summary block is drawn for it');
    softOk(/data-qa="pilot-card-name"/.test(plain),
      'No.623/1 NEGATIVE (calibration): the card still renders its own heading — the negative is not measuring a blank card');
  }

  // ---- 3. the compact summary is VISIBLE, not filed under a disclosure ------
  {
    const ctx = await openWith(RESP);
    const html = ctx.nodes.get('main').innerHTML;
    softOk(/data-qa="pilot-response-summary"/.test(html), 'No.623/2: the compact summary is on the card');
    const sumIdx = html.indexOf('data-qa="pilot-response-summary"');
    const firstDetails = html.indexOf('<details');
    softOk(sumIdx > 0 && firstDetails > 0 && sumIdx < firstDetails,
      'No.623/2: the four elements are ABOVE the first disclosure — CANON (930): a decision is not made inside a collapsed block');
    const block = between(html, 'data-qa="pilot-response-summary"', '</section>');
    softOk(!/<details/.test(block), 'No.623/2: and the summary block contains no disclosure of its own');
    for (const [qa, needle] of [['pilot-response-age', '41'], ['pilot-response-citizenship', 'Ukraine'],
      ['pilot-response-experience', 'Master'], ['pilot-response-vessel', 'Southern Cross']]) {
      softOk(new RegExp('data-qa="' + qa + '"').test(block) && block.includes(needle),
        'No.623/2: ' + qa + ' is one of the four visible elements and states ' + needle);
    }
  }

  // ---- 4. age without invented precision ----------------------------------
  {
    const exact = await openWith(withSummary({ age_years: 41, age_precision: 'exact' }));
    const exactLine = between(exact.nodes.get('main').innerHTML, 'data-qa="pilot-response-age"', '</div>');
    softOk(exactLine.includes('41'), 'No.623/3: an exact date of birth gives the age as a number');

    const rough = await openWith(withSummary({ age_years: 41, age_precision: 'year' }));
    const roughLine = between(rough.nodes.get('main').innerHTML, 'data-qa="pilot-response-age"', '</div>');
    softOk(roughLine.includes('41'), 'No.623/3: a year-only date of birth still states the number it has');
    softOk(/data-precision="year"/.test(roughLine),
      'No.623/3: and the screen marks it approximate in the markup');
    // The comparison is on the VALUE THE OPERATOR READS, not on the whole cell:
    // a `data-precision` attribute alone made the two cells differ while the
    // visible text still claimed an exact age (mutation M11 survived exactly so).
    const valueOf = (line) => (String(line).match(/class="cf-resp-v[^"]*"[^>]*>([^<]*)</) || ['', ''])[1];
    softOk(valueOf(roughLine) !== valueOf(exactLine),
      'No.623/3 NEGATIVE: the two precisions do not render the same WORDS — a computed-to-the-day figure from a year-only birth date is an invented precision; got «' + valueOf(roughLine) + '» vs «' + valueOf(exactLine) + '»');
    softOk(valueOf(exactLine) === '41',
      'No.623/3 CALIBRATION: the exact case really is the bare number, so the inequality above is not measuring two kinds of hedging');
  }

  // ---- 5. experience names the post it was counted for ---------------------
  {
    const same = await openWith(withSummary({ experience_rank: 'Master', experience_state: 'matches_response_rank' }));
    const sameLine = between(same.nodes.get('main').innerHTML, 'data-qa="pilot-response-experience"', '</div>');
    softOk(sameLine.includes('Master'),
      'No.623/4: the sea time says WHICH post it was counted for, never a bare number');

    const other = await openWith(withSummary({ experience_rank: 'Chief Officer', experience_state: 'other_rank' }));
    const otherLine = between(other.nodes.get('main').innerHTML, 'data-qa="pilot-response-experience"', '</div>');
    softOk(otherLine.includes('Chief Officer'),
      'No.623/4: when the seafarer wrote a DIFFERENT post, that post is the one named');
    softOk(otherLine !== sameLine,
      'No.623/4 NEGATIVE: «counted for the post responded on» and «counted for another post» do not read the same — No.622 is not open, so the screen must say which it is');

    const unknown = await openWith(withSummary({ experience_rank: null, experience_days: null, experience_state: 'response_rank_unknown' }));
    const unkLine = between(unknown.nodes.get('main').innerHTML, 'data-qa="pilot-response-experience"', '</div>');
    softOk(!/\b0\b/.test(unkLine),
      'No.623/4 NEGATIVE: an unknown post never renders as «0 days» — «no data» and «zero sea time» are different statements about a person');
  }

  // ---- 6. THE FROZEN POST. (944): the seafarer who answered «Master» must
  //         never be shown today's «Chief Officer» --------------------------
  {
    const superseded = await openWith(withSummary({ rank: null, rank_state: 'snapshot_superseded' }));
    const html = superseded.nodes.get('main').innerHTML;
    softOk(!/Chief Officer/.test(between(html, 'data-qa="pilot-card-identity"', '</div></div>')),
      'No.623/5: a superseded snapshot shows NO post rather than the profile’s current one');
    softOk(/data-qa="pilot-response-rank-state"/.test(html),
      'No.623/5: and it says WHY the post is missing, instead of going quiet');
    const unavailable = await openWith(withSummary({ rank: null, rank_state: 'snapshot_unavailable' }));
    const a = between(html, 'data-qa="pilot-response-rank-state"', '</span>');
    const b = between(unavailable.nodes.get('main').innerHTML, 'data-qa="pilot-response-rank-state"', '</span>');
    softOk(a !== '' && b !== '' && a !== b,
      'No.623/5: «the version was overwritten» and «there is no readable snapshot» are two different sentences, not one');
  }

  // ---- 7. Б3: THREE STATES, and the contract was broken BEFORE No.623 ------
  // `answered = !!(d.facts && d.facts.length)` derived "the question was asked"
  // from "the answer was not empty". A failed request therefore rendered as an
  // absence — an unasked question wearing the clothes of an answer.
  {
    const srv = makeServer();
    const ctx = makeContext({ server: srv, invokeImpl: (command) => {
      if (command === 'crewing_intake_candidate_get') throw { kind: 'server', status: 500, detail: null, ambiguous: false };
      return undefined;
    } });
    ctx.__pilot.pilotOpenCard('intake-A');
    await flush();
    const html = ctx.nodes.get('main').innerHTML;
    const ident = between(html, 'data-qa="pilot-card-identity"', '</section>');
    softOk(/data-name="error"/.test(ident),
      'No.623/Б3: a card request that FAILED is the «could not be loaded» state — not «name not given»');
    softOk(!/name not given/i.test(ident),
      'No.623/Б3: and the words «name not given» are not printed over a question nobody answered');
    softOk(/data-qa="pilot-identity-load-error"/.test(html),
      'No.623/Б3: the failure is stated NEXT TO THE DECISION');
    const errIdx = html.indexOf('data-qa="pilot-identity-load-error"');
    const firstDetails = html.indexOf('<details');
    softOk(errIdx > 0 && (firstDetails < 0 || errIdx < firstDetails),
      'No.623/Б3: ...and above the first disclosure — CANON (930) п.1 forbids hiding an error inside a collapsed block');
  }
  {
    const srv = makeServer();
    const ctx = makeContext({ server: srv, invokeImpl: (command) => {
      if (command === 'crewing_intake_fact_list') throw { kind: 'server', status: 503, detail: null, ambiguous: false };
      return undefined;
    } });
    ctx.__pilot.pilotOpenCard('intake-A');
    await flush();
    const ident = between(ctx.nodes.get('main').innerHTML, 'data-qa="pilot-card-identity"', '</section>');
    softOk(/data-name="error"/.test(ident),
      'No.623/Б3: a facts request that failed is an error too — today it renders as «unknown» with nothing said');
  }
  {
    // CALIBRATION. Without this, "always render error" passes the two above.
    const clean = await openWith(undefined);
    const ident = between(clean.nodes.get('main').innerHTML, 'data-qa="pilot-card-identity"', '</section>');
    softOk(!/data-name="error"/.test(ident),
      'No.623/Б3 CALIBRATION: a card that loaded CLEANLY is not reported as an error — «always error» does not pass');
    softOk(/data-name="none"/.test(ident),
      'No.623/Б3 CALIBRATION: an answered empty facts list is still the honest «no name recorded» — an empty answer IS an answer');
  }

  // ---- 8. Б2: THREE transports of one name, and the order is assigned ------
  //         operator correction > delivered with the response > parsed from a CV
  {
    const machine = { name: [{ field: 'name', value: 'I. PETROV (OCR)', version: 1, source_object: 'obj-1',
      page: null, span: null, confidence: 0.4, uncertainty: null, corrected_by: null, created_at: '2026-09-23T01:01:00' }] };
    const ctx1 = await openWith(RESP, { facts: machine });
    const h1 = ctx1.nodes.get('main').innerHTML;
    softOk(/data-qa="pilot-card-name"[^>]*>Ivan Petrov</.test(h1),
      'No.623/Б2: the name the seafarer sent WITH THE RESPONSE beats the one a machine read out of a CV');
    softOk(!/OCR/.test(between(h1, 'data-qa="pilot-card-identity"', '</section>')),
      'No.623/Б2: and the two are never shown side by side — the invariant above crewFlowRowNameState holds');

    const operator = { name: [{ field: 'name', value: 'Ivan Petrov-Sydorenko', version: 2, source_object: 'obj-1',
      page: null, span: null, confidence: null, uncertainty: 'operator_entered', corrected_by: 'user-op-1', created_at: '2026-09-23T01:02:00' }] };
    const ctx2 = await openWith(RESP, { facts: operator });
    const h2 = ctx2.nodes.get('main').innerHTML;
    softOk(/data-qa="pilot-card-name"[^>]*>Ivan Petrov-Sydorenko</.test(h2),
      'No.623/Б2: an OPERATOR’s correction is a human act and outranks the delivered value — it is never overwritten by it');
    softOk(!/>Ivan Petrov</.test(h2),
      'No.623/Б2: and again only one name is on screen');
  }

  // ---- 9. Б1: NOT ONE of the six reaches the irreversible local database ---
  // The open owner question is not answered here by the back door. Note the
  // route: everything in crewFlowFactCache() reaches BOTH the queue row and
  // `save_seafarer_from_bundle`, so «don’t call the writer» is not enough —
  // nothing of the response may enter that store in the first place.
  {
    const save = (html.match(/async function crewFlowSaveToSeafarers\(intakeId\) \{[\s\S]*?\n\}/) || [''])[0];
    softOk(save !== '', 'No.623/Б1 (control): the irreversible writer is still where it was');
    softOk(!/response_summary|response_headline|responseSummary|responseHeadline/.test(save),
      'No.623/Б1: crewFlowSaveToSeafarers does not read a single one of the six — the local export is OUT OF SCOPE for No.623');
    const applicant = (save.match(/applicantSummary: \{[\s\S]*?\}/) || [''])[0];
    softOk(/name: facts\.name \|\| ''/.test(applicant) && /rank: facts\.rank \|\| ''/.test(applicant)
      && /nationality: facts\.nationality \|\| ''/.test(applicant) && /email: facts\.email \|\| ''/.test(applicant),
      'No.623/Б1: what it writes is byte-for-byte what it wrote before — four recorded facts, nothing delivered');
    softOk(!/crewFlowFactCache\(\)\[[^\]]*\]\s*=\s*[^;]*response/i.test(html),
      'No.623/Б1: nothing from the response is ever put into the fact cache, which is the door to that writer');
  }

  // ---- 10. the summary is RE-READ FROM THE SERVER (acceptance criterion 6) --
  {
    const srv = makeServer();
    srv.card.response_summary = RESP;
    const ctx = makeContext({ server: srv });
    ctx.__pilot.pilotOpenCard('intake-A');
    await flush();
    const before = ctx.calls.filter((c) => c.command === 'crewing_intake_candidate_get').length;
    ctx.__pilot.pilotCardRefreshAll();
    await flush();
    const after = ctx.calls.filter((c) => c.command === 'crewing_intake_candidate_get').length;
    softOk(after === before + 1,
      'No.623/6: refreshing the card asks the SERVER for the summary again — it does not live in screen memory');
    // and the value that came back is the one on screen
    srv.card.response_summary = withSummary({ first_name: 'Ivanna', surname: 'Petrova' });
    ctx.__pilot.pilotCardRefreshAll();
    await flush();
    softOk(/data-qa="pilot-card-name"[^>]*>Ivanna Petrova</.test(ctx.nodes.get('main').innerHTML),
      'No.623/6: and a changed server answer changes the screen — proving the screen is not showing a cached copy');
    softOk(!ctx.calls.some((c) => c.command === 'save_seafarer_from_bundle'),
      'No.623/6 NEGATIVE: showing the card never produced a LOCAL copy — the negative the owner’s open question requires');
  }

  // ---- 11. absent elements are honest, in both languages -------------------
  {
    const empty = await openWith(withSummary({
      age_years: null, age_precision: null, citizenship: null, citizenship_code: null,
      experience_rank: null, experience_days: null, experience_state: 'not_provided',
      last_vessel_name: null, last_vessel_sign_off: null,
    }));
    const block = between(empty.nodes.get('main').innerHTML, 'data-qa="pilot-response-summary"', '</section>');
    softOk(block !== '', 'No.623/7: a response whose elements are all empty still shows the block — the response itself exists');
    softOk(!/\b0\b/.test(block), 'No.623/7: and states nothing as «0»');
    const missing = (block.match(/data-qa="pilot-response-missing"/g) || []).length;
    softOk(missing >= 4, 'No.623/7: each of the four says «not given» in its own place — got ' + missing);
  }
  {
    for (const lang of ['en', 'ru']) {
      const srv = makeServer();
      srv.card.response_summary = RESP;
      const ctx = makeContext({ server: srv, language: lang });
      ctx.__pilot.pilotOpenCard('intake-A');
      await flush();
      const block = between(ctx.nodes.get('main').innerHTML, 'data-qa="pilot-response-summary"', '</section>');
      softOk(block !== '' && !/^\s*$/.test(block), 'No.623/8: the summary renders in ' + lang);
      softOk(!/response_summary\.|card\.[a-z_]+\b(?![^<]*>)/.test(block) && !/\bundefined\b/.test(block),
        'No.623/8: no untranslated key and no «undefined» leaks onto the screen in ' + lang);
    }
    const t = (l, k) => ctxText(l, k);
    function ctxText(lang, key) {
      const ctx = makeContext({ language: lang });
      return ctx.__pilot.cardT(key);
    }
    for (const key of ['resp_age', 'resp_citizenship', 'resp_experience', 'resp_vessel', 'resp_missing',
      'resp_rank_superseded', 'resp_rank_unavailable', 'resp_rank_absent', 'resp_age_about',
      'resp_exp_other_rank', 'resp_exp_rank_unknown', 'resp_exp_not_provided', 'identity_failed']) {
      const en = t('en', key); const ru = t('ru', key);
      softOk(en !== key, 'No.623/8: EN text exists for ' + key);
      softOk(ru !== key && ru !== en, 'No.623/8: RU text exists for ' + key + ' and is not the English string');
      softOk(/[Ѐ-ӿ]/.test(ru), 'No.623/8: the RU text for ' + key + ' is actually Russian');
    }
  }

  // ---- 12. the dead heading stays dead ------------------------------------
  {
    const callSites = (html.match(/crewFlowRowTitle\(/g) || []).length;
    softOk(callSites <= 1,
      'No.623/Б2: crewFlowRowTitle was NOT revived — a third independent title rule is exactly what the finding forbade (occurrences: ' + callSites + ')');
  }
}

// ===========================================================================
// No.632 (OWNER (965)/(969)): the shortlist button on the fit card, and the
// profile's own list of the candidates chosen for it.
//
// Two screens of one subsystem, both on isolated copies of the bounded blocks.
// Nothing here contacts a server.
// ===========================================================================
console.log('# No.632: the add button on every fit card, and the profile shortlist');
{
  // ---- 1. the bridge DECLARES every field, or serde drops it in silence ----
  // The exact defect No.623 paid for twice: serde drops a key no field declares,
  // without failing the parse. The screen then renders yesterday and every
  // renderer test stays green over it. So the DECLARATION is asserted here, and
  // the round trip is asserted in Rust.
  for (const command of ['crewing_intake_shortlist_hold', 'crewing_intake_shortlist_release', 'crewing_intake_profile_shortlist']) {
    softOk(new RegExp(`pub\\(crate\\) async fn ${command}\\b`).test(rust), `No.632/1: the bridge defines ${command}`);
    softOk(new RegExp(`crewing_intake::${command}\\b`).test(lib), `No.632/1: ${command} is registered in the Tauri handler`);
  }
  const structFields = (name) => {
    const m = new RegExp(`pub\\(crate\\) struct ${name} \\{([\\s\\S]*?)\\n\\}`).exec(rust);
    return m ? m[1] : '';
  };
  for (const [name, fields] of [
    ['ShortlistHold', ['id', 'intake_id', 'profile_id', 'profile_version', 'confirmed_by', 'confirmed_at', 'on_hold', 'held_by', 'held_at', 'withdrawn_by', 'withdrawn_at']],
    ['ProfileShortlistItem', ['id', 'intake_id', 'profile_version', 'confirmed_by', 'confirmed_at', 'on_hold', 'held_by', 'held_at', 'in_selection', 'needs_recompare']],
    ['ProfileShortlistCounts', ['selected', 'in_selection', 'on_hold']],
    ['ProfileShortlistResponse', ['profile_id', 'profile_version', 'profile_state', 'items', 'counts']],
  ]) {
    const body = structFields(name);
    for (const field of fields) {
      softOk(body !== '' && new RegExp(`\\bpub ${field}:`).test(body), `No.632/1: ${name} declares ${field} — undeclared is silently dropped`);
    }
  }
  // The three refusal words of the new state. Not on the allowlist = the screen
  // receives a bare 403/409 and cannot say WHICH door was shut.
  for (const code of ['already_on_hold', 'not_on_hold', 'hold_not_permitted']) {
    softOk(new RegExp(`"${code}"`).test(rust), `No.632/1: ${code} passes the bridge's safe-detail allowlist`);
  }
  const fnBody = (name) => {
    const m = new RegExp(`pub\\(crate\\) async fn ${name}\\(([\\s\\S]*?)\\n\\}`).exec(rust);
    return m ? m[1] : '';
  };
  softOk(/send_no_content\(/.test(fnBody('crewing_intake_shortlist_release')),
    'No.632/1: the release goes through send_no_content — an undocumented 200 stays UNKNOWN instead of being called a success');
  softOk(/Method::DELETE/.test(fnBody('crewing_intake_shortlist_release')), 'No.632/1: the release is a DELETE');
  softOk(/Method::POST/.test(fnBody('crewing_intake_shortlist_hold')), 'No.632/1: the hold is a POST');
  softOk(/checked_pair\(&pair\)/.test(fnBody('crewing_intake_shortlist_hold')), 'No.632/1: the hold validates the pair before any dispatch');
  softOk(/"matching-profiles"/.test(fnBody('crewing_intake_profile_shortlist')) && /"shortlist"/.test(fnBody('crewing_intake_profile_shortlist')),
    'No.632/1: the reverse list asks the matching-profiles surface');
  softOk(/Method::GET/.test(fnBody('crewing_intake_profile_shortlist')), 'No.632/1: the reverse list is a GET');

  // ---- 2. the STOP lines of the card, read off the block itself ----------
  softOk(s632Source !== '', 'No.632/2: the profile-shortlist block is bounded by its own markers');
  softOk(s632Source !== '' && !/crewFlowSaveToSeafarers|saveCandidateToSeafarers/.test(s632Source),
    'No.632/2: the block never writes into the local seafarers table (STOP of the card)');
  softOk(s632Source !== '' && !/send_mail|sendMail/.test(s632Source),
    'No.632/2: the block never sends mail — OWNER (739) п.5, the operator sends from their own client');
  softOk(s632Source !== '' && !/localStorage|sessionStorage|indexedDB/.test(s632Source),
    'No.632/2: the list is NOT kept on the device — it is re-read from the server, which is what "survives a restart" means');

  // ---- 3. module 1: the button on EVERY fit card -------------------------
  {
    const ctx = makeContext();
    await positiveChainUntilRank(ctx);
    const fitCards = () => main(ctx).split('data-qa="pilot-fit-card"');
    const fitCard = (id) => fitCards().slice(1).find((part) => part.startsWith(` data-profile="${id}"`)) || null;
    softOk(['prof-A', 'prof-B', 'prof-C'].every((id) => fitCard(id) && /data-qa="pilot-fit-confirm"/.test(fitCard(id))),
      'No.632/3: EVERY card of "match against profiles" carries the add button, not only the primary one');
    softOk(/data-qa="pilot-fit-confirm"[^>]*onclick="pilotShortlistConfirm\('prof-B',1\)"/.test(main(ctx)),
      'No.632/3: the button is wired to the pair of ITS OWN card — profile and version');
    softOk(/data-qa="pilot-fit-into"/.test(fitCard('prof-A') || ''),
      'No.632/3: the card says which profile and which version the press puts him into');
    const before = ctx.calls.filter((c) => c.command === 'crewing_intake_shortlist_confirm').length;
    await ctx.__pilot.pilotShortlistConfirm('prof-B', 1); await flush();
    const confirms = ctx.calls.filter((c) => c.command === 'crewing_intake_shortlist_confirm');
    softOk(confirms.length === before + 1 && JSON.stringify(confirms.slice(-1)[0].args.pair) === JSON.stringify({ profile_id: 'prof-B', profile_version: 1 }),
      'No.632/3 (PRESERVE sentinel, green on the base too): the existing confirm dispatch still sends exactly the viewed pair');
    // The duplicate is visible BEFORE the press, not discovered through a 409.
    softOk(/data-qa="pilot-fit-onlist"/.test(fitCard('prof-B') || ''),
      'No.632/3: the card he is ALREADY on says so, before anything is pressed');
    softOk(!!fitCard('prof-B') && /data-qa="pilot-fit-onlist"/.test(fitCard('prof-B')) && !/data-qa="pilot-fit-confirm"/.test(fitCard('prof-B')),
      'No.632/3: and offers no second add on that card — calibrated: the card must exist and carry the tag, so an empty screen cannot pass this');
    softOk(!/data-qa="pilot-fit-onlist"/.test(fitCard('prof-A') || '') && /data-qa="pilot-fit-confirm"/.test(fitCard('prof-A') || ''),
      'No.632/3: the OTHER cards are untouched by that decision');
    softOk((main(ctx).match(/data-qa="pilot-fit-confirm"/g) || []).length === 2,
      'No.632/3: exactly the two remaining cards offer the add — the count is asserted, not eyeballed');
    // Three states: a figure, an absence, and a read that FAILED.
    const broken = makeContext({ invokeImpl: (command) => { if (command === 'crewing_intake_rank_list') throw { kind: 'server', status: 500 }; } });
    await openCard(broken); await flush();
    softOk(/data-qa="pilot-ranks-error"/.test(main(broken)) && !/data-qa="pilot-fit-confirm"/.test(main(broken))
      && /data-qa="pilot-fit-confirm"/.test(main(ctx)),
      'No.632/3: when the comparisons could not be read the block says so and offers no button over data it does not have — calibrated against a context where the button IS drawn');
  }
  for (const key of ['fit_on_shortlist', 'fit_into']) {
    const en = makeContext({ language: 'en' }).__pilot.cardT(key);
    const ru = makeContext({ language: 'ru' }).__pilot.cardT(key);
    softOk(en !== key, `No.632/3: EN text exists for ${key}`);
    softOk(ru !== key && ru !== en && /[Ѐ-ӿ]/.test(ru), `No.632/3: RU text exists for ${key} and is actually Russian`);
  }

  // ---- 4. module 2: the profile's own list -------------------------------
  let pctx = null;
  try { pctx = makeProfileContext(); await flush(); } catch (e) { pctx = null; }
  const psafe = (fn) => { try { const v = fn(); return v === undefined ? false : v; } catch (e) { return false; } };
  const phtml = (c) => ((c || pctx) ? (c || pctx).nodes.get('profile-shortlist-host').innerHTML : '');
  // split, not a greedy regex: each segment is exactly what lies between one row
  // marker and the next, so "the other rows are untouched" can be asserted.
  const prowOf = (c, intakeId) => phtml(c).split('data-qa="profile-shortlist-row"').slice(1)
    .find((part) => part.startsWith(` data-intake="${intakeId}"`)) || null;
  const prow = (intakeId) => prowOf(pctx, intakeId);
  const pcalls = () => (pctx ? pctx.calls : []);
  const refusingState = (c) => (c ? c.__s632.profileShortlistStateFor('prof-A') : null);

  softOk(psafe(() => /data-qa="profile-shortlist"/.test(phtml())), 'No.632/4: the profile renders a shortlist section');
  softOk(psafe(() => pcalls().some((c) => c.command === 'crewing_intake_profile_shortlist' && c.args.profileId === 'prof-A')),
    'No.632/4: the section asks the SERVER for the list of this profile');
  softOk(psafe(() => /data-qa="profile-shortlist-counts"/.test(phtml())),
    'No.632/4: the counts the server computed are shown — selected, in the selection, on hold');
  softOk(psafe(() => {
    const m = /data-qa="profile-shortlist-counts"[^>]*>([^<]*)</.exec(phtml());
    return !!m && /4/.test(m[1]) && /3/.test(m[1]);
  }), 'No.632/4: and they are the SERVER\'s three numbers, not a recount on the screen');
  softOk(psafe(() => ['intake-1', 'intake-2', 'intake-3', 'intake-4'].every((id) => prow(id))), 'No.632/4: every shortlisted candidate has a row');
  // The fixture above makes the server's counts AGREE with what a naive recount
  // of the rows would produce, so it cannot tell the two apart. This one makes
  // them disagree on purpose: `in_selection` is the one predicate the letter
  // will use, and a screen that recounts is a SECOND place where "who goes to
  // the customer" is decided — which is how a screen comes to say three while an
  // envelope carries four.
  {
    let divergent = null;
    try {
      const inner = makeProfileServer();
      const passthrough = inner.handle.bind(inner);
      inner.handle = (command, args) => {
        const answer = passthrough(command, args);
        if (command === 'crewing_intake_profile_shortlist') answer.counts = { selected: 7, in_selection: 5, on_hold: 2 };
        return answer;
      };
      divergent = makeProfileContext({ server: inner }); await flush();
    } catch (e) { divergent = null; }
    softOk(psafe(() => {
      const m = /data-qa="profile-shortlist-counts"[^>]*>([^<]*)</.exec(phtml(divergent));
      return !!m && /7/.test(m[1]) && /5/.test(m[1]) && !/\b4\b/.test(m[1]);
    }), 'No.632/4: the counts shown are the SERVER\'s even when they disagree with the rows on screen — the screen does not keep a second copy of that rule');
  }

  // the six facts of a row, through the SAME helpers No.623 built
  softOk(psafe(() => /Ivan Petrenko/.test(prow('intake-1'))), 'No.632/4: the row names the person');
  softOk(psafe(() => /data-qa="profile-shortlist-age"/.test(prow('intake-1')) && /43/.test(prow('intake-1'))), 'No.632/4: age');
  softOk(psafe(() => /data-qa="profile-shortlist-citizenship"/.test(prow('intake-1')) && /Ukrainian/.test(prow('intake-1'))), 'No.632/4: citizenship');
  softOk(psafe(() => /data-qa="profile-shortlist-experience"/.test(prow('intake-1')) && /Master/.test(prow('intake-1'))),
    'No.632/4: sea time, and it NAMES the post it was counted for (No.622 is not open — equality is by bytes)');
  softOk(psafe(() => /data-qa="profile-shortlist-vessel"/.test(prow('intake-1')) && /Odesa Dawn/.test(prow('intake-1'))), 'No.632/4: last vessel');
  softOk(psafe(() => /data-qa="profile-shortlist-attachments"/.test(prow('intake-1'))), 'No.632/4: how many files arrived with the response');
  softOk(psafe(() => /data-qa="profile-shortlist-attachments"[^>]*data-attachments="1"/.test(prow('intake-1'))
    && /data-qa="profile-shortlist-attachments"[^>]*data-attachments="0"/.test(prow('intake-3'))),
    'No.632/4: a candidate WITHOUT an attachment is named as having none — he does not pass silently');
  softOk(psafe(() => /<span class="ps-v">attachments: 1<\/span>/.test(prow('intake-1'))),
    'No.632/4: and the COUNT is on the screen, not a yes/no verdict about what the file is');
  softOk(psafe(() => !/\{n\}/.test(String(phtml() || ''))),
    'No.632/4: the count is substituted into the text, never printed as a raw placeholder');
  // The product has no resume recogniser, so no surface of this section is
  // allowed to call a file a CV. This is the owner's word of 2026-10-01 turned
  // into a sensor rather than a promise.
  softOk(psafe(() => !/\bCV\b/.test(String(phtml() || ''))),
    'No.632/4: the word "CV" appears NOWHERE in what the operator reads — an attachment is not a resume');
  // Nine of the fourteen pilot cards are born of e-mail and carry no summary at
  // all. Nothing may be printed unconditionally over that.
  softOk(psafe(() => /data-qa="profile-shortlist-missing"/.test(prow('intake-3'))),
    'No.632/4: a candidate with no response summary SAYS the fields were not given');
  softOk(psafe(() => !!prow('intake-3') && !/>0 </.test(prow('intake-3'))),
    'No.632/4: and an absence is never turned into a zero — calibrated: the row must exist first');
  softOk(psafe(() => !!prow('intake-3') && /data-qa="profile-shortlist-age"[^>]*data-state="missing"/.test(prow('intake-3'))
    && /data-qa="profile-shortlist-age"[^>]*data-state="have"/.test(prow('intake-1') || '')),
    'No.632/4: an absent age is MARKED absent while a present one is marked present — two states on the wire, not one blank');

  // three states: a value, an absence, and a read that FAILED are three things
  softOk(psafe(() => /data-qa="profile-shortlist-row-error"/.test(prow('intake-4'))),
    'No.632/4: a row whose own details could not be read says SO — beside the actions, not folded away');
  softOk(psafe(() => !!prow('intake-4') && /data-qa="profile-shortlist-row-error"/.test(prow('intake-4'))
    && !/data-qa="profile-shortlist-missing"/.test(prow('intake-4'))),
    'No.632/4: and a failed read is NEVER rendered as "not given" — calibrated: the row and its error must both be there');
  softOk(psafe(() => /data-qa="profile-shortlist-row" data-intake="intake-4"/.test(phtml())),
    'No.632/4: the row itself still stands — the decision is a fact even when the person\'s details are not in hand');

  // the three states of the decision
  softOk(psafe(() => /data-qa="profile-shortlist-inselection"/.test(prow('intake-1'))), 'No.632/4: the one who goes out is marked');
  softOk(psafe(() => /data-qa="profile-shortlist-hold"/.test(prow('intake-2'))), 'No.632/4: the one set aside is marked');
  softOk(psafe(() => /data-qa="profile-shortlist-hold-note"/.test(prow('intake-2'))),
    'No.632/4: and it says IN WORDS that he will not go in the selection');
  softOk(psafe(() => /data-qa="profile-shortlist-release"/.test(prow('intake-2')) && !/data-qa="profile-shortlist-hold-action"/.test(prow('intake-2'))),
    'No.632/4: a candidate on hold is offered the way back, not the way he already went');
  softOk(psafe(() => /data-qa="profile-shortlist-hold-action"/.test(prow('intake-1')) && !/data-qa="profile-shortlist-release"/.test(prow('intake-1'))),
    'No.632/4: a candidate in the selection is offered the hold');
  softOk(psafe(() => /data-qa="profile-shortlist-recompare"/.test(prow('intake-3'))),
    'No.632/4: a decision taken against an older version of the vacancy is MARKED — and stays on the list');
  softOk(psafe(() => !!prow('intake-1') && !/data-qa="profile-shortlist-recompare"/.test(prow('intake-1'))
    && /data-qa="profile-shortlist-recompare"/.test(prow('intake-3') || '')),
    'No.632/4: a decision taken against the current version is NOT marked, while the older one IS — the mark distinguishes, it is not decoration');

  // contacts: only the mechanisms this product already has, and an absent one is
  // DARK AND NAMED rather than hidden
  softOk(psafe(() => /data-qa="profile-shortlist-email"[^>]*onclick/.test(prow('intake-1')) && !/data-qa="profile-shortlist-email"[^>]*disabled/.test(prow('intake-1'))),
    'No.632/4: e-mail is offered where an address was received');
  softOk(psafe(() => /data-qa="profile-shortlist-phone"[^>]*disabled/.test(prow('intake-3'))), 'No.632/4: a missing phone is a DARK button');
  softOk(psafe(() => {
    const m = /data-qa="profile-shortlist-phone"[^>]*>([^<]*)</.exec(prow('intake-3') || '');
    return !!m && /Номера нет|No number/.test(m[1]);
  }), 'No.632/4: and the dark button SAYS what is missing instead of vanishing');
  softOk(psafe(() => /data-qa="profile-shortlist-phone"[^>]*onclick/.test(prow('intake-1') || '')
    && !/data-qa="profile-shortlist-phone"[^>]*disabled/.test(prow('intake-1'))),
    'No.632/4: where a number WAS received the button is live and wired — calibrated: it must be present, not merely not-disabled');
  // The number is offered ONCE. A second button over the same clipboard, named
  // for a transport this build does not have, was removed on the owner's word
  // of 2026-10-01; this keeps it from growing back.
  softOk(psafe(() => (String(prow('intake-1') || '').match(/<button/g) || []).length === 4),
    'No.632/4: the row offers exactly four buttons — e-mail, copy the number, set aside, remove; no second clipboard button grows back');
  softOk(psafe(() => !/messenger|мессенджер/i.test(String(phtml() || ''))),
    'No.632/4: no button promises a messenger — the product has no messenger transport');
  // A button must be named by what it DOES. "phone" promises a call; this one
  // copies. Calibrated: the live label must exist first.
  softOk(psafe(() => {
    const m = /data-qa="profile-shortlist-phone"[^>]*onclick[^>]*>([^<]*)</.exec(prow('intake-1') || '');
    return !!m && /Скопировать номер|Copy the number/.test(m[1]) && !/^телефон$|^phone$/i.test(m[1]);
  }), 'No.632/4: the number button is named for the clipboard, not for a call this build cannot place');
  if (pctx) {
    await pctx.__s632.profileShortlistEmail('intake-1'); await flush();
    const mailto = pcalls().filter((c) => c.command === 'open_mailto').slice(-1)[0];
    softOk(!!mailto && mailto.args.to === 'ivan.petrenko@example.com',
      'No.632/4: e-mail hands the draft to the operator\'s own client through the EXISTING open_mailto — Crewing sends nothing');
    await pctx.__s632.profileShortlistCopyPhone('intake-1'); await flush();
    softOk(pctx.copied.some((t) => /\+380501112233/.test(t)),
      'No.632/4: the phone action uses the clipboard this build already has — no dialler is invented');
  } else { softOk(false, 'No.632/4: e-mail opens the operator client'); softOk(false, 'No.632/4: phone uses the clipboard'); }

  // the three writes carry the version THE DECISION WAS MADE AGAINST
  if (pctx) {
    await pctx.__s632.profileShortlistHold('intake-1'); await flush();
    const hold = pcalls().filter((c) => c.command === 'crewing_intake_shortlist_hold').slice(-1)[0];
    softOk(!!hold && hold.args.intakeId === 'intake-1' && JSON.stringify(hold.args.pair) === JSON.stringify({ profile_id: 'prof-A', profile_version: 2 }),
      'No.632/4: the hold is dispatched for that candidate and that pair');
    await pctx.__s632.profileShortlistRelease('intake-2'); await flush();
    const rel = pcalls().filter((c) => c.command === 'crewing_intake_shortlist_release').slice(-1)[0];
    softOk(!!rel && rel.args.intakeId === 'intake-2' && JSON.stringify(rel.args.pair) === JSON.stringify({ profile_id: 'prof-A', profile_version: 2 }),
      'No.632/4: the return from hold is dispatched for that pair');
    // the row decided against v1 while the profile is on v2 keeps v1
    await pctx.__s632.profileShortlistHold('intake-3'); await flush();
    const holdOld = pcalls().filter((c) => c.command === 'crewing_intake_shortlist_hold').slice(-1)[0];
    softOk(!!holdOld && holdOld.args.pair.profile_version === 1,
      'No.632/4: a decision made against an OLDER version is moved at THAT version, never at the profile\'s current one');
    const reads = pcalls().filter((c) => c.command === 'crewing_intake_profile_shortlist').length;
    await pctx.__s632.profileShortlistRemove('intake-4'); await flush();
    const rem = pcalls().filter((c) => c.command === 'crewing_intake_shortlist_withdraw').slice(-1)[0];
    softOk(!!rem && rem.args.intakeId === 'intake-4' && JSON.stringify(rem.args.pair) === JSON.stringify({ profile_id: 'prof-A', profile_version: 2 }),
      'No.632/4: "remove from the profile" is the EXISTING withdraw of exactly this pair — no other profile is touched');
    softOk(pcalls().filter((c) => c.command === 'crewing_intake_profile_shortlist').length > reads,
      'No.632/4: every write is followed by a re-read from the server, so the screen never shows its own guess');
    softOk(!prow('intake-4'), 'No.632/4: and the removed row is gone because the SERVER no longer lists it');
  } else {
    for (const m of ['hold dispatched', 'release dispatched', 'older version preserved', 'withdraw dispatched', 're-read after every write', 'removed row gone']) softOk(false, 'No.632/4: ' + m);
  }

  // a refusal gets the server's own word, including the one closing the back door
  {
    let refusing = null;
    try { refusing = makeProfileContext({ invokeImpl: (command) => { if (command === 'crewing_intake_shortlist_hold') throw { kind: 'server', status: 403, detail: 'hold_not_permitted' }; } }); await flush(); } catch (e) { refusing = null; }
    if (refusing) { await refusing.__s632.profileShortlistHold('intake-1'); await flush(); }
    softOk(psafe(() => /data-qa="profile-shortlist-action-error"/.test(phtml(refusing))),
      'No.632/4: a refused hold is stated on the screen, not swallowed');
    softOk(psafe(() => /data-qa="profile-shortlist-row" data-intake="intake-1"[\s\S]*?data-qa="profile-shortlist-hold-action"/.test(phtml(refusing))),
      'No.632/4: and the candidate stays exactly where he was — a refusal moves nothing');
  }

  // ---- 5. isolation, and the failure of the list itself ------------------
  {
    let failing = null;
    try { failing = makeProfileContext({ invokeImpl: (command) => { if (command === 'crewing_intake_profile_shortlist') throw { kind: 'server', status: 404, detail: 'matching profile not found' }; } }); await flush(); } catch (e) { failing = null; }
    softOk(psafe(() => /data-qa="profile-shortlist-error"/.test(phtml(failing))),
      'No.632/5: another agency\'s profile answers exactly as an absent one, and the screen says the list could not be read');
    softOk(psafe(() => /data-qa="profile-shortlist-error"/.test(phtml(failing)) && !/data-qa="profile-shortlist-row"/.test(phtml(failing))),
      'No.632/5: and it shows not one row of anybody — calibrated: the section must have rendered its error, so a blank host cannot pass');
    softOk(psafe(() => /data-qa="profile-shortlist-error"/.test(phtml(failing)) && !/data-qa="profile-shortlist-empty"/.test(phtml(failing))),
      'No.632/5: a list that could not be read is NEVER rendered as an empty shortlist — calibrated against the rendered error');
    // TWO guards stand between a failed read and the words "nobody is on this
    // list": the renderer puts the error branch first, AND the state keeps no
    // list at all. A drill that only removes one is held up by the other and
    // proves the survivor — so the second guard is asserted on the STATE, where
    // the renderer cannot cover for it.
    softOk(psafe(() => refusingState(failing).data === null),
      'No.632/5: and the state holds NO list after a failed read — the second guard, drilled apart from the first');
    // calibration: an empty list IS rendered as empty, so the check above is
    // about the failure and not about the renderer being silent in general.
    let emptyCtx = null;
    try {
      const server = makeProfileServer(); server.items = [];
      emptyCtx = makeProfileContext({ server }); await flush();
    } catch (e) { emptyCtx = null; }
    softOk(psafe(() => /data-qa="profile-shortlist-empty"/.test(phtml(emptyCtx))),
      'No.632/5: calibration — a genuinely empty shortlist IS said to be empty');
  }
  if (pctx) {
    const n = pcalls().filter((c) => c.command === 'crewing_intake_profile_shortlist').length;
    await pctx.__s632.profileShortlistLoad('prof-A'); await flush();
    softOk(pcalls().filter((c) => c.command === 'crewing_intake_profile_shortlist').length === n + 1,
      'No.632/5: opening the profile again re-reads the list from the server — that is what survives a restart of the app');
  } else { softOk(false, 'No.632/5: reopening re-reads the list'); }

  // ---- 6. RU/EN for every new word of module 2 ---------------------------
  // `ps_email` is deliberately NOT in this list: "e-mail" is the same word in
  // both languages and the owner-approved frame prints it that way, so it gets
  // its own assertion below instead of a Cyrillic one it could never satisfy.
  for (const key of ['ps_title', 'ps_counts', 'ps_in_selection', 'ps_on_hold', 'ps_hold_note', 'ps_hold', 'ps_release',
    'ps_remove', 'ps_phone', 'ps_email_none', 'ps_email_unknown', 'ps_email_not_usable', 'ps_phone_none',
    'ps_attachments', 'ps_attachments_none', 'ps_copied', 'ps_failed', 'ps_row_failed', 'ps_empty', 'ps_recompare', 'ps_note', 'ps_loading']) {
    const en = psafe(() => makeProfileContext({ language: 'en', autoload: false }).__s632.profileShortlistT(key));
    const ru = psafe(() => makeProfileContext({ language: 'ru', autoload: false }).__s632.profileShortlistT(key));
    softOk(!!en && en !== key, `No.632/6: EN text exists for ${key}`);
    softOk(!!ru && ru !== key && ru !== en && /[Ѐ-ӿ]/.test(ru), `No.632/6: RU text exists for ${key} and is actually Russian`);
  }
  softOk(psafe(() => /\{n\}/.test(makeProfileContext({ language: 'ru', autoload: false }).__s632.profileShortlistT('ps_attachments')))
    && psafe(() => /\{n\}/.test(makeProfileContext({ language: 'en', autoload: false }).__s632.profileShortlistT('ps_attachments'))),
    'No.632/6: both languages carry a COUNT slot for the attachments, so neither can quietly become a yes/no word');
  softOk(psafe(() => makeProfileContext({ language: 'ru', autoload: false }).__s632.profileShortlistT('ps_email') === 'e-mail')
    && psafe(() => makeProfileContext({ language: 'en', autoload: false }).__s632.profileShortlistT('ps_email') === 'e-mail'),
    'No.632/6: ps_email is "e-mail" in both languages — the owner-approved frame prints it that way');

  // ---- 7. a decision taken on the CANDIDATE CARD reaches the profile --------
  // The owner's path is literally: add from the match card, then open the
  // profile. Before this, `profileShortlistEnsure` loaded ONCE per profile, so a
  // section that had already been opened kept answering from the read it did
  // BEFORE the decision — "nobody has been shortlisted" printed over a list that
  // now held him. The fix must be INVALIDATION, not a timer: exactly one extra
  // read, and only because a decision happened.
  softOk(psafe(() => typeof makeProfileContext({ autoload: false }).__s632b.invalidate === 'function'),
    'No.632/7: a shortlist decision has somewhere to say "that cached list is stale"');
  {
    let pc = null;
    try { pc = makeProfileContext({ autoload: false }); pc.renderIntakePilot = () => {}; } catch (e) { pc = null; }
    if (pc) {
      const reads = () => pc.calls.filter((c) => c.command === 'crewing_intake_profile_shortlist').length;
      await pc.__s632.profileShortlistLoad('prof-A'); await flush();
      const before = reads();
      softOk(before > 0 && psafe(() => pc.__s632.profileShortlistStateFor('prof-A').data !== null),
        'No.632/7: calibration — the section really holds a loaded list before the decision');
      // a second open with NO decision in between must not ask again: that is what
      // separates invalidation from polling, and it is asserted BEFORE the decision
      // so a fix that simply reloads on every render fails here.
      psafe(() => pc.__s632b.ensure('prof-A')); await flush();
      softOk(reads() === before,
        'No.632/7: without a decision the section does NOT ask again — invalidation, not polling');
      // the REAL card writer, the one the owner's button is wired to
      pc.state.intakePilot.detail = { intakeId: 'intake-1', generation: 0, attempts: [], attemptSeq: 0,
        pending: false, facts: [], form: null, formError: null };
      await psafe(() => pc.__s632b.confirm('prof-A', 1)); await flush();
      psafe(() => pc.__s632b.ensure('prof-A')); await flush();
      softOk(reads() === before + 1,
        'No.632/7: a decision on the CARD invalidates the profile list and the next open re-reads it — exactly once');
      softOk(psafe(() => pc.__s632.profileShortlistStateFor('prof-A').data !== null),
        'No.632/7: and what it re-read is a LIST, not an error — the invalidation does not leave the section broken');
    } else {
      for (let i = 0; i < 4; i++) softOk(false, 'No.632/7: the card decision reaches the profile list');
    }
  }
  {
    // the same for taking the decision BACK from the card
    let pc2 = null;
    try { pc2 = makeProfileContext({ autoload: false }); pc2.renderIntakePilot = () => {}; } catch (e) { pc2 = null; }
    if (pc2) {
      const reads2 = () => pc2.calls.filter((c) => c.command === 'crewing_intake_profile_shortlist').length;
      await pc2.__s632.profileShortlistLoad('prof-A'); await flush();
      const b2 = reads2();
      pc2.state.intakePilot.detail = { intakeId: 'intake-1', generation: 0, attempts: [], attemptSeq: 0,
        pending: false, facts: [], form: null, formError: null };
      await psafe(() => pc2.__s632b.withdraw('prof-A', 1)); await flush();
      psafe(() => pc2.__s632b.ensure('prof-A')); await flush();
      softOk(reads2() === b2 + 1, 'No.632/7: withdrawing from the card invalidates it too — both writers, not one');
    } else { softOk(false, 'No.632/7: withdrawing from the card invalidates it too'); }
  }
  {
    // a decision about ANOTHER profile must not throw away this one's list
    let pc3 = null;
    try { pc3 = makeProfileContext({ autoload: false }); pc3.renderIntakePilot = () => {}; } catch (e) { pc3 = null; }
    if (pc3) {
      const reads3 = () => pc3.calls.filter((c) => c.command === 'crewing_intake_profile_shortlist').length;
      await pc3.__s632.profileShortlistLoad('prof-A'); await flush();
      const b3 = reads3();
      pc3.state.intakePilot.detail = { intakeId: 'intake-1', generation: 0, attempts: [], attemptSeq: 0,
        pending: false, facts: [], form: null, formError: null };
      await psafe(() => pc3.__s632b.confirm('prof-OTHER', 1)); await flush();
      psafe(() => pc3.__s632b.ensure('prof-A')); await flush();
      softOk(reads3() === b3, 'No.632/7: a decision about a DIFFERENT profile leaves this list alone — the invalidation is keyed, not a broom');
    } else { softOk(false, 'No.632/7: a decision about a different profile leaves this list alone'); }
  }

  // ---- 8. the row names the SAME addressee as the card ----------------------
  // The card's resolver says in its own comment that two copies of the contact
  // order are how "the card and the queue row end up naming two different
  // addressees for one person". The shortlist row WAS the second copy: it read
  // the fact map only, so an address the seafarer delivered WITH HIS RESPONSE
  // was reported on the row as "no e-mail" while the card showed it.
  {
    const mk = (facts, rc) => {
      const srv = makeProfileServer();
      if (facts) srv.facts['intake-1'] = srv.facts['intake-1'].filter((f) => f.field !== 'contact:email');
      srv.responseContacts = rc;
      let c = null;
      try { c = makeProfileContext({ server: srv }); } catch (e) { c = null; }
      return c;
    };
    const delivered = mk(true, { 'intake-1': { value: 'ivan.delivered@example.com', is_email: true, offer_email: true } });
    if (delivered) { await flush(); await flush(); }
    softOk(psafe(() => /data-qa="profile-shortlist-email"[^>]*onclick/.test(prowOf(delivered, 'intake-1'))
      && !/data-qa="profile-shortlist-email"[^>]*disabled/.test(prowOf(delivered, 'intake-1'))),
      'No.632/8: an address the seafarer DELIVERED with his response makes the row\'s e-mail live — the row no longer says "none" over an address the card shows');
    if (delivered) {
      await psafe(() => delivered.__s632.profileShortlistEmail('intake-1')); await flush();
      softOk(delivered.calls.filter((c) => c.command === 'open_mailto').slice(-1)[0]?.args?.to === 'ivan.delivered@example.com',
        'No.632/8: and the letter goes to THAT address, not to a second one resolved by a different order');
    } else { softOk(false, 'No.632/8: the letter goes to the delivered address'); }

    // calibration: a genuine absence must still say so
    const none = mk(true, {});
    if (none) { await flush(); await flush(); }
    softOk(psafe(() => /data-qa="profile-shortlist-email"[^>]*disabled/.test(prowOf(none, 'intake-1'))),
      'No.632/8: calibration — with no fact and no delivered contact the button is dark');

    // a read that FAILED is not an absence (CANON (930) п.1, and the card already
    // says so in words)
    const failed = mk(true, { 'intake-1': 'failed' });
    if (failed) { await flush(); await flush(); }
    softOk(psafe(() => {
      const m = /data-qa="profile-shortlist-email"[^>]*>([^<]*)</.exec(prowOf(failed, 'intake-1') || '');
      return !!m && !/нет|none/i.test(m[1]);
    }), 'No.632/8: a delivered contact that could NOT be read is never printed as "no e-mail"');

    // delivered, but the server refuses to offer it: the address exists and the
    // row must not call that an absence either, and must not write to it
    const refused = mk(true, { 'intake-1': { value: 'crew@our-own-inbox.example', is_email: true, offer_email: false } });
    if (refused) { await flush(); await flush(); }
    softOk(psafe(() => {
      const row = prowOf(refused, 'intake-1') || '';
      const m = /data-qa="profile-shortlist-email"[^>]*>([^<]*)</.exec(row);
      return /data-qa="profile-shortlist-email"[^>]*disabled/.test(row) && !!m && !/нет|none/i.test(m[1]);
    }), 'No.632/8: an address the server will not write to is dark but NOT called absent');
    if (refused) {
      const beforeMail = refused.calls.filter((c) => c.command === 'open_mailto').length;
      await psafe(() => refused.__s632.profileShortlistEmail('intake-1')); await flush();
      softOk(refused.calls.filter((c) => c.command === 'open_mailto').length === beforeMail,
        'No.632/8: and no letter is prepared to it — the anti-loop of No.621 holds on this surface too');
    } else { softOk(false, 'No.632/8: no letter is prepared to a refused address'); }

    // the operator's own correction still outranks the delivered value
    const bothSources = mk(false, { 'intake-1': { value: 'delivered@example.com', is_email: true, offer_email: true } });
    if (bothSources) { await flush(); await flush(); }
    if (bothSources) {
      await psafe(() => bothSources.__s632.profileShortlistEmail('intake-1')); await flush();
      softOk(bothSources.calls.filter((c) => c.command === 'open_mailto').slice(-1)[0]?.args?.to === 'ivan.petrenko@example.com',
        'No.632/8: the operator\'s recorded fact still outranks the delivered value — the CARD\'s order, reused and not restated');
    } else { softOk(false, 'No.632/8: the recorded fact outranks the delivered value'); }
  }
}

// ---------------------------------------------------------------------------
// No.632/5 (OWNER 2026-10-01): the LETTER to the customer.
//
// The operator presses one button, the product builds an .eml with the
// comparison table IN THE BODY and the chosen resumes attached, and the
// OPERATOR'S OWN mail client opens on it. Crewing sends nothing: OWNER (739)
// п.5 and the owner's own word of today — "use the existing mechanism for
// preparing a letter with attachments, WITHOUT server-side sending".
//
// Five constraints, each bought by a finding, and each drilled below:
//   1. sea time is counted for the rank of THIS profile, read out of the career
//      map by EQUALITY — never the number the candidate's own response carried;
//   2. an attachment is not a resume: the operator PICKS the file, and a
//      candidate with no picked file does not go in the letter SILENTLY;
//   3. a candidate set aside is out of the selection, and his absence is said;
//   4. there is no customer address in the data — the operator types it, and it
//      is on screen before the mail client is opened;
//   5. the signature is the AGENCY's; "Skipi Crewing" as the sender would make
//      Skipi the sender of the agency's letter.
// ---------------------------------------------------------------------------
console.log('# No.632/5: the letter to the customer — prepared, never sent');
{
  // ---- the fixture: one profile for Master / Crude Oil Tanker, five people
  //
  // The career maps are the point of the fixture, so each one is a different
  // sentence the letter has to be able to say:
  //   L1 Master in the map AND responded as Master      -> the number
  //   L2 responded as Chief Officer, Master in the map  -> the MASTER number
  //   L3 Master NOT in the map                          -> "not stated", and
  //                                                        NOT the response pair
  //   L4 Master present as a MEASURED ZERO              -> a zero, not "not stated"
  //   L5 lowercase 'master' only                        -> "not stated" (No.622 shut)
  //   L6 set aside                                      -> out of the selection
  //   L7 the two numbers for Master DISAGREE            -> no number at all
  //   L8 no attachments at all                          -> no resume to pick
  function makeLetterServer() {
    const card = (id, name, surname, extra, attachments) => ({
      intake_id: id, receipt_id: 'r-' + id, crewing_id: 'crew-synthetic', source: 'response', source_id: 's-' + id,
      event_id: 'e-' + id, primary_profile_id: null, content_sha256: 'x', content_bytes: 10,
      content_type: 'application/pdf', state: 'ranked', source_trust: 'unverified', version: 1,
      created_at: '2026-10-01T04:00:00', issued_at: '2026-10-01T04:00:00', objects: [],
      attachments: attachments === undefined
        ? [{ ordinal: 0, filename: name + '_CV.pdf', declared_type: 'application/pdf', measured_type: 'application/pdf', byte_size: 1200, verdict: 'accepted', reason: 'clean', eligible: true }]
        : attachments,
      summary: { facts: 0, ranks: 1, ranks_stale: 0, active_confirmations: 1 },
      response_summary: Object.assign({
        rank: 'Master', rank_state: 'from_snapshot', first_name: name, surname: surname,
        age_years: 43, age_precision: 'day', citizenship: 'Ukrainian', citizenship_code: 'UKR',
        experience_rank: 'Master', experience_days: 520, experience_state: 'matches_response_rank',
        experience_days_by_rank: { Master: 520 }, experience_days_for_rank: 520,
        experience_days_for_rank_state: 'from_map',
        last_vessel_name: 'MT Odesa Dawn', last_vessel_sign_off: '2026-07-01',
      }, extra || {}),
    });
    const items = [
      { intake_id: 'L1', on_hold: false, in_selection: true },
      { intake_id: 'L2', on_hold: false, in_selection: true },
      { intake_id: 'L3', on_hold: false, in_selection: true },
      { intake_id: 'L4', on_hold: false, in_selection: true },
      { intake_id: 'L5', on_hold: false, in_selection: true },
      { intake_id: 'L6', on_hold: true, in_selection: false },
      { intake_id: 'L7', on_hold: false, in_selection: true },
      { intake_id: 'L8', on_hold: false, in_selection: true },
    ].map((row, index) => ({
      id: 'dec-' + row.intake_id, intake_id: row.intake_id, profile_version: 2,
      confirmed_by: 'user-op-1', confirmed_at: '2026-10-01T05:0' + index + ':00',
      on_hold: row.on_hold, held_by: row.on_hold ? 'user-op-1' : null,
      held_at: row.on_hold ? '2026-10-01T06:00:00' : null,
      in_selection: row.in_selection, needs_recompare: false,
    }));
    return {
      user: 'user-op-1', profileVersion: 2, profileState: 'active', items,
      // what the opener did, and what the .eml was asked to carry
      prepared: [], downloads: [], openerFails: false, downloadFails: {},
      cards: {
        L1: card('L1', 'Ivan', 'Petrenko'),
        L2: card('L2', 'Petro', 'Shevchuk', {
          rank: 'Chief Officer', experience_rank: 'Chief Officer', experience_days: 999,
          experience_state: 'matches_response_rank',
          experience_days_by_rank: { Master: 365, 'Chief Officer': 999 },
          experience_days_for_rank: 999, experience_days_for_rank_state: 'from_map',
        }),
        L3: card('L3', 'Mykola', 'Kravets', {
          rank: 'Chief Officer', experience_rank: 'Chief Officer', experience_days: 888,
          experience_days_by_rank: { 'Chief Officer': 888 },
          experience_days_for_rank: 888, experience_days_for_rank_state: 'from_map',
        }),
        L4: card('L4', 'Taras', 'Bondar', {
          experience_days: 0, experience_days_by_rank: { Master: 0 },
          experience_days_for_rank: 0, experience_days_for_rank_state: 'from_map',
        }),
        L5: card('L5', 'Yurii', 'Lysenko', {
          experience_days_by_rank: { master: 700 },
          experience_days_for_rank: null, experience_days_for_rank_state: 'rank_not_in_map',
        }),
        L6: card('L6', 'Oleh', 'Marchenko'),
        L7: card('L7', 'Dmytro', 'Sydorenko', {
          experience_days: 548, experience_days_by_rank: { Master: 365 },
          experience_days_for_rank: null,
          experience_days_for_rank_state: 'disagrees_with_response_pair',
        }),
        L8: card('L8', 'Serhii', 'Tkachuk', undefined, []),
      },
      facts: {},
      reject(status, detail) { return { kind: 'server', status, detail }; },
      handle(command, args) {
        const b = this;
        switch (command) {
          case 'crewing_intake_profile_shortlist': {
            if (args.profileId !== 'prof-A') throw b.reject(404, 'matching profile not found');
            return {
              profile_id: 'prof-A', profile_version: b.profileVersion, profile_state: b.profileState,
              items: b.items.map((i) => ({ ...i })),
              counts: {
                selected: b.items.length,
                in_selection: b.items.filter((i) => i.in_selection).length,
                on_hold: b.items.filter((i) => i.on_hold).length,
              },
            };
          }
          case 'crewing_intake_candidate_get': {
            const found = b.cards[args.intakeId];
            if (!found) throw b.reject(500, null);
            return JSON.parse(JSON.stringify(found));
          }
          case 'crewing_intake_fact_list': return { items: (b.facts[args.intakeId] || []).map((r) => ({ ...r })) };
          case 'crewing_intake_response_contact': throw b.reject(404, 'candidate intake not found');
          case 'crewing_intake_attachment_download': {
            if (b.downloadFails[args.intakeId]) throw b.reject(404, 'not_found');
            b.downloads.push({ intakeId: args.intakeId, ordinal: args.ordinal });
            return { path: '/home/op/Downloads/Skipi/Crewing/' + args.intakeId + '/attachment-' + args.ordinal + '.pdf', bytes: 1200, sha256: 'deadbeef' };
          }
          case 'crewing_customer_letter_prepare': {
            b.prepared.push(JSON.parse(JSON.stringify(args)));
            if (b.openerFails) {
              return { path: '/home/op/Downloads/Skipi/Crewing/Letters/letter.eml', bytes: 4096, sha256: 'ab', opened: false, open_error: 'cannot_open_file' };
            }
            return { path: '/home/op/Downloads/Skipi/Crewing/Letters/letter.eml', bytes: 4096, sha256: 'ab', opened: true, open_error: null };
          }
          case 'open_mailto': return null;
          default: throw new Error(`unexpected invoke ${command}`);
        }
      },
    };
  }

  async function letterContext(opts = {}) {
    const server = opts.server || makeLetterServer();
    const ctx = makeProfileContext({
      server,
      language: opts.language || 'ru',
      profileId: 'prof-A',
    });
    // the profile the letter is FOR: its rank is what the sea-time column counts
    // No `version` here ON PURPOSE: the object this screen actually holds comes
    // from the legacy /api/compliance-profiles route and has no such field. The
    // stand printed "версия )" into a letter for a customer because the fixture
    // had one and the product did not.
    ctx.state.selectedComplianceProfile = Object.assign({
      id: 'prof-A', name: 'Master — Crude Oil Tanker', status: 'active',
      rank: 'Master', vessel_type: 'Crude Oil Tanker',
    }, opts.profile || {});
    ctx.state.settings.company_name = opts.company === undefined ? 'Marlow Crewing Ltd' : opts.company;
    if (opts.webShell) ctx.window.__SKIPI_WEB_SHELL__ = true;
    await flush();
    // the host is re-rendered so the letter block sees the profile fields above
    psafeL(() => ctx.__s632.profileShortlistRerender());
    return ctx;
  }
  const psafeL = (fn) => { try { const v = fn(); return v === undefined ? false : v; } catch (e) { return false; } };
  const lhtml = (c) => (c ? c.nodes.get('profile-shortlist-host').innerHTML : '');
  const lfn = (c, name) => (c && c.__s632c ? c.__s632c[name] : null);
  const segment = (c, qa, key, attr = 'data-intake') => lhtml(c).split(`data-qa="${qa}"`).slice(1)
    .find((part) => part.startsWith(` ${attr}="${key}"`)) || null;
  const bodyText = (c) => {
    const m = /data-qa="profile-letter-body"[^>]*>([\s\S]*?)<\/pre>/.exec(lhtml(c));
    return m ? m[1] : '';
  };
  // Picking a resume is the operator's explicit act; this is that act, for the
  // people the test wants in the letter.
  async function pick(c, ids) {
    for (const id of ids) {
      const fn = lfn(c, 'pick');
      if (!fn) return false;
      await psafeL(() => fn(id, 0));
      await flush();
    }
    return true;
  }
  async function typeAddress(c, value) {
    const fn = lfn(c, 'setTo');
    if (!fn) return false;
    await psafeL(() => fn(value));
    await flush();
    return true;
  }

  let L = null;
  try { L = await letterContext(); } catch (e) { L = null; }

  // ---- 5.1 the block exists, and it is a PREPARATION, not a send ----------
  softOk(psafeL(() => /data-qa="profile-letter"/.test(lhtml(L))),
    'No.632/5.1: the profile screen carries the "prepare a letter for the customer" block');
  softOk(psafeL(() => typeof lfn(L, 'prepare') === 'function'),
    'No.632/5.1: preparing the letter is a function of the block, reachable from the screen');
  // The owner's word, as a sensor: the button says what it DOES.
  softOk(psafeL(() => {
    const m = /data-qa="profile-letter-prepare"[^>]*>([^<]*)</.exec(lhtml(L));
    return !!m && /Подготовить письмо/.test(m[1]);
  }), 'No.632/5.1: the button is called "Подготовить письмо" — not "Отправить", because the operator sends it');
  softOk(psafeL(() => /data-qa="profile-letter-prepare"/.test(lhtml(L)) && !/Отправить заказчику/.test(lhtml(L))),
    'No.632/5.1: nothing on the screen promises that Crewing sends the letter — calibrated: the button must be RENDERED, so an empty host cannot pass this');
  softOk(s632Source !== '' && !/invoke\(\s*['"]send_mail['"]/.test(s632Source),
    'No.632/5.1 (PRESERVE sentinel, green on the base too): the block never calls send_mail — the door the owner closed stays closed');
  softOk(s632Source !== '' && !/smtp|sendmail|mail_accounts/i.test(s632Source),
    'No.632/5.1 (PRESERVE sentinel, green on the base too): and it names no server-side mail transport at all');

  // ---- 5.2 the address: it is not in the data, so the operator types it ----
  softOk(psafeL(() => /data-qa="profile-letter-to"/.test(lhtml(L))),
    'No.632/5.2: there is a field for the customer address — the profile carries only a NAME, never an address');
  softOk(psafeL(() => /data-qa="profile-letter-prepare"[^>]*disabled/.test(lhtml(L))),
    'No.632/5.2: with no address typed the button is dark — calibrated below by the same button going live');
  softOk(psafeL(() => {
    const m = /data-qa="profile-letter-to-state"[^>]*>([^<]*)</.exec(lhtml(L));
    return !!m && m[1].trim() !== '';
  }), 'No.632/5.2: and it SAYS what is missing instead of being silently unusable');
  if (L) {
    await typeAddress(L, 'not-an-address');
    softOk(psafeL(() => /data-qa="profile-letter-prepare"[^>]*disabled/.test(lhtml(L))),
      'No.632/5.2: an address the mail client would refuse keeps the button dark');
    await typeAddress(L, 'crewing@oceanic.example.com');
    softOk(psafeL(() => /data-qa="profile-letter-to"[^>]*value="crewing@oceanic\.example\.com"/.test(lhtml(L))),
      'No.632/5.2: the typed address is ON SCREEN before any mail client is opened');
  } else { softOk(false, 'No.632/5.2: address refusal'); softOk(false, 'No.632/5.2: address visible'); }

  // ---- 5.2b typing an address must SURVIVE the re-render -----------------
  //
  // Found live on the stand, not here: the section repaints on every keystroke,
  // the repaint replaces the <input> the operator is typing into, focus is lost
  // and only the FIRST character of the address ever arrives. A test that calls
  // the setter directly — as every check above does — cannot see that, because
  // the setter is not the keyboard.
  if (L) {
    const beforeFocus = (L.nodes.get('__to_input') || {}).focused || 0;
    await typeAddress(L, 'crewing@oceanic.example.com');
    const input = L.nodes.get('__to_input');
    softOk(!!input && input.focused > beforeFocus,
      'No.632/5.2b: after the section repaints, the address field is focused again — otherwise the operator types one character and loses the field');
    softOk(!!input && Array.isArray(input.caret) && input.caret.length > 0,
      'No.632/5.2b: and the caret is put back where it was, so the address is not typed backwards');
  } else { softOk(false, 'No.632/5.2b: focus survives the repaint'); softOk(false, 'No.632/5.2b: caret restored'); }

  // ---- 5.3 the resume is PICKED. An attachment is not a resume ------------
  softOk(psafeL(() => !!segment(L, 'profile-letter-pick-row', 'L1')),
    'No.632/5.3: every candidate in the selection offers his files for the operator to pick the resume from');
  softOk(psafeL(() => /data-qa="profile-letter-pick"[^>]*data-ordinal="0"/.test(segment(L, 'profile-letter-pick-row', 'L1') || '')),
    'No.632/5.3: the pick names the FILE, by the ordinal the byte route is asked for');
  // Structural, not a prose filter: the first version of this check searched the
  // block for words like "recognise" and was promptly tripped by a COMMENT saying
  // there is no recogniser. What carries the owner's rule is that a pick is
  // recorded in exactly ONE place, and that place is the operator pressing a
  // button — nothing in the block derives it from a file.
  softOk(s632Source !== '' && (s632Source.match(/ls\.picks\[[a-z]+\] = /g) || []).length === 1,
    'No.632/5.3: a resume is recorded in exactly ONE place — the operator\'s own press; nothing derives it (owner\'s word of 2026-10-01)');
  softOk(s632Source !== '' && !/\b(classifyResume|detectResume|guessResume|isResumeFile|looksLikeCv)\b/.test(s632Source),
    'No.632/5.3: and no classifier of attachments is introduced under any name');
  if (L) {
    const before = L.server.downloads.length;
    await pick(L, ['L1']);
    softOk(L.server.downloads.length === before + 1 && L.server.downloads.slice(-1)[0].intakeId === 'L1',
      'No.632/5.3: picking a file fetches THOSE bytes through the existing audited byte route, not a new channel');
    softOk(psafeL(() => /data-qa="profile-letter-file"[^>]*data-intake="L1"/.test(lhtml(L))),
      'No.632/5.3: and the picked file is listed as an attachment of the letter, before it is built');
  } else { softOk(false, 'No.632/5.3: pick downloads'); softOk(false, 'No.632/5.3: pick listed'); }

  // ---- 5.4 who is IN the letter, and who is NAMED as out -----------------
  if (L) {
    await pick(L, ['L2', 'L3', 'L4', 'L5', 'L7']);
    // L6 is set aside, L8 has no file at all, and nobody picked a file for them
    const inLetter = (id) => !!segment(L, 'profile-letter-file', id);
    softOk(['L1', 'L2', 'L3', 'L4', 'L5', 'L7'].every(inLetter),
      'No.632/5.4: the people with a picked resume are in the letter');
    softOk(inLetter('L1') && !inLetter('L6'),
      'No.632/5.4: the candidate SET ASIDE is not in the letter while the others ARE — in_selection is the server\'s predicate and the screen keeps no second copy of it (calibrated: a letter with nobody in it cannot pass this)');
    softOk(psafeL(() => (segment(L, 'profile-letter-excluded-item', 'L6') || '').length > 0),
      'No.632/5.4: and he is NAMED as left out, with the reason — not silently missing');
    softOk(psafeL(() => /data-reason="on_hold"/.test(segment(L, 'profile-letter-excluded-item', 'L6') || '')),
      'No.632/5.4: the reason given for him is that he was set aside');
    softOk(!inLetter('L8') && psafeL(() => /data-reason="no_attachments"/.test(segment(L, 'profile-letter-excluded-item', 'L8') || '')),
      'No.632/5.4: a candidate with no files at all is left out AND the screen says it is files he lacks');
    // the whole point of the owner's sentence: a missing resume is never silent
    const noPick = await letterContext();
    await typeAddress(noPick, 'crewing@oceanic.example.com');
    softOk(psafeL(() => /data-reason="no_resume_picked"/.test(segment(noPick, 'profile-letter-excluded-item', 'L1') || '')),
      'No.632/5.4: a candidate whose resume nobody picked is left out and SAID so — "не вошли и почему", not a quiet drop');
    softOk(psafeL(() => /data-qa="profile-letter-prepare"[^>]*disabled/.test(lhtml(noPick))),
      'No.632/5.4: and with nobody left to send, the button is dark rather than building an empty letter');
    // The numbers are read EXACTLY, and both of them. A check that only looked for
    // "6" somewhere in this line stayed green under a mutation that printed the
    // size of the whole shortlist (8) beside the six attachments — the envelope
    // carried six while the screen said eight, which is the very thing the line
    // exists to catch.
    softOk(psafeL(() => {
      const m = /data-qa="profile-letter-counts"[^>]*>([^<]*)</.exec(lhtml(L));
      const digits = m ? (m[1].match(/\d+/g) || []) : [];
      return digits.length === 2 && digits[0] === '6' && digits[1] === '6';
    }), 'No.632/5.4: the line says exactly how many candidates are in the letter and how many files it carries — six and six, not the size of the shortlist');
    // TWO guards keep the man who was set aside out of this letter — he is not in
    // the selection AND nobody picked a resume for him (the screen offers no pick
    // for a held row at all). A drill against the first guard would survive on the
    // second, which is exactly the shape that let M5 of the server slice and M4 of
    // the client slice live. So the second guard is REMOVED here: a resume is
    // seeded for him directly, and `in_selection` is then the only thing standing
    // between a held candidate and the customer.
    const seeded = await letterContext();
    await typeAddress(seeded, 'crewing@oceanic.example.com');
    if (seeded && seeded.state.profileLetter) {
      seeded.state.profileLetter.picks.L6 = { ordinal: 0, path: '/home/op/Downloads/Skipi/Crewing/L6/attachment-0.pdf', bytes: 1200 };
      psafeL(() => seeded.__s632.profileShortlistRerender());
    }
    softOk(psafeL(() => !segment(seeded, 'profile-letter-file', 'L6')),
      'No.632/5.4: with a resume ALREADY in hand for him, the man set aside is STILL out of the letter — in_selection alone holds him back');
    softOk(psafeL(() => /data-reason="on_hold"/.test(segment(seeded, 'profile-letter-excluded-item', 'L6') || '')),
      'No.632/5.4: and the reason stays "set aside" rather than turning into "no resume" (calibration of the check above)');
  } else {
    for (let i = 0; i < 8; i += 1) softOk(false, 'No.632/5.4: selection membership (context absent)');
  }

  // ---- 5.5 SEA TIME: the rank of THIS profile, by equality ---------------
  // The costliest cell in the letter: a number counted for another post, sent
  // to a third party over the agency's name.
  if (L) {
    const b = bodyText(L);
    softOk(/Стаж в должности Master/.test(b),
      'No.632/5.5: the column NAMES the post it counts — the post of THIS profile');
    softOk(/1 г\. 5 мес\./.test(b) && !/520/.test(b),
      'No.632/5.5: the figure is rendered by the card\'s own duration helper (1 г. 5 мес.) and the raw day count never appears');
    // L2 responded as Chief Officer with 999 days; the map says Master = 365
    const l2 = /Petro Shevchuk[^\n]*/.exec(b);
    softOk(!!l2 && /1 г\./.test(l2[0]) && !/999/.test(l2[0]) && !/2 г\./.test(l2[0]),
      'No.632/5.5: a candidate who responded for ANOTHER post gets the number of THIS post out of the map — never his response figure');
    // L3 has no Master key at all
    const l3 = /Mykola Kravets[^\n]*/.exec(b);
    softOk(!!l3 && /не указано/.test(l3[0]) && !/888/.test(l3[0]) && !/2 г\./.test(l3[0]),
      'No.632/5.5: a post the map does not name is "не указано" — and the response pair is NOT borrowed for it');
    // L4 is a measured zero
    const l4 = /Taras Bondar[^\n]*/.exec(b);
    softOk(!!l4 && !/не указано/.test(l4[0]) && /0/.test(l4[0]),
      'No.632/5.5: a MEASURED zero is a zero, not "не указано" — `days || "не указано"` is the bug this forbids');
    // L5 has only a lowercase spelling: No.622 is not open here
    const l5 = /Yurii Lysenko[^\n]*/.exec(b);
    softOk(!!l5 && /не указано/.test(l5[0]) && !/700/.test(l5[0]),
      'No.632/5.5: spelling is compared by EQUALITY — "master" is not "Master" (No.622 is not opened here)');
    // L7: two numbers that disagree are not a number
    const l7 = /Dmytro Sydorenko[^\n]*/.exec(b);
    softOk(!!l7 && !/365/.test(l7[0]) && !/548/.test(l7[0]) && !/1 г\./.test(l7[0]),
      'No.632/5.5: when the two figures for this post DISAGREE the letter carries neither of them');
    softOk(psafeL(() => /data-state="disagrees_with_response_pair"/.test(segment(L, 'profile-letter-pick-row', 'L7') || '')),
      'No.632/5.5: and the operator is told WHY that cell is empty, beside the decision (CANON (930) п.1)');
    softOk(psafeL(() => /data-qa="profile-letter-seatime"[^>]*data-intake="L3"[^>]*data-state="rank_not_in_map"/.test(lhtml(L))),
      'No.632/5.5: each cell carries the state it was resolved from, so an absence is never mistaken for a zero');
  } else {
    for (let i = 0; i < 9; i += 1) softOk(false, 'No.632/5.5: sea time (context absent)');
  }

  // ---- 5.6 the body: the owner's own text, the table IN it, agency sign ---
  if (L) {
    const b = bodyText(L);
    softOk(/заказчик/i.test(b), 'No.632/5.6: the letter greets the customer, in the owner\'s own words');
    softOk(/Crude Oil Tanker/.test(b) && /Master/.test(b),
      'No.632/5.6: it names the order — the post and the vessel type of this profile');
    softOk(/Кандидат/.test(b) && /Возраст/.test(b) && /Гражданство/.test(b) && /Последнее судно/.test(b),
      'No.632/5.6: the comparison TABLE is in the body of the letter — the customer sees the comparison at once');
    softOk(/Ivan Petrenko/.test(b) && /43/.test(b) && /Ukrainian/.test(b) && /MT Odesa Dawn/.test(b),
      'No.632/5.6: with the basic data of each candidate the owner asked for');
    softOk(/Marlow Crewing Ltd/.test(b),
      'No.632/5.6: the letter is signed by the AGENCY — it is the agency that sends it from its own client');
    // Found on the stand: an unsubstituted slot went out in the letter itself.
    softOk(!/версия\s*\)/.test(b) && !/version\s*\)/.test(b) && !/\{version\}/.test(b),
      'No.632/5.6: the letter never carries an EMPTY version — the clause is dropped when the number is unknown, not printed hollow');
    softOk(/версия 2/.test(b),
      'No.632/5.6: and when the server named the profile version, the letter names it too (calibration of the check above)');
    softOk(psafeL(() => {
      const m = /data-qa="profile-letter-to-state"[^>]*>([^<]*)</.exec(lhtml(L));
      return !!m && !/резюме/i.test(m[1]);
    }), 'No.632/5.6: the hint under the ADDRESS field talks about the address, not about a resume');
    softOk(/Marlow Crewing Ltd/.test(b) && !/Skipi/.test(b),
      'No.632/5.6: and never by Skipi — calibrated against the agency name actually standing there: a Skipi signature would make Skipi the sender of the agency\'s letter');
    const noCompany = await letterContext({ company: '' });
    await typeAddress(noCompany, 'crewing@oceanic.example.com');
    await pick(noCompany, ['L1']);
    softOk(psafeL(() => /заказчик/i.test(bodyText(noCompany)) && !/Skipi/.test(bodyText(noCompany))),
      'No.632/5.6: with no agency name recorded the signature is ABSENT, never substituted by ours — calibrated: the letter itself must have been composed');
    softOk(psafeL(() => /data-qa="profile-letter-company-missing"/.test(lhtml(noCompany))),
      'No.632/5.6: and the operator is told the agency name is not set, where he can fix it');
  } else {
    for (let i = 0; i < 8; i += 1) softOk(false, 'No.632/5.6: letter body (context absent)');
  }

  // ---- 5.7 ONE composer: what is previewed is what is handed to the bridge -
  if (L) {
    const previewed = bodyText(L);
    const before = L.server.prepared.length;
    await psafeL(() => lfn(L, 'prepare')());
    await flush(); await flush();
    const call = L.server.prepared.slice(-1)[0] || null;
    softOk(L.server.prepared.length === before + 1,
      'No.632/5.7: pressing the button prepares exactly ONE letter');
    softOk(!!call && String((call.intent || {}).to || call.to || '') === 'crewing@oceanic.example.com',
      'No.632/5.7: and it is addressed to what the operator typed and saw');
    const sent = call ? String((call.intent || {}).body || call.body || '') : '';
    const decoded = previewed.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    softOk(sent !== '' && sent === decoded,
      'No.632/5.7: the body handed to the bridge is the body on screen, character for character — one composer, not two');
    const files = call ? ((call.intent || {}).attachments || call.attachments || []) : [];
    softOk(Array.isArray(files) && files.length === 6,
      'No.632/5.7: exactly the picked resumes are attached — the screen says six and the envelope carries six');
    softOk(Array.isArray(files) && files.length === 6 && files.every((f) => /^\/home\/op\/Downloads\/Skipi\/Crewing\//.test(String(f.path || f))),
      'No.632/5.7: and every attachment is a file this app itself saved, by the path the byte route returned (calibrated on the count: `every` over an empty list proves nothing)');
    softOk(Array.isArray(files) && files.length === 6
      && files.every((f) => /\.pdf$/i.test(String(f.name || '')) && !/^attachment-/.test(String(f.name || '')))
      && new Set(files.map((f) => String(f.name || ''))).size === 6,
      'No.632/5.7: the attachment reaching the customer is NAMED for its candidate, and the six names are SIX — not "attachment-0.pdf" six times over');
    softOk(L.server.prepared.length === before + 1 && !L.calls.some((c) => c.command === 'send_mail'),
      'No.632/5.7: nothing was SENT though a letter WAS prepared — the whole chain carries no send_mail (calibrated on the preparation having happened)');
    softOk(psafeL(() => /data-qa="profile-letter-result"/.test(lhtml(L))),
      'No.632/5.7: and the screen says where the draft is, so the operator can find it in his client');
  } else {
    for (let i = 0; i < 8; i += 1) softOk(false, 'No.632/5.7: one composer (context absent)');
  }

  // ---- 5.8 failures are LOUD: the opener, and the bytes -------------------
  {
    const failing = await letterContext();
    if (failing) failing.server.openerFails = true;
    await typeAddress(failing, 'crewing@oceanic.example.com');
    await pick(failing, ['L1']);
    await psafeL(() => lfn(failing, 'prepare')());
    await flush(); await flush();
    softOk(psafeL(() => /data-qa="profile-letter-error"/.test(lhtml(failing))),
      'No.632/5.8: a mail client that did not open is SAID, never swallowed (the one honest defect of the Seafarer original)');
    softOk(psafeL(() => /letter\.eml/.test(lhtml(failing))),
      'No.632/5.8: and the file that WAS written is named, so the work is not lost with the failure');
    const noBytes = await letterContext();
    if (noBytes) noBytes.server.downloadFails = { L1: true };
    await typeAddress(noBytes, 'crewing@oceanic.example.com');
    await pick(noBytes, ['L1']);
    if (noBytes) { await pick(noBytes, ['L2']); }
    softOk(psafeL(() => !!segment(noBytes, 'profile-letter-file', 'L2') && !segment(noBytes, 'profile-letter-file', 'L1')),
      'No.632/5.8: a resume whose bytes could not be fetched is NOT attached, while his neighbour\'s IS — calibrated, so an empty attachment list cannot pass');
    softOk(psafeL(() => /data-reason="no_resume_picked"|data-reason="bytes_failed"/.test(segment(noBytes, 'profile-letter-excluded-item', 'L1') || '')),
      'No.632/5.8: and that candidate is named among those left out, with his own reason');
    softOk(psafeL(() => /data-qa="profile-letter-pick-error"[^>]*data-intake="L1"/.test(lhtml(noBytes))),
      'No.632/5.8: the failure is shown on his own row too, not only in the summary');
  }

  // ---- 5.9 the shell and the archived vacancy ----------------------------
  {
    const web = await letterContext({ webShell: true });
    softOk(psafeL(() => /data-qa="profile-letter-web-note"/.test(lhtml(web))),
      'No.632/5.9: in the browser shell, where this app cannot write files, the block says so');
    softOk(psafeL(() => /data-qa="profile-letter-prepare"[^>]*disabled/.test(lhtml(web))),
      'No.632/5.9: and offers no button that could not work there');
    const archived = await letterContext();
    if (archived) { archived.server.profileState = 'archived'; await psafeL(() => archived.__s632.profileShortlistLoad('prof-A')); await flush(); await flush(); }
    softOk(psafeL(() => /data-qa="profile-letter-archived"/.test(lhtml(archived))),
      'No.632/5.9: an ARCHIVED vacancy is flagged beside the button — the operator decides, but he is not kept in the dark');
  }

  // ---- 5.10 RU and EN, both complete -------------------------------------
  {
    const keys = ['pl_title', 'pl_to', 'pl_to_empty', 'pl_to_bad', 'pl_subject', 'pl_greeting', 'pl_order',
      'pl_table_candidate', 'pl_table_age', 'pl_table_citizenship', 'pl_table_seatime', 'pl_table_vessel',
      'pl_attached_note', 'pl_sign', 'pl_prepare', 'pl_edit', 'pl_edit_done', 'pl_counts', 'pl_excluded',
      'pl_reason_on_hold', 'pl_reason_no_resume', 'pl_reason_no_attachments', 'pl_reason_bytes', 'pl_reason_row_failed',
      'pl_pick', 'pl_picked', 'pl_unpick', 'pl_not_stated', 'pl_result', 'pl_open_failed', 'pl_company_missing',
      'pl_archived', 'pl_web_note', 'pl_empty', 'pl_seatime_reason', 'pl_order_version', 'pl_to_ok'];
    const ru = (key) => psafeL(() => { L.getUiLang = () => 'ru'; return L.__s632.profileShortlistT(key); });
    const en = (key) => psafeL(() => { L.getUiLang = () => 'en'; return L.__s632.profileShortlistT(key); });
    for (const key of keys) {
      const r = ru(key); const e = en(key);
      softOk(e && e !== key, `No.632/5.10: EN text exists for ${key}`);
      softOk(r && r !== key && r !== e && /[Ѐ-ӿ]/.test(r), `No.632/5.10: RU text exists for ${key} and is actually Russian`);
    }
    // a slot that is not substituted in one language is how a count turns back
    // into a word
    for (const key of ['pl_counts', 'pl_subject', 'pl_order']) {
      const r = ru(key); const e = en(key);
      softOk(/\{/.test(String(r)) && /\{/.test(String(e)), `No.632/5.10: both languages of ${key} carry their slots`);
    }
    if (L) L.getUiLang = () => 'ru';
  }

  // ---- 5.11 the bridge: the three map keys, the guard, the loud opener ----
  //
  // Scoped to the bodies of the new functions on purpose: `base64`, `saved_root`
  // and `let _ =` all already exist in this module, so a file-wide search would
  // be green over a letter builder that does none of it.
  // `fn name<F>(` is a real signature in this module (the opener is passed in as a
  // type parameter), and the first extractor written here missed exactly that —
  // four checks then passed judgement on an EMPTY string. Calibrated below.
  const rbody = (signature) => {
    const m = new RegExp(`fn ${signature}(?:<[^>]*>)?\\(([\\s\\S]*?)\\n\\}`).exec(rust);
    return m ? m[1] : '';
  };
  const letterFn = rbody('crewing_customer_letter_prepare');
  const letterBuild = rbody('build_letter_eml');
  const letterWith = rbody('prepare_letter_with');
  // CALIBRATION of the extractor itself: each body must be non-empty AND must
  // contain something only that function has. Without this, every check below is
  // a verdict about an empty string.
  softOk(letterFn !== '' && letterBuild !== '' && letterWith !== ''
    && /multipart\/mixed/.test(letterBuild) && /opener\(/.test(letterWith) && /saved_root\(\)/.test(letterFn),
    'No.632/5.11: calibration — the three function bodies were actually found (a missed signature would make every check below a verdict about an empty string)');
  for (const field of ['experience_days_by_rank', 'experience_days_for_rank', 'experience_days_for_rank_state']) {
    softOk(new RegExp(`pub ${field}:`).test(rust),
      `No.632/5.11: the bridge DECLARES ${field} — an undeclared key is dropped by serde on the way to the webview`);
  }
  softOk(/pub\(crate\) async fn crewing_customer_letter_prepare\(/.test(rust),
    'No.632/5.11: preparing the .eml is a fixed native command');
  softOk(/crewing_intake::crewing_customer_letter_prepare,/.test(lib),
    'No.632/5.11: and it is registered in the Tauri handler');
  softOk(letterBuild !== '' || letterWith !== '',
    'No.632/5.11: the .eml is built by a function of its own, so a unit test can hold it without a Tauri runtime');
  softOk(/resolved_saved_path\(/.test(letterWith + letterBuild + letterFn),
    'No.632/5.11: every attachment path is resolved INSIDE Downloads/Skipi/Crewing — this is not a "mail any file on this machine" command');
  softOk(/checked_recipient\(/.test(letterWith + letterBuild + letterFn),
    'No.632/5.11: the recipient passes the strict addr-spec check before a single header is written');
  softOk(/BASE64_STANDARD|base64/.test(letterBuild),
    'No.632/5.11: attachments are carried base64, as the Seafarer original does — mailto cannot carry a file');
  softOk(letterWith !== '' && !/let _ = /.test(letterWith),
    'No.632/5.11: the opener result is NOT discarded — the Seafarer original swallows it (`let _ = spawn()`) and that is the defect named in review');
  softOk(/opened/.test(rust) && /pub opened:/.test(rust),
    'No.632/5.11: whether the client actually opened is carried BACK to the screen as a field, not assumed');
  softOk(/opener/.test(letterWith),
    'No.632/5.11: the guard is separated from the opener, so a drill can measure it with the side effect STUBBED');
  softOk(!/send_mail|smtp|sendmail/i.test(rust),
    'No.632/5.11 (PRESERVE sentinel, green on the base too): this module still knows nothing about sending');
}

console.log('\n# control matrix');
for (const row of controlResults) console.log(`  ${row.id} ${row.verdict} clean=${row.cleanBefore} mutantRed=${row.mutantRed} restore=${row.cleanAfter} — ${row.defect}`);
console.log(`\ncrewing_c3b2_candidate_harness: ${failed === 0 ? 'GREEN' : 'RED'} (${passed} passed, ${failed} failed)`);
if (failed !== 0) process.exit(1);
