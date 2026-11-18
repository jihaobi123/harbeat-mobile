import {afterEach,expect,it,vi} from 'vitest'
import {qualityTrack} from '../metric-upstream/continuous/qualityFixture'
import {MetricRun} from './metric'
import {rankNearbyChoices,rankContinuousChoices,rankChoices} from './smart-selection'
import * as preparation from './device-prepare'
import type {Track} from '../metric-upstream/realtime/planner'
import type {DevicePrepared} from './device-execution'

afterEach(()=>vi.restoreAllMocks())
async function setup(){
 const a=qualityTrack('a'),b=qualityTrack('b'),tracks=[a,b]
 const index:any={schema:'harbeat.continuous-library.v1',tracks:tracks.map(t=>({...t,detailUrl:t.id,collection:'NAS',styleLabels:['Hip-Hop'],playStatus:'ready',mixStatus:'ready'}))}
 const p:any={localExecution:true,ctx:{sampleRate:44100,resume:async()=>{}},initialize:async()=>{},current:null,position:20,playing:true,paused:false,busy:false,buffering:false,transition:null,logs:[],cache:{ready:new Set()},start:vi.fn(async(t:Track)=>{p.current=t}),setVolume:()=>{},stop:()=>{},dispose:()=>{},export:()=>({}),queueNativeNext:vi.fn(),arm:vi.fn(async(result:any)=>{p.transition={result}})}
 const first=rankNearbyChoices(a,[b],30,3).best!.plan
 const second=rankNearbyChoices(a,[b],first.start+.01,3).best!.plan
 // Freeze an approved set whose first cue is also the higher quality option.
 first.score=second.score+.1
 const candidates=[first,second].map(plan=>({track:b,plan}))
 const prepare=vi.spyOn(preparation,'prepareDevice').mockImplementation(async(_p,a,b,plan)=>{
  if(!candidates.some(c=>c.plan.id===plan.id))throw Object.assign(Error('unreserved cue would hit busy Jetson'),{status:429})
  return {schema:'harbeat.device-execution-plan.v1',id:plan.id,status:'ready',plan:{from:a.id,to:b.id,start:plan.start,end:plan.end,duration:plan.duration,rate:plan.rate,bStart:plan.window.start,bEnd:plan.window.end,windowId:plan.window.id,beatErrorMs:0},execution:{schema:'harbeat.device-execution-plan.v1'},assets:{},decision:{recommended:'filter',methods:{filter:{eligible:true,name:'旋律滤波'}}}} as DevicePrepared
 })
 vi.spyOn(preparation,'hasDevicePCM').mockReturnValue(true)
 vi.spyOn(preparation,'pinDevicePCM').mockReturnValue(()=>{})
 vi.spyOn(preparation,'preloadDevice').mockResolvedValue(undefined as any)
 vi.spyOn(preparation,'loadPrepared').mockResolvedValue(undefined)
 const run=new MetricRun(index,new URL('https://reservation.test/'),()=>{},undefined,()=>p,async id=>({track:tracks.find(t=>t.id===id)}))
 await run.start(a.id);run.direction({automatic:false});run.choose(b.id)
 const activity:any={packId:'approved-set',name:'set',ids:new Set(['a','b']),tracks,results:[],candidateCount:2,strategyCount:2,strategyVersion:'jetson-decision-v1',cloudCoverage:{},find:()=>null,candidates:()=>candidates,approvedCandidates:(_a:Track,position:number)=>candidates.filter(c=>c.plan.start>=position+.5)}
 ;(run as any).activity=activity
 return{a,b,p,run,prepare,candidates,first,second,activity,tracks,index}
}
it('a next tap uses the reserved cue and approved method instead of submitting a closer uncached cue',async()=>{
 const s=await setup()
 try{
  s.run.requestNext();s.run.tick()
  await vi.waitFor(()=>expect(s.run.working).toBe(false))
  expect(s.p.arm).toHaveBeenCalledTimes(1)
  expect(s.p.arm.mock.calls[0][0].plan.start).toBe(s.first.start)
  expect(s.p.arm.mock.calls[0][1]).toBe('filter')
  expect(s.prepare.mock.calls.every(call=>s.candidates.some(c=>c.plan.id===call[3].id))).toBe(true)
  expect(s.p.start).toHaveBeenCalledTimes(1)
 }finally{s.run.dispose()}
})
it('rolling preparation stays inside the reserved approvals',async()=>{
 const s=await setup()
 try{
  ;(s.run as any).warmNearby()
  await vi.waitFor(()=>expect(s.run.snapshot().warm.state).toBe('ready'))
  expect(s.prepare).toHaveBeenCalled()
  expect(s.prepare.mock.calls.every(call=>s.candidates.some(c=>c.plan.id===call[3].id))).toBe(true)
 }finally{s.run.dispose()}
})
it('a reservation without a usable approval keeps A and never queues unmixed continuation',async()=>{
 const s=await setup()
 try{
  s.activity.approvedCandidates=()=>[]
  s.p.position=s.a.duration-20
  s.run.requestNext();s.run.tick()
  await vi.waitFor(()=>expect(s.run.working).toBe(false))
  s.run.direction({automatic:true});(s.run as any).phase='no_match'
  s.run.tick();await new Promise(r=>setTimeout(r,30))
  expect(s.prepare).not.toHaveBeenCalled()
  expect(s.p.arm).not.toHaveBeenCalled()
  expect(s.p.queueNativeNext).not.toHaveBeenCalled()
  expect(s.p.current.id).toBe(s.a.id)
 }finally{s.run.dispose()}
})
it('mixSoon retries the next approved point when preparation misses the first one',async()=>{
 const s=await setup()
 const original=s.prepare.getMockImplementation()!
 s.prepare.mockImplementationOnce(async(...args)=>{s.p.position=s.first.start+.1;throw Object.assign(Error('cue expired'),{code:'cue_expired'})}).mockImplementation(original)
 try{
  await s.run.mixSoon()
  expect(s.p.arm).toHaveBeenCalledTimes(1)
  expect(s.p.arm.mock.calls[0][0].plan.start).toBe(s.second.start)
  expect(s.prepare.mock.calls.every(call=>s.candidates.some(c=>c.plan.id===call[3].id))).toBe(true)
 }finally{s.run.dispose()}
})
it('one tap waits for an eligible reserved point and resumes locally without another tap',async()=>{
 const s=await setup(),approved=s.activity.approvedCandidates
 try{
  s.activity.approvedCandidates=()=>[]
  await s.run.mixSoon()
  expect(s.run.phase).toBe('waiting_approved')
  expect(s.prepare).not.toHaveBeenCalled()
  s.activity.approvedCandidates=approved
  ;(s.run as any).retryAt=0
  s.run.tick()
  await vi.waitFor(()=>expect(s.p.arm).toHaveBeenCalledTimes(1))
  expect(s.p.current.id).toBe(s.a.id)
 }finally{s.run.dispose()}
})
it('automatic playback retains its quality cue and schedules the reserved device overlap',async()=>{
 const s=await setup()
 try{
  const auto=rankContinuousChoices(s.a,[s.b],s.p.position,3).best!.plan
  s.candidates.push({track:s.b,plan:auto})
  s.run.direction({automatic:true});s.run.tick()
  await vi.waitFor(()=>expect(s.run.phase).toBe('ready'))
  expect(s.run.result?.plan.start).toBe(auto.start)
  await vi.waitFor(()=>expect((s.run as any).autoTask).toBeNull())
  s.p.position=auto.start-5;s.run.tick()
  await vi.waitFor(()=>expect(s.p.arm).toHaveBeenCalledTimes(1))
  expect(s.p.arm.mock.calls[0][0].plan.start).toBe(auto.start)
  expect(s.p.queueNativeNext).not.toHaveBeenCalled()
  expect(s.prepare.mock.calls.every(call=>s.candidates.some(c=>c.plan.id===call[3].id))).toBe(true)
 }finally{s.run.dispose()}
})
it('an explicit song selection replaces an earlier waiting next request',async()=>{
 const s=await setup(),approved=s.activity.approvedCandidates
 try{
  s.activity.approvedCandidates=()=>[];s.run.requestNext();s.run.tick()
  await vi.waitFor(()=>expect(s.run.phase).toBe('waiting_approved'))
  await vi.waitFor(()=>expect((s.run as any).autoTask).toBeNull())
  const c=qualityTrack('c');s.tracks.push(c);s.activity.ids.add(c.id)
  s.index.tracks.push({...c,detailUrl:c.id,collection:'NAS',styleLabels:['Hip-Hop'],playStatus:'ready',mixStatus:'ready'})
  const cp=rankNearbyChoices(s.a,[c],30,3).best!.plan;s.candidates.push({track:c,plan:cp})
  s.activity.approvedCandidates=approved;s.run.choose(c.id);s.run.tick()
  await new Promise(r=>setTimeout(r,30))
  expect(s.p.arm).not.toHaveBeenCalled()
  s.run.requestNext();s.run.tick()
  await vi.waitFor(()=>expect(s.p.arm).toHaveBeenCalledTimes(1))
  expect(s.p.arm.mock.calls[0][0].plan.to).toBe(c.id)
 }finally{s.run.dispose()}
})
it('automatic selection can use a safe approved cue with less than 47 seconds of lead',async()=>{
 const s=await setup()
 try{
  for(const t of s.tracks){t.duration=160;t.native.duration=160;t.bars=Array.from({length:80},(_,i)=>i*2);t.sections[0].end=160;t.energy![0].end=160;t.alignment!.bandFrames[0].end=160;t.alignment!.bars=t.bars.map((start,i)=>({index:i,start,end:start+2,lastBeat:start+1.5,beats:[0,.5,1,1.5].map(v=>v+start),valid:true}))}
  s.p.position=90
  const plan=rankChoices(s.a,[s.b],s.p.position,3).choices.find(c=>c.plan.start>=s.p.position+13&&c.plan.start<s.p.position+35)!.plan
  expect(plan).toBeDefined()
  expect(rankContinuousChoices(s.a,[s.b],s.p.position,3).choices.some(c=>c.plan.id===plan.id)).toBe(false)
  s.candidates.splice(0,s.candidates.length,{track:s.b,plan})
  s.run.direction({automatic:true});s.run.tick()
  await vi.waitFor(()=>expect(s.run.working).toBe(false))
  expect(s.run.phase).toBe('ready')
  expect(s.run.result?.plan.start).toBe(plan.start)
  expect(s.p.queueNativeNext).not.toHaveBeenCalled()
 }finally{s.run.dispose()}
})
it('resuming an ended reservation track cannot silently start an unmixed next song',async()=>{
 const s=await setup()
 try{
  s.p.position=s.a.duration;s.p.playing=false;s.p.paused=true
  s.run.direction({automatic:true})
  await expect(s.run.resume()).rejects.toThrow(/预约.*接点/)
  expect(s.p.start).toHaveBeenCalledTimes(1)
  expect(s.p.current.id).toBe(s.a.id)
  expect(s.p.logs.some((e:any)=>e.kind==='resume_ended_track')).toBe(false)
 }finally{s.run.dispose()}
})
it('one request survives three expired reserved preparations and continues with a later approved cue',async()=>{
 const s=await setup(),original=s.prepare.getMockImplementation()!
 try{
  s.candidates.push(...[40,50].map(position=>({track:s.b,plan:rankNearbyChoices(s.a,[s.b],position,3).best!.plan})))
  s.candidates.forEach((c,i)=>{c.plan.score=4-i})
  let attempts=0
  s.prepare.mockImplementation(async(...args)=>{if(++attempts<=3){s.p.position=args[3].start+.1;throw Object.assign(Error('cue expired'),{code:'cue_expired'})}return original(...args)})
  await s.run.mixSoon()
  expect(s.run.phase).toBe('waiting_approved')
  expect(s.p.arm).not.toHaveBeenCalled()
  ;(s.run as any).retryAt=0;s.run.tick()
  await vi.waitFor(()=>expect(s.p.arm).toHaveBeenCalledTimes(1))
  expect(s.p.arm.mock.calls[0][0].plan.start).toBe(s.candidates[3].plan.start)
 }finally{s.run.dispose()}
})
