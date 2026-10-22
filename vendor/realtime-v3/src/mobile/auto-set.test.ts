import {afterEach,expect,it,vi} from 'vitest'
import {MetricRun} from './metric'
import {ActivitySession} from './activity-session'
import * as cache from './set-cache'
import * as prepare from './device-prepare'
import {qualityTrack} from '../metric-upstream/continuous/qualityFixture'
import {rankContinuousChoices,rankNearbyChoices} from './smart-selection'

afterEach(()=>vi.restoreAllMocks())
function setup(){
 const a=qualityTrack('a'),b=qualityTrack('b'),tracks=[a,b]
 const index:any={tracks:tracks.map(t=>({...t,detailUrl:t.id,styleLabels:['Hip-Hop'],playStatus:'ready',mixStatus:'ready',collection:'NAS'}))}
 const p:any={ctx:{sampleRate:44100,resume:async()=>{}},localExecution:true,initialize:async()=>{},current:null,position:20,playing:false,paused:true,busy:false,logs:[],cache:{ready:new Set()},start:vi.fn(async(t:any)=>{p.current=t}),stop:vi.fn(),setVolume:()=>{},dispose:()=>{},export:()=>({})}
 const run=new MetricRun(index,new URL('https://test.local/'),()=>{},undefined,()=>p,async id=>({track:tracks.find(t=>t.id===id)}))
 const session:any={packId:'a'.repeat(32),name:'Automatic',ids:new Set(['a','b']),tracks,initialTrackId:'a',results:[],candidateCount:24,strategyCount:24,strategyVersion:'jetson-decision-v1',assets:()=>[],cacheMetadata:async()=>{}}
 vi.spyOn(ActivitySession,'open').mockResolvedValue(session)
 vi.spyOn(cache,'cacheActivityAssets').mockResolvedValue({state:'ready',completed:20,total:20,bytes:1200,message:'ready'})
 return{run,p,session,a,b,index}
}
it('downloads automatically and attaches without restarting a playing source, after the committed transition',async()=>{
 const {run,p,session,a}=setup()
 try{
  await run.start(a.id);const calls=p.start.mock.calls.length
  await run.prepareAutoSet({},'Automatic')
  p.transition={};run.tick();expect(run.snapshot().activitySet).toBeNull()
  p.transition=null;run.tick()
  expect(run.snapshot().activitySet?.packId).toBe(session.packId)
  expect(p.current.id).toBe(a.id);expect(p.start).toHaveBeenCalledTimes(calls);expect(p.stop).not.toHaveBeenCalled()
  expect(run.autoPreparationStatus?.state).toBe('ready')
  expect(p.logs.map((x:any)=>x.kind)).toContain('automatic_set_downloaded')
 }finally{run.dispose()}
})
it('partial cache remains partial and cannot become an automatic ready set',async()=>{
 const {run,p}=setup()
 vi.mocked(cache.cacheActivityAssets).mockResolvedValue({state:'partial',completed:1,total:20,bytes:80,message:'partial'})
 try{await run.prepareAutoSet({},'Automatic');run.tick();expect(run.snapshot().activitySet).toBeNull();expect(run.autoPreparationStatus?.state).toBe('partial');expect(p.start).not.toHaveBeenCalled()}finally{run.dispose()}
})
it('an automatic prepared pool still allows a manual next song from the full library',async()=>{
 const {run,p,a,index}=setup(),c=qualityTrack('c')
 index.tracks.push({...c,detailUrl:c.id,styleLabels:['Hip-Hop'],playStatus:'ready',mixStatus:'ready',collection:'NAS'})
 try{
  await run.start(a.id);await run.prepareAutoSet({},'Automatic');run.tick()
  run.choose(c.id)
  expect(run.snapshot().selected).toBe(c.id);expect(p.current.id).toBe(a.id)
  expect((run as any).playbackEntries().some((t:any)=>t.id===c.id)).toBe(true)
  expect(p.start).toHaveBeenCalledTimes(1)
 }finally{run.dispose()}
})
it('cloud batch preparation does not flood fresh cue approvals or pause the current song',async()=>{
 const {run,p,a}=setup()
 const load=vi.spyOn(prepare,'prepareDevice')
 try{
  await run.start(a.id);p.playing=true;p.paused=false
  run.setAutoPreparationPending(true);run.tick()
  await Promise.resolve()
  expect(load).not.toHaveBeenCalled();expect(p.current.id).toBe(a.id)
  expect(run.phase).toBe('waiting_assets');expect(p.stop).not.toHaveBeenCalled()
 }finally{run.dispose()}
})
it('a late old-direction download cannot replace the new direction',async()=>{
 const {run}=setup();let finish!:(value:any)=>void
 vi.mocked(cache.cacheActivityAssets).mockImplementation(()=>new Promise(resolve=>finish=resolve))
 try{
  const loading=run.prepareAutoSet({},'Old')
  await vi.waitFor(()=>expect(finish).toBeTypeOf('function'))
  run.direction({energy:4});finish({state:'ready',completed:20,total:20,bytes:100,message:'ready'})
  await loading;run.tick();expect(run.snapshot().activitySet).toBeNull();expect(run.autoPreparationStatus).toBeNull()
 }finally{run.dispose()}
})
it('automatic selection uses a verified future approval rather than requesting an unrelated cold cue',async()=>{
 const {run,p,session,a,b}=setup()
 const plan=rankContinuousChoices(a,[b],20,3).best!.plan
 session.approvedCandidates=()=>[{track:b,plan}]
 vi.spyOn(prepare,'hasDevicePCM').mockReturnValue(true)
 vi.spyOn(prepare,'pinDevicePCM').mockReturnValue(()=>{})
 vi.spyOn(prepare,'loadPrepared').mockResolvedValue(undefined)
 const load=vi.spyOn(prepare,'prepareDevice').mockResolvedValue({schema:'harbeat.device-execution-plan.v1',id:'b'.repeat(64),status:'ready',plan:{...plan,from:a.id,to:b.id,windowId:plan.window.id,bStart:plan.window.start,bEnd:plan.window.end},execution:{schema:'harbeat.device-execution-plan.v1'},decision:{recommended:'bass_filter',methods:{bass_filter:{eligible:true,name:'bass_filter'}}},assets:{}} as any)
 try{
  await run.start(a.id);await run.prepareAutoSet({},'Automatic');run.tick()
  await (run as any).recommend()
  expect(load).toHaveBeenCalledTimes(1);expect(load.mock.calls[0][3].id).toBe(plan.id)
  expect(run.result?.decision.recommended).toBe('bass_filter');expect(p.start).toHaveBeenCalledTimes(1)
 }finally{run.dispose()}
})
it('automatic cached selection retains the original quality policy instead of taking a nearby manual cue',async()=>{
 const {run,p,session,a,b}=setup()
 const early=rankNearbyChoices(a,[b],35,3).best!.plan
 const automatic=rankContinuousChoices(a,[b],20,3).best!.plan
 expect(early.end).toBeLessThan(a.duration*.65)
 expect(automatic.end).toBeGreaterThanOrEqual(a.duration*.65)
 session.approvedCandidates=()=>[{track:b,plan:early},{track:b,plan:automatic}]
 vi.spyOn(prepare,'hasDevicePCM').mockReturnValue(true)
 vi.spyOn(prepare,'pinDevicePCM').mockReturnValue(()=>{})
 vi.spyOn(prepare,'loadPrepared').mockResolvedValue(undefined)
 const load=vi.spyOn(prepare,'prepareDevice').mockImplementation(async(_p,_a,_b,plan)=>({schema:'harbeat.device-execution-plan.v1',id:'b'.repeat(64),status:'ready',plan:{...plan,from:a.id,to:b.id,windowId:plan.window.id,bStart:plan.window.start,bEnd:plan.window.end},execution:{schema:'harbeat.device-execution-plan.v1'},decision:{recommended:'bass_filter',methods:{bass_filter:{eligible:true,name:'bass_filter'}}},assets:{}} as any))
 try{
  await run.start(a.id);await run.prepareAutoSet({},'Automatic');run.tick()
  await (run as any).recommend()
  expect(load).toHaveBeenCalledTimes(1)
  expect(load.mock.calls[0][3].id).toBe(automatic.id)
  expect(run.result?.plan.start).toBe(automatic.start)
 }finally{run.dispose()}
})
