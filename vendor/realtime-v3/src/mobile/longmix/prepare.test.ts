import {afterEach,describe,it,expect,vi} from 'vitest'
import {prepareScene,sliceSceneSource,verifySceneSources,stretchSceneInputs} from './prepare'
import {fixture} from './fixture'
import {sceneBytes,type Scene} from './contract'
import type {AudioCache} from '../../listen-upstream/realtime/cache'
import type {Track} from '../../listen-upstream/realtime/planner'
class Buffer {
 readonly channels:Float32Array[]
 constructor(readonly numberOfChannels:number,readonly length:number,readonly sampleRate:number){this.channels=Array.from({length:numberOfChannels},()=>new Float32Array(length))}
 get duration(){return this.length/this.sampleRate}
 getChannelData(c:number){return this.channels[c]}
 copyToChannel(data:Float32Array,c:number){this.channels[c].set(data)}
}
const context=(sampleRate=44100)=>({sampleRate,createBuffer:(channels:number,n:number,sr:number)=>new Buffer(channels,n,sr)}) as unknown as AudioContext
let fixtureNumber=0
const signal=()=>new AbortController().signal,hash=(c:string)=>c.repeat(64),base=new URL('https://appassets.androidplatform.net/')
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()})
async function sources(){
 const scene=fixture() as Scene,tracks:Track[]=[],manifests:any[]=[],responses=new Map<string,unknown>()
 fixtureNumber++
 for(const [side,letter] of [['a','a'],['b','b']] as const){
  const proof=scene.sources[side];proof.runId='run-'+fixtureNumber;proof.masterSha256=hash(letter);proof.reportSha256=hash('c');proof.vocalSha256=hash('4');proof.stemSha256={drums:hash('1'),bass:hash('2'),other:hash('3'),vocals:hash('4')}
  const native={url:`/listen/media/${side}.flac`,sha256:proof.masterSha256,bytes:100,duration:80}
  const track={id:proof.trackId,title:side,bpm:96,style:'test',duration:80,native,bars:[],windows:[],provenance:{masterSha256:proof.masterSha256,reportSha256:proof.reportSha256,vocalSha256:proof.vocalSha256,runId:proof.runId}} as unknown as Track
  const stems=Object.fromEntries(Object.entries(proof.stemSha256).map(([role,sha])=>[role,{sourceSha256:sha,segments:Array.from({length:5},(_,i)=>({start:i*16,end:(i+1)*16,startFrame:i*16*44100,endFrame:(i+1)*16*44100,asset:{url:`/listen/execution-media/${sha}.flac`,sha256:sha,bytes:100,duration:16,sampleRate:44100,channels:2,frames:16*44100}}))}]))
  const profile={schema:'harbeat.execution-profile.v1',trackId:proof.trackId,runId:proof.runId,sourceSha256:proof.masterSha256,reportSha256:proof.reportSha256,manifestSha256:proof.manifestSha256,stems:Object.fromEntries(Object.entries(stems).map(([r,s])=>[r,{sourceSha256:s.sourceSha256}]))}
  const bytes=new TextEncoder().encode(JSON.stringify(profile));proof.profileSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('')
  const manifest={schema:'harbeat.execution-track.v1',trackId:proof.trackId,runId:proof.runId,sourceSha256:proof.masterSha256,reportSha256:proof.reportSha256,manifestSha256:proof.manifestSha256,sampleRate:44100,channels:2,duration:80,frames:80*44100,sourceTimeOrigin:'master_audio_start',profile:{sha256:proof.profileSha256,url:`/listen/execution/profiles/${proof.profileSha256}.json`,bytes:bytes.length},stems}
  responses.set(`/listen/details/${proof.trackId}.json`,{track});responses.set(`/listen/execution/tracks/${proof.trackId}.json`,manifest);responses.set(manifest.profile.url,profile);tracks.push(track);manifests.push(manifest)
 }
 responses.set('/listen/library.json',{schema:'harbeat.continuous-library.v1',tracks:tracks.map(t=>({id:t.id,title:t.title,bpm:t.bpm,duration:t.duration,collection:'test',styleLabels:[],detailUrl:`/listen/details/${t.id}.json`,playStatus:'ready',mixStatus:'ready'}))})
 const fetcher=vi.fn(async(input:URL|string)=>{const value=responses.get(new URL(input).pathname);return new Response(value===undefined?'missing':JSON.stringify(value),{status:value===undefined?404:200})});vi.stubGlobal('fetch',fetcher)
 const pool={buffers:new Map<string,AudioBuffer>(),delete:vi.fn((key:string)=>pool.buffers.delete(key))}
 const cache={protected:new Set<string>(),pool,load:vi.fn(async(asset:{url:string;duration:number})=>{const b=new Buffer(2,Math.round(asset.duration*44100),44100);b.channels.forEach(c=>c.fill(.25));pool.buffers.set(asset.url,b as unknown as AudioBuffer);return b as unknown as AudioBuffer})} as unknown as AudioCache
 return {scene,tracks,manifests,responses,fetcher,cache}
}
describe('isolated scene preparation',()=>{
 it('transfers owned exact-size same-speed slices without allocating another stem',async()=>{
  const ctx=context(100),exact=new Buffer(2,100,100),longer=new Buffer(2,105,100),create=vi.spyOn(ctx,'createBuffer')
  exact.channels.forEach(c=>c.fill(.2));longer.channels.forEach(c=>c.fill(.3))
  const input={drums:exact as unknown as AudioBuffer,other:longer as unknown as AudioBuffer}
  const out=await stretchSceneInputs(input,ctx,1,100,signal())
  expect(out.drums).toBe(exact);expect(out.other).not.toBe(longer);expect(create).toHaveBeenCalledTimes(1);expect(Object.keys(input)).toEqual([])
  expect([...out.drums.getChannelData(0)]).toEqual([...exact.channels[0]]);expect(out.other.length).toBe(100)
 })
 it('rejects nonunit scenes before any metadata, PCM allocation or cache load',async()=>{
  const f=await sources();f.scene.rate=1.01;f.scene.clips.bEnd=20+40*1.01;for(const e of f.scene.exits)e.bPosition=20+e.at*1.01
  const ctx=context(),allocate=vi.spyOn(ctx,'createBuffer')
  await expect(prepareScene(f.scene,ctx,f.cache,base,'long',signal())).rejects.toThrow('首轮长混仅启用同速素材，变速场景尚未完成设备内存验证')
  expect(f.fetcher).not.toHaveBeenCalled();expect(allocate).not.toHaveBeenCalled();expect(f.cache.load).not.toHaveBeenCalled()
 })
 it('binds actual current provenance and every execution version',async()=>{
  const f=await sources();expect(()=>verifySceneSources(f.scene,{a:f.tracks[0],b:f.tracks[1]},{a:f.manifests[0],b:f.manifests[1]})).not.toThrow()
  for(const key of ['masterSha256','reportSha256','runId','vocalSha256']){const old=f.tracks[0].provenance![key];f.tracks[0].provenance![key]='changed';expect(()=>verifySceneSources(f.scene,{a:f.tracks[0],b:f.tracks[1]},{a:f.manifests[0],b:f.manifests[1]})).toThrow();f.tracks[0].provenance![key]=old}
  for(const change of [(m:any)=>m.manifestSha256=hash('e'),(m:any)=>m.profile.sha256=hash('e'),(m:any)=>delete m.stems.drums,(m:any)=>m.stems.bass.sourceSha256=hash('e')]){const m=structuredClone(f.manifests[0]);change(m);expect(()=>verifySceneSources(f.scene,{a:f.tracks[0],b:f.tracks[1]},{a:m,b:f.manifests[1]})).toThrow()}
 })
 it('copies exact stereo slices across chunk boundaries and drops decoded inputs',async()=>{
  const ctx=context(10),one=new Buffer(2,20,10),two=new Buffer(2,20,10);for(let c=0;c<2;c++){one.channels[c].set(Array.from({length:20},(_,i)=>i+c*100));two.channels[c].set(Array.from({length:20},(_,i)=>i+20+c*100))}
  const pool={delete:vi.fn()},cache={protected:new Set(),pool,load:vi.fn(async(a:any)=>a.url==='one'?one:two)} as unknown as AudioCache
  const out=await sliceSceneSource(ctx,cache,[{start:0,end:2,asset:{url:'one'}},{start:2,end:4,asset:{url:'two'}}] as any,1.5,1,signal())
  expect([...out.getChannelData(0)]).toEqual([15,16,17,18,19,20,21,22,23,24]);expect(out.getChannelData(1)[9]).toBe(124);expect(pool.delete.mock.calls).toEqual([['one'],['two']])
 })
 it('rejects gaps, short decoded PCM and mono rather than filling silence',async()=>{
  const ctx=context(10),cache={protected:new Set(),pool:{delete:vi.fn()},load:vi.fn(async()=>new Buffer(2,19,10))} as unknown as AudioCache
  await expect(sliceSceneSource(ctx,cache,[{start:0,end:2,asset:{url:'a'}}] as any,0,2,signal())).rejects.toThrow()
  await expect(sliceSceneSource(ctx,cache,[{start:0,end:1,asset:{url:'a'}},{start:1.1,end:2,asset:{url:'b'}}] as any,0,2,signal())).rejects.toThrow()
  cache.load=vi.fn(async()=>new Buffer(1,20,10) as unknown as AudioBuffer);await expect(sliceSceneSource(ctx,cache,[{start:0,end:2,asset:{url:'a'}}] as any,0,2,signal())).rejects.toThrow()
 })
 it('prepares reference only with B master, retaining exact bounded slices',async()=>{
  const f=await sources(),pcm=await prepareScene(f.scene,context(),f.cache,base,'reference',signal());expect(Object.keys(pcm.a)).toEqual([]);expect(Object.keys(pcm.b)).toEqual(['master']);expect(pcm.aMaster.length).toBe(Math.round(13.008*44100));expect(pcm.bMaster.length).toBe(Math.round(56.35*44100));expect(pcm.b.master!.length).toBe(Math.round(40.008*44100));expect(pcm.b.master!.getChannelData(0)[100]).toBe(.25);expect(f.cache.pool.buffers.size).toBe(0)
 })
 it('retains one A loop each and four B stems, dropping B guide',async()=>{
  const f=await sources(),pcm=await prepareScene(f.scene,context(),f.cache,base,'long',signal());expect(Object.keys(pcm.a).sort()).toEqual(['bass','drums','other']);expect(Object.keys(pcm.b).sort()).toEqual(['bass','drums','other','vocals']);expect(pcm.a.drums!.length).toBe(5*44100);expect(pcm.b.vocals!.length).toBe(Math.round(40.008*44100));expect(f.cache.pool.buffers.size).toBe(0)
  expect(vi.mocked(f.cache.load).mock.calls.filter(([asset])=>asset.url===f.tracks[1].native.url)).toHaveLength(1)
 })
 it('retains real source frames through the complete fractional-sample handoff at 111 BPM',async()=>{
  const f=await sources(),d=64*60/111,ratio=d/f.scene.duration
  f.scene.duration=d;f.scene.bpm=111;f.scene.clips.aEnd=f.scene.clips.aStart+d/8;f.scene.clips.bEnd=f.scene.clips.bStart+d
  for(const layer of f.scene.layers)for(const point of layer.points)point[0]*=ratio
  for(const e of f.scene.exits){e.at*=ratio;e.fadeStart=e.at-240/111;e.bPosition=f.scene.clips.bStart+e.at}
  const required=Math.ceil((d+.008)*44100),pcm=await prepareScene(f.scene,context(),f.cache,base,'long',signal())
  expect(pcm.b.vocals!.length).toBe(required);expect(pcm.b.vocals!.duration).toBeGreaterThanOrEqual(d+.008);expect(pcm.b.vocals!.getChannelData(0)[required-1]).toBe(.25)
  const retained=[pcm.aMaster,pcm.bMaster,...Object.values(pcm.a),...Object.values(pcm.b)].reduce((n,b)=>n+b!.length*b!.numberOfChannels*4,0)
  expect(sceneBytes(f.scene,'long')).toBe(retained)
  const cache={protected:new Set(),pool:{delete:vi.fn()},load:vi.fn(async()=>new Buffer(2,required-1,44100))} as unknown as AudioCache
  await expect(sliceSceneSource(context(),cache,[{start:0,end:required/44100,asset:{url:'short'}}] as any,0,required/44100,signal())).rejects.toThrow(/样本覆盖不足/)
 })
 it('refuses changed current metadata and cancellation before loading PCM',async()=>{
  const f=await sources();f.tracks[0].provenance!.reportSha256=hash('e');await expect(prepareScene(f.scene,context(),f.cache,base,'long',signal())).rejects.toThrow();expect(f.cache.load).not.toHaveBeenCalled();const abort=new AbortController();abort.abort();await expect(prepareScene(f.scene,context(),f.cache,base,'long',abort.signal)).rejects.toThrow();expect(f.cache.load).not.toHaveBeenCalled()
 })
 it('rejects a missing manifest, changed execution identity and profile contents before PCM',async()=>{
  for(const mutate of [(f:any)=>f.responses.delete('/listen/execution/tracks/'+f.tracks[0].id+'.json'),(f:any)=>f.manifests[0].manifestSha256=hash('e'),(f:any)=>f.responses.set(f.manifests[0].profile.url,{schema:'substituted'})]){
   const f=await sources();mutate(f);await expect(prepareScene(f.scene,context(),f.cache,base,'long',signal())).rejects.toThrow();expect(f.cache.load).not.toHaveBeenCalled()
  }
 })
 it('checks abort after decoded load and releases the source input even on failure',async()=>{
  const abort=new AbortController(),drop=vi.fn(),cache={protected:new Set(),pool:{delete:drop},load:vi.fn(async()=>{abort.abort();return new Buffer(2,20,10)})} as unknown as AudioCache
  await expect(sliceSceneSource(context(10),cache,[{start:0,end:2,asset:{url:'source'}}] as any,0,2,abort.signal)).rejects.toThrow();expect(drop).toHaveBeenCalledWith('source')
 })

 it('helper uses one shared worker mapping for B guide and all four stems',async()=>{
  const jobs:any[]=[],terminate=vi.fn()
  vi.stubGlobal('Worker',class{onmessage:any;onerror:any;terminate=terminate;postMessage(data:any){jobs.push(data);const output=Object.fromEntries(Object.entries(data.input).map(([k,x])=>[k,(x as Float32Array).slice(0,data.frames*2)]));queueMicrotask(()=>this.onmessage({data:{output}}))}})
  const input=Object.fromEntries(['master','drums','bass','other','vocals'].map((k,i)=>{const b=new Buffer(2,105,100);b.channels.forEach(c=>c.fill(i+.25));return[k,b as unknown as AudioBuffer]}))
  const output=await stretchSceneInputs(input,context(100),1.01,100,signal());expect(jobs).toHaveLength(1);expect(Object.keys(jobs[0].input).sort()).toEqual(['bass','drums','master','other','vocals']);expect(output.drums.getChannelData(1)[10]).toBe(1.25);expect(terminate).toHaveBeenCalledOnce()
 })
 it('helper aborts a stalled stretch worker',async()=>{
  let posted!:()=>void;const began=new Promise<void>(resolve=>posted=resolve),terminate=vi.fn()
  vi.stubGlobal('Worker',class{onmessage:any;onerror:any;terminate=terminate;postMessage(){posted()}})
  const abort=new AbortController(),input={master:new Buffer(2,105,100) as unknown as AudioBuffer},task=stretchSceneInputs(input,context(100),1.01,100,abort.signal),rejected=expect(task).rejects.toThrow();await began;abort.abort();await rejected;expect(terminate).toHaveBeenCalledOnce()
 })
 it('helper kills stalled WSOLA after the bounded 30 second deadline',async()=>{
  let posted!:()=>void;const began=new Promise<void>(resolve=>posted=resolve),terminate=vi.fn()
  vi.stubGlobal('Worker',class{onmessage:any;onerror:any;terminate=terminate;postMessage(){posted()}})
  vi.useFakeTimers();const input={master:new Buffer(2,105,100) as unknown as AudioBuffer},task=stretchSceneInputs(input,context(100),1.01,100,signal()),rejected=expect(task).rejects.toThrow('超时');await began;await vi.advanceTimersByTimeAsync(30001);await rejected;expect(terminate).toHaveBeenCalledOnce()
 })
})

