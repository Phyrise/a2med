// Search engine behind the final UI, 0.4: Gemma 1 Q4 (embeddinggemma-300m, model_q4) at 512 dimensions + BM25.
// The interface only calls load() and search(). Ranking = 0.3 reference, unchanged: BM25 (original question) + dense,
// RRF 1/(61+r) over the top 50, passages grouped by page. Fusion weights were not tuned on the comparison results.
// Query path = the Pixel smoke of 2026-10-20 (Transformers.js 4.3.1, ORT Web WASM CPU, one thread, main thread).
import {BASE,DEV} from './config.js';
import {VERSION as RANKING,lexicalScores,order,fuse,pageResults} from './retrieval.mjs';
import {fixedTokens} from './tokenize.mjs';

export const MODEL={id:'embeddinggemma-300m-q4',label:'Gemma 1 Q4 512D',full:768,dims:512,dtype:'q4',
  queryPrefix:'task: search result | query: ',vectors:BASE+'pack/vectors-gemma-q4-512.bin'};
const FINGERPRINT='45e2c39e21ac7764151a9d98b67ca6aa6302cc2282acd0b9dacb44b38fb01e67';

let Tensor;  // Transformers.js is loaded only when the model runs here (not in the 'sparka' mode, nor in the online version)

let corpus,bm,vectors,tokenizer,model;
export const state={ready:false,corpus:null,bm:null,startup:null};
// Where the question is turned into a vector and ranked: 'device' (default, offline) or 'sparka' (the same files and code run by
// sparka-search-001/server.mjs, reached through /api/; same top 5 on the 172 benchmark questions). Chosen in Réglages, or with
// ?moteur=sparka|appareil (kept). In 'sparka' mode the model is not loaded on the phone. Local server only (DEV).
const KEY='a2med.engine-mode';
export const MODE=!DEV?'device':(()=>{try{const u=new URLSearchParams(location.search).get('moteur');
  if(u)localStorage.setItem(KEY,u==='sparka'?'sparka':'device');return localStorage.getItem(KEY)==='sparka'?'sparka':'device';}catch{return 'device';}})();
export function setMode(m){try{localStorage.setItem(KEY,m);}catch{}}

export async function load(status=()=>{}){
  const t0=performance.now();
  status('Chargement des documents…');
  [corpus,bm,vectors]=await Promise.all([
    fetch(BASE+'pack/corpus-meta.json').then(r=>{if(!r.ok)throw Error('Corpus non installé');return r.json();}),
    fetch(BASE+'pack/bm25.json').then(r=>r.json()),
    MODE==='sparka'?null:fetch(MODEL.vectors).then(r=>{if(!r.ok)throw Error('Index Gemma non installé');return r.arrayBuffer();}).then(b=>new Float32Array(b))]);
  if(corpus.fingerprint!==FINGERPRINT)throw Error('Corpus différent de celui de l’index');
  state.corpus=corpus;state.bm=bm;
  if(MODE==='sparka'){state.startup={model_ms:0,total_ms:performance.now()-t0,mode:MODE};state.ready=true;return corpus;}
  if(vectors.length!==corpus.n*MODEL.dims)throw Error('Index vectoriel incomplet');
  status('Préparation de la recherche…');const t1=performance.now();
  const T=await import('./lib/transformers.web.min.js'),{AutoModel,AutoTokenizer,AutoConfig,env}=T;Tensor=T.Tensor;
  env.allowRemoteModels=false;env.allowLocalModels=true;env.useBrowserCache=false;env.localModelPath=new URL('pack/models/',BASE).pathname;  // a path: Transformers.js joins it like a file path (a full URL loses its //)
  env.backends.onnx.wasm.wasmPaths=BASE+'lib/';env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;
  tokenizer=await AutoTokenizer.from_pretrained(MODEL.id,{local_files_only:true});
  const config=await AutoConfig.from_pretrained(MODEL.id,{local_files_only:true});config.vision_config=config.audio_config=null;
  model=await AutoModel.from_pretrained(MODEL.id,{config,device:'wasm',dtype:MODEL.dtype,local_files_only:true});
  state.startup={model_ms:performance.now()-t1,total_ms:performance.now()-t0};state.ready=true;
  return corpus;
}

// Matryoshka: first `dims` components of the unit 768D query, L2 renormalised (same as the 512D corpus rows).
export function truncate(v,dims){
  let n=0;for(let j=0;j<dims;j++)n+=v[j]**2;n=Math.sqrt(n);if(!(n>1e-8))throw Error('Invalid norm');
  const out=new Float32Array(dims);for(let j=0;j<dims;j++)out[j]=v[j]/n;return out;
}
export async function encode(text){
  const tokens=await fixedTokens(tokenizer,MODEL.queryPrefix+text,Tensor),out=await model(tokens),v=out.sentence_embedding.data;
  if(v.length!==MODEL.full)throw Error('Sortie du modèle inattendue');
  const n=Math.hypot(...v);if(!Number.isFinite(n)||n<1e-8)throw Error('Invalid norm');
  return truncate(Float32Array.from(v,x=>x/n),MODEL.dims);
}
function denseOrder(q,dims){
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
  return {pages,times,lexicalHits:lexical.length,ranking:RANKING,model:MODEL.label};
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
