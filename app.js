const DEFAULT_RULES={discounts:[0,.10,.20,.30,.40],A:[.44,.35,.25,.16,.08],B:[.28,.22,.15,.10,.04],extraHold:.11};
const STORE='pw_provvigioni_v1', RULE_STORE='pw_provvigioni_rules_v1';
let practices=[], rules=structuredClone(DEFAULT_RULES), editingId=null;
function load(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):JSON.parse(JSON.stringify(d))}catch(e){return JSON.parse(JSON.stringify(d))}}
const euro=n=>new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(Number(n)||0); const pct=n=>Number.isFinite(n)?new Intl.NumberFormat('it-IT',{style:'percent',minimumFractionDigits:0,maximumFractionDigits:2}).format(n):'—';
function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function calculate(p){
  const close=Number(p.close), services=p.services===''||p.services==null?0:Number(p.services);
  const legacyList=p.list===''||p.list==null?null:Number(p.list);
  let discount=p.discount===''||p.discount==null?null:Number(p.discount)/100;
  if(!p.id||!p.client||!p.agent||!['A','B'].includes(p.option)||!['Aperta','Chiusa','Annullata'].includes(p.status)||!Number.isFinite(close)||close<0||!Number.isFinite(services)||services<0||services>close){return {outcome:'Dati mancanti o non validi',kind:'bad'};}
  const final=+(close-services).toFixed(2);
  // Compatibilità con pratiche salvate con la vecchia versione: ricava lo sconto dal vecchio listino se necessario.
  if(discount===null && Number.isFinite(legacyList) && legacyList>0) discount=Math.max(0,1-final/legacyList);
  if(discount===null||!Number.isFinite(discount)||discount<0||discount>1){return {final,outcome:'Inserisci lo sconto applicato',kind:'warn',commission:null};}
  if(p.status==='Annullata') return {final,discount,outcome:'Annullata',kind:'neutral',commission:0};
  const idx=rules.discounts.findIndex(d=>Math.abs(d-discount)<1e-8);
  if(idx<0){return {final,discount,outcome:'Sconto non presente in tabella',kind:'warn',commission:null};}
  const rate=rules[p.option][idx];
  const commission=+(final*rate).toFixed(2);
  return {final,discount,rate,commission,outcome:'Automatico da tabella',kind:'ok'};
}
function fillCalc(){const p=getForm(),c=calculate(p);cFinal.textContent=c.final!=null?euro(c.final):'—';cDelta.textContent=c.discount!=null?pct(c.discount):'—';cRate.textContent=c.rate!=null?pct(c.rate):'—';cCommission.textContent=c.commission!=null?euro(c.commission):'—';cOutcome.innerHTML=`<span class="status ${c.kind||'neutral'}">${esc(c.outcome||'Da compilare')}</span>`}
['fId','fClient','fAgent','fOption','fStatus','fClose','fServices','fDiscount','fNotes'].forEach(id=>document.getElementById(id).addEventListener('input',fillCalc));
resetFormBtn.onclick=resetForm;
window.editPractice=editPractice;window.deletePractice=deletePractice;
function renderPractices(){const q=search.value.trim().toLowerCase(),fa=filterAgent.value,fs=filterStatus.value,fo=filterOption.value;const list=practices.filter(p=>(!q||[p.id,p.client,p.agent].some(v=>String(v).toLowerCase().includes(q)))&&(!fa||p.agent===fa)&&(!fs||p.status===fs)&&(!fo||p.option===fo));practiceCount.textContent=`${list.length} ${list.length===1?'pratica':'pratiche'}`;practiceBody.innerHTML=list.length?list.map(p=>{const c=calculate(p);return `<tr><td><b>${esc(p.id)}</b></td><td>${esc(p.client)}</td><td>${esc(p.agent)}</td><td>${esc(p.option)}</td><td>${esc(p.status)}</td><td class="money">${euro(p.close)}</td><td class="money">${euro(p.services||0)}</td><td class="money"><b>${c.final!=null?euro(c.final):'—'}</b></td><td>${c.discount!=null?pct(c.discount):'—'}</td><td>${c.rate!=null?pct(c.rate):'—'}</td><td class="money"><b>${c.commission!=null?euro(c.commission):'—'}</b></td><td><span class="status ${c.kind||'neutral'}">${esc(c.outcome)}</span></td><td><button class="btn small" onclick="editPractice('${p._uid}')">Modifica</button> <button class="btn small danger" onclick="deletePractice('${p._uid}')">Elimina</button></td></tr>`}).join(''):`<tr><td colspan="13" class="empty">Nessuna pratica inserita.</td></tr>`;}
function renderSummary(){const map=Object.create(null);let closedTotal=0,openTotal=0,closedCount=0,undef=0;practices.forEach(p=>{const c=calculate(p);if(!map[p.agent])map[p.agent]={open:0,closed:0,sales:0,A:0,B:0,openComm:0,undef:0};const a=map[p.agent];if(p.status==='Annullata')return;if(c.commission==null){a.undef++;undef++;}if(p.status==='Chiusa'){a.closed++;closedCount++;a.sales+=c.final||0;if(c.commission!=null){a[p.option]+=c.commission;closedTotal+=c.commission}}else if(p.status==='Aperta'){a.open++;if(c.commission!=null){a.openComm+=c.commission;openTotal+=c.commission}}});kpiClosed.textContent=euro(closedTotal);kpiOpen.textContent=euro(openTotal);kpiClosedCount.textContent=closedCount;kpiUndefined.textContent=undef;const names=Object.keys(map).filter(Boolean).sort((a,b)=>a.localeCompare(b,'it'));summaryBody.innerHTML=names.length?names.map(n=>{const a=map[n];return `<tr><td><b>${esc(n)}</b></td><td>${a.open}</td><td>${a.closed}</td><td class="money">${euro(a.sales)}</td><td class="money">${euro(a.A)}</td><td class="money">${euro(a.B)}</td><td class="money"><b>${euro(a.A+a.B)}</b></td><td class="money">${euro(a.openComm)}</td><td>${a.undef?`<span class="status warn">${a.undef}</span>`:'0'}</td></tr>`}).join(''):`<tr><td colspan="9" class="empty">Aggiungi la prima pratica per vedere il riepilogo.</td></tr>`}
function renderDiscountOptions(){const current=fDiscount.value;fDiscount.innerHTML='<option value="">Seleziona sconto</option>'+rules.discounts.map(d=>`<option value="${(d*100).toFixed(8).replace(/0+$/,'').replace(/\.$/,'')}">${pct(d)}</option>`).join('');if([...fDiscount.options].some(o=>o.value===current))fDiscount.value=current;}
function renderAll(){renderAgents();renderPractices();renderSummary();renderRules();}
[search,filterAgent,filterStatus,filterOption].forEach(el=>el.addEventListener('input',renderPractices));
document.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.nav button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.id===b.dataset.tab));});
// Accounts and online data are read after authentication, through RLS.
let account=null, accounts=[], rulesVersion=1, busy=false, dirty=false, rulesDirty=false;
const MIGRATED='pw_provvigioni_migrated_v2';
const $=id=>document.getElementById(id);
const isOffice=()=>account?.role==='office';
const uidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function message(text,bad=false){$('globalNotice').textContent=text;$('globalNotice').className='notice '+(bad?'bad':'ok');$('globalNotice').hidden=!text;}
function niceError(e){
  if(e.code==='23505')return 'Esiste già una pratica con questo codice.';
  if(e.code==='42501')return 'Questa operazione non è consentita per il tuo accesso.';
  if(e.code==='22023')return e.message;
  if(e instanceof TypeError)return 'Connessione non disponibile. I dati inseriti restano nel modulo: riprova il salvataggio.';
  if(e.status===401)return 'Accesso scaduto. Accedi di nuovo.';
  return e.message||'Operazione non riuscita. Riprova.';
}
function getForm(){
  const selected=accounts.find(a=>a.id===fAgent.value);
  const legacy=fAgent.value.startsWith('legacy:')?fAgent.value.slice(7):'';
  return {id:fId.value.trim(),client:fClient.value.trim(),agent:selected?.display_name||legacy,
    agent_id:selected?.id||null,option:fOption.value,status:fStatus.value,close:fClose.value,
    services:fServices.value,discount:fDiscount.value,notes:fNotes.value.trim()};
}
function resetForm(){
  editingId=null;dirty=false;formTitle.textContent='Nuova pratica';saveBtn.textContent='Salva pratica';
  ['fId','fClient','fClose','fServices','fNotes'].forEach(id=>$(id).value='');
  fAgent.value=isOffice()?'':account?.id||'';fOption.value='A';fStatus.value='Aperta';
  renderDiscountOptions();fDiscount.value='';fillCalc();
}
function renderAgents(){
  const old=fAgent.value;
  const options=accounts.filter(a=>a.role==='agent'&&(a.active||practices.some(p=>p.agent_id===a.id)));
  const known=new Set(options.map(a=>a.display_name));
  const legacy=[...new Set(practices.filter(p=>!p.agent_id&&!known.has(p.agent)).map(p=>p.agent))];
  fAgent.innerHTML='<option value="">Seleziona agente</option>'+options.map(a=>`<option value="${a.id}">${esc(a.display_name)}${!a.active?' (accesso eliminato)':''}</option>`).join('')+
    (isOffice()?legacy.map(n=>`<option value="${esc('legacy:'+n)}">${esc(n)} (da associare)</option>`).join(''):'');
  fAgent.disabled=!isOffice();
  fAgent.value=isOffice()?([...fAgent.options].some(o=>o.value===old)?old:''):account?.id||'';
  const names=[...new Set([...options.map(a=>a.display_name),...practices.map(p=>p.agent)].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'it'));
  const previous=filterAgent.value;
  filterAgent.innerHTML='<option value="">'+(isOffice()?'Tutti gli agenti':'Le mie pratiche')+'</option>'+names.map(n=>`<option>${esc(n)}</option>`).join('');
  filterAgent.value=names.includes(previous)?previous:'';
}
function renderRules(){
  rulesBody.innerHTML=rules.discounts.map((d,i)=>`<tr><td><b>${pct(d)}</b></td><td><input data-r="A" data-i="${i}" type="number" step="0.01" min="0" max="100" value="${(rules.A[i]*100).toFixed(2).replace(/\.00$/,'')}" ${isOffice()?'':'disabled'}> %</td><td><input data-r="B" data-i="${i}" type="number" step="0.01" min="0" max="100" value="${(rules.B[i]*100).toFixed(2).replace(/\.00$/,'')}" ${isOffice()?'':'disabled'}> %</td></tr>`).join('');
  saveRulesBtn.hidden=!isOffice();renderDiscountOptions();
}
async function allPractices(){
  let list=[],offset=0;
  for(;;){const part=await Auth.db('provvigioni_practices?select=*&order=updated_at.desc,uid.asc&limit=1000&offset='+offset);
    list.push(...part);if(part.length<1000)break;offset+=part.length;}
  return list;
}
async function loadOnline(){
  const [users,rows,settings]=await Promise.all([
    Auth.db('provvigioni_accounts?select=*&order=created_at.asc'),allPractices(),Auth.db('provvigioni_rules?select=*&id=eq.1')]);
  const me=users.find(a=>a.user_id===Auth.session?.user?.id&&a.active);
  if(!me||!settings.length){Auth.clear();endSession();throw new Error('Accesso non disponibile. Accedi di nuovo.');}
  account=me;accounts=users;
  practices=rows.map(r=>({...r.payload,_uid:r.uid,agent_id:r.agent_id,_version:r.version}));
  rules=settings[0].document;rulesVersion=settings[0].version;
  renderAll();renderAccounts();
  $('accountLabel').textContent=me.display_name+(isOffice()?' · Principale':me.is_test?' · Agente di prova':' · Agente');
  $('accountsNav').hidden=!isOffice();$('accountControls').hidden=false;
  saveState.textContent='Dati online aggiornati · '+new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
  const legacy=load(STORE,[]), oldRules=load(RULE_STORE,null);
  const needed=isOffice()&&!localStorage.getItem(MIGRATED)&&((Array.isArray(legacy)&&legacy.length)||oldRules);
  $('legacyBanner').hidden=!needed;
  if(needed)$('legacyText').textContent=Array.isArray(legacy)&&legacy.length?
    `Su questo dispositivo ci sono ${legacy.length} pratiche della versione precedente. Puoi recuperarle nel programma online.`:
    'Su questo dispositivo è presente la tabella provvigioni della versione precedente. Puoi recuperarla nel programma online.';
}
function endSession(){
  account=null;accounts=[];practices=[];rules=structuredClone(DEFAULT_RULES);editingId=null;dirty=false;rulesDirty=false;
  $('appRoot').hidden=true;$('loginPanel').hidden=false;$('accountControls').hidden=true;
  $('loginPassword').value='';saveState.textContent='Accesso riservato';
  $('globalNotice').hidden=true;search.value='';filterStatus.value='';filterOption.value='';
  document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab==='dashboard'));
  document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.id==='dashboard'));
  renderAll();renderAccounts();
  for(const dialog of document.querySelectorAll('dialog'))if(dialog.open)dialog.close();
}
async function startSession(){
  $('loginError').textContent='';
  try{await loadOnline();$('loginPanel').hidden=true;$('appRoot').hidden=false;resetForm();}
  catch(e){endSession();$('loginError').textContent=niceError(e);throw e;}
}
$('loginForm').onsubmit=async e=>{
  e.preventDefault();$('loginButton').disabled=true;$('loginError').textContent='';
  try{await Auth.signIn($('loginUsername').value,$('loginPassword').value,$('rememberAccess').checked);await startSession();$('loginPassword').value='';}
  catch(error){$('loginError').textContent=niceError(error);}
  finally{$('loginButton').disabled=false;}
};
$('showPassword').onclick=()=>{const input=$('loginPassword');input.type=input.type==='password'?'text':'password';$('showPassword').textContent=input.type==='password'?'Mostra':'Nascondi';};
$('logoutButton').onclick=async()=>{if((dirty||rulesDirty)&&!confirm('Ci sono modifiche non salvate. Vuoi uscire?'))return;
  try{await Auth.logout();}catch{}finally{endSession();}};
