// Search engine behind the final UI, 0.4: Gemma 1 Q4 (embeddinggemma-300m, model_q4) at 512 dimensions + BM25.
// The interface only calls load() and search(). Ranking = 0.3 reference, unchanged: BM25 (original question) + dense,
// RRF 1/(61+r) over the top 50, passages grouped by page. Fusion weights were not tuned on the comparison results.
// Query path = the Pixel smoke of 2026-10-20 (Transformers.js 4.3.1, ORT Web WASM CPU, one thread), in a worker since 23/10.
import {BASE,DEV,NS} from './config.js';
import {VERSION as RANKING,lexicalScores,order,fuse,pageResults} from './retrieval.mjs';
import {fixedTokens} from './tokenize.mjs';
import {denseScoresTC} from './dense_tc.mjs';

export const MODEL={id:'embeddinggemma-300m-q4',label:'Gemma 1 Q4 512D',full:768,dims:512,dtype:'q4',
  queryPrefix:'task: search result | query: ',vectors:BASE+'pack/vectors-gemma-q4-512.bin'};
const FINGERPRINT='45e2c39e21ac7764151a9d98b67ca6aa6302cc2282acd0b9dacb44b38fb01e67';
// Dense index (« urgence » prototype, 22/10): TC_i8 from model_lab_20261022 by default — one int8 vector per row plus vectors for the
// end of long rows, a row's score = the max over its vectors × their scale (dense_tc.mjs). Same model, same query vector, same
// BM25 / RRF / pages. ?index=app keeps the 0.6 index (one float32 vector per row) to compare. If the TC_i8 files are not
// downloaded yet (data update), the 0.6 index is used and state.index says so.
export const INDEX=(()=>{try{return new URLSearchParams(location.search).get('index')==='app'?'app':'tc';}catch{return 'tc';}})();
const TC_FILES=['vectors-tc-i8.bin','vectors-tc-scale.bin','vectors-tc-rows.bin'].map(f=>BASE+'pack/'+f);
let tc=null;

let Tensor;  // Transformers.js is loaded only when the model runs here (not in the 'sparka' mode, nor in the online version)

let corpus,bm,vectors,tokenizer,model;
export const state={ready:false,corpus:null,bm:null,startup:null,index:null};
// Where the question is turned into a vector and ranked: 'device' (default, offline) or 'sparka' (the same files and code run by
// sparka-search-001/server.mjs, reached through /api/; same top 5 on the 172 benchmark questions). Chosen in Réglages, or with
// ?moteur=sparka|appareil (kept). In 'sparka' mode the model is not loaded on the phone. Local server only (DEV).
const KEY='a2med.engine-mode';
export const MODE=!DEV?'device':(()=>{try{const u=new URLSearchParams(location.search).get('moteur');
  if(u)localStorage.setItem(KEY,u==='sparka'?'sparka':'device');return localStorage.getItem(KEY)==='sparka'?'sparka':'device';}catch{return 'device';}})();
export function setMode(m){try{localStorage.setItem(KEY,m);}catch{}}

// progress(f): 0…1 at each step that can be measured (files read, model weights read); the time between is estimated by app.js.
export async function load(status=()=>{},progress=()=>{}){
  const t0=performance.now();
  status('Chargement des documents…');
  // The worker loads the model while this page reads the documents (both took turns on one thread before).
  let modelMs=0;const inWorker=MODE!=='sparka'&&ENCODER==='worker'?loadWorker(progress).then(()=>{modelMs=performance.now()-t0;},
    e=>{worker?.terminate();worker=null;state.worker_error=String(e?.message||e);}):null;
  [corpus,bm,vectors]=await Promise.all([
    fetch(BASE+'pack/corpus-meta.json').then(r=>{if(!r.ok)throw Error('Corpus non installé');return r.json();}),
    fetch(BASE+'pack/bm25.json').then(r=>r.json()),
    MODE==='sparka'?null:loadVectors()]);
  if(corpus.fingerprint!==FINGERPRINT)throw Error('Corpus différent de celui de l’index');progress(.15);
  state.corpus=corpus;state.bm=bm;
  if(MODE==='sparka'){state.startup={model_ms:0,total_ms:performance.now()-t0,mode:MODE};state.ready=true;return corpus;}
  if(tc?tc.scale.length!==corpus.n+tc.rows.length||tc.i8.length!==tc.scale.length*MODEL.dims:vectors.length!==corpus.n*MODEL.dims)throw Error('Index vectoriel incomplet');
  status('Préparation de la recherche…');const t1=performance.now();
  await inWorker;
  if(!worker){await loadHere(progress);modelMs=performance.now()-t1;}
  state.startup={model_ms:modelMs,total_ms:performance.now()-t0,encoder:worker?'worker':'page'};state.ready=true;
  return corpus;
}

