import {it,expect,vi} from 'vitest'
import {AudioBufferPool,AudioCache} from '../../listen-upstream/realtime/cache'
import {canonicalJson} from '../jetson-contract'
import {LiveCatalog} from './live-catalog'
import {liveFixture,liveTracks} from './live-fixture'
import {returnFixture} from './return-fixture'
const ctx={sampleRate:44100} as AudioContext,base=new URL('https://appassets.androidplatform.net/listen/'),signal=()=>new AbortController().signal
const encoded=(v:any)=>new TextEncoder().encode(JSON.stringify(v)).buffer
async function hash(b:ArrayBuffer){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('')}
async function setup(outcome:'takeover-b'|'return-a'='takeover-b',continuation?:any){
 const live=outcome==='return-a'?returnFixture():liveFixture(),tracks=liveTracks(live);live.sceneSha256=await hash(new TextEncoder().encode(canonicalJson(live.scene)).buffer)
 const bytes=encoded(live),sha=await hash(bytes),entry={id:live.id,sha256:sha,url:(outcome==='return-a'?'/listen/longmix-return/v1/':'/listen/longmix-live/v1/')+sha+'.json',from:tracks.a.id,to:tracks.b.id,sceneSha256:live.sceneSha256,sourcePosition:40}
 const pool=new AudioBufferPool(),shared=new AudioCache(ctx,base,()=>{},pool),read=vi.fn(async(path:string)=>path.endsWith('index.json')?encoded({schema:'harbeat.live-layering-index.v1',scenes:[entry]}):bytes),pcm:any={aMaster:{},bMaster:{},a:{},b:{}},prepare=vi.fn(async(_scene:any,_ctx:any,_cache:any,_base:any,_variant:any,_signal:any)=>pcm),loadBody=vi.fn(async(asset:any)=>({length:Math.round(asset.duration*44100),sampleRate:44100,numberOfChannels:2,duration:asset.duration} as AudioBuffer))
 if(outcome==='return-a')read.mockImplementation(async(path:string)=>path.endsWith('index.json')?encoded({schema:'harbeat.live-layering-return-index.v1',scenes:[entry]}):bytes)
 const catalog=new LiveCatalog(ctx,shared,base,{read,prepare,loadBody},outcome,continuation);await catalog.load(signal());return{live,tracks,entry,pool,shared,read,pcm,prepare,loadBody,catalog}
}
it('selects a shorter already-approved exit when the final native continuation is too late',async()=>{
 const f=await setup('return-a',(_t:any,pos:number)=>({allowed:pos<=60,reason:'下一跳准备空间不足'})),r=await f.catalog.prepare(f.entry,f.tracks.a,f.tracks.b,()=>10,signal());expect(r.exits?.map(e=>e.at)).toEqual([20]);r.release()
})
it('prepares only native A continuation chunks for returning; B remains the attached identity',async()=>{
 const f=await setup('return-a');f.tracks.a.audioSegments=[{start:0,end:65,asset:{...f.tracks.a.native,url:'/A-1',duration:65}},{start:65,end:120,asset:{...f.tracks.a.native,url:'/A-2',duration:55}}];f.tracks.a.native=f.tracks.a.audioSegments[0].asset
 const r=await f.catalog.prepare(f.entry,f.tracks.a,f.tracks.b,()=>10,signal());expect(r.target.id).toBe(f.tracks.a.id);expect([...r.bodyBuffers.keys()]).toEqual(['/A-1','/A-2']);expect(f.read.mock.calls[0][0]).toBe('/listen/longmix-return/v1/index.json');r.release()
})
it('filters to source-bound, scoped, future candidates without loading unrelated scenes',async()=>{
 const f=await setup();expect(f.catalog.candidates(f.tracks.a,[f.tracks.b],10)).toEqual([f.entry]);expect(f.catalog.candidates(f.tracks.a,[],10)).toEqual([]);expect(f.catalog.candidates(f.tracks.a,[f.tracks.b],39.8)).toEqual([]);expect(f.read).toHaveBeenCalledTimes(1)
})
it('prepares stems and every native exit body before returning ready and releases its own pins',async()=>{
 const f=await setup();f.tracks.b.audioSegments=[{start:0,end:50,asset:{...f.tracks.b.native,url:'/body1',duration:50}},{start:50,end:120,asset:{...f.tracks.b.native,url:'/body2',duration:70}}];f.tracks.b.native=f.tracks.b.audioSegments[0].asset
 const result=await f.catalog.prepare(f.entry,f.tracks.a,f.tracks.b,()=>10,signal());expect(result.pcm).toBe(f.pcm);expect([...result.bodyBuffers.keys()]).toEqual(['/body1','/body2']);expect(f.prepare).toHaveBeenCalledTimes(1)
 const owner=[...f.pool.owners].find(x=>x!==f.shared)!;expect(owner.protected.size).toBe(2);result.release();expect(owner.protected.size).toBe(0);f.catalog.dispose();expect(f.pool.owners.size).toBe(1)
})
it('cannot install PCM after cancellation or a missed source anchor',async()=>{
 for(const cancel of [true,false]){const f=await setup();let release!:()=>void;f.prepare.mockImplementationOnce(()=>new Promise<any>(r=>release=()=>r(f.pcm)));let pos=10;const c=new AbortController(),task=f.catalog.prepare(f.entry,f.tracks.a,f.tracks.b,()=>pos,c.signal);await vi.waitFor(()=>expect(release).toBeTypeOf('function'));cancel?c.abort():pos=40;release();await expect(task).rejects.toThrow();expect([...f.pool.owners].find(x=>x!==f.shared)!.protected.size).toBe(0)}
})
it('rejects changed embedded scene contents even when the outer object hash is recomputed',async()=>{
 const f=await setup(),altered=structuredClone(f.live);altered.scene.sourceGains.a=1.2;const bytes=encoded(altered),sha=await hash(bytes),entry={...f.entry,sha256:sha,url:'/listen/longmix-live/v1/'+sha+'.json'};f.read.mockResolvedValueOnce(bytes)
 await expect(f.catalog.prepare(entry,f.tracks.a,f.tracks.b,()=>10,signal())).rejects.toThrow(/指纹/);expect(f.prepare).not.toHaveBeenCalled()
})
it('refuses combined protected playback and scene memory before allocating or loading body PCM',async()=>{
 const f=await setup();f.shared.protected.add('playing');f.pool.buffers.set('playing',{length:17*1024*1024,numberOfChannels:2} as AudioBuffer)
 await expect(f.catalog.prepare(f.entry,f.tracks.a,f.tracks.b,()=>10,signal())).rejects.toThrow(/内存/);expect(f.prepare).not.toHaveBeenCalled();expect(f.loadBody).not.toHaveBeenCalled()
})
it('preserves every other cache owner protection during scene preparation and releases none of them',async()=>{
 const f=await setup();f.shared.protected.add('current-A');let seen=false
 f.prepare.mockImplementationOnce(async(_v:any,_ctx:any,cache:any)=>{seen=cache.protected.has('current-A');f.shared.protected.add('new-stream-segment');expect(cache.protected.has('new-stream-segment')).toBe(true);return f.pcm})
 const r=await f.catalog.prepare(f.entry,f.tracks.a,f.tracks.b,()=>10,signal());r.release();expect(seen).toBe(true);expect(f.shared.protected.has('current-A')).toBe(true);expect(f.shared.protected.has('new-stream-segment')).toBe(true)
})
it('evicts only unprotected decoded cache entries before reserving the separate scene workspace',async()=>{
 const f=await setup();f.pool.buffers.set('old-unprotected',{length:21*1024*1024,numberOfChannels:2} as AudioBuffer)
 f.prepare.mockImplementationOnce(async()=>{expect(f.pool.buffers.has('old-unprotected')).toBe(false);return f.pcm})
 const r=await f.catalog.prepare(f.entry,f.tracks.a,f.tracks.b,()=>10,signal());r.release()
})
it('keeps scene workspace reserved against later puts by ordinary cache owners and restores it on release',async()=>{
 const f=await setup(),original=f.pool.limit,r=await f.catalog.prepare(f.entry,f.tracks.a,f.tracks.b,()=>10,signal());expect(f.pool.limit).toBeLessThan(original)
 const other=new AudioCache(ctx,base,()=>{},f.pool);expect(()=>f.pool.put('too-large','id',{length:Math.floor(f.pool.limit/8)+1,numberOfChannels:2} as AudioBuffer)).toThrow(/内存/)
 const idle=new LiveCatalog(ctx,f.shared,base);idle.dispose();expect(f.pool.limit).toBeLessThan(original)
 r.release();expect(f.pool.limit).toBe(original);r.release();expect(f.pool.limit).toBe(original);other.dispose()
})
it('reserves workspace before awaiting native bodies while preserving playback and the ready escape',async()=>{
 const f=await setup(),original=f.pool.limit,other=new AudioCache(ctx,base,()=>{},f.pool)
 for(const key of ['playing','escape']){f.shared.protected.add(key);f.pool.buffers.set(key,{length:1024,numberOfChannels:2} as AudioBuffer)}
 let release!:()=>void
 f.loadBody.mockImplementationOnce(()=>new Promise<AudioBuffer>(resolve=>release=()=>resolve({length:Math.round(f.tracks.b.native.duration*44100),sampleRate:44100,numberOfChannels:2,duration:f.tracks.b.native.duration} as AudioBuffer)))
 const pending=f.catalog.prepare(f.entry,f.tracks.a,f.tracks.b,()=>10,signal())
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'))
 expect(f.pool.limit).toBeLessThan(original)
 other.protected.add('speculative')
 expect(()=>f.pool.put('speculative','id',{length:Math.floor(original/8)-2048,numberOfChannels:2} as AudioBuffer)).toThrow(/内存/)
 for(const key of ['playing','escape'])expect(f.pool.buffers.has(key)).toBe(true)
 release();const ready=await pending;ready.release();expect(f.pool.limit).toBe(original)
 const second=await f.catalog.prepare(f.entry,f.tracks.a,f.tracks.b,()=>10,signal());second.release();expect(f.pool.limit).toBe(original);other.dispose()
})
