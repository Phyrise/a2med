// Start of the web app: register the service worker, make sure the data is installed (first download or update), then load
// the same interface as the Android app (app.js) with the pdf.js bridge. The data panel also opens from Réglages.
import * as data from './data.js';
import {NS} from './config.js';
import {SOURCES} from './sources.js';

const ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1;
const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const LABELS={model:'Modèle de recherche',pdf:'Documents PDF',index:'Index et textes'};
const day=iso=>iso?new Date(iso+'T00:00:00Z').toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}):'?';
const version=(m,ids=data.installed(m))=>`du ${day(data.dateOf(m,ids))} (${[m.pack,...ids.map(s=>s.toUpperCase())].join(' + ')})`;

function panel(){
  let box=document.getElementById('data-panel');if(box)return box;
  box=document.createElement('div');box.id='data-panel';
  box.innerHTML=`<style>
#data-panel{position:fixed;inset:0;z-index:50;background:var(--bg);overflow:auto;padding:max(16px,env(safe-area-inset-top)) 16px 24px}
#data-panel .in{max-width:520px;margin:0 auto}#data-panel h1{font-size:1.35rem;margin:.6rem 0 .3rem}
#data-panel p{color:var(--muted);margin:.4rem 0}#data-panel ul{list-style:none;padding:0;margin:1rem 0;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
#data-panel li{display:flex;justify-content:space-between;gap:12px;padding:.7rem .9rem;border-top:1px solid var(--line)}#data-panel li:first-child{border-top:0}
#data-panel li small{display:block;color:var(--muted);font-size:.8rem;margin-top:2px}#data-panel li>span:last-child{text-align:right;white-space:nowrap}
#data-panel .bar{height:8px;border-radius:4px;background:var(--surface-2);overflow:hidden;margin:1rem 0 .4rem}#data-panel .bar i{display:block;height:100%;width:0;background:var(--accent)}
#data-panel button{font:inherit;font-weight:600;border:0;border-radius:12px;padding:.8rem 1.2rem;background:var(--accent);color:var(--accent-ink);margin:.5rem .5rem 0 0}
#data-panel button.ghost{background:var(--surface-2);color:var(--text)}#data-panel .note{background:var(--info-soft);color:var(--info);border-radius:10px;padding:.6rem .8rem}
#data-panel .err{color:var(--warn)}#data-panel .src-title{font-size:1rem;margin:1.2rem 0 0}
#data-panel .pick{display:flex;gap:10px;align-items:flex-start;flex:1}#data-panel .pick input{width:20px;height:20px;margin-top:2px;accent-color:var(--accent)}</style><div class="in"></div>`;
  document.body.append(box);return box;
}

