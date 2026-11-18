import {describe,it,expect,vi} from 'vitest'
import {DeviceEntryCache,entryFrames} from './device-entry'
const sha='a'.repeat(64)
function fixture(){const ctx:any={sampleRate:44100};const c=new DeviceEntryCache(ctx,new URL('https://example.test/'),vi.fn());const asset={url:'/ref.flac',sha256:sha,rate:1,duration:4,bytes:44};const t:any={id:'b',provenance:{masterSha256:sha},native:{url:'/native.flac',sha256:sha,duration:30,bytes:100},windows:[{id:'w',start:8,end:12,bars:2,variants:{a:asset}}]};return{c,t,asset}}
describe('device atempo source identity',()=>{
 it('gives generated PCM its own identity without changing published evidence',async()=>{const {c,t,asset}=fixture();const local=await c.register(t);expect(local.windows[0].variants.a.url).toMatch(/^device-entry\//);expect(local.windows[0].variants.a.sha256).not.toBe(sha);expect(t.windows[0].variants.a).toBe(asset);expect(t.native).toBe(local.native);c.dispose()})
 it('uses stable virtual assets across metadata refreshes and separates source versions',async()=>{const {c,t}=fixture();const one=await c.register(t),two=await c.register(structuredClone(t)),other=await c.register({...t,provenance:{masterSha256:'b'.repeat(64)}});expect(one.windows[0].variants.a).toBe(two.windows[0].variants.a);expect(other.windows[0].variants.a.url).not.toBe(one.windows[0].variants.a.url);c.dispose()})
 it('rejects unsupported or incomplete intervals before rendering',()=>{expect(()=>entryFrames({start:8,end:7},4,44100)).toThrow();expect(()=>entryFrames({start:8,end:12},4,48000)).toThrow();expect(entryFrames({start:8,end:12},4,44100)).toEqual({start:352800,end:529200,frames:176400})})
})
it('native playback can read retained reservation bytes without network',async()=>{
 const bytes=new Uint8Array([1,2,3]).buffer,hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('')
 const {reservationEncodedStore}=await import('./reservation-cache'),saved=vi.spyOn(reservationEncodedStore,'read').mockResolvedValue(bytes),fetcher=vi.fn(async()=>{throw Error('offline')});vi.stubGlobal('fetch',fetcher)
 const c=new DeviceEntryCache({sampleRate:44100,decodeAudioData:async()=>({duration:10,length:441000,numberOfChannels:2})} as any,new URL('https://example.test/'),()=>{})
 try{expect((await c.load({url:'/listen/media/source.flac',sha256:hash,bytes:3,duration:10})).duration).toBe(10);expect(fetcher).not.toHaveBeenCalled()}finally{c.dispose();saved.mockRestore();vi.unstubAllGlobals()}
})
it('releases source downloads when the last shared preparation is cancelled',async()=>{
 const {c,t}=fixture();t.native.url='/listen/media/source.flac';t.audioSegments=[{start:0,end:30,asset:t.native}];const local=await c.register(t),controller=new AbortController();let sourceSignal:AbortSignal|undefined
 vi.spyOn((c as any).sourceCache,'load').mockImplementation((_asset:any,signal:any)=>{sourceSignal=signal as AbortSignal;return new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(signal.reason)))})
 const load=c.load(local.windows[0].variants.a,controller.signal),rejected=expect(load).rejects.toMatchObject({name:'AbortError'});for(let i=0;i<10;i++)await Promise.resolve();controller.abort();await rejected;for(let i=0;i<20;i++)await Promise.resolve();expect(sourceSignal?.aborted).toBe(true);expect((c as any).sourcePins.size).toBe(0);c.dispose()
})

it('still fetches SHA-bound public analysis media outside the reservation namespace',async()=>{
 const bytes=new Uint8Array([1,2,3]).buffer,hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join(''),fetcher=vi.fn(async()=>new Response(bytes));vi.stubGlobal('fetch',fetcher)
 const c=new DeviceEntryCache({sampleRate:44100,decodeAudioData:async()=>({duration:10,length:441000,numberOfChannels:2})} as any,new URL('https://example.test/'),()=>{})
 try{expect((await c.load({url:'/api/analysis-lab/media/'+hash,sha256:hash,bytes:3,duration:10})).duration).toBe(10);expect(fetcher).toHaveBeenCalledTimes(1)}finally{c.dispose();vi.unstubAllGlobals()}
})

it('derives source-bound local entries without claiming a remote rendered asset',async()=>{
 const {c,t}=fixture();t.windows[0].variants={};t.windows[0].bars=2
 const local=await c.register(t,[{id:'new-source',bpm:125}]);const asset=local.windows[0].variants['new-source']
 expect(asset.url).toMatch(/^device-entry\//);expect(asset.duration).toBeCloseTo(3.84,8);expect(asset.rate).toBeCloseTo(4/3.84,10)
 expect(asset.sha256).toBe('pending-device-pcm');expect((c as any).entries.get(asset.url).reference).toBeNull();expect(t.windows[0].variants).toEqual({});c.dispose()
})
it('preserves published entry geometry and excludes unsupported source tempo targets',async()=>{
 const {c,t,asset}=fixture();const local=await c.register(t,[{id:'a',bpm:125},{id:'too-fast',bpm:200},{id:'too-slow',bpm:50}])
 expect((c as any).entries.get(local.windows[0].variants.a.url).reference).toBe(asset);expect(Object.keys(local.windows[0].variants)).toEqual(['a']);c.dispose()
})
it('refuses derived windows without master identity',async()=>{
 const {c,t}=fixture();delete t.provenance
 await expect(c.register(t,[{id:'x',bpm:125}])).rejects.toThrow(/来源/);c.dispose()
})

function bodyFixture(){
 const {c,t}=fixture(),sr=44100
 t.duration=90;t.native={...t.native,url:'/n0.flac'};t.audioSegments=[0,1,2].map(i=>({start:i*30,end:(i+1)*30,asset:{...t.native,url:`/n${i}.flac`}}));t.windows[0].start=25;t.windows[0].end=29
 const buffer=(frames:number)=>{const channels=[new Float32Array(frames),new Float32Array(frames)];return {duration:frames/sr,sampleRate:sr,length:frames,numberOfChannels:2,getChannelData:(c:number)=>channels[c]}}
 ;(c as any).context.createBuffer=(_channels:number,frames:number)=>buffer(frames)
 const process=vi.spyOn(c as any,'process').mockImplementation(async(_pcm:any,_rate:any,frames:any)=>new Float32Array(Number(frames)*2).buffer)
 const native=()=>buffer(sr*30),put=(asset:any)=>c.pool.put(asset.url,`${new URL(asset.url,'https://example.test/')}|${asset.sha256}|30|44100`,native() as any)
 return {c,t,process,put}
}
it('waits for source body runway before exposing an entry near a native chunk boundary',async()=>{
 const {c,t,process,put}=bodyFixture(),local=await c.register(t),entry=local.windows[0].variants.a;let release:()=>void=()=>{}
 const source=vi.spyOn((c as any).sourceCache,'load').mockImplementation((asset:any)=>asset.url==='/n1.flac'?new Promise(resolve=>{release=()=>resolve(put(asset))}):Promise.resolve(put(asset)))
 c.protected.add(entry.url);let ready=false;const load=c.load(entry).then(v=>{ready=true;return v})
 for(let i=0;i<20;i++)await Promise.resolve()
 expect(source.mock.calls.map(([a]:any)=>a.url)).toContain('/n1.flac');expect(ready).toBe(false);expect(process).not.toHaveBeenCalled();expect(c.ready.has(entry.url)).toBe(false)
 release();await load;expect(c.ready.has(entry.url)).toBe(true);expect((c as any).sourceCache.protected.has('/n1.flac')).toBe(true)
 c.pool.delete('/n1.flac');expect(c.ready.has(entry.url)).toBe(false);expect(c.buffers.has(entry.url)).toBe(true)
 source.mockImplementation((asset:any)=>Promise.resolve(put(asset)));await c.load(entry);expect(c.ready.has(entry.url)).toBe(true);expect(process).toHaveBeenCalledTimes(1)
 c.protected.clear();void c.ready;expect((c as any).sourceCache.protected.size).toBe(0);c.dispose()
})
it('cancelled body preparation releases downloads without marking the entry ready',async()=>{
 const {c,t,process,put}=bodyFixture(),local=await c.register(t),controller=new AbortController();let pending:AbortSignal|undefined
 vi.spyOn((c as any).sourceCache,'load').mockImplementation((asset:any,signal:any)=>asset.url==='/n1.flac'?new Promise((_resolve,reject)=>{pending=signal;signal.addEventListener('abort',()=>reject(signal.reason))}):Promise.resolve(put(asset)))
 const load=c.load(local.windows[0].variants.a,controller.signal),rejected=expect(load).rejects.toMatchObject({name:'AbortError'})
 for(let i=0;i<20;i++)await Promise.resolve();expect(pending).toBeDefined();controller.abort();await rejected
 for(let i=0;i<20;i++)await Promise.resolve();expect(pending?.aborted).toBe(true);expect((c as any).sourcePins.size).toBe(0);expect(c.ready.has(local.windows[0].variants.a.url)).toBe(false);expect(process).not.toHaveBeenCalled();c.dispose()
})
it('cancels sibling body subscriptions after a cached entry reload fails',async()=>{
 const {c,t,put}=bodyFixture(),local=await c.register(t),entry=local.windows[0].variants.a
 const source=vi.spyOn((c as any).sourceCache,'load').mockImplementation((asset:any)=>Promise.resolve(put(asset)))
 await c.load(entry);c.pool.delete('/n0.flac');c.pool.delete('/n1.flac')
 let pending:AbortSignal|undefined
 source.mockImplementation((asset:any,signal:any)=>asset.url==='/n0.flac'?Promise.reject(Error('503')):new Promise((_resolve,reject)=>{pending=signal;signal.addEventListener('abort',()=>reject(signal.reason))}))
 try{await expect(c.load(entry)).rejects.toThrow('503');expect(pending?.aborted).toBe(true);expect((c as any).sourcePins.size).toBe(0);expect(c.ready.has(entry.url)).toBe(false)}finally{c.dispose()}
})
