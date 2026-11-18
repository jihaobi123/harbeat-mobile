import {afterEach,it,expect,vi} from 'vitest'
import {AudioBufferPool,AudioCache} from '../../listen-upstream/realtime/cache'
import {prepareRoles} from './role-prepare'
import {roleFixture,sealRoleFixture} from './role-fixture'
import {roleFrames} from './role-contract'
class Buffer{channels:Float32Array[];constructor(readonly numberOfChannels:number,readonly length:number,readonly sampleRate:number){this.channels=Array.from({length:numberOfChannels},()=>new Float32Array(length).fill(.125))}get duration(){return this.length/this.sampleRate}getChannelData(c:number){return this.channels[c]}copyToChannel(data:Float32Array,c:number){this.channels[c].set(data)}}
const base=new URL('https://example.test/'),signal=()=>new AbortController().signal
let sequence=0
afterEach(()=>vi.unstubAllGlobals())
async function setup(){
 const approval=roleFixture('roles-cd'),responses=new Map<string,any>(),tracks:any[]=[],manifests:any[]=[],ctx:any={sampleRate:44100,createBuffer:(c:number,n:number,s:number)=>new Buffer(c,n,s)},pool=new AudioBufferPool(),shared=new AudioCache(ctx,base,()=>{},pool)
 for(const side of ['c','d']){const p=approval.sources[side];p.runId='role-test-'+(++sequence)
  const native={url:'/listen/media/'+p.masterSha256+'.flac',sha256:p.masterSha256,bytes:100,duration:80},track={id:p.trackId,title:side,bpm:96,duration:80,native,bars:[],windows:[],provenance:{masterSha256:p.masterSha256,reportSha256:p.reportSha256,vocalSha256:p.vocalSha256,runId:p.runId}}
  const stems=Object.fromEntries(Object.entries(p.stemSha256).map(([role,sha])=>[role,{sourceSha256:sha,segments:Array.from({length:5},(_,i)=>({start:i*16,end:(i+1)*16,startFrame:i*16*44100,endFrame:(i+1)*16*44100,asset:{url:'/listen/execution-media/'+sha+'.flac',sha256:sha,bytes:100,duration:16,sampleRate:44100,channels:2,frames:16*44100}}))}]))
  const profile={schema:'harbeat.execution-profile.v1',trackId:p.trackId,runId:p.runId,sourceSha256:p.masterSha256,reportSha256:p.reportSha256,manifestSha256:p.manifestSha256,stems:Object.fromEntries(Object.entries(p.stemSha256).map(([r,sha])=>[r,{sourceSha256:sha}]))},profileBytes=new TextEncoder().encode(JSON.stringify(profile));p.profileSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',profileBytes))).map(x=>x.toString(16).padStart(2,'0')).join('')
  const m={schema:'harbeat.execution-track.v1',trackId:p.trackId,runId:p.runId,sourceSha256:p.masterSha256,reportSha256:p.reportSha256,manifestSha256:p.manifestSha256,sampleRate:44100,channels:2,duration:80,frames:80*44100,sourceTimeOrigin:'master_audio_start',profile:{sha256:p.profileSha256,url:'/listen/execution/profiles/'+p.profileSha256+'.json',bytes:profileBytes.length},stems}
  tracks.push(track);manifests.push(m);responses.set('/listen/details/'+p.trackId+'.json',{track});responses.set('/listen/execution/tracks/'+p.trackId+'.json',m);responses.set(m.profile.url,profile)
 }
 responses.set('/listen/library.json',{schema:'harbeat.continuous-library.v1',tracks:tracks.map(t=>({id:t.id,title:t.title,bpm:t.bpm,duration:80,collection:'test',styleLabels:[],detailUrl:'/listen/details/'+t.id+'.json',playStatus:'ready',mixStatus:'ready'}))})
 vi.stubGlobal('fetch',vi.fn(async(input:any)=>{const value=responses.get(new URL(input).pathname);return new Response(value?JSON.stringify(value):'missing',{status:value?200:404})}))
 await sealRoleFixture(approval)
 const load=vi.fn(async(a:any,_s:AbortSignal)=>new Buffer(2,Math.round(a.duration*44100),44100) as unknown as AudioBuffer)
 return{approval,responses,tracks,manifests,ctx,pool,shared,load}
}
it('prepares only C.other/D.vocals using exact source frames, retaining two owned slices and playback pins',async()=>{
 const f=await setup(),limit=f.pool.limit;for(const key of ['playing-A','fallback-B']){f.shared.protected.add(key);f.pool.buffers.set(key,new Buffer(2,100,44100)as any)}
 const ready=await prepareRoles(f.approval,f.ctx,f.shared,base,signal(),{load:f.load});expect([...ready.buffers.keys()]).toEqual(['c:other','d:vocals']);for(const l of f.approval.layers){const b=ready.buffers.get(l.source+':'+l.role)!;expect(b.length).toBe(roleFrames(l));expect(b.getChannelData(1)[100]).toBe(.125)}
 expect(f.load).toHaveBeenCalledTimes(3);expect(f.pool.limit).toBe(limit-f.approval.layers.reduce((n:number,l:any)=>n+roleFrames(l)*8,0));expect(f.pool.owners.size).toBe(2);ready.release();ready.release();expect(f.pool.limit).toBe(limit);expect(f.pool.owners.size).toBe(1);expect([...f.shared.protected]).toEqual(['playing-A','fallback-B']);expect(ready.buffers.size).toBe(0)
})
it('rejects changed source tempo, current provenance, manifest or profile before decoding replacement PCM',async()=>{
 for(const change of [(f:any)=>f.tracks[0].bpm=90,(f:any)=>f.tracks[0].bpm='96',(f:any)=>f.tracks[0].provenance.reportSha256='f'.repeat(64),(f:any)=>f.manifests[0].manifestSha256='f'.repeat(64),(f:any)=>f.responses.set(f.manifests[0].profile.url,{schema:'changed'})]){const f=await setup(),limit=f.pool.limit;change(f);await expect(prepareRoles(f.approval,f.ctx,f.shared,base,signal(),{load:f.load})).rejects.toThrow();expect(f.load).not.toHaveBeenCalled();expect(f.pool.limit).toBe(limit);expect(f.pool.owners.size).toBe(1)}
})
it('abort and budget failure release the extra reservation without clearing another owner',async()=>{
 const f=await setup(),limit=f.pool.limit,c=new AbortController();f.load.mockImplementation(async(a:any)=>{c.abort();return new Buffer(2,Math.round(a.duration*44100),44100)as any});await expect(prepareRoles(f.approval,f.ctx,f.shared,base,c.signal,{load:f.load})).rejects.toThrow();expect(f.pool.limit).toBe(limit);expect(f.pool.owners.size).toBe(1)
 const x=await setup();x.shared.protected.add('playing');x.pool.buffers.set('playing',new Buffer(2,20*1024*1024,44100)as any);await expect(prepareRoles(x.approval,x.ctx,x.shared,base,signal(),{load:x.load})).rejects.toThrow(/内存|预算/);expect(x.load).not.toHaveBeenCalled();expect(x.pool.owners.size).toBe(1);expect(x.shared.protected.has('playing')).toBe(true)
})
it('uses the same master-guided WSOLA map for a nonunit role and retains exact declared output frames',async()=>{
 const f=await setup(),l=f.approval.layers[0],jobs:any[]=[],terminate=vi.fn();l.rate=1.01;l.sourceBpm=96/l.rate;l.lengthFrames=Math.round(441000*l.rate);f.tracks[0].bpm=l.sourceBpm
 // This test supplies fresh synthetic evidence for the nonunit arrangement.
 await sealRoleFixture(f.approval)
 vi.stubGlobal('Worker',class{onmessage:any;onerror:any;terminate=terminate;postMessage(data:any){jobs.push(data);queueMicrotask(()=>this.onmessage({data:{output:Object.fromEntries(Object.keys(data.input).map(k=>[k,data.input[k].slice(0,data.frames*2)]))}}))}})
 const ready=await prepareRoles(f.approval,f.ctx,f.shared,base,signal(),{load:f.load});expect(jobs).toHaveLength(1);expect(Object.keys(jobs[0].input).sort()).toEqual(['master','other']);expect(jobs[0].rate).toBe(1.01);expect(jobs[0].frames).toBe(441000);expect(ready.buffers.get('c:other')!.length).toBe(441000);expect(ready.buffers.get('c:other')!.getChannelData(0)[200]).toBe(.125);expect(terminate).toHaveBeenCalledOnce();ready.release()
})
it('rejects nonfinite prepared samples and releases every extra allocation',async()=>{
 const f=await setup(),limit=f.pool.limit;f.load.mockImplementation(async(a:any)=>{const b=new Buffer(2,Math.round(a.duration*44100),44100);b.channels[0].fill(NaN);return b as any});await expect(prepareRoles(f.approval,f.ctx,f.shared,base,signal(),{load:f.load})).rejects.toThrow(/无效 PCM/);expect(f.pool.limit).toBe(limit);expect(f.pool.owners.size).toBe(1)
})
