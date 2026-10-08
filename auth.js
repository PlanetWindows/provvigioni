'use strict';
// Publishable key only. Access is enforced by the database's account policies.
const Auth = (() => {
  const URL='https://vbpinzygwexuvwomnmbt.supabase.co';
  const KEY='sb_publishable_1WuHCWsnDwZ6AqNBBBa5gA_Djh9OV_N';
  const STORE='pw_provvigioni_auth_v2';
  let session=null, remember=false, refreshing=null;
  try {const raw=sessionStorage.getItem(STORE)||localStorage.getItem(STORE);
    if(raw){const saved=JSON.parse(raw);session=saved.session;remember=saved.remember===true;}}
  catch{session=null;}
  function save(){sessionStorage.removeItem(STORE);localStorage.removeItem(STORE);
    if(session)(remember?localStorage:sessionStorage).setItem(STORE,JSON.stringify({session,remember}));}
  function clear(){session=null;save();}
  async function raw(path,options={},token){
    const r=await fetch(URL+path,{...options,headers:{apikey:KEY,'Content-Type':'application/json',
      ...(token?{Authorization:'Bearer '+token}:{}),...(options.headers||{})},cache:'no-store'});
    const txt=await r.text();let data=null;
    if(txt){try{data=JSON.parse(txt)}catch{throw new Error('Risposta del servizio non valida. Riprova.');}}
    if(!r.ok){const error=new Error(data?.error_description||data?.message||data?.error||'Operazione non riuscita');
      error.status=r.status;error.code=data?.code||data?.error_code;throw error;}
    return data;
  }
  async function refresh(){
    if(refreshing)return refreshing;
    if(!session?.refresh_token)throw new Error('Accedi per continuare.');
    refreshing=(async()=>{try{
      const next=await raw('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:session.refresh_token})});
      session=next;save();return session;
    }catch(e){if(e.status===400||e.status===401){clear();window.dispatchEvent(new Event('pw-session-ended'));}throw e;}
    finally{refreshing=null;}})();return refreshing;
  }
  async function request(path,options={}){
    if(!session)throw new Error('Accedi per continuare.');
    if(!session.expires_at||session.expires_at*1000<Date.now()+60000)await refresh();
    try{return await raw(path,options,session.access_token);}
    catch(e){if(e.status!==401)throw e;await refresh();return raw(path,options,session.access_token);}
  }
  return {
    get session(){return session;},
    async signIn(username,password,keep){
      username=username.trim().toLowerCase();
      if(!/^[a-z0-9][a-z0-9._-]{2,59}$/.test(username))throw new Error('Nome utente o password errati.');
      try{const next=await raw('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({
        email:username+'@accounts.provvigioni.planetwindows.it',password})});
        remember=keep;session=next;save();return session;
      }catch(e){if(e.status===400||e.status===422)throw new Error('Nome utente o password errati.');
        if(e.status===429)throw new Error('Troppi tentativi. Attendi qualche minuto e riprova.');throw e;}
    },
    request,
    db:(path,options={})=>request('/rest/v1/'+path,{...options,headers:{Prefer:'return=representation',...(options.headers||{})}}),
    admin:data=>request('/functions/v1/provvigioni-admin',{method:'POST',body:JSON.stringify(data)}),
    async changePassword(password){await request('/auth/v1/user',{method:'PUT',body:JSON.stringify({password})});},
    async logout(){try{if(session)await raw('/auth/v1/logout?scope=local',{method:'POST'},session.access_token);}finally{clear();}},
    clear
  };
})();
