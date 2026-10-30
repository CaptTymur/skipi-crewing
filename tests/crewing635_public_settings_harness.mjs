import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
function between(start,end) {
  const a=html.indexOf(start),b=html.indexOf(end,a);
  if(a<0||b<a) throw new Error('real source seam absent: '+start);
  return html.slice(a,b);
}
const wrapper=between('var __realInvoke = window.__TAURI__.core.invoke;','var convertFileSrc =');
const pubkey=between('function registerMessagingPubkey()','function serverUrlArg()');
const trial=between('var trialServerStatus =','async function trialPhase(opts)');
// No.880: фаза права читает предикат аккаунт-сессии, и слайс, в котором он живёт,
// обязан грузиться здесь же. В продукте это одна область видимости; стенд, который
// её не воспроизводит, ловил бы ReferenceError внутри try и читал его как
// «настройки нечитаемы» — зелёный стенд при неработающем пути.
const sessionPredicate=between('function crewingAccountSessionActive(s){','var __entryNext = null;');
// No.880/§2: швы activateCompanyToken / mobileSaveConnection / mobileValidateConnection
// сняты вместе со слоем токена компании ((1495) «никаких токенов»). Свойства, которые
// они проверяли — «сохранённый секрет не уходит», «уходит ИСХОДНЫЙ контекст», «поздний
// ответ не занимает новый контекст» — не потеряны: они перенесены на единственный
// оставшийся вызов того же класса, вход аккаунтом.
const accountLogin=between('async function nativeAccountLogin(','async function saveSettings(');
const secret='SYNTHETIC-PRIVATE-635-NOT-FOR-UI';
function publicFixture() {
  // Independent full native public response, no production DTO serializer or source constant.
  return {
    server_url:'https://synthetic.invalid',has_bearer_token:true,connection_context:'ctx_fixture_a',
    crewing_id:'company-635',organization_id:'org-635',company_name:'Synthetic owner company',
    user_display_name:'Synthetic owner',token_scopes:['applications:read'],token_expires_at:'2099-10-19T12:00:00Z',
    team_role:'member',team_onboarding_seen:true,reply_to:'owner@example.invalid',
    vault_path:'/synthetic/vault',recent_vaults:['/synthetic/old-vault'],
    profile:{legal_name:'Synthetic legal owner',jurisdiction:'GB',registration_number:'REG-635',
      mlc_cert_number:'MLC-635',mlc_cert_valid_to:'2099-10-19',contact_email:'owner@example.invalid',
      contact_phone:'+10000000635',slug:'synthetic-owner',public_description:'Synthetic profile'},
    interface:{theme:'light',language:'ru'},
    // No.880 пункт 4: фикстура изображает ВОШЕДШЕГО владельца, поэтому
    // account_session:'active'. Валидатор продукта теперь требует все три поля,
    // и синтетический DTO обязан их объявлять — иначе он проверяет не то, что
    // приезжает из Rust.
    account_session:'active',entitlement_source:'approved_free',entitlement_expires_at:null,
  };
}
const clone=v=>JSON.parse(JSON.stringify(v));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function runtime(transport) {
  const calls=[],changes=[],notices=[];
  const nodes=new Map(Object.entries({
    // No.880/§5: узлов s-url / s-token / s-crewing-id / m-* в фикстуре больше нет —
    // поля, которые они изображали, удалены из интерфейса вместе со слоем токена.
    's-company':'Synthetic owner company','s-reply':'owner@example.invalid',
    'a-email':'','a-password':'',
  }).map(([id,value])=>[id,{value}]));
  const ctx={document:{getElementById:(id)=>nodes.get(id)||null},
    showToast:(text,kind)=>notices.push([text,kind]),getUiLang:()=> 'ru',
    updateTeamNavVisibility(){},mobileShow(){},
state:{settings:publicFixture()},localStorage:{getItem(){return null;}},
    console:{log(){},warn(){},error(){}},pilotSettingsChanged(previous,next){changes.push([clone(previous),clone(next)]);}};
  ctx.window={__TAURI__:{core:{invoke:(command,args)=>{calls.push([command,args]);return transport(command,args);}}}};
  vm.createContext(ctx);vm.runInContext(wrapper+'\n'+sessionPredicate+'\n'+pubkey+'\n'+trial+'\n'+accountLogin,ctx);
  return{ctx,calls,changes,nodes,notices};
}
let passed=0,failed=0,setup=0;
function ok(value,label){if(value){passed++;console.log('PASS '+label);}else{failed++;console.error('FAIL '+label);}}
async function run(name,fn){try{await fn();}catch(e){setup++;console.error('SETUP '+name+': '+e.message);}}
async function rejection(promise){try{await promise;return null;}catch(e){return String(e.message||e);}}
await run('successful actual wrapper save',async()=>{
  const response=publicFixture();response.interface.theme='dark';
  const {ctx,calls}=runtime(async()=>clone(response));
  const submitted=publicFixture();submitted.bearer_token=secret;submitted.obsolete_private_field=secret;
  submitted.interface.theme='dark';
  const result=await ctx.invoke('save_settings',{newSettings:submitted});
  ok(calls.length===1&&calls[0][0]==='save_settings','one real core dispatch');
  ok(calls[0][1].expectedContext==='ctx_fixture_a','caller context sent explicitly');
  ok(!Object.hasOwn(submitted,'bearer_token')&&!Object.hasOwn(submitted,'obsolete_private_field'),
    'same submitted object loses all former private fields');
  ok(JSON.stringify(submitted)===JSON.stringify(response),'same object receives complete public owner fields');
  ok(JSON.stringify(result)===JSON.stringify(response),'public native result returned intact');
  ok(!JSON.stringify(ctx.state.settings).includes(secret),'live UI state contains no submitted secret');
});
await run('reject leaves caller untouched',async()=>{
  const {ctx}=runtime(async()=>{throw new Error('persist_failed');});
  const submitted=publicFixture(),before=JSON.stringify(submitted),stateBefore=JSON.stringify(ctx.state.settings);
  ok(await rejection(ctx.invoke('save_settings',{newSettings:submitted}))==='persist_failed','native failure propagated');
  ok(JSON.stringify(submitted)===before&&JSON.stringify(ctx.state.settings)===stateBefore,'failure preserves owner/caller state');
});
await run('stale and absent caller context',async()=>{
  for(const revision of ['ctx_stale','']){
    const {ctx,calls}=runtime(async()=>publicFixture());const submitted=publicFixture();submitted.connection_context=revision;
    ok(await rejection(ctx.invoke('save_settings',{newSettings:submitted}))==='settings_changed','old/missing context denied');
    ok(calls.length===0,'old/missing context refuses before native dispatch');
  }
});
await run('late response cannot rewind context',async()=>{
  const pending=deferred(),{ctx}=runtime(()=>pending.promise);const submitted=publicFixture();const before=JSON.stringify(submitted);
  const saving=ctx.invoke('save_settings',{newSettings:submitted});
  ctx.state.settings={...publicFixture(),connection_context:'ctx_fixture_b',crewing_id:'company-b'};
  pending.resolve(publicFixture());
  ok(await rejection(saving)==='settings_changed','late native save response rejected');
  ok(ctx.state.settings.crewing_id==='company-b'&&JSON.stringify(submitted)===before,'late response changes neither active context nor caller');
});
await run('freeze dispatched caller',async()=>{
  const pending=deferred(),{ctx,calls}=runtime(()=>pending.promise);const submitted=publicFixture();
  const saving=ctx.invoke('save_settings',{newSettings:submitted});submitted.profile.legal_name='mutated-after-dispatch';
  ok(calls[0][1].newSettings.profile.legal_name==='Synthetic legal owner','native payload frozen before await');
  pending.resolve(publicFixture());await saving;
});
await run('invalid public responses',async()=>{
  for(const response of [null,'ok',{}, {...publicFixture(),bearer_token:secret}, {...publicFixture(),profile:{}}]){
    const {ctx}=runtime(async()=>response);const submitted=publicFixture();const before=JSON.stringify(submitted);
    ok(await rejection(ctx.invoke('save_settings',{newSettings:submitted}))==='invalid_public_settings','malformed or secret-bearing result rejected');
    ok(JSON.stringify(submitted)===before,'invalid response preserves submitted owner fields');
  }
});
await run('actual pubkey caller stays public',async()=>{
  const identity={user_id:'synthetic-device',pubkey_b64:'synthetic-public-key'};
  const {ctx,calls}=runtime(async()=>identity);ctx.state.settings.bearer_token=secret;
  const result=await ctx.registerMessagingPubkey();const args=calls[0][1]||{};
  ok(calls[0][0]==='register_my_pubkey','actual pubkey command retained');
  ok(args.expectedContext==='ctx_fixture_a'&&!Object.hasOwn(args,'bearerToken')&&!Object.hasOwn(args,'crewingId')&&!Object.hasOwn(args,'serverUrl'),
    'pubkey request carries context and leaves credential/tenant/base selection native');
  ok(result.user_id===identity.user_id&&result.pubkey_b64===identity.pubkey_b64,'public identity preserved');
});
// No.880 пункт 4: ПРЕДМЕТ СМЕНИЛСЯ, а не снят. Прежний блок доказывал, что
// фоновая проверка токена не уносит сохранённый креденшал. Фоновой проверки
// токена больше нет — команда activate_crewing_token снимается, а свежесть
// права даёт перечитывание публичной проекции. Поэтому доказывается сильнее:
// обновление не может унести креденшал ПО КОНСТРУКЦИИ — у него нет аргументов.
await run('actual entitlement refresh stays public and argument-free',async()=>{
  const {ctx,calls}=runtime(async(command)=>{
    if(command==='get_settings')return publicFixture();
    throw new Error('unexpected actual command '+command);
  });
  ctx.state.settings.bearer_token=secret;
  const result=await ctx.trialRefreshEntitlement(true);
  const refresh=calls.find(row=>row[0]==='get_settings');
  ok(!!refresh,'the refresh reads the public projection');
  ok(!calls.some(row=>row[0]==='activate_crewing_token'),
    'No.880: no manual company-token activation is dispatched any more');
  ok(refresh&&(refresh[1]===undefined||Object.keys(refresh[1]||{}).length===0),
    'the refresh carries no arguments at all, so no saved credential can ride in one');
  ok(!JSON.stringify(ctx.state.settings).includes(secret),
    'the refreshed public state carries no private credential');
  ok(result.phase==='free','an active session without an entitlement expiry reads free');
});
await run('account login carries the original context and no saved credential',async()=>{
  const {ctx,calls,nodes}=runtime(async(command)=>{
    if(command==='native_account_login')return{server_url:'https://synthetic.invalid',scopes:['read'],expires_at:'2027-01-01T00:00:00Z'};
    throw new Error('unexpected command '+command);
  });
  ctx.state.settings.bearer_token=secret;         // старое/подброшенное поле не должно уехать
  nodes.get('a-email').value='owner@example.invalid';
  nodes.get('a-password').value='synthetic-password';
  await ctx.nativeAccountLogin();
  const login=calls.find(row=>row[0]==='native_account_login');
  ok(!!login,'account login invoked');
  ok(login&&login[1].expectedContext==='ctx_fixture_a','login sends the ORIGINAL caller context');
  ok(login&&!JSON.stringify(login[1]).includes(secret),'login sends no saved credential');
  ok(login&&!Object.hasOwn(login[1],'bearerToken'),'login carries no bearerToken key at all');
});
await run('a late account-login reply cannot borrow a newer context',async()=>{
  const pending=deferred();
  const {ctx,calls,nodes}=runtime(async(command)=>{
    if(command==='native_account_login')return pending.promise;
    throw new Error('unexpected command '+command);
  });
  nodes.get('a-email').value='owner@example.invalid';
  nodes.get('a-password').value='synthetic-password';
  const inflight=ctx.nativeAccountLogin();
  ctx.state.settings.connection_context='ctx_fixture_b';   // контекст сменился, пока вызов в полёте
  pending.resolve({server_url:'https://synthetic.invalid',scopes:['read'],expires_at:'2027-01-01T00:00:00Z'});
  await inflight;
  const login=calls.find(row=>row[0]==='native_account_login');
  ok(login&&login[1].expectedContext==='ctx_fixture_a',
    'the in-flight call keeps the context it was dispatched with, not the newer one');
});
await run('No.635 slice A — account login reachable from the interface',async()=>{
  // FAILING-FIRST for slice A. Anchored on the product seam the slice introduces, so today it
  // fails BY NAME ("real source seam absent") rather than vacuously. The behavioural assertions
  // below are deliberately unreachable until the seam exists; the reachable one is the red.
  let seam=null,seamError=null;
  // End anchor is the NEXT top-level declaration. Was activateCompanyToken until No.880
  // removed the company-token layer; now saveSettings — loginRefusalText must stay INSIDE the seam, otherwise the
  // refusal path throws on it before the text ever reaches the person.
  // EXCLUDES its end marker, so ending on '\n}' sliced the function without its closing
  // brace and vm.runInNewContext threw SyntaxError. The red was real but the green was
  // unreachable — a failing-first test must be shown in BOTH states.
  try{ seam=between('async function nativeAccountLogin(','async function saveSettings('); }
  catch(error){ seamError=String(error&&error.message||error); }
  ok(seam!==null,'account-login seam present in dist/index.html :: '+(seamError||'found'));
  if(seam===null)return;
  const {ctx,calls}=runtime(async(command)=>{
    if(command==='native_account_login')return{server_url:'https://synthetic.invalid',
      scopes:['applications:read'],expires_at:'2099-10-19T12:00:00Z',entitlement_source:'approved_free',
      local_outcome:'committed_inactive'};
    throw new Error('unexpected command '+command);
  });
  vm.runInNewContext(seam,ctx);
  ctx.document.getElementById('a-email').value='owner@example.invalid';
  ctx.document.getElementById('a-password').value='synthetic-only-password';
  await ctx.nativeAccountLogin();
  const login=calls.filter(row=>row[0]==='native_account_login');
  ok(login.length===1,'exactly one native_account_login dispatched');
  ok(!calls.some(row=>row[0]==='activate_crewing_token'),'no manual company-token activation dispatched');
  const args=login[0]&&login[0][1]||{};
  ok(args.email==='owner@example.invalid'&&args.password==='synthetic-only-password',
     'login carries the typed email and password');
  ok(Object.prototype.hasOwnProperty.call(args,'expectedContext'),'login carries the current connection context under the camelCase key Tauri 2 expects');
  ok(!JSON.stringify(ctx.state.settings).includes('skn_'),'no native credential enters live UI state');
  ok(!Object.prototype.hasOwnProperty.call(args,'crewing_id')
     && !JSON.stringify(login[0][1]).includes('company-'),'login carries no company identifier');
});
await run('No.635 slice A — the form and its refusal texts exist in the shipped source',async()=>{
  ok(html.includes('\'a-email\'')&&html.includes('\'a-password\''),'the login form declares both inputs');
  const missing=['settings.crewing.login.bad_email','settings.crewing.login.invalid_credentials','settings.crewing.login.too_many_attempts','settings.crewing.login.upstream_unavailable','settings.crewing.login.transport_unreachable','settings.crewing.login.exchange_failed','settings.crewing.login.entitlement_missing','settings.crewing.login.entitlement_expired','settings.crewing.login.entitlement_revoked','settings.crewing.login.scope_denied','settings.crewing.login.refused_unspecified','settings.crewing.login.restart_needed','settings.crewing.login.storage_error','settings.crewing.login.local_damaged','settings.crewing.login.settings_changed','settings.crewing.login.unsupported_platform','settings.crewing.login.fresh_unavailable','settings.crewing.login.binding_missing'].filter(k=>!(html.includes('"'+k+'"')));
  ok(missing.length===0,'every login text key is defined :: missing '+JSON.stringify(missing));
});
await run('No.635 slice A — a refusal code reaches the person as its own text',async()=>{
  let seam=null;
  try{ seam=between('async function nativeAccountLogin(','async function saveSettings('); }catch(e){}
  if(seam===null){ ok(false,'seam absent'); return; }
  const {ctx,notices}=runtime(async()=>{ throw new Error('entitlement_expired'); });
  vm.runInNewContext(seam,ctx);
  ctx.document.getElementById('a-email').value='owner@example.invalid';
  ctx.document.getElementById('a-password').value='synthetic-only-password';
  await ctx.nativeAccountLogin().then(()=>null,()=>null);
  ok(notices.some(row=>row[0]==='settings.crewing.login.entitlement_expired'&&row[1]==='error'),
     'entitlement_expired shows its own text, not a generic one :: '+JSON.stringify(notices));
});

