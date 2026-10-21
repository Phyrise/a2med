// Shared by the Android view and the development benchmarks. No clinical rules. Reference ranking unchanged since 002.
export const VERSION='mobile-002-rrf60';
const STOP=new Set('quel quelle quels quelles est sont le la les un une des de du au aux à dans sur pour par et ou que ce cette ces il elle on en'.split(' '));
export function documentaryQuery(question){
  // Keep the original spans for all remaining words, numbers, operators and units.
  return question.normalize('NFC').replace(/\b[dl][’'](?=\p{L})/giu,' ')
    .replace(/[\p{L}]+/gu,word=>STOP.has(word.toLowerCase())?' ':word)
    .replace(/[?!]/gu,' ').replace(/\s+/gu,' ').trim() || question;
}
export function indexForms(text,bm){
 const low=text.toLowerCase(),tokens=[];let pos=0;
 const escaped=bm.protected.map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
 const regex=new RegExp(escaped.join('|'),'gu');
 for(const match of low.matchAll(regex)){
  if(match.index>pos)tokens.push(...(low.slice(pos,match.index).match(/[\p{L}\p{N}_]+/gu)||[]));
  tokens.push(match[0]);pos=match.index+match[0].length;
 }
 tokens.push(...(low.slice(pos).match(/[\p{L}\p{N}_]+/gu)||[]));
 const out=[];for(const t of tokens){out.push(t);const normalized=t.normalize('NFD').replace(/\p{Mn}/gu,'');if(normalized!==t)out.push(normalized);}return out;
}
export function lexicalScores(question,bm){
 const scores=new Float64Array(bm.n);
 for(const word of new Set(indexForms(question,bm))){
  const p=bm.postings[word];if(!p)continue;const df=p.length/2,idf=Math.log(1+(bm.n-df+.5)/(df+.5));
  for(let i=0;i<p.length;i+=2){const idx=p[i],tf=p[i+1];scores[idx]+=idf*tf*(bm.k1+1)/(tf+bm.k1*(1-bm.b+bm.b*bm.lengths[idx]/bm.avgdl));}
 }return scores;
}
export function order(scores,corpus,positiveOnly=false){
 return corpus.rows.map((_,i)=>i).filter(i=>corpus.rows[i].eligible&&Number.isFinite(scores[i])&&(!positiveOnly||scores[i]>0)).sort((a,b)=>scores[b]-scores[a]||a-b);
}
export function denseOrder(query,vectors,corpus){
 const scores=new Float32Array(corpus.n);
 for(let i=0;i<corpus.n;i++){let value=0;for(let j=0;j<384;j++)value+=query[j]*vectors[i*384+j];scores[i]=value;}
 return order(scores,corpus);
}
export function fuse(groups){
 const values=new Map();
 for(const rankings of groups)for(const ranking of rankings)for(let k=0;k<Math.min(50,ranking.length);k++){
  const i=ranking[k],old=values.get(i)||0;values.set(i,old+1/((61+k)*rankings.length));
 }
 return [...values].sort((a,b)=>b[1]-a[1]||a[0]-b[0]).map(([index,score])=>({index,score}));
}
export function pageResults(ranking,corpus,limit=5){
 const pages=[],seen=new Map();
 for(const hit of ranking){const row=corpus.rows[hit.index];
  if(row.doc==null||!Number.isInteger(row.page)||row.page<0)continue;
  const key=row.doc+':'+row.page;
  if(seen.has(key)){seen.get(key).passages.push(row.pid);continue;}
  const page={...hit,row,passages:[row.pid]};seen.set(key,page);pages.push(page);
 }
 return pages.slice(0,limit);
}
export function rankVariants(original,keywords,dense,extraDense=dense){
 return {original:fuse([[dense],[original]]),keywords:fuse([[dense],[keywords]]),ensemble:fuse([[dense,extraDense],[original,keywords]])};
}
export function sourceLabel(document){return document.source.replace(/\.(pdf|pptx)$/i,'').replace(/[-_]+/g,' ');}
export function location(row,document){return document.source_type==='pptx'?'Diapo '+(row.source_page+1)+' · PDF p. '+(row.page+1):'PDF p. '+(row.page+1);}
// B2, selectable for the doctor trial and never the default: argumentaire ×0.7, title match weighted by title idf, 0.5.
// Coefficients from retrieval-variants-003 (development questions); A vs B2 on pack 45e2c39e: retrieval-variants-003/newpack-20261020.
// Must stay bit-identical to fuse(…,'idf') in newpack-20261020/code/rank_newpack.mjs (tests/parity.mjs).
export const B2_VERSION='b2-arg0.7-titleidf0.5';
const B2_STOP=new Set('quel quelle quels quelles est sont le la les un une des de du au aux à dans sur pour par et ou que qui ce cette ces il elle on en chez avec sans faut faire comment combien peut doit être avant après lors entre plus moins non pas ne'.split(' '));
const b2Words=s=>s.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu,'').split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=3&&!B2_STOP.has(w));
const b2Titles=new WeakMap();
function titleIndex(docs){
 let t=b2Titles.get(docs);if(t)return t;
 const words=docs.map(d=>[...new Set(b2Words(d.title).map(w=>w.slice(0,5)))]),df=new Map();
 for(const list of words)for(const w of list)df.set(w,(df.get(w)||0)+1);
 t={words,idf:w=>Math.log((docs.length+1)/((df.get(w)||0)+.5))};b2Titles.set(docs,t);return t;
}
export function priorB2(fused,question,corpus,docs){
 const T=titleIndex(docs),p=[...new Set(b2Words(question))].map(w=>w.slice(0,5));
 const match=d=>p.length?p.filter(w=>T.words[d].includes(w)).reduce((s,w)=>s+T.idf(w),0)/p.reduce((s,w)=>s+T.idf(w),0):0;
 return fused.map(({index,score})=>{const d=corpus.rows[index].doc;let s=score;if(docs[d].kind==='Argumentaire')s*=.7;s*=1+.5*match(d);return {index,score:s};})
  .sort((a,b)=>b.score-a.score||a.index-b.index);
}
