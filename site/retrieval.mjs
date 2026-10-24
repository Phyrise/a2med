// Lexical scores (BM25), fusion (RRF) and page grouping: used by engine.js and by pipeline/bm25.mjs and search.mjs. No clinical
// rules. Reference ranking unchanged since 002.
export const VERSION='mobile-002-rrf60';
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
