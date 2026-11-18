import {it,expect,vi} from 'vitest'
import {jetsonFixture} from '../jetson-test-fixture'
import {StemPreparation,stemPlanKey,readStemIndex} from './preparation'

async function setup(){
 const f=await jetsonFixture(),source:any={track:f.a},logs:any[]=[],port:any={ctx:{currentTime:0},cache:{},logs,position:0,active:()=>source,tracks:()=>[f.a,f.b],log:(...x:any[])=>logs.push(x),changed:vi.fn()}
 const index:any={schema:'harbeat.execution-library.v1',tracks:[f.result.sourceProof.a,f.result.sourceProof.b].map(s=>({...s,sourceSha256:s.masterSha256,profile:{sha256:s.profileSha256,url:'/listen/execution/profiles/'+s.profileSha256+'.json',bytes:100},assetsReady:true,stemSha256:s.stemSha256})),excluded:[]}
 const result:any={...f.result,execution:{plan:f.p,sourceFingerprints:{a:f.a.provenance,b:f.b.provenance}},decision:{...f.result.decision,recommended:'bass'}}
 return{...f,port,index,result}
}
it('binds ready stem data to exact cue, source and EQ rather than target song alone',async()=>{
 const f=await setup(),key=stemPlanKey(f.a,f.b,f.p)
 expect(stemPlanKey(f.a,f.b,{...f.p,start:f.p.start+1})).not.toBe(key)
 expect(stemPlanKey(f.a,f.b,{...f.p,rate:1.001})).not.toBe(key)
 expect(stemPlanKey({...f.a,provenance:{...f.a.provenance,reportSha256:'e'.repeat(64)}},f.b,f.p)).not.toBe(key)
 const pool=new StemPreparation(f.port,readStemIndex(f.index),new URL('https://test.local/'),async()=>f.result,()=>true,()=>()=>{},()=>{})
 await pool.warm(f.p);expect(pool.ready(f.p)?.decision.recommended).toBe('bass')
 expect(pool.ready({...f.p,start:f.p.start+1})).toBeNull();pool.dispose()
})
it('does not let late cancelled preparation or another source deck become executable',async()=>{
 const f=await setup();let resolve!:(r:any)=>void
 const pool=new StemPreparation(f.port,readStemIndex(f.index),new URL('https://test.local/'),()=>new Promise(r=>resolve=r),()=>true,()=>()=>{},()=>{})
 const task=pool.warm(f.p);for(let i=0;i<5;i++)await Promise.resolve();pool.cancel();resolve(f.result);await task
 expect(pool.ready(f.p)).toBeNull();pool.dispose()
})
it('keeps ordinary readiness available when an approval fails and rejects stale source rows',async()=>{
 const f=await setup(),pool=new StemPreparation(f.port,readStemIndex(f.index),new URL('https://test.local/'),async()=>{throw Error('Jetson unavailable')},()=>true,()=>()=>{},()=>{})
 await pool.warm(f.p);expect(pool.ready(f.p)).toBeNull();expect(pool.snapshot(f.b.id).state).toBe('unavailable')
 const bad=structuredClone(f.index);bad.tracks[0].sourceSha256='e'.repeat(64)
 const prepare=vi.fn(),other=new StemPreparation(f.port,readStemIndex(bad),new URL('https://test.local/'),prepare,()=>true,()=>()=>{},()=>{})
 await other.warm(f.p);expect(prepare).not.toHaveBeenCalled();pool.dispose();other.dispose()
})
it('reports which source is unpublished without labelling it a musical rejection',async()=>{
 const f=await setup();f.index.tracks=f.index.tracks.filter((r:any)=>r.trackId!==f.a.id)
 const prepare=vi.fn(),pool=new StemPreparation(f.port,readStemIndex(f.index),new URL('https://test.local/'),prepare,()=>true,()=>()=>{},()=>{})
 expect(pool.assess(f.p)).toMatchObject({canPrepare:false,code:'source-unpublished',reason:expect.stringContaining('当前歌曲')})
 await pool.warm(f.p);expect(prepare).not.toHaveBeenCalled();expect(pool.snapshot(f.b.id)).toMatchObject({code:'source-unpublished'});pool.dispose()
})
it('retains a winning window and cancels queued preparation before a later job can evict it',async()=>{
 const f=await setup(),waiting=new Map<string,(r:any)=>void>(),prepare=vi.fn((port:any,a:any,b:any,p:any)=>new Promise<any>(resolve=>waiting.set(p.id,resolve)))
 const pool=new StemPreparation(f.port,readStemIndex(f.index),new URL('https://test.local/'),prepare,()=>true,()=>()=>{},()=>{})
 const p1={...f.p,id:'one'},p2={...f.p,id:'two',start:f.p.start+2,end:f.p.end+2},p3={...f.p,id:'three',start:f.p.start+4,end:f.p.end+4}
 const one=pool.warm(p1),two=pool.warm(p2),three=pool.warm(p3)
 await vi.waitFor(()=>expect(waiting.has('one')).toBe(true));waiting.get('one')!(f.result);await one
 await vi.waitFor(()=>expect(waiting.has('two')).toBe(true));pool.retain(p1)
 waiting.get('two')!(f.result);await Promise.all([two,three]);expect(prepare).toHaveBeenCalledTimes(2);expect(pool.ready(p1)).toBe(f.result);expect(pool.ready(p2)).toBeNull();pool.dispose()
})
it('keeps ready alternatives until the selected target assets have loaded successfully',async()=>{
 const f=await setup(),pool=new StemPreparation(f.port,readStemIndex(f.index),new URL('https://test.local/'),async()=>f.result,()=>true,()=>()=>{},()=>{}),p1=f.p,p2={...f.p,start:f.p.start+2,end:f.p.end+2}
 await pool.warm(p1);await pool.warm(p2);pool.retain(p1)
 expect(pool.ready(p2)).toBe(f.result);pool.retain(p2,true);expect(pool.ready(p1)).toBeNull();expect(pool.ready(p2)).toBe(f.result);pool.dispose()
})

it('passes reservation cache-only policy through the production warm path',async()=>{
 const f=await setup();f.port.cachedApprovalOnly=()=>true
 const prepare=vi.fn(async(..._args:any[])=>f.result),pool=new StemPreparation(f.port,readStemIndex(f.index),new URL('https://test.local/'),prepare,()=>true,()=>()=>{},()=>{})
 await pool.warm(f.p)
 expect(prepare.mock.calls[0]?.[6]).toEqual({cachedApprovalOnly:true});pool.dispose()
})
