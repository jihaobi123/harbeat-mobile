import {afterEach,expect,it,vi} from 'vitest'
import {ReservationEncodedStore,ReservationAudioCache,RESERVATION_CACHE_NAME,RESERVATION_MAX_BYTES} from './reservation-cache'
import {AUDIO_CACHE_NAME,readEncoded,storeEncoded} from '../metric-upstream/realtime/encodedCache'
const bytes=new Uint8Array([1,2,3]).buffer
const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('')
const base=new URL('https://example.test/listen/')
const asset=(id:number)=>({url:`/listen/media/track-${id}.flac`,sha256:sha,bytes:3,duration:10})
const key=(id:number)=>new URL(asset(id).url+'?sha256='+sha,base).href
function disk(){
 const stores=new Map<string,Map<string,Response>>()
 const storage={open:async(name:string)=>{let entries=stores.get(name);if(!entries){entries=new Map();stores.set(name,entries)}return{
  match:async(k:RequestInfo|URL)=>entries!.get(typeof k==='string'?k:k instanceof URL?k.href:k.url)?.clone(),
  keys:async()=>[...entries!.keys()].map(k=>new Request(k)),
  delete:async(k:RequestInfo|URL)=>entries!.delete(typeof k==='string'?k:k instanceof URL?k.href:k.url),
  put:async(k:RequestInfo|URL,r:Response)=>{entries!.set(typeof k==='string'?k:k instanceof URL?k.href:k.url,r.clone())}
 }}}
 return {stores,storage:storage as unknown as CacheStorage}
}
afterEach(()=>vi.unstubAllGlobals())
it('coordinates two reservation stores with the same-origin Web Lock and refreshes their shared index',async()=>{
 const d=disk();let queue:Promise<unknown>=Promise.resolve()
 const request=vi.fn((_name:string,action:()=>Promise<unknown>)=>{const job=queue.catch(()=>{}).then(action);queue=job;return job})
 vi.stubGlobal('navigator',{locks:{request}})
 const one=new ReservationEncodedStore({storage:()=>d.storage,maxFiles:2}),two=new ReservationEncodedStore({storage:()=>d.storage,maxFiles:2})
 await Promise.all([one.budget(),two.budget()])
 await Promise.all([one.write(key(0),bytes),two.write(key(1),bytes),one.write(key(2),bytes),two.write(key(3),bytes)])
 expect(d.stores.get(RESERVATION_CACHE_NAME)?.size).toBe(2)
 expect(await one.read(key(0))).toBeNull();expect(await two.read(key(3))).not.toBeNull()
 expect(request).toHaveBeenCalledTimes(4);expect(request.mock.calls.every(([name])=>name===RESERVATION_CACHE_NAME)).toBe(true)
})
it('keeps more than 256 reserved fragments after ordinary playback evicts its own encoded LRU',async()=>{
 const d=disk();vi.stubGlobal('caches',d.storage)
 const saved=new ReservationEncodedStore({storage:()=>d.storage})
 expect(await saved.budget()).toBe(RESERVATION_MAX_BYTES)
 expect(await saved.budget()).toBeGreaterThan(349*1024*1024)
 for(let i=0;i<300;i++){await saved.write(key(i),bytes);await storeEncoded(key(i),bytes)}
 expect(d.stores.get(RESERVATION_CACHE_NAME)?.size).toBe(300)
 expect(d.stores.get(AUDIO_CACHE_NAME)?.size).toBe(256)
 expect(await readEncoded(key(0))).toBeNull()
 expect(new Uint8Array((await saved.read(key(0)))!)).toEqual(new Uint8Array(bytes))
 const fetcher=vi.fn(async()=>{throw Error('offline')});vi.stubGlobal('fetch',fetcher)
 const ctx={sampleRate:44100,decodeAudioData:vi.fn(async()=>({duration:10,length:10,numberOfChannels:2}))} as unknown as AudioContext
 const audio=new ReservationAudioCache(ctx,base,()=>{},undefined,saved)
 expect((await audio.load(asset(0))).duration).toBe(10);expect(fetcher).not.toHaveBeenCalled()
 expect(await saved.read(key(0))).not.toBeNull();audio.dispose()
})
it('reuses matching PCM without reading reserved bytes again',async()=>{
 const d=disk();vi.stubGlobal('caches',d.storage);vi.stubGlobal('fetch',vi.fn(async()=>new Response(bytes)))
 const read=vi.fn(async()=>null),saved={read,remove:async()=>{}},ctx={sampleRate:44100,decodeAudioData:vi.fn(async()=>({duration:10,length:10,numberOfChannels:2}))} as unknown as AudioContext
 const audio=new ReservationAudioCache(ctx,base,()=>{},undefined,saved)
 const first=await audio.load(asset(0));expect(await audio.load(asset(0))).toBe(first);expect(read).toHaveBeenCalledTimes(1)
 audio.dispose()
})
it('plays existing reserved bytes offline even when ordinary cache writes are rejected',async()=>{
 const d=disk(),saved=new ReservationEncodedStore({storage:()=>d.storage});await saved.write(key(0),bytes)
 vi.stubGlobal('caches',{open:async(name:string)=>{const cache=await d.storage.open(name);return name===AUDIO_CACHE_NAME?{...cache,put:async()=>{throw new DOMException('quota','QuotaExceededError')}}:cache}})
 const fetcher=vi.fn(async()=>{throw Error('offline')});vi.stubGlobal('fetch',fetcher)
 const ctx={sampleRate:44100,decodeAudioData:vi.fn(async()=>({duration:10,length:10,numberOfChannels:2}))} as unknown as AudioContext
 const audio=new ReservationAudioCache(ctx,base,()=>{},undefined,saved)
 try{expect((await audio.load(asset(0))).duration).toBe(10);expect(fetcher).not.toHaveBeenCalled()}finally{audio.dispose()}
})
it('coalesces reserved decoding while cancellation only releases the requesting waiter',async()=>{
 let finish!:(value:AudioBuffer)=>void
 const ctx={sampleRate:44100,decodeAudioData:vi.fn(()=>new Promise<AudioBuffer>(resolve=>finish=resolve))} as unknown as AudioContext
 const audio=new ReservationAudioCache(ctx,base,()=>{},undefined,{read:async()=>bytes.slice(0),remove:async()=>{}}),cancel=new AbortController()
 const first=audio.load(asset(0),cancel.signal),second=audio.load(asset(0)),rejected=expect(first).rejects.toMatchObject({name:'AbortError'})
 await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));cancel.abort();await rejected
 finish({duration:10,length:10,numberOfChannels:2} as AudioBuffer)
 expect((await second).duration).toBe(10);expect(ctx.decodeAudioData).toHaveBeenCalledTimes(1);audio.dispose()
})
it('does not install reserved PCM after disposal and still checks decoded duration',async()=>{
 let finish!:(value:AudioBuffer)=>void
 const ctx={sampleRate:44100,decodeAudioData:vi.fn(()=>new Promise<AudioBuffer>(resolve=>finish=resolve))} as unknown as AudioContext
 const audio=new ReservationAudioCache(ctx,base,()=>{},undefined,{read:async()=>bytes.slice(0),remove:async()=>{}})
 const pending=audio.load(asset(0)),rejected=expect(pending).rejects.toThrow()
 await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));audio.dispose();finish({duration:10,length:10,numberOfChannels:2} as AudioBuffer);await rejected
 expect(audio.ready.size).toBe(0)
 const wrong=new ReservationAudioCache({sampleRate:44100,decodeAudioData:async()=>({duration:9,length:10,numberOfChannels:2})} as unknown as AudioContext,base,()=>{},undefined,{read:async()=>bytes.slice(0),remove:async()=>{}})
 await expect(wrong.load(asset(0))).rejects.toThrow('时长');expect(wrong.ready.size).toBe(0);wrong.dispose()
})
it('bounds dedicated file count, honors free disk quota and rejects quota write failures',async()=>{
 const d=disk(),small=new ReservationEncodedStore({storage:()=>d.storage,maxFiles:2,maxBytes:100,estimate:async()=>({quota:1000,usage:990})})
 expect(await small.budget()).toBe(8)
 for(let i=0;i<3;i++)await small.write(key(i),bytes)
 expect(d.stores.get(RESERVATION_CACHE_NAME)?.size).toBe(2)
 expect(await small.read(key(0))).toBeNull()
 const broken={open:async()=>({keys:async()=>[],match:async()=>undefined,put:async()=>{throw new DOMException('quota','QuotaExceededError')}})} as unknown as CacheStorage
 const rejected=new ReservationEncodedStore({storage:()=>broken})
 await expect(rejected.write(key(0),bytes)).rejects.toThrow('quota')
 expect(await rejected.read(key(0))).toBeNull()
})
it('does not promote corrupt reserved bytes or accept foreign origins and arbitrary paths',async()=>{
 const d=disk();vi.stubGlobal('caches',d.storage)
 const saved=new ReservationEncodedStore({storage:()=>d.storage});await saved.write(key(0),new Uint8Array([9,9,9]).buffer)
 const fetcher=vi.fn(async()=>new Response(bytes));vi.stubGlobal('fetch',fetcher)
 const ctx={sampleRate:44100,decodeAudioData:vi.fn(async()=>({duration:10,length:10,numberOfChannels:2}))} as unknown as AudioContext
 const audio=new ReservationAudioCache(ctx,base,()=>{},undefined,saved)
 await audio.load(asset(0));expect(fetcher).toHaveBeenCalledTimes(1);expect(await saved.read(key(0))).toBeNull()
 await expect(audio.load({...asset(1),url:'https://other.test/listen/media/a.flac'})).rejects.toThrow()
 await expect(saved.write('https://example.test/private?sha256='+sha,bytes)).rejects.toThrow()
 audio.dispose()
})
