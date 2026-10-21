import {expect,it,vi,afterEach} from 'vitest'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {jetsonFixture} from './jetson-test-fixture'
import {planActivitySet} from './activity-plan'
import {planForActivityEdge} from './activity-candidates'
import {sealJetsonDecision} from './jetson-contract'
import {ActivitySession} from './activity-session'
import {requestJetsonPlan} from './jetson-client'
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()})
async function fixture(){
 const f=await jetsonFixture(),tracks=[f.a,f.b]
 f.a.windows[0].variants[f.b.id]={...f.b.windows[0].variants[f.a.id]}
 const planned=planActivitySet({tracks:tracks.map(t=>({...t,styleLabels:['Hip-Hop']})),styles:['Hip-Hop'],energy:3,maxTracks:4})
 const edge=planned.edges.find(e=>e.from===f.a.id&&e.to===f.b.id)!,plan=planForActivityEdge(f.a,f.b,edge,3)!
 const strategy=await sealJetsonDecision({...f.result,plan:{from:edge.from,to:edge.to,windowId:edge.windowId,start:edge.start,end:edge.end,duration:edge.duration,rate:edge.rate,bStart:edge.bStart,bEnd:edge.bEnd,beatErrorMs:0},eq:plan.v30Eq,restore:plan.restore})
 const manifests=tracks.map(t=>{const proof=strategy.sourceProof[t===f.a?'a':'b'];return{schema:'harbeat.execution-track.v1',trackId:t.id,runId:t.provenance!.runId,sourceSha256:t.provenance!.masterSha256,reportSha256:t.provenance!.reportSha256,manifestSha256:proof.manifestSha256,sampleRate:44100,channels:2,duration:80,frames:80*44100,sourceTimeOrigin:'master_audio_start',profile:{sha256:proof.profileSha256,url:`/listen/execution/profiles/${proof.profileSha256}.json`,bytes:100},stems:Object.fromEntries(Object.entries(proof.stemSha256).map(([stem,sha])=>[stem,{sourceSha256:sha,segments:Array.from({length:5},(_,i)=>({start:i*16,end:(i+1)*16,startFrame:i*16*44100,endFrame:(i+1)*16*44100,asset:{url:`/listen/execution-media/${sha}.flac`,sha256:sha,bytes:1000,duration:16,sampleRate:44100,channels:2,frames:16*44100}}))}]))}})
 const value:any={schema:'harbeat.activity-set.v1',packId:'a'.repeat(32),state:'partial',trackIds:planned.trackIds,initialTrackId:planned.initialTrackId,sourceFingerprints:tracks,results:[],execution:{schema:'harbeat.activity-execution.v2',tracks:manifests,edges:planned.edges,coverage:planned.coverage,energy:3,strategyVersion:'jetson-decision-v1',strategies:[strategy]}}
 return{...f,tracks,edge,plan,strategy,value}
}
it('the CPU planner verifies a Jetson approval through the same geometry/EQ/hash contract',async()=>{
 const f=await fixture(),input={operation:'verifyJetsonStrategy',tracks:f.tracks,edge:f.edge,energy:3,strategy:f.strategy},file=fileURLToPath(new URL('../../../../tools/activity_set_plan.cjs',import.meta.url))
 expect(JSON.parse(execFileSync(process.execPath,['--no-experimental-global-webcrypto',file],{input:JSON.stringify(input),encoding:'utf8'}))).toEqual({verified:true})
 input.strategy.controls.bassTiming.swapEnd+=.1
 expect(()=>execFileSync(process.execPath,[file],{input:JSON.stringify(input),stdio:['pipe','pipe','pipe']})).toThrow()
})
it('embedded verified approvals are consumed offline by the exact automatic/manual prepare key',async()=>{
 const f=await fixture(),fetcher=vi.fn(()=>{throw Error('offline')});vi.stubGlobal('fetch',fetcher)
 const session=await ActivitySession.open(f.value,'预约',async id=>f.tracks.find(t=>t.id===id)!)
 expect(session.strategyCount).toBe(1)
 expect(session.strategyVersion).toBe('jetson-decision-v1')
 expect(await requestJetsonPlan(f.a,f.b,f.plan,new URL('https://test.local/'),new AbortController().signal,()=>0)).toEqual(f.strategy)
 expect(fetcher).not.toHaveBeenCalled()
})
it('an embedded approval for a different source profile or modified curve is rejected',async()=>{
 for(const kind of ['curve','profile']){
  const f=await fixture()
  if(kind==='curve')f.strategy.controls.bassTiming.swapEnd+=.1
  else{f.strategy.sourceProof.a.profileSha256='0'.repeat(64);f.value.execution.strategies=[await sealJetsonDecision(f.strategy)]}
  expect(await ActivitySession.open(f.value,'损坏批准',async id=>f.tracks.find(t=>t.id===id)!).then(()=>false,()=>true)).toBe(true)
 }
})
it('exposes only still-future approved points from a partially prepared reservation',async()=>{
 const f=await fixture(),session=await ActivitySession.open(f.value,'部分预约',async id=>f.tracks.find(t=>t.id===id)!)
 expect(session.candidates(f.a,0,3).length).toBeGreaterThan(1)
 expect(session.approvedCandidates(f.a,0,3).map(c=>c.plan.id)).toEqual([f.plan.id])
 expect(session.approvedCandidates(f.a,f.plan.start,3)).toEqual([])
 expect(session.approvedCandidates(f.a,0,0)).toEqual([])
 expect(session.approvedCandidates(f.b,0,3)).toEqual([])
})