window.addEventListener('pw-session-ended',endSession);
window.addEventListener('beforeunload',e=>{if(dirty||rulesDirty){e.preventDefault();e.returnValue='';}});
document.querySelectorAll('#formBox input,#formBox select,#formBox textarea').forEach(el=>el.addEventListener('input',()=>dirty=true));
rulesBody.addEventListener('input',()=>rulesDirty=true);
resetFormBtn.onclick=resetForm;

async function writePractice(p,previous){
  const payload={...p};delete payload.agent_id;delete payload._version;
  const body={uid:p._uid,code:p.id,agent_id:p.agent_id||null,payload};
  const result=previous?await Auth.db(`provvigioni_practices?uid=eq.${p._uid}&version=eq.${previous._version}`,{method:'PATCH',body:JSON.stringify(body)}):
    await Auth.db('provvigioni_practices',{method:'POST',body:JSON.stringify(body)});
  if(!result.length)throw new Error('La pratica è stata aggiornata da un altro dispositivo. Aggiorna la pagina e riapri la pratica prima di salvarla.');
  return result[0];
}
saveBtn.onclick=async()=>{
  if(busy)return;
  const p=getForm(),c=calculate(p);
  if(!p.id||!p.client||!p.agent||p.close===''||p.discount===''){alert('Compila pratica, cliente, agente, chiusura e sconto applicato.');return;}
  if(c.kind==='bad'){alert(c.outcome);return;}
  if(practices.some(x=>x.id.toLowerCase()===p.id.toLowerCase()&&x._uid!==editingId)){alert('Esiste già una pratica con questo codice.');return;}
  const previous=practices.find(x=>x._uid===editingId);
  p._uid=editingId||crypto.randomUUID();p.created=previous?.created||Date.now();p.updated=Date.now();
  busy=true;saveBtn.disabled=true;
  try{await writePractice(p,previous);dirty=false;await loadOnline();resetForm();document.querySelector('[data-tab="dashboard"]').click();message('Pratica salvata online.');}
  catch(e){message(niceError(e),true);}finally{busy=false;saveBtn.disabled=false;}
};
function editPractice(uid){
  const p=practices.find(x=>x._uid===uid);if(!p)return;
  editingId=uid;dirty=false;formTitle.textContent='Modifica pratica';saveBtn.textContent='Salva modifiche';
  fId.value=p.id;fClient.value=p.client;fAgent.value=p.agent_id||'legacy:'+p.agent;fOption.value=p.option;fStatus.value=p.status;
  fClose.value=p.close;fServices.value=p.services??'';fNotes.value=p.notes??'';renderDiscountOptions();
  let d=p.discount;if((d===''||d==null)&&p.list){const oldFinal=Math.max(0,Number(p.close||0)-Number(p.services||0));d=(Math.max(0,1-oldFinal/Number(p.list))*100).toFixed(8).replace(/0+$/,'').replace(/\.$/,'');}
  if(d!==''&&d!=null)fDiscount.value=String(d);fillCalc();document.querySelector('[data-tab="pratiche"]').click();window.scrollTo({top:0,behavior:'smooth'});
}
async function deletePractice(uid){
  const p=practices.find(x=>x._uid===uid);if(!p||busy||!confirm(`Eliminare la pratica ${p.id}?`))return;
  busy=true;try{const rows=await Auth.db(`provvigioni_practices?uid=eq.${uid}&version=eq.${p._version}`,{method:'DELETE'});
    if(!rows.length)throw new Error('La pratica è cambiata su un altro dispositivo. Aggiorna la pagina e riprova.');
    if(editingId===uid)resetForm();await loadOnline();message('Pratica eliminata.');
  }catch(e){message(niceError(e),true);}finally{busy=false;}
}
window.editPractice=editPractice;window.deletePractice=deletePractice;
async function writeRules(next){
  const result=await Auth.db('provvigioni_rules?id=eq.1&version=eq.'+rulesVersion,{method:'PATCH',body:JSON.stringify({document:next})});
  if(!result.length)throw new Error('La tabella è stata aggiornata da un altro dispositivo. Aggiorna la pagina e riprova.');
  rules=next;rulesVersion=result[0].version;
}
saveRulesBtn.onclick=async()=>{
  if(!isOffice()||busy)return;const next=structuredClone(rules);
  for(const inp of document.querySelectorAll('#rulesBody input')){
    const value=Number(inp.value);if(inp.value===''||!Number.isFinite(value)||value<0||value>100){alert('Inserisci percentuali comprese tra 0 e 100.');return;}
    next[inp.dataset.r][Number(inp.dataset.i)]=value/100;
  }
  busy=true;saveRulesBtn.disabled=true;
  try{await writeRules(next);rulesDirty=false;renderAll();fillCalc();message('Regole provvigioni salvate.');}
  catch(e){message(niceError(e),true);}finally{busy=false;saveRulesBtn.disabled=false;}
};
backupBtn.onclick=()=>{
  const payload={app:'Planet Windows Gestione Provvigioni',version:2,exported:new Date().toISOString(),practices,rules};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download='backup_provvigioni_planet_'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};
