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
  // No.898/F12: список ключей ВЫВОДИТСЯ из значений карты, а не набирается рукой. Прежняя
  // форма держала 18 имён поимённо, и удаление ключа из источника делало её лгущей о
  // требовании: копия рядом с источником — второе место сборки одного решения.
  const mapForKeys=(html.match(/function loginRefusalText\(code\) \{\n  var map = (\{[\s\S]*?\});/)||['',''])[1];
  const derivedKeys=[...new Set([...mapForKeys.matchAll(/"([a-z_]+)":\s*"([a-z_]+)"/g)].map((m)=>m[2]))];
  // `refused_unspecified` — цель ФОЛЛБЭКА, она живёт в коде функции, а не в карте; назвать
  // её здесь обязательно, иначе ключ, который человек видит чаще всего, никем не проверен.
  const expectedKeys=[...new Set(derivedKeys.concat(['refused_unspecified']))];
  // No.898 под-стадия 2 (Н2): порог `>=18` СНЯТ. Это было число из размера СТАРОГО
  // рукописного списка, то есть оно отставало от измеренного ещё в момент написания (после
  // F12 карта даёт 27 пар и 23 цели — отставание на пять). Вместо числа, которое надо
  // поддерживать руками, стоят контроли РАЗБОРА: если регекс карты сломается, список
  // обрушится, и поймают это они, а не порог.
  ok(/"bad_email":\s*"bad_email"/.test(mapForKeys),'control: the map block really parsed — a known pairing is present');
  // No.898 3a, долг 2: УСЛОВИЕ ДОСТАТОЧНОСТИ стоит механизмом, а не комментарием. Контроли
  // разбора выше сидят на 0 %, 41 % и 56 % блока карты и потому НЕ ограничивают хвостовую
  // обрезку; достаточны они ровно ПОКА КАРТА ПЛОСКАЯ, потому что в плоской карте нежадный
  // `};` не может оборваться раньше её собственной закрывающей скобки. Поэтому плоскость
  // ПРОВЕРЯЕТСЯ: в день, когда внутрь карты попадёт вложенный объект, это покраснеет и
  // скажет читателю, что контролей разбора больше не хватает — вместо того чтобы молча
  // перестать хватать.
  ok(!/\{[^{}]*\{/.test(mapForKeys),'control: the map is FLAT, which is the condition under which the parse controls above are sufficient');
  ok(expectedKeys.includes('refused_unspecified')&&expectedKeys.includes('storage_error'),
     'control: the derived list holds known-required keys, so it is a list and not a fragment');
  ok(expectedKeys.length>0,'control: the derived key list is non-empty — '+expectedKeys.length+' keys, measured and not a maintained constant');
  const missing=expectedKeys.map((k)=>'settings.crewing.login.'+k).filter((k)=>!(html.includes('"'+k+'"')));
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
// No.898/F12: популяция ассерта определяется ДОСТИЖИМОСТЬЮ до `loginRefusalText`, а не
// рукописным списком модулей. Прежняя форма имела два слоя дефекта: (а) модули выбраны
// рукой, поэтому `lib.rs` и `native_fresh.rs` в неё не входили вовсе; (б) предикат искал
// только `Err("…")`/`ok_or`/`map_err` и НЕ ВИДЕЛ кодов, собранных полем структуры
// (`AllocationError { code }`, `Self { code: if … }`). Расширение списка модулей само по
// себе (б) не закрывает: `native_fresh.rs` прежним предикатом даёт ровно 0 кодов.
// Достижимость заменяет и список исключений: код, недостижимый продуктом, выходит из
// популяции ПО ПРАВИЛУ, а не попадает в пин исключений — возврат `OWNER_COPY_PENDING`
// отменял бы решение, принятое на слове владельца ((1493)/(1495)).
await run('No.898/F12 — every login refusal code within the measured horizon has its own text',async()=>{
  // Якорь со стороны интерфейса: популяция имеет право начинаться с одной команды только
  // пока `loginRefusalText` питается именно ей. Если появится второй источник — покраснеет
  // здесь, а не тихо сузит популяцию.
  const refusalCalls=(html.match(/loginRefusalText\(/g)||[]).length;
  ok(refusalCalls===4,'No.898: loginRefusalText has its definition plus exactly three call sites — found '+refusalCalls);
  const nalStart=html.indexOf('async function nativeAccountLogin(');
  ok(nalStart>0,'control: nativeAccountLogin is present in dist');
  const nalBody=html.slice(nalStart,html.indexOf('\n}',nalStart));
  const nalCmds=[...new Set([...nalBody.matchAll(/invoke\('([a-z_]+)'/g)].map((m)=>m[1]))];
  ok(nalCmds.length===1&&nalCmds[0]==='native_account_login',
     'No.898: the refusal-text consumer is fed by exactly ONE command — '+JSON.stringify(nalCmds));

  // Срез по cfg: атрибут — тестовый гейт только если `test` ВЫЖИВАЕТ после удаления всех
  // not(...). Без этого шага тот же шаблон ловит и `#[cfg(not(test))]` и срезает
  // ПРОДУКТОВУЮ ветвь — так и было в первой версии, и это поймал положительный контроль.
  function cfgIsTestGate(inner){
    let bare=inner,g=0;
    for(;;){const n=bare.replace(/not\s*\([^()]*\)/g,'');if(n===bare||++g>50)break;bare=n;}
    return /\btest\b/.test(bare);
  }
  function productionHalf(s){
    let out=s,guard=0;
    for(;;){
      if(++guard>500)throw new Error('productionHalf did not converge');
      let hit=null;
      for(const cand of out.matchAll(/#\[cfg\(/g)){
        const open=cand.index+cand[0].length-1;
        const close=balancedEnd(out,open+1,'(',')','"');
        if(close<0)continue;
        if(!cfgIsTestGate(out.slice(open+1,close)))continue;
        const endAttr=out.indexOf(']',close);
        hit={index:cand.index,end:endAttr+1};
        break;
      }
      if(!hit)break;
      let i=hit.end;
      while(i<out.length&&/\s/.test(out[i]))i++;
      while(out[i]==='#'){const e=out.indexOf(']',i);i=e<0?out.length:e+1;while(i<out.length&&/\s/.test(out[i]))i++;}
      let end;
      if(out[i]==='{')end=balancedEnd(out,i+1,'{','}','"');
      else{const b=out.indexOf('{',i),sc=out.indexOf(';',i);
        if(b>=0&&(sc<0||b<sc))end=balancedEnd(out,b+1,'{','}','"');else end=sc<0?out.length:sc+1;}
      out=out.slice(0,hit.index)+out.slice(end);
    }
    return out;
  }
  // КОНТРОЛЬ среза, и это НЕ `body.length>500`: тот проходит ровно в том случае, ради
  // которого стоит, потому что при несработавшем срезе body — весь файл (решение (1702)).
  const cutFixture='fn keep(){\n#[cfg(test)]\n{ x.ok_or("FIXTURE_TEST_ONLY")?; }\n#[cfg(not(test))]\n{ return Err("FIXTURE_PRODUCTION"); }\n}\n'
    +'#[cfg(all(test, target_os = "linux"))]\nmod t { fn a(){ Err("FIXTURE_IN_MODULE") } }\nfn after(){ Err("FIXTURE_AFTER") }\n';
  const cut=productionHalf(cutFixture);
  ok(!cut.includes('FIXTURE_TEST_ONLY'),'control: the cut removes a #[cfg(test)] BLOCK inside a function');
  ok(cut.includes('FIXTURE_PRODUCTION'),'control: the cut KEEPS the #[cfg(not(test))] branch — the arm the first version destroyed');
  ok(!cut.includes('FIXTURE_IN_MODULE'),'control: the cut removes a module gated by the COMPOUND cfg(all(test, …)) form');
  ok(cut.includes('FIXTURE_AFTER'),'control: the cut keeps code after a stripped item');

  const prod=Object.fromEntries(Object.entries(rsSources).map(([f,s])=>[f,productionHalf(s)]));
  // Строки, которые сам код использует как `phase`, кодами отказа не являются. Словарь
  // ВЫВОДИТСЯ из дерева, не набирается рукой, и несёт контроль непустоты.
  const PHASES=new Set();
  for(const s of Object.values(rsSources)){
    for(const m of s.matchAll(/\bphase\s*[:,]\s*"([a-z_]+)"/g))PHASES.add(m[1]);
    for(const m of s.matchAll(/\.phase\s*,\s*"([a-z_]+)"/g))PHASES.add(m[1]);
    for(const m of s.matchAll(/failed\([^,)]*,\s*"([a-z_]+)"\)/g))PHASES.add(m[1]);
  }
  ok(PHASES.size>0,'control: the phase vocabulary is derived and non-empty — '+PHASES.size+' names');

  // В закрытой форме литерал в map_err обязан БЫТЬ результатом замыкания, а не аргументом
  // внутри него: `map_err(|_| failed(Error::X, "write"))` возвращает структуру.
  const CODE_RE=/(?:Err|ok_or)\s*\(?\s*"([a-z_]+)"|map_err\(\s*\|[^|]*\|\s*"([a-z_]+)"\s*(?:\.to_string\(\))?\s*\)/g;
  function initializer(b,at){let d=0;
    for(let i=at;i<b.length;i++){const c=b[i];
      if('{(['.includes(c))d++;else if('})]'.includes(c)){if(d===0)return b.slice(at,i);d--;}
      else if(c===','&&d===0)return b.slice(at,i);}
    return b.slice(at);}
  function codesIn(body){const o=new Set();
    for(const m of body.matchAll(CODE_RE))o.add(m[1]||m[2]);
    // No.898 3c: ЧЕТВЁРТАЯ форма рождения кода — плечо `match`, возвращающее голый литерал.
    // Прежние три формы её не видели, и это давало ЛОЖНОЕ ЗЕЛЁНОЕ: на fixture-дереве 157/0 и
    // `textless []` при Rust 3c и нетронутом dist, то есть два кода БЕЗ ТЕКСТА при зелёном
    // ассерте покрытия.
    // Образец обязан СОДЕРЖАТЬ строковый литерал, а не БЫТЬ им. Это измерено, а не выбрано:
    //   образец ЕСТЬ литерал      -> 2 значения, и НИ ОДНОГО из карты отказов;
    //   образец СОДЕРЖИТ литерал  -> 15, из них 12 кодов карты;
    //   любое плечо               -> 36, из них 24 вне карты (построитель фаз и режимов).
    // Двенадцать — это таблица статус->код `native_account.rs:434-453`, где образцы КОРТЕЖИ
    // (`(403, "tenant_mismatch")`). Прежний оракул не видел и их: `Err(match …)` под
    // CODE_RE не подходит, потому что за `Err(` идёт не кавычка. То есть узкая форма была бы
    // слепа к самому вероятному месту появления СЛЕДУЮЩЕГО кода.
    for(const m of body.matchAll(/(?:^|[\s(|])[^=\n]*"[a-z_]+"[^=\n]*=>\s*"([a-z_]+)"\s*,/g))o.add(m[1]);
    for(const m of body.matchAll(/\bcode\s*:\s*/g))
      for(const t of initializer(body,m.index+m[0].length).matchAll(/"([a-z_]+)"/g))o.add(t[1]);
    return o;}
  const FN=new Map();
  function isFn(n){if(FN.has(n))return FN.get(n);
    const re=new RegExp('fn\\s+'+n+'\\s*(?:<[^>]*>)?\\s*\\(');
    const v=Object.values(prod).some((s)=>re.test(s));FN.set(n,v);return v;}
  function bodyOf(n){
    for(const [f,s] of Object.entries(prod)){
      const m=s.match(new RegExp('fn\\s+'+n+'\\s*(?:<[^>]*>)?\\s*\\('));
      if(!m)continue;
      const b=s.indexOf('{',m.index+m[0].length);
      if(b<0)continue;
      const e=balancedEnd(s,b+1,'{','}','"');
      if(e<0)continue;
      return {file:f,body:s.slice(b,e)};
    }
    return null;}
  // No.898 3c: `account_session_state` (lib.rs:669) — производитель СОСТОЯНИЙ СЕССИИ, не кодов
  // отказа. Его значения (`active`, `locked`, `expired`, `legacy`, `none`, …) доходят до
  // интерфейса через `s.account_session` (dist:1319, 1686), а НЕ через `loginRefusalText`;
  // `settings.crewing.login.expired` в dist встречается ноль раз. Его плечи имеют ту же форму,
  // что таблица отказов, поэтому вычитать их надо ИМЕНЕМ ФУНКЦИИ, а не формой образца.
  // Словарь ВЫВОДИТСЯ из тела, как PHASES, и несёт те же два контроля — непустоту и
  // столкновение с картой: если в эту функцию однажды положат настоящий код отказа,
  // исключение не станет молчаливой дырой.
  const STATES=new Set();
  const SKIP=new Set(['if','match','while','for','return','Ok','Err','Some','None','String','Vec',
    'format','println','assert','assert_eq','clone','to_string','unwrap','expect','map','and_then',
    'map_err','ok_or','is_some','is_none','as_ref','as_str','trim','len','push','insert','lock','borrow_mut']);
  // Обход параметризован ГЛУБИНОЙ, и это не косметика. Предикат измеряет не «достижимость»
  // в смысле компилятора, а «в пределах N переходов по именам вызовов» — и граница N обязана
  // быть ЗАМЕРЕНА, а не выбрана так, чтобы получился желаемый ответ. Замер (свип 1..12):
  // популяция НАСЫЩАЕТСЯ на 16 кодах к глубине 5 и не меняется на 6, а на 7 впервые входит
  // код, чей потребитель к пути входа не относится вовсе (`no_mail_client` из `contact.rs`,
  // `connection_not_configured` из `messaging.rs`). Поэтому 6 — граница с запасом в один
  // уровень с каждой стороны, и ОБА её края закреплены ассертами ниже: иначе число 6
  // осталось бы магическим, то есть верным ответом по неверной причине.
  {
    const asb=bodyOf('account_session_state');
    if(asb)for(const m of asb.body.matchAll(/=>\s*"([a-z_]+)"/g))STATES.add(m[1]);
  }
  function populate(maxDepth){
    const seen=new Set(),codes=new Set();let reached=0;
    (function walk(n,depth){
      if(depth>maxDepth||seen.has(n))return;
      seen.add(n);
      const f=bodyOf(n);
      if(!f)return;
      reached++;
      for(const c of codesIn(f.body))codes.add(c);
      // Функция может быть ПЕРЕДАНА без скобок — `map_err(NativePersistError::from_storage)`
      // именно так и достаёт `settings_cleanup_unconfirmed`, а шаблон `name(` его не видит.
      for(const m of f.body.matchAll(/\b([a-z_][a-z0-9_]*)\b/g)){
        const k=m[1];
        if(SKIP.has(k)||seen.has(k))continue;
        if(isFn(k))walk(k,depth+1);
      }
    })('native_account_login',0);
    for(const c of [...codes])if(PHASES.has(c)||STATES.has(c))codes.delete(c);
    return {reached,codes};
  }
  const HORIZON=6;
  const below=populate(HORIZON-1), at=populate(HORIZON), above=populate(HORIZON+1);
  const reached=at.reached, codes=at.codes;
  ok(reached>50,'control: the walk is not trivially empty — functions reached='+reached);
  // Нижний край: на выбранной границе популяция НАСЫЩЕНА, то есть ещё один уровень вниз
  // ничего не теряет. Если появится новый код между 5 и 6 — горизонт мал, и это красное.
  const lostBelow=[...at.codes].filter((c)=>!below.codes.has(c)).sort();
  ok(lostBelow.length===0,'control: the population is SATURATED at the horizon — depth '+(HORIZON-1)+' already finds all of them, extra at '+HORIZON+': '+JSON.stringify(lostBelow));

  const mapBlock=(html.match(/function loginRefusalText\(code\) \{\n  var map = (\{[\s\S]*?\});/)||['',''])[1];
  const mapped=new Set([...mapBlock.matchAll(/"([a-z_]+)":\s*"([a-z_]+)"/g)].map((m)=>m[1]));
  ok(mapped.size>=20&&codes.size>=10,'control: both sides measured — reachable codes='+codes.size+' mapped='+mapped.size);
  // Защита от собственного сужения: имя из словаря фаз не имеет права быть известным кодом,
  // иначе сужение молча удалило бы настоящий отказ.
  const collide=[...PHASES].filter((p)=>mapped.has(p)).sort();
  ok(collide.length===0,'control: no derived phase name is also a known refusal code — '+JSON.stringify(collide));

  // Положительные контроли на ДВЕ формы, которые прежний предикат не видел.
  ok(codes.has('fresh_namespace_unavailable'),'No.898: a code assembled as a STRUCT FIELD enters the population (native_fresh.rs)');
  ok(codes.has('settings_cleanup_unconfirmed'),'No.898: a code in the SECOND ARM of a ternary enters the population (lib.rs:141)');
  ok(STATES.size>0,'control: the session-state vocabulary is derived and non-empty :: '+STATES.size+' names');
  const stateCollide=[...STATES].filter((v)=>mapped.has(v)).sort();
  ok(stateCollide.length===0,'control: no derived session state is also a known refusal code — '+JSON.stringify(stateCollide));
  ok(STATES.has('expired')&&!codes.has('expired'),
     'No.898/3c: the session-state producer is subtracted BY FUNCTION, not by arm shape — `expired` is a state, absent from dist as a login text key');
  ok(codes.has('workspace_unreachable')&&codes.has('workspace_unavailable'),
     'No.898/3c: a code born as a MATCH ARM enters the population (native_lifecycle.rs second_step_code)');
  for(const c of ['tenant_mismatch','ownership_conflict','entitlement_revoked','too_many_attempts','bad_email','scope_denied'])
    ok(codes.has(c),'No.898/3c: the status->code TABLE is now covered — '+c+' was invisible to the old oracle (Err(match …) escapes CODE_RE)');
  for(const p of ['base_create','base_sync','container_metadata','database_sync','keys_sync','context_metadata'])
    ok(!codes.has(p),'No.898/3c: the rule keeps the enum->label phase builder OUT (native_fresh.rs:55,64) — '+p);
  // Отрицательные: недостижимое выходит ПО ПРАВИЛУ, а не по списку исключений.
  ok(!codes.has('fresh_context_unavailable'),'No.898: a cfg(test)-only code stays OUT of the population by compiler semantics, not by exemption');
  for(const c of ['external_url_refused','external_url_unavailable','external_url_unsupported'])
    ok(!codes.has(c),'No.898: '+c+' stays OUT — its consumer discards the code and shows the address verbatim');
  for(const c of ['connection_change_requires_login','connection_change_requires_validation'])
    ok(!codes.has(c),'No.898: '+c+' stays OUT — zero occurrences in dist, born behind save_settings, not the login command');

  // Верхний край: на один уровень ВЫШЕ горизонта обход обязан втянуть код, которого в карте
  // нет — то есть выйти за путь входа. Это доказывает, что граница лежит именно там, где
  // названа, а не что при любом N ответ один и тот же.
  // РАСТЯЖКА, названная заранее: этот контроль покраснеет и если кто-нибудь ЗАКОННО даст
  // текст одному из кодов, которые сегодня втягиваются на 7 (`no_mail_client`,
  // `connection_not_configured`) — тогда на 7 не останется неотображённых кодов. Красное
  // тогда значит «горизонт надо ПЕРЕМЕРИТЬ свипом», а НЕ «текст пропал»: проверь свип
  // 1..12 и подними HORIZON до нового края насыщения.
  const admittedAbove=[...above.codes].filter((c)=>!at.codes.has(c)&&!mapped.has(c)).sort();
  ok(admittedAbove.length>0,
     'control: one level ABOVE the horizon the walk leaves the login path and admits unmapped codes — '+JSON.stringify(admittedAbove));
  const textless=[...codes].filter((c)=>!mapped.has(c)).sort();
  ok(textless.length===0,'No.898/F12: every login refusal code within the MEASURED horizon ('+HORIZON+' call-name hops, saturated at '+(HORIZON-1)+', contaminated at '+(HORIZON+1)+') has its own text — textless '+JSON.stringify(textless));

  // No.898 3c: различение ДВУХ ступеней живёт в карте, а не только в Rust-тесте. Пара обязана
  // остаться парой: слияние потеряло бы «проверьте сеть» (действие СЕЙЧАС) и «это на нашей
  // стороне» (действие ЖДАТЬ) — два разных действия по правилу дома.
  const pairs=Object.fromEntries([...mapBlock.matchAll(/"([a-z_]+)":\s*"([a-z_]+)"/g)].map((m)=>[m[1],m[2]]));
  for(const c of ['workspace_unreachable','workspace_unavailable'])
    ok(typeof pairs[c]==='string','No.898/3c: the second-step code '+c+' is mapped to a text');
  ok(pairs['workspace_unreachable']!==pairs['workspace_unavailable'],
     'No.898/3c: the two second-step codes map to DIFFERENT texts — collapsing them would merge two different actions');
  // Первый шаг и `refresh` по-прежнему выдают исходные коды, поэтому их тексты обязаны остаться.
  for(const c of ['transport_unreachable','upstream_unavailable'])
    ok(typeof pairs[c]==='string','No.898/3c: the first-step code '+c+' keeps its own text — refresh and step one still emit it');

  // И вторая сторона, сохранённая: каждое ЗНАЧЕНИЕ карты существует ключом словаря в обоих
  // языках, иначе карта указывает в пустоту. No.898 3a долг 3: нарезаемая таблица —
  // `SETTINGS_I18N`, популяция ассерта — ЗНАЧЕНИЯ карты `loginRefusalText`, не её ключи.
  const values=[...new Set([...mapBlock.matchAll(/"([a-z_]+)":\s*"([a-z_]+)"/g)].map((m)=>m[2]))];
  const dangling=values.filter((v)=>!(html.includes('"settings.crewing.login.'+v+'"')));
  ok(dangling.length===0,'No.898: every map target resolves to a real text key — dangling '+JSON.stringify(dangling));
  // No.898 под-стадия 2 (Н1): «в ОБОИХ словарях» измеряется НАРЕЗКОЙ, а не счётом. Прежнее
  // `>=2 вхождений` проходило и на двух вхождениях в ОДНОМ словаре — то есть не различало
  // того, ради чего стояло.
  const siAt=html.indexOf('var SETTINGS_I18N');
  const ruAt=html.indexOf('\n  ru: {',siAt);
  ok(siAt>0&&ruAt>siAt,'control: both dictionary regions are locatable — SETTINGS_I18N at '+siAt+', ru at '+ruAt);
  // No.898 3a, долг 1: собственный счётчик скобок заменён на `balancedEnd` ИЗ ЭТОГО ЖЕ ФАЙЛА —
  // он принимает символ кавычки и пропускает строковые литералы. Прежний IIFE был к кавычкам
  // слеп, и верно он вставал СЛУЧАЙНО: в области 479 строковых значений, 17 из них содержат
  // фигурные скобки (`{name}`, `{n}`), и все они сегодня сбалансированы. Дрейф несимметричен,
  // и это и есть причина правки: лишняя `}` в будущем тексте закроет область рано, поздние
  // ключи дадут inRu=0 — ГРОМКО; лишняя `{` продлит область за словарь, ключи по-прежнему
  // будут по одному, `length>1000` пройдёт — МОЛЧА с неверной областью. Писать свой счётчик
  // рядом с готовым хелпером, принимающим кавычку, было небрежностью.
  const siEnd=balancedEnd(html,html.indexOf('{',siAt)+1,'{','}','"');
  const enRegion=html.slice(siAt,ruAt), ruRegion=html.slice(ruAt,siEnd);
  ok(enRegion.length>1000&&ruRegion.length>1000,'control: both regions are substantial — en '+enRegion.length+' B, ru '+ruRegion.length+' B');
  // Контроль, что нарезка РАЗДЕЛИЛА ЯЗЫКИ, а не отрезала произвольно: английский текст
  // известного ключа обязан лежать в en-области и НЕ лежать в ru-области, и наоборот.
  // Без этого обе области могли бы оказаться половинами одного словаря.
  ok(/That does not look like an email/.test(enRegion)&&!/That does not look like an email/.test(ruRegion),
     'control: the en region holds the ENGLISH text of a known key and the ru region does not');
  ok(/Это не похоже/.test(ruRegion)&&!/Это не похоже/.test(enRegion),
     'control: the ru region holds the RUSSIAN text of a known key and the en region does not');
  // No.898 3d: the refusal line must be READABLE, not merely correct. Caught by the manager
  // reading the smoke frames: the text was the palest thing on the screen - declared 1.46:1
  // against a 4.5:1 AA floor, while the heading ran 15.32:1 and plain body text 5.37:1.
  // The colour was a HOUSE defect (inline attribute byte-identical to base f145c601), but a
  // fix without a guard is a fix that comes back, so the floor is pinned here.
  // The panel is translucent, so the background is COMPOSITED from the declared rgba over the
  // light --bg token; that model was validated against the real pixels of a captured frame
  // (predicted rgb(242,221,223) vs measured rgb(242,221,222), a rounding difference).
  {
    const el=(html.match(/id="ec-login-error"[^>]*/)||[''])[0];
    const fg=(el.match(/color:#([0-9a-fA-F]{6})/)||[])[1];
    const bgm=el.match(/background:rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
    // The LIGHT theme's --bg, and only it: the dark one is declared first on bare :root, so a
    // pattern that merely mentions data-theme="light" nearby captures the WRONG value. This
    // error happened and the discriminating control below is what exposed it, by scoring the
    // replaced colour at 9.06:1 instead of 1.46:1.
    // The SELECTOR `:root[data-theme="light"]`, not the bare attribute: `<html
    // data-theme="light">` sits at offset 32, long before the CSS, so anchoring on the
    // attribute captures the DARK --bg declared first on bare :root. Require the closing `]`.
    const page=(html.match(/data-theme="light"\][\s\S]{0,800}?--bg:\s*#([0-9a-fA-F]{6});/)||[])[1];
    ok(!!fg&&!!bgm&&!!page,'No.898/3d: the refusal box declares a colour, a translucent background and a light --bg :: fg='+fg+' bg='+(bgm&&bgm[0])+' page='+page);
    const hex=(h)=>[0,2,4].map((i)=>parseInt(h.slice(i,i+2),16));
    const lin=(v)=>{v/=255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
    const lum=(c)=>0.2126*lin(c[0])+0.7152*lin(c[1])+0.0722*lin(c[2]);
    const ratio=(a,b)=>{const la=lum(a),lb=lum(b),hi=Math.max(la,lb),lo=Math.min(la,lb);return (hi+0.05)/(lo+0.05);};
    const over=(c,bg,a)=>c.map((v,i)=>Math.round(a*v+(1-a)*bg[i]));
    // Guard against extracting the WRONG theme's background - the failure that actually
    // happened twice here. A light theme's page colour must be light; if this fires, the
    // contrast number below is about the wrong surface and means nothing.
    ok(lum(hex(page))>0.5,'control: the extracted light-theme --bg is actually light :: #'+page+' relative luminance '+lum(hex(page)).toFixed(3));
    const panel=over([+bgm[1],+bgm[2],+bgm[3]],hex(page),parseFloat(bgm[4]));
    const got=ratio(hex(fg),panel);
    ok(got>=4.5,'No.898/3d: the refusal line meets the WCAG AA floor for body text :: '+got.toFixed(2)+' : 1 on composited panel rgb('+panel+'), floor 4.5');
    // The predicate must DISCRIMINATE: the colour this replaced has to fail it, or the assert
    // would pass on anything and prove nothing.
    const wasRatio=ratio(hex('fca5a5'),panel);
    ok(wasRatio<3,'control: the predicate rejects the colour this replaced :: #fca5a5 scores '+wasRatio.toFixed(2)+' : 1, below even the 3:1 large-text floor');
  }

  for(const v of values){
    const key='"settings.crewing.login.'+v+'"';
    const inEn=enRegion.split(key).length-1, inRu=ruRegion.split(key).length-1;
    ok(inEn===1&&inRu===1,'No.898: the text '+v+' exists ONCE IN EACH dictionary — en='+inEn+' ru='+inRu);
  }
});

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
  // No.880 S2 п.2 (№793): производственная ветка Fresh перестала быть
  // отказ-заглушкой. Юнит-тест до неё не достаёт — она под `cfg(not(test))`, —
  // поэтому факт закрепляется по ИСХОДНИКУ, и это сказано прямо, а не выдано за
  // проверку поведения. Поведение общей ветки покрыто тестами Rust через
  // внедряемый источник пространств имён.
  {
    const commit=rsSources['native_local_commit.rs'];
    ok(!!commit&&commit.length>1000,'control: the commit module is among the parsed Rust sources');
    ok(/FreshNamespaces::allocate_application\(\)/.test(commit),
       'No.880/№793: the production fresh branch allocates a real native-owned context');
    ok(!/#\[cfg\(not\(test\)\)\][\s\S]{0,80}return Err\("fresh_context_unavailable"\)/.test(commit),
       'No.880/№793: the production fresh branch is no longer a refusal stub');
    // No.898 под-стадия 2: ассерт следует за КЛЮЧОМ, а не за одной буквальной парой. Прежняя
    // форма пинила `"fresh_namespace_unavailable": "fresh_unavailable"` и краснела бы ПО
    // ПОСТРОЕНИЮ при любой смене ключа — по верной причине в неподходящий момент.
    const mapFresh=(html.match(/function loginRefusalText\(code\) \{\n  var map = (\{[\s\S]*?\});/)||['',''])[1];
    const freshTarget=(mapFresh.match(/"fresh_namespace_unavailable":\s*"([a-z_]+)"/)||[])[1];
    ok(!!freshTarget,'No.898: the live allocator refusal code is mapped at all — target '+String(freshTarget));
    ok((html.match(new RegExp('"settings\\.crewing\\.login\\.'+freshTarget+'"','g'))||[]).length===2,
       'No.898: the allocator refusal key '+freshTarget+' has a text in both dictionaries');
    // ДВА ассерта на само УДАЛЕНИЕ: «новый ключ работает» не ловит «старый остался», и без них
    // следующий писатель вернёт мёртвую запись, не покраснев. Заметь, ЧТО они различают: эти
    // два — про КАРТУ и СЛОВАРИ, тогда как отрицательный контроль популяции выше — про то, что
    // код под `cfg(test)` вне ПОПУЛЯЦИИ по семантике компилятора. Разные объекты, и снятие
    // записи из карты второй контроль не задевает.
    ok(!/"fresh_context_unavailable"\s*:/.test(mapFresh),
       'No.898: the test-only code fresh_context_unavailable is ABSENT from the map — dead data; it is unreachable in a product build by cfg');
    ok(!/"settings\.crewing\.login\.fresh_unavailable"/.test(html),
       'No.898: the retired key fresh_unavailable is ABSENT from both dictionaries');
    // Контроль инструмента рядом с двумя нулями: тот же предикат обязан НАХОДИТЬ существующий
    // ключ, иначе нули выше — свойство сломанного поиска, а не отсутствия.
    ok((html.match(/"settings\.crewing\.login\.storage_error"/g)||[]).length===2,
       'control: the same predicate finds a key that DOES exist (storage_error), so the two absences above are measured');
  }

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

// No.894 (половина, достижимая в dist): подпись про демонстрацию принадлежит двери «Демо»,
// а не форме входа. До правки `<p>` с `entry.demo_note` лежал ПОСЛЕ обоих контейнеров —
// вне `ec-doors` и вне `ec-login-form`, — поэтому `entryShowLogin(true)` скрывал двери,
// показывал форму, а подпись оставалась под формой и читалась как её описание. Это
// воспроизведено в разметке, а не выведено из жалобы: индексы были doors 139119,
// form 140263, note 141758. Теперь подпись внутри `ec-doors` и скрывается вместе с ними.
// Ассерт ПОЗИЦИОННЫЙ и текста не касается: текст идёт владельцу на живую приёмку, и пин
// к буквальной строке дал бы ложный красный ровно в момент, когда он её поменяет.
await run('No.894 — the demonstration caption belongs to the Demo door, not to the login form',async()=>{
  const doors=html.indexOf('id="ec-doors"');
  const form=html.indexOf('id="ec-login-form"');
  const note=html.indexOf('id="ec-demo-note"');
  ok(doors>0&&form>doors,'control: both containers present and ordered — doors at '+doors+', form at '+form);
  ok(note>0,'No.894: the caption carries its own id so its PLACE can be asserted — ec-demo-note');
  ok(note>doors&&note<form,
     'No.894: the caption sits INSIDE the doors container and hides with the door it describes — note '+note+' between '+doors+' and '+form);
  // Контроль инструмента: тот же предикат на синтетической разметке, где подпись стоит
  // ПОСЛЕ формы (как было до правки), обязан быть ЛОЖНЫМ — иначе он согласен на любое
  // положение и не различает того, ради чего стоит.
  const synth='<div id="ec-doors"></div><div id="ec-login-form"></div><p id="ec-demo-note"></p>';
  const sD=synth.indexOf('id="ec-doors"'),sF=synth.indexOf('id="ec-login-form"'),sN=synth.indexOf('id="ec-demo-note"');
  ok(!(sN>sD&&sN<sF),'control: on markup with the caption AFTER the form the same predicate is FALSE, so it discriminates position');
  // И подпись по-прежнему рисуется из КЛЮЧА, а не из литерала — иначе перевод отвалится молча.
  ok(/tr\('entry\.demo_note'\)/.test(html),'No.894: the caption still renders from the key entry.demo_note, not from a literal');
});

console.log(JSON.stringify({passed,failed,setup_errors:setup,coverage:'actual shipped invoke/pubkey/stored-validation callers; synthetic native transport, no network/profile/DB; native persistence tested separately'}));
if(failed||setup)process.exitCode=1;
