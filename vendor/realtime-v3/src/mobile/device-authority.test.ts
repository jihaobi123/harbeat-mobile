import {afterEach,expect,it,vi} from 'vitest'
import {prepareDevice,getDevicePCM,rememberExecutionTrack,releaseDevicePCM,hasDevicePCM} from './device-prepare'
import * as client from './jetson-client'
import {jetsonFixture} from './jetson-test-fixture'
import {sealJetsonDecision} from './jetson-contract'
import type {ExecutionTrack} from './device-execution'

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})
function buffer(length:number,sampleRate=1000){const channels=[new Float32Array(length),new Float32Array(length)];return{numberOfChannels:2,length,sampleRate,getChannelData:(c:number)=>channels[c],copyToChannel:(data:Float32Array,c:number)=>channels[c].set(data)} as AudioBuffer}
function player(){const native=buffer(80000);return{position:0,logs:[],ctx:{sampleRate:1000,createBuffer:(_channels:number,n:number,sr:number)=>buffer(n,sr)},cache:{load:vi.fn(async()=>native)}} as any}
async function setup(){
 const f=await jetsonFixture(),profiles=new Map<string,Uint8Array>(),manifests:ExecutionTrack[]=[]
 for(const [side,t] of [['a',f.a],['b',f.b]] as const){
  const proof=f.result.sourceProof[side]
  const data=new TextEncoder().encode(JSON.stringify({schema:'harbeat.execution-profile.v1',trackId:t.id,runId:t.provenance!.runId,sourceSha256:t.provenance!.masterSha256,reportSha256:t.provenance!.reportSha256,manifestSha256:proof.manifestSha256,stems:Object.fromEntries(Object.entries(proof.stemSha256).map(([key,sha])=>[key,{sourceSha256:sha}]))}))
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(x=>x.toString(16).padStart(2,'0')).join('');proof.profileSha256=sha
  const manifest:ExecutionTrack={schema:'harbeat.execution-track.v1',trackId:t.id,runId:String(t.provenance!.runId),sourceSha256:String(t.provenance!.masterSha256),reportSha256:String(t.provenance!.reportSha256),manifestSha256:proof.manifestSha256,sampleRate:44100,channels:2,duration:80,frames:80*44100,sourceTimeOrigin:'master_audio_start',profile:{sha256:sha,url:`/listen/execution/profiles/${sha}.json`,bytes:data.byteLength},stems:Object.fromEntries(Object.entries(proof.stemSha256).map(([stem,sourceSha256])=>[stem,{sourceSha256,segments:Array.from({length:5},(_,i)=>({start:i*16,end:(i+1)*16,startFrame:i*16*44100,endFrame:(i+1)*16*44100,asset:{url:`/listen/execution-media/${sourceSha256}.flac`,sha256:sourceSha256,bytes:1000,duration:16,sampleRate:44100,channels:2,frames:16*44100}}))}]))}
  profiles.set(sha,data);manifests.push(manifest);rememberExecutionTrack(manifest,t)
 }
 f.result=await sealJetsonDecision(f.result)
 vi.stubGlobal('fetch',vi.fn(async(url:URL)=>{const sha=new URL(url).pathname.split('/').at(-1)!.replace('.json',''),data=profiles.get(sha);if(!data)throw Error('Unexpected network request');return new Response(data.slice().buffer as ArrayBuffer)}))
 return{...f,manifests}
}
it('executes Jetson controls and decision verbatim without local FFT, VAD or method ranking',async()=>{
 const f=await setup(),p=player(),worker=vi.fn(()=>{throw Error('No acoustic worker may execute on the playback path')});vi.stubGlobal('Worker',worker)
 vi.spyOn(client,'requestJetsonPlan').mockResolvedValue(f.result)
 const result=await prepareDevice(p,f.a,f.b,f.p,new URL('https://test.local/'),new AbortController().signal)
 expect(result.decision).toBe(f.result.decision);expect(result.decision.recommended).toBe('bass')
 expect(result.metrics).toBe(f.result.metrics);expect(result.execution.controls).toBe(f.result.controls);expect(result.execution.sourceBindings).toBe(f.result.sourceProof)
 expect(result.execution.plan.v30Eq).toBe(f.result.eq);expect(getDevicePCM(result).a.bass).toBeDefined();expect(worker).not.toHaveBeenCalled()
 releaseDevicePCM(result)
})
it('cannot fabricate even an original approval while Jetson has no ready result',async()=>{
 const f=await jetsonFixture(),p=player();vi.spyOn(client,'requestJetsonPlan').mockRejectedValue(Error('Approval unavailable'))
 await expect(prepareDevice(p,f.a,f.b,f.p,new URL('https://test.local/'),new AbortController().signal)).rejects.toThrow('Approval unavailable')
 expect(p.cache.load).not.toHaveBeenCalled()
})
it('cold stems permit only the original fallback already approved by Jetson',async()=>{
 const f=await setup(),p=player();vi.spyOn(client,'requestJetsonPlan').mockResolvedValue(f.result)
 const load=p.cache.load;p.cache.load=vi.fn(async(asset:any)=>{if(asset.url.includes('/execution-media/'))throw Error('Cold stems');return load(asset)})
 const result=await prepareDevice(p,f.a,f.b,f.p,new URL('https://test.local/'),new AbortController().signal)
 expect(result.decision.recommended).toBe('original');expect(result.decision.methods.bass.eligible).toBe(false);expect(result.metrics).toBe(f.result.metrics)
 expect(result.stats.approvedPlanId).toBe(f.result.id);releaseDevicePCM(result)
})
it('even a cached approved original fallback expires when a known profile version changes',async()=>{
 const f=await setup(),p=player();vi.spyOn(client,'requestJetsonPlan').mockResolvedValue(f.result)
 const load=p.cache.load;p.cache.load=vi.fn(async(asset:any)=>{if(asset.url.includes('/execution-media/'))throw Error('Cold stems');return load(asset)})
 const result=await prepareDevice(p,f.a,f.b,f.p,new URL('https://test.local/'),new AbortController().signal)
 expect(hasDevicePCM(result)).toBe(true)
 rememberExecutionTrack({...f.manifests[0],profile:{...f.manifests[0].profile,sha256:'0'.repeat(64),url:'/listen/execution/profiles/'+'0'.repeat(64)+'.json'}},f.a)
 expect(hasDevicePCM(result)).toBe(false);expect(()=>getDevicePCM(result)).toThrow('版本')
 releaseDevicePCM(result)
})
it('refuses changed execution profile versions rather than using a stale advanced approval',async()=>{
 const f=await setup(),p=player();vi.spyOn(client,'requestJetsonPlan').mockResolvedValue(f.result)
 rememberExecutionTrack({...f.manifests[0],profile:{...f.manifests[0].profile,sha256:'0'.repeat(64),url:'/listen/execution/profiles/'+'0'.repeat(64)+'.json'}},f.a)
 await expect(prepareDevice(p,f.a,f.b,f.p,new URL('https://test.local/'),new AbortController().signal)).rejects.toMatchObject({code:'source_version_changed'})
})
