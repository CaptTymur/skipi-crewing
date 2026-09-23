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

const c3b1Start = html.indexOf('// ================= C3b-1 SYNTHETIC INTAKE PILOT START =================');
const c3b1End = html.indexOf('// ================== C3b-1 SYNTHETIC INTAKE PILOT END ==================', c3b1Start);
const c3b2Start = html.indexOf('// ================= C3b-2 CANDIDATE CARD START =================', c3b1End);
const c3b2End = html.indexOf('// ================== C3b-2 CANDIDATE CARD END ==================', c3b2Start);
assert.ok(c3b1Start > 0 && c3b1End > c3b1Start && c3b2Start > c3b1End && c3b2End > c3b2Start, 'bounded C3b-1 and C3b-2 UI blocks exist in order');
const c3b1Source = html.slice(c3b1Start, c3b1End);
const c3b2Source = html.slice(c3b2Start, c3b2End);

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
ok(/repository: CaptTymur\/skipi-guard\n\s+ref: (93b1a51eb59d0dff5f2db3f2289b8afb09761f39|7bd9300601e5445a9a60f1136d2fd57a9e9b32c5)/.test(workflow), 'guard pin is the accepted base pin or the reviewed 7bd pin');
ok(!c3b2Source.includes('localStorage'), 'card block never persists card state');
ok((c3b1Source.match(/PILOT_REASON_TEXT\s*=\s*\{/g) || []).length === 1 && !c3b2Source.includes('PILOT_REASON_TEXT ='), 'queue reason catalogue stays single');
ok(/data-qa="pilot-open-card"/.test(c3b1Source), 'queue rows expose an explicit Open control');

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
        case 'crewing_intake_alias_list': return { items: [] };
        case 'crewing_intake_candidate_list': return { items: [{ ...b.card, summary: b.card.summary }], limit: 50, offset: args.offset || 0, total: 1 };
        default: throw new Error(`unexpected invoke ${command}`);
      }
    },
  };
  return server;
}

