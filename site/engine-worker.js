// The question encoder in a worker (0.8): the same Transformers.js model, settings and token handling
// as engine.js had on the main thread (ORT Web WASM, one thread), so the screen no longer freezes while the model loads (≈ 6 s on
// the Mac) or encodes a question (≈ 0.5 s). Messages: load {model, pack, models, lib, cache} → progress… then ok;
// encode {text} → the raw 768D sentence embedding (normalised and truncated by engine.js, as before). One message at a time.
import {fixedTokens} from './tokenize.mjs';
let tokenizer,model,Tensor,queue=Promise.resolve();
// ORT Web asks for a shared memory of up to 4 GB, which Safari on iPhone reserves at once and refuses (« RangeError: Out of
// memory », 0.8.3). The model uses 239 MB (Mac, 23/10): 512 MB is enough. Same in engine.js.
{const M=WebAssembly.Memory,MAX=8192;const W=function(d){return new M(d?.shared&&d.maximum>MAX?{...d,maximum:MAX}:d);};W.prototype=M.prototype;WebAssembly.Memory=W;}
// A file stored in parts (data.js, 0.8.2: the model) is joined back into one response, as in sw.js.
async function joined(cache,hit){
  if(!hit?.headers.has('X-Parts'))return hit;
  const parts=await Promise.all(JSON.parse(hit.headers.get('X-Parts')).map(k=>cache.match(k)));if(parts.some(r=>!r))return null;
  const blob=new Blob(await Promise.all(parts.map(r=>r.blob())));
  return new Response(blob,{headers:{'Content-Type':hit.headers.get('Content-Type'),'Content-Length':String(blob.size)}});
}

async function load(m){
  const T=await import('./lib/transformers.web.min.js'),{AutoModel,AutoTokenizer,AutoConfig,env}=T;Tensor=T.Tensor;
  env.allowRemoteModels=false;env.allowLocalModels=true;env.useBrowserCache=false;env.localModelPath=m.models;
  env.fetch=async(u,o)=>{const url=new URL(String(u),self.location.href);url.search='';
    if(!url.href.startsWith(m.pack))return fetch(u,o);
    const cache=await caches.open(m.cache);return (await joined(cache,await cache.match(url.href)))||new Response('Données non installées',{status:404});};
  env.backends.onnx.wasm.wasmPaths=m.lib;env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;
  tokenizer=await AutoTokenizer.from_pretrained(m.model.id,{local_files_only:true});postMessage({id:m.id,progress:.25});
  const config=await AutoConfig.from_pretrained(m.model.id,{local_files_only:true});config.vision_config=config.audio_config=null;
  const weights=x=>{if(x?.status==='progress'&&/\.onnx(_data)?$/.test(x.file||'')&&Number.isFinite(x.progress))postMessage({id:m.id,progress:.25+.45*x.progress/100});};
  model=await AutoModel.from_pretrained(m.model.id,{config,device:'wasm',dtype:m.model.dtype,local_files_only:true,progress_callback:weights});
  return {};
}
async function encode(m){
  const tokens=await fixedTokens(tokenizer,m.prefix+m.text,Tensor),out=await model(tokens);
  return {v:Float32Array.from(out.sentence_embedding.data)};
}
self.onmessage=({data:m})=>{queue=queue.then(async()=>{
  try{const r=await (m.type==='load'?load:encode)(m);postMessage({id:m.id,...r},r.v?[r.v.buffer]:[]);}
  catch(e){postMessage({id:m.id,error:String(e?.message||e)});}});};
