// A²-Med — final interface, 0.4.1 (UI of final-ui-001 + Pixel feedback of 2026-10-21). Built from 0.3. Two tabs: Question (search, best page first) and Documents (browse, sort).
// A dedicated reader for any page. No LLM, no generated text, no feedback collection.
// The ranking lives in engine.js (Gemma 1 Q4 512D + BM25); this file only knows load(), search() and known().
if(!window.Local)await import('./dev-bridge.js');
import * as engine from './engine.js';
import {BASE,DEV} from './config.js';
import {localManifest} from './data.js';

const VERSION='0.5';
const DATA=BASE+'pack/ui/';

// ---------- small helpers ----------
const $=id=>document.getElementById(id);
function el(tag,props={},...kids){const n=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')n.className=v;else if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else if(v!=null&&v!==false)n.setAttribute(k,v===true?'':v);}for(const k of kids.flat())if(k!=null&&k!==false)n.append(k);return n;}
const norm=s=>s.normalize('NFD').replace(/\p{Mn}/gu,'').toLowerCase();
const STOP=new Set(norm('quel quelle quels quelles est sont le la les un une des de du au aux à dans sur pour par et ou que qui quoi ce cette ces il elle on en d l chez avec sans faut faire comment combien').split(' '));
const store={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v);}catch{return d;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}};
let toastTimer;function toast(text){const t=$('toast');t.textContent=text;t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.hidden=true,2600);}
const ICON={check:'<path d="M5 12l5 5 9-10"/>',x:'<path d="M6 6l12 12M18 6 6 18"/>',save:'<path d="M7 3h10v18l-5-4-5 4z"/>',clock:'<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',doc:'<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/>',search:'<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',chev:'<path d="M9 6l6 6-6 6"/>'};
const icon=name=>{const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('aria-hidden','true');s.innerHTML=ICON[name];return s;};

// Abbreviations are offered, never applied silently. List to validate with Alexia (same as 0.3).
const ABBR={ei:'endocardite infectieuse',pna:'pyélonéphrite aiguë',pac:'pneumonie aiguë communautaire',iu:'infection urinaire',ium:'infection urinaire masculine',ioa:'infection ostéo-articulaire',idv:'infection disco-vertébrale',pth:'prothèse totale de hanche',ptg:'prothèse totale de genou',sarm:'Staphylococcus aureus résistant à la méticilline',sams:'Staphylococcus aureus sensible à la méticilline',blse:'bêta-lactamase à spectre étendu',epc:'entérobactérie productrice de carbapénémase',bhre:'bactérie hautement résistante émergente',icd:'infection à Clostridioides difficile',iim:'infection invasive à méningocoque',dhbnn:'dermohypodermite bactérienne non nécrosante',atb:'antibiothérapie',abp:'antibioprophylaxie',vzv:'varicelle zona',ist:'infection sexuellement transmissible',igh:'infection génitale haute',lcr:'liquide cérébrospinal',tb:'tuberculose',dfg:'débit de filtration glomérulaire'};

// ---------- state ----------
let corpus=null,docs=[],terms=[],termsNorm=[],vocab=[],vocabSet=new Set(),texts=null,pageRows=null,info=null;
let pendingQuery=null,busy=false,query='',results=[],lexicalHits=0,cur=null,lastQuestionView='home';
const RECENT='a2med-recent',SAVED='a2med-pins',SORT='a2med-doc-sort';  // same keys as 0.3 for recent searches and saved pages; texts.json is aligned with corpus.rows

// ---------- labels ----------
const docOf=i=>docs[i]||{title:corpus?.documents[i]?.source||'Document',kind:'',year:null,source:'',pages:corpus?.documents[i]?.pages||1,status:null,changed_pages:[],domain:''};
const isSlides=i=>corpus?corpus.documents[i]?.source_type==='pptx':docs[i]?.kind==='Diaporama';
const pageLabel=(doc,page)=>(isSlides(doc)?'Diapo ':'p. ')+(page+1);
// The year leads every document line, in bold: which recommendation is the recent one must be seen at a glance.
const withYear=(d,rest)=>{const t=rest.filter(Boolean).join(' · ');return d.year?[el('b',{class:'yr'},String(d.year)),t?' · '+t:'']:[t];};
const metaLine=(doc,page,total=true,kind=false)=>{const d=docOf(doc);return withYear(d,[kind&&d.kind,d.source,pageLabel(doc,page)+(total?' / '+d.pages:'')]);};
// Status of a document, shortened for the doctor (the pack's longer labels and details are for following the sources).
const SHORT=[[/^Version mise à jour.*/,'Version mise à jour'],[/^Recommandation signalée en cours de révision$/,'En cours de révision'],[/^Classé obsolète.*/,'Obsolète selon la SPILF']];
const short=s=>s&&{level:s.level,label:SHORT.reduce((l,[r,t])=>l.replace(r,t),s.label)};
const statusOf=doc=>short(docOf(doc).status);

