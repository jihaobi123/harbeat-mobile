import {describe,it,expect,vi} from 'vitest'
import {ListenRun} from './listen'

const sha='a'.repeat(64),asset={url:'device-entry/measured.f32',sha256:sha,duration:4.8,rate:1.01,bytes:1693440}
function longSession(){
 const variants=Object.fromEntries(Array.from({length:240},(_,i)=>['source-'+i,{...asset,url:'device-entry/'+i+'.f32'}]));variants.a=asset
 const window={id:'w',start:10,end:14.848,bars:2,variants},eq={source:{a:sha,b:sha},curves:[{at:0,low:-3,mid:0,high:1}]}
 const samples=Array(1000).fill({mixStart:1,exit:2,evidence:{reason:'failed acoustic candidate '+'.'.repeat(300)}})
 const logs:any[]=[]
 for(let i=0;i<60;i++){
  const base={sequence:logs.length+1,wallTime:new Date(1700000000000+i*120000).toISOString(),contextSec:i*120}
  logs.push({...base,kind:'decision_search',result:{candidateCount:8,selectedId:'chosen-'+i,candidates:[{id:'chosen-'+i,rank:1,score:.9,scoreComponents:[{key:'retention',value:.9}]}],exclusions:[{trackId:'b',code:'local_beat_alignment',reason:'failed cue',count:samples.length,samples}]}})
  logs.push({...base,sequence:logs.length+1,kind:'plan_scheduled',planId:'chosen-'+i,plan:{id:'chosen-'+i,from:'a',to:'b',window,asset,start:100,end:104.8,duration:4.8,rate:1.01,v30Eq:eq},trace:{a:{masterSha256:sha,snapshotUrl:'/immutable/a-evidence.json'},b:{masterSha256:sha,snapshotUrl:'/immutable/b-evidence.json'},material:{entry:asset,window},v30Eq:eq},sourceHashes:{entry:sha}})
  logs.push({...base,sequence:logs.length+1,kind:'handoff_state_commit',planId:'chosen-'+i,to:'b',bodySourceOffset:window.end})
 }
 logs.push({sequence:logs.length+1,kind:'segment_buffering',contextSec:7201,track:'b',sourcePosition:40},{sequence:logs.length+2,kind:'request_failed',contextSec:7202,requestId:'failed',message:'test failure must survive'})
 const source={id:'b',title:'Song',bpm:100,duration:240,reportId:'report',provenance:{runId:'run',masterSha256:sha,reportSha256:sha,vocalSha256:sha},native:asset,audioSegments:[{start:0,end:240,asset}],windows:[window],alignment:{source:{masterSha256:sha},bandFrames:Array(12000).fill({start:0,end:.1,low:1,mid:2,high:3,rmsDbfs:-12,detail:'x'.repeat(100)})},preprocessing:{reportSnapshotUrl:'/immutable/b-evidence.json',masterSha256:sha,reportSha256:sha,vocalActivity:Array(12000).fill([0,1])}}
 const raw={schema:'harbeat.v3_live_session.v2',sessionId:'two-hours',sampleRate:44100,catalog:[source],logs,entryRenders:[{trackId:'b',output:asset,sourceStart:10,sourceEnd:14.848,referenceDownloaded:false}]}
 const index:any={schema:'harbeat.continuous-library.v1',tracks:[{id:'b',title:'Song',bpm:100,duration:240,collection:'DJ',styleLabels:['Hip-Hop'],detailUrl:'/immutable/details/b.json',playStatus:'ready',mixStatus:'ready'}]}
 const host={requestFocus:()=>true,saveSession:vi.fn(),exportLog:vi.fn(),close:()=>{}}
 const run=new ListenRun(index,new URL('https://example.test/listen/'),()=>{},host);run.player={export:()=>raw} as any
 return {run,raw,host,window,eq}
}

