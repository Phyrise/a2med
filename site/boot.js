// Start of the web app: register the service worker, make sure the data is installed (first download or update), then load
// the same interface as the Android app (app.js) with the pdf.js bridge. The data panel also opens from Réglages.
import * as data from './data.js';

const ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1;
const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const LABELS={model:'Modèle de recherche',pdf:'Documents PDF',index:'Index et textes'};
const day=iso=>iso?new Date(iso+'T00:00:00Z').toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}):'?';
const version=m=>`version du ${day(m.date)} (${m.pack})`;

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
#data-panel .err{color:var(--warn)}</style><div class="in"></div>`;
  document.body.append(box);return box;
}

async function showData(local,remote,p,{closable,recheck,checked,checking}){
  const box=panel().querySelector('.in'),store=await data.storage();
  const blocks=remote?remote.blocks:local.blocks;
  const first=!p.complete,files=n=>`${n} fichier${n>1?'s':''}`;
  // Under each block: what it takes on the phone (installed set), or what the first download will take.
  const held=id=>first?null:local.blocks.find(b=>b.id===id);
  const rows=blocks.map(b=>{const c=p.blocks[b.id],h=held(b.id);
    return `<li><span>${LABELS[b.id]||b.label}<small>${h?`${data.mb(h.bytes)} sur l’appareil · ${files(h.files.length)}`:`${data.mb(b.bytes)} · ${files(b.files.length)}`}</small></span>`
      +`<span>${c?(first?'':`${files(c.files)} · ${data.mb(c.bytes)}`):'à jour'}</span></li>`;}).join('');
  const total=first?'':` · ${data.mb(local.blocks.reduce((s,b)=>s+b.bytes,0))} sur l’appareil au total`;
  box.innerHTML=`<h1>${first?'Installer les données':'Données et mises à jour'}</h1>
<p>${first?`Pour fonctionner hors ligne, l’app télécharge une fois le modèle de recherche, l’index et les PDF (${data.mb(p.bytes)}). Wi-Fi conseillé.`
  :remote?(p.bytes?`Mise à jour disponible : ${data.mb(p.bytes)} à télécharger, le reste est déjà sur l’appareil.`:'Tout est à jour.'):checking?'Vérification des mises à jour…':'Pas de réseau (ou réseau trop lent) : impossible de vérifier les mises à jour.'}${checked?` <span class="small">(${remote?'vérifié':'essai'} à ${new Date(checked).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})})</span>`:''}</p>
${ios&&!standalone?'<p class="note">Sur iPhone : ajoutez d’abord l’app à l’écran d’accueil (Partager → « Sur l’écran d’accueil ») et ouvrez-la depuis l’icône. Sinon Safari peut effacer les données après quelques semaines sans usage.</p>':''}
<ul>${rows}</ul>
<p class="small">${local&&remote&&remote.pack!==local.pack?`Installé : ${version(local)} · disponible : ${version(remote)}`
  :remote||local?`Données : ${version(remote||local)}`:''}${total}${store.quota?` · espace autorisé pour l’app : ${data.mb(store.quota)}`:''}${store.persisted?' · stockage protégé':''}</p>
<div class="bar" hidden><i></i></div><p class="status small"></p>
<div>${remote&&p.bytes?`<button class="act">${first?'Télécharger':'Mettre à jour'}</button>`:''}${recheck&&!first?`<button class="ghost recheck"${checking?' disabled>Vérification…':'>Vérifier maintenant'}</button>`:''}${closable?'<button class="ghost close">Fermer</button>':''}</div>`;
  box.querySelector('.close')?.addEventListener('click',()=>panel().remove());
  // Ask the host now instead of waiting for the next return to the screen (the panel shows what is known meanwhile).
  const refresh=async()=>{const s=await recheck();if(box.isConnected)showData(local,s.remote,s.p,{closable,recheck,checked:Date.now()});};
  box.querySelector('.recheck')?.addEventListener('click',e=>{e.target.disabled=true;e.target.textContent='Vérification…';refresh();});
  if(checking&&recheck)refresh();
  box.querySelector('.act')?.addEventListener('click',async e=>{
    const bar=box.querySelector('.bar'),fill=bar.querySelector('i'),status=box.querySelector('.status');e.target.disabled=true;bar.hidden=false;
    try{
      await data.install(p,remote,(done,total)=>{fill.style.width=(100*done/total).toFixed(1)+'%';status.textContent=`${data.mb(done)} / ${data.mb(total)}`;});
      status.textContent='Terminé.';location.reload();
    }catch(err){status.innerHTML=`<span class="err">${err.message}</span> — vous pouvez relancer : ce qui est déjà téléchargé est conservé.`;e.target.disabled=false;e.target.textContent='Reprendre';}
  });
}

async function start(){
  if(!('serviceWorker' in navigator)||!window.caches){document.body.textContent='Ce navigateur ne permet pas l’usage hors ligne.';return;}
  // Installed app: never wait for the network (none, or a slow one). The browser looks for a new sw.js (new app version) in the
  // background and the host's manifest is checked once the app is up; only a first download (or ?donnees) waits for the host.
  const reg=navigator.serviceWorker.register(new URL('sw.js',import.meta.url));reg.catch(()=>{});
  if(!navigator.serviceWorker.controller){await reg;await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));}
  const local=await data.localManifest(),own=local?await data.plan(local,null):{complete:false};
  if(!own.complete||new URLSearchParams(location.search).has('donnees')){
    const remote=await data.remoteManifest();
    if(!local&&!remote){document.body.textContent='Connexion nécessaire pour le premier téléchargement des données.';return;}
    const p=await data.plan(local,remote);
    await showData(local,remote,p,{closable:p.complete});if(!p.complete)return;
  }
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
  const check=async()=>{checked=Date.now();const r=await data.remoteManifest();if(r)state={remote:r,p:await data.plan(local,r)};return Boolean(r);}; // offline: keep what we know
  check().then(offer);
  // The manifest is a few kB: look again whenever the app comes back to the screen (at most once a minute).
  document.addEventListener('visibilitychange',async()=>{if(document.visibilityState==='visible'&&Date.now()-checked>60000){await check();offer();}});
}
start().catch(e=>{document.body.textContent='Démarrage impossible : '+e.message;});