async function showData(local,remote,p,{closable,recheck,checked,checking}){
  const box=panel().querySelector('.in');
  const all=(remote||local).blocks,blocks=all.filter(b=>!b.optional),extra=all.filter(b=>b.optional);
  const first=!p.complete,files=n=>`${n} fichier${n>1?'s':''}`;
  // Under each block: what it takes on the phone (installed set), or what the first download will take.
  const held=id=>first?null:local.blocks.find(b=>b.id===id);
  // Base data, always installed: the search model, and the SPILF pack (its PDFs, index and texts) in one row like the other sources.
  const rows=[[LABELS.model,['model']],[SOURCES[0].name,['pdf','index']]].map(([label,ids])=>{
    const bs=ids.map(id=>held(id)||blocks.find(b=>b.id===id)).filter(Boolean),c=ids.map(id=>p.blocks[id]).filter(Boolean);
    const n=bs.reduce((s,b)=>s+b.files.filter(f=>/(^|\/)pdf\//.test(f.path)).length,0);
    return `<li><span>${label}<small>${data.mb(bs.reduce((s,b)=>s+b.bytes,0))}${n?` · ${n} documents`:''}</small></span>`
      +`<span>${c.length?(first?'':`${files(c.reduce((s,x)=>s+x.files,0))} · ${data.mb(c.reduce((s,x)=>s+x.bytes,0))}`):'à jour'}</span></li>`;}).join('');
  // Sources (0.9): the optional packages, ticked = on the phone after the download.
  const has=id=>data.installed(local).includes(id),want=id=>p.chosen.includes(id);
  const changed=extra.some(b=>has(b.id)!==want(b.id));
  const srcRows=extra.map(b=>`<li><label class="pick"><input type="checkbox" data-src="${b.id}"${want(b.id)?' checked':''}${!remote&&!has(b.id)?' disabled':''}>`
    +`<span>${b.label}<small>${data.mb(b.bytes)} · ${b.files.filter(f=>f.path.includes('/pdf/')).length} documents</small></span></label>`
    +`<span>${want(b.id)?(has(b.id)?'installée':'à télécharger'):(has(b.id)?'à retirer':'')}</span></li>`).join('');
  const kept=local?local.blocks.filter(b=>!b.optional||has(b.id)):[];
  const total=first?'':` · ${data.mb(kept.reduce((s,b)=>s+b.bytes,0))}`;
  const act=remote&&p.bytes||!p.bytes&&changed;
  box.innerHTML=`<h1>${first?'Installer les données':'Données et mises à jour'}</h1>
<p>${first?`L’app télécharge une fois ses données (${data.mb(p.bytes)}) pour fonctionner hors ligne. Wi-Fi conseillé.`
  :changed?(p.bytes?`${data.mb(p.bytes)} à télécharger.`:'Les documents des sources décochées seront effacés du téléphone.')
  :remote?(p.bytes?`Mise à jour disponible : ${data.mb(p.bytes)} à télécharger.`:'Tout est à jour.'):checking?'Vérification des mises à jour…':'Pas de réseau : mises à jour non vérifiées.'}${checked?` <span class="small">(${remote?'vérifié':'essai'} à ${new Date(checked).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})})</span>`:''}</p>
${ios&&!standalone?'<p class="note">Sur iPhone : ajoutez d’abord l’app à l’écran d’accueil (Partager → « Sur l’écran d’accueil »), puis téléchargez depuis l’icône.</p>':''}
${extra.length?'<h2 class="src-title">Données de base</h2>':''}<ul>${rows}</ul>
${extra.length?`<h2 class="src-title">Autres sources</h2><p class="small">Cochez les recommandations à ajouter.</p><ul class="srcs">${srcRows}</ul>`:''}
<p class="small">${local&&remote&&remote.pack!==local.pack?`Données installées ${version(local)} · disponibles ${version(remote,p.chosen)}`
  :remote||local?`Données ${version(remote||local,p.chosen)}`:''}${total}</p>
<div class="bar" hidden><i></i></div><p class="status small"></p>
<div>${act?`<button class="act">${first||changed&&p.bytes?'Télécharger':p.bytes?'Mettre à jour':'Effacer'}</button>`:''}${recheck&&!first?`<button class="ghost recheck"${checking?' disabled>Vérification…':'>Vérifier maintenant'}</button>`:''}${closable?'<button class="ghost close">Fermer</button>':''}</div>`;
  box.querySelector('.close')?.addEventListener('click',()=>panel().remove());
  // The plan reads every stored file (1–2 s while the app starts): the row says it at once, and nothing else can be touched until
  // the panel is drawn again with the new choice (a second tap meanwhile undid the first).
  const picked=()=>[...box.querySelectorAll('[data-src]:checked')].map(x=>x.dataset.src);
  for(const c of box.querySelectorAll('[data-src]'))c.addEventListener('change',async()=>{
    for(const x of box.querySelectorAll('[data-src],.act'))x.disabled=true;c.closest('li').lastElementChild.textContent='…';
    showData(local,remote,await data.plan(local,remote,picked()),{closable,recheck,checked});});
  // Ask the host now instead of waiting for the next return to the screen (the panel shows what is known meanwhile); the sources
  // ticked meanwhile are kept.
  const refresh=async()=>{const s=await recheck();if(box.isConnected)showData(local,s.remote,await data.plan(local,s.remote,picked()),{closable,recheck,checked:Date.now()});};
  box.querySelector('.recheck')?.addEventListener('click',e=>{e.target.disabled=true;e.target.textContent='Vérification…';refresh();});
  if(checking&&recheck)refresh();
  box.querySelector('.act')?.addEventListener('click',async e=>{
    const bar=box.querySelector('.bar'),fill=bar.querySelector('i'),status=box.querySelector('.status');e.target.disabled=true;bar.hidden=false;
    try{
      await data.install(p,remote||local,(done,total)=>{fill.style.width=(100*done/total).toFixed(1)+'%';status.textContent=`${data.mb(done)} / ${data.mb(total)}`;});
      status.textContent='Terminé.';location.reload();
    }catch(err){status.innerHTML=`<span class="err">${err.message}</span> — vous pouvez relancer : ce qui est déjà téléchargé est conservé.`;e.target.disabled=false;e.target.textContent='Reprendre';}
  });
}

