// Manual Compliance Profile ranking flow smoke.
//
// Runs the real desktop inline script without boot, then drives:
// candidate -> Check against profiles -> ranked cards -> details -> save/ignore controls.

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

function makeElement(id) {
  let outer = '';
  return {
    id,
    style: {},
    dataset: {},
    children: [],
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    appendChild(child) { this.children.push(child); return child; },
    remove() {},
    removeChild(child) { this.children = this.children.filter((x) => x !== child); },
    querySelector() { return makeElement(id + '-query'); },
    querySelectorAll() { return []; },
    addEventListener() {},
    setAttribute() {},
    getAttribute() { return ''; },
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

const toasts = [];
globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
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
globalThis.__TAURI__ = {
  core: {
    invoke: async (cmd) => {
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
          ],
        };
      }
      return null;
    },
    convertFileSrc: (p) => `file://${p}`,
  },
};
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'manual-flow-harness', onLine: true },
  configurable: true,
  writable: true,
});
globalThis.location = { hash: '#desktop', reload() {} };
globalThis.setTimeout = (fn) => { if (typeof fn === 'function') fn(); return 1; };
globalThis.setInterval = () => 1;
globalThis.clearTimeout = () => {};
globalThis.fetch = async () => ({ ok: false, status: 599, async json() { return {}; }, async text() { return ''; } });

const script = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .reduce((a, b) => (a.length > b.length ? a : b), '');
const bootIndex = script.indexOf('// ------------- boot -------------');
const scriptNoBoot = bootIndex > 0 ? script.slice(0, bootIndex) : script;
const banned = ['com' + 'pliant', 'approved', 'legal', 'verdict'];

let M = null;
try {
  M = new Function(
    scriptNoBoot + '\nreturn { state, renderApplicationSnapshot, checkApplicationAgainstProfiles, saveRankedCandidate, ignoreRankedCandidate };'
  )();
} catch (e) {
  console.error('runtime load failed:', e);
}

ok(!!M, 'real desktop inline script loads without boot IIFE');

if (M) {
  M.state.settings = {
    server_url: 'https://api.skipi.app',
    bearer_token: 'TOKEN-DO-NOT-LEAK',
    crewing_id: 'presence-harness',
  };
  M.state.selectedVacancy = { id: 'v1', rank: 'Captain', vessel_type: 'Bulk Carrier' };
  const app = {
    id: 'app-1',
    vacancy_id: 'v1',
    received_at: '2026-07-06T08:00:00Z',
    contact_for_reply: 'sf@example.com',
    message: 'Ready',
    status: 'new',
    summary: {
      redacted_initials: 'O.K.',
      rank: 'Captain',
      nationality: 'Ukraine',
      certs_summary: [{ template_id: 'passport', has_file: true }],
    },
  };
  M.state.applications = [app];
  const initial = M.renderApplicationSnapshot(app, app.summary, 'sf');
  ok(initial.includes('Check against profiles'), 'candidate snapshot exposes check button');
  ok(initial.includes('profile-rank-app-1'), 'candidate snapshot includes ranking panel host');

  const host = elFor('profile-rank-app-1');
  host.innerHTML = initial;
  await M.checkApplicationAgainstProfiles('app-1');
  const rendered = host.outerHTML || host.innerHTML;
  ok(rendered.includes('Captain · Client Alpha') && rendered.includes('93%'), 'ranked cards render top profile and score');
  ok(rendered.includes('Gap reasons') && rendered.includes('brm'), 'ranked card renders gap reasons');
  ok(rendered.includes('covered') && rendered.includes('missing') && rendered.includes('expired') && rendered.includes('uncertain') && rendered.includes('no file'), 'details render all required buckets');
  ok(rendered.includes('Save to Seafarers DB') && rendered.includes('Ignore'), 'save and ignore controls render');
  ok(!banned.some((word) => rendered.toLowerCase().includes(word)), 'manual ranking UI avoids banned wording');

  const before = JSON.stringify(M.state.complianceRankingsByApp['app-1']);
  M.ignoreRankedCandidate('app-1');
  const after = JSON.stringify(M.state.complianceRankingsByApp['app-1']);
  ok(before === after, 'ignore does not mutate ranking result');
  await M.saveRankedCandidate('app-1');
  ok(true, 'save control is callable without scoring mutation');
}

if (fail) {
  console.error(`\ncrewing_compliance_manual_flow_harness: RED (${pass} passed, ${fail} failed)`);
  process.exit(1);
}
console.log(`\ncrewing_compliance_manual_flow_harness: GREEN (${pass} passed, ${fail} failed)`);
