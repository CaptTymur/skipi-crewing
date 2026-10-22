// Synthetic response fixture only. Actual native persistence/authorization is tested in Rust.
export function crewingPublicSettingsFixture(source = {}) {
  const base = {
    server_url:'',has_bearer_token:false,connection_context:'ctx_presence',crewing_id:'',organization_id:'',
    company_name:'',user_display_name:'',token_scopes:[],token_expires_at:null,team_role:'',
    team_onboarding_seen:false,reply_to:'',vault_path:'',recent_vaults:[],
    profile:{legal_name:'',jurisdiction:'',registration_number:'',mlc_cert_number:'',mlc_cert_valid_to:'',
      contact_email:'',contact_phone:'',slug:'',public_description:''},
    interface:{theme:'light',language:'en'},
  };
  for (const key of Object.keys(base)) {
    if (Object.hasOwn(source,key) && source[key] !== undefined) base[key]=source[key];
  }
  base.profile={legal_name:'',jurisdiction:'',registration_number:'',mlc_cert_number:'',mlc_cert_valid_to:'',
    contact_email:'',contact_phone:'',slug:'',public_description:'',...(source.profile||{})};
  base.interface={theme:'light',language:'en',...(source.interface||{})};
  base.has_bearer_token=Object.hasOwn(source,'has_bearer_token')?!!source.has_bearer_token:!!source.bearer_token;
  return JSON.parse(JSON.stringify(base));
}
