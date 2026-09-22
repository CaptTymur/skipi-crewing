import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('dist/index.html', 'utf8');
const rust = fs.readFileSync('src-tauri/src/crewing_intake.rs', 'utf8');
const lib = fs.readFileSync('src-tauri/src/lib.rs', 'utf8');
const start = html.indexOf('// ================= C3b-1 SYNTHETIC INTAKE PILOT START =================');
const end = html.indexOf('// ================== C3b-1 SYNTHETIC INTAKE PILOT END ==================', start);
assert.ok(start > 0 && end > start, 'bounded C3b-1 UI block exists');
const pilotSource = html.slice(start, end);

let passed = 0;
function ok(condition, message) {
  assert.ok(condition, message);
  passed += 1;
  console.log('  ✓', message);
}

console.log('# static bridge and surface boundaries');
ok(/id="mt-intake_pilot"[^>]+showView\('intake_pilot'\)/.test(html), 'desktop pilot entry is wired');
ok(!/MOBILE_RAIL_QA\s*=\s*\{[^}]*intake_pilot/s.test(html), 'mobile rail remains unchanged');
ok(rust.includes('.redirect(Policy::none())'), 'native pilot disables redirects');
ok(rust.includes('spawn_blocking(operation)'), 'blocking HTTP work is kept off the UI command task');
ok(!/api::(?:get|post|api_bases|primary_api_base)/.test(rust), 'pilot does not reuse fallback/retry API helpers');
const commands = [
  'crewing_intake_alias_list', 'crewing_intake_alias_create', 'crewing_intake_alias_rotate',
  'crewing_intake_alias_pause', 'crewing_intake_alias_resume', 'crewing_intake_alias_revoke',
  'crewing_intake_candidate_submit', 'crewing_intake_candidate_list',
];
for (const command of commands) {
  ok(rust.includes(`fn ${command}`), `${command} has a fixed native command`);
  ok(lib.includes(`crewing_intake::${command}`), `${command} is registered in Tauri`);
}
ok(!pilotSource.includes('localStorage'), 'pilot block never persists raw alias or upload payload');
ok((pilotSource.match(/PILOT_REASON_TEXT\s*=\s*\{/g) || []).length === 1, 'one versioned queue reason catalogue exists');

function freshPilotState() {
  return {
    generation: 0, contextKey: '', aliasDraft: '', aliases: [], aliasLoading: false, aliasError: null,
    aliasRequest: 0, aliasActionRequest: 0, aliasPending: false, oneTimeAlias: null,
    queue: { items: [], limit: 50, offset: 0, total: 0 }, queueLoading: false,
    queueError: null, queueRequest: 0, queueLastUpdated: null,
    uploadAttempt: null, uploadReceipt: null, uploadError: null, uploadPending: false,
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeContext({ demo = false, invokeImpl, clipboardImpl, fileReaderImpl } = {}) {
  const nodes = new Map();
  nodes.set('main', { id: 'main', innerHTML: '', style: {} });
  const calls = [];
  let language = 'en';
  const context = {
    console, Promise, Date, Math, JSON, Uint8Array, Array,
    __demoMode: demo,
    state: {
      view: 'intake_pilot',
      settings: { server_url: 'http://127.0.0.1:43123', bearer_token: 'synthetic-token', crewing_id: 'crew-synthetic' },
      intakePilot: freshPilotState(),
    },
    window: { crypto: { randomUUID: () => 'event-fixed-1', getRandomValues: (arr) => arr.fill(7) } },
    navigator: { clipboard: { writeText: clipboardImpl || (async () => {}) } },
    document: {
      getElementById(id) { return nodes.get(id) || null; },
      setNode(id, props = {}) { const node = Object.assign({ id, value: '', innerHTML: '', style: {} }, props); nodes.set(id, node); return node; },
    },
    FileReader: class {
      readAsDataURL(file) {
        if (fileReaderImpl) return fileReaderImpl(this, file);
        this.result = file.dataUrl || 'data:application/pdf;base64,U1lOVEhFVElD';
        queueMicrotask(() => this.onload());
      }
    },
    getUiLang() { return language; },
    setLang(value) { language = value; },
    tr(key) { return key === 'settings.connection' ? (language === 'ru' ? 'Подключение' : 'Connection') : key; },
    escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },
    escapeAttr(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },
    escapeJsString(value) { return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); },
    humanSize(bytes) { return `${bytes} B`; },
    inAppConfirm: async () => true,
    async invoke(command, args) {
      calls.push({ command, args: structuredClone(args) });
      if (invokeImpl) return invokeImpl(command, args, calls);
      if (command === 'crewing_intake_alias_list') return { items: [] };
      if (command === 'crewing_intake_candidate_list') return { items: [], limit: 50, offset: args.offset, total: 0 };
      throw new Error(`unexpected invoke ${command}`);
    },
    calls, nodes,
    setTimeout, clearTimeout, queueMicrotask,
  };
  vm.createContext(context);
  vm.runInContext(`${pilotSource}\nthis.__pilot = { pilotEnter, pilotLeave, renderIntakePilot, pilotLoadAliases, pilotLoadQueue, pilotCreateAlias, pilotAliasAction, pilotCopyAlias, pilotSelectFile, pilotSubmitUpload, pilotQueueHtml, pilotSummaryHtml, pilotReason, pilotSettingsChanged, PILOT_REASON_TEXT };`, context);
  return context;
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

console.log('# runtime isolation and RU/EN');
{
  const ctx = makeContext({ demo: true });
  ctx.__pilot.pilotEnter();
  await flush();
  ok(ctx.calls.length === 0, 'Demo entry performs zero pilot invokes');
  ok(/unavailable in Demo/.test(ctx.nodes.get('main').innerHTML), 'Demo shows an explicit live-only state');
}
{
  const ctx = makeContext();
  ctx.__pilot.pilotEnter();
  await flush();
  ok(ctx.calls.map((c) => c.command).join(',') === 'crewing_intake_alias_list,crewing_intake_candidate_list', 'entry loads aliases and page zero through two fixed commands');
  ok(/Candidate intake pilot/.test(ctx.nodes.get('main').innerHTML), 'English screen renders');
  ctx.setLang('ru'); ctx.__pilot.renderIntakePilot();
  ok(/Приём кандидатов/.test(ctx.nodes.get('main').innerHTML), 'Russian screen renders after language switch');
}

console.log('# one-time alias and clipboard truth');
{
  const clip = deferred();
  const ctx = makeContext({
    clipboardImpl: () => clip.promise,
    invokeImpl(command, args) {
      if (command === 'crewing_intake_alias_create') return Promise.resolve({ id:'a1', crewing_id:'crew-synthetic', state:'active', generation:1, alias:'synthetic-one-time-value', created_at:'2026-01-01', updated_at:'2026-01-01' });
      if (command === 'crewing_intake_alias_list') return Promise.resolve({ items:[{ id:'a1', label:'Desk', state:'active', generation:1, created_at:'2026-01-01', updated_at:'2026-01-01', alias:'must-not-render' }] });
      if (command === 'crewing_intake_candidate_list') return Promise.resolve({items:[],limit:50,offset:args.offset,total:0});
      throw new Error(command);
    },
  });
  ctx.__pilot.pilotEnter(); await flush();
  ctx.state.intakePilot.aliasDraft = 'Desk';
  await ctx.__pilot.pilotCreateAlias(); await flush();
  ok(ctx.state.intakePilot.oneTimeAlias.value === 'synthetic-one-time-value', 'create exposes raw alias only in ephemeral state');
  ok(!ctx.__pilot.renderIntakePilot.toString().includes('localStorage'), 'render path has no alias persistence');
  ok(!/must-not-render/.test(ctx.nodes.get('main').innerHTML), 'list response cannot render a raw alias field');
  const copyPromise = ctx.__pilot.pilotCopyAlias();
  ok(ctx.state.intakePilot.oneTimeAlias.copied === false, 'copy indicator stays false while clipboard promise is pending');
  clip.resolve(); await copyPromise;
  ok(ctx.state.intakePilot.oneTimeAlias.copied === true, 'copy indicator appears only after clipboard success');
}
{
  const ctx = makeContext({ clipboardImpl: async () => { throw new Error('denied'); } });
  ctx.state.intakePilot.contextKey = 'http://127.0.0.1:43123\u001fsynthetic-token\u001fcrew-synthetic';
  ctx.state.intakePilot.oneTimeAlias = { value:'still-visible', copied:false, copyError:false, generation:0, contextKey:ctx.state.intakePilot.contextKey };
  await ctx.__pilot.pilotCopyAlias();
  ok(ctx.state.intakePilot.oneTimeAlias.value === 'still-visible' && ctx.state.intakePilot.oneTimeAlias.copyError, 'clipboard denial keeps the visible value for manual copy');
}

console.log('# pagination, honest states and nullable summary');
{
  const offsets = [];
  const ctx = makeContext({ invokeImpl(command, args) {
    if (command === 'crewing_intake_candidate_list') {
      offsets.push(args.offset);
      const count = args.offset === 100 ? 1 : 50;
      return Promise.resolve({ items:Array.from({length:count},(_,i)=>({intake_id:`i-${args.offset+i}`,receipt_id:`r-${args.offset+i}`,state:'quarantined',content_type:'application/pdf',content_bytes:12,created_at:'2026-01-01',summary:null})),limit:50,offset:args.offset,total:101 });
    }
    if (command === 'crewing_intake_alias_list') return Promise.resolve({items:[]});
    throw new Error(command);
  }});
  ctx.__pilot.pilotEnter(); await flush();
  await ctx.__pilot.pilotLoadQueue(50); await ctx.__pilot.pilotLoadQueue(100);
  ok(offsets.join(',') === '0,50,100', 'pagination uses server offsets 0/50/100 without +1 gaps');
  ok(ctx.state.intakePilot.queue.total === 101 && ctx.state.intakePilot.queue.offset === 100, 'server limit/offset/total are preserved');
  const rendered = ctx.__pilot.pilotQueueHtml();
  ok(/Summary unknown/.test(rendered) && !/facts: 0/.test(rendered), 'null summary is unknown rather than measured zero');
  ok(/Stored; awaiting checks/.test(rendered), 'quarantined has the honest lifecycle label');
  ok(/Unknown reason: future_code/.test(ctx.__pilot.pilotReason('future_code')), 'unknown reason remains visible as its code');
  ok(Object.keys(ctx.__pilot.PILOT_REASON_TEXT).length === 41, 'RU/EN queue reason catalogue has all 41 contract codes');
  ctx.state.intakePilot.queue = {items:[],limit:50,offset:100,total:20};
  const shrunk = ctx.__pilot.pilotQueueHtml();
  ok(/Rows 0–0 of 20/.test(shrunk) && !/0–100/.test(shrunk), 'shrinking total cannot render an impossible row range');
}

console.log('# upload replay identity and late guards');
{
  const requests = [];
  let attempts = 0;
  const ctx = makeContext({ invokeImpl(command, args) {
    if (command === 'crewing_intake_candidate_submit') {
      requests.push(structuredClone(args.request)); attempts += 1;
      if (attempts === 1) return Promise.reject({kind:'network',ambiguous:true});
      return Promise.resolve({created:false,receipt:{intake_id:'intake-real',receipt_id:'receipt-real',state:'quarantined'}});
    }
    if (command === 'crewing_intake_candidate_list') return Promise.resolve({items:[],limit:50,offset:args.offset,total:0});
    if (command === 'crewing_intake_alias_list') return Promise.resolve({items:[]});
    throw new Error(command);
  }});
  ctx.__pilot.pilotEnter(); await flush();
  await ctx.__pilot.pilotSelectFile({files:[{name:'synthetic.pdf',size:9,type:'application/pdf',dataUrl:'data:application/pdf;base64,U1lOVEhFVElD'}]});
  const eventId = ctx.state.intakePilot.uploadAttempt.request.event_id;
  await ctx.__pilot.pilotSubmitUpload();
  ok(ctx.state.intakePilot.uploadError.ambiguous === true, 'lost upload response is shown as ambiguous and keeps the attempt');
  await ctx.__pilot.pilotSubmitUpload(); await flush();
  ok(requests.length === 2 && requests[0].event_id === eventId && JSON.stringify(requests[0]) === JSON.stringify(requests[1]), 'retry reuses the exact event ID and payload');
  ok(ctx.state.intakePilot.uploadReceipt.receipt.intake_id === 'intake-real' && ctx.state.intakePilot.uploadReceipt.receipt.receipt_id === 'receipt-real', 'typed receipt fields stay distinct in UI state');
}
{
  const delayed = deferred();
  const ctx = makeContext({ invokeImpl(command, args) {
    if (command === 'crewing_intake_candidate_list') return delayed.promise;
    if (command === 'crewing_intake_alias_list') return Promise.resolve({items:[]});
    throw new Error(command);
  }});
  ctx.__pilot.pilotEnter(); await flush();
  ctx.state.settings.crewing_id = 'crew-changed';
  delayed.resolve({items:[{intake_id:'stale'}],limit:50,offset:0,total:1}); await flush();
  ok(ctx.state.intakePilot.queue.items.length === 0, 'late queue response after tenant change cannot paint stale rows');
}
{
  const read = deferred();
  const ctx = makeContext({ fileReaderImpl(reader) { read.promise.then((value) => { reader.result=value; reader.onload(); }); } });
  ctx.state.intakePilot.contextKey = 'http://127.0.0.1:43123\u001fsynthetic-token\u001fcrew-synthetic';
  const selecting = ctx.__pilot.pilotSelectFile({files:[{name:'synthetic.pdf',size:9,type:'application/pdf'}]});
  ctx.state.settings.server_url = 'http://127.0.0.1:43124';
  read.resolve('data:application/pdf;base64,U1lOVEhFVElD'); await selecting;
  ok(ctx.state.intakePilot.uploadAttempt === null, 'context change during file read prevents dispatch payload creation');
}

console.log('# alias ABA lifetime, drafts and settings purge');
{
  const create = deferred();
  const ctx = makeContext({ invokeImpl(command, args) {
    if (command === 'crewing_intake_alias_create') return create.promise;
    if (command === 'crewing_intake_alias_list') return Promise.resolve({items:[]});
    if (command === 'crewing_intake_candidate_list') return Promise.resolve({items:[],limit:50,offset:args.offset,total:0});
    throw new Error(command);
  }});
  ctx.__pilot.pilotEnter(); await flush();
  ctx.state.intakePilot.aliasDraft = 'Draft survives';
  const pending = ctx.__pilot.pilotCreateAlias();
  ctx.__pilot.pilotLeave();
  ctx.state.view = 'intake_pilot';
  ctx.__pilot.pilotEnter();
  create.resolve({alias:'old-secret'}); await pending; await flush();
  ok(ctx.state.intakePilot.oneTimeAlias === null, 'leave and reopen with the same context cannot revive an old alias response');
}
{
  const create = deferred();
  const ctx = makeContext({ invokeImpl(command, args) {
    if (command === 'crewing_intake_alias_create') return create.promise;
    if (command === 'crewing_intake_alias_list') return Promise.resolve({items:[]});
    if (command === 'crewing_intake_candidate_list') return Promise.resolve({items:[],limit:50,offset:args.offset,total:0});
    throw new Error(command);
  }});
  ctx.__pilot.pilotEnter(); await flush();
  const pending = ctx.__pilot.pilotCreateAlias();
  ctx.state.settings.crewing_id = 'crew-B'; ctx.__pilot.renderIntakePilot();
  ctx.state.settings.crewing_id = 'crew-synthetic'; ctx.__pilot.renderIntakePilot();
  create.resolve({alias:'aba-secret'}); await pending;
  ok(ctx.state.intakePilot.oneTimeAlias === null, 'A to B to A context cycle cannot revive a pre-change alias response');
}
{
  const queue = deferred();
  const ctx = makeContext({ invokeImpl(command, args) {
    if (command === 'crewing_intake_candidate_list') return queue.promise;
    if (command === 'crewing_intake_alias_list') return Promise.resolve({items:[]});
    throw new Error(command);
  }});
  ctx.__pilot.pilotEnter(); await flush();
  ctx.state.intakePilot.aliasDraft = 'Typed while loading'; ctx.__pilot.renderIntakePilot();
  queue.resolve({items:[],limit:50,offset:0,total:0}); await flush();
  ok(/value="Typed while loading"/.test(ctx.nodes.get('main').innerHTML), 'queue completion preserves the in-progress alias label draft');
}
{
  let clipboardCalls = 0;
  const ctx = makeContext({ clipboardImpl: async () => { clipboardCalls += 1; } });
  ctx.__pilot.pilotEnter(); await flush();
  const generation = ctx.state.intakePilot.generation;
  const key = ctx.state.intakePilot.contextKey;
  ctx.state.intakePilot.oneTimeAlias = {value:'old-secret',copied:false,copyError:false,generation,contextKey:key};
  const previous = ctx.state.settings;
  const next = {...previous, bearer_token:'new-token'};
  ctx.state.settings = next;
  ctx.__pilot.pilotSettingsChanged(previous, next);
  await ctx.__pilot.pilotCopyAlias();
  ok(ctx.state.intakePilot.oneTimeAlias === null && clipboardCalls === 0, 'settings save purges old alias before it can reach the clipboard');
}

console.log('# no-config and duplicate-click controls');
{
  const ctx = makeContext();
  ctx.state.settings.bearer_token = '';
  ctx.__pilot.pilotEnter(); await flush();
  ok(ctx.calls.length === 0, 'unconfigured pilot performs zero network invokes');
}
{
  const create = deferred();
  const ctx = makeContext({ invokeImpl(command, args) {
    if (command === 'crewing_intake_alias_create') return create.promise;
    if (command === 'crewing_intake_alias_list') return Promise.resolve({items:[]});
    if (command === 'crewing_intake_candidate_list') return Promise.resolve({items:[],limit:50,offset:args.offset,total:0});
    throw new Error(command);
  }});
  ctx.__pilot.pilotEnter(); await flush();
  const first = ctx.__pilot.pilotCreateAlias();
  const second = ctx.__pilot.pilotCreateAlias();
  ok(ctx.calls.filter((call) => call.command === 'crewing_intake_alias_create').length === 1, 'duplicate create clicks dispatch exactly one write');
  create.resolve({alias:'once'}); await first; await second;
}

console.log(`\ncrewing_c3b1_pilot_harness: GREEN (${passed} passed, 0 failed)`);
