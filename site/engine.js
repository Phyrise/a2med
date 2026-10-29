// Search engine, all on the phone: EmbeddingGemma 300M Q4 (512 dimensions, TC_i8 index) + BM25. The interface only calls
// load() and search(). Ranking, unchanged since 0.3: BM25 (original question) + dense, RRF 1/(61+r) over the top 50, passages
// grouped by page. The question is encoded with Transformers.js 4.3.1 (ORT Web WASM CPU, one thread), in a worker since 0.8.
import {BASE,NS} from './config.js';
import {VERSION as RANKING,lexicalScores,order,fuse,pageResults} from './retrieval.mjs';
import {fixedTokens} from './tokenize.mjs';
import {denseScoresTC} from './dense_tc.mjs';
import {installedSources} from './sources.js';

export const MODEL={id:'embeddinggemma-300m-q4',label:'Gemma 1 Q4 512D',full:768,dims:512,dtype:'q4',
  queryPrefix:'task: search result | query: '};
// Dense index TC_i8 (since 0.7): one int8 vector per row plus vectors for the end of long rows; a row's score = the max over its
// vectors × their scale (dense_tc.mjs). The 0.6 index (vectors-gemma-q4-512.bin) is no longer read since 0.8.6.
const TC_FILES=['vectors-tc-i8.bin','vectors-tc-scale.bin','vectors-tc-rows.bin'];
// Sources (0.9, 29/10/2026): one pack per installed source (sources.js), each with its own BM25 statistics and
// vectors. `corpus` joins their rows (SPILF first, document ids offset), so the app sees one corpus. A search over several sources is
// one RRF over their rows: dense scores side by side (same model), BM25 scores side by side, each from its own source's index
// (mode « fusion-index-separes » of collecte/vlm-spilf/sources, 27/10). A search over the SPILF alone is the one of 0.8.6.
let packs=[],twins=new Map();

let Tensor;  // Transformers.js is loaded on this page only if the worker cannot start

let corpus,tokenizer,model;
export const state={ready:false,corpus:null,bm:null,startup:null};

// progress(f): 0…1 at each step that can be measured (files read, model weights read); the time between is estimated by app.js.
// sources: ids of the installed optional sources; pairs: Map(document id → ids of the same recommendation in another source).
export async function load(status=()=>{},progress=()=>{},{sources=[],pairs=new Map()}={}){
  const t0=performance.now();
  status('Chargement des documents…');
  // The worker loads the model while this page reads the documents (both took turns on one thread before).
  let modelMs=0;const inWorker=loadWorker(progress).then(()=>{modelMs=performance.now()-t0;},
    e=>{worker?.terminate();worker=null;state.worker_error=String(e?.message||e);});
  packs=await Promise.all(installedSources(sources).map(loadPack));twins=pairs;progress(.15);
  let first=0;const rows=[],documents=[];
  for(const p of packs){p.first=first;first+=p.corpus.n;const o=p.source.offset;
    for(const r of p.corpus.rows)rows.push(o?{...r,doc:r.doc==null?r.doc:r.doc+o}:r);
    for(const d of p.corpus.documents)documents.push(o?{...d,id:d.id+o}:d);}
  corpus={n:rows.length,rows,documents,fingerprint:packs[0].corpus.fingerprint,sources:packs.map(p=>p.source.id)};
  state.corpus=corpus;state.bm=packs[0].bm;
  status('Préparation de la recherche…');const t1=performance.now();
  await inWorker;
  if(!worker){await loadHere(progress);modelMs=performance.now()-t1;}
  state.startup={model_ms:modelMs,total_ms:performance.now()-t0,encoder:worker?'worker':'page'};state.ready=true;
  return corpus;
}

// The model runs in a worker (engine-worker.js, 0.8) so that loading it and encoding a question do not freeze the screen. If the
// worker cannot start, this page runs the model itself (state.worker_error says why).
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
// A file stored in parts (data.js, 0.8.2: the model) is joined back into one response, as in sw.js.
async function joined(cache,hit){
  if(!hit?.headers.has('X-Parts'))return hit;
  const parts=await Promise.all(JSON.parse(hit.headers.get('X-Parts')).map(k=>cache.match(k)));if(parts.some(r=>!r))return null;
  const blob=new Blob(await Promise.all(parts.map(r=>r.blob())));
  return new Response(blob,{headers:{'Content-Type':hit.headers.get('Content-Type'),'Content-Length':String(blob.size)}});
}
// ORT Web asks for a shared memory of up to 4 GB, which Safari on iPhone reserves at once and refuses (« RangeError: Out of
// memory », 0.8.3). The model uses 239 MB (Mac, 23/10): 512 MB is enough. Same in engine-worker.js.
function capMemory(){const M=WebAssembly.Memory,MAX=8192;if(M.capped)return;
  const W=function(d){return new M(d?.shared&&d.maximum>MAX?{...d,maximum:MAX}:d);};W.prototype=M.prototype;W.capped=true;WebAssembly.Memory=W;}