describe('long mobile Listen audit export',()=>{
 it('saves a two-hour audit inside the unchanged Android 20 MiB limit',()=>{
  const {run,host}=longSession();run.save();expect(host.saveSession).toHaveBeenCalledTimes(1)
  const bytes=new TextEncoder().encode(host.saveSession.mock.calls[0][0]).byteLength
  expect(bytes).toBeLessThan(20*1024*1024)
 })
 it('keeps every executed event, applied EQ, entry PCM hash and exact source reference',()=>{
  const {run,raw,eq}=longSession(),out:any=run.export()
  expect(out.logs.map((e:any)=>[e.kind,e.sequence,e.contextSec])).toEqual(raw.logs.map(e=>[e.kind,e.sequence,e.contextSec]))
  expect(out.logs.filter((e:any)=>['segment_buffering','request_failed'].includes(e.kind))).toEqual(raw.logs.slice(-2))
  const applied=out.logs.find((e:any)=>e.kind==='plan_scheduled')
  expect(applied.plan.v30Eq).toEqual(eq);expect(applied.trace.v30Eq).toEqual(eq);expect(applied.plan.asset.sha256).toBe(sha);expect(applied.sourceHashes.entry).toBe(sha)
  expect(out.entryRenders).toEqual(raw.entryRenders)
  expect(out.catalog[0].provenance).toEqual(raw.catalog[0].provenance)
  expect(out.catalog[0].detailUrl).toBe('/immutable/details/b.json')
  expect(out.catalog[0].preprocessing.reportSnapshotUrl).toBe('/immutable/b-evidence.json')
  expect(out.exportPolicy?.catalog).toBe('source-bound-references')
 })
 it('declares omitted search samples and leaves runtime inputs untouched',()=>{
  const {run,raw,window}=longSession(),out:any=run.export(),search=out.logs[0]
  expect(search.result.exclusions[0].count).toBe(1000)
  expect(search.result.exclusions[0].omittedSampleCount).toBe(1000)
  expect(search.result.candidates).toEqual(raw.logs[0].result.candidates)
  expect(raw.logs[0].result.exclusions[0].samples).toHaveLength(1000)
  expect(raw.catalog[0].alignment.bandFrames).toHaveLength(12000)
  expect(Object.keys(window.variants)).toHaveLength(241)
  expect(Object.keys(out.logs.find((e:any)=>e.kind==='plan_scheduled').plan.window.variants)).toEqual(['a'])
 })
})

it('bounds ranked search details while retaining a selected candidate outside the first ranks',()=>{
 const {run,raw}=longSession(),search=raw.logs[0]
 search.result.candidates=Array.from({length:2000},(_,rank)=>({id:rank===1999?'late-selected':'candidate-'+rank,rank:rank+1,score:1-rank/2000,scoreComponents:[{key:'retention',value:.9}]}))
 search.result.selectedId='late-selected';search.result.candidateCount=2000
 const exported:any=run.export(),result=exported.logs[0].result
 expect(result.candidates).toHaveLength(4)
 expect(result.candidates.map((c:any)=>c.id)).toEqual(['candidate-0','candidate-1','candidate-2','late-selected'])
 expect(result.candidates.at(-1)).toEqual(search.result.candidates.at(-1))
 expect(result.candidateCount).toBe(2000);expect(result.omittedCandidateCount).toBe(1996)
 expect(search.result.candidates).toHaveLength(2000)
})

it('bounds stored mobile search events before long sessions accumulate them',async()=>{
 const {ListenTransport}=await import('./listen-transport'),{raw,eq}=longSession()
 const transport:any=Object.create(ListenTransport.prototype)
 Object.assign(transport,{ctx:{currentTime:120},logs:[],sessionId:'long-session'})
 transport.log('decision_search',{result:raw.logs[0].result})
 transport.log('plan_scheduled',raw.logs[1])
 transport.log('segment_buffering',{track:'b',sourcePosition:40})
 expect(transport.logs[0].result.exclusions[0].omittedSampleCount).toBe(1000)
 expect(transport.logs[0].result.exclusions[0].samples).toBeUndefined()
 expect(Object.keys(transport.logs[1].plan.window.variants)).toEqual(['a'])
 expect(transport.logs[1].plan.v30Eq).toEqual(eq)
 expect(transport.logs[2]).toMatchObject({kind:'segment_buffering',track:'b',sourcePosition:40})
 expect(new TextEncoder().encode(JSON.stringify(transport.logs)).byteLength).toBeLessThan(50000)
 expect(raw.logs[0].result.exclusions[0].samples).toHaveLength(1000)
})

it('preserves omission counts when saved audits are exported again',()=>{
 const {run,raw}=longSession();raw.logs[0].result.candidates=Array.from({length:100},(_,i)=>({id:'c-'+i,rank:i+1,score:.9,scoreComponents:[]}));raw.logs[0].result.candidateCount=100;raw.logs[0].result.selectedId='c-99'
 const saved:any=run.export();run.player={export:()=>saved} as any
 const exported:any=run.export()
 expect(exported.logs[0].result.omittedCandidateCount).toBe(96)
 expect(exported.logs[0].result.exclusions[0].omittedSampleCount).toBe(1000)
 expect(exported.logs[0]).toEqual(saved.logs[0])
})