// ---------- snippets (from 0.3) ----------
function queryTerms(q){return [...new Set((norm(q).match(/[\p{L}\p{N}]+/gu)||[]).filter(t=>!STOP.has(t)&&(t.length>=3||/\d/.test(t))))];}
const matches=(w,t)=>w===t||(t.length>=5&&w.startsWith(t.slice(0,Math.max(5,t.length-2))));
function bestSnippet(text,qt,max=280){
  if(!text)return '';
  // The page texts keep the extraction's Markdown marks (# titles, **bold**, bullets): not shown in the snippets.
  const parts=text.split(/\n|(?<=[.;!?])\s+/).map(s=>s.replace(/\*\*/g,'').replace(/^\s*(#+|[•▪●◦·\-–])\s*/,'').trim()).filter(s=>s.length>2);
  let best=-1,bi=0;
  parts.forEach((s,i)=>{const words=(norm(s).match(/[\p{L}\p{N}]+/gu)||[]);const sc=qt.filter(t=>words.some(w=>matches(w,t))).length;if(sc>best){best=sc;bi=i;}});
  let out=parts[bi]||'';if(out.length<110&&parts[bi+1])out+=' · '+parts[bi+1];
  if(out.length>max){const w=norm(out);let at=0;for(const t of qt){const k=w.indexOf(t.slice(0,5));if(k>=0){at=k;break;}}let s=Math.max(0,at-90);if(s){const sp=out.indexOf(' ',s);if(sp>0&&sp-s<25)s=sp+1;}let e=Math.min(out.length,s+max-20);const ep=out.lastIndexOf(' ',e);if(e<out.length&&ep>s+150)e=ep;out=(s?'… ':'')+out.slice(s,e)+(e<out.length?' …':'');}
  return out;
}
function highlighted(text,qt){const f=document.createDocumentFragment();for(const tok of text.match(/[\p{L}\p{N}]+|[^\p{L}\p{N}]+/gu)||[]){const n=norm(tok);f.append(/[\p{L}\p{N}]/u.test(tok)&&qt.some(t=>matches(n,t))?el('mark',{},tok):tok);}return f;}
function textOfPage(doc,page){if(!texts||!pageRows)return '';return (pageRows.get(doc+':'+page)||[]).map(i=>texts[i]||'').join('\n');}

// ---------- page images through the bridge (cached) ----------
// Sizes: 'std' 1400 px, 'lo' 400 px (fast, shown blurred while a page opens), 'hd' 2200 px (zoom).
const pending=new Map(),cache=new Map(),WIDTH={lo:400,hd:2200};let ticket=0;
window.a2medPageReady=(id,meta,data)=>{const cb=pending.get(id);if(cb){pending.delete(id);cb({meta,data});}};
const cached=(doc,page,size='std')=>cache.get(doc+':'+page+':'+size);
// wanted(): asked by the web bridge just before it starts the render; a page nobody still wants (pages flipped past, slides
// scrolled away, an older question's preview) is skipped instead of holding up the queue. Requests for the same image share one render.
const inflight=new Map();
window.a2medWanted=id=>{const w=wants.get(id);return !w||w.some(f=>f());};const wants=new Map();
function pageURL(doc,page,size='std',wanted=()=>true){
  const key=doc+':'+page+':'+size;if(cache.has(key)){const v=cache.get(key);cache.delete(key);cache.set(key,v);return Promise.resolve(v);}
  const f=inflight.get(key);if(f){wants.get(f.id)?.push(wanted);return f.promise;}
  const id='p'+(++ticket)+'-'+Date.now();wants.set(id,[wanted]);
  const promise=renderURL(id,key,doc,page,size).finally(()=>{inflight.delete(key);wants.delete(id);});
  inflight.set(key,{id,promise});return promise;
}
async function renderURL(id,key,doc,page,size){
  const {meta,data}=await new Promise((resolve,reject)=>{pending.set(id,resolve);
    if(WIDTH[size]&&typeof Local.renderPageWidth==='function')Local.renderPageWidth(id,doc,page,WIDTH[size]);else Local.renderPage(id,doc,page);
    setTimeout(()=>{if(pending.delete(id))reject(Error('Ouverture trop longue'));},30000);});
  if(!meta.ok)throw Error(meta.error||'PDF indisponible');
  const blob=data instanceof Blob?data:await (await fetch('data:image/png;base64,'+data)).blob(),url=URL.createObjectURL(blob),value={url,meta}; // web: pdf.js gives a Blob
  cache.set(key,value);
  while(cache.size>48){const [k,v]=cache.entries().next().value;if(cur&&k.startsWith(cur.doc+':'+cur.page+':'))break;URL.revokeObjectURL(v.url);cache.delete(k);}
  return value;
}

// ---------- typing assistance ----------
const keep=e=>e.preventDefault(); // keep the keyboard open while choosing a suggestion
// The question field grows with the text (up to 4 lines, then scrolls) so the whole question stays readable.
function fitQ(){const q=$('q'),cs=getComputedStyle(q),max=4*parseFloat(cs.lineHeight)+parseFloat(cs.paddingTop)+parseFloat(cs.paddingBottom);
  q.style.height='auto';q.style.height=Math.min(q.scrollHeight,max)+'px';q.style.overflowY=q.scrollHeight>max+1?'auto':'hidden';}
function setQ(v){$('q').value=v;fitQ();$('clear').hidden=!v;}
function assist(){
  const input=$('q'),v=input.value;$('clear').hidden=!v;fitQ();
  if(document.activeElement!==input){$('assist').hidden=true;return;}
  const list=$('suggest'),chips=$('chips');list.replaceChildren();chips.replaceChildren();
  const tokens=v.split(/\s+/).filter(Boolean),partial=/\s$/.test(v)?'':(tokens.at(-1)||''),np=norm(partial),prev=norm(/\s$/.test(v)?tokens.at(-1)||'':tokens.at(-2)||'');
  const pick=(text)=>({type:'button',onpointerdown:keep,onmousedown:keep,onclick:text});
  if(!v.trim()){
    for(const r of store.get(RECENT,[]).slice(0,5))list.append(el('li',{},el('button',pick(()=>{setQ(r.q);submit();}),icon('clock'),el('span',{},r.q))));
  }else{
    const seen=new Set(),out=[];
    if(np.length>=2&&termsNorm.length){
      const add=i=>{const t=terms[i][0];if(!seen.has(t)&&norm(t)!==np&&out.length<5){seen.add(t);out.push(t);}};
      if(prev&&!STOP.has(prev))for(let i=0;i<termsNorm.length&&out.length<2;i++)if(termsNorm[i].startsWith(prev+' '+np))add(i);
      for(let i=0;i<termsNorm.length&&out.length<5;i++)if(termsNorm[i].startsWith(np))add(i);
    }else if(!partial&&prev.length>=3&&!STOP.has(prev)&&termsNorm.length){  // after a space: the words that usually follow
      const nv=norm(v);
      for(let i=0;i<termsNorm.length&&out.length<4;i++)if(termsNorm[i].startsWith(prev+' ')&&!nv.includes(termsNorm[i].slice(prev.length+1)))out.push(terms[i][0]);
    }
    for(const t of out){
      const completesBigram=prev&&norm(t).startsWith(prev+' ');
      const insert=completesBigram?t.split(' ').slice(1).join(' '):t;
      list.append(el('li',{},el('button',pick(()=>{input.value=(partial?v.slice(0,v.length-partial.length):v.replace(/\s*$/,' '))+insert+' ';input.focus();assist();}),icon('search'),el('span',{},el('b',{},t.slice(0,partial.length)),t.slice(partial.length)))));
    }
    const qt=queryTerms(v);
    if(qt.length&&docs.length){
      const hits=docs.filter(d=>{const n=norm(d.title);return qt.every(t=>n.split(/[^\p{L}\p{N}]+/u).some(w=>w.startsWith(t.slice(0,4))));}).slice(0,2);
      for(const d of hits)list.append(el('li',{},el('button',{...pick(()=>{input.blur();openPage(d.id,0,null);}),class:'doc-s'},icon('doc'),el('span',{},d.title),el('small',{},'Ouvrir'))));
    }
    for(const tok of tokens){const a=ABBR[norm(tok)];if(a&&!norm(v).includes(norm(a)))chips.append(el('button',{...pick(()=>{input.value=v.replace(new RegExp('(^|\\s)'+tok.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?=\\s|$)'),'$1'+a);input.focus();assist();}),class:'chip abbr'},tok.toUpperCase()+' = '+a));}
  }
  $('assist').hidden=!list.children.length&&!chips.children.length;
}

// ---------- spelling: a word found in no document gets the closest corpus word ----------
function distance(a,b,max){  // optimal string alignment, stops early beyond max
  if(Math.abs(a.length-b.length)>max)return max+1;
  let p2=null,p=[...Array(b.length+1).keys()];
  for(let i=1;i<=a.length;i++){const c=[i];let low=i;
    for(let j=1;j<=b.length;j++){let v=Math.min(p[j]+1,c[j-1]+1,p[j-1]+(a[i-1]===b[j-1]?0:1));
      if(p2&&i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])v=Math.min(v,p2[j-2]+1);c.push(v);if(v<low)low=v;}
    if(low>max)return max+1;p2=p;p=c;}
  return p[b.length];
}
function spellingHints(q){
  const out=[];
  for(const word of new Set(q.match(/[\p{L}]{4,}/gu)||[])){
    const n=norm(word);if(STOP.has(n)||ABBR[n]||engine.known(word)||vocabSet.has(n))continue;
    const max=n.length<=6?1:2;let best=null,bd=max+1;
    for(const [w,wn,f] of vocab){const d=distance(n,wn,max);if(d<bd||(d===bd&&best&&f>best[2])){bd=d;best=[w,wn,f];}}
    if(best&&best[1]!==n)out.push([word,best[0]]);
  }
  return out;
}
function renderSpelling(){
  const box=$('spell'),hints=spellingHints(query);box.replaceChildren();
  for(const [word,fix] of hints)box.append(el('span',{},'« '+word+' » n’apparaît dans aucun document. Vouliez-vous dire ',el('button',{type:'button',class:'link',onclick:()=>{setQ(query.replace(word,fix));submit();}},fix),' ? '));
  if(!hints.length&&lexicalHits===0)box.append('Aucun mot de la question dans les documents : pages proches par le sens.');
  box.hidden=!box.childNodes.length;
}

// ---------- search ----------
function engineStatus(text,cls=''){const e=$('engine');e.hidden=!text;e.className='engine '+cls;e.textContent=text||'';}
function submit(){const q=$('q').value.trim();if(!q)return;$('q').blur();$('assist').hidden=true;
  if(!engine.state.ready){pendingQuery=q;$('queued').hidden=false;$('queued').textContent='« '+q+' » : recherche lancée dès que l’app est prête.';navigate({view:'home'});return;}
  search(q);}
// A question asked while the engine is still busy with the previous one replaces it: it starts as soon as the engine is free
// (the older answer is never shown under the new question). The page preview no longer holds the engine.
let nextQuery=null;
async function search(q){
  if(!engine.state.ready)return {error:'moteur pas encore prêt'};
  if(busy){nextQuery=q;setQ(q);$('rsum').textContent='Recherche…';return null;}
  busy=true;query=q;remember(q);
  $('go').classList.add('busy');setQ(q);
  if(history.state?.view==='results')apply({view:'results'});else navigate({view:'results'},'push');
  $('skeleton').hidden=false;$('best').hidden=true;$('others').replaceChildren();$('others-title').hidden=true;$('after').hidden=true;$('spell').hidden=true;$('rsum').textContent='Recherche…';
  let r,err;
  try{r=await engine.search(q,5);}catch(e){err=e;}
  busy=false;$('go').classList.remove('busy');
  if(nextQuery!=null){const n=nextQuery;nextQuery=null;return search(n);}
  $('skeleton').hidden=true;
  if(err){$('rsum').textContent='Recherche interrompue : '+err.message;return {error:err.message};}
  results=r.pages;lexicalHits=r.lexicalHits;
  if(!results.length){$('rsum').textContent='Aucune page trouvée.';$('after').hidden=false;return null;}
  const where=engine.MODE==='sparka'?'calcul sur Sparka':'hors ligne',secs=ms=>(ms/1000).toFixed(1).replace('.',',')+' s';
  renderResults();$('rsum').textContent=results.length+' pages · '+where;
  const mine=results,begin=performance.now(),shown=await previewBest();r.times.first_page_ms=r.times.retrieval_ms+performance.now()-begin;
  // Time from the question to the first page on screen (as in the Android app); the search alone if the page was not shown.
  if(results===mine)$('rsum').textContent=results.length+' pages · '+secs(shown?r.times.first_page_ms:r.times.retrieval_ms)+' · '+where;
  if(results===mine)for(const p of results.slice(1,3))pageURL(p.row.doc,p.row.page,'std',()=>results===mine).catch(()=>{});
  return {question:q,times:r.times,first_page_rendered:shown,top5:mine.map(p=>p.row.pid)};  // returned to the dev console only, not stored
}
// Load measurement (dev only), on the phone with the CPU/RAM/temperature sampler of bench_engines.py: ?bench=<label>[&n=30&gap=3&idle=45]
// rest → n questions through the normal search (results and first page shown), one every `gap` s → rest. Sent to /results.
async function runBench(){
  const u=new URLSearchParams(location.search),n=+(u.get('n')||30),gap=+(u.get('gap')||3)*1000,idle=+(u.get('idle')||45)*1000;
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),R={label:u.get('bench')||'run',mode:engine.MODE,ua:navigator.userAgent,startup:engine.state.startup,marks:[],queries:[]};
  const mark=phase=>R.marks.push({phase,t:Date.now()}),heap=()=>performance.memory?Math.round(performance.memory.usedJSHeapSize/2**20):null;
  const qs=(await (await fetch(BASE+'dev/tests/parity-expected.json')).json()).questions.slice(0,n);
  const lock=await navigator.wakeLock?.request('screen').catch(()=>null);R.screen_kept_on=Boolean(lock);  // the screen goes off after 60 s otherwise
  benching=true;mark('rest-before');await wait(idle);mark('searches');R.heap_before_mb=heap();
  for(const x of qs){const t=performance.now(),r=await search(x.question);
    R.queries.push({id:x.id,wall_ms:Math.round(performance.now()-t),times:r?.times,same_top5:r?.top5?.map(pid=>{const i=corpus.rows.findIndex(w=>w.pid===pid),w=corpus.rows[i];return w.doc+':'+w.page;}).join()===x.top5.join(),error:r?.error});
    await wait(gap);}
  R.heap_after_mb=heap();benching=false;mark('rest-after');await wait(idle);mark('end');
  await fetch(BASE+'results',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(R)}).catch(()=>{});
  lock?.release();
  $('rsum').textContent='Mesure terminée ('+R.queries.length+' questions).';
}
let benching=false;  // runBench: its questions do not go into « Récentes »
function remember(q){if(benching)return;const r=store.get(RECENT,[]).filter(x=>x.q!==q);r.unshift({q,at:Date.now()});store.set(RECENT,r.slice(0,12));}

// ---------- results ----------
function statusBadge(doc){const st=statusOf(doc);return st?el('span',{class:'badge '+st.level},st.label):null;}
function renderResults(){
  const qt=queryTerms(query),[top,...rest]=results,d=docOf(top.row.doc);
  const snip=bestSnippet(textOfPage(top.row.doc,top.row.page),qt,320);
  $('best').replaceChildren(...[
    el('div',{class:'kicker'},'Meilleure correspondance'),
    el('button',{type:'button',class:'best-head',onclick:()=>openHit(0)},el('strong',{},d.title),el('span',{class:'meta'},metaLine(top.row.doc,top.row.page,true,true))),
    statusBadge(top.row.doc),
    snip?el('p',{class:'snip'},highlighted(snip,qt)):null,
    el('button',{type:'button',class:'thumb loading',id:'best-thumb','aria-label':'Ouvrir la page en grand',onclick:()=>openHit(0)},el('img',{alt:'Page originale — '+d.title+', '+pageLabel(top.row.doc,top.row.page)}),el('span',{class:'expand'},'Toucher pour agrandir'))].filter(Boolean));
  $('best').hidden=false;
  $('others').replaceChildren(...rest.map((p,k)=>{const i=k+1,dd=docOf(p.row.doc),s=bestSnippet(textOfPage(p.row.doc,p.row.page),qt,160);
    return el('button',{type:'button',class:'row',onclick:()=>openHit(i)},
      el('span',{class:'n'},String(i+1)),
      el('span',{class:'body'},el('strong',{},dd.title),el('span',{class:'meta'},metaLine(p.row.doc,p.row.page,false)),s?el('span',{class:'snip'},highlighted(s,qt)):null,statusBadge(p.row.doc)),
      icon('chev'));}));
  $('others-title').hidden=!rest.length;$('after').hidden=false;
  renderSpelling();
}
async function previewBest(){
  const p=results[0],thumb=$('best-thumb');if(!thumb)return false;
  try{const {url}=await pageURL(p.row.doc,p.row.page,'std',()=>results[0]===p);const img=thumb.querySelector('img');
    await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=url;});thumb.classList.remove('loading');return true;}
  catch{thumb.classList.remove('loading');thumb.querySelector('.expand').textContent='Aperçu indisponible — toucher pour ouvrir';return false;}
}

// ---------- reader ----------
const saved=()=>store.get(SAVED,[]);
const isSaved=(doc,page)=>saved().some(p=>p.doc===doc&&p.page===page);
function toggleSave(){const pins=saved(),i=pins.findIndex(p=>p.doc===cur.doc&&p.page===cur.page);
  if(i>=0){pins.splice(i,1);toast('Retirée de Mes pages');}else{pins.unshift({doc:cur.doc,page:cur.page,at:Date.now()});toast('Enregistrée dans Mes pages (onglet Documents)');}
  store.set(SAVED,pins.slice(0,40));renderReader();}
const onHit=()=>cur&&cur.hit!=null&&results[cur.hit]&&results[cur.hit].row.doc===cur.doc&&results[cur.hit].row.page===cur.page;
function openHit(i){const p=results[i];navigate({view:'page',doc:p.row.doc,page:p.row.page,hit:i},'push');}
function openPage(doc,page,hit=null){navigate({view:'page',doc,page,hit},'push');}
function renderReader(){
  if(!cur)return;const d=docOf(cur.doc),st=statusOf(cur.doc);
  $('r-title').textContent=d.title;$('r-meta').replaceChildren(...withYear(d,[d.source,d.kind]));
  const s=$('r-status');s.hidden=!st;if(st){s.className='status '+st.level;s.replaceChildren(el('strong',{},(st.level==='warn'?'⚠ ':'')+st.label));}
  const sv=isSaved(cur.doc,cur.page);$('r-save').setAttribute('aria-pressed',String(sv));$('r-save').setAttribute('aria-label',sv?'Retirer de Mes pages':'Enregistrer dans Mes pages');
  $('pageinfo').textContent=pageLabel(cur.doc,cur.page)+' / '+d.pages;
  $('prev-page').disabled=cur.page<=0;$('next-page').disabled=cur.page>=d.pages-1;
  const fromResults=cur.hit!=null&&results.length>0;
  $('hitnav').hidden=!fromResults;
  if(fromResults){$('hit-pos').textContent='Résultat '+(cur.hit+1)+' / '+results.length;$('prev-hit').disabled=cur.hit<=0;$('next-hit').disabled=cur.hit>=results.length-1;}
  $('back-hit').hidden=!(fromResults&&!onHit());
}
// Two modes. 'page': a PDF page, zoom/pan, and a swipe that drags the page with the finger, the next one alongside.
// 'column': a slide deck as one continuous strip (Arthur, 21/10): it scrolls freely and stops anywhere; a pinch or a double tap
// zooms the whole strip around the fingers, and zoomed it pans in every direction and still scrolls on to the other slides.
let showTicket=0,mode='page',col=null,turning=false,turnSeq=0;
const GAP=16;  // px between pages while swiping, same as the CSS
function setMode(m){
  if(m==='page'&&col)dropColumn();
  mode=m;$('track').hidden=m==='column';$('column').hidden=m==='page';$('stage').classList.toggle('col',m==='column');
}
const decoded=(img,url)=>{if(img.getAttribute('src')!==url)img.src=url;return img.decode();};
// Every document (slide deck or PDF) reads as one continuous strip: native scrolling, free zoom. showPage (one page at a time,
// swipe to turn) is no longer used for opening documents.
function show(doc,page,hit){return showColumn(doc,page,hit);}
function failed(mine,e,retry){if(mine!==showTicket)return false;const stage=$('stage');stage.classList.remove('loading');$('stage-status').textContent=e.message+' — toucher pour réessayer';stage.onclick=()=>{stage.onclick=null;retry();};return false;}

async function showPage(doc,page,hit,swiped=false){
  const mine=++showTicket;turnSeq++;cur={doc,page,hit};setMode('page');resetZoom();renderReader();
  const stage=$('stage'),img=$('img'),status=$('stage-status');status.textContent='';stage.onclick=null;
  img.alt='Page originale — '+docOf(doc).title+', '+pageLabel(doc,page);
  const ready=cached(doc,page);
  if(!ready){
    // Never leave the previous page on screen: a quick small render, blurred, stands in until the page is ready.
    stage.classList.add('loading');img.removeAttribute('src');
    (cached(doc,page,'lo')?Promise.resolve(cached(doc,page,'lo')):pageURL(doc,page,'lo',()=>mine===showTicket))
      .then(v=>{if(mine===showTicket&&stage.classList.contains('loading'))return decoded(img,v.url).then(fitImage);}).catch(()=>{});
  }
  const slow=setTimeout(()=>{if(mine===showTicket&&stage.classList.contains('loading'))status.textContent='Ouverture de la page…';},400);
  try{const {url}=ready||await pageURL(doc,page,'std',()=>mine===showTicket);if(mine!==showTicket)return false;
    await decoded(img,url);if(mine!==showTicket)return false;
    fitImage();stage.classList.remove('loading');status.textContent='';
    if(swiped)trackTo(0,false);
    cur.shown=true;if(mode==='page')neighbours(mine);
    return true;
  }catch(e){if(swiped)trackTo(0,false);return failed(mine,e,()=>showPage(doc,page,hit));}
  finally{clearTimeout(slow);}
}
function fitImage(){const img=$('img'),st=$('stage');if(!img.naturalWidth)return;const r=img.naturalWidth/img.naturalHeight,w=Math.min(st.clientWidth,st.clientHeight*r);img.style.width=Math.floor(w)+'px';}
// Previous and next pages sit left and right of the current one, ready for the swipe.
function neighbours(mine){
  for(const [id,delta] of [['img-next',1],['img-prev',-1]]){
    const im=$(id),p=cur.page+delta,key=cur.doc+':'+p;
    if(im.dataset.key!==key){im.removeAttribute('src');im.dataset.key=key;}
    if(p<0||p>=docOf(cur.doc).pages)continue;
    pageURL(cur.doc,p,'std',()=>mine===showTicket).then(v=>{if(mine===showTicket&&im.dataset.key===key&&im.getAttribute('src')!==v.url)im.src=v.url;}).catch(()=>{});
  }
}
function trackTo(x,animate,done){
  const t=$('track');t.style.transition=animate?'transform .26s cubic-bezier(.22,.8,.32,1)':'none';t.style.transform=x?`translateX(${x}px)`:'';
  if(done){let fired=false;const f=()=>{if(!fired){fired=true;done();}};t.addEventListener('transitionend',f,{once:true});setTimeout(f,400);}
}
// Finish a page turn: the neighbour slides into place, then becomes the current page (same image, no flash).
function turn(delta){
  const {doc,hit}=cur,p=cur.page+delta;
  if(p<0||p>=docOf(doc).pages){trackTo(0,true);return;}
  history.replaceState({...history.state,page:p},'');
  const nb=$(delta>0?'img-next':'img-prev');
  if(nb.dataset.key===doc+':'+p&&nb.complete&&nb.naturalWidth){
    // A turn still sliding when another page is asked for (fast taps, a jump) must not land afterwards.
    const seq=++turnSeq;turning=true;
    trackTo(-delta*($('stage').clientWidth+GAP),true,()=>{if(seq!==turnSeq){turning=false;return;}showPage(doc,p,hit,true).finally(()=>{turning=false;});});
  }else{trackTo(0,false);showPage(doc,p,hit);}
}

// ---------- slide decks: one continuous strip ----------
async function showColumn(doc,page,hit){
  const same=col&&col.doc===doc;
  const mine=++showTicket;cur={doc,page,hit};resetZoom();renderReader();
  const stage=$('stage'),status=$('stage-status');status.textContent='';stage.onclick=null;
  if(same){const smooth=mode==='column';setMode('column');markHit();scrollToSlide(page,smooth);cur.shown=true;return true;}
  dropColumn();setMode('column');stage.classList.add('loading');
  const slow=setTimeout(()=>{if(mine===showTicket&&stage.classList.contains('loading'))status.textContent='Ouverture de la page…';},400);
  try{// PDFs mix page sizes (landscape tables): each page gets its own proportions from pdf.js; a deck shares one size.
    const [first,sizes]=await Promise.all([pageURL(doc,page,'std',()=>mine===showTicket),!isSlides(doc)&&Local.pageSizes?Local.pageSizes(doc).catch(()=>null):null]);
    if(mine!==showTicket)return false;
    const probe=new Image();probe.src=first.url;await probe.decode();if(mine!==showTicket)return false;
    buildColumn(doc,probe.naturalWidth/probe.naturalHeight,sizes);col.els[page].firstChild.src=first.url;scrollToSlide(page,false);
    stage.classList.remove('loading');status.textContent='';cur.shown=true;return true;
  }catch(e){return failed(mine,e,()=>showColumn(doc,page,hit));}
  finally{clearTimeout(slow);}
}
function dropColumn(){if(col){col.io.disconnect();clearTimeout(col.anim);col=null;}$('column').replaceChildren();}
const SLIDE_GAP=12,ZMAX=4,HD_FROM=1.6;  // px between slides at ×1 (gaps grow with the zoom: the strip scales as one picture)
function buildColumn(doc,ratio,sizes=null){
  const c=$('column'),n=docOf(doc).pages,strip=el('div',{class:'strip'});
  c.style.setProperty('--ratio',String(ratio));
  const own=i=>sizes?.[i]?{style:`--r:${sizes[i][0]/sizes[i][1]}`}:{};
  const els=Array.from({length:n},(_,i)=>el('div',{class:'cslide','data-i':String(i),...own(i)},el('img',{alt:'Page originale — '+docOf(doc).title+', '+pageLabel(doc,i)})));
  strip.replaceChildren(...els);c.replaceChildren(strip);
  // Only slides within about one screen of the view keep an image; the others are released (they keep their size).
  const near=new Set();
  const io=new IntersectionObserver(entries=>{for(const e of entries){const i=+e.target.dataset.i;
    if(e.isIntersecting){near.add(i);loadSlide(i);}else{near.delete(i);e.target.firstChild.removeAttribute('src');}}},{root:c,rootMargin:'100% 0px'});
  col={doc,els,io,ratio,near,strip,z:1,aim:null,anim:0};layoutColumn();els.forEach(x=>io.observe(x));markHit();
}
// The standard render, or the sharper one (2200 px) while the strip is zoomed.
// A quick small render (400 px) stands in first, so that pages scrolled into view are never blank for long.
function loadSlide(i){const c=col,img=c?.els[i]?.firstChild;if(!img)return;
  const want=()=>col===c&&c.near.has(i),size=c.z>=HD_FROM?'hd':'std',set=v=>{if(want()&&img.getAttribute('src')!==v.url)img.src=v.url;};
  if(!img.getAttribute('src')&&!cached(c.doc,i,size)&&!cached(c.doc,i,'std'))pageURL(c.doc,i,'lo',want).then(v=>{if(!img.getAttribute('src'))set(v);}).catch(()=>{});
  pageURL(c.doc,i,size,want).then(set).catch(()=>{});}
// Room above the first and below the last slide, so that they too can sit in the middle of the screen: the slide in the middle is
// the current one, and the last slide of a deck was otherwise never counted as shown.
function layoutColumn(){const c=$('column'),w=c.clientWidth*col.z,g=SLIDE_GAP*col.z,end=Math.max(g,(c.clientHeight-w/col.ratio)/2);
  col.strip.style.cssText=`width:${w}px;gap:${g}px;padding:${end}px 0`;}
// Slide i in view: centred when it fits on the screen, else its top at the top. Zoomed, the sideways position is kept.
function scrollToSlide(i,smooth){const c=$('column'),e=col?.els[i];if(!e)return;
  const top=e.offsetHeight<=c.clientHeight?e.offsetTop-(c.clientHeight-e.offsetHeight)/2:e.offsetTop-SLIDE_GAP*col.z;
  col.aim=smooth?i:null;c.scrollTo({top,behavior:smooth?'smooth':'instant'});}
function markHit(){if(!col)return;const h=cur?.hit!=null?results[cur.hit]?.row:null;col.els.forEach((e,i)=>e.classList.toggle('hit',Boolean(h&&h.doc===col.doc&&h.page===i)));}
function slideAt(y){if(!col)return 0;let best=0,bd=Infinity;col.els.forEach((e,i)=>{const r=e.getBoundingClientRect(),d=y<r.top?r.top-y:y>r.bottom?y-r.bottom:0;if(d<bd){bd=d;best=i;}});return best;}
// The slide under the middle of the screen is the current one (page number, prev/next, back button).
let scrollFrame=0;
function onColumnScroll(){
  if(scrollFrame||!col||mode!=='column')return;
  scrollFrame=requestAnimationFrame(()=>{scrollFrame=0;if(!col||mode!=='column')return;
    const r=$('column').getBoundingClientRect(),i=slideAt((r.top+r.bottom)/2);if(col.aim===i)col.aim=null;
    if(i!==cur.page){cur.page=i;history.replaceState({...history.state,page:i},'');renderReader();}});
}
// Zoom of the strip to z around the point (fx,fy) of the view, c0 = that point in the strip at the old zoom (it stays under it).
// While it moves, the strip is only scaled (transform); its new size is laid out once at the end, at an in-range scroll position.
function zoomTarget(z,fx,fy,c0){const c=$('column'),k=z/col.z,clamp=(v,hi)=>Math.max(0,Math.min(hi,v));
  return [clamp(c0[0]*k-fx,c.clientWidth*(z-1)),clamp(c0[1]*k-fy,col.strip.offsetHeight*k-c.clientHeight)];}
function previewZoom(k,fx,fy,c0){const c=$('column');col.strip.style.transform=`translate(${c.scrollLeft+fx-c0[0]*k}px,${c.scrollTop+fy-c0[1]*k}px) scale(${k})`;}
function settleZoom(z,fx,fy,c0,animate){
  if(!col)return;z=Math.min(ZMAX,Math.max(1,z));if(z<1.03)z=1;
  const c=$('column'),s=col.strip,k=z/col.z,[tx,ty]=zoomTarget(z,fx,fy,c0);clearTimeout(col.anim);
  const commit=()=>{if(col?.strip!==s)return;col.z=z;layoutColumn();c.scrollLeft=tx;c.scrollTop=ty;if(z>=HD_FROM)for(const i of col.near)loadSlide(i);onColumnScroll();};
  if(!animate)return commit();
  s.style.transition='transform .22s ease-out';s.style.transform=`translate(${c.scrollLeft-tx}px,${c.scrollTop-ty}px) scale(${k})`;
  col.anim=setTimeout(commit,230);
}
function zoomColumn(z,cx,cy,animate){if(!col)return;const c=$('column'),r=c.getBoundingClientRect(),fx=cx-r.left,fy=cy-r.top;
  settleZoom(z,fx,fy,[c.scrollLeft+fx,c.scrollTop+fy],animate);}
// The page number opens a jump to any page (long recommendations: 100+ pages).
function jump(){
  if(!cur)return;const n=docOf(cur.doc).pages,v=prompt(`Aller à la ${isSlides(cur.doc)?'diapo':'page'} (1 à ${n}) :`,String(cur.page+1));
  const p=parseInt(v,10)-1;if(!Number.isInteger(p)||p<0||p>=n||p===cur.page)return;
  if(mode==='column')return scrollToSlide(p,false);
  history.replaceState({...history.state,page:p},'');trackTo(0,false);showPage(cur.doc,p,cur.hit);
}
function step(delta){
  if(!cur)return;if(mode==='page')return turn(delta);
  const p=(col?.aim??cur.page)+delta;if(p<0||p>=docOf(cur.doc).pages)return;
  scrollToSlide(p,true);
}
function stepHit(delta){const i=cur.hit+delta;if(i<0||i>=results.length)return;const p=results[i].row;history.replaceState({view:'page',doc:p.doc,page:p.page,hit:i},'');show(p.doc,p.page,i);}

// ---------- zoom, pan, swipe ----------
const Z={s:1,x:0,y:0,hd:false};const pts=new Map();let gesture=null,lastTap=0,lastTapXY=[0,0];
function applyZoom(){const f=$('frame');f.style.transform=`translate(${Z.x}px,${Z.y}px) scale(${Z.s})`;$('stage').classList.toggle('zoomed',Z.s>1.01);
  if(Z.s>=1.8&&!Z.hd&&cur&&mode!=='column'){Z.hd=true;const {doc,page}=cur;pageURL(doc,page,'hd').then(({url})=>{if(cur&&cur.doc===doc&&cur.page===page&&mode!=='column')$('img').src=url;}).catch(()=>{});}}
function resetZoom(){Z.s=1;Z.x=0;Z.y=0;Z.hd=false;applyZoom();}
function smoothly(fn){const f=$('frame');f.style.transition='transform .22s ease-out';fn();setTimeout(()=>{f.style.transition='';},240);}
function clampZoom(){const st=$('stage').getBoundingClientRect(),f=$('frame'),w=f.offsetWidth*Z.s,h=f.offsetHeight*Z.s,fx=f.offsetLeft,fy=f.offsetTop;
  Z.x=w<=st.width?(st.width-w)/2-fx:Math.min(-fx,Math.max(st.width-fx-w,Z.x));Z.y=h<=st.height?(st.height-h)/2-fy:Math.min(-fy,Math.max(st.height-fy-h,Z.y));}
function zoomAt(cx,cy,s){const st=$('stage').getBoundingClientRect(),f=$('frame'),px=cx-st.left-f.offsetLeft,py=cy-st.top-f.offsetTop,k=s/Z.s;Z.x=px-(px-Z.x)*k;Z.y=py-(py-Z.y)*k;Z.s=s;if(s<=1.01){Z.s=1;Z.x=0;Z.y=0;}else clampZoom();applyZoom();}
function tap(e,zoomed){
  const now=performance.now();
  if(now-lastTap<320&&Math.hypot(e.clientX-lastTapXY[0],e.clientY-lastTapXY[1])<30){lastTap=0;smoothly(()=>zoomAt(e.clientX,e.clientY,zoomed?1:2.5));return;}
  lastTap=now;lastTapXY=[e.clientX,e.clientY];
}
const pinchStart=type=>{const [a,b]=[...pts.values()];return {type,d0:Math.hypot(a[0]-b[0],a[1]-b[1]),s0:Z.s,x0:Z.x,y0:Z.y,c0:[(a[0]+b[0])/2,(a[1]+b[1])/2]};};
const single=(x,y)=>({type:Z.s>1.01?'pan':'swipe',x,y,zx:Z.x,zy:Z.y,lock:null,trail:[[performance.now(),x]]});
function initGestures(){
  const stage=$('stage'),column=$('column');
  stage.addEventListener('pointerdown',e=>{if(mode==='column')return;  // the strip scrolls natively; its pinch is below
    pts.set(e.pointerId,[e.clientX,e.clientY]);
    try{stage.setPointerCapture(e.pointerId);}catch{}
    if(pts.size===2)gesture=pinchStart('pinch');else if(pts.size===1)gesture=single(e.clientX,e.clientY);});
  stage.addEventListener('pointermove',e=>{if(!pts.has(e.pointerId))return;pts.set(e.pointerId,[e.clientX,e.clientY]);if(!gesture)return;
    if(gesture.type==='pinch'&&pts.size===2){const [a,b]=[...pts.values()],d=Math.hypot(a[0]-b[0],a[1]-b[1]),c=[(a[0]+b[0])/2,(a[1]+b[1])/2];
      const s=Math.min(5,Math.max(1,gesture.s0*d/gesture.d0)),st=stage.getBoundingClientRect(),f=$('frame'),px=gesture.c0[0]-st.left-f.offsetLeft,py=gesture.c0[1]-st.top-f.offsetTop,k=s/gesture.s0;
      Z.s=s;Z.x=px-(px-gesture.x0)*k+(c[0]-gesture.c0[0]);Z.y=py-(py-gesture.y0)*k+(c[1]-gesture.c0[1]);if(s<=1.01){Z.s=1;Z.x=0;Z.y=0;}else clampZoom();applyZoom();}
    else if(gesture.type==='pan'){Z.x=gesture.zx+e.clientX-gesture.x;Z.y=gesture.zy+e.clientY-gesture.y;clampZoom();applyZoom();}
    else if(gesture.type==='swipe'&&!turning){const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;
      if(!gesture.lock&&Math.hypot(dx,dy)>8)gesture.lock=Math.abs(dx)>Math.abs(dy)?'x':'y';
      if(gesture.lock==='x'){gesture.trail.push([performance.now(),e.clientX]);if(gesture.trail.length>6)gesture.trail.shift();
        const edge=dx>0&&cur.page<=0||dx<0&&cur.page>=docOf(cur.doc).pages-1;trackTo(edge?dx*.25:dx,false);}}});
  const end=e=>{if(!pts.has(e.pointerId))return;pts.delete(e.pointerId);if(!gesture)return;
    if(gesture.type==='swipe'&&pts.size===0){const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;
      if(gesture.lock==='x'&&!turning){const [t0,x0]=gesture.trail[0],v=(e.clientX-x0)/Math.max(1,performance.now()-t0);
        if(e.type!=='pointercancel'&&(Math.abs(dx)>stage.clientWidth*.3||Math.abs(dx)>24&&Math.abs(v)>.3&&Math.sign(v)===Math.sign(dx)))turn(dx<0?1:-1);else trackTo(0,true);}
      else if(!gesture.lock)tap(e,false);}
    else if(gesture.type==='pan'&&pts.size===0&&Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)<10)tap(e,Z.s>1.01);
    if(pts.size===0)gesture=null;else if(pts.size===1){const [p]=[...pts.values()];gesture=single(p[0],p[1]);}};
  stage.addEventListener('pointerup',end);stage.addEventListener('pointercancel',end);
  // Strip: two fingers zoom it around their middle (touch events: they keep coming while the strip scrolls natively).
  // The point between the fingers at the start stays between them, whatever the native scroll does meanwhile.
  let pinch=null;
  const mid=t=>[(t[0].clientX+t[1].clientX)/2,(t[0].clientY+t[1].clientY)/2],span=t=>Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);
  column.addEventListener('touchstart',e=>{if(col)col.aim=null;if(e.touches.length!==2||!col)return;if(e.cancelable)e.preventDefault();
    clearTimeout(col.anim);layoutColumn();const r=column.getBoundingClientRect(),[x,y]=mid(e.touches),fx=x-r.left,fy=y-r.top;
    pinch={d0:span(e.touches),z:col.z,fx,fy,c0:[column.scrollLeft+fx,column.scrollTop+fy]};},{passive:false});
  column.addEventListener('touchmove',e=>{if(e.touches.length>1&&e.cancelable)e.preventDefault();if(!pinch||e.touches.length!==2||!col)return;
    const r=column.getBoundingClientRect(),[x,y]=mid(e.touches);pinch.fx=x-r.left;pinch.fy=y-r.top;
    pinch.z=Math.min(ZMAX,Math.max(1,col.z*span(e.touches)/pinch.d0));previewZoom(pinch.z/col.z,pinch.fx,pinch.fy,pinch.c0);},{passive:false});
  const pinchEnd=e=>{if(!pinch||e.touches.length>=2)return;const p=pinch;pinch=null;settleZoom(p.z,p.fx,p.fy,p.c0,true);};
  column.addEventListener('touchend',pinchEnd);column.addEventListener('touchcancel',pinchEnd);
  column.addEventListener('gesturestart',e=>e.preventDefault());  // iOS: no page zoom over the strip
  column.addEventListener('scroll',onColumnScroll,{passive:true});
  // Strip: a double tap zooms in there (×2.5), or back to the whole width.
  column.addEventListener('click',e=>{if(!col)return;const now=performance.now();
    if(now-lastTap<320&&Math.hypot(e.clientX-lastTapXY[0],e.clientY-lastTapXY[1])<30){lastTap=0;zoomColumn(col.z>1.05?1:2.5,e.clientX,e.clientY,true);return;}
    lastTap=now;lastTapXY=[e.clientX,e.clientY];});
  // Trackpad pinch / ctrl + wheel (computers).
  stage.addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();
    if(mode==='column'){if(col)zoomColumn(col.z*Math.exp(-e.deltaY/120),e.clientX,e.clientY,false);return;}
    zoomAt(e.clientX,e.clientY,Math.min(5,Math.max(1,Z.s*(e.deltaY<0?1.15:.87))));},{passive:false});
  stage.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowDown')step(1);if(e.key==='ArrowLeft'||e.key==='ArrowUp')step(-1);});
  addEventListener('resize',()=>{if($('v-page').hidden)return;
    if(mode==='page'){fitImage();resetZoom();}else if(col){layoutColumn();scrollToSlide(cur.page,false);}});
}

// ---------- reader menu ----------
function closeMenu(){$('r-menu').hidden=true;$('r-more').setAttribute('aria-expanded','false');}
function reference(){const d=docOf(cur.doc);return [d.title,[d.source,d.year].filter(Boolean).join(' '),pageLabel(cur.doc,cur.page)].filter(Boolean).join(' — ');}
function showText(){
  const qt=queryTerms(query),t=textOfPage(cur.doc,cur.page),body=$('text-body');
  $('text-title').textContent='Texte — '+pageLabel(cur.doc,cur.page);
  body.replaceChildren(...(t?t.split(/\n+/).filter(s=>s.trim()).map(s=>el('p',{},highlighted(s,qt))):[el('p',{class:'muted'},texts?'Pas de texte pour cette page.':'Texte en cours de chargement…')]));
  $('textsheet').showModal();$('text-body').scrollTop=0;
}

// ---------- Question tab home ----------
const fmtDate=iso=>new Date(iso).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
// One date in the app: the data version (the manifest the phone installed), the same as in « Données et mises à jour ».
let dataDate=null;
function renderFreshness(){const t=dataDate?'Données du '+fmtDate(dataDate):'';for(const n of document.querySelectorAll('.fresh-line'))n.textContent=t;}
function renderHome(){
  const r=store.get(RECENT,[]);$('recent-block').hidden=!r.length;$('first-block').hidden=r.length>0;
  $('recent').replaceChildren(...r.slice(0,4).map(x=>el('button',{type:'button',class:'pill',onclick:()=>{setQ(x.q);submit();}},x.q)));
}

// ---------- Documents tab: Mes pages, Nouveautés, then every document sorted by section, title or date ----------
let docSort=['section','title','date'].includes(store.get(SORT,'section'))?store.get(SORT,'section'):'section',showAllSaved=false;
const openSections=new Set(),NEW='\u0000new';  // open sections, this session only: all closed at launch
const savedRow=p=>{const d=docOf(p.doc);return el('button',{type:'button',class:'row',onclick:()=>openPage(p.doc,p.page,null)},icon('save'),el('span',{class:'body'},el('strong',{},d.title),el('span',{class:'meta'},metaLine(p.doc,p.page,false))),icon('chev'));};
const newTag=id=>info?.added?.includes(id)?'Nouveau':info?.updated?.includes(id)?'Mis à jour':null;
function docRow(d,{tag=null,showDomain=false,note=null}={}){
  const meta=withYear(d,[d.source,d.kind,d.pages+(d.kind==='Diaporama'?' diapos':' p.')]);
  const badges=tag?[el('span',{class:'badge new'},tag)]:[d.status?el('span',{class:'badge '+d.status.level},short(d.status).label):null,d.in_search===false?el('span',{class:'badge info'},'Hors recherche'):null];
  return el('button',{type:'button',class:'row',onclick:()=>openPage(d.id,0,null)},icon('doc'),
    el('span',{class:'body'},el('strong',{},d.title),el('span',{class:'meta'},meta),showDomain&&d.domain?el('span',{class:'meta'},d.domain):null,note?el('span',{class:'meta'},note):null,...badges),icon('chev'));
}
const byTitle=(a,b)=>a.title.localeCompare(b.title,'fr');
function renderDocs(){
  const f=norm($('doc-filter').value.trim());
  for(const b of document.querySelectorAll('[data-sort]'))b.setAttribute('aria-checked',String(b.dataset.sort===docSort));
  // Mes pages
  const pins=saved(),sb=$('doc-saved');sb.hidden=Boolean(f)||!pins.length;
  if(!sb.hidden){const shown=showAllSaved?pins:pins.slice(0,3);
    sb.replaceChildren(...[el('h2',{},'Mes pages'),el('div',{class:'rows'},...shown.map(savedRow)),
      pins.length>3?el('button',{type:'button',class:'link small more',onclick:()=>{showAllSaved=!showAllSaved;renderDocs();}},showAllSaved?'Réduire':'Voir les '+pins.length+' pages'):null].filter(Boolean));}
  // Nouveautés du pack (already first in the date sort)
  const fresh=info?docs.filter(d=>newTag(d.id)):[],nb=$('doc-new');nb.hidden=Boolean(f)||docSort==='date'||!fresh.length;
  if(!nb.hidden){const det=el('details',{class:'section',open:openSections.has(NEW)},el('summary',{},el('span',{},'Nouveaux ou mis à jour'),el('small',{},String(fresh.length))),
    el('div',{class:'rows'},...fresh.sort(byTitle).map(d=>docRow(d,{tag:newTag(d.id),showDomain:true}))));
    det.addEventListener('toggle',()=>{det.open?openSections.add(NEW):openSections.delete(NEW);});nb.replaceChildren(det);}
  // All documents
  const list=docs.filter(d=>!f||norm([d.title,d.domain,d.source,d.filename,d.year].join(' ')).includes(f)),out=[];
  if(docSort==='section'){
    const by=new Map();for(const d of list){const k=d.domain||'Autres';if(!by.has(k))by.set(k,[]);by.get(k).push(d);}
    for(const [dom,items] of [...by].sort((a,b)=>a[0].localeCompare(b[0],'fr'))){
      const det=el('details',{class:'section',open:Boolean(f)||openSections.has(dom)},el('summary',{},el('span',{},dom),el('small',{},String(items.length))),el('div',{class:'rows'},...items.sort(byTitle).map(d=>docRow(d))));
      det.addEventListener('toggle',()=>{if(!f){det.open?openSections.add(dom):openSections.delete(dom);}});out.push(det);}
  }else if(docSort==='title'){
    let letter='';for(const d of list.sort(byTitle)){const l=norm(d.title)[0].toUpperCase();if(l!==letter){letter=l;out.push(el('h2',{class:'group'},l));}out.push(docRow(d,{showDomain:true}));}
  }else{
    const by=new Map();for(const d of list){const k=d.year||0;if(!by.has(k))by.set(k,[]);by.get(k).push(d);}
    for(const [y,items] of [...by].sort((a,b)=>(b[0]||-1)-(a[0]||-1))){out.push(el('h2',{class:'group'},(y||'Sans date')+' · '+items.length+(items.length>1?' documents':' document')));
      for(const d of items.sort(byTitle))out.push(docRow(d,{tag:newTag(d.id),showDomain:true}));}
  }
  // Below the titles: documents that mention the words (or the expanded abbreviation: PNA, IU, PAC…), most mentions first.
  if(f){const seen=new Set(list.map(d=>d.id)),hits=contentHits(f).filter(([d])=>!seen.has(d.id)),first=$('doc-filter').value.trim().split(/\s+/).find(w=>ABBR[norm(w)]||norm(w).length>=3)||'',said=ABBR[norm(first)]||first;
    if(hits.length)out.push(el('h2',{class:'group'},'Dans le contenu · '+hits.length+(hits.length>1?' documents':' document')),
      ...hits.map(([d,n])=>docRow(d,{showDomain:true,note:n+' mention'+(n>1?'s':'')+' de « '+said+' »'})));}
  $('doc-list').replaceChildren(...(out.length?out:[el('p',{class:'muted'},'Aucun document ne correspond.')]));
}
let docText=null;
function contentHits(f){
  if(!texts||!corpus)return [];
  if(!docText){docText=new Map();corpus.rows.forEach((r,i)=>{if(texts[i])docText.set(r.doc,(docText.get(r.doc)||'')+'\n'+norm(texts[i]));});}
  const words=f.split(/\s+/).map(w=>ABBR[w]?norm(ABBR[w]):w).filter(w=>w.length>=3);if(!words.length)return [];
  const out=[];
  for(const d of docs){const t=docText.get(d.id);if(!t||!words.every(w=>t.includes(w)))continue;
    let n=0,k=-1;while((k=t.indexOf(words[0],k+1))>=0)n++;out.push([d,n,words[0]]);}
  return out.sort((a,b)=>b[1]-a[1]);
}

// ---------- navigation (Android Back = history) ----------
function apply(state){
  const view=state?.view||'home',reader=view==='page',tab=view==='docs'?'docs':'question';
  for(const v of ['home','results','docs'])$('v-'+v).hidden=view!==v;
  $('main').hidden=reader;$('v-page').hidden=!reader;$('appbar').hidden=reader||tab==='docs';$('tabs').hidden=reader;
  for(const b of $('tabs').children)b.toggleAttribute('aria-current',b.dataset.tab===tab);
  if(view==='home'||view==='results')lastQuestionView=view;
  document.body.classList.toggle('reading',reader);closeMenu();
  if(view==='home'){renderHome();setQ('');}
  if(view==='results'&&query)setQ(query);
  if(view==='docs')renderDocs();
  if(reader&&(!cur||!cur.shown||cur.doc!==state.doc||cur.page!==state.page||cur.hit!==state.hit))show(state.doc,state.page,state.hit??null);
  else if(reader)renderReader();
  if(!reader&&cur){cur.shown=false;++showTicket;if(col)dropColumn();}  // leaving the reader: free the slides, never show them again stale
  if(!reader)window.scrollTo({top:0});
}
// Tabs keep their place: Question returns to the last results; touching the current Question tab starts a new question.
function openTab(tab){
  const here=history.state?.view==='docs'?'docs':'question';
  if(tab==='docs'){if(here!=='docs')navigate({view:'docs'},'push');return;}
  if(here==='question'||!results.length||lastQuestionView==='home'){navigate({view:'home'},here==='question'?'replace':'push');$('q').focus();return;}
  navigate({view:'results'},'push');
}
function navigate(state,how){if(how==='push')history.pushState(state,'');else history.replaceState(state,'');apply(state);}
addEventListener('popstate',e=>apply(e.state));
window.a2medBack=()=>{
  for(const d of document.querySelectorAll('dialog[open]')){d.close();return true;}
  if(!$('r-menu').hidden){closeMenu();return true;}
  if(history.state?.view&&history.state.view!=='home'){history.back();return true;}
  return false;
};

// ---------- settings ----------
// Light theme only (Arthur, 2026-10-21): no appearance choice; only the text size is a setting.
function applyTheme(){document.documentElement.style.setProperty('--scale',store.get('a2med-textsize','1'));}
function initSettings(){
  $('textsize').value=store.get('a2med-textsize','1');
  $('textsize').onchange=e=>{store.set('a2med-textsize',e.target.value);applyTheme();};
  $('engine-mode').closest('label').hidden=!DEV;$('engine-mode').value=engine.MODE;$('engine-mode').onchange=e=>{engine.setMode(e.target.value);location.reload();};  // the model is loaded (or not) at start
  $('forget').onclick=()=>{if(!confirm('Effacer l’historique des recherches et toutes les pages enregistrées (Mes pages) ?'))return;store.set(RECENT,[]);store.set(SAVED,[]);renderHome();if(history.state?.view==='docs')renderDocs();toast('Historique et Mes pages effacés');};
}

// ---------- wiring ----------
function wire(){
  const q=$('q');
  // Multi-line field: Enter searches (keyboards that insert a line break instead are caught on input); pasted line breaks become spaces.
  q.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();submit();}});
  q.addEventListener('input',e=>{if(q.value.includes('\n')){q.value=q.value.replace(/\s*\n+\s*/g,' ');if(e.inputType==='insertLineBreak'||e.inputType==='insertParagraph'){submit();return;}}assist();});
  q.addEventListener('focus',assist);q.addEventListener('blur',()=>setTimeout(assist,200));
  $('search').addEventListener('submit',e=>{e.preventDefault();submit();});
  $('clear').onclick=()=>{setQ('');q.focus();assist();};
  $('home').onclick=()=>navigate({view:'home'},'push');
  // Sheets (Réglages, page text) close on a tap outside them, like the close button: the backdrop is part of the dialog element.
  for(const d of document.querySelectorAll('dialog'))d.addEventListener('click',e=>{if(e.target===d)d.close();});
  document.addEventListener('click',e=>{
    const tab=e.target.closest('[data-tab]');if(tab)openTab(tab.dataset.tab);
    if(e.target.closest('[data-settings]'))$('settings').showModal();
    if(e.target.closest('[data-back]'))history.back();
    const sort=e.target.closest('[data-sort]');if(sort){docSort=sort.dataset.sort;store.set(SORT,docSort);renderDocs();}
    if(!$('r-menu').hidden&&!e.target.closest('#r-menu,#r-more'))closeMenu();});
  for(const b of document.querySelectorAll('[data-q]'))b.onclick=()=>{setQ(b.dataset.q);submit();};
  $('prev-page').onclick=()=>step(-1);$('next-page').onclick=()=>step(1);$('pageinfo').onclick=jump;
  $('prev-hit').onclick=()=>stepHit(-1);$('next-hit').onclick=()=>stepHit(1);
  $('back-hit').onclick=()=>{const p=results[cur.hit].row;history.replaceState({...history.state,page:p.page},'');show(p.doc,p.page,cur.hit);};
  $('r-save').onclick=toggleSave;
  $('r-status').onclick=e=>{const b=e.currentTarget;b.classList.toggle('open');b.setAttribute('aria-expanded',String(b.classList.contains('open')));};
  $('r-more').onclick=()=>{const m=$('r-menu');m.hidden=!m.hidden;$('r-more').setAttribute('aria-expanded',String(!m.hidden));};
  $('m-text').onclick=()=>{closeMenu();showText();};
  $('m-copy').onclick=async()=>{closeMenu();const ref=reference();try{await navigator.clipboard.writeText(ref);toast('Référence copiée');}catch{toast(ref);}};
  $('m-pdf').onclick=()=>{closeMenu();if(window.a2medDevBridge)toast('Ouverture du PDF complet : sur le téléphone');else Local.openPdf(cur.doc,cur.page);};
  $('doc-filter').addEventListener('input',renderDocs);
  addEventListener('scroll',()=>$('appbar').classList.toggle('scrolled',scrollY>4),{passive:true});
  initGestures();initSettings();
}