function normalizedName(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,'').split(/\s+/).filter(Boolean).sort().join(' ');}
async function importPractices(source,oldRules){
  if(!Array.isArray(source))throw new Error('Backup non valido.');
  // Validate the whole backup before writing anything. Existing online records are kept.
  const items=source.map(x=>{
    const p={...x};const target=accounts.find(a=>a.role==='agent'&&a.active&&(a.id===p.agent_id||normalizedName(a.display_name)===normalizedName(p.agent)));
    if(!isOffice()&&(!target||target.id!==account.id))throw new Error('Puoi importare soltanto pratiche intestate a te.');
    p.agent_id=target?.id||null;p.agent=target?.display_name||String(p.agent||'').trim();
    p.id=String(p.id||'').trim();p.client=String(p.client||'').trim();
    if((p.discount===''||p.discount==null)&&Number(p.list)>0)p.discount=Math.max(0,1-Math.max(0,Number(p.close)-Number(p.services||0))/Number(p.list))*100;
    const c=calculate(p);if(c.kind==='bad'||!p.id||!p.client||!p.agent)throw new Error('Il backup contiene una pratica non valida: '+(p.id||'senza codice'));
    return p;
  });
  const ids=new Set();for(const p of items){const key=p.id.toLowerCase();if(ids.has(key))throw new Error('Codice pratica duplicato nel backup: '+p.id);ids.add(key);}
  for(const p of items){const previous=practices.find(x=>x.id.toLowerCase()===p.id.toLowerCase());
    p._uid=previous?previous._uid:uidPattern.test(p._uid||'')?p._uid:crypto.randomUUID();
    p.created=previous?.created||p.created||Date.now();p.updated=Date.now();await writePractice(p,previous);
  }
  if(isOffice()&&oldRules)await writeRules(oldRules);
  await loadOnline();resetForm();
}
restoreInput.onchange=async e=>{
  const file=e.target.files[0];if(!file||busy)return;
  try{const obj=JSON.parse(await file.text());if(!Array.isArray(obj.practices))throw new Error('Backup non valido.');
    if(!confirm(`Importare ${obj.practices.length} pratiche? I codici già presenti verranno aggiornati; le altre pratiche online resteranno disponibili.`))return;
    busy=true;await importPractices(obj.practices,isOffice()?obj.rules:null);message('Backup importato.');
  }catch(error){message(niceError(error),true);}finally{busy=false;e.target.value='';}
};
$('migrateButton').onclick=async()=>{
  if(!isOffice()||busy)return;
  const old=load(STORE,[]),oldRules=load(RULE_STORE,null);
  if(!confirm('Recuperare le pratiche e le regole salvate su questo dispositivo? I dati sul dispositivo saranno conservati.'))return;
  busy=true;$('migrateButton').disabled=true;
  try{await importPractices(Array.isArray(old)?old:[],oldRules);localStorage.setItem(MIGRATED,'1');$('legacyBanner').hidden=true;message('Dati recuperati e salvati online.');}
  catch(e){message(niceError(e),true);}finally{busy=false;$('migrateButton').disabled=false;}
};