function makeContext({ source = c3b2Source, server = makeServer(), invokeImpl, confirmImpl, language = 'en' } = {}) {
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
  vm.runInContext(`${c3b1Source}\n${source}\nthis.__pilot = { pilotEnter, pilotLeave, renderIntakePilot, pilotLoadQueue, pilotOpenCard, pilotCloseCard, pilotCardRefreshAll, pilotCardLoad, pilotFactsLoad, pilotRanksLoad, pilotFactSubmit, pilotFactStartCorrection, pilotRankNow, pilotShortlistConfirm, pilotShortlistWithdraw, pilotCardKeydown, pilotDetail, cardT, PILOT_CARD_TEXT, PILOT_CARD_REFUSAL_TEXT, PILOT_CARD_OUTCOME_TEXT, PILOT_CARD_STALE_TEXT };`, context);
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

console.log('# positive chain on isolated copies: card → facts → correction → rank → confirm → withdraw → re-add');
{
  const ctx = makeContext();
  ctx.__pilot.pilotEnter(); await flush();
  ok(/data-qa="pilot-open-card"/.test(main(ctx)) && /pilotOpenCard\('intake-A'\)/.test(main(ctx)), 'queue row renders an Open control wired to the exact intake id');
  await openCard(ctx);
  ok(/data-qa="crewing-intake-card-view" data-intake="intake-A"/.test(main(ctx)), 'card view replaces the queue for the opened intake');
  ok(ctx.calls.slice(-4).map((c) => c.command).sort().join(',') === 'crewing_intake_candidate_get,crewing_intake_fact_list,crewing_intake_matching_profile_list,crewing_intake_rank_list', 'opening a card issues exactly the four typed reads');
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
  ok([rowA, rowB, rowC].every((r) => /Vacancy version used: 1/.test(r) && /(Master|Chief Officer) · [ABC] <span class="pilot-note">\(prof-[ABC] · current version 1 · state active\)/.test(r)), 'rows show vacancy version used and the current profile name/version/state');
  ok(!/data-qa="pilot-unranked"/.test(main(ctx)), 'no unranked gap remains after ranking every active profile');
  ok(/quarantined|ranked/.test(main(ctx)) && /Document unverified · synthetic data only/.test(main(ctx)), 'ranked state does not upgrade source trust');
  // confirm a decided=false pair (B)
  await ctx.__pilot.pilotShortlistConfirm('prof-B', 1); await flush();
  const confirm = ctx.calls.find((c) => c.command === 'crewing_intake_shortlist_confirm');
  ok(confirm && JSON.stringify(confirm.args.pair) === JSON.stringify({ profile_id: 'prof-B', profile_version: 1 }), 'confirm sends exactly the viewed pair');
  ok(attempts(ctx).slice(-1)[0].outcome === 'acked', 'a decided=false pair can be shortlisted for further consideration');
  const hist1 = historyRow(ctx, 'decision-1');
  ok(hist1 && /Active decision/.test(hist1) && /Team member user-op-1/.test(hist1) && /Vacancy version used: 1/.test(hist1) && /UTC/.test(hist1), 'history shows id, seat user, UTC time, pair and active state');
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
  ok(/Актуальность фактов для этой оценки не подтверждена/.test(main(ctx)) && /Версия вакансии в оценке: 1/.test(main(ctx)) && /Сведения не внесены/.test(main(ctx)) && /Введено сотрудником/.test(main(ctx)) && /Запрос пересчёта выполнен/.test(main(ctx)) && /Добавить в шортлист для дальнейшего рассмотрения/.test(main(ctx)) && /Документ не проверен · только синтетические данные/.test(main(ctx)), 'Russian mandatory honesty strings');
  detail(ctx).form.value = 'draft survives'; ctx.setLang('en'); ctx.__pilot.renderIntakePilot();
  ok(/Fact freshness for this comparison is unverified/.test(main(ctx)) && /draft survives/.test(main(ctx)), 'language switch re-renders in English and keeps the form draft');
  const s = ctx.server;
  s.profiles[0].version = 2; s.profiles[2].state = 'paused'; s.profiles.push({ id: 'prof-D', crewing_id: 'crew-synthetic', name: 'Bosun · D', version: 1, state: 'active', rank: 'Bosun', certs: null });
  s.facts.rank.unshift({ field: 'rank', value: '', version: 3, source_object: 'obj-1', page: 0, span: null, confidence: 0, uncertainty: 'future_code', corrected_by: null, created_at: '2026-09-23T01:09:00' });
  s.ranks.push({ profile_id: 'prof-B', profile_version: 1, primary: true, met: [], missing: [], unconfirmed: [], reasons: [{ requirement: 'future:thing', outcome: 'future_outcome', wanted: null, found: null }], decided: false });
  s.ranks.splice(1, 1);
  await ctx.__pilot.pilotCardRefreshAll(); await flush();
  ok(/data-qa="pilot-rank-stale">Vacancy changed — rank again/.test(rankRow(ctx, 'prof-A', 1)), 'profile_version staleness has its own badge');
  ok(/data-qa="pilot-rank-stale">Vacancy is not active/.test(rankRow(ctx, 'prof-C', 1)), 'profile_not_active staleness has its own badge');
  ok(/Bosun · D \(prof-D\)/.test(main(ctx)), 'a profile created after the run is listed as unranked');
  ok(/data-version="3"[\s\S]*?data-qa="pilot-fact-confidence">confidence 0<\/span> · Unknown reason: future_code/.test(main(ctx)), 'confidence 0 renders as measured zero and an unknown uncertainty code stays visible');
  ok(/data-version="2"[\s\S]*?confidence unknown/.test(main(ctx)), 'confidence null renders as unknown');
  ok(/data-group="unknown" data-requirement="future:thing"[^<]*Unknown result: future_outcome/.test(rankRow(ctx, 'prof-B', 1)) && /primary vacancy/.test(rankRow(ctx, 'prof-B', 1)), 'unknown outcome is shown as unknown, and primary is labelled');
  ok(/Vacancy changed — rank again/.test(rankRow(ctx, 'prof-A', 1)) && /data-qa="pilot-rank-freshness"/.test(rankRow(ctx, 'prof-A', 1)), 'vacancy staleness and fact freshness are two separate statements');
  // refusal precedence: domain code before generic 404/403
  await ctx.__pilot.pilotShortlistConfirm('prof-D', 1); await flush();
  ok(/data-qa="pilot-attempt-refused">This candidate has not been scored for this vacancy/.test(main(ctx)) && !/Section unavailable/.test(main(ctx)), 'rank_not_found 404 is the domain refusal, not "section unavailable"');
  await ctx.__pilot.pilotShortlistConfirm('prof-A', 1); await flush();
  ok(/data-qa="pilot-attempt-refused">The vacancy has changed — rank again/.test(main(ctx)), 'profile_version_stale 409');
  await ctx.__pilot.pilotShortlistConfirm('prof-C', 1); await flush();
  ok(/data-qa="pilot-attempt-refused">The vacancy is not active/.test(main(ctx)), 'profile_not_active 409');
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
  ok(/Ranking request completed: No active vacancies · 0\/0/.test(main(ctx)) && attempts(ctx)[0].outcome === 'acked', 'no_active_profiles is a successful answer without a computation, not a refusal');
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
// M01–M12, M15, M16: isolated mutation controls. Each row: known-good GREEN,
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
      assert.ok(/data-group="unconfirmed" data-requirement="mandatory_certs"[^<]*Requirement not stated in vacancy/.test(row), 'unstated requirement stays a separate unknown');
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
      assert.ok(row && /Team member user-op-1/.test(row) && /Vacancy version used: 1/.test(row), 'history row carries decision fields');
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
      assert.equal(buttons.length, 1, 'C row has its own confirm control');
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
];

console.log('# isolated mutation controls M01–M12, M15, M16 (known-good → mutant RED → clean GREEN)');
const controlResults = [];
for (const control of controls) {
  let cleanBefore = false, mutantRed = false, cleanAfter = false, mutantMessage = '';
  try { await control.sensor(makeContext()); cleanBefore = true; } catch (error) { mutantMessage = `known-good failed: ${error.message}`; }
  if (cleanBefore) {
    try { await control.sensor(makeContext({ source: mutate(c3b2Source, control.edits) })); mutantMessage = 'mutant survived'; } catch (error) { mutantRed = true; mutantMessage = error.message; }
    try { await control.sensor(makeContext()); cleanAfter = true; } catch (error) { mutantMessage += ` / restore failed: ${error.message}`; }
  }
  const verdict = cleanBefore && mutantRed && cleanAfter ? 'KILLED' : 'FAIL';
  controlResults.push({ id: control.id, defect: control.defect, cleanBefore, mutantRed, cleanAfter, verdict, detail: mutantMessage });
  softOk(verdict === 'KILLED', `${control.id} ${control.defect}: clean=${cleanBefore ? 'GREEN' : 'RED'} mutant=${mutantRed ? 'RED' : 'GREEN'} restore=${cleanAfter ? 'GREEN' : 'RED'} (${mutantMessage.slice(0, 90)})`);
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

console.log('\n# control matrix');
for (const row of controlResults) console.log(`  ${row.id} ${row.verdict} clean=${row.cleanBefore} mutantRed=${row.mutantRed} restore=${row.cleanAfter} — ${row.defect}`);
console.log(`\ncrewing_c3b2_candidate_harness: ${failed === 0 ? 'GREEN' : 'RED'} (${passed} passed, ${failed} failed)`);
if (failed !== 0) process.exit(1);