async function loadHere(progress){
  capMemory();
  const T=await import('./lib/transformers.web.min.js'),{AutoModel,AutoTokenizer,AutoConfig,env}=T;Tensor=T.Tensor;
  env.allowRemoteModels=false;env.allowLocalModels=true;env.useBrowserCache=false;env.localModelPath=new URL('pack/models/',BASE).pathname;  // a path: Transformers.js joins it like a file path (a full URL loses its //)
  // Model files are read straight from the downloaded data, not through the service worker: Transformers.js fetches the weights
  // twice and leaves one response unread, which kept the old worker busy and held back app updates while the app was open.
  const PACK=BASE+'pack/';
  env.fetch=async(u,o)=>{const url=new URL(String(u),location.href);url.search='';
    if(!url.href.startsWith(PACK))return fetch(u,o);
    const cache=await caches.open(NS+'-data');return (await joined(cache,await cache.match(url.href)))||new Response('Données non installées',{status:404});};
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
// One source's pack under pack/<prefix>: corpus (fingerprint checked), BM25 index, TC_i8 vectors.
// Data installed before 0.7 (pack-005) has no TC_i8 files: the update offered in the app brings them.
async function loadPack(source){
  const at=BASE+'pack/'+source.prefix,r=await Promise.all(TC_FILES.map(f=>fetch(at+f)));
  if(!r.every(x=>x.ok))throw Error('index absent, mettez à jour les données (Réglages)');
  const [c,bm,a,b,e]=await Promise.all([fetch(at+'corpus-meta.json').then(x=>{if(!x.ok)throw Error('Corpus non installé ('+source.label+')');return x.json();}),
    fetch(at+'bm25.json').then(x=>x.json()),...r.map(x=>x.arrayBuffer())]);
  if(c.fingerprint!==source.fingerprint)throw Error('Corpus différent de celui de l’index ('+source.label+')');
  const tc={i8:new Int8Array(a),scale:new Float32Array(b),rows:new Int32Array(e)};
  if(tc.scale.length!==c.n+tc.rows.length||tc.i8.length!==tc.scale.length*MODEL.dims)throw Error('Index vectoriel incomplet ('+source.label+')');
  return {source,corpus:c,bm,tc};
}

// scope: ids of the sources to search (default all installed). Rows of the other sources get no score, so they are left out.
export async function search(q,limit=5,scope=null){
  const times={},begin=performance.now(),on=packs.filter(p=>!scope||scope.includes(p.source.id));
  if(!on.length)throw Error('Aucune source choisie');
  let t=performance.now();const lex=new Float64Array(corpus.n).fill(NaN);
  for(const p of on)lex.set(lexicalScores(q,p.bm),p.first);
  const lexical=order(lex,corpus,true);times.bm25_ms=performance.now()-t;
  t=performance.now();const emb=await encode(q);times.encode_ms=performance.now()-t;
  t=performance.now();const den=new Float32Array(corpus.n).fill(NaN);
  for(const p of on)den.set(denseScoresTC(emb,p.tc.i8,p.tc.scale,p.tc.rows,p.corpus.n,MODEL.dims),p.first);
  const dense=order(den,corpus);times.dense_ms=performance.now()-t;
  const pages=withoutTwins(pageResults(fuse([[dense],[lexical]]),corpus,limit+10)).slice(0,limit);times.retrieval_ms=performance.now()-begin;
  return {pages,times,lexicalHits:lexical.length,ranking:RANKING,model:MODEL.label,sources:on.map(p=>p.source.id)};
}
// The same recommendation published by two societies (SFAR and SRLF sites): only the document ranked first is shown.
function withoutTwins(pages){const shown=new Set();
  return pages.filter(p=>{const d=p.row.doc;if([...(twins.get(d)||[])].some(x=>shown.has(x)))return false;shown.add(d);return true;});}
// Index words that exist in the documents (accented and unaccented forms are both indexed).
const inIndex=w=>packs.some(p=>p.bm.postings[w]);
export const known=w=>inIndex(w.toLowerCase())||inIndex(w.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu,''));
