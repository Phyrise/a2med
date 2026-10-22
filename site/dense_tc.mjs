// Copied unchanged from model_lab_20261022/candidate_tc_i8/dense_tc.mjs (22/10) for the « urgence » prototype; engine.js calls it.
// Dense scores for arm TC_i8 (model_lab_20261022/RAPPORT.md): one Int8 vector per corpus row, then extra vectors for the end of
// long rows; a row's score is the max over its vectors. Same Gemma query vector as today (512D, L2-normalised).
// i8: Int8Array, scale: Float32Array (one per vector), extraRows: Int32Array (corpus row of each extra vector), n: corpus rows.
export function denseScoresTC(query,i8,scale,extraRows,n,dims=512){
 const scores=new Float32Array(n);
 for(let v=0;v<n+extraRows.length;v++){let x=0;const o=v*dims;for(let j=0;j<dims;j++)x+=query[j]*i8[o+j];x*=scale[v];
  if(v<n)scores[v]=x;else{const r=extraRows[v-n];if(x>scores[r])scores[r]=x;}}
 return scores;
}
