// Data download and update for the web app. The host publishes data/manifest.json (three blocks: model, PDF, index; every file
// with its size and sha256). Files are stored in Cache Storage under /pack/<path>, where sw.js serves them to the app; each stored
// file carries its sha256 (X-Sha256), written right before the file is checked and deleted if the check fails.
// First install: files go straight to 'a2med-data' (no double storage); the app starts once the manifest is written last.
// Update: only files whose sha256 changed are fetched into 'a2med-staging', checked, then switched in together, so until the
// last check passes the app keeps using the previous set. An interrupted download resumes where it stopped.
import {BASE} from './config.js';
export const MANIFEST_URL=BASE+'data/manifest.json';const PACK=BASE+'pack/';
const DATA='a2med-data',STAGE='a2med-staging',LOCAL=PACK+'.manifest.json';
const TYPES={json:'application/json',pdf:'application/pdf',txt:'text/plain'};
const type=path=>TYPES[path.split('.').pop()]||'application/octet-stream';
const hex=buf=>[...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
const files=m=>new Map((m?.blocks||[]).flatMap(b=>b.files.map(f=>[f.path,{...f,block:b.id}])));
export const mb=n=>n>=1e9?(n/1e9).toFixed(1).replace('.',',')+' Go':Math.max(1,Math.round(n/1e6))+' Mo';

export async function localManifest(){const r=await (await caches.open(DATA)).match(LOCAL);return r?r.json():null;}
// A slow host gives up after 10 s (the app never waits for it at start, but the update panel does).
export async function remoteManifest(){try{const r=await fetch(MANIFEST_URL,{cache:'no-store',signal:AbortSignal.timeout?.(10000)});return r.ok?await r.json():null;}catch{return null;}}

async function stored(cache){ // path -> sha256 of every data file in this cache
  const out=new Map();
  for(const req of await cache.keys()){if(req.url===LOCAL||!req.url.startsWith(PACK))continue;
    out.set(req.url.slice(PACK.length),(await cache.match(req))?.headers.get('X-Sha256')||'');}
  return out;
}

// What must be fetched to go from the installed data to `remote` (files evicted by the browser count as missing).
export async function plan(local,remote){
  const present=await stored(await caches.open(DATA)),want=files(remote||local);
  const get=[...want.values()].filter(f=>present.get(f.path)!==f.sha256);
  const drop=[...present.keys()].filter(p=>!want.has(p));
  const blocks={};for(const f of get){const b=blocks[f.block]||={files:0,bytes:0};b.files++;b.bytes+=f.bytes;}
  const complete=Boolean(local)&&[...files(local).values()].every(f=>present.get(f.path)===f.sha256); // installed set usable as is
  return {get,drop,blocks,bytes:get.reduce((s,f)=>s+f.bytes,0),complete};
}

// One file as one stream. A file over GitHub's 50 MB warning (the model) is published in parts (f.parts, in order, see
// make_manifest.py), fetched one after the other; the whole file is then checked against its sha256 as any other.
async function download(f,base){
  const get=async path=>{const r=await fetch(new URL(path,base),{cache:'no-store'});if(!r.ok)throw Error(`Téléchargement impossible : ${path} (${r.status})`);return r.body;};
  if(!f.parts)return get(f.path);
  const parts=f.parts.map(x=>x.path);let reader=null;
  return new ReadableStream({async pull(c){
    for(;;){
      if(!reader){if(!parts.length){c.close();return;}reader=(await get(parts.shift())).getReader();}
      const {done,value}=await reader.read();if(!done){c.enqueue(value);return;}reader=null;
    }}});
}
export async function install(p,remote,progress=()=>{}){
  try{await navigator.storage?.persist?.();}catch{}
  const data=await caches.open(DATA),staged=p.complete,target=staged?await caches.open(STAGE):data;
  const base=new URL(remote.base||'files/',new URL(MANIFEST_URL,location.href)),ready=await stored(target);
  const times={download_ms:0,verify_ms:0,commit_ms:0,files:p.get.length,bytes:p.bytes,staged};let done=0;
  for(const f of p.get){
    const key=PACK+f.path;
    if(ready.get(f.path)!==f.sha256){
      let t=performance.now();const r={body:await download(f,base)};
      let got=0;const count=new TransformStream({transform(chunk,c){got+=chunk.byteLength;progress(done+got,p.bytes,f.path);c.enqueue(chunk);}});
      await target.put(key,new Response(r.body.pipeThrough(count),{headers:{'Content-Type':type(f.path),'X-Sha256':f.sha256}}));
      times.download_ms+=performance.now()-t;t=performance.now();
      const buf=await (await target.match(key)).arrayBuffer();
      const ok=buf.byteLength===f.bytes&&hex(await crypto.subtle.digest('SHA-256',buf))===f.sha256;times.verify_ms+=performance.now()-t;
      if(!ok){await target.delete(key);throw Error(`Fichier altéré : ${f.path} — relancez le téléchargement`);}
    }
    done+=f.bytes;progress(done,p.bytes,f.path);
  }
  const t=performance.now();
  if(staged)for(const f of p.get){const key=PACK+f.path;await data.put(key,await target.match(key));}
  for(const path of p.drop)await data.delete(PACK+path);
  await data.put(LOCAL,new Response(JSON.stringify(remote),{headers:{'Content-Type':'application/json'}}));
  if(staged)await caches.delete(STAGE);times.commit_ms=performance.now()-t;
  return times;
}

export async function removeAll(){await caches.delete(STAGE);await caches.delete(DATA);}
export async function storage(){
  const e=await navigator.storage?.estimate?.().catch(()=>null);
  return {usage:e?.usage??null,quota:e?.quota??null,persisted:await navigator.storage?.persisted?.().catch(()=>null)??null};
}
