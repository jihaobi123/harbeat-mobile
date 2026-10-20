import {afterEach,expect,it,vi} from 'vitest'
import {qualityTrack} from '../metric-upstream/continuous/qualityFixture'
import {MetricRun} from './metric'
const job='c'.repeat(64),runs:MetricRun[]=[]
function setup(options:{waitCloud?:()=>Promise<any>;waitMetadata?:(id:string)=>Promise<void>;cloudRunning?:boolean;waitAsset?:()=>Promise<void>;loadAsset?:(asset:any,signal?:AbortSignal)=>Promise<any>;failAsset?:boolean}={}){
 const tracks=['a','b','c'].map(id=>qualityTrack(id))
 for(const t of tracks)t.windows[0].variants=Object.fromEntries(tracks.map(a=>[a.id,{...t.windows[0].variants.a}]))
 const index:any={schema:'harbeat.continuous-library.v1',tracks:tracks.map(t=>({...t,detailUrl:t.id,playStatus:'ready',mixStatus:'ready',styleLabels:t.id==='c'?['House']:['Hip-Hop'],collection:'NAS'}))}
 let payload:any,failed=false
 const p:any={ctx:{resume:async()=>{}},current:null,position:0,transition:null,busy:false,playing:false,paused:false,buffering:false,logs:[],
  cache:{ready:new Set(),load:vi.fn(async(asset:any,signal?:AbortSignal)=>{if(options.loadAsset)return options.loadAsset(asset,signal);await options.waitAsset?.();if(options.failAsset&&!failed){failed=true;throw Error('one window unavailable')}return {}})},
  initialize:async()=>{},start:vi.fn(async(t:any)=>{p.current=t;p.playing=true;p.changed()}),arm:vi.fn(async(r:any,m:any,b:any)=>{p.transition={result:r,method:m,b}}),
  pause:vi.fn(()=>{p.paused=true;p.playing=false}),resume:vi.fn(async()=>{p.paused=false;p.playing=true}),stop:vi.fn(()=>{p.current=null;p.playing=false}),
  setVolume:vi.fn(),dispose:vi.fn(),export:()=>({logs:[]})}
 const result=()=>({schema:'harbeat.metric-mix-result.v1',id:job,status:'ready',policyVersion:'metric-mix-v1.0',codeVersion:'d'.repeat(64),
  plan:{...payload,end:payload.start+8,duration:8,rate:1,bStart:0,bEnd:8,beatErrorMs:0},
  assets:{original:{url:`/listen/smart-media/${job}/original.wav`,sha256:'e'.repeat(64),bytes:100,duration:8.008}},
  decision:{recommended:'original',methods:{original:{eligible:true,name:'原渐混'}}}})
 const host:any={requestFocus:()=>true,saveSession:vi.fn(),prepareMetric:vi.fn((json:string)=>{payload=JSON.parse(json);return JSON.stringify({ok:true,data:{id:job}})})}
 const read=vi.fn(async(path:string)=>{
  const t=tracks.find(t=>t.id===path);if(t){await options.waitMetadata?.(t.id);return {track:t}}
  if(options.cloudRunning)return {status:'running',message:'queued'}
  if(options.waitCloud)await options.waitCloud()
  return result()
 })
 const run=new MetricRun(index,new URL('https://example.test/listen/'),()=>{},host,(_base,changed)=>{p.changed=changed;return p},read)
 runs.push(run);return {run,p,host,read,tracks,result}
}
afterEach(()=>{runs.splice(0).forEach(r=>r.dispose());vi.restoreAllMocks();vi.useRealTimers()})
const finished=async(run:MetricRun)=>{await vi.waitFor(()=>expect(run.working).toBe(false))}
it('recommends, prepares, preloads and arms at the future cue with no manual prepare/apply',async()=>{
 const {run,p,host}=setup();run.direction({style:'Hip-Hop',energy:3});await run.start('a');run.tick();await finished(run)
 expect(run.result?.plan.to).toBe('b');expect(host.prepareMetric).toHaveBeenCalledTimes(1);expect(p.cache.load).toHaveBeenCalledTimes(2)
 expect(p.start).toHaveBeenCalledTimes(1);expect(p.arm).not.toHaveBeenCalled()
 p.position=run.result!.plan.start-9;run.tick();await finished(run)
 expect(p.arm).toHaveBeenCalledTimes(1);expect(p.arm.mock.calls[0][0].plan.to).toBe('b')
})
it('a completed handoff clears B and autonomously prepares the following song',async()=>{
 const {run,p,tracks}=setup();await run.start('a');run.tick();await finished(run)
 const b=tracks.find(t=>t.id===run.result!.plan.to)!
 p.position=run.result!.plan.start-9;run.tick();await finished(run)
 p.transition=null;p.current=b;p.position=8;p.changed();run.tick();await finished(run)
 expect(run.result?.plan.from).toBe(b.id);expect(run.result?.plan.to).not.toBe(b.id)
})
it('changing direction discards late cloud work while keeping A playing',async()=>{
 let release!:()=>void;const waiting=new Promise<void>(r=>release=r)
 const {run,p,host}=setup({waitCloud:()=>waiting});await run.start('a');run.tick()
 await vi.waitFor(()=>expect(host.prepareMetric).toHaveBeenCalledTimes(1))
 run.direction({style:'House',energy:3});release();await finished(run)
 expect(run.result).toBeNull();expect(p.start).toHaveBeenCalledTimes(1);expect(p.arm).not.toHaveBeenCalled();expect(p.current.id).toBe('a')
})
it('switching auto off or pausing prevents stale adoption and new automatic work',async()=>{
 const {run,p}=setup();await run.start('a');run.direction({automatic:false});run.tick()
 expect(run.working).toBe(false);expect(run.result).toBeNull()
 run.direction({automatic:true});run.pause();run.tick()
 expect(p.arm).not.toHaveBeenCalled();expect(run.result).toBeNull()
})
it('a rejected window tries another choice, with no interruption or invented hard cut',async()=>{
 const {run,p}=setup({failAsset:true});await run.start('a');run.tick();await finished(run)
 expect(run.result).not.toBeNull();expect(run.export().history.some(h=>h.kind==='candidate_failed')).toBe(true)
 expect(p.start).toHaveBeenCalledTimes(1);expect(p.arm).not.toHaveBeenCalled()
})
it('no compatible energy remains honest and does not restart A',async()=>{
 const {run,p,host}=setup();run.direction({energy:5});await run.start('a');run.tick();await finished(run)
 expect(run.phase).toBe('no_match');expect(host.prepareMetric).not.toHaveBeenCalled();expect(p.start).toHaveBeenCalledTimes(1);expect(p.arm).not.toHaveBeenCalled()
})
it('new preferences during a committed transition apply to the next song',async()=>{
 const {run,p}=setup();await run.start('a');run.tick();await finished(run)
 p.position=run.result!.plan.start-9;run.tick();await finished(run)
 const current=p.transition;run.direction({style:'House',energy:4})
 expect(p.transition).toBe(current);expect(run.targetStyle).toBe('House');expect(p.stop).not.toHaveBeenCalled()
})
it('a cloud result after the last cue cannot force a late cut',async()=>{
 let release!:()=>void;const waiting=new Promise<void>(r=>release=r)
 const {run,p,host}=setup({waitCloud:()=>waiting});await run.start('a');run.tick()
 await vi.waitFor(()=>expect(host.prepareMetric).toHaveBeenCalledTimes(1))
 p.position=79;release();await finished(run)
 expect(run.result).toBeNull();expect(p.arm).not.toHaveBeenCalled();expect(p.start).toHaveBeenCalledTimes(1)
 expect(host.prepareMetric).toHaveBeenCalledTimes(1)
})
it('backgrounding during an automatic cloud request cannot adopt it later',async()=>{
 let release!:()=>void;const waiting=new Promise<void>(r=>release=r)
 const {run,p,host}=setup({waitCloud:()=>waiting});await run.start('a');run.tick()
 await vi.waitFor(()=>expect(host.prepareMetric).toHaveBeenCalledTimes(1))
 run.pauseForHost();release();await finished(run)
 expect(run.result).toBeNull();expect(p.arm).not.toHaveBeenCalled();expect(p.playing).toBe(false)
})