function renderAccounts(){
  $('accountsBody').innerHTML=accounts.filter(a=>a.active).map(a=>`<tr><td><b>${esc(a.display_name)}</b>${a.is_test?' <span class="status warn">Prova</span>':''}</td><td>${esc(a.username)}</td><td>${a.role==='office'?'Ufficio principale':'Agente'}</td><td>${a.role==='agent'?`<button class="btn small" data-account="${a.id}" data-action="reset">Nuova password</button> <button class="btn small danger" data-account="${a.id}" data-action="delete">Elimina accesso</button>`:'Tutti i permessi'}</td></tr>`).join('');
}
function showCredentials(username,password){$('credentialsUsername').textContent=username;$('credentialsPassword').textContent=password;$('credentialsDialog').showModal();}
$('accountsBody').onclick=async e=>{
  const button=e.target.closest('button[data-account]');if(!button||!isOffice()||busy)return;
  const target=accounts.find(a=>a.id===button.dataset.account);if(!target)return;
  const action=button.dataset.action;
  if(!confirm(action==='delete'?`Eliminare l’accesso di ${target.display_name}? Le sue pratiche rimarranno visibili a Ufficio.`:`Generare una nuova password per ${target.display_name}? I suoi accessi attuali verranno chiusi.`))return;
  busy=true;button.disabled=true;
  try{const result=await Auth.admin({action,account_id:target.id});await loadOnline();
    if(action==='reset')showCredentials(result.username,result.password);else message('Accesso eliminato.');
  }catch(error){message(niceError(error),true);}finally{busy=false;button.disabled=false;}
};
$('createAccountForm').onsubmit=async e=>{
  e.preventDefault();if(!isOffice()||busy)return;busy=true;$('createAccountButton').disabled=true;
  try{const result=await Auth.admin({action:'create',name:$('newAccountName').value.trim(),username:$('newAccountUsername').value.trim()});
    await loadOnline();$('createAccountForm').reset();delete $('newAccountUsername').dataset.edited;showCredentials(result.account.username,result.password);
  }catch(error){message(niceError(error),true);}finally{busy=false;$('createAccountButton').disabled=false;}
};
$('newAccountName').oninput=()=>{if(!$('newAccountUsername').dataset.edited)$('newAccountUsername').value=$('newAccountName').value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,'.');};
$('newAccountUsername').oninput=()=>{$('newAccountUsername').dataset.edited='1';};
$('closeCredentials').onclick=()=>{$('credentialsDialog').close();$('credentialsPassword').textContent='';};
$('copyCredentials').onclick=async()=>{try{await navigator.clipboard.writeText('Nome utente: '+$('credentialsUsername').textContent+'\nPassword: '+$('credentialsPassword').textContent);$('copyCredentials').textContent='Copiato';setTimeout(()=>$('copyCredentials').textContent='Copia accesso',2000);}catch{message('Seleziona e copia il nome utente e la password.');}};
$('changePasswordButton').onclick=()=>{$('passwordForm').reset();$('passwordError').textContent='';$('passwordDialog').showModal();};
$('cancelPassword').onclick=()=>$('passwordDialog').close();
$('passwordForm').onsubmit=async e=>{
  e.preventDefault();const password=$('newPassword').value;
  if(password.length<12){$('passwordError').textContent='Usa una password di almeno 12 caratteri.';return;}
  if(password!==$('confirmPassword').value){$('passwordError').textContent='Le due password non coincidono.';return;}
  $('savePasswordButton').disabled=true;
  try{await Auth.changePassword(password);$('passwordDialog').close();try{await Auth.logout();}catch{}endSession();$('loginError').textContent='Password aggiornata. Accedi con la nuova password.';}
  catch(error){$('passwordError').textContent=niceError(error);}finally{$('savePasswordButton').disabled=false;}
};
setInterval(async()=>{if(account&&!busy&&!dirty&&!rulesDirty&&document.visibilityState==='visible'){
  try{await loadOnline();}catch(e){message(niceError(e),true);}}},30000);
window.addEventListener('storage',e=>{if(e.key==='pw_provvigioni_auth_v2')location.reload();});
renderAll();fillCalc();
if(Auth.session)startSession().catch(()=>{});
