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
const desktop=between('async function activateCompanyToken()','async function saveSettings()');
const mobileRead=between('function mobileReadConnection()','async function mobileSaveConnection(');
const mobileActions=between('async function mobileValidateConnection()','function mobileVacancyTitle(');
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
  };
}
const clone=v=>JSON.parse(JSON.stringify(v));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function runtime(transport) {
  const calls=[],changes=[],notices=[];
  const nodes=new Map(Object.entries({
    's-url':'https://synthetic.invalid','s-token':'','s-crewing-id':'company-635',
    's-company':'Synthetic owner company','s-reply':'owner@example.invalid',
    'm-server-url':'https://synthetic.invalid','m-token':'','m-crewing-id':'company-635',
    'm-company':'Synthetic owner company','m-reply':'owner@example.invalid',
    'a-email':'','a-password':'',
  }).map(([id,value])=>[id,{value}]));
  const ctx={document:{getElementById:(id)=>nodes.get(id)||null},
    showToast:(text,kind)=>notices.push([text,kind]),getUiLang:()=> 'ru',
    updateTeamNavVisibility(){},mobileShow(){},
state:{settings:publicFixture()},localStorage:{getItem(){return null;}},
    console:{log(){},warn(){},error(){}},pilotSettingsChanged(previous,next){changes.push([clone(previous),clone(next)]);}};
  ctx.window={__TAURI__:{core:{invoke:(command,args)=>{calls.push([command,args]);return transport(command,args);}}}};
  vm.createContext(ctx);vm.runInContext(wrapper+'\n'+pubkey+'\n'+trial+'\n'+desktop+'\n'+mobileRead+'\n'+mobileActions,ctx);
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
await run('actual stored activation caller stays public',async()=>{
  const {ctx,calls}=runtime(async(command)=>{
    if(command==='activate_crewing_token')return{crewing_id:'company-635',organization_id:'org-635',display_name:'Synthetic owner company',scopes:['applications:read'],expires_at:'2099-10-19T12:00:00Z'};
    if(command==='save_settings')return publicFixture();
    throw new Error('unexpected actual command '+command);
  });
  ctx.state.settings.bearer_token=secret;
  const result=await ctx.trialServerPhase(true);const activation=calls.find(row=>row[0]==='activate_crewing_token');
  ok(!!activation,'actual stored activation invoked');
  ok(activation&&activation[1].expectedContext==='ctx_fixture_a'&&!Object.hasOwn(activation[1],'bearerToken'),
    'background validation sends no saved credential');
  ok(result.phase==='free','existing connected owner activation succeeds');
});
await run('actual desktop/mobile stored Validate',async()=>{
  for(const action of ['activateCompanyToken','mobileValidateConnection']){
    const {ctx,calls,notices}=runtime(async(command)=>{
      if(command==='activate_crewing_token')return{crewing_id:'company-635',organization_id:'org-635',display_name:'Synthetic owner company',scopes:['applications:read'],expires_at:'2099-10-19T12:00:00Z'};
      if(command==='save_settings')return publicFixture();
      if(command==='register_my_pubkey')return{user_id:'synthetic-device',pubkey_b64:'synthetic-public-key'};
      throw new Error('unexpected command '+command);
    });
    ctx.state.settings.bearer_token=secret; // An old/injected field must never be used as saved credential.
    await ctx[action]();const activation=calls.find(row=>row[0]==='activate_crewing_token');
    ok(!!activation,action+' validates existing native connection with empty input');
    ok(activation&&activation[1].expectedContext==='ctx_fixture_a'&&!JSON.stringify(activation[1]).includes(secret),
      action+' sends original context without saved secret');
    ok(calls.some(row=>row[0]==='save_settings')&&!notices.some(row=>row[1]==='error'),action+' completes public save without an error');
    ok(ctx.state.settings.crewing_id==='company-635'&&!Object.hasOwn(ctx.state.settings,'bearer_token'),action+' retains public owner connection');
  }
});
await run('four late connection callbacks cannot borrow a newer account context',async()=>{
  for(const action of ['activateCompanyToken','startTrialAccess','mobileValidateConnection','mobileStartTrialAccess']){
    const pending=deferred(),b={...publicFixture(),connection_context:'ctx_fixture_b',crewing_id:'company-b',
      profile:{...publicFixture().profile,legal_name:'B owner profile'}};
    const {ctx,calls,nodes}=runtime(async(command)=>{
      if(command==='activate_crewing_token'||command==='issue_crewing_trial_token')return pending.promise;
      if(command==='save_settings')return clone(b);
      if(command==='register_my_pubkey')return{user_id:'synthetic-device',pubkey_b64:'synthetic-public-key'};
      throw new Error('unexpected command '+command);
    });
    nodes.get('s-token').value='SYNTHETIC_TYPED_A';nodes.get('m-token').value='SYNTHETIC_TYPED_A';
    const acting=ctx[action]();
    ok(calls.length===1,action+' dispatches its original activation before delay');
    ctx.state.settings=clone(b);nodes.get('s-crewing-id').value='company-b';nodes.get('m-crewing-id').value='company-b';
    pending.resolve({token:'SYNTHETIC_ISSUED_A',crewing_id:'company-635',organization_id:'org-635',
      display_name:'Synthetic owner company',scopes:['applications:read'],expires_at:'2099-10-19T12:00:00Z'});
    await acting;
    ok(!calls.some(row=>row[0]==='save_settings'),action+' late response issues no settings write');
    ok(JSON.stringify(ctx.state.settings)===JSON.stringify(b),action+' leaves newer owner profile/vault/context intact');
    ok(nodes.get('s-crewing-id').value==='company-b'&&nodes.get('m-crewing-id').value==='company-b',action+' late response does not repaint old company');
  }
});
await run('No.635 slice A — account login reachable from the interface',async()=>{
  // FAILING-FIRST for slice A. Anchored on the product seam the slice introduces, so today it
  // fails BY NAME ("real source seam absent") rather than vacuously. The behavioural assertions
  // below are deliberately unreachable until the seam exists; the reachable one is the red.
  let seam=null,seamError=null;
  // End anchor is the NEXT top-level declaration, as all six existing seams are: `between`
  // EXCLUDES its end marker, so ending on '\n}' sliced the function without its closing
  // brace and vm.runInNewContext threw SyntaxError. The red was real but the green was
  // unreachable — a failing-first test must be shown in BOTH states.
  try{ seam=between('async function nativeAccountLogin(','async function activateCompanyToken('); }
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
  ok(Object.prototype.hasOwnProperty.call(args,'expected_context'),'login carries the current connection context');
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
  try{ seam=between('async function nativeAccountLogin(','async function activateCompanyToken('); }catch(e){}
  if(seam===null){ ok(false,'seam absent'); return; }
  const {ctx,notices}=runtime(async()=>{ throw new Error('entitlement_expired'); });
  vm.runInNewContext(seam,ctx);
  ctx.document.getElementById('a-email').value='owner@example.invalid';
  ctx.document.getElementById('a-password').value='synthetic-only-password';
  await ctx.nativeAccountLogin().then(()=>null,()=>null);
  ok(notices.some(row=>row[0]==='settings.crewing.login.entitlement_expired'&&row[1]==='error'),
     'entitlement_expired shows its own text, not a generic one :: '+JSON.stringify(notices));
});

console.log(JSON.stringify({passed,failed,setup_errors:setup,coverage:'actual shipped invoke/pubkey/stored-validation callers; synthetic native transport, no network/profile/DB; native persistence tested separately'}));
if(failed||setup)process.exitCode=1;
