import {it,expect} from 'vitest'
import {assessAutoRunway,assessContinuation} from './set-continuity'
const track=()=>({id:'b',duration:277.1301587301587,reportId:'report',provenance:{masterSha256:'master',reportSha256:'report-sha',vocalSha256:'vocal'},alignment:{source:{reportId:'report',masterSha256:'master',reportSha256:'report-sha',vocalSha256:'vocal'},bars:Array.from({length:112},(_,i)=>({start:i*2.45,end:(i+1)*2.45,valid:true,beats:[0,1,2,3].map(b=>i*2.45+b*2.45/4)}))}} as any)
it('does not feed a continuous set into the reproduced 22-second song tail',()=>{
 const b=track();expect(assessContinuation(b,255.2)).toMatchObject({allowed:false,code:'continuation-window-unavailable',reserveSeconds:60})
 expect(assessContinuation(b,152.343673)).toMatchObject({allowed:true,code:'continuation-window-ready'})
})
it('requires bound continuous complete bars after the preparation reserve, not just duration',()=>{
 const b=track();b.alignment.bars.forEach((x:any)=>x.valid=false);expect(assessContinuation(b,10).allowed).toBe(false)
 b.alignment.source.reportId='changed';expect(assessContinuation(b,10).allowed).toBe(false)
 expect(assessContinuation(track(),NaN).allowed).toBe(false)
})

it('rejects stale source hashes and malformed alignment without throwing',()=>{for(const change of [(b:any)=>b.provenance.masterSha256='new',(b:any)=>b.alignment={},(b:any)=>b.alignment.bars=[null,{}],(b:any)=>b.alignment.bars[0].beats=null]){const b=track();change(b);if(b.alignment.bars?.[0]?.beats===null)b.alignment.bars=b.alignment.bars.slice(0,1);expect(assessContinuation(b,0).allowed).toBe(false)}})

it('rejects the reported late automatic takeover without requiring beat evidence for the reserve',()=>{
 const b={duration:224.1678} as ReturnType<typeof track>
 expect(assessAutoRunway(b,194.48)).toMatchObject({allowed:false,code:'continuation-runway-too-short',reserveSeconds:60})
 expect(assessAutoRunway(b,155).allowed).toBe(true)
 expect(assessAutoRunway({...b,duration:30},10)).toMatchObject({allowed:true,reserveSeconds:15})
 expect(assessAutoRunway(b,NaN).allowed).toBe(false)
})