it('a changed direction can prepare immediately while superseded metadata remains slow',async()=>{
 let release!:()=>void;const waiting=new Promise<void>(r=>release=r)
 const {run,p,host,read}=setup({waitMetadata:id=>id==='b'?waiting:Promise.resolve()})
 try{
  run.direction({style:'Hip-Hop'});await run.start('a');run.tick()
  await vi.waitFor(()=>expect(read).toHaveBeenCalledWith('b',expect.any(URL)))
  run.direction({style:'House'})
  await vi.waitFor(()=>{run.tick();expect(host.prepareMetric).toHaveBeenCalledTimes(1)},{timeout:300,interval:10})
  await finished(run);expect(run.result?.plan.to).toBe('c');expect(p.start).toHaveBeenCalledTimes(1)
 }finally{release()}
})
it('automatic cloud polling stops waiting once its cue expires',async()=>{
 vi.useFakeTimers()
 const {run,p,host}=setup({cloudRunning:true});await run.start('a');run.tick()
 await vi.waitFor(()=>expect(host.prepareMetric).toHaveBeenCalledTimes(1))
 const payload=JSON.parse(host.prepareMetric.mock.calls[0][0]);p.position=payload.start+1
 await vi.advanceTimersByTimeAsync(2100)
 expect(run.working).toBe(false);expect(run.result).toBeNull();expect(p.arm).not.toHaveBeenCalled()
 expect(host.prepareMetric).toHaveBeenCalledTimes(1)
})

it('a stalled audio download releases an expired cue and cannot adopt a late buffer',async()=>{
 vi.useFakeTimers();let release!:()=>void;const waiting=new Promise<void>(r=>release=r)
 const {run,p,host}=setup({waitAsset:()=>waiting});await run.start('a');run.tick()
 await vi.waitFor(()=>expect(p.cache.load).toHaveBeenCalledTimes(2))
 const payload=JSON.parse(host.prepareMetric.mock.calls[0][0]);p.position=payload.start+1
 await vi.advanceTimersByTimeAsync(300)
 expect(run.working).toBe(false);expect(run.result).toBeNull();expect(p.arm).not.toHaveBeenCalled()
 release();await Promise.resolve();await Promise.resolve()
 expect(run.result).toBeNull();expect(p.start).toHaveBeenCalledTimes(1)
})

it('a failed asset cancels its stalled sibling before trying another candidate',async()=>{
 let count=0,stalled:AbortSignal|undefined
 const {run,p}=setup({loadAsset:async(_asset,signal)=>{
  count++
  if(count===1)throw Error('one window unavailable')
  if(count===2){stalled=signal;return new Promise(()=>{})}
  return {}
 }})
 await run.start('a');run.tick();await finished(run)
 expect(run.result).not.toBeNull();expect(stalled?.aborted).toBe(true)
 expect(p.start).toHaveBeenCalledTimes(1);expect(p.arm).not.toHaveBeenCalled()
})
