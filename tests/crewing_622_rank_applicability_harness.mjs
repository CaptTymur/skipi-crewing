// No.622 — professional applicability of a RANK, as the CLIENT says it.
//
// OWNER (939), verbatim: "капитану матроса или матросу капитана - так не бывает".
// The server (app/crewing_rank.py) decides; this harness is about the SCREEN,
// and about the one thing the card's negatives N13/N14/N20/N21/N22 are for:
// three renderers read the same rows, and two of them saying different things
// is how one screen hides a profile the next one recommends.
//
// Bounded: an isolated vm copy of ONE marked block plus static assertions on
// dist/index.html. No network, no DOM, no server, nothing paid.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('dist/index.html', 'utf8');

let passed = 0, failed = 0;
function ok(condition, message) {
  if (condition) { passed += 1; console.log('  ✓', message); return true; }
  failed += 1; console.log('  ✗', message); return false;
}

const START = '// ================= No.622 RANK APPLICABILITY (client) START =================';
const END = '// ================== No.622 RANK APPLICABILITY (client) END ==================';
const a = html.indexOf(START), b = html.indexOf(END, a + 1);
ok(a > 0 && b > a, 'the applicability block exists, once, and is bounded by its markers');
ok(html.indexOf(START, a + 1) === -1, 'exactly one START marker');
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
ok(api, 'the block exposes its helpers');

if (api) {
  const A = api.cardApplicability;
  // Five verdicts, and the sixth state that is NOT a verdict: an older server
  // that says nothing. Reading silence as `not_applicable` would empty the
  // screen; reading it as `same` would print a claim nobody made.
  ok(A({applicability:'same'}).answer === 'same' && A({applicability:'same'}).stated === true, 'same is carried through');
  ok(A({applicability:'alternative'}).answer === 'alternative', 'alternative is its own verdict, never folded into same');
  ok(A({applicability:'any'}).answer === 'any' && A({applicability:'any'}).hidden === false, 'any (a deliberately open vacancy) is shown');
  ok(A({applicability:'not_applicable'}).hidden === true, 'not_applicable is the ONLY verdict that moves under a disclosure');
  ok(A({applicability:'unknown'}).hidden === false, 'unknown is NEVER hidden - the canon puts unknowns next to the decision');
  ok(A({}).stated === false && A({}).answer === null && A({}).hidden === false,
    'a row from a server that does not speak this contract keeps rendering exactly as before');
  ok(A({applicability:'nonsense'}).stated === false, 'an unrecognised verdict is silence, not a guess');
  // N25: two different unknowns are two different sentences.
  const absent = A({applicability:'unknown', applicability_reason:'rank_absent'});
  const unreadable = A({applicability:'unknown', applicability_reason:'rank_unreadable'});
  const profileUnreadable = A({applicability:'unknown', applicability_reason:'profile_rank_unreadable'});
  ok(absent.reason === 'rank_absent' && unreadable.reason === 'rank_unreadable', 'the two unknowns stay two codes');
  for (const lang of ['ru', 'en']) {
    ctx.__lang = lang;
    const one = api.cardApplicabilityWhy(absent), two = api.cardApplicabilityWhy(unreadable);
    const three = api.cardApplicabilityWhy(profileUnreadable);
    ok(one && two && three && one !== two && two !== three && one !== three,
      `[${lang}] N25: "he has no rank", "nobody could place his" and "nobody could place the PROFILE's" are three sentences`);
    ok(!/^[a-z_]+$/.test(one) && !/^[a-z_]+$/.test(two), `[${lang}] the reason is a sentence, not the wire code`);
    // N10 on the screen: alternative must not READ as a confirmation.
    const alt = api.cardApplicabilityLabel(A({applicability:'alternative'}));
    const same = api.cardApplicabilityLabel(A({applicability:'same'}));
    ok(alt && same && alt !== same, `[${lang}] alternative is labelled differently from same`);
    ok(api.cardApplicabilityLabel(A({})) === '', `[${lang}] silence prints no label at all`);
  }
  // Both dictionaries are complete: an English string in a Russian interface is
  // a defect of its own (No.627 found one today).
  for (const table of [api.CARD_APPLICABILITY_TEXT, api.CARD_APPLICABILITY_REASON_TEXT, api.CARD_ORIGIN_TEXT]) {
    for (const key of Object.keys(table)) {
      const pair = table[key];
      ok(Array.isArray(pair) && pair.length === 2 && pair[0] && pair[1] && pair[0] !== pair[1],
        `${key} carries a distinct RU and EN string`);
      ok(/[Ѐ-ӿ]/.test(pair[0]), `${key} RU string is actually Russian`);
      ok(!/[Ѐ-ӿ]/.test(pair[1]), `${key} EN string carries no Cyrillic`);
    }
  }

  // ------------------------------------------------- N24 / N23 / (954) origin
  console.log('# where the first profile CAME FROM - three states, never two');
  const detail = (card, items) => ({ intakeId:'i-1', card:card, ranks:{ items:items||[], unranked_active_profiles:[], withheld_profiles:[] } });
  ctx.__detail = detail({ source:'skipi_response', primary_profile_id:'p-master' }, [{profile_id:'p-master', primary:true}]);
  ok(api.cardResponseOrigin() === 'response', 'a Skipi response names the profile he responded to');
  ctx.__detail = detail({ source:'inbound', primary_profile_id:'p-master' }, [{profile_id:'p-master', primary:true}]);
  ok(api.cardResponseOrigin() === 'first_context', 'N24: an ordinary letter is a FIRST CONTEXT, never a response');
  ctx.__detail = detail({ source:'inbound' }, [{profile_id:'p-x', primary:false}]);
  ok(api.cardResponseOrigin() === 'none', 'no primary_profile_id means there is no originating profile at all');
  // (954), border 1: `rank.primary` alone NEVER earns the label.
  ctx.__detail = detail({ source:'skipi_response' }, [{profile_id:'p-legacy', primary:true}]);
  ok(api.cardOriginLabel('p-legacy') === '', 'a legacy primary flag with no intake profile gives NO label');
  ctx.__detail = detail({ source:'inbound', primary_profile_id:'p-master' }, [{profile_id:'p-master', primary:true}]);
  for (const lang of ['ru', 'en']) {
    ctx.__lang = lang;
    const label = api.cardOriginLabel('p-master');
    ok(label && !/отклик|respond/i.test(label), `[${lang}] N24: the letter's first profile is not called a response`);
    ok(api.cardOriginLabel('p-other') === '', `[${lang}] a profile that is not the origin carries no origin label`);
  }
  ctx.__detail = detail({ source:'skipi_response', primary_profile_id:'p-master' }, [{profile_id:'p-master', primary:true}]);
  ctx.__lang = 'ru';
  ok(/отклик/i.test(api.cardOriginLabel('p-master')), 'RU: a real response IS called a response');
  ctx.__lang = 'en';
  ok(/respond/i.test(api.cardOriginLabel('p-master')), 'EN: a real response IS called a response');

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
  ok(withheld.length === 3, `the withheld set is the UNION of both sides, deduped by profile (got ${withheld.length}, want 3)`);
  ok(withheld.filter(w => w.profile_id === 'p-master').length === 1, 'a profile that is both a stored row and a withheld profile is counted ONCE');
  ok(withheld.some(w => w.profile_id === 'p-old'), 'a stored inapplicable row the server did not list is still counted');
  ok(!withheld.some(w => w.profile_id === 'p-co'), 'an unknown is NOT counted as withheld: the screen does not hide it');
  const visible = api.cardApplicabilityVisibleRows();
  ok(visible.length === 2, `only not_applicable leaves the main list (got ${visible.length}, want 2: the response profile and the unknown)`);
  ok(!visible.some(r => r.profile_id === 'p-old'), 'an inapplicable stored row of a switched-off profile leaves the main list too');
  ok(visible[0].profile_id === 'p-ab', 'N7: the profile he responded to stands FIRST');
  ok(visible.some(r => r.profile_id === 'p-co'), 'N25: the unknown stays in the main list with its explanation');
  // N7 again, the harder half: an INAPPLICABLE response profile is still shown.
  ctx.__detail.ranks.items[0].applicability = 'not_applicable';
  const visibleWithBadPrimary = api.cardApplicabilityVisibleRows();
  ok(visibleWithBadPrimary.some(r => r.profile_id === 'p-ab'),
    'N7: the profile he RESPONDED to is shown even when the rank does not apply to it');
  ok(!api.cardWithheldProfiles().some(w => w.profile_id === 'p-ab'),
    'the response profile is never counted as withheld');
}