// The model runs in a worker (engine-worker.js, prototype « précisions » 23/10) so that loading it and encoding a question no longer
// freeze the screen; ?encodeur=page keeps the 0.7 path (model on the page's thread) to compare. If the worker cannot start, the page
// runs the model as before (state.worker_error says why).
const ENCODER=(()=>{try{return new URLSearchParams(location.search).get('encodeur')==='page'?'page':'worker';}catch{return 'worker';}})();
let worker=null,seq=0;const waiting=new Map();
function call(m,onProgress){return new Promise((res,rej)=>{const id=++seq;waiting.set(id,{res,rej,onProgress});worker.postMessage({...m,id});});}
async function loadWorker(progress){
  worker=new Worker(new URL('./engine-worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data:d})=>{const w=waiting.get(d.id);if(!w)return;if('progress' in d){w.onProgress?.(d.progress);return;}
    waiting.delete(d.id);d.error?w.rej(Error(d.error)):w.res(d);};
  worker.onerror=e=>{e.preventDefault?.();for(const w of waiting.values())w.rej(Error(e.message||'Erreur du fil de calcul'));waiting.clear();};
  await call({type:'load',model:{id:MODEL.id,dtype:MODEL.dtype},pack:BASE+'pack/',models:new URL('pack/models/',BASE).pathname,lib:BASE+'lib/',cache:NS+'-data'},progress);
  progress(1);
}
async function loadHere(progress){
  const T=await import('./lib/transformers.web.min.js'),{AutoModel,AutoTokenizer,AutoConfig,env}=T;Tensor=T.Tensor;
  env.allowRemoteModels=false;env.allowLocalModels=true;env.useBrowserCache=false;env.localModelPath=new URL('pack/models/',BASE).pathname;  // a path: Transformers.js joins it like a file path (a full URL loses its //)
  // Model files are read straight from the downloaded data, not through the service worker: Transformers.js fetches the weights
  // twice and leaves one response unread, which kept the old worker busy and held back app updates while the app was open.
  const PACK=BASE+'pack/';
  env.fetch=async(u,o)=>{const url=new URL(String(u),location.href);url.search='';
    if(!url.href.startsWith(PACK))return fetch(u,o);
    return (await (await caches.open(NS+'-data')).match(url.href))||new Response('Données non installées',{status:404});};
  env.backends.onnx.wasm.wasmPaths=BASE+'lib/';env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;
  tokenizer=await AutoTokenizer.from_pretrained(MODEL.id,{local_files_only:true});progress(.25);
  const config=await AutoConfig.from_pretrained(MODEL.id,{local_files_only:true});config.vision_config=config.audio_config=null;
  const weights=x=>{if(x?.status==='progress'&&/\.onnx(_data)?$/.test(x.file||'')&&Number.isFinite(x.progress))progress(.25+.45*x.progress/100);};
  model=await AutoModel.from_pretrained(MODEL.id,{config,device:'wasm',dtype:MODEL.dtype,local_files_only:true,progress_callback:weights});progress(1);
}

// Matryoshka: first `dims` components of the unit 768D query, L2 renormalised (same as the 512D corpus rows).
export function truncate(v,dims){
  let n=0;for(let j=0;j<dims;j++)n+=v[j]**2;n=Math.sqrt(n);if(!(n>1e-8))throw Error('Invalid norm');
  const out=new Float32Array(dims);for(let j=0;j<dims;j++)out[j]=v[j]/n;return out;
}
export async function encode(text){
  const v=worker?(await call({type:'encode',prefix:MODEL.queryPrefix,text})).v:(await model(await fixedTokens(tokenizer,MODEL.queryPrefix+text,Tensor))).sentence_embedding.data;
  if(v.length!==MODEL.full)throw Error('Sortie du modèle inattendue');
  const n=Math.hypot(...v);if(!Number.isFinite(n)||n<1e-8)throw Error('Invalid norm');
  return truncate(Float32Array.from(v,x=>x/n),MODEL.dims);
}
async function loadVectors(){
  if(INDEX==='tc'){const r=await Promise.all(TC_FILES.map(u=>fetch(u)));
    if(r.every(x=>x.ok)){const [a,b,c]=await Promise.all(r.map(x=>x.arrayBuffer()));
      tc={i8:new Int8Array(a),scale:new Float32Array(b),rows:new Int32Array(c)};state.index='TC_i8';return null;}
    state.index='0.6 (TC_i8 non installé)';}
  else state.index='0.6';
  const r=await fetch(MODEL.vectors);if(!r.ok)throw Error('Index Gemma non installé');return new Float32Array(await r.arrayBuffer());
}
function denseOrder(q,dims){
  if(tc)return order(denseScoresTC(q,tc.i8,tc.scale,tc.rows,corpus.n,dims),corpus);
  const scores=new Float32Array(corpus.n);
  for(let i=0;i<corpus.n;i++){let v=0;const o=i*dims;for(let j=0;j<dims;j++)v+=q[j]*vectors[o+j];scores[i]=v;}
  return order(scores,corpus);
}

export async function search(q,limit=5){
  if(MODE==='sparka')return remote(q,limit);
  const times={},begin=performance.now();
  let t=performance.now();const lexical=order(lexicalScores(q,bm),corpus,true);times.bm25_ms=performance.now()-t;
  t=performance.now();const emb=await encode(q);times.encode_ms=performance.now()-t;
  t=performance.now();const dense=denseOrder(emb,MODEL.dims);times.dense_ms=performance.now()-t;
  const pages=pageResults(fuse([[dense],[lexical]]),corpus,limit);times.retrieval_ms=performance.now()-begin;
  return {pages,times,lexicalHits:lexical.length,ranking:RANKING,model:MODEL.label,index:state.index};
}

// Same answer from Sparka: the pages refer to rows of the same corpus (fingerprint checked), taken from the local copy.
async function remote(q,limit){
  const begin=performance.now();let r;
  try{r=await fetch(BASE+'api/search?'+new URLSearchParams({q,limit}),{cache:'no-store',signal:AbortSignal.timeout?.(20000)});}
  catch{throw Error('Sparka injoignable (réseau)');}
  const out=await r.json().catch(()=>({error:'réponse illisible'}));if(!r.ok)throw Error(out.error||'Sparka : erreur '+r.status);
  if(out.fingerprint!==corpus.fingerprint)throw Error('Sparka n’a pas le même corpus');
  const times={...out.times,server_ms:out.times.retrieval_ms,retrieval_ms:performance.now()-begin};times.network_ms=times.retrieval_ms-times.server_ms;
  return {pages:out.pages.map(p=>({...p,row:corpus.rows[p.index]})),times,lexicalHits:out.lexicalHits,ranking:out.ranking,model:out.model+' (Sparka)'};
}
// Index words that exist in the documents (accented and unaccented forms are both indexed).
export const known=w=>Boolean(bm?.postings[w.toLowerCase()]||bm?.postings[w.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu,'')]);
