import {it,expect} from 'vitest'
import {measuredHalfDouble,onsetSignature,levelDb} from './music'
function track(bpm:number){const provenance={masterSha256:'a'.repeat(64),reportSha256:'b'.repeat(64)},frames=Array.from({length:1000},(_,i)=>({start:i*.05,end:(i+1)*.05,low:i%10===0?-10:-50,rmsDbfs:-20}));return{bpm,provenance,alignment:{source:provenance,bandFrames:frames}} as any}
it('requires measured source-bound accents rather than only a half/double BPM ratio',()=>{
 const a=track(60),b=track(120);expect(measuredHalfDouble(a,b,16,8)?.onsetOverlap).toBeGreaterThan(.95)
 b.alignment.bandFrames.forEach((f:any,i:number)=>f.low=i%10===5?-10:-50);expect(measuredHalfDouble(a,b,16,8)).toBeNull()
 b.alignment.source={...b.provenance,masterSha256:'c'.repeat(64)};expect(onsetSignature(b,8,16)).toBeNull();expect(levelDb(b,8,16)).toBeNull()
})
it('rejects incomplete measured windows',()=>{const t=track(120);t.alignment.bandFrames=t.alignment.bandFrames.slice(0,10);expect(onsetSignature(t,0,8)).toBeNull();expect(levelDb(t,0,8)).toBeNull()})