// ===== No.827: IPC key names — every invoke() key must be the camelCase of a #[tauri::command] parameter =====
// Inserted into tests/crewing635_public_settings_harness.mjs before the final JSON summary line.
// Failing-first on a88bdaa: exactly one pair reddens — native_account_login / expected_context
// (dist/index.html:15110-15111 vs lib.rs:785-791). The class is pinned, not the one key:
// every #[tauri::command] in src-tauri/src/*.rs against every invoke('name', {…}) in dist/index.html.
const rsDir=new URL('../src-tauri/src/',import.meta.url);
const rsSources=Object.fromEntries(fs.readdirSync(rsDir).filter(f=>f.endsWith('.rs')).sort().map(f=>[f,fs.readFileSync(new URL(f,rsDir),'utf8')]));
const INJECTED=/\b(?:tauri::)?(?:State|AppHandle|Window|Webview|WebviewWindow|ipc::Channel)\b/;
function camel(s){return s.replace(/_([a-z0-9])/g,(_,c)=>c.toUpperCase());}
// Index of the bracket closing the one opened just before `i`; skips string literals and comments.
// `quotes` names the string openers: "'\"`" for JS, '"' alone for Rust (there `'` is a lifetime).
function balancedEnd(src,i,open,close,quotes){
  let depth=1,j=i;
  while(j<src.length&&depth>0){
    const ch=src[j];
    if(quotes.includes(ch)){const q=ch;j++;while(j<src.length&&src[j]!==q){if(src[j]==='\\')j++;j++;}j++;continue;}
    if(ch==='/'&&src[j+1]==='/'){j=src.indexOf('\n',j);if(j<0)j=src.length;continue;}
    if(ch==='/'&&src[j+1]==='*'){j=src.indexOf('*/',j);j=j<0?src.length:j+2;continue;}
    if(ch===open)depth++;else if(ch===close)depth--;
    j++;
  }
  return depth===0?j-1:-1;
}
function stripComments(src){return src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:\\'"])\/\/[^\n]*/g,'$1');}
function splitTop(src,quotes){   // top-level commas across (), [], {}, <> and strings
  const out=[];let depth=0,cur='',j=0;
  while(j<src.length){
    const ch=src[j];
    if(quotes.includes(ch)){const q=ch;let k=j+1;while(k<src.length&&src[k]!==q){if(src[k]==='\\')k++;k++;}cur+=src.slice(j,k+1);j=k+1;continue;}
    if('([{<'.includes(ch))depth++;else if(')]}>'.includes(ch))depth--;
    if(ch===','&&depth===0){out.push(cur);cur='';j++;continue;}
    cur+=ch;j++;
  }
  if(cur.trim())out.push(cur);
  return out.map(s=>s.trim()).filter(Boolean);
}
// Rust: every #[tauri::command] definition with its non-injected parameter names.
// Survives pub(crate)/async/unsafe, attributes and comments between the attribute and `fn`,
// multi-line parameter lists, generics with commas, lifetimes (State<'_, AppState>).
function rustCommands(sources){
  const defs=[],renameAll=[];
  for(const [file,src] of Object.entries(sources)){
    const re=/#\[tauri::command(\([^)]*\))?\]/g;let m;
    while((m=re.exec(src))){
      if(m[1]&&/rename_all/.test(m[1]))renameAll.push(file+':'+src.slice(0,m.index).split('\n').length);
      let j=re.lastIndex;
      for(;;){const rest=src.slice(j);const skip=rest.match(/^(?:\s+|#\[[^\]]*\]|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)/);if(!skip)break;j+=skip[0].length;}
      const head=src.slice(j).match(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\s*\(/);
      const line=src.slice(0,m.index).split('\n').length;
      if(!head){defs.push({file,line,name:null,error:'fn head not parsed'});continue;}
      const open=j+head[0].length,close=balancedEnd(src,open,'(',')','"');
      if(close<0){defs.push({file,line,name:head[1],error:'unbalanced params'});continue;}
      const params=splitTop(stripComments(src.slice(open,close)),'"').map(p=>{
        const pm=p.match(/^(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([\s\S]+)$/);
        return pm?{name:pm[1],type:pm[2].trim()}:{name:null,type:p};
      });
      defs.push({file,line,name:head[1],args:params.filter(p=>p.name&&p.name!=='self'&&!INJECTED.test(p.type)).map(p=>p.name)});
    }
  }
  return {defs,renameAll};
}
// JS: every invoke(...) call site of the shipped page; the argument object is read by bracket balance,
// Object.assign(...) and the pilotExpected(ctx) helper (→ expectedContext) are resolved; anything else
// (an identifier, a spread) is reported as UNRESOLVED rather than silently skipped.
function objectKeys(objText){
  const keys=[],unresolved=[];
  for(const entry of splitTop(stripComments(objText.slice(1,-1)),"'\"`")){
    let km;
    if(entry.startsWith('...'))unresolved.push(entry.slice(0,40));
    else if((km=entry.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*:/)))keys.push(km[1]);
    else if((km=entry.match(/^(['"])([^'"]+)\1\s*:/)))keys.push(km[2]);
    else if((km=entry.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*$/)))keys.push(km[1]);
    else unresolved.push(entry.slice(0,40));
  }
  return {keys,unresolved};
}
function resolveArg(a){
  a=a.trim();
  if(a[0]==='{'&&a[a.length-1]==='}')return objectKeys(a);
  if(/^pilotExpected\(/.test(a))return {keys:['expectedContext'],unresolved:[]};
  const oa=a.match(/^Object\.assign\(([\s\S]*)\)$/);
  if(oa){const r={keys:[],unresolved:[]};for(const part of splitTop(oa[1],"'\"`")){const x=resolveArg(part);r.keys.push(...x.keys);r.unresolved.push(...x.unresolved);}return r;}
  return {keys:[],unresolved:[a.slice(0,40)]};
}
function jsInvokes(src){
  const sites=[];const re=/invoke\(/g;let m;
  while((m=re.exec(src))){
    const before=src.slice(Math.max(0,m.index-12),m.index);
    if(/[A-Za-z0-9_$.]$/.test(before))continue;      // __realInvoke( / core.invoke — not a call site
    if(/function\s+$/.test(before))continue;          // the wrapper definition
    const line=src.slice(0,m.index).split('\n').length;
    const site={line};
    const attr=src.slice(m.index).match(/^invoke\(\\'([A-Za-z_][A-Za-z0-9_]*)\\'\s*,\s*\{([^}]*)\}\s*\)/);   // inside an HTML-attribute string
    if(attr){site.kind='app';site.command=attr[1];site.shape='args';site.keys=[...attr[2].matchAll(/(?:^|,)\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g)].map(k=>k[1]);site.unresolved=[];sites.push(site);continue;}
    const open=m.index+m[0].length-1,close=balancedEnd(src,open+1,'(',')',"'\"`");
    if(close<0){sites.push({line,kind:'unparsed',error:'unbalanced',keys:[],unresolved:[]});continue;}
    const argv=splitTop(src.slice(open+1,close),"'\"`");
    const lit=(argv[0]||'').match(/^(['"])([A-Za-z_][A-Za-z0-9_|:-]*)\1$/);
    if(!lit){site.kind='dynamic';site.command=null;}
    else if(lit[2].startsWith('plugin:')){site.kind='plugin';site.command=lit[2];}
    else{site.kind='app';site.command=lit[2];}
    if(argv.length<2){site.shape='no-args';site.keys=[];site.unresolved=[];}
    else{const r=resolveArg(argv[1]);site.shape='args';site.keys=r.keys;site.unresolved=r.unresolved;}
    sites.push(site);
  }
  return sites;
}
function keyMismatches(defs,sites){
  const byName=new Map();
  for(const d of defs)if(d.name){if(!byName.has(d.name))byName.set(d.name,new Set());for(const a of d.args||[])byName.get(d.name).add(a);}
  const out=[];
  for(const s of sites){
    if(s.kind!=='app')continue;
    const params=byName.get(s.command);
    if(!params){out.push(s.line+':'+s.command+':<no #[tauri::command] with this name>');continue;}
    const allowed=new Set([...params].map(camel));
    for(const k of s.keys)if(!allowed.has(k))out.push(s.line+':'+s.command+':'+k+' (parameters: '+[...params].join(',')+')');
  }
  return {byName,out};
}
await run('No.827 — invoke() keys are the camelCase of #[tauri::command] parameters, for every command of the house',async()=>{
  const {defs,renameAll}=rustCommands(rsSources);
  const attrOccurrences=(Object.values(rsSources).join('\n').match(/#\[tauri::command/g)||[]).length;
  const parseErrors=defs.filter(d=>d.error);
  ok(attrOccurrences>0&&defs.length===attrOccurrences&&parseErrors.length===0,
     'Rust parser: every #[tauri::command] attribute yields one parsed definition :: attrs='+attrOccurrences+' parsed='+defs.length+' errors='+JSON.stringify(parseErrors));
  ok(renameAll.length===0,'no #[tauri::command(rename_all=…)] in the house — the predicate assumes the Tauri 2 default (camelCase) :: '+JSON.stringify(renameAll));
  const hbStart=rsSources['lib.rs'].indexOf('generate_handler![');
  const hbEnd=balancedEnd(rsSources['lib.rs'],hbStart+'generate_handler!['.length,'[',']','"');
  const handlerNames=splitTop(stripComments(rsSources['lib.rs'].slice(hbStart+'generate_handler!['.length,hbEnd)),'"').filter(s=>/^[A-Za-z_][A-Za-z0-9_:]*$/.test(s));
  const {byName,out}=keyMismatches(defs,jsInvokes(html));
  ok(handlerNames.length>0&&handlerNames.every(n=>byName.has(n.split('::').pop())),
     'every tauri::generate_handler![] entry is a parsed definition :: entries='+handlerNames.length+' definitions(unique)='+byName.size);
  const sites=jsInvokes(html);
  const app=sites.filter(s=>s.kind==='app'),dyn=sites.filter(s=>s.kind==='dynamic'),plugin=sites.filter(s=>s.kind==='plugin');
  // No.880 S2 п.1: команды Team и токена/триала СНЯТЫ по слову владельца (1495).
  // Проверяется и объявление (#[tauri::command]), и регистрация
  // (generate_handler!), и вызов из UI — иначе снятая из списка команда могла бы
  // остаться живой в теле, а снятое тело — остаться в списке.
  // No.880 S2 п.5: цепочка «дверь → помощник → команда» закрывается здесь на
  // последнем звене. Дверь→помощник пинит presence (`onclick="entryOpenRegister()"`),
  // а это звено проверяет, что помощник действительно ЗОВЁТ команду, а не
  // показывает адрес человеку, как было до S2. Без этого возврат к заглушке
  // прошёл бы зелёным: харнесс проверял лишь то, что всякий вызов существует.
  {
    const opener=(html.match(/async function crewingOpenExternalUrlSafe\(url\)\{[\s\S]*?\n\}/)||[''])[0];
    ok(opener.length>0,'No.880/п.5: the external-url helper is found in dist (control for the assertions below)');
    ok(/invoke\('open_external_url',\s*\{\s*url:/.test(opener),
       'No.880/п.5: the helper dispatches open_external_url with the url argument');
    ok(sites.some(s=>s.command==='open_external_url'),
       'No.880/п.5: the invoke-site parser sees that call too (so the command-exists pin covers it)');
    // Аллоулист ОДИН и живёт в Rust: клиент его не дублирует, иначе было бы два
    // места сборки одного решения и они разошлись бы молча.
    ok(!/assistant\.skipi\.app/.test(opener.replace(/CREWING_REGISTER_URL/g,'')),
       'No.880/п.5: the client does not re-implement the host allowlist');
    ok(/catch\s*\(/.test(opener)&&/showToast\(/.test(opener),
       'No.880/п.5: a refusal is said out loud, not swallowed (canon UI)');
  }

  const RETIRED_BY_880=['claim_team_owner','list_team_members','add_team_member','remove_team_member',
    'fetch_team_chat_messages','send_team_chat_message','activate_crewing_token','issue_crewing_trial_token'];
  // ПОЛОЖИТЕЛЬНЫЙ КОНТРОЛЬ тем же предикатом: живая команда обязана находиться
  // во всех трёх местах, иначе отрицания ниже прошли бы на пустом поиске.
  for (const alive of ['get_settings','save_settings','native_account_login']) {
    ok(byName.has(alive)&&handlerNames.some(n=>n.split('::').pop()===alive),
       'control: a live command is found by the same predicate :: '+alive);
  }
  for (const gone of RETIRED_BY_880) {
    ok(!byName.has(gone),'No.880: retired command has no #[tauri::command] definition :: '+gone);
    ok(!handlerNames.some(n=>n.split('::').pop()===gone),
       'No.880: retired command is not registered in generate_handler! :: '+gone);
    ok(!sites.some(s=>s.command===gone),'No.880: nothing in the UI invokes the retired command :: '+gone);
  }

  const simple=(html.match(/\binvoke\(/g)||[]).length;
  ok(sites.length>0&&sites.length===simple&&!sites.some(s=>s.kind==='unparsed'),
     'JS parser: every `invoke(` occurrence became one classified call site :: occurrences='+simple+' sites='+sites.length+' app='+app.length+' plugin='+plugin.length+' dynamic='+dyn.length);
  // positive controls of the resolver on pairs known to be right
  const saveSite=app.find(s=>s.command==='save_settings'&&s.keys.includes('newSettings'));
  const assignSite=app.find(s=>s.command.startsWith('crewing_intake_')&&s.keys.includes('expectedContext'));
  ok(!!saveSite&&!!assignSite,'resolver positive control: save_settings{newSettings} and an Object.assign(pilotExpected(…)) site resolve to their keys');
  ok(dyn.length===3,'dynamic command names stay an explicit UNRESOLVED list of 3 (invoke(command, Object.assign(pilotExpected(…)…)) :: lines '+dyn.map(s=>s.line).join(','));
  const unresolvedArgs=sites.filter(s=>s.unresolved&&s.unresolved.length);
  ok(unresolvedArgs.length<=2,'argument objects that are a bare identifier stay an explicit UNRESOLVED list (≤2) :: '+unresolvedArgs.map(s=>s.line+':'+(s.command||'<dynamic>')+':'+s.unresolved.join('|')).join('; '));
  ok([...new Set(app.map(s=>s.command))].every(n=>byName.has(n)),'every literal invoke names an existing #[tauri::command] :: unique app commands='+new Set(app.map(s=>s.command)).size);
  ok(out.length===0,'every resolved invoke key is the camelCase of a parameter of its command :: sites_with_args='+app.filter(s=>s.shape==='args').length+' keys='+app.reduce((n,s)=>n+s.keys.length,0)+' mismatches='+JSON.stringify(out));
  // mutation negative IN MEMORY (never by editing the product): the predicate must redden on a
  // synthetic snake_case key and stay green on its camelCase form
  const synth={'synthetic.rs':"#[tauri::command]\npub(crate) async fn demo_cmd(\n    foo_bar: String,\n    state: tauri::State<'_, AppState>,\n) -> Result<(), String> { Ok(()) }\n"};
  const red=keyMismatches(rustCommands(synth).defs,jsInvokes("await invoke('demo_cmd', { foo_bar: x });")).out;
  const green=keyMismatches(rustCommands(synth).defs,jsInvokes("await invoke('demo_cmd', { fooBar: x });")).out;
  ok(red.length===1&&/foo_bar/.test(red[0])&&green.length===0,'mutation negative in memory: synthetic foo_bar/foo_bar reddens, fooBar/foo_bar stays green :: red='+JSON.stringify(red)+' green='+JSON.stringify(green));
});

console.log(JSON.stringify({passed,failed,setup_errors:setup,coverage:'actual shipped invoke/pubkey/stored-validation callers; synthetic native transport, no network/profile/DB; native persistence tested separately'}));
if(failed||setup)process.exitCode=1;
