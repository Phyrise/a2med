// Preserve the frozen corpus tokenizer's EOS when truncating long inputs.
// Transformers.js 4.3.1 truncates after post-processing; Rust tokenizers retains EOS.
export async function fixedTokens(tokenizer,text,Tensor,maxLength=512){
 const full=await tokenizer(text,{truncation:false,padding:false});
 if(full.input_ids.data.length<=maxLength)return full;
 const ids=Array.from(full.input_ids.data,BigInt),eos=BigInt(tokenizer.eos_token_id);
 if(ids.at(-1)!==eos)throw Error('Expected terminal EOS for the pinned Gemma tokenizers');
 const kept=ids.slice(0,maxLength-1).concat([eos]);
 const out={input_ids:new Tensor('int64',BigInt64Array.from(kept),[1,maxLength]),attention_mask:new Tensor('int64',new BigInt64Array(maxLength).fill(1n),[1,maxLength])};
 if(full.token_type_ids)out.token_type_ids=new Tensor('int64',new BigInt64Array(maxLength),[1,maxLength]);
 return out;
}
