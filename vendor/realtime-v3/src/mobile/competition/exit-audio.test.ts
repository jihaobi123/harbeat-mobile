import {it,expect,vi} from 'vitest'
import {webcrypto} from 'node:crypto'
import {fixture} from '../crossgenre/fixtures'
import {enumerateCrossGenre} from '../crossgenre/planner'
import {exitEffectPlans} from './exit-plans'
import {renderExitExperiment,renderExitLayer,type ExitExperiment} from './exit-experiments'
import {prepareExitAudio,ExitAudioCache} from './exit-audio'
Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true})
const sr=8000
function buffer(channels:Float32Array[]):AudioBuffer{return{sampleRate:sr,numberOfChannels:channels.length,length:channels[0].length,duration:channels[0].length/sr,getChannelData:(c:number)=>channels[c],copyToChannel:(v:Float32Array,c:number)=>channels[c].set(v),copyFromChannel:(v:Float32Array,c:number)=>v.set(channels[c].subarray(0,v.length))} as unknown as AudioBuffer}
function setup(){const a=fixture('a',100),b=fixture('b',140);a.track.sections=[{start:0,end:32,label:'verse'}];b.track.sections=[{start:16,end:120,label:'chorus'}]
 a.track.audioSegments=[{start:0,end:30,asset:{url:'a0',sha256:'a'.repeat(64),bytes:1,duration:30}},{start:30,end:120,asset:{url:'a1',sha256:'b'.repeat(64),bytes:1,duration:90}}];a.track.native=a.track.audioSegments[0].asset
 const ctx:any={sampleRate:sr,createBuffer:(n:number,l:number)=>buffer(Array.from({length:n},()=>new Float32Array(l)))}
 const samples=Float32Array.from({length:sr*120},(_,i)=>.15*Math.sin(i/23)),cache={load:vi.fn(async(asset:any)=>buffer([samples.slice(asset.url==='a0'?0:sr*30,asset.url==='a0'?sr*30:undefined)]))}
 const cut=enumerateCrossGenre(a.track,b.track,a.profile,b.profile,20,30).find(p=>p.family==='structural-cut')!,plans=exitEffectPlans(cut,a.track,b.track)
 return{a,b,ctx,cache,plans,samples}
}
it('shares exactly the desktop exit DSP while retaining only finite outgoing PCM',()=>{
 const a=[Float32Array.from({length:sr*3},(_,i)=>.1*Math.sin(i/13))],b=[new Float32Array(sr)]
 for(const method of ['vinyl-brake','backspin-echo','loop-roll','reverb-out'] as ExitExperiment[]){const layer=renderExitLayer(method,a,sr,100),desktop=renderExitExperiment(method,a,b,sr,100)
  expect(layer.channels[0].length).toBe(sr*3.55);for(let i=0;i<layer.channels[0].length;i+=101)expect(layer.channels[0][i]*.646).toBeCloseTo(desktop.channels[0][i],7)
 }
})
it('loads and joins the exact verified A interval across native segments and records its output fingerprint',async()=>{
 const f=setup(),p=f.plans[0],signal=new AbortController().signal,r=await prepareExitAudio(f.ctx,f.cache,f.a.track,p,signal)
 expect(f.cache.load.mock.calls.map(c=>c[0].url)).toEqual(['a0','a1']);expect(r.buffer.duration).toBe(3.55);expect(r.proof.sourceAssets.map(a=>a.sha256)).toEqual(['a'.repeat(64),'b'.repeat(64)])
 expect(r.proof.outputSha256).toMatch(/^[a-f0-9]{64}$/);expect(r.peakBound).toBeLessThan(.98);expect(f.samples[29*sr]).not.toBe(0)
})
it('rejects missing coverage, changed source, cancelled preparation and excessive effect peaks',async()=>{
 const f=setup(),p=f.plans[0],signal=new AbortController().signal
 f.a.track.audioSegments!.splice(1);await expect(prepareExitAudio(f.ctx,f.cache,f.a.track,p,signal)).rejects.toThrow(/覆盖|分段/)
 const g=setup();g.a.track.provenance!.masterSha256='f'.repeat(64);await expect(prepareExitAudio(g.ctx,g.cache,g.a.track,g.plans[0],signal)).rejects.toThrow(/来源/)
 const c=new AbortController();c.abort();await expect(prepareExitAudio(g.ctx,g.cache,g.a.track,g.plans[0],c.signal)).rejects.toMatchObject({name:'AbortError'})
 const loud=setup();loud.samples.fill(4);await expect(prepareExitAudio(loud.ctx,loud.cache,loud.a.track,loud.plans[0],signal)).rejects.toThrow(/峰值/)
})
it('keeps no more than two prepared exit buffers and cannot reuse a changed fixed descriptor',async()=>{
 const f=setup(),pool=new ExitAudioCache(f.ctx,f.cache),signal=new AbortController().signal
 for(const p of f.plans)await pool.prepare(f.a.track,p,signal)
 expect(pool.size).toBe(2);expect(pool.get(f.plans[0])).toBeUndefined();expect(pool.get(f.plans.at(-1)!)).toBeTruthy()
 expect(pool.get({...f.plans.at(-1)!,entry:17})).toBeUndefined()
})