async function start(){
  if(!('serviceWorker' in navigator)||!window.caches){document.body.textContent='Ce navigateur ne permet pas l’usage hors ligne.';return;}
  // Installed app: never wait for the network (none, or a slow one). The browser looks for a new sw.js (new app version) in the
  // background and the host's manifest is checked once the app is up; only a first download (or ?donnees) waits for the host.
  // First visit: the service worker copies the app (~19 MB) in the background while the data panel is already shown; the app
  // itself only starts once it is served from the phone (the panel's download takes longer anyway).
  const reg=navigator.serviceWorker.register(new URL('sw.js',import.meta.url));reg.catch(()=>{});
  const served=navigator.serviceWorker.controller?null:reg.then(()=>new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true})));
  let local=await data.localManifest();const own=local?await data.plan(local,null):{complete:false};
  if(!own.complete||new URLSearchParams(location.search).has('donnees')){
    if(!local)panel().querySelector('.in').innerHTML='<h1>Installer les données</h1><p>Recherche des données disponibles…</p>';
    const remote=await data.remoteManifest();
    if(!local&&!remote){document.body.textContent='Connexion nécessaire pour le premier téléchargement des données.';return;}
    const p=await data.plan(local,remote);
    await showData(local,remote,p,{closable:p.complete});if(!p.complete)return;
  }
  keep();  // data installed: is it protected? (app.js only resolves once the model is loaded)
  if(served)await served;
  // New app version: the browser looks for a new sw.js only when the page loads, and an installed app coming back to the screen
  // is resumed, not reloaded. So look for it on return too; once the new version has taken over, offer to switch (a tap).
  const switchTo=()=>{if(document.getElementById('new-version'))return;const t=document.createElement('button');t.id='new-version';t.className='toast';
    t.style.cssText='border:0;font:inherit;z-index:61';t.textContent='Nouvelle version de l’app · toucher pour l’utiliser';t.onclick=()=>location.reload();document.body.append(t);};
  navigator.serviceWorker.addEventListener('controllerchange',switchTo);  // from here on: a new version (the first one is awaited above)
  await import('./web-bridge.js');await import('./app.js');
  let state={remote:null,p:own},banner=null,checked=0;
  // From Réglages: what the host announces right now (offline: what we last knew, and no download offered).
  const recheck=async()=>{const online=await check();offer();return online?state:{remote:null,p:await data.plan(local,null)};};
  document.getElementById('data-open')?.addEventListener('click',()=>{document.getElementById('settings')?.close();showData(local,state.remote,state.p,{closable:true,recheck,checking:true});});
  const offer=()=>{ // update available: say it, without blocking the app
    if(!state.remote||!state.p.bytes||banner?.isConnected)return;
    banner=document.createElement('button');banner.className='toast';banner.style.cssText='position:fixed;left:16px;right:16px;transform:none;max-width:none;bottom:calc(60px + env(safe-area-inset-bottom));z-index:40;border:0;font:inherit';
    banner.textContent=`Mise à jour des données disponible (${data.mb(state.p.bytes)})`;banner.onclick=()=>{banner.remove();showData(local,state.remote,state.p,{closable:true,recheck});};document.body.append(banner);
  };
  // Offline: keep what we know. Same files as installed but newer check dates (the sites were checked, nothing new): the host's
  // manifest is taken at once, nothing to download (the date on the Question screen follows at the next start).
  const check=async()=>{checked=Date.now();const r=await data.remoteManifest();if(!r)return false;state={remote:r,p:await data.plan(local,r)};
    if(state.p.complete&&!state.p.get.length&&!state.p.drop.length&&data.dateOf(r,data.installed(local))!==data.dateOf(local)){await data.adopt(local,r);local={...r,installed:data.installed(local)};}
    return true;};
  check().then(offer);
  // The manifest and sw.js are a few kB: look again whenever the app comes back to the screen (at most once a minute).
  document.addEventListener('visibilitychange',async()=>{if(document.visibilityState==='visible'&&Date.now()-checked>60000){reg.then(r=>r.update()).catch(()=>{});await check();offer();}});
}
// The downloaded data stay only as long as the browser keeps them. Ask for protected storage; if it is refused, the home screen
// suggests installing the app (Chrome protects installed apps; on iPhone only a home-screen app keeps its data for good).
// « Plus tard » hides the card for a week.
let installEvent=null;
addEventListener('beforeinstallprompt',e=>{e.preventDefault();installEvent=e;keep();});
addEventListener('appinstalled',()=>{installEvent=null;keep();});
async function keep(){
  const box=document.getElementById('keep');if(!box)return;
  let safe=false;try{safe=await navigator.storage.persisted()||await navigator.storage.persist();}catch{}
  let later=0;try{later=+(localStorage.getItem(NS+'.keep-later')||0);}catch{}
  if(safe||Date.now()-later<7*864e5){box.hidden=true;return;}
  box.querySelector('p').textContent=standalone?'Le téléphone peut effacer les données de l’app s’il manque de place.'
    :ios?'Pour garder les données : Partager → « Sur l’écran d’accueil », puis ouvrez l’app depuis l’icône.'
    :'Installez l’app pour garder ses données'+(installEvent?'.':' : menu ⋮ → « Installer l’application ».');
  const act=box.querySelector('.act');act.hidden=!installEvent;
  act.onclick=async()=>{const e=installEvent;if(!e)return;e.prompt();const {outcome}=await e.userChoice;if(outcome==='accepted'){installEvent=null;box.hidden=true;}};
  box.querySelector('.later').onclick=()=>{try{localStorage.setItem(NS+'.keep-later',String(Date.now()));}catch{}box.hidden=true;};
  box.hidden=false;
}
start().catch(e=>{document.body.textContent='Démarrage impossible : '+e.message;});