// ---------- start ----------
applyTheme();wire();history.replaceState({view:'home'},'');apply({view:'home'});
if(window.a2medDevBridge){const b=el('div',{class:'dev'},'Aperçu Mac · moteur 0.4 (Gemma 1 Q4 512D + BM25)');document.body.append(b);setTimeout(()=>b.style.opacity='0',4000);}
window.runSearch=search;
try{
  // pack-info.json: SPILF check date and the pack's new/updated documents (generated on Sparka into pack/ui/).
  [docs,terms,info]=await Promise.all([fetch(DATA+'docs.json').then(r=>r.ok?r.json():[]).catch(()=>[]),fetch(DATA+'terms.json').then(r=>r.ok?r.json():[]).catch(()=>[]),
    fetch(DATA+'pack-info.json').then(r=>r.ok?r.json():null).catch(()=>null)]);
  dataDate=(await localManifest().catch(()=>null))?.date||info?.pack_date||null;
  renderFreshness();if(history.state?.view==='docs')renderDocs();
  termsNorm=terms.map(t=>norm(t[0]));vocabSet=new Set(termsNorm.flatMap(t=>t.split(/[^\p{L}]+/u)).filter(Boolean));vocab=terms.filter(t=>!t[0].includes(' ')&&t[0].length>=4).map(t=>[t[0],norm(t[0]),t[1]]);
  if(history.state?.view==='home')renderHome();
  engineStatus(engine.MODE==='sparka'?'Recherche sur Sparka : préparation…':'Préparation de la recherche… vous pouvez déjà écrire.');
  corpus=await engine.load(text=>engineStatus(text+' Vous pouvez déjà écrire.'));
  pageRows=new Map();corpus.rows.forEach((r,i)=>{const k=r.doc+':'+r.page;if(!pageRows.has(k))pageRows.set(k,[]);pageRows.get(k).push(i);});
  // Version of the app (number, then the installed shell: the name of its cache) · data date · search model.
  caches.keys().then(k=>{const shell=k.find(n=>n.startsWith('a2med-shell-'))?.slice(12,19);
    $('about').textContent='Version '+VERSION+(shell?' ('+shell+')':'')+(dataDate?' · données du '+fmtDate(dataDate):'')+' · Gemma + BM25';}).catch(()=>{});
  fetch(DATA+'texts.json').then(r=>r.ok?r.json():null).then(t=>{texts=t;if(results.length&&history.state?.view==='results')renderResults(),previewBest();}).catch(()=>{});
  window.startup=engine.state.startup;engineStatus('');
  if(pendingQuery){const q=pendingQuery;pendingQuery=null;$('queued').hidden=true;search(q);}
  if(new URLSearchParams(location.search).has('bench'))runBench();
}catch(e){engineStatus('Recherche indisponible : '+e.message,'error');}
