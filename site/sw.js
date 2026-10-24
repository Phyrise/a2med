// Service worker of A²-Med.
// <scope>/pack/<path> is answered from the downloaded data (Cache Storage 'a2med-data', filled by data.js), so engine.js and app.js
// read their data at /pack/ URLs. The shell (HTML, JS, WASM, pdf.js with its fonts) is one versioned
// cache, always served from the phone: the app starts at once with no network, or a slow one. A new version of the app = a new
// sw.js (stamp_shell.py writes VERSION and FILES): the browser fetches it in the background, the new shell is downloaded whole,
// then replaces the old one at once, so the app never mixes files of two versions. It is used from the next start.
// Storage names: plain 'a2med' at / and /a2med/, 'a2med@<folder>' elsewhere (another app of the same origin), as config.js NS.
const NS=(p=>p==='/'||p==='/a2med/'?'a2med':'a2med@'+p.replace(/^\/|\/$/g,'').replace(/[^a-z0-9]+/gi,'-'))(new URL(self.registration.scope).pathname);
const DATA=NS+'-data';
// stamp_shell.py
const VERSION='488d132d2793',FILES=["./","app.js","boot.js","config.js","data.js","dense_tc.mjs","engine-worker.js","engine.js","icon-192.png","icon-512.png","index.html","lexicon.json","lib/ort-wasm-simd-threaded.mjs","lib/ort-wasm-simd-threaded.wasm","lib/ort.wasm.min.mjs","lib/transformers.web.min.js","manifest.webmanifest","retrieval.mjs","style.css","tokenize.mjs","vendor/pdfjs/LICENSE","vendor/pdfjs/pdf.min.mjs","vendor/pdfjs/pdf.worker.min.mjs","vendor/pdfjs/standard_fonts/FoxitDingbats.pfb","vendor/pdfjs/standard_fonts/FoxitFixed.pfb","vendor/pdfjs/standard_fonts/FoxitFixedBold.pfb","vendor/pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb","vendor/pdfjs/standard_fonts/FoxitFixedItalic.pfb","vendor/pdfjs/standard_fonts/FoxitSerif.pfb","vendor/pdfjs/standard_fonts/FoxitSerifBold.pfb","vendor/pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb","vendor/pdfjs/standard_fonts/FoxitSerifItalic.pfb","vendor/pdfjs/standard_fonts/FoxitSymbol.pfb","vendor/pdfjs/standard_fonts/LICENSE_FOXIT","vendor/pdfjs/standard_fonts/LICENSE_LIBERATION","vendor/pdfjs/standard_fonts/LiberationSans-Bold.ttf","vendor/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf","vendor/pdfjs/standard_fonts/LiberationSans-Italic.ttf","vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf","web-bridge.js"];
const SHELL=NS+'-shell-'+VERSION;

self.addEventListener('install',e=>e.waitUntil(caches.open(SHELL)
  .then(c=>c.addAll(FILES.map(u=>new Request(u,{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys()
  .then(keys=>Promise.all(keys.filter(k=>k.startsWith(NS+'-shell-')&&k!==SHELL).map(k=>caches.delete(k))))
  .then(()=>self.clients.claim())));

// Paths are relative to the scope (the app's folder): / locally, /a2med/ on GitHub Pages.
const SCOPE=new URL(self.registration.scope).pathname;
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=='GET'||url.origin!==location.origin||!url.pathname.startsWith(SCOPE))return;
  const path=url.pathname.slice(SCOPE.length);
  if(path.startsWith('pack/')){e.respondWith(fromData(url.origin+url.pathname));return;}
  if(path.startsWith('data/'))return; // downloads always go to the network
  e.respondWith(shell(e.request));
});

async function fromData(path){
  const cache=await caches.open(DATA),hit=await joined(cache,await cache.match(path));
  return hit||new Response('Données non installées',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8'}});
}
// A file stored in parts (data.js, 0.8.2): its entry lists the parts, joined here into one response (same code in engine.js and
// engine-worker.js, which read the model without this worker).
async function joined(cache,hit){
  if(!hit?.headers.has('X-Parts'))return hit;
  const parts=await Promise.all(JSON.parse(hit.headers.get('X-Parts')).map(k=>cache.match(k)));if(parts.some(r=>!r))return null;
  const blob=new Blob(await Promise.all(parts.map(r=>r.blob())));
  return new Response(blob,{headers:{'Content-Type':hit.headers.get('Content-Type'),'Content-Length':String(blob.size)}});
}
async function shell(request){
  const hit=await (await caches.open(SHELL)).match(request,{ignoreSearch:true});
  return hit||fetch(request);  // not part of the app: network
}
