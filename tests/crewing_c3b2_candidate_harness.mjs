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
// No.664/S3: the receiver of the seafarer base; absent reads as RED below, not as a crash.
const dbRs = fs.existsSync('src-tauri/src/db.rs') ? fs.readFileSync('src-tauri/src/db.rs', 'utf8') : '';

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
// gate ran. The accepted configuration is e8000d75 (K2 route, the K2.1
// single-screen route and the No.664 person-keyed save route widened to all
// eight paths the line touches); the superseded b72a59ca, aa3b2efb and
// 37ff9581 must not be accepted.
ok(/repository: CaptTymur\/skipi-guard\n\s+ref: e8000d757ea387fc29220cbe8a14c6efea7b7fb4\n/.test(workflow), 'the workflow pins exactly the accepted guard SHA (K2 + K2.1 + No.664 routes)');
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
  vm.runInContext(`${c3b1}\n${source}\nthis.__pilot = { pilotEnter, pilotLeave, renderIntakePilot, pilotLoadQueue, pilotOpenCard, pilotCloseCard, pilotCardRefreshAll, pilotCardLoad, pilotFactsLoad, pilotRanksLoad, pilotFactSubmit, pilotFactStartCorrection, pilotRankNow, pilotShortlistConfirm, pilotShortlistWithdraw, pilotCardKeydown, pilotDetail, cardT, PILOT_CARD_TEXT, PILOT_CARD_REFUSAL_TEXT, PILOT_CARD_OUTCOME_TEXT, PILOT_CARD_STALE_TEXT, pilotDraftOpen, pilotDraftProfile, cardDraftProfileId, cardDraftText };`, context);
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
  ok(/data-group="unknown" data-requirement="future:thing"[^<]*Unknown result: future_outcome/.test(rankRow(ctx, 'prof-B', 1)), 'unknown outcome is shown as unknown');
  // No.622 / DECISIONS (954): this line used to assert that a rank row with
  // `primary: true` prints "primary profile". That claim is FALSE and the test is
  // what changes, not the product. The column is the trace of the last run and not
  // a choice anybody made - the client sends no `primary_profile_id`, so every
  // press of "Сопоставить" sets it false on every row (crewing_ranking.py:367) -
  // and its ambiguity was the first reason the preparation of No.622 was BLOCKED.
  // The origin label now comes from `intake.primary_profile_id` off the card
  // receipt, and only a Skipi response may be called a response. This fixture
  // carries no such id, so the honest rendering is NO label at all.
  ok(!/primary profile/.test(rankRow(ctx, 'prof-B', 1)) && !/data-qa="pilot-rank-origin"/.test(rankRow(ctx, 'prof-B', 1)),
    'a legacy primary column alone earns NO origin label (No.622, DECISIONS (954) border 1)');
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
// ---------------------------------------------------------------------------
// No.637/S4 — fixtures shared by the S4 mutation controls below. The controls
// are CALIBRATED BY REMOVAL in the literal sense the card asks for: each one's
// `edits` put the pre-S4 bytes back, and the sensor must go red on them. A
// check that cannot go red is the defect this series has paid for eight times.
// ---------------------------------------------------------------------------
const S4C_UNKNOWN = { applicability: 'unknown', applicability_reason: 'rank_unreadable' };
const S4C_SAME = { applicability: 'same', applicability_reason: null };
const S4C_NA = { applicability: 'not_applicable', applicability_reason: null };
async function s4ControlSetup(ctx, { profiles = 3, verdicts = {}, source = 'skipi_response', chosen = null } = {}) {
  for (let i = ctx.server.profiles.length; i < profiles; i += 1) {
    const letter = String.fromCharCode(65 + i);
    ctx.server.profiles.push({ id: `prof-${letter}`, crewing_id: 'crew-synthetic', name: `Master · ${letter}`, version: 1, state: 'active', rank: 'Master', certs: ['coc_master'] });
  }
  ctx.server.card.source = source;
  ctx.server.card.primary_profile_id = chosen;
  const baseView = ctx.server.ranksView.bind(ctx.server);
  // The shape S1c ships: an `unknown` row carries no figures and no reasons.
  ctx.server.ranksView = () => baseView().map((row) => {
    const v = verdicts[row.profile_id] || S4C_SAME;
    const out = Object.assign({}, row, v);
    if (v.applicability === 'unknown') return Object.assign(out, { met: [], missing: [], unconfirmed: [], reasons: [], decided: false });
    return out;
  });
  await positiveChainUntilRank(ctx);
  return ctx;
}
const s4Section = (html, qa, nextQa) => {
  const s = html.indexOf(`<section class="pilot-card" data-qa="${qa}"`);
  if (s < 0) return '';
  const e = html.indexOf(`<section class="pilot-card" data-qa="${nextQa}"`, s);
  return e < 0 ? html.slice(s) : html.slice(s, e);
};
const s4Before = (src) => { const i = String(src).indexOf('data-qa="pilot-rank-unread"'); return i < 0 ? String(src) : String(src).slice(0, i); };
const s4Inside = (src) => {
  const i = String(src).indexOf('data-qa="pilot-rank-unread"');
  if (i < 0) return '';
  const rest = String(src).slice(i), e = rest.indexOf('</details>');
  return e < 0 ? rest : rest.slice(0, e);
};
const s4Count = (src, re) => (String(src).match(re) || []).length;
async function s4DraftBody(ctx, { skew = false } = {}) {
  if (skew) ctx.__pilot.pilotDetail().ranks.items[0].reasons = [{ requirement: 'rank', outcome: 'missing', wanted: 'Master', found: 'Qwerty' }];
  ctx.__pilot.pilotDraftOpen('intake-A', 'reply');
  await flush();
  const m = main(ctx).match(/data-qa="pilot-draft-body"[^>]*>([\s\S]*?)<\/textarea>/);
  return m ? m[1] : '';
}
async function s4DraftPanel(ctx) {
  ctx.__pilot.pilotDraftOpen('intake-A', 'reply');
  await flush();
  const src = main(ctx), i = src.indexOf('data-qa="pilot-draft"');
  return i < 0 ? '' : src.slice(i);
}
const s4WarnText = (panel) => {
  const m = String(panel).match(/data-qa="pilot-draft-rank-warning"[^>]*>([\s\S]*?)<\/div>/);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
};
// The unread group of one section, so a verdict line is read off the row it
// belongs to and not off the first row in the document.
const s4GroupOf = (src, sectionQa, nextQa) => {
  const i = src.indexOf(`<section class="pilot-card" data-qa="${sectionQa}"`);
  if (i < 0) return '';
  const j = src.indexOf(`<section class="pilot-card" data-qa="${nextQa}"`, i);
  const sec = j < 0 ? src.slice(i) : src.slice(i, j);
  const g = sec.indexOf('data-qa="pilot-rank-unread"');
  if (g < 0) return '';
  const rest = sec.slice(g), e = rest.indexOf('</details>');
  return e < 0 ? rest : rest.slice(0, e);
};
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
  // ===================== No.637/S4 drills (removal-calibrated) =============
  // Each `edits` pair puts the PRE-S4 bytes back. KILLED therefore means: with
  // the fix removed, the check goes red — the one property eight checks in this
  // series turned out not to have.
  {
    id: 'S4-644', defect: 'No.644: the unread row claims there ARE unmet or unconfirmed requirements',
    edits: [["escapeHtml(fit.answer === 'unknown' ? cardT('decided_rank_unknown') : (rank.decided ? cardT('decided_yes') : cardT('decided_no')))",
      "escapeHtml(rank.decided ? cardT('decided_yes') : cardT('decided_no'))"]],
    async sensor(ctx) {
      await s4ControlSetup(ctx, { verdicts: { 'prof-A': S4C_UNKNOWN, 'prof-B': S4C_SAME, 'prof-C': S4C_SAME } });
      const row = s4Inside(s4Section(main(ctx), 'pilot-section-ranks', 'pilot-section-history'));
      const m = row.match(/data-qa="pilot-rank-decided"[^>]*>([\s\S]*?)<\/div>/);
      const text = m ? m[1] : '';
      assert.ok(text.length > 10, 'the unread row still says something about the state of the comparison');
      assert.ok(!/not met or not confirmed/.test(text), 'no claim about requirements nobody compared - got "' + text + '"');
      assert.ok(/not read/.test(text) && /by hand/.test(text), 'the honest sentence and the next action - got "' + text + '"');
    },
  },
  {
    id: 'S4-642a', defect: 'No.642: twenty identical cards loose on the main screen again',
    edits: [["    if (cardApplicability(row).answer === 'unknown') { unread.push(row); return; }\n", ""]],
    async sensor(ctx) {
      await s4ControlSetup(ctx, { profiles: 20, verdicts: Object.fromEntries(Array.from({ length: 20 }, (_, i) => ['prof-' + String.fromCharCode(65 + i), S4C_UNKNOWN])), source: 'inbound' });
      const fit = s4Section(main(ctx), 'pilot-section-fit', 'pilot-section-source');
      const ranks = s4Section(main(ctx), 'pilot-section-ranks', 'pilot-section-history');
      assert.equal(s4Count(s4Before(fit), /data-qa="pilot-fit-card"/g), 0, 'no loose copies on the main screen');
      assert.equal(s4Count(s4Before(ranks), /data-qa="pilot-rank-row"/g), 0, 'and none in the detailed section either');
      assert.equal(s4Count(s4Inside(fit), /data-qa="pilot-fit-card"/g), 20, 'all twenty are inside the one block');
    },
  },
  {
    id: 'S4-642b', defect: "No.642 tidied the screen by DROPPING the people (the owner's standing refusal)",
    edits: [["    if (cardApplicability(row).answer === 'unknown') { unread.push(row); return; }",
      "    if (cardApplicability(row).answer === 'unknown') { return; }"]],
    async sensor(ctx) {
      await s4ControlSetup(ctx, { profiles: 20, verdicts: Object.fromEntries(Array.from({ length: 20 }, (_, i) => ['prof-' + String.fromCharCode(65 + i), S4C_UNKNOWN])), source: 'inbound' });
      const fit = s4Section(main(ctx), 'pilot-section-fit', 'pilot-section-source');
      const ranks = s4Section(main(ctx), 'pilot-section-ranks', 'pilot-section-history');
      for (let i = 0; i < 20; i += 1) {
        const id = 'prof-' + String.fromCharCode(65 + i);
        assert.ok(s4Inside(fit).includes('data-profile="' + id + '"'), id + ' is still NAMED on the screen');
      }
      assert.equal(s4Count(s4Inside(ranks), /data-qa="pilot-confirm"/g), 20, 'and each of them is still reachable by the shortlist button');
    },
  },
  {
    id: 'S4-642c', defect: 'PRESERVE (S2/975 p.5): the vacancy he responded to folded away with the rest',
    edits: [["    if (originId && id === originId) { shown.push(row); return; }\n", ""]],
    async sensor(ctx) {
      await s4ControlSetup(ctx, { profiles: 20, verdicts: Object.fromEntries(Array.from({ length: 20 }, (_, i) => ['prof-' + String.fromCharCode(65 + i), S4C_UNKNOWN])), source: 'skipi_response', chosen: 'prof-A' });
      const fit = s4Section(main(ctx), 'pilot-section-fit', 'pilot-section-source');
      assert.ok(/data-qa="pilot-fit-card" data-profile="prof-A"/.test(s4Before(fit)), 'his own vacancy is the headline card, unfolded');
      assert.equal(s4Count(s4Before(fit), /data-qa="pilot-fit-card"/g), 1, 'and exactly his own stands loose');
      assert.ok(/data-qa="pilot-fit-confirm"[^>]*onclick="pilotShortlistConfirm\('prof-A',1\)"/.test(s4Before(fit)), 'with the button wired to his own pair');
    },
  },
  {
    id: 'S4-650', defect: 'No.650: the draft walks past the vacancy he responded to',
    edits: [["  var chosen = cardChosenProfileId();\n  if (chosen) return chosen;\n", ""]],
    async sensor(ctx) {
      await s4ControlSetup(ctx, { verdicts: { 'prof-A': S4C_NA, 'prof-B': S4C_NA, 'prof-C': S4C_SAME }, source: 'skipi_response', chosen: 'prof-A' });
      assert.equal(ctx.__pilot.cardDraftProfileId(), 'prof-A', 'the draft defaults to his own vacancy');
      const body = await s4DraftBody(ctx);
      assert.ok(/Master · A/.test(body), 'the RENDERED letter names it - got "' + body.replace(/\s+/g, ' ').slice(0, 130) + '"');
      assert.ok(!/Master · C/.test(body), 'and not the one the client picked for him');
    },
  },
  {
    id: 'S4-647a', defect: 'No.647: a payload that still carries reasons puts an unread post into the letter',
    edits: [["    if (cardApplicability(ranks[i]).answer === 'unknown') return [];\n", ""]],
    async sensor(ctx) {
      await s4ControlSetup(ctx, { verdicts: { 'prof-A': S4C_UNKNOWN, 'prof-B': S4C_UNKNOWN, 'prof-C': S4C_UNKNOWN }, source: 'skipi_response', chosen: 'prof-A' });
      const body = await s4DraftBody(ctx, { skew: true });
      assert.ok(!/an opening for/.test(body), 'no post is named when none was read - got "' + body.replace(/\s+/g, ' ').slice(0, 140) + '"');
      assert.ok(/an opening that may fit your documents/.test(body), 'and the hedged sentence stands instead');
    },
  },
  {
    id: 'S4-647b', defect: 'No.647: the two offer sentences swapped (branch A silent, branch B inventing a post)',
    edits: [["  lines.push((rank ? cardT('draft_offer_rank').replace('{rank}', rank) : cardT('draft_offer'))",
      "  lines.push((rank ? cardT('draft_offer') : cardT('draft_offer_rank').replace('{rank}', 'Master'))"]],
    async sensor(ctx) {
      await s4ControlSetup(ctx, { verdicts: { 'prof-A': S4C_SAME, 'prof-B': S4C_UNKNOWN, 'prof-C': S4C_SAME }, source: 'skipi_response', chosen: 'prof-A' });
      const read = await s4DraftBody(ctx);
      assert.ok(/an opening for Master/.test(read), 'branch A: the post WAS read, so the letter names it - got "' + read.replace(/\s+/g, ' ').slice(0, 140) + '"');
      ctx.__pilot.pilotDraftProfile('prof-B');
      await flush();
      const m = main(ctx).match(/data-qa="pilot-draft-body"[^>]*>([\s\S]*?)<\/textarea>/);
      const unread = m ? m[1] : '';
      assert.ok(!/an opening for/.test(unread), 'branch B: the post was NOT read, so none is named - got "' + unread.replace(/\s+/g, ' ').slice(0, 140) + '"');
      assert.ok(/an opening that may fit your documents/.test(unread), 'branch B: and the hedged sentence stands instead');
    },
  },
  {
    id: 'S4-PCT', defect: 'PRESERVE (939/975): a figure reappears on an unread post once the rows are grouped',
    edits: [["  if (row.applicability === 'unknown') { out.reason = 'rank_unknown'; return out; }\n", ""]],
    async sensor(ctx) {
      await s4ControlSetup(ctx, { profiles: 20, verdicts: Object.fromEntries(Array.from({ length: 20 }, (_, i) => ['prof-' + String.fromCharCode(65 + i), S4C_UNKNOWN])), source: 'inbound' });
      // THE SKEW, deliberately: a payload whose verdict says the post was never
      // read while its counts divide perfectly. On the shipping server S1c
      // empties them, so without this the client guard could be deleted and
      // nothing would go red - the exact "check that cannot redden" this card
      // was written against.
      ctx.__pilot.pilotDetail().ranks.items.forEach((r) => {
        r.met = ['rank']; r.missing = []; r.unconfirmed = [];
        r.reasons = [{ requirement: 'rank', outcome: 'met', wanted: 'Master', found: 'Master' }];
      });
      ctx.__pilot.renderIntakePilot();
      const fit = s4Section(main(ctx), 'pilot-section-fit', 'pilot-section-source');
      assert.ok(!/data-pct="\d/.test(s4Inside(fit)), 'not one percentage inside the block');
      assert.ok(!/%/.test(s4Inside(fit)), 'and not a per-cent sign either');
      assert.ok(!/checks met, by the stored evaluation/.test(s4Inside(fit)), 'nor the caption, which is the same claim in words');
    },
  },
  {
    id: 'S4b-WARN', defect: 'No.637/S4b: the draft sends an offer against a rank that did not pass, with nothing said beside the button',
    edits: [["    + rankWarning\n", ""]],
    async sensor(ctx) {
      await s4ControlSetup(ctx, { verdicts: { 'prof-A': S4C_NA, 'prof-B': S4C_NA, 'prof-C': S4C_SAME }, source: 'skipi_response', chosen: 'prof-A' });
      const panel = await s4DraftPanel(ctx);
      assert.ok(/data-qa="pilot-draft-rank-warning"/.test(panel), 'the warning stands in the draft panel');
      assert.ok(/check before sending/.test(s4WarnText(panel)), 'and names the action before the press - got "' + s4WarnText(panel) + '"');
      assert.ok(panel.indexOf('pilot-draft-rank-warning') > panel.indexOf('pilot-draft-body'),
        'between the letter and the control that sends it');
      // It WARNS and does not block: the letter and the way out stay.
      assert.ok(/data-qa="pilot-draft-body"/.test(panel), 'the letter itself is untouched by the warning');
    },
  },
  {
    id: 'S4b-WORD', defect: 'No.637/S4b: two words for one state back on the same screen',
    edits: [["  unknown:['должность не прочитана', 'the rank was not read'],",
      "  unknown:['должность не установлена', 'the rank could not be established'],"]],
    async sensor(ctx) {
      await s4ControlSetup(ctx, { verdicts: { 'prof-A': S4C_UNKNOWN, 'prof-B': S4C_UNKNOWN, 'prof-C': S4C_SAME }, source: 'inbound' });
      for (const language of ['en', 'ru']) {
        ctx.setLang(language);
        ctx.__pilot.renderIntakePilot();
        const src = main(ctx);
        const fitGroup = s4GroupOf(src, 'pilot-section-fit', 'pilot-section-source');
        const ranksGroup = s4GroupOf(src, 'pilot-section-ranks', 'pilot-section-history');
        assert.ok(/data-profile="prof-A"/.test(fitGroup) && !/data-profile="prof-C"/.test(fitGroup),
          '[' + language + '] calibration: the scope holds the unread rows and not the applicable one');
        const want = language === 'ru' ? /не прочитана/ : /was not read/;
        const old = language === 'ru' ? /не установлена/ : /not be established/;
        for (const [name, re] of [['fit card', /data-qa="pilot-fit-applicability"[^>]*>([\s\S]*?)<\/div>/], ['detailed row', /data-qa="pilot-rank-applicability"[^>]*>([\s\S]*?)<\/span>/]]) {
          const text = ((name === 'fit card' ? fitGroup : ranksGroup).match(re) || [])[1] || '';
          assert.ok(text.length > 5, '[' + language + '] the ' + name + ' verdict line was found');
          assert.ok(want.test(text), '[' + language + '] the ' + name + ' uses the one word - got "' + text + '"');
          assert.ok(!old.test(text), '[' + language + '] and not the old one - got "' + text + '"');
        }
      }
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
  // ===================== No.637/S7 drills (removal-calibrated) =============
  // Each `edits` pair puts the PRE-S7 bytes back on the card surface. The row
  // these protect is the one a person RESPONDED to and whose rank does not
  // apply — the only `not_applicable` that reaches a fit card, and the one that
  // printed `0 %` on the stand.
  {
    id: 'S7-PCT', defect: 'No.637/S7: a figure on a profile the rank does not reach (the stand printed 0%)',
    edits: [["  if (row.applicability === 'not_applicable') { out.reason = 'rank_not_applicable'; return out; }\n", ""]],
    async sensor(ctx) {
      await s4ControlSetup(ctx, { verdicts: { 'prof-A': S4C_NA, 'prof-B': S4C_NA, 'prof-C': S4C_SAME }, source: 'skipi_response', chosen: 'prof-A' });
      const card = s7FitCard(main(ctx), 'prof-A');
      assert.ok(card !== '', 'the responded-to card is on the screen at all');
      assert.ok(/data-qa="pilot-fit-pct" data-pct="none"/.test(card), 'no percentage on it - got ' + (card.match(/data-pct="[^"]*"/) || [''])[0]);
      assert.ok(!/%/.test(card), 'and not a per-cent sign anywhere on that card');
      assert.ok(!/checks met, by the stored evaluation/.test(card), 'nor the "M of N checks met" caption, which is the same claim in words');
      assert.ok(!/<div class="cf-bar"/.test(card), 'and no progress bar - a bar is a figure drawn instead of printed');
      // CALIBRATION inside the same render: the applicable card keeps everything.
      const control = s7FitCard(main(ctx), 'prof-C');
      assert.ok(/data-pct="\d+"/.test(control) && /%/.test(control), 'CALIBRATION: the applicable card keeps its figure');
    },
  },
  {
    id: 'S7-COUNTS', defect: 'No.637/S7: «Не выполнено: 1 · Не подтверждено: 0» beside a comparison nobody made',
    edits: [["  var countsHidden = (rank && (String(rank.applicability) === 'unknown' || String(rank.applicability) === 'not_applicable'));",
      "  var countsHidden = (rank && String(rank.applicability) === 'unknown');"]],
    async sensor(ctx) {
      await s4ControlSetup(ctx, { verdicts: { 'prof-A': S4C_NA, 'prof-B': S4C_NA, 'prof-C': S4C_SAME }, source: 'skipi_response', chosen: 'prof-A' });
      const card = s7FitCard(main(ctx), 'prof-A');
      assert.ok(card !== '', 'the responded-to card is on the screen at all');
      assert.ok(!/<div class="cf-counts">/.test(card), 'the counts line is gone with the figure - got ' + (card.match(/<div class="cf-counts">[\s\S]*?<\/div>/) || [''])[0]);
      const control = s7FitCard(main(ctx), 'prof-C');
      assert.ok(/<div class="cf-counts">/.test(control), 'CALIBRATION: the applicable card keeps its counts');
    },
  },
];
// The ONE extractor both S7 controls and the S7 section below read through, so
// a card is never asserted about by reading the rest of the document after it
// (the probe defect No.637/S1b was caught on).
function s7FitCard(html, id) {
  const part = String(html).split('data-qa="pilot-fit-card"').slice(1)
    .find((p) => p.startsWith(` data-profile="${id}"`));
  if (!part) return '';
  const stops = [part.indexOf('data-qa="pilot-rank-unread"'), part.indexOf('data-qa="pilot-withheld"'), part.indexOf('</section>')].filter((i) => i >= 0);
  return stops.length ? part.slice(0, Math.min.apply(null, stops)) : part;
}

// Runner: known-good → mutant → restore. The mutation itself is applied OUTSIDE the
// sensor try: an anchor that does not occur exactly once is a runner failure
// (ANCHOR_MISSING), never a "mutant RED".
// No.637/S7: WHAT killed the mutant, not just that something did. A mutant the
// parser rejects proves the parser; a mutant a ReferenceError kills proves the
// loader. Only an AssertionError proves the assertion the control is written
// for. The field is recorded for every control and printed in the matrix; the
// S7 controls assert on it.
function mutantFailureKind(error) {
  if (!error) return 'none';
  const name = (error && error.name) || '';
  if (error instanceof assert.AssertionError || name === 'AssertionError') return 'assertion';
  if (error instanceof SyntaxError || name === 'SyntaxError') return 'compiler';
  if (name === 'ReferenceError' || name === 'TypeError' || name === 'RangeError') return 'runtime';
  return 'other';
}
async function runControl(control) {
  let cleanBefore = false, mutantRed = false, cleanAfter = false, mutantMessage = '', mutantKind = 'none';
  try { await control.sensor(makeContext()); cleanBefore = true; } catch (error) { mutantMessage = `known-good failed: ${error.message}`; }
  let anchorMissing = false;
  if (cleanBefore) {
    let mutantSource = null;
    const block = control.block === 'c3b1' ? c3b1Source : c3b2Source;
    try { mutantSource = mutate(block, control.edits); } catch (error) { anchorMissing = true; mutantMessage = `ANCHOR_MISSING: ${error.message}`; }
    if (mutantSource !== null) {
      try { await control.sensor(makeContext(control.block === 'c3b1' ? { c3b1: mutantSource } : { source: mutantSource })); mutantMessage = 'mutant survived'; } catch (error) { mutantRed = true; mutantMessage = error.message; mutantKind = mutantFailureKind(error); }
    }
    try { await control.sensor(makeContext()); cleanAfter = true; } catch (error) { mutantMessage += ` / restore failed: ${error.message}`; }
  }
  const verdict = anchorMissing ? 'ANCHOR_MISSING' : (cleanBefore && mutantRed && cleanAfter ? 'KILLED' : 'FAIL');
  return { id: control.id, defect: control.defect, cleanBefore, mutantRed, cleanAfter, anchorMissing, verdict, mutantKind, detail: mutantMessage };
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
  softOk(result.verdict === 'KILLED', `${result.id} ${result.defect}: clean=${result.cleanBefore ? 'GREEN' : 'RED'} mutant=${result.mutantRed ? 'RED' : 'GREEN'}/${result.mutantKind} restore=${result.cleanAfter ? 'GREEN' : 'RED'} (${result.detail.slice(0, 90)})`);
  // No.637/S7: a control whose mutant died of a SyntaxError or a ReferenceError
  // measured the parser, not the product. Named as its own line so it cannot
  // hide inside a KILLED.
  if (result.mutantRed) {
    softOk(result.mutantKind === 'assertion',
      `${result.id}: the mutant died of an ASSERTION, not of the compiler or the loader — got ${result.mutantKind} (${result.detail.slice(0, 70)})`);
  }
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

  // ---- No.714 (OWNER 10.10): the Crew Flow head keeps neither the test-upload
  // button nor the duplicate refresh ---------------------------------------
  // The owner saw two refresh controls and a button promising «Upload a test
  // document» on a screen that uploads nothing. Both leave the HEAD. The entry
  // to `intake_pilot` is NOT deleted — that screen carries the inbound-identifier
  // controls — it moves into the Crew Flow left-panel header beside the refresh
  // the owner kept («the one on the left»), labelled by the existing nav key.
  // The settings menu was measured and rejected: the live shell is the vendored
  // window.SkipiSettings (pinned), and the native renderSettingsModal is only a
  // load-failure fallback, so an entry there would be invisible in practice.
  // The data-qa and the handler stay as they are, and `data-qa` stays BEFORE
  // `onclick` in the same tag: tests/crewing_c3b1_pilot_harness.mjs:24 matches
  // that exact shape and lives outside this change's guard route.
  {
    const fnOf = (head, ...ends) => {
      const a = html.indexOf(head);
      if (a < 0) return '';
      const stops = ends.map((e) => html.indexOf(e, a + 10)).filter((i) => i > 0);
      return stops.length ? html.slice(a, Math.min(...stops)) : '';
    };
    const headFn = fnOf('function crewFlowHeadHtml(mode) {', '\nfunction crewFlowLiveMainHtml');
    const panelFn = fnOf('function renderCrewFlowTree() {', '\nfunction renderCrewFlowTreeBody');
    const mobileFn = fnOf('function crewFlowLiveMobileHtml(mode) {', '\nfunction mobileRenderCrewFlowSignal', '\nfunction crewFlowActionsHtml', '\nfunction ');
    softOk(headFn !== '' && panelFn !== '' && mobileFn !== '',
      'No.714: the three Crew Flow renders are found in dist (head, left panel, mobile)');
    softOk(!/data-qa="crew-flow-open-pilot"/.test(headFn),
      'No.714: the Crew Flow HEAD no longer carries the intake entry');
    softOk(!/data-qa="crew-flow-refresh"/.test(headFn),
      'No.714: the Crew Flow HEAD no longer carries the duplicate refresh');
    softOk(/data-qa="crew-flow-panel-refresh"/.test(panelFn) && (panelFn.match(/crewFlowTr\('refresh_list'\)/g) || []).length === 1,
      'No.714: the refresh the owner kept — the one on the left — is still the panel one, exactly once');
    softOk(/data-qa="crew-flow-open-pilot"[^>]*onclick="crewFlowOpenPilot\(\)"/.test(panelFn),
      'No.714: the intake entry now lives in the left-panel header, wired to crewFlowOpenPilot, data-qa before onclick (the shape crewing_c3b1_pilot_harness.mjs:24 matches)');
    softOk(/tr\('nav\.intake_pilot'\)/.test(panelFn),
      'No.714: the panel entry is labelled by the existing nav.intake_pilot key («Приём кандидатов» / «Intake pilot»), not by crew_flow.open_pilot');
    softOk((headFn.match(/data-qa="crew-flow-refresh"/g) || []).length + (panelFn.match(/data-qa="crew-flow-(panel-)?refresh"/g) || []).length === 1,
      'No.714: the desktop Crew Flow surface offers exactly ONE refresh control — got ' + ((headFn.match(/data-qa="crew-flow-refresh"/g) || []).length + (panelFn.match(/data-qa="crew-flow-(panel-)?refresh"/g) || []).length));
    softOk((mobileFn.match(/data-qa="crew-flow-refresh"/g) || []).length === 1,
      'No.714: the mobile shell KEEPS its refresh — there is no left panel on a phone, it is the only one there');
    softOk(/data-qa="crew-flow-open-pilot"/.test(mobileFn) && /tr\('nav\.intake_pilot'\)/.test(mobileFn) && !/crewFlowTr\('open_pilot'\)/.test(mobileFn),
      'No.714: the mobile entry stays reachable but stops promising a document upload — it is labelled nav.intake_pilot');
    const liveMainFn = fnOf('function crewFlowLiveMainHtml(mode) {', '\nfunction crewFlowLiveMobileHtml');
    const emptyLiveBranch = (liveMainFn.match(/else if \(!crewFlowVisibleLiveRows\(\)\.length\) body = [\s\S]*?;\n/) || [''])[0];
    softOk(/data-qa="crew-flow-open-pilot"[^>]*onclick="crewFlowOpenPilot\(\)"/.test(emptyLiveBranch) && /tr\('nav\.intake_pilot'\)/.test(emptyLiveBranch),
      'No.714: the connected-but-empty body carries the path to intake as well — the operator with zero candidates is not left without a way forward (the gap crewing_crew_flow_demo_harness caught, and no new dictionary key: empty_live already names the inbound identifier)');
    // No.714/N1 (Supervisor note, measured with the stand's font): two full labels
    // did not fit the panel header — 320.5px RU against 252px available at the
    // default 280px width. The refresh keeps its place and shows the glyph with
    // its words in title, and THIS header wraps. What is pinned here is the
    // structure that produces the fit, because a harness reads markup, not layout.
    softOk(/data-qa="crew-flow-panel-refresh"[\s\S]*?\\u21bb<\/button>/.test(panelFn) || /data-qa="crew-flow-panel-refresh"[\s\S]*?\u21bb<\/button>/.test(panelFn),
      'No.714/N1: the panel refresh shows the glyph, not a full label — that is what frees the row for the intake entry');
    softOk(/title="' \+ escapeAttr\(crewFlowTr\('refresh_list'\)\)/.test(panelFn),
      'No.714/N1: and its words are not lost — crew_flow.refresh_list moves into the title, localised in both languages');
    softOk(/class="panel-header" style="[^"]*flex-wrap:wrap/.test(panelFn),
      'No.714/N1: this one header wraps instead of overflowing at narrow widths (RU still needed 224.8px against 192px at the 220px minimum)');
    softOk(/\.panel-header \{ display: flex; align-items: center; justify-content: space-between;/.test(html) && !/\.panel-header \{[^}]*flex-wrap/.test(html),
      'No.714/N1 PRESERVE: the shared .panel-header class is untouched — every other panel in the house keeps its single-line header');
    softOk(html.includes("'crew_flow.open_pilot':") && html.includes("'nav.intake_pilot':"),
      'No.714: the now-unreferenced crew_flow.open_pilot key is LEFT in both dictionaries (card PRESERVE), and nav.intake_pilot is the label source');
  }
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
    // No.664/S3: ordinals whose fetch fails with a server error (one file that did not arrive).
    downloadFails = [],
    // No.664/S3 (Supervisor acceptance, HIGH): ordinals that are zip IMPOSTORS — declared
    // docx, measuring application/zip like every OOXML, but WITHOUT the ECMA-376 members;
    // the server's servable_type answers `bin` for those, and only the server can see it.
    impostors = [],
    // No.621. `undefined` is the server's 404 (this intake carries no binding);
    // an object is the 200 body; `{ __throw: err }` is any OTHER failure, which
    // the screen must not confuse with an absence (N14).
    responseContact,
    // No.664/S2: fields merged INTO the card answer per intake (person_ref,
    // response_summary); `null` makes that card's GET fail (card not loaded).
    // `factRows` replaces the fact list of an intake wholesale.
    cardFields = {}, factRows = {} } = {}) {
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
        if (command === 'crewing_intake_candidate_get') {
          if (cardFields[args.intakeId] === null) throw { kind: 'server', status: 500, detail: null, ambiguous: false };
          const base = srv.items.find((i) => i.intake_id === args.intakeId) || srv.items[0];
          return Object.assign({}, base, cardFields[args.intakeId] || {});
        }
        if (command === 'crewing_intake_fact_list') return { items: factRows[args.intakeId] || srv.facts[args.intakeId] || [] };
        if (command === 'crewing_intake_rank_list') return { items: [], unranked_active_profiles: [{ profile_id: 'p1', name: 'Master · Alpha' }, { profile_id: 'p2', name: 'Master · Beta' }], confirmations: [] };
        if (command === 'crewing_intake_matching_profile_list') return { items: [{ id: 'p1', crewing_id: 'crew-synthetic', name: 'Master · Alpha', version: 1, state: 'active' }, { id: 'p2', crewing_id: 'crew-synthetic', name: 'Master · Beta', version: 1, state: 'active' }] };
        if (command === 'crewing_intake_candidate_rank') {
          timeline.push('invoke:rank');
          return noProfiles
            ? { ranked: 0, written: 0, reason: 'no_active_profiles', profiles: [] }
            : { ranked: 2, written: 2, reason: 'ranked', profiles: ['p1', 'p2'] };
        }
        // No.664/S2: the stub answers with the row the receiver would return — keyed
        // by what was SENT, so the invalidation checks can see which id came back.
        if (command === 'save_seafarer_from_bundle') return { id: (args && args.seafarerUserId) || 'sf-1', display_name: (args && args.applicantSummary && args.applicantSummary.name) || 'Oleh V.', doc_count: 0 };
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
          if (downloadFails.includes(Number(args && args.ordinal))) throw { kind: 'server', status: 500, detail: null, ambiguous: false };
          timeline.push('invoke:attachment_download:' + String(args && args.ordinal));
          // No.664/S3: the server names the copy attachment-<ordinal>.<ext> from the MEASURED
          // type (eml|pdf|docx, anything else bin) under Downloads/Skipi/Crewing/<intake8>/
          // (skipi-server routers/candidate_intake.py, SERVABLE_EXTENSIONS). The stub does the
          // same, so the path the client derives is the one the receiver will read from.
          // servable_type, both branches (skipi-server candidate_intake_service.py): the MEASURED
          // type names it when it is one of the three; otherwise the DECLARED type must be one of
          // the three AND carry the signature the table says it carries — a real .docx is an
          // OOXML and measures as application/zip, and the archive must show the ECMA-376
          // members (impostors here) — else `bin`.
          const cardAtts = ((cardFields[args && args.intakeId] || {}).attachments) || ((srv.items.find((i) => i.intake_id === (args && args.intakeId)) || {}).attachments) || [];
          const att = cardAtts.find((a) => Number(a.ordinal) === Number(args && args.ordinal));
          // No.688/S3c: the server half adds the two image types it measures unambiguously
          // (image/jpeg → jpg, image/png → png); gif/svg and the rest stay `bin`.
          const SERVABLE = { 'application/pdf': 'pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'message/rfc822': 'eml', 'image/jpeg': 'jpg', 'image/png': 'png' };
          let ext = 'pdf';
          if (att) {
            const measured = String(att.measured_type || ''), declared = String(att.declared_type || '').toLowerCase();
            if (SERVABLE[measured]) ext = SERVABLE[measured];
            else if (declared === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && measured === 'application/zip' && !impostors.includes(Number(att.ordinal))) ext = 'docx';
            else ext = 'bin';
          }
          return { path: '/home/op/Downloads/Skipi/Crewing/' + String(args && args.intakeId).slice(0, 8) + '/attachment-' + String(args && args.ordinal) + '.' + ext, bytes: 1024, sha256: 'b'.repeat(64) };
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

  // ===========================================================================
  // No.675 (OWNER (991)/(992), 2026-10-04) on the CARD surfaces.
  //   (991) the no-matches pill is the queue's own grey chip — same class, same
  //         container — and not a bordered object of its own;
  //   (992) «в базе моряков» under the action buttons is the green chip, the same
  //         class the queue row uses, and a reversible mark is not.
  // ===========================================================================
  console.log('\n# No.675: chip classes on the card (grey 991, green 992)');
  {
    const ctx = makeContext();
    ctx.server.card.source = 'skipi_response';
    await openCard(ctx);
    const src = main(ctx);
    const s = src.indexOf('<section class="pilot-card" data-qa="pilot-section-fit"');
    const e = src.indexOf('<section class="pilot-card" data-qa="pilot-section-letter"', s);
    const fit = (s < 0) ? '' : (e < 0 ? src.slice(s) : src.slice(s, e));
    softOk(/<div class="cf-chips" data-qa="pilot-fit-no-matches">/.test(fit),
      '991: the card renders the pill inside the queue\'s own chip container, so one rule paints both surfaces');
    softOk(/<span class="badge" data-qa="pilot-fit-no-matches-pill">/.test(fit),
      '991: and the pill itself is a plain `badge` — no class of its own to carry a border');
    softOk(!/cf-nomatch/.test(src),
      '991: nothing on this card still asks for the retired bordered pill');
  }
  {
    // The actions panel lives in the Crew Flow host, so it is driven in the host
    // sandbox where it actually renders.
    const ctx = makeCrewContext({});
    ctx.__crew.renderCrewFlowView();
    await flush();
    const panel = (id) => String(tryRun(ctx, "crewFlowActionsHtml('" + id + "')") || '');
    ctx.state.crewFlowReadState['intake-1'] = { action: 'saved_to_db', saved_to_db: true, at: '2026-10-04T00:00:00Z' };
    ctx.state.crewFlowReadState['intake-2'] = { action: 'kept_for_later', at: '2026-10-04T00:00:00Z' };
    const saved = panel('intake-1');
    const later = panel('intake-2');
    softOk(/data-qa="crew-flow-actions"/.test(saved),
      '992 CALIBRATION: the actions panel renders at all — the checks below are about a chip, not an empty string');
    softOk(/<span class="badge saved" data-qa="crew-flow-review-state-pill">/.test(saved),
      '992: under the buttons «в базе моряков» is the SAME green chip the queue row carries, not a line of plain text');
    softOk(/<div class="cf-chips" data-qa="crew-flow-review-state">/.test(saved),
      '992: and it sits in the chip container, so it is painted by the chip rule rather than by something new');
    softOk(!/class="badge saved"/.test(later) && /data-qa="crew-flow-review-state"/.test(later),
      '992 CALIBRATION: a reversible mark («отложен») keeps its plain line and never borrows the green');
    // PRESERVE: the irreversible save is still the thing the panel is about.
    softOk(/data-qa="crew-flow-action-save"/.test(saved) && /data-qa="crew-flow-action-match"/.test(saved),
      '992 PRESERVE: the Save and «Сопоставить с профилем» buttons are untouched by the chip');
  }

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
    softOk(!!saveCall && saveCall.args.applicationId === 'intake:intake-1', 'K2-5: "save to seafarers DB" names the intake as the application (source_application_id)');
    softOk(!!saveCall && saveCall.args.applicantSummary && saveCall.args.applicantSummary.rank === 'Master', 'K2-5: the saved applicant summary carries the rank fact');
    // No.664/S2 (OWNER (985)): a card WITHOUT a person key (an older server, a
    // letter) still saves — under the legacy intake: key, and the panel says so.
    softOk(!!saveCall && saveCall.args.manifest && saveCall.args.manifest.exported_by && saveCall.args.manifest.exported_by.messaging_user_id === 'intake:intake-1'
      && saveCall.args.seafarerUserId === 'intake:intake-1',
      'K2-5/U1 → No.664: without person_ref the key is the intake: namespace, explicitly, in both places');
    softOk(/data-qa="crew-flow-person-hint"/.test(saveCtx.nodes.get('main').innerHTML),
      'No.664/S2 Г1: and the panel SAYS the identity is not established (the row may double)');

    // ===== No.664/S2 (OWNER (985)): the save writes the PERSON, not the letter =====
    //
    // What is drilled: the row is keyed by the server's stable person key
    // (`person_ref`, `^PR-[0-9a-f]{16}$`) when the card carries one; the details
    // are the standardised ones (delivered summary first, recorded facts after);
    // the three outcomes stay three (person / intake / unknown); a save without a
    // name is refused out loud and never renames a person into a key; and after a
    // save the seafarer screens are invalidated like the bundle path does.
    console.log('\n# No.664/S2: the save writes the person');
    const PR = 'PR-0123456789abcdef';
    // Own fixtures: the No.621 constants of the same name live further down this file (TDZ).
    const RC664_HAVE = { value: 'delivered-664@example.test', is_email: true, offer_email: true };
    const RC664_PHONE = { value: '+995 555 12 34 56', is_email: false, offer_email: false };
    const PR_B = 'PR-ffffffffffffffff';
    const RS664 = { rank: 'Master', rank_state: 'from_snapshot', first_name: 'Ivan', surname: 'Petrenko', age_years: 43, age_precision: 'day',
      citizenship: 'Ukrainian', citizenship_code: 'UKR', experience_rank: 'Master', experience_days: 520, experience_state: 'in_rank',
      last_vessel_name: 'MT Odesa Dawn', last_vessel_sign_off: '2026-07-01' };
    const openSave = async (opts, intake = 'intake-1', press = true) => {
      const ctx = makeCrewContext(opts);
      ctx.state.seafarers = Array.isArray(opts && opts.seafarers) ? opts.seafarers : [];
      ctx.state.seafarerDocsById = (opts && opts.seafarerDocsById) || {};
      ctx.__crew.renderCrewFlowView(); await flush();
      ctx.__crew.pilotOpenCard(intake); await flush(10);
      if (press) { await tryRun(ctx, "crewFlowSaveToSeafarers('" + intake + "');"); await flush(10); }
      ctx.save = ctx.calls.find((c) => c.command === 'save_seafarer_from_bundle') || null;
      ctx.main = () => ctx.nodes.get('main').innerHTML;
      return ctx;
    };
    const saveBtn = (ctx) => (ctx.main().match(/<button[^>]*data-qa="crew-flow-action-save"[^>]*>/) || [''])[0];
    const k2str = (ctx, key) => vm.runInContext('tr(' + JSON.stringify('crew_flow.' + key) + ')', ctx);

    // ---- bridge: the key must survive serde, or the webview never sees it ----
    softOk(/#\[serde\(default[^\]]*\)\]\s*\n\s*pub person_ref: Option<String>/.test(rust),
      'No.664/S2 bridge: CandidateIntakeReceipt declares person_ref with #[serde(default)] — undeclared, serde drops the key and every test below passes over a client that cannot see it');

    // ---- the pure chooser, drilled without invoke ----------------------------
    {
      const ctx = makeCrewContext({});
      // A missing chooser is a RED line, not a crash that hides every later check.
      const pick = (card, id) => { try { return vm.runInContext('crewFlowPersonIdentity(' + JSON.stringify(card) + ',' + JSON.stringify(id) + ')', ctx); } catch (_) { return null; } };
      softOk(vm.runInContext('typeof crewFlowPersonIdentity', ctx) === 'function',
        'No.664/S2 Г1: the key is chosen by one pure function, crewFlowPersonIdentity(card, intakeId)');
      const a = pick({ person_ref: PR }, 'intake-9');
      softOk(a && a.kind === 'person' && a.id === PR, 'chooser: a well-formed person_ref → kind person, id = the ref');
      const b = pick({ person_ref: null }, 'intake-9');
      softOk(b && b.kind === 'intake' && b.id === 'intake:intake-9', 'chooser: null (a letter without a response) → kind intake, id intake:<id>');
      const c = pick(null, 'intake-9');
      softOk(c && c.kind === 'unknown', 'chooser: no card at all → kind unknown — NOT intake: an unloaded card is not a card without a key (CANON (930) п.1)');
      for (const bad of ['', 'PR-xyz', 'PR-0123456789ABCDEF', 'SKP-SF-TEST-0001', 'intake:intake-9', 'PR-0123456789abcdef0', 12345, {}]) {
        const r = pick({ person_ref: bad }, 'intake-9');
        softOk(r && r.kind === 'intake' && r.id === 'intake:intake-9', 'chooser Г1б: ' + JSON.stringify(bad) + ' is not a key → intake:, never the value itself and never ""');
      }
    }

    // ---- 1. keyed by the person, details from the delivered summary ----------
    {
      const ctx = await openSave({ cardFields: { 'intake-1': { person_ref: PR, response_summary: RS664 } },
        seafarers: [{ id: 'intake:intake-1', display_name: 'intake:intake-1' }, { id: PR_B, display_name: 'B. Other', notes: 'keep' }],
        seafarerDocsById: { [PR]: [{ id: 'stale' }], [PR_B]: [{ id: 'b-doc' }] } });
      softOk(!!ctx.save && ctx.save.args.seafarerUserId === PR,
        'No.664/S2 Г1: the row is keyed by person_ref — seafarerUserId === PR-… — got ' + (ctx.save && JSON.stringify(ctx.save.args.seafarerUserId)));
      softOk(!!ctx.save && ctx.save.args.manifest.exported_by.messaging_user_id === PR, 'Г1: and the manifest names the same key');
      softOk(!!ctx.save && ctx.save.args.applicationId === 'intake:intake-1',
        'Г1а: the application id stays intake:<id> — it is what the receiver reads to retire the legacy intake: row of this very intake');
      const s = ctx.save && ctx.save.args.applicantSummary;
      softOk(!!s && s.name === 'Ivan Petrenko', 'Г2: name = first name + surname of the delivered summary (beats the machine-read fact «Oleh V.») — got ' + (s && JSON.stringify(s.name)));
      softOk(!!s && s.rank === 'Master', 'Г2: rank from the delivered summary (experience_rank — here equal to the post answered)');
      softOk(!!s && s.nationality === 'Ukrainian', 'Г2: nationality = citizenship of the delivered summary — got ' + (s && JSON.stringify(s.nationality)));
      softOk(!!s && s.email === 'oleh@example.test', 'Г2: with no delivered contact (404) the email is the recorded contact:email FACT');
      softOk(!!s && Object.keys(s).sort().join(',') === 'doc_source,email,name,nationality,rank', 'Г2 (+S3): exactly five keys — the four of S2 plus doc_source of S3; no facts.nationality / facts.email ghosts — got ' + (s && Object.keys(s).join(',')));
      softOk(!!ctx.save && ctx.save.args.manifest.exported_by.name === 'Ivan Petrenko' && ctx.save.args.manifest.exported_by.rank === 'Master', 'Г2: manifest.exported_by carries the same name and rank');
      // S2 drew the boundary «no attachments travel in this slice»; S3 (No.664, this card) moves it:
      // the eligible pdf of the default fixture travels as ONE document under <intake8>/attachment-1.pdf.
      softOk(!!ctx.save && ctx.save.args.extractedTo === '/home/op/Downloads/Skipi/Crewing' && ctx.save.args.cvPath === '' && Array.isArray(ctx.save.args.manifest.documents) && ctx.save.args.manifest.documents.length === 1,
        'S3 (was the S2 boundary): the eligible attachment travels — extractedTo = download root, cvPath empty, documents [1] (Г3/Г4 closed here)');
      // invalidation, as the bundle path does it (dist: saveCurrentBundleSeafarer)
      const ids = ctx.state.seafarers.map((r) => r.id);
      softOk(ids.includes(PR) && ctx.state.seafarers.find((r) => r.id === PR).display_name === 'Ivan Petrenko', 'Г2 invalidation: state.seafarers holds the saved row — got [' + ids.join(',') + ']');
      softOk(!ids.includes('intake:intake-1'), 'Г1а invalidation: the legacy intake:<this intake> row leaves the client list too (the receiver retired it in the same transaction)');
      softOk(ids.includes(PR_B) && ctx.state.seafarers.find((r) => r.id === PR_B).notes === 'keep', 'Г1б: the OTHER person’s row is untouched in the client list');
      softOk(ctx.state.selectedSeafarer && ctx.state.selectedSeafarer.id === PR, 'Г2 invalidation: selectedSeafarer is the saved row');
      softOk(!(PR in ctx.state.seafarerDocsById) && Array.isArray(ctx.state.seafarerDocsById[PR_B]), 'Г2 invalidation: seafarerDocsById[saved.id] is dropped, the other person’s cache is not');
      softOk(!/data-qa="crew-flow-person-hint"/.test(ctx.main()), 'Г1: with a stable key the panel carries NO duplication warning');
      softOk(ctx.toasts.some((t) => t[1] === 'success'), 'the operator is told it worked');
      const rs = JSON.parse(ctx.store.get('skipi_crewing_crew_flow_read_state_v2') || '{}');
      softOk(rs['intake-1'] && rs['intake-1'].saved_to_db === true, 'the review state records the save');
      softOk(!JSON.stringify(ctx.state.crewFlowFacts || {}).includes('Ukrainian') && !JSON.stringify(ctx.state.crewFlowFacts || {}).includes('Petrenko'),
        'No.621 N17 stays: nothing of the delivered summary enters crewFlowFactCache');
    }

    // ---- No.695: the «База моряков» tab after a save from Crew Flow ---------
    // Stand finding 07.10 (BACKLOG No.695): with the tab never opened, the save
    // above puts ONE row into the EMPTY client cache, and the tab's reader took
    // «cache non-empty» for «list loaded» — so the operator saw «1 / 1» until ↻.
    // The reader is the subject (Supervisor PREP 08.10, C-D1..C-D8): a flag
    // `state.seafarersLoaded` set ONLY by a successful `list_saved_seafarers`;
    // the writers (Crew Flow, bundle) and the Г2 asserts above stay as they are.
    // The two readers live outside the crew-flow block, so they are installed
    // from the shipped bytes the way the harness already does elsewhere.
    console.log('\n# No.695: the seafarer base after a save from Crew Flow');
    {
      const fnSlice = (head) => {
        const at = html.indexOf(head);
        if (at < 0) return '';
        const ends = ['\nfunction ', '\nasync function '].map((m) => html.indexOf(m, at + 10)).filter((i) => i > 0);
        return ends.length ? html.slice(at, Math.min(...ends)) : '';
      };
      const readerDesktop = fnSlice('async function renderSeafarersTree(opts) {');
      const readerMobile = fnSlice('async function mobileLoadSeafarers(force) {');
      softOk(readerDesktop.includes("invoke('list_saved_seafarers')") && readerMobile.includes("invoke('list_saved_seafarers')"),
        'No.695: both readers (renderSeafarersTree, mobileLoadSeafarers) are found in dist and load through list_saved_seafarers');
      const DB_ROWS = [PR, PR_B, 'sf-3', 'sf-4', 'sf-5', 'sf-6', 'sf-7'].map((id) => ({ id, display_name: id === PR ? 'Ivan Petrenko' : id }));
      // installs the two readers + recording stubs on a crew context; the list
      // answer is programmable (rows, or a thrown error) per call
      const withReaders = (ctx) => {
        for (const id of ['panel-tree', 'mobile-seafarer-list', 'seafarer-filter-controls']) ctx.nodes.set(id, { id, innerHTML: '', style: {} });
        ctx.__paint = [];
        ctx.renderSeafarerFilterControls = () => { ctx.__paint.push('filters'); };
        ctx.renderSeafarersTreeBody = () => { ctx.__paint.push('tree'); };
        ctx.mobilePaintSeafarerList = () => { ctx.__paint.push('mobile'); };
        ctx.__listAnswer = DB_ROWS;
        const base = ctx.invoke;
        ctx.invoke = async (command, args) => {
          if (command === 'list_saved_seafarers') {
            ctx.calls.push({ command, args: null });
            if (ctx.__listAnswer instanceof Error) throw ctx.__listAnswer;
            return ctx.__listAnswer.map((r) => Object.assign({}, r));
          }
          return base(command, args);
        };
        vm.runInContext(readerDesktop + '\n' + readerMobile + '\nthis.__readers = { renderSeafarersTree, mobileLoadSeafarers };', ctx);
        ctx.lists = () => ctx.calls.filter((c) => c.command === 'list_saved_seafarers').length;
        return ctx;
      };
      const SAVE = { cardFields: { 'intake-1': { person_ref: PR, response_summary: RS664 } }, seafarers: [] };

      // C-D1 (failing-first, desktop): the tab was never opened, the cache is
      // empty, the operator saves from Crew Flow, then opens the tab.
      {
        const ctx = withReaders(await openSave(SAVE));
        softOk(ctx.state.seafarers.length === 1 && ctx.state.seafarers[0].id === PR, 'No.695 C-D1 precondition: after the save the empty cache holds exactly the saved row (writer unchanged)');
        await ctx.__readers.renderSeafarersTree(); await flush();
        softOk(ctx.lists() === 1, 'No.695 C-D1 (desktop): opening the tab with a never-loaded cache CALLS list_saved_seafarers — got ' + ctx.lists() + ' call(s)');
        softOk(ctx.state.seafarers.length === DB_ROWS.length, 'No.695 C-D1 (desktop): the tab shows the full base (' + DB_ROWS.length + '), not «1 / 1» — got ' + ctx.state.seafarers.length);
        softOk(ctx.state.seafarersLoaded === true, 'No.695: a successful load sets state.seafarersLoaded');
      }
      // C-D8 (failing-first, mobile): the same door in the mobile shell.
      {
        const ctx = withReaders(await openSave(SAVE));
        await ctx.__readers.mobileLoadSeafarers(false); await flush();
        softOk(ctx.lists() === 1, 'No.695 C-D8 (mobile): the mobile list with a never-loaded cache CALLS list_saved_seafarers — got ' + ctx.lists() + ' call(s)');
        softOk(ctx.state.seafarers.length === DB_ROWS.length && ctx.__paint.includes('mobile'), 'No.695 C-D8 (mobile): the full base is painted — got ' + ctx.state.seafarers.length);
      }
      // C-D2 (preserve): the cache was loaded, then a new person is saved — the
      // tab shows N+1 with NO second round-trip, and the selection is kept.
      {
        const ctx = withReaders(await openSave(SAVE, 'intake-1', false));
        await ctx.__readers.renderSeafarersTree(); await flush();
        const before = ctx.state.seafarers.length;
        ctx.__listAnswer = DB_ROWS.filter((r) => r.id !== PR);
        ctx.state.seafarers = ctx.state.seafarers.filter((r) => r.id !== PR); // the base without this person yet
        await tryRun(ctx, "crewFlowSaveToSeafarers('intake-1');"); await flush(10);
        softOk(before === DB_ROWS.length && ctx.state.seafarers.length === DB_ROWS.length && ctx.state.seafarers[0].id === PR,
          'No.695 C-D2: a loaded cache + a new save = N+1 rows with the saved one first (unshift of the writer, unchanged)');
        await ctx.__readers.renderSeafarersTree(); await flush();
        softOk(ctx.lists() === 1 && ctx.state.seafarers.length === DB_ROWS.length, 'No.695 C-D2: re-opening the tab does NOT reload a loaded cache — still 1 call, still ' + DB_ROWS.length + ' rows');
        softOk(ctx.state.selectedSeafarer && ctx.state.selectedSeafarer.id === PR, 'No.695 C-D2: the selection made by the save is kept');
      }
      // C-D6 (both readers): a failed load must NOT mark the cache loaded — the
      // next opening retries instead of being locked out forever.
      for (const [name, open] of [['desktop', (c) => c.__readers.renderSeafarersTree()], ['mobile', (c) => c.__readers.mobileLoadSeafarers(false)]]) {
        const ctx = withReaders(await openSave(SAVE));
        ctx.__listAnswer = new Error('db locked');
        await open(ctx); await flush();
        softOk(ctx.lists() === 1 && ctx.state.seafarersLoaded !== true && ctx.state.seafarers.length === 1,
          'No.695 C-D6 (' + name + '): a failed list leaves the flag unset and the cache as it was');
        ctx.__listAnswer = DB_ROWS;
        await open(ctx); await flush();
        softOk(ctx.lists() === 2 && ctx.state.seafarers.length === DB_ROWS.length, 'No.695 C-D6 (' + name + '): the next opening retries and shows the full base');
      }
      // C-D7: ↻ (force) still reloads a loaded cache.
      {
        const ctx = withReaders(await openSave(SAVE));
        await ctx.__readers.renderSeafarersTree(); await flush();
        await ctx.__readers.renderSeafarersTree({ force: true }); await flush();
        await ctx.__readers.mobileLoadSeafarers(true); await flush();
        softOk(ctx.lists() === 3, 'No.695 C-D7: force (↻) reloads on both readers — got ' + ctx.lists() + ' calls');
      }
      // C-D3 (static): the only profile switch that does not reload the page
      // (mobile shell, connect dialog) drops the flag, so a base loaded under
      // another profile is not shown as this one's.
      softOk(/state\.seafarersLoaded = false;\n\s*state\.vacancies = \[\];\n\s*if \(isMobileShellActive\(\)\) mobileShow\('crew_flow'\);\n\s*else location\.reload\(\);/.test(html),
        'No.695 C-D3: the connect-dialog switch resets state.seafarersLoaded before the mobile branch that does not reload');
      // C-D6 (static): the flag is set on the success path only, never in the catch.
      const catchDesktop = (readerDesktop.match(/catch\s*\(e\)\s*\{[\s\S]*?\n  \}/) || [''])[0];
      const catchMobile = (readerMobile.match(/catch\s*\(e\)\s*\{[\s\S]*?\n  \}/) || [''])[0];
      softOk(/state\.seafarersLoaded = true/.test(readerDesktop) && /state\.seafarersLoaded = true/.test(readerMobile) && !/seafarersLoaded/.test(catchDesktop) && !/seafarersLoaded/.test(catchMobile),
        'No.695 C-D6 (static): both readers set the flag after the successful list and never inside their catch');
      softOk(/seafarers: \[\],\n(?:\s*\/\/[^\n]*\n)*\s*seafarersLoaded: false,/.test(html), 'No.695: the initial state declares seafarersLoaded: false beside seafarers: []');
    }

    // ---- 1b. THE RANK IS THE PERSON'S, NOT THE VACANCY'S (Counsel STOP, 04.10) --
    // `response_summary.rank` is the rank of the post this response ANSWERED
    // (server: _rank_of_response(snapshot)); `experience_rank` is the rank the
    // seafarer named for their own career. On the stand a Chief Engineer who
    // answered a 2nd Engineer post was filed as «2nd Engineer» and stopped being
    // found by their qualification. The base gets the person's rank; the vacancy
    // goes nowhere in the row — not into `rank`, not into `position` (the seafarer
    // screens read `s.rank || s.position` as one thing: the person's post).
    {
      const CE_ON_2E = Object.assign({}, RS664, { rank: 'Second Engineer', rank_state: 'from_snapshot',
        experience_rank: 'Chief Engineer', experience_days: 900, experience_state: 'other_rank',
        experience_days_by_rank: { 'Chief Engineer': 900, 'Second Engineer': 0 } });
      const ctx = await openSave({ cardFields: { 'intake-1': { person_ref: PR, response_summary: CE_ON_2E } } });
      const s = ctx.save && ctx.save.args.applicantSummary;
      softOk(!!s && s.rank === 'Chief Engineer', 'Г2/rank: the saved rank is the rank the SEAFARER named (experience_rank) — got ' + (s && JSON.stringify(s.rank)));
      softOk(!!ctx.save && ctx.save.args.manifest.exported_by.rank === 'Chief Engineer', 'Г2/rank: and the manifest rank (which the receiver prefers) is the same person’s rank');
      softOk(!!ctx.save && !JSON.stringify(ctx.save.args).includes('Second Engineer'), 'Г2/rank: the rank of the VACANCY answered is nowhere in the payload — not rank, not position');
      softOk(!!ctx.save && !('position' in ctx.save.args.manifest.exported_by) && !('position' in s), 'Г2/rank: position is not written (in the seafarer screens it IS the person’s rank, read as s.rank || s.position)');
      // no experience rank in the summary → the recorded fact (Master in the fixture), never the vacancy
      const noExp = await openSave({ cardFields: { 'intake-1': { person_ref: PR, response_summary: Object.assign({}, CE_ON_2E, { experience_rank: null, experience_days: null, experience_state: 'not_stated', experience_days_by_rank: null }) } } });
      softOk(!!noExp.save && noExp.save.args.applicantSummary.rank === 'Master' && noExp.save.args.manifest.exported_by.rank === 'Master',
        'Г2/rank: without a seafarer-named rank the recorded `rank` FACT fills it — got ' + (noExp.save && JSON.stringify(noExp.save.args.applicantSummary.rank)));
      // and without the fact too → EMPTY, not the vacancy
      const nameOnly = [{ field: 'name', versions: [{ field: 'name', value: 'Oleh V.', version: 1, source_object: 'o1', created_at: '2026-09-24T09:05:00' }] }];
      const bare = await openSave({ cardFields: { 'intake-1': { person_ref: PR, response_summary: Object.assign({}, CE_ON_2E, { experience_rank: null, experience_days: null, experience_state: 'not_stated', experience_days_by_rank: null }) } }, factRows: { 'intake-1': nameOnly } });
      softOk(!!bare.save && bare.save.args.applicantSummary.rank === '' && bare.save.args.manifest.exported_by.rank === '' && !JSON.stringify(bare.save.args).includes('Second Engineer'),
        'Г2/rank: with neither, the rank is EMPTY — an unknown rank is not the rank of the vacancy');
      // static: the helper never reads response_summary.rank
      const helperR = (k2crew.match(/function crewFlowApplicantSummary\([^)]*\) \{[\s\S]*?\n\}/) || [''])[0];
      softOk(helperR !== '' && /experience_rank/.test(helperR) && !/rs\s*&&\s*rs\.rank\b|rs\.rank\b|\.rank\s*\)\s*\|\|/.test(helperR.replace(/experience_rank/g, 'EXPR')),
        'Г2/rank static: the helper reads experience_rank and never response_summary.rank');
    }

    // ---- 2. the delivered contact, by the one named route -------------------
    {
      const have = await openSave({ cardFields: { 'intake-1': { person_ref: PR, response_summary: RS664 } }, contactMode: 'none', responseContact: RC664_HAVE });
      softOk(!!have.save && have.save.args.applicantSummary.email === RC664_HAVE.value, 'Г2: a delivered address (state have + isEmail) is the saved email');
      softOk(!!have.save && JSON.stringify(have.save.args).split(RC664_HAVE.value).length === 2, 'Г2: and it appears ONCE in the payload — applicantSummary.email, nowhere else');
      const phone = await openSave({ cardFields: { 'intake-1': { person_ref: PR, response_summary: RS664 } }, responseContact: RC664_PHONE });
      softOk(!!phone.save && phone.save.args.applicantSummary.email === 'oleh@example.test' && !JSON.stringify(phone.save.args).includes(RC664_PHONE.value),
        'Г2: a delivered contact that is NOT an email is never written as one — the recorded fact is used, the phone goes nowhere');
      const failed = await openSave({ cardFields: { 'intake-1': { person_ref: PR, response_summary: RS664 } }, contactMode: 'none', responseContact: { __throw: { kind: 'server', status: 500, detail: null, ambiguous: false } } });
      softOk(!!failed.save && failed.save.args.applicantSummary.email === '', 'Г2: a contact request that FAILED yields an empty email, not an invented one');
    }

    // ---- 3. the name: operator correction > delivered > machine-read fact ----
    {
      const corrected = [{ field: 'name', versions: [{ field: 'name', value: 'Ivan Petrenko-Sydorenko', version: 2, corrected_by: 'user-op-1', created_at: '2026-09-24T09:09:00' }] },
        { field: 'rank', versions: [{ field: 'rank', value: 'Master', version: 1, source_object: 'o1', created_at: '2026-09-24T09:06:00' }] }];
      const ctx = await openSave({ cardFields: { 'intake-1': { person_ref: PR, response_summary: RS664 } }, factRows: { 'intake-1': corrected } });
      softOk(!!ctx.save && ctx.save.args.applicantSummary.name === 'Ivan Petrenko-Sydorenko',
        'Г2/Б2: an OPERATOR’s correction outranks the delivered name in the database exactly as it does in the heading — the base stores what the operator sees');
      const noSummary = await openSave({ cardFields: { 'intake-1': { person_ref: PR } } });
      softOk(!!noSummary.save && noSummary.save.args.applicantSummary.name === 'Oleh V.' && noSummary.save.args.applicantSummary.nationality === '',
        'Г2: without a delivered summary the recorded facts fill name and rank; nationality stays empty rather than invented');
    }

    // ---- 4. NO NAME: visible refusal, never a person renamed into a key ------
    {
      const nameless = [{ field: 'rank', versions: [{ field: 'rank', value: 'Master', version: 1, source_object: 'o1', created_at: '2026-09-24T09:06:00' }] }];
      for (const lang of ['en', 'ru']) {
        const ctx = await openSave({ language: lang, cardFields: { 'intake-1': { person_ref: PR, response_summary: Object.assign({}, RS664, { first_name: null, surname: '  ' }) } }, factRows: { 'intake-1': nameless } });
        softOk(ctx.save === null, 'Г1б (' + lang + '): a save without any name writes NOTHING — the receiver would have renamed the person into «' + PR + '»');
        const word = k2str(ctx, 'save_no_name');
        softOk(word !== 'crew_flow.save_no_name' && ctx.toasts.some((t) => t[0] === word && t[1] === 'error'), 'Г1б (' + lang + '): the refusal is said in the operator’s words, from the dictionary');
        softOk(/data-qa="crew-flow-name-hint"/.test(ctx.main()) && ctx.main().includes(esc(word)), 'Г1б (' + lang + '): and the same sentence stands in the panel beside the button');
        softOk(/disabled/.test(saveBtn(ctx)), 'Г1б (' + lang + '): the button itself is disabled while there is no name');
        softOk(!ctx.timeline.some((e) => e.startsWith('confirm:')), 'Г1б (' + lang + '): no confirmation dialog is raised for a save that cannot happen');
        const rs = JSON.parse(ctx.store.get('skipi_crewing_crew_flow_read_state_v2') || '{}');
        softOk(!(rs['intake-1'] && rs['intake-1'].saved_to_db), 'Г1б (' + lang + '): nothing is marked as saved');
      }
      // LOW-2 (Supervisor): the heading has FOUR tiers (…, then the name the
      // queue LISTED); a writer with three would say «no name» under a heading
      // that shows one. The listed name is the only one here — it must save.
      const listedOnly = await openSave({ cardFields: { 'intake-1': { person_ref: PR, summary: { state: 'quarantined', facts: 0, ranks: 0, ranks_stale: 0, active_confirmations: 0, needs_review_reason: null, candidate_name: 'Listed Name' } } }, factRows: { 'intake-1': nameless } });
      softOk(/data-qa="pilot-card-name"[^>]*>Listed Name</.test(listedOnly.main()), 'Г1б/LOW-2 calibration: the heading shows the listed name');
      softOk(!!listedOnly.save && listedOnly.save.args.applicantSummary.name === 'Listed Name' && !/data-qa="crew-flow-name-hint"/.test(listedOnly.main()),
        'Г1б/LOW-2: a name the heading shows is a name the save accepts — the writer and the heading read ONE order (pilotCardResolvedName)');
      // calibration: the same facts WITH a delivered name save fine
      const ok1 = await openSave({ cardFields: { 'intake-1': { person_ref: PR, response_summary: RS664 } }, factRows: { 'intake-1': nameless } });
      softOk(!!ok1.save && ok1.save.args.applicantSummary.name === 'Ivan Petrenko' && !/disabled/.test(saveBtn(ok1)) && !/data-qa="crew-flow-name-hint"/.test(ok1.main()),
        'Г1б calibration: with a delivered name the same card saves, the button is live and no name sentence is shown');
    }

    // ---- 5. the duplication warning, RU and EN, and the third state ----------
    {
      for (const lang of ['en', 'ru']) {
        const ctx = await openSave({ language: lang, cardFields: { 'intake-1': { person_ref: null, response_summary: RS664 } } });
        const word = k2str(ctx, 'person_unknown');
        softOk(word !== 'crew_flow.person_unknown' && ctx.main().includes('data-qa="crew-flow-person-hint"') && ctx.main().includes(esc(word)),
          'Г1 (' + lang + '): the panel says, in the dictionary’s words, that the identity is not established and the row may double');
        softOk(!!ctx.save && ctx.save.args.seafarerUserId === 'intake:intake-1', 'Г1 (' + lang + '): and the save still happens — under intake:, by the operator’s decision');
        softOk(!/disabled/.test(saveBtn(ctx)), 'Г1 (' + lang + '): the button stays live — a warning is not a refusal');
      }
      const ru = await openSave({ language: 'ru', cardFields: { 'intake-1': { person_ref: null } } }, 'intake-1', false);
      const en = await openSave({ language: 'en', cardFields: { 'intake-1': { person_ref: null } } }, 'intake-1', false);
      softOk(k2str(ru, 'person_unknown') !== k2str(en, 'person_unknown') && /задво/i.test(k2str(ru, 'person_unknown')) && /duplicat|double/i.test(k2str(en, 'person_unknown')),
        'Г1: RU and EN sentences are two different sentences, each saying the row may double');
      // UNKNOWN is the third state: the card did not load. Nothing is known about
      // the key, so nothing is written under a guess — and no "not established"
      // sentence is shown either (that sentence is an ANSWER).
      const unk = await openSave({ cardFields: { 'intake-1': null } });
      softOk(unk.save === null, 'Г1 unknown: a card that did not load is NOT saved under intake: — an unloaded card is not a card without a key');
      const word = k2str(unk, 'save_card_not_loaded');
      softOk(word !== 'crew_flow.save_card_not_loaded' && unk.toasts.some((t) => t[0] === word), 'Г1 unknown: the operator is told the card has not loaded, in the dictionary’s words');
      softOk(!/data-qa="crew-flow-person-hint"/.test(unk.main()), 'Г1 unknown: and the «not established» sentence is NOT shown for an unloaded card');
    }

    // ---- 6. the KNOWN boundary: one human, two paths, two rows (BACKLOG №667) --
    {
      // The bundle path keys the row by the MESSAGING user id of the application;
      // the Crew Flow path by person_ref. The two namespaces cannot collide, and
      // nothing here joins them: the same human saved by both paths is TWO rows.
      // Documented as the boundary of this card, fixed by №667 (the server knows
      // vault_user_id ↔ public id), not here.
      softOk(/var seafarerId = data\.counterpartId \|\| app\.seafarer_user_id \|\| sUidOf\(app\) \|\| '';/.test(html),
        '№667 boundary: the bundle path still keys by the messaging user id — byte for byte what it was');
      const ctx = makeCrewContext({});
      let r = null;
      try { r = vm.runInContext('crewFlowPersonIdentity({ person_ref: ' + JSON.stringify(PR) + ' }, "intake-1")', ctx); } catch (_) { r = null; }
      softOk(r && r.id === PR && !/^PR-/.test('a1b2c3d4e5f60718') && !/^PR-[0-9a-f]{16}$/.test('demo-sf1'),
        '№667 boundary: the Crew Flow key is PR-…, a messaging id never is — the same person through both paths lands in two rows (known, not closed here)');
      const bundleSave = (html.match(/async function saveCurrentBundleSeafarer\(\) \{[\s\S]*?\n\}/) || [''])[0];
      softOk(bundleSave !== '' && !/person_ref|crewFlowPersonIdentity|intake:/.test(bundleSave),
        '№667 boundary / PRESERVE: the bundle writer knows nothing of person_ref — it is not changed by this card');
    }

    // ---- 7. static: what the writer may and may not read --------------------
    {
      const save = (k2crew.match(/async function crewFlowSaveToSeafarers\(intakeId\) \{[\s\S]*?\n\}/) || [''])[0];
      const helper = (k2crew.match(/function crewFlowApplicantSummary\([^)]*\) \{[\s\S]*?\n\}/) || [''])[0];
      softOk(save !== '' && helper !== '', 'No.664/S2 static: the writer and its details helper are in the Crew Flow block');
      softOk(!/facts\.nationality|facts\.email\b/.test(save + helper), 'Г2 static: the two ghost keys facts.nationality / facts.email are gone');
      softOk(/citizenship/.test(helper) && /pilotCardResolvedName\(/.test(helper) && /first_name/.test(html.match(/function pilotCardPersonName\([^)]*\) \{[\s\S]*?\n\}/)[0]),
        'Г2 static: the helper reads citizenship by its own field name and the name through the card’s own resolver (first_name/surname live in pilotCardPersonName, once)');
      softOk(!/crewFlowFactCache\(\)\[[^\]]*\]\s*=/.test(save + helper), 'No.621 N17 static: neither writes into the fact cache');
      softOk(/crewFlowPersonIdentity\(/.test(save) && !/seafarerUserId: ''/.test(save), 'Г1 static: the writer keys by the chooser and never sends an empty seafarerUserId');
      // LOW-2 static: one order of the name, read by both. The heading and the
      // helper call pilotCardResolvedName; the helper holds no tier chain of its own.
      const heading = (html.match(/function pilotCardIdentityHtml\([^)]*\) \{[\s\S]*?\n\}/) || [''])[0];
      softOk(/pilotCardResolvedName\(/.test(helper) && /pilotCardResolvedName\(/.test(heading) && !/pilotCardNameOrigin|first_name|candidate_name/.test(helper),
        'LOW-2 static: the heading and the writer read the name through pilotCardResolvedName, and the writer keeps no copy of the order');
    }

    // ===== No.664/S3 (OWNER (985)/(986)/(994), DECISIONS (998)): the files travel with the person =====
    //
    // What is drilled, by call site (card «Матрица негативов»): an eligible pdf/docx
    // is fetched through the EXISTING audited byte route and handed to the receiver
    // under `<intake8>/attachment-N.<ext>`; a `bin` (gif, rtf, a zip in disguise) is
    // neither fetched nor placed and is NAMED to the operator; more than 10 files or
    // 64 MiB is refused BEFORE any byte moves and before the question; a second
    // intake of the same person lands in its own sub-folder; a letter's file says
    // `email`, a response's file says `skipi_response`; the Crew Flow writer asks
    // the receiver to MERGE, the bundle writer is byte for byte what it was.
    console.log('\n# No.664/S3: the files travel with the person');
    {
      const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const RESP = { person_ref: PR, response_summary: RS664, source: 'skipi_response' };
      const pdfAtt = (ordinal, filename, byte_size = 210000) => ({ ordinal, filename, declared_type: 'application/pdf', measured_type: 'application/pdf', byte_size, verdict: 'accepted', reason: null, eligible: true });
      // A REAL .docx as the product produces it (Supervisor acceptance, HIGH): the scanner's
      // closed signature table has no DOCX entry — an OOXML is a zip and MEASURES as
      // application/zip; the server names it .docx by declared+measured+members. A fixture
      // with measured_type DOCX is a state the product never produces.
      const docxAtt = (ordinal, filename) => ({ ordinal, filename, declared_type: DOCX, measured_type: 'application/zip', byte_size: 50000, verdict: 'accepted', reason: null, eligible: true });
      const binAtt = (ordinal, filename, measured_type = 'image/gif') => ({ ordinal, filename, declared_type: measured_type, measured_type, byte_size: 3000, verdict: 'accepted', reason: null, eligible: true });
      const dls = (ctx) => ctx.calls.filter((c) => c.command === 'crewing_intake_attachment_download');
      const docsOf = (ctx) => (ctx.save && ctx.save.args.manifest && Array.isArray(ctx.save.args.manifest.documents)) ? ctx.save.args.manifest.documents : null;
      const toastWith = (ctx, text) => ctx.toasts.some((t) => String(t[0]).indexOf(text) !== -1);
      const asked = (ctx) => ctx.timeline.some((e) => String(e).indexOf('confirm:') === 0);

      // ---- 1. an eligible pdf: fetched once, through the audited route, placed under <intake8>/attachment-N.pdf
      {
        const ctx = await openSave({ cardFields: { 'intake-1': RESP } });  // default K2_ATTACHMENTS: 1 = pdf eligible, 2 = exe rejected
        const dl = dls(ctx);
        softOk(dl.length === 1 && dl[0].args.intakeId === 'intake-1' && dl[0].args.ordinal === 1,
          'S3a-1: exactly ONE fetch, of the eligible ordinal, through crewing_intake_attachment_download — got ' + JSON.stringify(dl.map((c) => c.args.ordinal)));
        softOk(dl.length === 1 && dl[0].args.expectedContext && dl[0].args.expectedContext.crewing_id === 'crew-synthetic' && dl[0].args.expectedBytes === 120,
          'S3a-1: the fetch carries the same expected context and ceiling argument as the two sibling call sites (pilotExpected, card.content_bytes)');
        softOk(!dl.some((c) => c.args.ordinal === 2), 'S3a-1 non-eligible: the rejected .exe is never fetched — zero requests on the byte road for it');
        softOk(!!ctx.save && ctx.calls.indexOf(dl[0]) < ctx.calls.indexOf(ctx.save), 'S3a-1: the bytes arrive BEFORE the receiver is called, so the receiver copies a file that exists');
        softOk(!!ctx.save && ctx.save.args.mode === 'merge', 'S3b: the Crew Flow writer asks the receiver to MERGE — a repeat must not erase what is already in the folder — got ' + (ctx.save && JSON.stringify(ctx.save.args.mode)));
        softOk(!!ctx.save && ctx.save.args.extractedTo === '/home/op/Downloads/Skipi/Crewing',
          'S3a-1: extractedTo is the download root (the parent of the intake folder), derived from the path the route returned — got ' + (ctx.save && JSON.stringify(ctx.save.args.extractedTo)));
        softOk(!!ctx.save && ctx.save.args.cvPath === '',
          'S3a-1: cvPath stays empty — the CV route flattens names into CV/<name>, and two intakes of one person both ship attachment-0.pdf (DONE (2)); the CV is a document row instead');
        const docs = docsOf(ctx);
        softOk(!!docs && docs.length === 1 && docs[0].file_path === 'intake-1/attachment-1.pdf',
          'S3a-1: ONE document, file_path = <intake8>/attachment-N.<ext> — the sub-folder is the idempotency key and the provenance — got ' + JSON.stringify(docs && docs.map((d) => d.file_path)));
        softOk(!!docs && docs[0] && docs[0].doc_source === 'skipi_response', 'S3a-1: a file of a RESPONSE says doc_source skipi_response');
        softOk(!!docs && docs[0] && docs[0].category === 'CV' && docs[0].title === 'CV', 'S3a-1: the first pdf is the CV — title and category CV, as the bundle receiver labels a CV');
        softOk(!!docs && docs[0] && docs[0].file_name === 'oleh-cv.pdf', 'S3a-1: the name the letter carried is kept as metadata (file_name), never as the path');
        const s = ctx.save && ctx.save.args.applicantSummary;
        softOk(!!s && s.doc_source === 'skipi_response' && Object.keys(s).sort().join(',') === 'doc_source,email,name,nationality,rank',
          'S3a-1: summary_json carries doc_source as its FIFTH key and nothing else grew — got ' + (s && Object.keys(s).sort().join(',')));
        softOk(ctx.toasts.some((t) => t[1] === 'success'), 'S3a-1: the operator is told it worked');
        const placed = k2str(ctx, 'docs_placed');
        softOk(placed !== 'crew_flow.docs_placed' && toastWith(ctx, placed.replace('{n}', '1')), 'S3a-1 (930): and how many files went into the folder is SAID — "' + placed.replace('{n}', '1') + '"');
      }

      // ---- 2. a `bin`: not fetched, not placed, NAMED to the operator (RU and EN)
      for (const lang of ['en', 'ru']) {
        const ctx = await openSave({ language: lang, cardFields: { 'intake-1': Object.assign({}, RESP, { attachments: [binAtt(0, 'photo.gif'), pdfAtt(1, 'cv.pdf')] }) } });
        const dl = dls(ctx);
        softOk(dl.length === 1 && dl[0].args.ordinal === 1, '[' + lang + '] S3a-2 bin: the gif is NOT fetched — only the pdf goes down the byte road — got ' + JSON.stringify(dl.map((c) => c.args.ordinal)));
        const docs = docsOf(ctx);
        softOk(!!docs && docs.length === 1 && docs[0].file_path === 'intake-1/attachment-1.pdf', '[' + lang + '] S3a-2 bin: and it is not placed — one document, the pdf');
        const word = k2str(ctx, 'doc_bin_skipped');
        softOk(word !== 'crew_flow.doc_bin_skipped' && /\{n\}/.test(word) && /\{name\}/.test(word) && toastWith(ctx, word.replace('{n}', '0').replace('{name}', 'photo.gif')),
          '[' + lang + '] S3a-2 bin (930): the operator is told, in the dictionary’s words, WHICH attachment was not placed — "' + word.replace('{n}', '0').replace('{name}', 'photo.gif') + '"');
        softOk(!!ctx.save, '[' + lang + '] S3a-2 bin: the person is still saved — a photo is not a reason to lose the CV');
      }

      // ---- 3. nothing to place: the person is saved, and the folder outcome is said
      for (const lang of ['en', 'ru']) {
        const ctx = await openSave({ language: lang, cardFields: { 'intake-1': Object.assign({}, RESP, { attachments: [] }) } });
        softOk(dls(ctx).length === 0 && !!ctx.save && (docsOf(ctx) || []).length === 0 && ctx.save.args.extractedTo === '',
          '[' + lang + '] S3a-3 none: zero fetches, the save goes through with no documents and an empty extractedTo');
        const word = k2str(ctx, 'docs_none');
        softOk(word !== 'crew_flow.docs_none' && toastWith(ctx, word), '[' + lang + '] S3a-3 none (930): «no files for the folder» is said, not implied — "' + word + '"');
      }

      // ---- 4. more than 10 placeable files: refused BEFORE the question and before any byte
      {
        const many = []; for (let i = 0; i < 11; i++) many.push(pdfAtt(i, 'doc-' + i + '.pdf', 1000));
        for (const lang of ['en', 'ru']) {
          const ctx = await openSave({ language: lang, cardFields: { 'intake-1': Object.assign({}, RESP, { attachments: many }) } });
          softOk(dls(ctx).length === 0 && ctx.save === null, '[' + lang + '] S3a-4 ceiling: 11 files → NOTHING fetched and NOTHING saved — no partial write');
          softOk(!asked(ctx), '[' + lang + '] S3a-4 ceiling: and the question is not even asked — the refusal comes first');
          const word = k2str(ctx, 'docs_too_many');
          softOk(word !== 'crew_flow.docs_too_many' && toastWith(ctx, word.replace('{n}', '11')), '[' + lang + '] S3a-4 ceiling (930): the refusal names the count — "' + word.replace('{n}', '11') + '"');
        }
        const ten = many.slice(0, 10);
        const ok10 = await openSave({ cardFields: { 'intake-1': Object.assign({}, RESP, { attachments: ten }) } });
        softOk(dls(ok10).length === 10 && !!ok10.save && (docsOf(ok10) || []).length === 10, 'S3a-4 CALIBRATION: exactly 10 files pass — the bound is "more than 10", not "10"');
      }

      // ---- 5. more than 64 MiB in total: the same refusal, by size
      {
        const heavy = [pdfAtt(0, 'a.pdf', 40 * 1024 * 1024), pdfAtt(1, 'b.pdf', 40 * 1024 * 1024)];
        const ctx = await openSave({ cardFields: { 'intake-1': Object.assign({}, RESP, { attachments: heavy }) } });
        softOk(dls(ctx).length === 0 && ctx.save === null && !asked(ctx), 'S3a-5 ceiling: 80 MiB in two files → nothing fetched, nothing saved, no question');
        const word = k2str(ctx, 'docs_too_large');
        softOk(word !== 'crew_flow.docs_too_large' && ctx.toasts.some((t) => String(t[0]).indexOf(word.split('{')[0]) === 0), 'S3a-5 ceiling (930): the refusal is the dictionary’s size sentence — "' + word + '"');
        const fits = [pdfAtt(0, 'a.pdf', 60 * 1024 * 1024), binAtt(1, 'huge.gif')];
        fits[1].byte_size = 30 * 1024 * 1024;
        const okCtx = await openSave({ cardFields: { 'intake-1': Object.assign({}, RESP, { attachments: fits }) } });
        softOk(dls(okCtx).length === 1 && !!okCtx.save, 'S3a-5 CALIBRATION: a 30 MiB gif does not count against the ceiling — only what would be placed is summed');
      }

      // ---- 6. a second intake of the same person: HIS second file, in ITS OWN sub-folder
      {
        const ctx = await openSave({ cardFields: { 'intake-2': Object.assign({}, RESP, { attachments: [pdfAtt(0, 'cv.pdf')] }) } }, 'intake-2');
        const docs = docsOf(ctx);
        softOk(!!ctx.save && ctx.save.args.seafarerUserId === PR && ctx.save.args.mode === 'merge', 'S3a-6: the same person key, merge — the receiver adds, it does not replace');
        softOk(!!docs && docs.length === 1 && docs[0].file_path === 'intake-2/attachment-0.pdf',
          'S3a-6: attachment-0.pdf of the SECOND intake lives under intake-2/ — the same server name does not collide with intake-1/attachment-0.pdf — got ' + JSON.stringify(docs && docs.map((d) => d.file_path)));
      }

      // ---- 7. a letter’s file says `email`; a docx is placed and is not the CV
      {
        const ctx = await openSave({ cardFields: { 'intake-1': { source: 'inbound', attachments: [docxAtt(0, 'references.docx'), pdfAtt(1, 'cv.pdf')] } } });
        const docs = docsOf(ctx);
        softOk(!!ctx.save && ctx.save.args.seafarerUserId === 'intake:intake-1', 'S3a-7: a letter without a person key still saves under intake: (S2 behaviour kept)');
        softOk(!!docs && docs.length === 2 && docs.every((d) => d.doc_source === 'email'), 'S3a-7: both files of a LETTER say doc_source email — got ' + JSON.stringify(docs && docs.map((d) => d.doc_source)));
        softOk(!!ctx.save && ctx.save.args.applicantSummary && ctx.save.args.applicantSummary.doc_source === 'email', 'S3a-7: and summary_json says email too');
        softOk(!!docs && docs[0] && docs[0].file_path === 'intake-1/attachment-0.docx' && docs[0].category !== 'CV' && docs[0].title === 'references.docx',
          'S3a-7: the docx is placed under its own extension and is not labelled CV; its title is the name the letter carried');
        softOk(!!docs && docs[1] && docs[1].file_path === 'intake-1/attachment-1.pdf' && docs[1].category === 'CV', 'S3a-7: the first PDF is the CV even when a docx comes first');
      }

      // ---- 8. a fetch that fails: nothing is written — the person is not saved half
      {
        const ctx = await openSave({ downloadFails: [1], cardFields: { 'intake-1': Object.assign({}, RESP, { attachments: [pdfAtt(0, 'a.pdf'), pdfAtt(1, 'b.pdf')] }) } });
        softOk(ctx.save === null, 'S3a-8: when one file does not arrive the receiver is NOT called — a half-saved person is a second defect, not a save');
        const word = k2str(ctx, 'doc_download_failed');
        softOk(word !== 'crew_flow.doc_download_failed' && toastWith(ctx, word.replace('{n}', '1')), 'S3a-8 (930): the operator is told which attachment did not arrive — "' + word.replace('{n}', '1') + '"');
        softOk(!ctx.toasts.some((t) => t[1] === 'success'), 'S3a-8: and no success is claimed');
      }

      // ---- 8b. the docx key is the SERVER's: a real OOXML (declared docx, measures zip) is placed as .docx; a zip impostor comes back .bin and is NOT placed
      {
        const ctx = await openSave({ cardFields: { 'intake-1': Object.assign({}, RESP, { attachments: [docxAtt(0, 'cv.docx')] }) } });
        const docs = docsOf(ctx);
        softOk(dls(ctx).length === 1 && !!docs && docs.length === 1 && docs[0] && docs[0].file_path === 'intake-1/attachment-0.docx',
          'S3a-8b docx: declared docx + measured application/zip — what a real .docx looks like to the scanner — is fetched and placed as .docx — got ' + JSON.stringify(docs && docs.map((d) => d.file_path)));
        const imp = await openSave({ impostors: [0], cardFields: { 'intake-1': Object.assign({}, RESP, { attachments: [docxAtt(0, 'cv.docx'), pdfAtt(1, 'cv.pdf')] }) } });
        const idocs = docsOf(imp);
        softOk(dls(imp).length === 2, 'S3a-8b impostor: the metadata cannot tell a zip impostor from a real docx (same declared, same measured) — both are fetched — got ' + JSON.stringify(dls(imp).map((c) => c.args.ordinal)));
        softOk(!!idocs && idocs.length === 1 && idocs[0] && idocs[0].file_path === 'intake-1/attachment-1.pdf',
          'S3a-8b impostor: the server answered attachment-0.bin — it is NOT placed; only the pdf is — got ' + JSON.stringify(idocs && idocs.map((d) => d.file_path)));
        const word = k2str(imp, 'doc_bin_skipped');
        softOk(toastWith(imp, word.replace('{n}', '0').replace('{name}', 'cv.docx')), 'S3a-8b impostor (930): and the operator is told which attachment was not placed — "' + word.replace('{n}', '0').replace('{name}', 'cv.docx') + '"');
        softOk(!!imp.save, 'S3a-8b impostor: the person and his pdf are still saved');
        const plainZip = await openSave({ cardFields: { 'intake-1': Object.assign({}, RESP, { attachments: [{ ordinal: 0, filename: 'photos.zip', declared_type: 'application/zip', measured_type: 'application/zip', byte_size: 900, verdict: 'accepted', reason: null, eligible: true }, pdfAtt(1, 'cv.pdf')] }) } });
        softOk(dls(plainZip).length === 1 && dls(plainZip)[0].args.ordinal === 1, 'S3a-8b: a zip that does not even CLAIM to be a docx is not fetched at all — the metadata already says bin');
        softOk(/application\/zip/.test(k2crew), 'S3a-8b static: the block names application/zip — the type a real docx measures as — so the docx half of the allowlist is alive, not a dead key');
        softOk(/var actualExt = /.test(k2crew) && /!CREW_FLOW_DOCS_EXT\.test\(actualExt\)/.test(k2crew) && /var CREW_FLOW_DOCS_EXT = \/\^\(pdf\|docx\|jpg\|jpeg\|png\)\$\/;/.test(k2crew),
          'S3a-8b static: the placement key is the extension the SERVER named in the returned path — the one place that can see the archive members');
      }

      // ---- 8c. No.688/S3c (OWNER (1005)/(1006)): pictures from the letter go into the folder too.
      // jpg/png by the MEASURED type (the server measures images unambiguously — no declared
      // claim needed) are fetched and placed like a pdf: category Attachment, title = the
      // letter's name, never the CV. gif/svg stay bin: not fetched, named. An image counts
      // against both ceilings, and a repeat sends the same file_path (the receiver's dedup key).
      {
        const imgAtt = (ordinal, filename, measured_type, declared_type = measured_type, byte_size = 4000) => ({ ordinal, filename, declared_type, measured_type, byte_size, verdict: 'accepted', reason: null, eligible: true });
        for (const lang of ['en', 'ru']) {
          const ctx = await openSave({ language: lang, cardFields: { 'intake-1': Object.assign({}, RESP, { attachments: [imgAtt(0, 'passport.jpg', 'image/jpeg'), imgAtt(1, 'photo.png', 'image/png'), pdfAtt(2, 'cv.pdf')] }) } });
          const dl = dls(ctx);
          softOk(dl.length === 3 && dl.map((c) => c.args.ordinal).join(',') === '0,1,2',
            '[' + lang + '] S3c-1: the jpg and the png are fetched through the same audited route as the pdf, in ordinal order — got ' + JSON.stringify(dl.map((c) => c.args.ordinal)));
          const docs = docsOf(ctx);
          softOk(!!docs && docs.length === 3 && docs.map((d) => d.file_path).join(',') === 'intake-1/attachment-0.jpg,intake-1/attachment-1.png,intake-1/attachment-2.pdf',
            '[' + lang + '] S3c-1: all three are placed under <intake8>/attachment-N.<ext> with the extension the SERVER named — got ' + JSON.stringify(docs && docs.map((d) => d.file_path)));
          softOk(!!docs && docs[0] && docs[0].category === 'Attachment' && docs[0].title === 'passport.jpg' && docs[0].file_name === 'passport.jpg' && docs[0].doc_source === 'skipi_response',
            '[' + lang + '] S3c-1: the jpg is a document like a pdf attachment — category Attachment, title = the name the letter carried, doc_source of the response');
          softOk(!!docs && docs[1] && docs[1].category === 'Attachment' && docs[1].title === 'photo.png',
            '[' + lang + '] S3c-1: the png likewise — category Attachment, title photo.png');
          softOk(!!docs && docs[2] && docs[2].category === 'CV' && docs.filter((d) => d.category === 'CV').length === 1,
            '[' + lang + '] S3c-1: a picture that comes first is never the CV — the first PDF still is, and only it');
          const placed = k2str(ctx, 'docs_placed');
          softOk(toastWith(ctx, placed.replace('{n}', '3')), '[' + lang + '] S3c-1 (930): the count said to the operator includes the pictures — "' + placed.replace('{n}', '3') + '"');
          const word = k2str(ctx, 'doc_bin_skipped');
          softOk(!ctx.toasts.some((t) => String(t[0]).indexOf(word.split('{')[0]) === 0), '[' + lang + '] S3c-1: and no picture is reported as «not placed»');
        }

        // measured decides: a jpeg the mail called octet-stream is still a jpg; a «jpeg» that measures gif is bin
        {
          const ctx = await openSave({ cardFields: { 'intake-1': Object.assign({}, RESP, { attachments: [imgAtt(0, 'scan.jpeg', 'image/jpeg', 'application/octet-stream'), imgAtt(1, 'fake.jpg', 'image/gif', 'image/jpeg'), pdfAtt(2, 'cv.pdf')] }) } });
          softOk(dls(ctx).map((c) => c.args.ordinal).join(',') === '0,2', 'S3c-2: the MEASURED type decides — octet-stream measured jpeg is fetched, a declared jpeg that measures gif is not — got ' + JSON.stringify(dls(ctx).map((c) => c.args.ordinal)));
          const docs = docsOf(ctx);
          softOk(!!docs && docs.length === 2 && docs[0].file_path === 'intake-1/attachment-0.jpg' && docs[0].title === 'scan.jpeg', 'S3c-2: the .jpeg letter file lands as the server named it (.jpg) and keeps its own name as the title');
          const word = k2str(ctx, 'doc_bin_skipped');
          softOk(toastWith(ctx, word.replace('{n}', '1').replace('{name}', 'fake.jpg')), 'S3c-2 (930): the gif posing as a jpg is named to the operator — "' + word.replace('{n}', '1').replace('{name}', 'fake.jpg') + '"');
        }

        // gif and svg: still bin — not fetched, not placed, named (RU and EN); the dictionary line is the old one
        for (const lang of ['en', 'ru']) {
          const ctx = await openSave({ language: lang, cardFields: { 'intake-1': Object.assign({}, RESP, { attachments: [imgAtt(0, 'anim.gif', 'image/gif'), imgAtt(1, 'logo.svg', 'image/svg+xml'), pdfAtt(2, 'cv.pdf')] }) } });
          softOk(dls(ctx).length === 1 && dls(ctx)[0].args.ordinal === 2, '[' + lang + '] S3c-3: gif and svg are NOT fetched — got ' + JSON.stringify(dls(ctx).map((c) => c.args.ordinal)));
          const docs = docsOf(ctx);
          softOk(!!docs && docs.length === 1 && docs[0].file_path === 'intake-1/attachment-2.pdf', '[' + lang + '] S3c-3: and not placed — only the pdf');
          const word = k2str(ctx, 'doc_bin_skipped');
          softOk(toastWith(ctx, word.replace('{n}', '0').replace('{name}', 'anim.gif')) && toastWith(ctx, word.replace('{n}', '1').replace('{name}', 'logo.svg')),
            '[' + lang + '] S3c-3 (930): both are named with the unchanged doc_bin_skipped line');
          softOk(word === (lang === 'ru' ? 'Вложение {n} ({name}): формат не распознан — в папку не положено' : 'Attachment {n} ({name}): format not recognised — not placed in the folder'),
            '[' + lang + '] S3c-3 PRESERVE: the dictionary line is byte for byte the S3 one');
        }

        // a picture counts against the ceilings: refused before any byte and before the question
        {
          const big = await openSave({ cardFields: { 'intake-1': Object.assign({}, RESP, { attachments: [pdfAtt(0, 'a.pdf', 40 * 1024 * 1024), imgAtt(1, 'huge.jpg', 'image/jpeg', 'image/jpeg', 30 * 1024 * 1024)] }) } });
          softOk(dls(big).length === 0 && big.save === null && !asked(big), 'S3c-4 ceiling: 40 MiB pdf + 30 MiB jpg → nothing fetched, nothing saved, no question — the jpg now COUNTS');
          const word = k2str(big, 'docs_too_large');
          softOk(big.toasts.some((t) => String(t[0]).indexOf(word.split('{')[0]) === 0), 'S3c-4 ceiling (930): refused with the size sentence');
          const many = [pdfAtt(0, 'cv.pdf', 1000)]; for (let i = 1; i < 11; i++) many.push(imgAtt(i, 'p-' + i + '.png', 'image/png'));
          const cnt = await openSave({ cardFields: { 'intake-1': Object.assign({}, RESP, { attachments: many }) } });
          softOk(dls(cnt).length === 0 && cnt.save === null && !asked(cnt), 'S3c-4 ceiling: 1 pdf + 10 png = 11 placeable → refused before any byte');
          const ok10 = await openSave({ cardFields: { 'intake-1': Object.assign({}, RESP, { attachments: many.slice(0, 10) }) } });
          softOk(dls(ok10).length === 10 && (docsOf(ok10) || []).length === 10, 'S3c-4 CALIBRATION: 1 pdf + 9 png = 10 pass');
        }

        // a repeat: the same file_paths — the receiver's dedup key does not drift for pictures
        {
          const atts = [imgAtt(0, 'passport.jpg', 'image/jpeg'), pdfAtt(1, 'cv.pdf')];
          const a = await openSave({ cardFields: { 'intake-1': Object.assign({}, RESP, { attachments: atts }) } });
          const b = await openSave({ cardFields: { 'intake-1': Object.assign({}, RESP, { attachments: atts }) } });
          const fa = (docsOf(a) || []).map((d) => d.file_path).join(','), fb = (docsOf(b) || []).map((d) => d.file_path).join(',');
          softOk(fa === 'intake-1/attachment-0.jpg,intake-1/attachment-1.pdf' && fa === fb && a.save.args.mode === 'merge' && b.save.args.mode === 'merge',
            'S3c-5 repeat: two presses send the same file_paths under merge — no duplicate for the receiver to keep — got ' + JSON.stringify([fa, fb]));
        }

        // static: the client mirrors exactly the two image branches; the placement set is one constant
        {
          const exp = (k2crew.match(/function crewFlowDocsExpectedExt\(a\) \{[\s\S]*?\n\}/) || [''])[0];
          softOk(/measured === 'image\/jpeg'\) return 'jpg'/.test(exp) && /measured === 'image\/png'\) return 'png'/.test(exp) && !/gif|svg/.test(exp),
            'S3c static: crewFlowDocsExpectedExt names image/jpeg → jpg and image/png → png by the MEASURED type, and nothing else image-like');
          softOk((k2crew.match(/CREW_FLOW_DOCS_EXT/g) || []).length === 2, 'S3c static: CREW_FLOW_DOCS_EXT is declared once and read once — the placement set lives in one place');
        }
      }

      // ---- 9. the block: the invoke literal lives INSIDE the Crew Flow block, and the two sibling sites are untouched
      {
        const save = (k2crew.match(/async function crewFlowSaveToSeafarers\(intakeId\) \{[\s\S]*?\n\}/) || [''])[0];
        softOk((k2crew.match(/invoke\(\s*'crewing_intake_attachment_download'/g) || []).length === 1,
          'S3a-9 static: the fourth command is called from exactly ONE place inside the Crew Flow block (the demo harness freezes the literal of four)');
        softOk(!/pilotAttachmentDownload\(|profileLetterPick\(/.test(k2crew), 'S3a-9 static: the block does not reach the byte road through either sibling screen’s handler');
        softOk(/crewing_intake_attachment_download/.test(k2slice('async function pilotAttachmentDownload(ordinal) {', '\nasync function pilotOpenSavedPath'))
          && /crewing_intake_attachment_download/.test(k2slice('async function profileLetterPick(intakeId, ordinal) {', '\nasync function profileLetterPrepare')),
          'S3a-9 PRESERVE: the card’s «Download» and the letter’s pick still fetch through the same command — the shared road is not changed');
        softOk(/mode:\s*'merge'/.test(save), 'S3b static: the Crew Flow writer sends mode merge');
        const bundleSave = (html.match(/async function saveCurrentBundleSeafarer\(\) \{[\s\S]*?\n\}/) || [''])[0];
        softOk(bundleSave !== '' && !/mode/.test(bundleSave), 'S3b PRESERVE: the bundle writer sends NO mode — the receiver’s default must be «replace», byte for byte the old path');
      }

      // ---- 10. the receiver (src-tauri/src/db.rs, lib.rs): static shape of the merge
      {
        const cmd = (lib.match(/#\[tauri::command\]\s*\nfn save_seafarer_from_bundle\([\s\S]*?\n\}/) || [''])[0];
        softOk(/mode: Option<String>,/.test(cmd), 'S3b bridge: the command takes mode as Option<String> — a caller that sends none (the bundle path) must deserialise, or «Save failed» on the golden path');
        softOk(/enum SaveMode\s*\{[\s\S]*?Replace[\s\S]*?Merge[\s\S]*?\}/.test(dbRs) && /"merge"\s*=>\s*SaveMode::Merge/.test(dbRs) && /_\s*=>\s*SaveMode::Replace/.test(dbRs),
          'S3b: two modes, «merge» by the word and everything else (None, a typo) is «replace»');
        softOk(/!seafarer_id\.starts_with\("intake:"\)/.test(dbRs), 'No.669: a save under an intake: key of another letter never retires a row — the one-line closing of the residual gap');
        const seed = dbRs.indexOf('seed_staging_from_existing(');
        const swap = dbRs.indexOf('std::fs::rename(&docs_dir, &backup_dir)');
        softOk(seed > 0 && swap > seed, 'S3b merge: staging is SEEDED from the existing folder BEFORE the swap — the rollback (backup → docs_dir) is left exactly as it was');
        softOk(/if mode == SaveMode::Replace \{\s*\n\s*tx\.execute\(\s*\n?\s*"DELETE FROM seafarer_documents WHERE seafarer_id = \?1"/.test(dbRs),
          'S3b: the blanket DELETE of the person’s document rows runs in «replace» ONLY');
        softOk(/DELETE FROM seafarer_documents WHERE seafarer_id = \?1 AND file_path = \?2/.test(dbRs), 'S3b merge: a row with the same file_path is replaced, so a repeat with the same files does not double the list');
        softOk(/cv_path = COALESCE\(excluded\.cv_path, seafarers\.cv_path\)/.test(dbRs), 'S3b merge: a save without a cvPath keeps the cv_path the row already had');
        softOk(!/let _ = std::fs::copy/.test(dbRs), 'F3: every copy into staging is `?`, never `let _` — a failed copy is a failed save, not a row without a file');
      }
    }

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
      softOk(pins === 'e8000d757ea387fc29220cbe8a14c6efea7b7fb4', 'S5: the workflow pins exactly the accepted guard SHA');
      // The needles are assembled from halves on purpose: a probe that spells a
      // SHA out reads its own source and can never pass (self-referential-probe
      // class — measured three times in this session, this line included).
      // b72a59ca joined the list with the K2.1 pin bump (PR #54); aa3b2efb joined
      // it with the No.664 pin bump (guard PR #70): each is the gate
      // configuration WITHOUT the K2.1 route, so accepting it would mean the
      // workflow could run a gate that never heard of this task. 37ff9581 joined
      // it with the widened No.664 route (guard PR #71): it DOES carry the route,
      // but only six of the eight paths the line touches, so a gate running it
      // refuses the receiver slice outright. RISKS №497: a pin
      // bump touching more than one file skips assert-config-superset, so a
      // downgrade of the pin passes CI green — this line is what notices.
      const superseded = ['93b1a51e' + 'b59d0dff5f2db3f2289b8afb09761f39', '7bd93006' + '01e5445a9a60f1136d2fd57a9e9b32c5', 'b72a59ca' + '947ddb6a70a07b0328b61f9a29eca090', 'aa3b2efb' + '19cb4448226075be36b3f8c7b302c3df', '37ff9581' + 'f3e8ccca399525844f1c27cb7f468698'];
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
    // No.664/S2 (OWNER (985)) lifted the N8 freeze: the delivered contact now
    // reaches the irreversible copy by ONE named route — the card's own
    // responseContact, and only a delivered ADDRESS (state have + isEmail). It
    // still never travels through the fact cache (N17 below is unchanged).
    softOk(/crewFlowDeliveredContact\(|responseContact/.test(save) && !/crewFlowFactsFor\([^)]*\)\s*\[\s*['"]?email/.test(save),
      'No.621/N8 → No.664/Г2: crewFlowSaveToSeafarers reads the delivered contact by the named route (crewFlowDeliveredContact), not through the fact cache');
    softOk(!/facts\.email\b/.test(save),
      'No.621/N8 → No.664/Г2: the legacy `email` FACT key is gone from the writer');
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
    // No.664/S2 (OWNER (985)): the delivered address now reaches the seafarer
    // database — by the ONE named route (applicantSummary.email) and by it only.
    softOk(saves.length === 1 && saves[0].args.applicantSummary.email === RC_ADDRESSABLE.value,
      'No.621 R8 → No.664/Г2: the delivered address is the saved email');
    softOk(saves.length === 1 && JSON.stringify(saves[0].args).split(RC_ADDRESSABLE.value).length === 2,
      'No.621 R8 → No.664/Г2: and it is in the payload exactly once — the named route, no back door');
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

// ====== No.622: professional applicability of a RANK, as the SCREEN says it ======
// Written as a standalone harness and living HERE because skipi-guard's allowlists
// are exact file NAMES: a new test file cannot be pushed at all, while the subject
// - the stored evaluations of a candidate card - is exactly what this harness
// already measures. The section is ONE block, so its bindings cannot collide with
// the 2600 lines above it, and it reuses the file's `html` and its counters.
console.log('\n# No.622 - applicability: one answer, said the same way in all three places');
{
  const ok622 = softOk;
  const START = '// ================= No.622 RANK APPLICABILITY (client) START =================';
  const END = '// ================== No.622 RANK APPLICABILITY (client) END ==================';
  const a = html.indexOf(START), b = html.indexOf(END, a + 1);
  ok622(a > 0 && b > a, 'the applicability block exists, once, and is bounded by its markers');
  ok622(html.indexOf(START, a + 1) === -1, 'exactly one START marker');
  const block = (a > 0 && b > a) ? html.slice(a, b) : '';

  // ---------------------------------------------------------------- the adapter
  // ONE function reads the server's contract. Three renderers plus the shortlist
  // plus the draft branch on it, and five expressions of the same field is how
  // they drift apart.
  console.log('# the adapter that reads the server contract');
  let ctx = null;
  if (block) {
    ctx = { console, state:{}, __detail:null };
    ctx.getUiLang = () => ctx.__lang || 'ru';
    ctx.pilotDetail = () => ctx.__detail;
    ctx.escapeHtml = (s) => String(s);
    ctx.escapeAttr = (s) => String(s);
    vm.createContext(ctx);
    try {
      vm.runInContext(block + `
  this.__api = { cardApplicability, cardApplicabilityLabel, cardApplicabilityWhy,
    cardResponseProfileId, cardResponseOrigin, cardOriginLabel,
    cardWithheldProfiles, cardApplicabilityVisibleRows,
    CARD_APPLICABILITY_TEXT, CARD_APPLICABILITY_REASON_TEXT, CARD_ORIGIN_TEXT };`, ctx);
    } catch (error) {
      failed += 1; console.log('  ✗ the block evaluates on its own:', error.message);
    }
  }
  const api = (ctx && ctx.__api) || null;
  ok622(api, 'the block exposes its helpers');

  if (api) {
    const A = api.cardApplicability;
    // Five verdicts, and the sixth state that is NOT a verdict: an older server
    // that says nothing. Reading silence as `not_applicable` would empty the
    // screen; reading it as `same` would print a claim nobody made.
    ok622(A({applicability:'same'}).answer === 'same' && A({applicability:'same'}).stated === true, 'same is carried through');
    ok622(A({applicability:'alternative'}).answer === 'alternative', 'alternative is its own verdict, never folded into same');
    ok622(A({applicability:'any'}).answer === 'any' && A({applicability:'any'}).hidden === false, 'any (a deliberately open vacancy) is shown');
    ok622(A({applicability:'not_applicable'}).hidden === true, 'not_applicable is the ONLY verdict that moves under a disclosure');
    ok622(A({applicability:'unknown'}).hidden === false, 'unknown is NEVER hidden - the canon puts unknowns next to the decision');
    ok622(A({}).stated === false && A({}).answer === null && A({}).hidden === false,
      'a row from a server that does not speak this contract keeps rendering exactly as before');
    ok622(A({applicability:'nonsense'}).stated === false, 'an unrecognised verdict is silence, not a guess');
    // N25: two different unknowns are two different sentences.
    const absent = A({applicability:'unknown', applicability_reason:'rank_absent'});
    const unreadable = A({applicability:'unknown', applicability_reason:'rank_unreadable'});
    const profileUnreadable = A({applicability:'unknown', applicability_reason:'profile_rank_unreadable'});
    ok622(absent.reason === 'rank_absent' && unreadable.reason === 'rank_unreadable', 'the two unknowns stay two codes');
    for (const lang of ['ru', 'en']) {
      ctx.__lang = lang;
      const one = api.cardApplicabilityWhy(absent), two = api.cardApplicabilityWhy(unreadable);
      const three = api.cardApplicabilityWhy(profileUnreadable);
      ok622(one && two && three && one !== two && two !== three && one !== three,
        `[${lang}] N25: "he has no rank", "nobody could place his" and "nobody could place the PROFILE's" are three sentences`);
      ok622(!/^[a-z_]+$/.test(one) && !/^[a-z_]+$/.test(two), `[${lang}] the reason is a sentence, not the wire code`);
      // N10 on the screen: alternative must not READ as a confirmation.
      const alt = api.cardApplicabilityLabel(A({applicability:'alternative'}));
      const same = api.cardApplicabilityLabel(A({applicability:'same'}));
      ok622(alt && same && alt !== same, `[${lang}] alternative is labelled differently from same`);
      ok622(api.cardApplicabilityLabel(A({})) === '', `[${lang}] silence prints no label at all`);
    }
    // Both dictionaries are complete: an English string in a Russian interface is
    // a defect of its own (No.627 found one today).
    for (const table of [api.CARD_APPLICABILITY_TEXT, api.CARD_APPLICABILITY_REASON_TEXT, api.CARD_ORIGIN_TEXT]) {
      for (const key of Object.keys(table)) {
        const pair = table[key];
        ok622(Array.isArray(pair) && pair.length === 2 && pair[0] && pair[1] && pair[0] !== pair[1],
          `${key} carries a distinct RU and EN string`);
        ok622(/[Ѐ-ӿ]/.test(pair[0]), `${key} RU string is actually Russian`);
        ok622(!/[Ѐ-ӿ]/.test(pair[1]), `${key} EN string carries no Cyrillic`);
      }
    }

    // ------------------------------------------------- N24 / N23 / (954) origin
    console.log('# where the first profile CAME FROM - three states, never two');
    const detail = (card, items) => ({ intakeId:'i-1', card:card, ranks:{ items:items||[], unranked_active_profiles:[], withheld_profiles:[] } });
    ctx.__detail = detail({ source:'skipi_response', primary_profile_id:'p-master' }, [{profile_id:'p-master', primary:true}]);
    ok622(api.cardResponseOrigin() === 'response', 'a Skipi response names the profile he responded to');
    ctx.__detail = detail({ source:'inbound', primary_profile_id:'p-master' }, [{profile_id:'p-master', primary:true}]);
    ok622(api.cardResponseOrigin() === 'first_context', 'N24: an ordinary letter is a FIRST CONTEXT, never a response');
    ctx.__detail = detail({ source:'inbound' }, [{profile_id:'p-x', primary:false}]);
    ok622(api.cardResponseOrigin() === 'none', 'no primary_profile_id means there is no originating profile at all');
    // (954), border 1: `rank.primary` alone NEVER earns the label.
    ctx.__detail = detail({ source:'skipi_response' }, [{profile_id:'p-legacy', primary:true}]);
    ok622(api.cardOriginLabel('p-legacy') === '', 'a legacy primary flag with no intake profile gives NO label');
    ctx.__detail = detail({ source:'inbound', primary_profile_id:'p-master' }, [{profile_id:'p-master', primary:true}]);
    for (const lang of ['ru', 'en']) {
      ctx.__lang = lang;
      const label = api.cardOriginLabel('p-master');
      ok622(label && !/отклик|respond/i.test(label), `[${lang}] N24: the letter's first profile is not called a response`);
      ok622(api.cardOriginLabel('p-other') === '', `[${lang}] a profile that is not the origin carries no origin label`);
    }
    ctx.__detail = detail({ source:'skipi_response', primary_profile_id:'p-master' }, [{profile_id:'p-master', primary:true}]);
    ctx.__lang = 'ru';
    ok622(/отклик/i.test(api.cardOriginLabel('p-master')), 'RU: a real response IS called a response');
    ctx.__lang = 'en';
    ok622(/respond/i.test(api.cardOriginLabel('p-master')), 'EN: a real response IS called a response');

    // ------------------------------------------------------ N7 / N11 / withheld
    console.log('# what is withheld is NAMED and COUNTED, never silently dropped');
    ctx.__detail = {
      intakeId:'i-1',
      card:{ source:'skipi_response', primary_profile_id:'p-ab' },
      ranks:{
        items:[
          { profile_id:'p-ab', primary:true, applicability:'same' },
          { profile_id:'p-master', primary:false, applicability:'not_applicable' },
          // A stored row of a profile the server did NOT list as withheld - it is
          // switched off now, so it is not an ACTIVE profile, but its evaluation is
          // still on the card and still must not read as current.
          { profile_id:'p-old', primary:false, applicability:'not_applicable' },
          { profile_id:'p-co', primary:false, applicability:'unknown', applicability_reason:'rank_absent' }
        ],
        unranked_active_profiles:[],
        withheld_profiles:[
          { profile_id:'p-master', name:'Master', applicability:'not_applicable' },
          { profile_id:'p-chief', name:'Chief Engineer', applicability:'not_applicable' }
        ]
      }
    };
    const withheld = api.cardWithheldProfiles();
    // THREE: two active profiles the server withheld, plus one stored row of a
    // profile it no longer lists. The `unknown` row is NOT here - it stays in the
    // main list, so counting it as withheld would put a number on the screen that
    // does not match what the screen hides.
    ok622(withheld.length === 3, `the withheld set is the UNION of both sides, deduped by profile (got ${withheld.length}, want 3)`);
    ok622(withheld.filter(w => w.profile_id === 'p-master').length === 1, 'a profile that is both a stored row and a withheld profile is counted ONCE');
    ok622(withheld.some(w => w.profile_id === 'p-old'), 'a stored inapplicable row the server did not list is still counted');
    ok622(!withheld.some(w => w.profile_id === 'p-co'), 'an unknown is NOT counted as withheld: the screen does not hide it');
    const visible = api.cardApplicabilityVisibleRows();
    ok622(visible.length === 2, `only not_applicable leaves the main list (got ${visible.length}, want 2: the response profile and the unknown)`);
    ok622(!visible.some(r => r.profile_id === 'p-old'), 'an inapplicable stored row of a switched-off profile leaves the main list too');
    ok622(visible[0].profile_id === 'p-ab', 'N7: the profile he responded to stands FIRST');
    ok622(visible.some(r => r.profile_id === 'p-co'), 'N25: the unknown stays in the main list with its explanation');
    // N7 again, the harder half: an INAPPLICABLE response profile is still shown.
    ctx.__detail.ranks.items[0].applicability = 'not_applicable';
    const visibleWithBadPrimary = api.cardApplicabilityVisibleRows();
    ok622(visibleWithBadPrimary.some(r => r.profile_id === 'p-ab'),
      'N7: the profile he RESPONDED to is shown even when the rank does not apply to it');
    ok622(!api.cardWithheldProfiles().some(w => w.profile_id === 'p-ab'),
      'the response profile is never counted as withheld');
  }

  // -------------------------------------------------- N20: the labels that lied
  console.log('# N20 - the captions that promised ALL active profiles');
  const lies = [
    ['ru', 'Сравниваются все активные профили соответствия'],
    ['en', 'Every active compliance profile is compared']
  ];
  for (const [lang, text] of lies) {
    ok622(!html.includes(text), `[${lang}] the caption no longer claims every active profile is compared`);
  }
  ok622(!html.includes("'crew_flow.matched_done':'Сопоставлено с активными профилями соответствия.'"),
    'RU matched_done no longer implies every profile was compared');
  ok622(!html.includes("'crew_flow.matched_done':'Compared against the active compliance profiles.'"),
    'EN matched_done no longer implies every profile was compared');

  // ------------------- the three consumers all branch on the SAME adapter (N22)
  console.log('# N13 / N14 / N22 - all three consumers read one adapter');
  const consumers = [
    ['pilotCardFitCardHtml', 'the fit block'],
    ['pilotCardRankRowHtml', 'the stored evaluations'],
    ['crewFlowRowMatchHtml', 'the queue row']
  ];
  for (const [fn, name] of consumers) {
    const at = html.indexOf('function ' + fn + '(');
    if (!ok622(at > 0, `${name} (${fn}) exists`)) continue;
    const body = html.slice(at, html.indexOf('\nfunction ', at + 10));
    ok622(/cardApplicability\s*\(/.test(body), `${name} reads applicability through the one adapter`);
  }
  // Both cache producers carry the field, or the queue cannot know it at all.
  for (const fn of ['crewFlowCacheRanks', 'crewFlowCacheRankSummary']) {
    const at = html.indexOf('function ' + fn + '(');
    if (!ok622(at > 0, `${fn} exists`)) continue;
    const body = html.slice(at, html.indexOf('\nfunction ', at + 10));
    ok622(/applicability/.test(body), `${fn} carries applicability into the row cache`);
  }

  // -------------------------------------------- N19: the new staleness reasons
  console.log('# N19 - the three new staleness reasons have words in both languages');
  const staleAt = html.indexOf('var PILOT_CARD_STALE_TEXT');
  const staleBlock = staleAt > 0 ? html.slice(staleAt, html.indexOf('};', staleAt)) : '';
  for (const code of ['rank_not_applicable', 'rank_unknown', 'facts_changed']) {
    ok622(staleBlock.includes(code + ':['), `stale reason ${code} has its own pair of words`);
  }

  // ------------- the field has to SURVIVE THE LOADER to reach the screen
  // Found the hard way: every fixture above sets `d.ranks.withheld_profiles`
  // directly, so all of them passed while `pilotRanksLoad` quietly dropped the
  // field off the wire - the count on the screen would have been computed from
  // stored rows alone and the ACTIVE profiles the server withheld would have
  // vanished in silence. A renderer assertion cannot see a loader that never
  // hands it the data.
  console.log('# the loader carries what the renderer needs');
  {
    const loadFn = html.indexOf('async function pilotRanksLoad()');
    ok622(loadFn > 0, 'pilotRanksLoad exists');
    const lb = loadFn > 0 ? html.slice(loadFn, html.indexOf('\nasync function ', loadFn + 10)) : '';
    ok622(/withheld_profiles:\s*Array\.isArray\(result\.withheld_profiles\)/.test(lb),
      'pilotRanksLoad carries withheld_profiles off the wire - without this the count is always computed from stored rows alone');
    ok622(/withheld_profiles:Array\.isArray\(result\.withheld_profiles\)\?result\.withheld_profiles:\[\]/.test(lb.replace(/\s+/g, '')) || /\?result\.withheld_profiles:\[\]/.test(lb),
      'an absent withheld_profiles becomes an empty list, never undefined');
    for (const field of ['items', 'unranked_active_profiles', 'confirmations']) {
      ok622(new RegExp(field + ':Array\\.isArray').test(lb.replace(/\s+/g, '')) || lb.includes(field + ':Array.isArray'),
        'pilotRanksLoad still carries ' + field + ' (No.622 did not drop a sibling)');
    }
  }

  // ------------- the number on the screen actually reaches the screen (930)
  // The adapter can be perfect and the disclosure still never rendered. These
  // read the emitting code, because the two consumers build their HTML as strings.
  console.log('# the withheld count is EMITTED, by both consumers, with its number');
  {
    const withheldFn = html.indexOf('function cardWithheldHtml(');
    ok622(withheldFn > 0, 'cardWithheldHtml exists - one wording of the count for both consumers');
    const wb = withheldFn > 0 ? html.slice(withheldFn, html.indexOf('\nfunction ', withheldFn + 10)) : '';
    ok622(/data-qa="pilot-withheld"/.test(wb) && /data-count="/.test(wb),
      'the disclosure carries a machine-readable count, not only a sentence');
    ok622(/withheld_title/.test(wb) && /replace\('\{n\}'/.test(wb),
      'the count is substituted into the heading - the NUMBER is on the screen (docs/CANON-ui-v1.md principle 1)');
    ok622(/<details/.test(wb) && /<summary>/.test(wb),
      'it is a disclosure, not a permanently open list: hidden rows are one click away, never silent');
    ok622(/pilot-withheld-row/.test(wb) && /cardApplicabilityPair\(CARD_APPLICABILITY_TEXT/.test(wb),
      'each withheld profile is NAMED with its own reason - "2 hidden" alone cannot be acted on');
    for (const [fn, name] of [['pilotCardFitSummaryHtml', 'the fit block'], ['pilotCardRanksHtml', 'the stored evaluations']]) {
      const at = html.indexOf('function ' + fn + '(');
      if (!ok622(at > 0, name + ' (' + fn + ') exists')) continue;
      const body = html.slice(at, html.indexOf('\nfunction ', at + 10));
      ok622(/cardWithheldHtml\(/.test(body), name + ' emits the withheld disclosure');
      // No.637/S4 (No.642): the call MOVED behind `cardApplicabilityRowSplit`,
      // which partitions exactly what `cardApplicabilityVisibleRows` returns.
      // The PLACE changed, the property did not - and the three lines below pin
      // the derivation, so this retarget cannot become a loophole.
      ok622(/cardApplicabilityVisibleRows\(\)/.test(body) || /cardApplicabilityRowSplit\(\)/.test(body),
        name + ' lists only the rows that stayed');
    }
    const splitAt = html.indexOf('function cardApplicabilityRowSplit(');
    ok622(splitAt > 0, 'No.637/S4: the ONE split both surfaces now use exists');
    const splitBody = splitAt > 0 ? html.slice(splitAt, html.indexOf('\nfunction ', splitAt + 10)) : '';
    ok622(/cardApplicabilityVisibleRows\(\)/.test(splitBody),
      'No.637/S4: and it is built ON cardApplicabilityVisibleRows - what the rank does not apply to can never re-enter through the split');
    ok622(/cardApplicability\(row\)\.answer === 'unknown'/.test(splitBody),
      'No.637/S4: it folds ONE verdict, and asks the same adapter every other surface asks');
    // N11: the agency that HAS profiles is never told to create one.
    const fitAt = html.indexOf('function pilotCardFitSummaryHtml(');
    const fitBody = html.slice(fitAt, html.indexOf('\nfunction ', fitAt + 10));
    ok622(/no_origin/.test(fitBody),
      'N11/N24: with no originating profile the block says so plainly instead of offering "create a profile"');
  }

  // --------------------------------------------------------------------- N21
  console.log('# N21 - a seafarer does not reach a shortlist or a letter he cannot hold');
  const draftAt = html.indexOf('function cardDraftProfileId()');
  const draftBody = draftAt > 0 ? html.slice(draftAt, html.indexOf('\nfunction ', draftAt + 10)) : '';
  // No.637/S4 (No.650) CHANGES THIS ONE, and it is a change of MEANING, named
  // rather than quietly re-passed: OWNER 02.10 and (975) p.5 exempt exactly one
  // pair - the vacancy he responded to - as S2 already exempted it for the
  // shortlist. Everything N21 refused besides that, it still refuses; both
  // halves are drilled behaviourally in the No.637/S4 block below.
  ok622(/cardApplicability\s*\(/.test(draftBody), 'the draft still refuses a profile the rank does not apply to');
  ok622(/cardChosenProfileId\(\)/.test(draftBody),
    'No.637/S4 (650): except the one he responded to, through the SAME predicate S2 used - a second way of asking "which profile did he choose" is the drift this card removes');
  const rowAt = html.indexOf('function pilotCardRankRowHtml(');
  const rowBody = rowAt > 0 ? html.slice(rowAt, html.indexOf('\nfunction ', rowAt + 10)) : '';
  ok622(/not_applicable|\.hidden/.test(rowBody), 'the shortlist button is refused on an inapplicable row, on the screen and not only on the server');
}

// ===== No.637 / S1b: an unreadable post keeps the PERSON and loses the NUMBER ===
//
// The defect this measures, end to end: a candidate whose post nobody could read
// got NO evaluation row at all, so he was not on the screen and the shortlist the
// owner accepted live answered 404 `rank_not_found` (26 red tests in the server's
// `test_crewing_632_shortlist_hold.py`, cause established by a calibrated drill).
// The server writes the row now, which moves the whole question here: the row
// MUST stay visible with its reason and its button, and MUST carry no figure.
//
// **IT IS WRITTEN AGAINST THE RENDERED MARKUP, NOT AGAINST THE SOURCE TEXT**, and
// that is the point of it. No.640: the existing N22 check only asserts that the
// body of `pilotCardFitCardHtml` mentions `cardApplicability(`, so deleting the
// rendered caption from the returned string left the whole suite GREEN (measured
// by EXEC S1a, three-way calibration). Every assertion below reads the HTML the
// card actually produced, and the calibration that proves it can go red is run
// and recorded rather than asserted in a comment.
console.log('\n# No.637/S1b: the post nobody could read - shown, explained, actionable, and WITHOUT a figure');
{
  const ok637 = softOk;
  // The server of this context answers the way the server answers AFTER S1b:
  // the evaluation exists for the unreadable post and carries the fresh verdict.
  // Two profiles in ONE screen, with two different verdicts, so the test cannot
  // be passed by suppressing everything or by rendering nothing.
  const verdicts = {
    'prof-A': { applicability: 'unknown', applicability_reason: 'rank_absent' },
    'prof-B': { applicability: 'same', applicability_reason: null },
    'prof-C': { applicability: 'same', applicability_reason: null },
  };
  const srv = makeServer();
  const baseView = srv.ranksView.bind(srv);
  srv.ranksView = () => baseView().map((row) => Object.assign({}, row, verdicts[row.profile_id] || {}));
  const ctx = makeContext({ server: srv });
  await positiveChainUntilRank(ctx);

  // BOUND THE LAST CARD. `split` ends every fragment at the next card except the
  // final one, which ran to the end of the DOCUMENT - so anything asserted about
  // "this card" was in fact asserted about the whole rest of the page. Harmless
  // until No.637/S4 put a disclosure further down, and the same class of probe
  // defect the S2 extractor was already caught on. Calibrated two lines below.
  const fitCard = (id) => {
    const part = main(ctx).split('data-qa="pilot-fit-card"').slice(1)
      .find((p) => p.startsWith(` data-profile="${id}"`));
    if (!part) return null;
    const stops = [part.indexOf('data-qa="pilot-rank-unread"'), part.indexOf('</section>')].filter((i) => i >= 0);
    return stops.length ? part.slice(0, Math.min.apply(null, stops)) : part;
  };
  const unknownCard = fitCard('prof-A');
  const knownCard = fitCard('prof-B');
  ok637(!!unknownCard, 'the candidate whose post nobody could read HAS a card at all — before S1b the server wrote no row and he was off the screen entirely');
  ok637(!!knownCard, 'CALIBRATION: a card with a readable post is on the same screen, so "no figure" cannot pass by an empty screen');

  if (unknownCard && knownCard) {
    // ---- 1. the figure is gone. Both forms of it. ------------------------
    ok637(/data-qa="pilot-fit-pct" data-pct="none"/.test(unknownCard),
      'No.637/S1b: the unestablished post carries NO percentage — (939) "ни совпадение, ни 0 %"');
    ok637(!/%/.test(unknownCard),
      'No.637/S1b: and not a per-cent sign anywhere on that card');
    ok637(!/checks met, by the stored evaluation/.test(unknownCard) && !/из \d+ по сохранённой оценке/.test(unknownCard),
      'No.637/S1b: nor the "M of N checks met" caption — "0 из N" is the same claim written differently');
    ok637(/data-fit="rank_unknown"/.test(unknownCard),
      'No.637/S1b: the card names WHICH question is open, machine-readably, instead of leaving a blank');
    ok637(!/<div class="cf-bar"/.test(unknownCard),
      'No.637/S1b: no progress bar either — a bar is a figure drawn instead of printed');
    // CALIBRATION on the same screen: the readable post DOES get its figure.
    ok637(/data-qa="pilot-fit-pct" data-pct="\d+"/.test(knownCard) && /%/.test(knownCard),
      'CALIBRATION: the readable post keeps its percentage — S1b removed the figure for ONE verdict, not for everybody');
    ok637(/checks met, by the stored evaluation/.test(knownCard),
      'CALIBRATION: and keeps its mandatory caption (928)');

    // ---- 2. the reason is RENDERED, next to the decision (930) -----------
    ok637(/data-qa="pilot-fit-applicability"/.test(unknownCard),
      'No.637/S1b: the card RENDERS the applicability line — this is the assertion No.640 found missing: deleting the rendered caption left the whole suite green');
    ok637(/data-qa="pilot-fit-applicability"[^>]*data-applicability="unknown"/.test(unknownCard),
      'No.637/S1b: and the rendered line carries the verdict itself');
    ok637(/data-applicability-reason="rank_absent"/.test(unknownCard),
      'No.637/S1b: and WHICH unknown it is — "no rank among the facts" and "nobody could place the one he has" are two different next actions');
    const applicText = (card) => {
      const m = String(card).match(/data-qa="pilot-fit-applicability"[^>]*>([\s\S]*?)<\/div>/);
      return m ? m[1].replace(/\s+/g, ' ').trim() : '';
    };
    ok637(applicText(unknownCard).length > 10 && !/^[a-z_]+$/.test(applicText(unknownCard)),
      'No.637/S1b: the line is a sentence for a person, not the wire code — got "' + applicText(unknownCard) + '"');
    // No.637/S4 (No.642) CHANGED THIS PROPERTY, and it is named here rather than
    // left to re-pass quietly. Twenty active profiles produced twenty copies of
    // this very card, so the REPETITION is folded into one disclosure - while
    // the unknown ITSELF is not folded: it stands in the <summary>, unopened,
    // with its count and its next action. docs/CANON-ui-v1.md forbids hiding an
    // unknown from the person deciding; it does not ask for one unknown printed
    // twenty times. Manager's decision on the owner's standing word that nobody
    // disappears - and the second assertion is what keeps the first honest.
    ok637(!/<details|<summary/.test(unknownCard),
      'No.637/S1b: the card itself folds nothing - its verdict, its reason and its button are in the open wherever the card stands');
    const unreadSummary = (main(ctx).match(/data-qa="pilot-rank-unread"[^>]*>\s*<summary>([\s\S]*?)<\/summary>/) || [])[1] || '';
    ok637(/not read/.test(unreadSummary) && /manual check/.test(unreadSummary) && /\b1\b/.test(unreadSummary),
      `No.637/S4: and the unknown is announced on the main screen, in the summary, with no click at all — got "${unreadSummary}"`);

    // ---- 3. the BUTTON. The harm was a man who could not be shortlisted. --
    ok637(/data-qa="pilot-fit-confirm"/.test(unknownCard),
      'No.637/S1b: the add-to-shortlist button is on the unknown card — a person pressing it IS the "честная ручная проверка" (939)');
    ok637(/data-qa="pilot-fit-confirm"[^>]*onclick="pilotShortlistConfirm\('prof-A',1\)"/.test(unknownCard),
      'No.637/S1b: wired to the pair of ITS OWN card');
    // ...and the same on the full "stored comparisons" section below it.
    const unknownRow = rankRow(ctx, 'prof-A', 1);
    ok637(!!unknownRow && /data-qa="pilot-rank-applicability"[^>]*data-applicability="unknown"/.test(unknownRow),
      'No.637/S1b: the detailed row says the same thing, through the same adapter');
    ok637(!!unknownRow && !/data-qa="pilot-rank-stale"/.test(unknownRow),
      'No.637/S1b: and does NOT call the row out of date — the server stopped stamping unknown as stale, and "устарело" is a different and false sentence');
    const rowsSection = main(ctx);
    ok637(/data-qa="pilot-rank-row" data-profile="prof-A"[\s\S]*?data-qa="pilot-confirm"/.test(rowsSection),
      'No.637/S1b: the detailed row offers the add button too, never the "cannot be shortlisted" note');
  }

  // ---- 4. the refusal in the ONE function, directly ---------------------
  const shareOf = (row) => JSON.parse(vm.runInContext(
    'JSON.stringify(crewFlowMatchShare(' + JSON.stringify(row) + '))', ctx));
  const counts = { met: 1, missing: 0, unconfirmed: 0, total: 1, stale: false };
  ok637(shareOf(Object.assign({}, counts, { applicability: 'unknown' })).pct === null,
    'No.637/S1b: crewFlowMatchShare refuses a figure for an unknown verdict even when the counts divide perfectly');
  ok637(shareOf(Object.assign({}, counts, { applicability: 'unknown' })).reason === 'rank_unknown',
    'No.637/S1b: and says which refusal it is');
  ok637(shareOf(Object.assign({}, counts, { applicability: 'unknown' })).met === 0
    && shareOf(Object.assign({}, counts, { applicability: 'unknown' })).total === 0,
    'No.637/S1b: it hands back no met/total either — the caption is built from those two, so leaving them would print "выполнено 1 из 1"');
  ok637(shareOf(Object.assign({}, counts, { applicability: 'same' })).pct === 100,
    'CALIBRATION: the same counts with a readable post still produce 100% — the refusal is the verdict, not the arithmetic');
  // No.637/S7 INVERTS THIS ASSERTION, and says why rather than quietly flipping
  // it. Its premise — "it never reaches a card at all (the adapter hides the
  // row)" — was true the day S1b was written and was made FALSE by S2:
  // `cardApplicabilityVisibleRows` keeps the profile a person RESPONDED to
  // whatever its verdict ((975) п.5). So a `not_applicable` fit card is exactly
  // what the stand rendered on 02.10, with `0 %` and «выполнено 0 из 4» printed
  // on it. The premise is measured dead; the assertion resting on it goes with
  // it. This is a change of PLACE, not of meaning: the figure is still refused
  // where it was never measured — now on one more verdict.
  ok637(shareOf(Object.assign({}, counts, { applicability: 'not_applicable' })).pct === null,
    'No.637/S7: a rank that does not apply yields NO figure either — nothing was measured against this profile, and 0% is the other end of the invented 50%');
  ok637(shareOf(Object.assign({}, counts, { applicability: 'not_applicable' })).reason === 'rank_not_applicable',
    'No.637/S7: and it is a refusal of its OWN — «не подходит» and «не прочитана» are two different next actions for an operator');
  ok637(shareOf(Object.assign({}, counts, { applicability: 'not_applicable' })).met === 0
    && shareOf(Object.assign({}, counts, { applicability: 'not_applicable' })).total === 0,
    'No.637/S7: and hands back no met/total, so «выполнено M из N» cannot be built from them');
  ok637(shareOf(counts).pct === 100,
    'a row from a server that does not speak this contract keeps rendering exactly as before');

  // ---- 5. both shipped languages, for both wordings ---------------------
  {
    const en = (ctx.setLang('en'), ctx.__pilot.cardT('share_rank_unknown'));
    const ru = (ctx.setLang('ru'), ctx.__pilot.cardT('share_rank_unknown'));
    ok637(en && en !== 'share_rank_unknown' && !/[Ѐ-ӿ]/.test(en),
      `No.637/S1b: EN wording exists for PILOT_CARD_TEXT.share_rank_unknown — got "${en}"`);
    ok637(ru && ru !== 'share_rank_unknown' && ru !== en && /[Ѐ-ӿ]/.test(ru),
      `No.637/S1b: RU wording exists for PILOT_CARD_TEXT.share_rank_unknown and is actually Russian — got "${ru}"`);
  }
  // The QUEUE row reads a different table, and that table lives outside the two
  // bounded blocks this harness runs in a vm - so it is read off the file. A
  // missing key would print the bare wire code `fit_rank_unknown` in the list
  // next to the candidate's name, which is the same defect one surface over.
  {
    const entry = (lang) => new RegExp(
      "'crew_flow\\.fit_rank_unknown':'([^']+)'"
    ).exec(html.split('\n').filter((line) => line.includes("'crew_flow.fit_rank_unknown'"))[lang] || '');
    const enRow = entry(0), ruRow = entry(1);
    ok637(!!enRow && !/[Ѐ-ӿ]/.test(enRow[1]), 'No.637/S1b: the QUEUE row has an EN word for the refused figure');
    ok637(!!ruRow && /[Ѐ-ӿ]/.test(ruRow[1]), 'No.637/S1b: and a Russian one — a missing key prints the wire code beside a person\'s name');
  }
  ctx.setLang('ru');
  ctx.__pilot.renderIntakePilot();
  const ruCard = fitCard('prof-A');
  ok637(!!ruCard && /[Ѐ-ӿ]/.test(ruCard) && !/%/.test(ruCard),
    'No.637/S1b: in Russian the card is Russian and still carries no figure');
  ctx.setLang('en');
  ctx.__pilot.renderIntakePilot();
}

// ===== No.637 / S1c: the FOURTH form of the figure leaves the card too ========
//
// S1b removed the percentage and the "M of N checks met" caption from a row
// whose post nobody could read, and said so plainly: the counts line was LEFT
// («Не выполнено: N · Не подтверждено: M»). Measured afterwards on the rendered
// bytes: that line prints «Не выполнено: 0 · Не подтверждено: 0» right beside
// the words "должность не установлена". Two zeros next to a sentence saying
// nothing was established read as "he lacks nothing" — a measurement nobody
// made, which is half of what the owner complained about in No.622.
//
// The counts have no honest value here in EITHER direction, and that is why the
// block goes rather than its numbers:
//   * from the server AFTER S1c the lists arrive EMPTY, so the line is zeros;
//   * from a pilot server of an OLDER build they still arrive full, so the line
//     is the original lie — "Not met: 0 · Unconfirmed: 1" about an unmeasured
//     person. The client must refuse in both cases, and both are driven below.
//
// What stands in its place is NOT a blank: the applicability line, already
// rendered and already asserted above, says which unknown it is next to the
// button (930 principle 1 keeps unknowns beside the decision).
console.log('\n# No.637/S1c: the counts block is not drawn for a post nobody could read');
{
  const ok1c = softOk;
  // TWO servers in one block, because the skew is the point.
  const scenarios = [
    ['server AFTER S1c (lists emptied on the wire)', (row) => Object.assign({}, row, {
      met: [], missing: [], unconfirmed: [], reasons: [], decided: false,
    })],
    ['an OLDER pilot server (lists still full)', (row) => row],
  ];
  for (const [label, shape] of scenarios) {
    const verdicts = {
      'prof-A': { applicability: 'unknown', applicability_reason: 'rank_absent' },
      'prof-B': { applicability: 'same', applicability_reason: null },
      'prof-C': { applicability: 'same', applicability_reason: null },
    };
    const srv = makeServer();
    const baseView = srv.ranksView.bind(srv);
    srv.ranksView = () => baseView().map((row) => {
      const verdict = verdicts[row.profile_id];
      if (!verdict) return row;
      return Object.assign({}, shape(row), verdict);
    });
    const ctx = makeContext({ server: srv });
    await positiveChainUntilRank(ctx);
    const fitCard = (id) => main(ctx).split('data-qa="pilot-fit-card"').slice(1)
      .find((part) => part.startsWith(` data-profile="${id}"`)) || null;
    const unknownCard = fitCard('prof-A');
    const knownCard = fitCard('prof-B');
    ok1c(!!unknownCard && !!knownCard,
      `No.637/S1c [${label}]: both cards are on the screen, so neither result can be reached by rendering nothing`);
    if (!unknownCard || !knownCard) continue;

    ok1c(!/class="cf-counts"/.test(unknownCard),
      `No.637/S1c [${label}]: the counts block is NOT drawn on the unreadable-post card`);
    ok1c(!/Not met:/.test(unknownCard) && !/Unconfirmed:/.test(unknownCard),
      `No.637/S1c [${label}]: and neither counter word is printed on it in any other shape`);
    // CALIBRATION, on the SAME screen and the SAME render: the readable card
    // keeps the block with its real numbers. Without this the assertion above
    // would also pass on a client that stopped drawing counts for everybody.
    ok1c(/class="cf-counts"/.test(knownCard),
      `No.637/S1c [${label}] CALIBRATION: the readable-post card still carries its counts block`);
    ok1c(/Not met:/.test(knownCard) && /Unconfirmed:/.test(knownCard),
      `No.637/S1c [${label}] CALIBRATION: with both counter words, in words`);
    // and S1b's properties still hold on the very same card
    ok1c(/data-qa="pilot-fit-applicability"[^>]*data-applicability="unknown"/.test(unknownCard),
      `No.637/S1c [${label}]: the reason stays where the counts were — the card is not left blank`);
    ok1c(/data-qa="pilot-fit-confirm"/.test(unknownCard),
      `No.637/S1c [${label}]: and the button the owner accepted is still on it`);
    ok1c(!/%/.test(unknownCard),
      `No.637/S1c [${label}]: still no percentage either (S1b, re-checked on this render)`);
  }
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
    // No.664/S2 (OWNER (985)): the owner answered the question Б1 held open —
    // the local export DOES carry the standardised details. They are read by one
    // named helper from the loaded card, never through the fact cache.
    const helper664 = (html.match(/function crewFlowApplicantSummary\([^)]*\) \{[\s\S]*?\n\}/) || [''])[0];
    softOk(helper664 !== '' && /response_summary/.test(helper664) && /crewFlowApplicantSummary\(/.test(save),
      'No.623/Б1 → No.664/Г2: the writer reads the delivered summary through crewFlowApplicantSummary, by the owner’s word (985)');
    softOk(!/facts\.nationality|facts\.email\b/.test(save + helper664),
      'No.623/Б1 → No.664/Г2: the two keys that never existed in the fact dictionary are gone');
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
      'resp_exp_other_rank', 'resp_exp_rank_unknown', 'resp_exp_not_provided', 'identity_failed',
      // No.632/S6: the label that now carries the post. Added to THIS list and
      // not to a new one: a key that names a person's post in front of a
      // customer must be under the same RU/EN completeness sensor as its
      // neighbours, or it ships in one language.
      'resp_exp_label_rank']) {
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

  // ---- 4b. No.632/S6: THE ROW IS READ BY A HUMAN -------------------------
  //
  // Two defects the stand showed only once FIVE live people stood in the list,
  // and neither was visible with one:
  //
  //   * the facts are inline <span>s with NOTHING between them, so the row
  //     renders «Возраст 38Гражданство Spanish (ES)Стаж …вложений: 1»;
  //   * the sea-time label says «Стаж в должности» and the VALUE repeats
  //     «в должности {rank}», so one line says «в должности» twice.
  //
  // Neither the separator nor the wording is invented here. ' · ' is the glyph
  // this product already joins values with (`pilotCardVesselText`), and
  // «Стаж в должности {rank}» / «Sea time as {rank}» is VERBATIM the letter's
  // own `pl_table_seatime` — the form the owner has already seen and accepted.
  {
    const strip = (html) => String(html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    const factsOf = (c, intakeId) => {
      const row = prowOf(c, intakeId) || '';
      const a = row.indexOf('<div class="ps-facts">');
      if (a < 0) return '';
      const b = row.indexOf('</div>', a);
      return strip(b < 0 ? row.slice(a) : row.slice(a, b));
    };
    const cellOf = (c, intakeId, key) => {
      const row = prowOf(c, intakeId) || '';
      const a = row.indexOf('data-qa="profile-shortlist-' + key + '"');
      if (a < 0) return '';
      const b = row.indexOf('</span></span>', a);
      return strip(b < 0 ? row.slice(a) : row.slice(a, b + 14));
    };
    let ruP = null;
    try { ruP = makeProfileContext({ language: 'ru' }); await flush(); } catch (e) { ruP = null; }
    const ruFacts = psafe(() => factsOf(ruP, 'intake-1')) || '';
    const enFacts = psafe(() => factsOf(pctx, 'intake-1')) || '';

    // CALIBRATION FIRST, both languages: every assertion below is about what
    // stands BETWEEN fields, and all of them would pass over an empty row.
    softOk(['Возраст', 'Гражданство', 'Стаж', 'Последнее судно', 'вложений'].every((w) => ruFacts.includes(w)),
      'No.632/S6 CALIBRATION: the RU row really renders all five facts, so the separator checks are not measuring a blank row — got «' + ruFacts + '»');
    softOk(['Age', 'Citizenship', 'Sea time', 'Last vessel', 'attachments'].every((w) => enFacts.includes(w)),
      'No.632/S6 CALIBRATION: the EN row really renders all five facts — got «' + enFacts + '»');

    // 1. SEPARATORS. Every field after the first is preceded by the separator.
    for (const label of ['Гражданство', 'Стаж в должности', 'Последнее судно', 'вложений']) {
      softOk(ruFacts.includes('· ' + label),
        'No.632/S6: RU — «' + label + '» is separated from the field before it, it does not grow out of it');
    }
    for (const label of ['Citizenship', 'Sea time', 'Last vessel', 'attachments']) {
      softOk(enFacts.includes('· ' + label),
        'No.632/S6: EN — «' + label + '» is separated from the field before it');
    }
    // the exact glue the stand showed, as a negative in both languages
    softOk(!/43Гражданство/.test(ruFacts) && !/\d[А-ЯЁ]/.test(ruFacts),
      'No.632/S6 NEGATIVE: RU — no value runs straight into the next field name («Возраст 43Гражданство …»)');
    softOk(!/43Citizenship/.test(enFacts) && !/\)[A-Z]/.test(enFacts),
      'No.632/S6 NEGATIVE: EN — no value runs straight into the next field name');

    // 2. THE DOUBLING. The post is named ONCE in the line, by the label.
    const ruExp = psafe(() => cellOf(ruP, 'intake-1', 'experience')) || '';
    const enExp = psafe(() => cellOf(pctx, 'intake-1', 'experience')) || '';
    softOk(ruExp.includes('Master') && /\d/.test(ruExp),
      'No.632/S6 CALIBRATION: the RU sea-time cell carries the post and a number, so the counting below is over a real sentence — got «' + ruExp + '»');
    softOk((ruExp.match(/в должности/g) || []).length === 1,
      'No.632/S6: RU — «в должности» is said ONCE in the sea-time line, not twice — got «' + ruExp + '»');
    softOk(/Стаж в должности Master 1 г\. 5 мес\./.test(ruExp),
      'No.632/S6: RU — the line reads «Стаж в должности Master 1 г. 5 мес.», the letter\'s own wording');
    softOk(/Sea time as Master 1 yr 5 mo/.test(enExp),
      'No.632/S6: EN — the line reads «Sea time as Master 1 yr 5 mo», the letter\'s own wording — got «' + enExp + '»');
    softOk(!/in post/.test(enExp),
      'No.632/S6 NEGATIVE: EN — the clumsy «in post …  as …» is gone from the sea-time line');

    // 3. The SAME line on the accepted candidate card, because ONE function
    // writes it for both surfaces. Leaving the card doubled while the row reads
    // correctly would be a second wording for one fact — exactly what this slice
    // is removing.
    for (const [lang, want, forbid] of [['ru', /Стаж в должности Master 3 г\. 2 мес\./, /в должности[\s\S]*в должности/],
                                        ['en', /Sea time as Master 3 yr 2 mo/, /in post/]]) {
      let cardCtx = null;
      try {
        const srv = makeServer();
        srv.card.response_summary = { rank: 'Master', rank_state: 'from_snapshot', first_name: 'Ivan', surname: 'Petrov',
          age_years: 41, age_precision: 'exact', citizenship: 'Ukraine', citizenship_code: 'UA',
          experience_rank: 'Master', experience_days: 1170, experience_state: 'matches_response_rank',
          last_vessel_name: 'MV Southern Cross', last_vessel_sign_off: '2026-03-14' };
        cardCtx = makeContext({ server: srv, language: lang });
        cardCtx.__pilot.pilotOpenCard('intake-A');
        await flush();
      } catch (e) { cardCtx = null; }
      const line = psafe(() => {
        const html = cardCtx.nodes.get('main').innerHTML;
        const a = html.indexOf('data-qa="pilot-response-experience"');
        if (a < 0) return '';
        return strip(html.slice(a, html.indexOf('</div>', a)));
      }) || '';
      softOk(line.includes('Master'),
        'No.632/S6 CALIBRATION: the ' + lang.toUpperCase() + ' card line carries the post — got «' + line + '»');
      softOk(want.test(line),
        'No.632/S6: the accepted card says it the same way as the row and the letter (' + lang.toUpperCase() + ') — got «' + line + '»');
      softOk(!forbid.test(line),
        'No.632/S6 NEGATIVE: the ' + lang.toUpperCase() + ' card line no longer repeats the post twice');
    }

    // 4. The OTHER-POST warning survives the move: the post is still named and
    // the two states still read differently.
    {
      let otherCtx = null;
      try {
        const srv = makeServer();
        srv.card.response_summary = { rank: 'Master', rank_state: 'from_snapshot', first_name: 'Ivan', surname: 'Petrov',
          age_years: 41, age_precision: 'exact', citizenship: 'Ukraine', citizenship_code: 'UA',
          experience_rank: 'Chief Officer', experience_days: 1170, experience_state: 'other_rank',
          last_vessel_name: 'MV Southern Cross', last_vessel_sign_off: '2026-03-14' };
        otherCtx = makeContext({ server: srv, language: 'ru' });
        otherCtx.__pilot.pilotOpenCard('intake-A');
        await flush();
      } catch (e) { otherCtx = null; }
      const line = psafe(() => {
        const html = otherCtx.nodes.get('main').innerHTML;
        const a = html.indexOf('data-qa="pilot-response-experience"');
        return a < 0 ? '' : strip(html.slice(a, html.indexOf('</div>', a)));
      }) || '';
      softOk(line.includes('Chief Officer'),
        'No.632/S6: a sea time counted for ANOTHER post still names that post');
      softOk(/не та, на которую отклик/.test(line),
        'No.632/S6: and still carries the warning that it is not the post responded on — the move of the rank did not flatten two states into one');
    }
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

// ===== No.637 / S2: the profile a PERSON CHOSE keeps its button ================
//
// The owner's word, DECISIONS (975) point 5: a response from Skipi is a pair
// TWO SIDES ALREADY AGREED ON, because `GET /published-profiles` delivers a
// vacancy to a seafarer only when his own rank matches it ("боцману боцманские,
// капитанские не доставляются"). The server of S2 therefore stops refusing the
// shortlist for that one profile and stops calling its row out of date.
//
// The client re-implemented the refusal independently (N21 of No.622: `fit.hidden`
// -> "По этому профилю в шортлист не добавляем"), so a server-only change would
// have left the operator looking at a note where the button belongs - the same
// "two truths, two screens" this family of cards exists to remove.
//
// WHAT IS NOT CHANGED, and it is asserted rather than promised: the verdict is
// still rendered next to the button. Protection means "not hidden and not
// devalued", never "declared a match" (docs/CANON-ui-v1.md, principle 1: a
// mismatch stands BESIDE the decision). A profile NOBODY chose keeps every
// behaviour it has: out of the main list, into the withheld disclosure, no
// button at all. And the SOURCE decides: a letter's first context is not a
// choice, so an `inbound` card keeps the blocked note.
console.log('\n# No.637/S2: the vacancy he actually applied to - visible, honest, and still pressable');
{
  const ok637s2 = softOk;
  const verdicts = {
    'prof-A': { applicability: 'not_applicable', applicability_reason: null },
    'prof-B': { applicability: 'not_applicable', applicability_reason: null },
    'prof-C': { applicability: 'same', applicability_reason: null },
  };
  const build = async (source) => {
    const srv = makeServer();
    srv.card.source = source;
    srv.card.primary_profile_id = 'prof-A';
    const baseView = srv.ranksView.bind(srv);
    // The S2 server: the CHOSEN row is not stale, the one nobody chose is.
    srv.ranksView = () => baseView().map((row) => Object.assign({}, row, verdicts[row.profile_id] || {}, {
      stale: row.profile_id === 'prof-B',
      stale_reason: row.profile_id === 'prof-B' ? 'rank_not_applicable' : null,
    }));
    const ctx = makeContext({ server: srv });
    await positiveChainUntilRank(ctx);
    return ctx;
  };
  // THE EXTRACTOR, and it is calibrated below before anything is concluded from
  // it. The first version cut the fragment at `</div></div>`, which is the end
  // of the FIRST requirement list inside the row - so the actions never reached
  // the regex and every button assertion was a verdict about a truncated string.
  // It read red for the right reason by accident; "а потом проверь зонд на
  // заведомо известном факте" is the rule that caught it.
  const wholeRow = (ctx, id) => {
    const parts = main(ctx).split('<div class="pilot-rank-row" data-qa="pilot-rank-row"');
    const part = parts.slice(1).find((p) => p.startsWith(` data-profile="${id}"`));
    if (!part) return null;
    const cut = part.indexOf('<details class="cf-brk"');
    return cut === -1 ? part : part.slice(0, cut);
  };

  const ctx = await build('skipi_response');
  const chosenRow = wholeRow(ctx, 'prof-A');
  const controlRow = wholeRow(ctx, 'prof-C');
  const strangerRow = wholeRow(ctx, 'prof-B');

  ok637s2(!!chosenRow,
    'No.637/S2: the vacancy he responded to HAS a detailed row even though the rank does not apply - hiding what a person asked for is worse than showing an evaluation he must read carefully');
  ok637s2(!!controlRow,
    'CALIBRATION: an applicable profile is on the same screen, so none of this can be passed by rendering nothing');
  ok637s2(strangerRow === null,
    'CALIBRATION: a profile NOBODY chose and the rank does not apply to is still out of the main list - S2 lifts the rule for ONE row, not for everybody');

  // CALIBRATION OF THE EXTRACTOR ITSELF, on a fact that is already known: an
  // APPLICABLE profile has carried "Добавить в шортлист" since No.622 and
  // carries it on the base of this slice. If this is false the extractor is
  // broken and every assertion under it is a verdict about a cut string.
  ok637s2(!!controlRow && /data-qa="pilot-confirm"/.test(controlRow),
    'CALIBRATION of the probe: the APPLICABLE row carries the add button (true on the base too) - without this the button checks below would pass or fail on a truncated fragment');

  if (chosenRow && controlRow) {
    // ---- 1. the button is back, and it is wired to ITS OWN pair ----------
    ok637s2(/data-qa="pilot-confirm"/.test(chosenRow),
      'No.637/S2: the chosen row offers "Добавить в шортлист" - (975) p.5, the server accepts this exact pair now');
    ok637s2(!/data-qa="pilot-confirm-blocked"/.test(chosenRow),
      'No.637/S2: and NOT the "cannot be shortlisted" note - a note where the owner asked for a button is the client contradicting the server');
    ok637s2(/data-qa="pilot-confirm"[^>]*onclick="pilotShortlistConfirm\('prof-A',1\)"/.test(chosenRow),
      'No.637/S2: wired to the pair of ITS OWN row, never to the profile the operator was looking past');

    // ---- 2. and the mismatch is READ, right there (930 principle 1) ------
    ok637s2(/data-qa="pilot-rank-applicability"[^>]*data-applicability="not_applicable"/.test(chosenRow),
      'No.637/S2: the verdict is rendered on the same row - protection is "not hidden and not devalued", NEVER "declared a match"');
    const applicText = (row) => {
      const m = String(row).match(/data-qa="pilot-rank-applicability"[^>]*>([\s\S]*?)<\/span>/);
      return m ? m[1].replace(/\s+/g, ' ').trim() : '';
    };
    ok637s2(applicText(chosenRow).length > 5 && !/^[a-z_]+$/.test(applicText(chosenRow)),
      `No.637/S2: and it is a sentence for a person, not the wire code - got "${applicText(chosenRow)}"`);
    ok637s2(!/data-qa="pilot-rank-stale"/.test(chosenRow),
      'No.637/S2: the row is not stamped "должность не подходит - оценка сохранена как история" either: the server stopped sending that reason for this row');
    ok637s2(/data-qa="pilot-rank-origin"[^>]*data-origin="response"/.test(chosenRow),
      'No.637/S2: and the row says WHY it is first - he responded to it');

    // ---- 3. the withheld disclosure still names the one nobody chose -----
    const withheldIds = (main(ctx).match(/data-qa="pilot-withheld-row" data-profile="([^"]+)"/g) || [])
      .map((m) => m.replace(/.*data-profile="/, '').replace(/"$/, ''));
    ok637s2(withheldIds.includes('prof-B'),
      'No.637/S2: the profile nobody chose is NAMED in the withheld disclosure - a counter with no names cannot be acted on');
    ok637s2(!withheldIds.includes('prof-A'),
      'No.637/S2: and the chosen one is not in it, on either side of the union');
  }

  // ---- 4. BOTH shipped languages, on the rendered bytes ------------------
  for (const lang of ['ru', 'en']) {
    const lctx = await build('skipi_response');
    lctx.setLang(lang);
    lctx.__pilot.renderIntakePilot();
    const row = wholeRow(lctx, 'prof-A');
    const m = row && row.match(/data-qa="pilot-rank-applicability"[^>]*>([\s\S]*?)<\/span>/);
    const text = m ? m[1].replace(/\s+/g, ' ').trim() : '';
    const cyrillic = /[Ѐ-ӿ]/.test(text);
    ok637s2(!!row && /data-qa="pilot-confirm"/.test(row),
      `[${lang}] No.637/S2: the button is there in this language too`);
    ok637s2(text.length > 5 && (lang === 'ru' ? cyrillic : !cyrillic),
      `[${lang}] No.637/S2: the mismatch is spelled out in this language - got "${text}"`);
  }

  // ---- 5. THE BOUNDARY OF THE SOURCE, measured and not promised ----------
  // `primary_profile_id` is the same value on a letter, and it means something
  // else there: the FIRST CONTEXT of the alias, which nobody chose. The client
  // already tells the two apart (`cardResponseOrigin`), and S2 must ask THAT
  // question rather than the bare id - otherwise the fix walks onto the post.
  const mailCtx = await build('inbound');
  const mailRow = wholeRow(mailCtx, 'prof-A');
  ok637s2(!!mailRow,
    'a letter\'s first-context profile is still shown (that behaviour predates S2 and is untouched)');
  ok637s2(!!mailRow && /data-qa="pilot-confirm-blocked"/.test(mailRow),
    'No.637/S2 BOUNDARY: on a LETTER the blocked note stays - the alias\' first context is "a label, not an authority" and the server still answers 409 for it');
  ok637s2(!!mailRow && !/data-qa="pilot-confirm"/.test(mailRow),
    'No.637/S2 BOUNDARY: and no button that would lead to a refusal');
}

// ===========================================================================
// No.637 / S4 — FOUR screen defects of the unreadable post, one candidate.
//
//   No.644  the detailed row printed "Сопоставление не завершено: есть
//           невыполненные или неподтверждённые требования" over a row where
//           NOTHING was measured. Not an imprecision: a statement about
//           requirements nobody compared.
//   No.642  every active profile got its own card, so twenty profiles meant
//           twenty identical cards saying the same unknown twenty times.
//           The group below is ONE disclosure — and the sentence it is folded
//           under is ON the main screen, in the <summary>, with the count and
//           the next action, because docs/CANON-ui-v1.md forbids hiding the
//           unknown ITSELF. What is folded is the REPETITION.
//   No.650  the draft letter skipped the profile the seafarer responded to
//           whenever the rank did not apply to it, and quietly offered him a
//           different vacancy — after S2 put him on the shortlist of the one
//           he chose.
//   No.647  the offer sentence changed as a SIDE EFFECT of S1c emptying
//           `reasons`. Both branches are pinned here, and the client stops
//           depending on the server having emptied them.
//
// Everything below reads the RENDERED markup. The one place a function is
// called directly (`cardDraftProfileId`) is also asserted through the rendered
// draft, because No.640 and the S2 extractor both proved that a check on an
// adapter's input is not a check on what a person sees.
// ===========================================================================
console.log('\n# No.637/S4: the unread post stops lying, stops repeating itself, and stops writing the wrong letter');
{
  const okS4 = softOk;
  const S4_UNKNOWN = { applicability: 'unknown', applicability_reason: 'rank_unreadable' };
  const S4_SAME = { applicability: 'same', applicability_reason: null };
  const S4_NA = { applicability: 'not_applicable', applicability_reason: null };
  const s4Profiles = (n) => Array.from({ length: n }, (_, i) => {
    const letter = String.fromCharCode(65 + i);
    return { id: `prof-${letter}`, crewing_id: 'crew-synthetic', name: `Master · ${letter}`, version: 1, state: 'active', rank: 'Master', certs: ['coc_master'] };
  });
  // The S1c server, in the shape it actually ships: an `unknown` row carries
  // no figures and no reasons. A fixture that kept them would be testing a
  // server nobody runs — and branch C below tests exactly that skew, on purpose.
  async function s4Build({ profiles = 3, verdicts = {}, source = 'skipi_response', chosen = null, language = 'en' } = {}) {
    const srv = makeServer({ profiles: s4Profiles(profiles) });
    srv.card.source = source;
    srv.card.primary_profile_id = chosen;
    const baseView = srv.ranksView.bind(srv);
    srv.ranksView = () => baseView().map((row) => {
      const v = verdicts[row.profile_id] || S4_SAME;
      const out = Object.assign({}, row, v);
      if (v.applicability === 'unknown') return Object.assign(out, { met: [], missing: [], unconfirmed: [], reasons: [], decided: false });
      return out;
    });
    const ctx = makeContext({ server: srv, language });
    await positiveChainUntilRank(ctx);
    return ctx;
  }
  const allUnknown = (n) => Object.fromEntries(s4Profiles(n).map((p) => [p.id, S4_UNKNOWN]));
  // Section cutters: the card holds TWO surfaces that render the same rows, and
  // the whole point of No.642 is that a fix on one of them is not a fix.
  const section = (html, qa, nextQa) => {
    const s = html.indexOf(`<section class="pilot-card" data-qa="${qa}"`);
    if (s < 0) return null;
    const e = html.indexOf(`<section class="pilot-card" data-qa="${nextQa}"`, s);
    return e < 0 ? html.slice(s) : html.slice(s, e);
  };
  const fitSection = (ctx) => section(main(ctx), 'pilot-section-fit', 'pilot-section-source');
  const ranksSection = (ctx) => section(main(ctx), 'pilot-section-ranks', 'pilot-section-history');
  // What stands BEFORE the group opens — i.e. what the operator sees without
  // clicking anything. Cutting at the group's own marker, not at a generic tag.
  const beforeGroup = (src) => {
    const i = String(src || '').indexOf('data-qa="pilot-rank-unread"');
    return i < 0 ? String(src || '') : String(src).slice(0, i);
  };
  const insideGroup = (src) => {
    const i = String(src || '').indexOf('data-qa="pilot-rank-unread"');
    if (i < 0) return '';
    const rest = String(src).slice(i);
    const e = rest.indexOf('</details>');
    return e < 0 ? rest : rest.slice(0, e);
  };
  const count = (src, re) => (String(src || '').match(re) || []).length;

  // ---- CALIBRATION of the cutters themselves, on facts known before S4 ----
  // Three applicable profiles: three cards, three rows, and no group at all.
  {
    const ctx = await s4Build({ profiles: 3 });
    okS4(count(fitSection(ctx), /data-qa="pilot-fit-card"/g) === 3,
      'CALIBRATION of the probe: three APPLICABLE profiles still render three fit cards (true on the base) — without this every count below is a verdict about a mis-cut string');
    okS4(count(ranksSection(ctx), /data-qa="pilot-rank-row"/g) === 3,
      'CALIBRATION of the probe: and three detailed rows');
    okS4(count(main(ctx), /data-qa="pilot-rank-unread"/g) === 0,
      'CALIBRATION: no group is drawn when there is nothing unread — S4 adds a block for ONE verdict, not a wrapper around everything');
    okS4(/data-qa="pilot-fit-pct" data-pct="\d+"/.test(fitSection(ctx)),
      'CALIBRATION: the applicable profiles keep their figure — S4 changes no arithmetic at all');
  }

  // =========================== No.644 ====================================
  {
    const verdicts = { 'prof-A': S4_UNKNOWN, 'prof-B': S4_SAME, 'prof-C': S4_SAME };
    const ctx = await s4Build({ profiles: 3, verdicts });
    const rowOf = (ctx2, id) => {
      const parts = main(ctx2).split('<div class="pilot-rank-row" data-qa="pilot-rank-row"');
      const part = parts.slice(1).find((p) => p.startsWith(` data-profile="${id}"`));
      if (!part) return null;
      const cut = part.indexOf('<div class="pilot-rank-row" data-qa="pilot-rank-row"');
      return cut === -1 ? part : part.slice(0, cut);
    };
    const decidedOf = (row) => {
      const m = String(row || '').match(/data-qa="pilot-rank-decided"[^>]*>([\s\S]*?)<\/div>/);
      return m ? m[1].replace(/\s+/g, ' ').trim() : '';
    };
    const unknownRow = rowOf(ctx, 'prof-A');
    okS4(!!unknownRow, 'No.637/S4 (644): the unread row is still rendered somewhere — the sentence is replaced, the person is not removed');
    okS4(!!unknownRow && decidedOf(unknownRow).length > 0,
      'No.637/S4 (644): and it still carries a sentence about the state of the comparison — a blank is not an honest answer either');
    okS4(!/невыполненные или неподтверждённые/.test(decidedOf(unknownRow)) && !/not met or not confirmed/.test(decidedOf(unknownRow)),
      `No.637/S4 (644): the row no longer claims there ARE unmet or unconfirmed requirements — nothing was measured. Got: "${decidedOf(unknownRow)}"`);
    okS4(/not read|не прочитана/.test(decidedOf(unknownRow)) && /by hand|ручная проверка/.test(decidedOf(unknownRow)),
      `No.637/S4 (644): it says the post was not read and names the next action. Got: "${decidedOf(unknownRow)}"`);
    // CALIBRATION on the same screen: the sentence that is TRUE stays.
    const openRow = rowOf(ctx, 'prof-B');
    okS4(!!openRow && /Every stated requirement is compared/.test(decidedOf(openRow)),
      `CALIBRATION: a row that WAS compared keeps its own sentence — 644 replaces one sentence for one verdict, not the vocabulary. Got: "${decidedOf(openRow)}"`);
    // ---- both shipped languages, on the rendered bytes ----
    for (const language of ['ru', 'en']) {
      const lctx = await s4Build({ profiles: 3, verdicts, language });
      const text = decidedOf(rowOf(lctx, 'prof-A'));
      const cyrillic = /[Ѐ-ӿ]/.test(text);
      okS4(text.length > 10 && (language === 'ru' ? cyrillic : !cyrillic),
        `[${language}] No.637/S4 (644): the honest sentence exists in this language — got "${text}"`);
      okS4(!/невыполненные или неподтверждённые/.test(text) && !/not met or not confirmed/.test(text),
        `[${language}] No.637/S4 (644): and the false one is gone in this language too`);
    }
  }

  // =========================== No.642 ====================================
  {
    const N = 20;
    const ctx = await s4Build({ profiles: N, verdicts: allUnknown(N), source: 'inbound', chosen: null });
    const fit = fitSection(ctx), ranks = ranksSection(ctx);
    okS4(count(main(ctx), /data-qa="pilot-rank-unread"/g) === 2,
      `No.637/S4 (642): the unread profiles are gathered into ONE block on EACH of the two surfaces that used to repeat them — got ${count(main(ctx), /data-qa="pilot-rank-unread"/g)}`);
    okS4(count(beforeGroup(fit), /data-qa="pilot-fit-card"/g) === 0,
      `No.637/S4 (642): not one of the ${N} identical cards is left loose on the main screen — got ${count(beforeGroup(fit), /data-qa="pilot-fit-card"/g)}`);
    okS4(count(beforeGroup(ranks), /data-qa="pilot-rank-row"/g) === 0,
      `No.637/S4 (642): and none of the ${N} identical detailed rows either — got ${count(beforeGroup(ranks), /data-qa="pilot-rank-row"/g)}`);
    // THE OWNER'S REQUIREMENT, and it is the one that may never be traded for
    // a tidier screen: nobody disappears.
    okS4(count(insideGroup(fit), /data-qa="pilot-fit-card"/g) === N,
      `No.637/S4 (642): all ${N} profiles are INSIDE the block — got ${count(insideGroup(fit), /data-qa="pilot-fit-card"/g)}`);
    okS4(count(insideGroup(ranks), /data-qa="pilot-rank-row"/g) === N,
      `No.637/S4 (642): and all ${N} detailed rows — got ${count(insideGroup(ranks), /data-qa="pilot-rank-row"/g)}`);
    const named = s4Profiles(N).every((p) => insideGroup(fit).includes(`data-profile="${p.id}"`));
    okS4(named, 'No.637/S4 (642): every one of them is NAMED, by profile id — a counter with no names is the defect this card already removed once');
    okS4(count(insideGroup(fit), /data-qa="pilot-fit-confirm"/g) === N
      && count(insideGroup(ranks), /data-qa="pilot-confirm"/g) === N,
      'No.637/S4 (642): and the "Add to shortlist" button is reachable for each of them inside the block');
    okS4(!/data-qa="pilot-ranks-empty"/.test(ranks) && !/data-qa="pilot-fit-none-applicable"/.test(fit),
      'No.637/S4 (642): and the screen never says "no stored comparisons" over a block that holds twenty of them');
    // The unknown ITSELF is not hidden: it is in the <summary>, which no click
    // is needed to read. docs/CANON-ui-v1.md principle 1, kept rather than traded.
    const summaryOf = (src) => {
      const m = String(src || '').match(/data-qa="pilot-rank-unread"[^>]*>\s*<summary>([\s\S]*?)<\/summary>/);
      return m ? m[1].replace(/\s+/g, ' ').trim() : '';
    };
    okS4(summaryOf(fit).length > 10 && /20/.test(summaryOf(fit)),
      `No.637/S4 (642): the count is on the main screen, in the summary, with no click — got "${summaryOf(fit)}"`);
    okS4(/not read|не прочитана/.test(summaryOf(fit)) && /manual check|ручная проверка/.test(summaryOf(fit)),
      `No.637/S4 (642): and so are the unknown and the next action — what is folded is the REPETITION, never the unknown. Got: "${summaryOf(fit)}"`);
    okS4(count(fit, /data-count="20"/g) >= 1 && count(ranks, /data-count="20"/g) >= 1,
      'No.637/S4 (642): the number is machine-readable on both surfaces, so the two can never drift apart silently');
    // PRESERVE, asserted on the rendered bytes of the group: nothing unread is
    // counted, and no percentage appears in any form.
    okS4(!/data-pct="\d/.test(insideGroup(fit)) && !/%/.test(insideGroup(fit)),
      'PRESERVE: not one percentage inside the block — folding the repetition must not smuggle a figure back');
    okS4(!/checks met, by the stored evaluation/.test(insideGroup(fit)) && !/из \d+ по сохранённой оценке/.test(insideGroup(fit)),
      'PRESERVE: nor the "M of N checks met" caption, which is the same claim written differently');
    // ---- both shipped languages ----
    for (const language of ['ru', 'en']) {
      const lctx = await s4Build({ profiles: N, verdicts: allUnknown(N), source: 'inbound', chosen: null, language });
      const s = summaryOf(fitSection(lctx));
      const cyrillic = /[Ѐ-ӿ]/.test(s);
      okS4(s.length > 10 && (language === 'ru' ? cyrillic : !cyrillic) && /20/.test(s),
        `[${language}] No.637/S4 (642): the block announces itself in this language — got "${s}"`);
    }
  }

  // ---- No.642 meets S2: the profile HE CHOSE is not folded away ----------
  {
    const N = 20;
    const ctx = await s4Build({ profiles: N, verdicts: allUnknown(N), source: 'skipi_response', chosen: 'prof-A' });
    const fit = fitSection(ctx), ranks = ranksSection(ctx);
    okS4(/data-qa="pilot-fit-card" data-profile="prof-A"/.test(beforeGroup(fit)),
      'PRESERVE (S2): the vacancy he responded to stays the headline card on the main screen, unread post or not');
    okS4(/data-qa="pilot-rank-row" data-profile="prof-A"/.test(beforeGroup(ranks)),
      'PRESERVE (S2): and the headline detailed row');
    okS4(count(beforeGroup(fit), /data-qa="pilot-fit-card"/g) === 1,
      `PRESERVE (S2): exactly ONE card stands loose — his own; the other ${N - 1} are folded — got ${count(beforeGroup(fit), /data-qa="pilot-fit-card"/g)}`);
    okS4(/data-qa="pilot-fit-confirm"[^>]*onclick="pilotShortlistConfirm\('prof-A',1\)"/.test(beforeGroup(fit)),
      'PRESERVE (S2): with the add button wired to his own pair, right there');
    okS4(/data-origin="response"/.test(beforeGroup(fit)),
      'PRESERVE (S2): and the row still says WHY it is first — he responded to it');
    okS4(count(insideGroup(fit), /data-qa="pilot-fit-card"/g) === N - 1
      && !insideGroup(fit).includes('data-profile="prof-A"'),
      'No.637/S4 (642): the block holds the other nineteen and not him');
    // The accepted shortlist chain, LIVE, on the chosen unread profile: add,
    // then the repeat is refused before the press rather than after it.
    await ctx.__pilot.pilotShortlistConfirm('prof-A', 1); await flush();
    okS4(/data-qa="pilot-fit-onlist"/.test(beforeGroup(fitSection(ctx))),
      'PRESERVE (632/975): "already on the shortlist" appears on his card after the add — the accepted chain still runs through an unread post');
    okS4(!/data-qa="pilot-fit-confirm"[^>]*onclick="pilotShortlistConfirm\('prof-A',1\)"/.test(beforeGroup(fitSection(ctx))),
      'PRESERVE (632): and the duplicate press is removed BEFORE it is made, not refused after it');
  }

  // =========================== No.650 ====================================
  {
    const verdicts = { 'prof-A': S4_NA, 'prof-B': S4_NA, 'prof-C': S4_SAME };
    const ctx = await s4Build({ profiles: 3, verdicts, source: 'skipi_response', chosen: 'prof-A' });
    okS4(ctx.__pilot.cardDraftProfileId() === 'prof-A',
      `No.637/S4 (650): the draft defaults to the vacancy he responded to, applicable or not — got "${ctx.__pilot.cardDraftProfileId()}"`);
    // ...and the same answer READ OFF THE RENDERED DRAFT, because a function
    // returning the right id proves nothing about the letter a person sends.
    ctx.__pilot.pilotDraftOpen('intake-A', 'reply'); await flush();
    const draft = main(ctx).slice(main(ctx).indexOf('data-qa="pilot-draft"'));
    const bodyOf = (src) => {
      const m = String(src || '').match(/data-qa="pilot-draft-body"[^>]*>([\s\S]*?)<\/textarea>/);
      return m ? m[1] : '';
    };
    const subjectOf = (src) => {
      const m = String(src || '').match(/data-qa="pilot-draft-subject"[^>]*value="([^"]*)"/);
      return m ? m[1] : '';
    };
    okS4(/Master · A/.test(bodyOf(draft)) && !/Master · C/.test(bodyOf(draft)),
      `No.637/S4 (650): the RENDERED letter names his own vacancy and not the one the client picked for him — got "${bodyOf(draft).replace(/\s+/g, ' ').slice(0, 160)}"`);
    okS4(/Master · A/.test(subjectOf(draft)),
      `No.637/S4 (650): and so does the subject line — got "${subjectOf(draft)}"`);
    okS4(/<option value="prof-A" selected>/.test(draft),
      'No.637/S4 (650): the profile selector opens on his vacancy, so the operator sees which one the letter is about');
    // THE BOUNDARY, measured rather than promised: on a LETTER the same id means
    // the first context of an alias, which nobody chose, and the old rule holds.
    const mail = await s4Build({ profiles: 3, verdicts, source: 'inbound', chosen: 'prof-A' });
    okS4(mail.__pilot.cardDraftProfileId() === 'prof-C',
      `No.637/S4 (650) BOUNDARY: a letter still skips a profile the rank does not apply to — "a label, not an authority". Got "${mail.__pilot.cardDraftProfileId()}"`);
    // And the operator's own choice still wins over both.
    ctx.__pilot.pilotDraftProfile('prof-C'); await flush();
    okS4(ctx.__pilot.cardDraftProfileId() === 'prof-C',
      'No.637/S4 (650): an operator who switches the profile by hand keeps his choice — the default is a default');
  }

  // =========================== No.647 ====================================
  {
    const bodyRendered = async (verdicts, opts = {}) => {
      const ctx = await s4Build(Object.assign({ profiles: 1, verdicts, source: 'skipi_response', chosen: 'prof-A' }, opts));
      if (opts.skew) {
        // A server that still sends reasons on an `unknown` row: an older build,
        // a cached row, another deployment. The client must not read a post out
        // of a payload whose own verdict says the post was never read.
        ctx.__pilot.pilotDetail().ranks.items[0].reasons = [
          { requirement: 'rank', outcome: 'missing', wanted: 'Master', found: 'Qwerty' },
        ];
      }
      ctx.__pilot.pilotDraftOpen('intake-A', 'reply'); await flush();
      const src = main(ctx);
      const m = src.match(/data-qa="pilot-draft-body"[^>]*>([\s\S]*?)<\/textarea>/);
      return m ? m[1] : '';
    };
    const namesRank = (body, language) => (language === 'ru' ? /на позицию Master/ : /an opening for Master/).test(body);
    for (const language of ['ru', 'en']) {
      const hedged = language === 'ru' ? /может подойти по вашим документам/ : /an opening that may fit your documents/;
      const read = await bodyRendered({ 'prof-A': S4_SAME }, { language });
      okS4(namesRank(read, language),
        `[${language}] No.637/S4 (647) branch A: the post WAS read, so the letter names it — got "${read.replace(/\s+/g, ' ').slice(0, 140)}"`);
      const unread = await bodyRendered({ 'prof-A': S4_UNKNOWN }, { language });
      okS4(!namesRank(unread, language),
        `[${language}] No.637/S4 (647) branch B: the post was NOT read, so the letter does not name one — got "${unread.replace(/\s+/g, ' ').slice(0, 140)}"`);
      okS4(hedged.test(unread),
        `[${language}] No.637/S4 (647) branch B: and what it says instead is hedged and true — got "${unread.replace(/\s+/g, ' ').slice(0, 140)}"`);
      okS4(!/rank — |rank —/.test(unread),
        `[${language}] No.637/S4 (647) branch B: the requirements line does not reintroduce the post through the back door`);
      const skew = await bodyRendered({ 'prof-A': S4_UNKNOWN }, { language, skew: true });
      okS4(!namesRank(skew, language),
        `[${language}] No.637/S4 (647) branch C: a payload that still carries reasons on an unread post does NOT get its post into the letter — the property stops depending on the server having emptied them. Got "${skew.replace(/\s+/g, ' ').slice(0, 140)}"`);
      okS4(hedged.test(skew),
        `[${language}] No.637/S4 (647) branch C: and the hedged sentence stands there too`);
    }
  }
}

// ===========================================================================
// No.637 / S4b — two decisions taken by the manager on the S4 report (02.10).
//
//   (1) THE WARNING BESIDE THE DRAFT. No.650 made the draft default to the
//       vacancy he responded to even when the rank does not apply to it - which
//       is right, because he applied to it ((975) p.5) - and that put the
//       operator one press away from an offer our own comparison disagrees
//       with. docs/CANON-ui-v1.md principle 1: a missing or failed check stands
//       NEXT TO the decision and the button. It WARNS and does not block: the
//       send control stays, because blocking would undo (975) p.5.
//   (2) ONE VOCABULARY. The product said «должность не установлена» in four
//       places and «не прочитана» in the two S4 added. «Не установлена» reads
//       as "he did not state one"; «не прочитана» says what actually happened
//       and joins up with the next action. The OLD strings move to the new
//       word, not the other way round, and this block is what stops the two
//       from drifting apart again.
// ===========================================================================
console.log('\n# No.637/S4b: the warning beside the send button, and one word for one state');
{
  const okS4b = softOk;
  const U = { applicability: 'unknown', applicability_reason: 'rank_unreadable' };
  const SAME = { applicability: 'same', applicability_reason: null };
  const NA = { applicability: 'not_applicable', applicability_reason: null };
  async function build({ verdicts = {}, chosen = 'prof-A', source = 'skipi_response', language = 'en' } = {}) {
    const srv = makeServer();
    srv.card.source = source;
    srv.card.primary_profile_id = chosen;
    const baseView = srv.ranksView.bind(srv);
    srv.ranksView = () => baseView().map((row) => {
      const v = verdicts[row.profile_id] || SAME;
      const out = Object.assign({}, row, v);
      if (v.applicability === 'unknown') return Object.assign(out, { met: [], missing: [], unconfirmed: [], reasons: [], decided: false });
      return out;
    });
    const ctx = makeContext({ server: srv, language });
    await positiveChainUntilRank(ctx);
    ctx.__pilot.pilotDraftOpen('intake-A', 'reply');
    await flush();
    return ctx;
  }
  const draftOf = (ctx) => {
    const src = main(ctx), i = src.indexOf('data-qa="pilot-draft"');
    return i < 0 ? '' : src.slice(i);
  };
  const warnOf = (src) => {
    const m = String(src).match(/data-qa="pilot-draft-rank-warning"[^>]*>([\s\S]*?)<\/div>/);
    return m ? m[1].replace(/\s+/g, ' ').trim() : '';
  };

  // ---- (1) the warning ---------------------------------------------------
  {
    // CALIBRATION FIRST, on a fact known before this change: an APPLICABLE
    // profile draws no warning. Without it, a renderer that printed the line
    // unconditionally would pass every assertion below.
    const fine = await build({ verdicts: { 'prof-A': SAME, 'prof-B': SAME, 'prof-C': SAME } });
    okS4b(!!draftOf(fine) && /data-qa="pilot-draft-body"/.test(draftOf(fine)),
      'CALIBRATION of the probe: the draft panel renders at all, with its body - every check below reads this fragment');
    okS4b(warnOf(draftOf(fine)) === '',
      `CALIBRATION: an applicable profile draws NO warning - the line is a verdict, not decoration. Got "${warnOf(draftOf(fine))}"`);

    const bad = await build({ verdicts: { 'prof-A': NA, 'prof-B': NA, 'prof-C': SAME } });
    const d = draftOf(bad);
    okS4b(/data-qa="pilot-draft-rank-warning"/.test(d),
      'No.637/S4b: the draft for a vacancy the rank does NOT apply to carries the warning');
    okS4b(/data-applicability="not_applicable"/.test(d.slice(d.indexOf('pilot-draft-rank-warning'))),
      'No.637/S4b: machine-readable, so it cannot drift from the verdict it reports');
    okS4b(/check before sending/.test(warnOf(d)),
      `No.637/S4b: it tells the operator what to do BEFORE the press — got "${warnOf(d)}"`);
    okS4b(/was not matched|did not pass/.test(warnOf(d)) && /the rank does not apply/.test(warnOf(d)),
      `No.637/S4b: and WHICH problem it is, in the vocabulary the rest of the card already uses — got "${warnOf(d)}"`);
    // IT WARNS AND DOES NOT BLOCK. (975) p.5: he applied to this vacancy.
    okS4b(/data-qa="pilot-draft-body"/.test(d) && /data-qa="pilot-draft-subject"/.test(d),
      'No.637/S4b: the letter itself is still there - this is a warning, not a refusal');
    okS4b(/data-qa="pilot-draft-need-contact"/.test(d) || /data-qa="pilot-draft-open-client"/.test(d) || /data-qa="pilot-draft-mailto"/.test(d) || /data-qa="pilot-draft-copy"/.test(d),
      'No.637/S4b: and the way out of the draft is still offered - blocking would undo (975) p.5, which put him on this profile deliberately');
    okS4b(d.indexOf('pilot-draft-rank-warning') > d.indexOf('pilot-draft-body'),
      'No.637/S4b: the warning stands AFTER the letter text, i.e. between what he would send and the control that sends it - "рядом с решением и с кнопкой" literally');

    // the unknown gets the same line, and says which unknown it is
    const unread = await build({ verdicts: { 'prof-A': U, 'prof-B': U, 'prof-C': SAME } });
    const du = draftOf(unread);
    okS4b(/data-qa="pilot-draft-rank-warning"/.test(du),
      'No.637/S4b: an UNREAD rank warns too - (930) names неизвестность beside the decision in the same breath as errors');
    okS4b(/the rank was not read/.test(warnOf(du)) && /nobody could place it/.test(warnOf(du)),
      `No.637/S4b: and it names WHICH unknown - "no rank recorded" and "nobody could place the one he has" are different next actions. Got "${warnOf(du)}"`);

    // both shipped languages, on the rendered bytes
    for (const language of ['ru', 'en']) {
      const lctx = await build({ verdicts: { 'prof-A': NA, 'prof-B': NA, 'prof-C': SAME }, language });
      const text = warnOf(draftOf(lctx));
      const cyrillic = /[Ѐ-ӿ]/.test(text);
      okS4b(text.length > 20 && (language === 'ru' ? cyrillic : !cyrillic),
        `[${language}] No.637/S4b: the warning exists in this language — got "${text}"`);
      okS4b(language === 'ru' ? /проверьте перед отправкой/.test(text) : /check before sending/.test(text),
        `[${language}] No.637/S4b: with the action named in this language`);
    }
  }

  // ---- (2) one vocabulary, on the RENDERED bytes of every surface ---------
  {
    const WORD = { ru: /не прочитана/, en: /was not read/ };
    const OLD = { ru: /не установлена/, en: /(was|be) not established|not be established/ };
    for (const language of ['ru', 'en']) {
      const ctx = await build({ verdicts: { 'prof-A': U, 'prof-B': U, 'prof-C': SAME }, chosen: null, source: 'inbound', language });
      const src = main(ctx);
      // THE PROBE IS SCOPED, and the first version of it was not. Reading the
      // FIRST match in the document returned the APPLICABLE profile's row
      // («должность совпадает»), which carries neither the old word nor the new
      // one - so every assertion under it would have been a verdict about the
      // wrong node, and after the change it would have gone quietly green for
      // the wrong reason. Caught by the red output before anything was
      // concluded; the two calibrations below are what keep it caught.
      const groupOf = (sectionQa, nextQa) => {
        const i = src.indexOf(`<section class="pilot-card" data-qa="${sectionQa}"`);
        if (i < 0) return '';
        const j = src.indexOf(`<section class="pilot-card" data-qa="${nextQa}"`, i);
        const sec = j < 0 ? src.slice(i) : src.slice(i, j);
        const g = sec.indexOf('data-qa="pilot-rank-unread"');
        if (g < 0) return '';
        const rest = sec.slice(g), e = rest.indexOf('</details>');
        return e < 0 ? rest : rest.slice(0, e);
      };
      const fitGroup = groupOf('pilot-section-fit', 'pilot-section-source');
      const ranksGroup = groupOf('pilot-section-ranks', 'pilot-section-history');
      okS4b(/data-profile="prof-A"/.test(fitGroup) && /data-profile="prof-B"/.test(fitGroup),
        `[${language}] CALIBRATION of the probe: the two UNREAD profiles are the ones inside the scope`);
      okS4b(!/data-profile="prof-C"/.test(fitGroup),
        `[${language}] CALIBRATION of the probe: and the APPLICABLE profile is NOT - that row is what the unscoped probe was reading`);
      const pieces = {
        'the verdict line on the fit card': (fitGroup.match(/data-qa="pilot-fit-applicability"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '',
        'the caption where the figure is refused': (fitGroup.match(/data-qa="pilot-fit-pct" data-pct="none">[\s\S]*?<div class="cf-fitcard-cap">([\s\S]*?)<\/div>/) || [])[1] || '',
        'the verdict line on the detailed row': (ranksGroup.match(/data-qa="pilot-rank-applicability"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '',
        'the sentence replacing "comparison incomplete"': (ranksGroup.match(/data-qa="pilot-rank-decided"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '',
        'the summary of the folded block': (ranksGroup.match(/data-qa="pilot-rank-unread"[^>]*>\s*<summary>([\s\S]*?)<\/summary>/) || [])[1] || '',
      };
      for (const [name, text] of Object.entries(pieces)) {
        okS4b(text.length > 5, `[${language}] CALIBRATION: ${name} was actually found in the rendered markup`);
        okS4b(WORD[language].test(text), `[${language}] No.637/S4b: ${name} uses the one word — got "${text.replace(/\s+/g, ' ').trim()}"`);
        okS4b(!OLD[language].test(text), `[${language}] No.637/S4b: and not the old one — got "${text.replace(/\s+/g, ' ').trim()}"`);
      }
      // the two surfaces that do NOT render in this sandbox, read from the file
      const stale = ctx.__pilot.PILOT_CARD_STALE_TEXT.rank_unknown[language === 'ru' ? 0 : 1];
      okS4b(WORD[language].test(stale) && !OLD[language].test(stale),
        `[${language}] No.637/S4b: the stale stamp says the same thing — got "${stale}"`);
      const queueLine = html.split('\n').filter((line) => line.includes("'crew_flow.fit_rank_unknown'"))[language === 'ru' ? 1 : 0] || '';
      const queueText = (new RegExp("'crew_flow\\.fit_rank_unknown':'([^']+)'").exec(queueLine) || [])[1] || '';
      okS4b(queueText.length > 5, `[${language}] CALIBRATION: the QUEUE wording was found in the file`);
      okS4b(WORD[language].test(queueText.replace(/\\u2014/g, '—')) && !OLD[language].test(queueText),
        `[${language}] No.637/S4b: and so does the Crew Flow queue row, which is the OTHER screen the owner walks through — got "${queueText}"`);
    }
  }
}

// ===== No.637/S7: the OTHER end of the invented 50 % — «0 %» on a card ======
//
// OWNER (939), verbatim and standing: «неизвестный ранг — ни совпадение, ни
// 0 %, а честная ручная проверка». S1b closed the `unknown` half of that
// sentence. This closes the other: a profile whose rank does NOT APPLY was
// never measured against this person either, so `floor(100 * 0 / 4)` is not a
// result — it is an unasked question printed as a zero.
//
// WHY IT REACHES A CARD AT ALL, since S1b said it never could: S2 ((975) п.5)
// made `cardApplicabilityVisibleRows` keep the profile a person RESPONDED to
// whatever its verdict. That is the row the owner saw on the stand on 02.10:
// «Chief Officer · Mykola Shevchuk» and «Master · Rizal Santos», `0 %` and
// «выполнено 0 из 4» under the words «Нужна проверка».
//
// Written against the RENDERED MARKUP, in both shipped languages, with a
// control pair on the same screen so "no figure" cannot pass on a blank card.
console.log('\n# No.637/S7: a rank that does not apply carries no figure, and keeps its own words');
{
  const ok637s7 = softOk;
  const build = async (lang) => {
    const ctx = makeContext();
    await s4ControlSetup(ctx, {
      verdicts: { 'prof-A': S4C_NA, 'prof-B': S4C_NA, 'prof-C': S4C_SAME },
      source: 'skipi_response', chosen: 'prof-A',
    });
    if (lang) { ctx.setLang(lang); ctx.__pilot.renderIntakePilot(); }
    return ctx;
  };
  const ctx = await build(null);
  const naCard = s7FitCard(main(ctx), 'prof-A');
  const okCard = s7FitCard(main(ctx), 'prof-C');

  ok637s7(naCard !== '',
    'No.637/S7: the vacancy he responded to HAS a fit card even though the rank does not apply — S2 put it there and this slice does not take it away');
  ok637s7(okCard !== '',
    'CALIBRATION: an applicable profile has a card on the SAME screen, so nothing below can pass by rendering nothing');

  if (naCard && okCard) {
    // ---- 1. every form of the figure is gone ----------------------------
    ok637s7(/data-qa="pilot-fit-pct" data-pct="none"/.test(naCard),
      'No.637/S7: no percentage — got ' + (naCard.match(/data-pct="[^"]*"/) || ['<none found>'])[0]);
    ok637s7(!/%/.test(naCard),
      'No.637/S7: and not a per-cent sign anywhere on that card');
    ok637s7(!/checks met, by the stored evaluation/.test(naCard) && !/из \d+ по сохранённой оценке/.test(naCard),
      'No.637/S7: nor the «выполнено M из N» caption — «0 из 4» is the same false claim written in words');
    ok637s7(!/<div class="cf-bar"/.test(naCard),
      'No.637/S7: and no progress bar — a bar is a figure drawn instead of printed');
    ok637s7(!/<div class="cf-counts">/.test(naCard),
      'No.637/S7: and no «Не выполнено: N · Не подтверждено: M» either — three numbers about a comparison nobody made read as a measurement, which is the half S1c removed one verdict over — got '
        + (naCard.match(/<div class="cf-counts">[\s\S]*?<\/div>/) || ['<none>'])[0]);
    ok637s7(/data-fit="rank_not_applicable"/.test(naCard),
      'No.637/S7: the card names WHICH refusal it is, machine-readably');

    // ---- 2. the control pair keeps its honest numbers -------------------
    ok637s7(/data-qa="pilot-fit-pct" data-pct="\d+"/.test(okCard) && /%/.test(okCard),
      'No.637/S7 CONTROL: the applicable card keeps its percentage — the fix hits one verdict, not every number on the screen');
    ok637s7(/checks met, by the stored evaluation/.test(okCard),
      'No.637/S7 CONTROL: and its mandatory caption (928)');
    ok637s7(/<div class="cf-counts">/.test(okCard),
      'No.637/S7 CONTROL: and its counts line');

    // ---- 3. NO MERGE with «не прочитана» (mandatory negative) -----------
    const unreadCtx = makeContext();
    await s4ControlSetup(unreadCtx, {
      verdicts: { 'prof-A': S4C_UNKNOWN, 'prof-B': S4C_UNKNOWN, 'prof-C': S4C_SAME },
      source: 'skipi_response', chosen: 'prof-A',
    });
    const unreadCard = s7FitCard(main(unreadCtx), 'prof-A');
    const word = (card) => {
      const m = String(card).match(/data-qa="pilot-fit-pct" data-pct="none">[\s\S]*?<div class="cf-fitcard-cap">([\s\S]*?)<\/div>/);
      return m ? m[1].replace(/\s+/g, ' ').trim() : '';
    };
    const applic = (card) => {
      const m = String(card).match(/data-qa="pilot-fit-applicability"[^>]*>([\s\S]*?)<\/div>/);
      return m ? m[1].replace(/\s+/g, ' ').trim() : '';
    };
    ok637s7(unreadCard !== '' && /data-fit="rank_unknown"/.test(unreadCard),
      'CALIBRATION: the unread card still reports its own state — so what follows compares two live states, not one state with itself');
    ok637s7(word(naCard).length > 5 && word(unreadCard).length > 5,
      'CALIBRATION: both cards print a word where the figure is refused — got "' + word(naCard) + '" and "' + word(unreadCard) + '"');
    ok637s7(word(naCard) !== word(unreadCard),
      'No.637/S7: «не подходит» and «не прочитана» are DIFFERENT sentences where the figure used to be — got "' + word(naCard) + '" vs "' + word(unreadCard) + '"');
    ok637s7(applic(naCard) !== applic(unreadCard) && applic(naCard).length > 5,
      'No.637/S7: and the line beneath keeps saying which of the two it is — got "' + applic(naCard) + '" vs "' + applic(unreadCard) + '"');
    ok637s7(!/data-fit="rank_unknown"/.test(naCard) && !/data-fit="rank_not_applicable"/.test(unreadCard),
      'No.637/S7: different machine states too — one code for both would send the operator to the wrong next action');
    // The button is NOT taken away by any of this: (975) п.5 stands.
    ok637s7(/data-qa="pilot-fit-confirm"/.test(naCard),
      'PRESERVE (975 п.5 / S2): the shortlist button stays on the vacancy he applied to — this slice removes a number, not a person');

    // ---- 4. the two wordings exist in both shipped languages ------------
    for (const lang of ['en', 'ru']) {
      const lctx = await build(lang);
      const card = s7FitCard(main(lctx), 'prof-A');
      const text = word(card);
      const cyr = /[Ѐ-ӿ]/.test(text);
      ok637s7(text.length > 5 && (lang === 'ru' ? cyr : !cyr),
        '[' + lang + '] No.637/S7: the refusal is a sentence in this language — got "' + text + '"');
      ok637s7(!/%/.test(card),
        '[' + lang + '] No.637/S7: and the card carries no figure in this language either');
      const key = (lctx.setLang(lang), lctx.__pilot.cardT('share_rank_not_applicable'));
      ok637s7(key !== 'share_rank_not_applicable' && (lang === 'ru' ? /[Ѐ-ӿ]/.test(key) : !/[Ѐ-ӿ]/.test(key)),
        '[' + lang + '] No.637/S7: PILOT_CARD_TEXT carries the wording — a missing key prints the wire code — got "' + key + '"');
      const unread = lctx.__pilot.cardT('share_rank_unknown');
      ok637s7(key !== unread,
        '[' + lang + '] No.637/S7: and it is not the unread wording wearing a second key');
    }
    ctx.setLang('en');
  }
}

// ===========================================================================
// No.675 (OWNER (990), 2026-10-04) — «На момент отклика соответствий нет».
//
// The grey «Сохранённых сравнений по этому кандидату пока нет» is TRUE of a
// letter and MISLEADING of a response: «пока нет» promises something in
// flight, and nothing is in flight — nobody has compared him, and the
// operator's own «Сопоставить с профилем» button is what changes that. The
// owner read that sentence on the stand as "the comparison is coming".
//
// FOUR scenarios, and three of them exist to make the first one capable of
// going red. A pill that appears for everybody would pass a single positive
// check and still be the defect:
//   * `skipi_response` with ZERO stored comparisons -> the pill, RU and EN;
//   * a letter with zero comparisons                -> the OLD grey sentence;
//   * a response WITH stored comparisons            -> neither (the cards);
//   * comparisons NOT READ yet (`ranks == null`)    -> neither, because "no
//     matches" about an unread list is a silent zero and not an answer.
// ===========================================================================
console.log('\n# No.675: a response with nothing compared says so, on the card');
{
  const fitSection = (ctx) => {
    const src = main(ctx);
    const s = src.indexOf('<section class="pilot-card" data-qa="pilot-section-fit"');
    if (s < 0) return '';
    const e = src.indexOf('<section class="pilot-card" data-qa="pilot-section-letter"', s);
    return e < 0 ? src.slice(s) : src.slice(s, e);
  };
  const pillOf = (fit) => (String(fit).match(/data-qa="pilot-fit-no-matches-pill"[^>]*>([^<]*)</) || [])[1] || '';
  const openWith = async (source, language) => {
    const ctx = makeContext({ language });
    ctx.server.card.source = source;
    await openCard(ctx);
    return ctx;
  };

  for (const lang of ['ru', 'en']) {
    const ctx = await openWith('skipi_response', lang);
    const d = ctx.__pilot.pilotDetail();
    const fit = fitSection(ctx);
    const pill = pillOf(fit);
    const want = ctx.__pilot.cardT('fit_no_matches');
    softOk(!!d && d.ranks != null && (d.ranks.items || []).length === 0,
      '[' + lang + '] 675 CALIBRATION: this fixture really does load an EMPTY comparison list (ranks read, zero rows)');
    softOk(pill !== '' && pill === want && want !== 'fit_no_matches',
      '[' + lang + '] 675: the fit block states that at the time of the response there were no matches — got "' + pill + '"');
    softOk(lang === 'ru' ? /[Ѐ-ӿ]/.test(pill) : !/[Ѐ-ӿ]/.test(pill),
      '[' + lang + '] 675: and it is a sentence in THIS language, not the other one — got "' + pill + '"');
    softOk(!/data-qa="pilot-fit-empty"/.test(fit),
      '[' + lang + '] 675: the «пока нет» promise no longer stands in that block');
    softOk(/data-qa="pilot-section-fit"/.test(fit) && /data-qa="pilot-card-refresh"/.test(main(ctx)),
      '[' + lang + '] 675 PRESERVE: the block and the rest of the card are still rendered around it');
  }

  // CALIBRATION 1 — an ordinary letter. Nobody responded to anything there, so
  // "at the time of the response" would name a moment that never happened.
  {
    const ctx = await openWith('inbound', 'ru');
    const fit = fitSection(ctx);
    softOk(/data-qa="pilot-fit-empty"/.test(fit),
      '675 CALIBRATION: a letter with nothing compared KEEPS «Сохранённых сравнений по этому кандидату пока нет»');
    softOk(!/pilot-fit-no-matches/.test(fit),
      '675: and the letter is never told «на момент отклика» — it is not a response');
    const synth = await openWith('synthetic', 'en');
    softOk(/data-qa="pilot-fit-empty"/.test(fitSection(synth)) && !/pilot-fit-no-matches/.test(fitSection(synth)),
      '675 CALIBRATION: a synthetic test record keeps the old wording too');
  }

  // CALIBRATION 2 — a response that HAS comparisons. The pill must not shoulder
  // its way in beside real cards.
  {
    const ctx = makeContext();
    ctx.server.card.source = 'skipi_response';
    await positiveChainUntilRank(ctx);
    const fit = fitSection(ctx);
    softOk(/data-qa="pilot-fit-name"/.test(fit),
      '675 CALIBRATION: this scenario really did produce comparison cards');
    softOk(!/pilot-fit-no-matches/.test(fit),
      '675: a response WITH stored comparisons shows the comparisons and no pill');
  }

  // CALIBRATION 3 — unread is not zero.
  {
    const ctx = await openWith('skipi_response', 'ru');
    softOk(/pilot-fit-no-matches/.test(fitSection(ctx)),
      '675 CALIBRATION: the pill is on this card before the comparisons are taken away');
    ctx.__pilot.pilotDetail().ranks = null;
    ctx.__pilot.renderIntakePilot();
    await flush();
    softOk(!/pilot-fit-no-matches/.test(fitSection(ctx)),
      '675: comparisons that were never read are NOT «нет соответствий» — an unanswered question is not a zero');
  }

  // ONE renderer behind both call sites of the block: two copies drift, and the
  // card has paid for a two-oracle split before (No.637/S4).
  softOk(/function cardNoMatchesPillHtml\(/.test(c3b2Source),
    '675: the pill has exactly one renderer in the shipped block');
  softOk((c3b2Source.match(/cardNoMatchesPillHtml\(\)/g) || []).length >= 2,
    '675: and both «nothing to show» exits of the fit block go through it');
  // The bound lives IN the renderer, not only at its call sites: a call site is
  // one `if` away from being copied without it.
  {
    const pillFn = (ctx) => { try { return String(vm.runInContext('cardNoMatchesPillHtml()', ctx)); } catch (e) { return '__missing__'; } };
    const resp = await openWith('skipi_response', 'ru');
    const letter = await openWith('inbound', 'ru');
    softOk(pillFn(resp) !== '' && pillFn(resp) !== '__missing__',
      '675 CALIBRATION: the renderer answers for a response with nothing compared — got "' + pillFn(resp).slice(0, 40) + '"');
    softOk(pillFn(letter) === '',
      '675: and it refuses a letter by itself — the SOURCE bound is in the function, not only in its call site — got "' + pillFn(letter).slice(0, 40) + '"');
  }
}

console.log('\n# control matrix');
for (const row of controlResults) console.log(`  ${row.id} ${row.verdict} clean=${row.cleanBefore} mutantRed=${row.mutantRed} kind=${row.mutantKind} restore=${row.cleanAfter} — ${row.defect}`);
console.log(`\ncrewing_c3b2_candidate_harness: ${failed === 0 ? 'GREEN' : 'RED'} (${passed} passed, ${failed} failed)`);
if (failed !== 0) process.exit(1);
