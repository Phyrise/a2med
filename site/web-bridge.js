// Web stand-in for the Android `Local` bridge: PDF pages are rendered in the browser with pdf.js 4.10.38 from the downloaded
// /pack/pdf/<id>.pdf, at the sizes the Android app used (PdfRenderer: 2 px per point up to 1400 px, 3 px per point up to 2200 px for zoom).
// One render at a time (bounded memory on phones); the last 3 opened PDFs stay parsed. Before a queued render starts, the app is
// asked whether the page is still wanted (window.a2medWanted): pages flipped past are skipped, so the page on screen never waits
// behind them. A render still running after 20 s is cancelled, which frees the queue.
import * as pdfjs from './vendor/pdfjs/pdf.min.mjs';
import {BASE} from './config.js';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/pdf.worker.min.mjs',import.meta.url).href;
const VENDOR=new URL('./vendor/pdfjs/',import.meta.url).href;

let documents;const open=new Map(),sizes=new Map();let queue=Promise.resolve();
const docs=async()=>documents||=await fetch(BASE+'pack/documents.json').then(r=>{if(!r.ok)throw Error('Documents non installés');return r.json();});
async function pdf(id){
  if(open.has(id)){const p=open.get(id);open.delete(id);open.set(id,p);return p;}
  const d=(await docs())[id];if(!d||d.id!==id)throw Error('Document inconnu');
  const task=pdfjs.getDocument({url:BASE+'pack/'+d.file,disableRange:true,disableStream:true,disableAutoFetch:true,isEvalSupported:false,
    standardFontDataUrl:VENDOR+'standard_fonts/'});  // no cmaps/ since 0.8.6: all CJK fonts of the corpus are embedded (Identity-H)
  open.set(id,task.promise);task.promise.catch(()=>open.delete(id));
  while(open.size>3){const [k,p]=open.entries().next().value;open.delete(k);p.then(x=>x.destroy()).catch(()=>{});}
  return task.promise;
}

// Renders one page to a PNG blob, with timings: open (PDF parse, first time only), render (pdf.js), encode (PNG).
export function render(id,page,maxWidth=1400,wanted=()=>true){
  const job=queue.then(async()=>{
    if(!wanted())throw Error('Annulé');
    const t0=performance.now(),doc=await pdf(id),t1=performance.now();
    if(page<0||page>=doc.numPages)throw Error('Page hors du document');
    const p=await doc.getPage(page+1),base=p.getViewport({scale:1});
    const w=Math.min(maxWidth,Math.round(base.width*(maxWidth>1400?3:2))),scale=w/base.width,viewport=p.getViewport({scale});
    const h=Math.max(1,Math.round(viewport.height));if(h>(maxWidth>1400?11000:7000))throw Error('Page trop grande');
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
    const task=p.render({canvasContext:ctx,viewport,background:'#fff'}),stop=setTimeout(()=>task.cancel(),20000);
    try{await task.promise;}catch(e){canvas.width=canvas.height=0;p.cleanup();throw e.name==='RenderingCancelledException'?Error('Ouverture trop longue'):e;}
    finally{clearTimeout(stop);}const t2=performance.now();
    const blob=await new Promise((ok,ko)=>canvas.toBlob(b=>b?ok(b):ko(Error('Image impossible')),'image/png'));
    canvas.width=canvas.height=0;p.cleanup();
    return {blob,meta:{ok:true,width:w,height:h,bytes:blob.size,open_ms:Math.round(t1-t0),render_ms:Math.round(t2-t1),encode_ms:Math.round(performance.now()-t2),native_ms:Math.round(performance.now()-t0)}};
  });
  queue=job.catch(()=>{});return job;
}

window.Local={
  renderPage(request,id,page){this.renderPageWidth(request,id,page,1400);},
  renderPageWidth(request,id,page,width){
    render(id,page,Math.max(400,Math.min(2200,width)),()=>window.a2medWanted?.(request)!==false)
      .then(({blob,meta})=>window.a2medPageReady(request,meta,blob))
      .catch(e=>window.a2medPageReady(request,{ok:false,error:e.message},''));
  },
  // Web only: the size of every page (points), for the continuous strip of a PDF (no rendering, page dictionaries only).
  pageSizes(id){return sizes.get(id)||(sizes.set(id,pdf(id).then(async doc=>{const out=[];
    for(let i=1;i<=doc.numPages;i++){const v=(await doc.getPage(i)).getViewport({scale:1});out.push([v.width,v.height]);}return out;}).catch(e=>{sizes.delete(id);throw e;})),sizes.get(id));},
  setDarkBars(dark){document.querySelector('meta[name=theme-color]')?.setAttribute('content',dark?'#0d1317':'#f4f6f8');},
  openPdf(id,page){docs().then(d=>window.open(BASE+'pack/'+d[id].file+'#page='+(page+1),'_blank'));},
};