it('prewarms an approved 75 BPM live scene from stems without allocating either native deck again', async()=>{
 const f=await sources(),d=51.2
 f.scene.bpm=75;f.scene.duration=d;f.scene.clips.aEnd=f.scene.clips.aStart+d/8;f.scene.clips.bEnd=f.scene.clips.bStart+d
 for(const layer of f.scene.layers)layer.points.at(-1)![0]=d
 for(const [i,e] of f.scene.exits.entries()){e.at=d*[.5,.75,1][i];e.fadeStart=e.at-3.2;e.bPosition=f.scene.clips.bStart+e.at}
 expect(sceneBytes(f.scene,'long')).toBeGreaterThan(96*1024*1024)
 const pcm=await prepareScene(f.scene,context(),f.cache,base,'live',signal())
 expect(Object.keys(pcm).sort()).toEqual(['a','b'])
 expect(pcm.b.vocals!.length).toBe(Math.ceil((d+.008)*44100))
 const retained=[...Object.values(pcm.a),...Object.values(pcm.b)].reduce((n,b)=>n+b!.length*b!.numberOfChannels*4,0)
 expect(retained).toBe(sceneBytes(f.scene,'live'))
 expect(retained).toBeLessThan(96*1024*1024)
 expect(vi.mocked(f.cache.load).mock.calls.every(([asset])=>asset.url.startsWith('/listen/execution-media/'))).toBe(true)
})
