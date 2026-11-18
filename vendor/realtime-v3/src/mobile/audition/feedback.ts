export type Span=[number,number]
export function addHeard(spans:Span[],from:number,to:number,duration:number):Span[]{
 if(![from,to,duration].every(Number.isFinite)||from<0||to<=from||to-from>1.5||to>duration+.1)return spans
 const rows=[...spans,[Math.max(0,from),Math.min(duration,to)] as Span].sort((a,b)=>a[0]-b[0]),merged:Span[]=[]
 for(const row of rows){const last=merged.at(-1);if(last&&row[0]<=last[1]+.02)last[1]=Math.max(last[1],row[1]);else merged.push([...row])}
 return merged.slice(0,200)
}
export const heardSeconds=(spans:Span[])=>spans.reduce((s,[a,b])=>s+b-a,0)
export function validateRating(value:unknown):number|null{
 if(value===null||value===undefined||value==='')return null
 const n=Number(value);if(!Number.isInteger(n)||n<1||n>5)throw Error('Rating must be 1–5 or unknown')
 return n
}
export function blindOrder<T>(values:T[],seed:number):T[]{
 const out=[...values];let state=seed>>>0
 const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296}
 for(let i=out.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[out[i],out[j]]=[out[j],out[i]]}
 return out
}