// -------------------------------------------------- N20: the labels that lied
console.log('# N20 - the captions that promised ALL active profiles');
const lies = [
  ['ru', 'Сравниваются все активные профили соответствия'],
  ['en', 'Every active compliance profile is compared']
];
for (const [lang, text] of lies) {
  ok(!html.includes(text), `[${lang}] the caption no longer claims every active profile is compared`);
}
ok(!html.includes("'crew_flow.matched_done':'Сопоставлено с активными профилями соответствия.'"),
  'RU matched_done no longer implies every profile was compared');
ok(!html.includes("'crew_flow.matched_done':'Compared against the active compliance profiles.'"),
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
  if (!ok(at > 0, `${name} (${fn}) exists`)) continue;
  const body = html.slice(at, html.indexOf('\nfunction ', at + 10));
  ok(/cardApplicability\s*\(/.test(body), `${name} reads applicability through the one adapter`);
}
// Both cache producers carry the field, or the queue cannot know it at all.
for (const fn of ['crewFlowCacheRanks', 'crewFlowCacheRankSummary']) {
  const at = html.indexOf('function ' + fn + '(');
  if (!ok(at > 0, `${fn} exists`)) continue;
  const body = html.slice(at, html.indexOf('\nfunction ', at + 10));
  ok(/applicability/.test(body), `${fn} carries applicability into the row cache`);
}

// -------------------------------------------- N19: the new staleness reasons
console.log('# N19 - the three new staleness reasons have words in both languages');
const staleAt = html.indexOf('var PILOT_CARD_STALE_TEXT');
const staleBlock = staleAt > 0 ? html.slice(staleAt, html.indexOf('};', staleAt)) : '';
for (const code of ['rank_not_applicable', 'rank_unknown', 'facts_changed']) {
  ok(staleBlock.includes(code + ':['), `stale reason ${code} has its own pair of words`);
}

// --------------------------------------------------------------------- N21
console.log('# N21 - a seafarer does not reach a shortlist or a letter he cannot hold');
const draftAt = html.indexOf('function cardDraftProfileId()');
const draftBody = draftAt > 0 ? html.slice(draftAt, html.indexOf('\nfunction ', draftAt + 10)) : '';
ok(/cardApplicability\s*\(/.test(draftBody), 'the draft never picks a profile the rank does not apply to');
const rowAt = html.indexOf('function pilotCardRankRowHtml(');
const rowBody = rowAt > 0 ? html.slice(rowAt, html.indexOf('\nfunction ', rowAt + 10)) : '';
ok(/not_applicable|\.hidden/.test(rowBody), 'the shortlist button is refused on an inapplicable row, on the screen and not only on the server');

console.log(`\npassed ${passed}, failed ${failed}`);
process.exit(failed === 0 ? 0 : 1);
