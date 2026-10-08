// Only Ufficio can manage agent access. Credentials remain in Supabase Auth.
const ROOT = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PUBLIC_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const origins = new Set(['https://provvigioni.planetwindows.it', 'https://planetwindows.github.io', 'http://127.0.0.1:4173', 'http://localhost:4173']);

function headers(req: Request) {
  return {'Content-Type':'application/json', 'Cache-Control':'no-store',
    'Access-Control-Allow-Origin':req.headers.get('Origin') || 'https://provvigioni.planetwindows.it',
    'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods':'POST, OPTIONS', 'Vary':'Origin'};
}
async function api(path: string, method='GET', body?: unknown, bearer=SERVICE_KEY, key=SERVICE_KEY) {
  const r = await fetch(ROOT+path, {method, headers:{'apikey':key, 'Authorization':'Bearer '+bearer,
    'Content-Type':'application/json', 'Prefer':'return=representation'}, body:body===undefined?undefined:JSON.stringify(body)});
  const txt = await r.text(); const value = txt ? JSON.parse(txt) : null;
  if (!r.ok) throw new Error(value?.msg || value?.message || value?.error_description || 'Operazione non riuscita');
  return value;
}
function randomPassword() {
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
  const bytes=crypto.getRandomValues(new Uint8Array(20));
  return 'Pw!'+Array.from(bytes, b=>chars[b%chars.length]).join('')+'7';
}
async function createAccount(username: string, name: string, role='agent', isTest=false, password=randomPassword()) {
  username=username.trim().toLowerCase(); name=name.trim();
  if (!/^[a-z0-9][a-z0-9._-]{2,59}$/.test(username) || !name || name.length>200 || password.length<12)
    throw new Error('Nome, nome utente o password non validi');
  const previous = await api('/rest/v1/provvigioni_accounts?select=id&username=eq.'+encodeURIComponent(username));
  if (previous.length) throw new Error('Nome utente già utilizzato');
  const result=await api('/auth/v1/admin/users','POST',{email:username+'@accounts.provvigioni.planetwindows.it',password,email_confirm:true,
    user_metadata:{full_name:name},app_metadata:{application:'pw_provvigioni'}});
  const user=result.user || result;
  try {
    // The pre-existing PW Posa signup trigger creates a profile. Remove only this
    // newly generated profile so commission accounts receive no PW Posa role.
    await api('/rest/v1/profiles?id=eq.'+user.id,'DELETE');
    const rows=await api('/rest/v1/provvigioni_accounts','POST',{
      user_id:user.id,username,display_name:name,role,active:true,is_test:isTest});
    return {account:rows[0],password};
  } catch(e) {
    await api('/auth/v1/admin/users/'+user.id,'DELETE').catch(()=>{});
    throw e;
  }
}

Deno.serve(async (req: Request) => {
  const h=headers(req);
  if(req.headers.get('Origin') && !origins.has(req.headers.get('Origin')!))
    return new Response(JSON.stringify({error:'Origine non autorizzata'}),{status:403,headers:h});
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers:h});
  if(req.method!=='POST') return new Response(JSON.stringify({error:'Metodo non consentito'}),{status:405,headers:h});
  try {
    const bearer=(req.headers.get('Authorization')||'').replace(/^Bearer /i,'');
    if(!bearer) return new Response(JSON.stringify({error:'Accedi come Ufficio'}),{status:401,headers:h});
    const me=await api('/auth/v1/user','GET',undefined,bearer,PUBLIC_KEY);
    // RLS validates the live account, JWT age and session, not client-supplied roles.
    const rows=await api('/rest/v1/provvigioni_accounts?select=id,role,active&user_id=eq.'+me.id,'GET',undefined,bearer,PUBLIC_KEY);
    if(rows.length!==1 || rows[0].role!=='office' || !rows[0].active)
      return new Response(JSON.stringify({error:'Operazione riservata a Ufficio'}),{status:403,headers:h});
    if(Number(req.headers.get('Content-Length')||0)>20000) throw new Error('Richiesta troppo grande');
    const text=await req.text(); if(text.length>20000) throw new Error('Richiesta troppo grande');
    const data=JSON.parse(text);
    let response;
    if(data.action==='create') {
      response=await createAccount(String(data.username||''),String(data.name||''),'agent',false);
    } else {
      if(!/^[0-9a-f-]{36}$/i.test(data.account_id||'')) throw new Error('Accesso non valido');
      const targets=await api('/rest/v1/provvigioni_accounts?select=*&id=eq.'+data.account_id);
      const target=targets[0]; if(!target || !target.user_id || !target.active) throw new Error('Accesso non disponibile');
      if(data.action==='reset') {
        const password=randomPassword();
        await api('/auth/v1/admin/users/'+target.user_id,'PUT',{password});
        const validAfter=Math.floor(Date.now()/1000)+1;
        await api('/rest/v1/provvigioni_accounts?id=eq.'+target.id,'PATCH',{valid_after:validAfter});
        await new Promise(resolve=>setTimeout(resolve,Math.max(0,validAfter*1000-Date.now()+50)));
        response={username:target.username,password};
      } else if(data.action==='delete') {
        if(target.role!=='agent') throw new Error('L’accesso principale Ufficio non può essere eliminato');
        // Block access immediately; keep the account label and any existing practices.
        await api('/rest/v1/provvigioni_accounts?id=eq.'+target.id,'PATCH',{active:false});
        await api('/auth/v1/admin/users/'+target.user_id,'DELETE');
        response={deleted:true};
      } else throw new Error('Operazione non valida');
    }
    return new Response(JSON.stringify(response),{headers:h});
  } catch(e) {
    return new Response(JSON.stringify({error:e instanceof Error?e.message:'Operazione non riuscita'}),{status:400,headers:h});
  }
});
