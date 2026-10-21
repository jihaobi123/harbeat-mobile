import {afterEach,expect,it,vi} from 'vitest'
import {MetricRun,validatePrepared,nativeMetricJob} from './metric'
vi.mock('../metric-upstream/continuous/beatAlignment',()=>({planContinuous:()=>({best:{start:30,window:{id:'w1'},rate:1}})}))
const aid='track-'+'a'.repeat(20),bid='track-'+'b'.repeat(20),job='c'.repeat(64)
const a:any={id:aid,title:'A',duration:120,bpm:100,native:{url:'/listen/media/a.flac'},windows:[],bars:[]}
const b:any={...a,id:bid,title:'B'}
const index:any={schema:'harbeat.continuous-library.v1',tracks:[a,b].map(t=>({...t,detailUrl:t.id,playStatus:'ready',mixStatus:'ready',styleLabels:['Hip-Hop'],collection:'NAS'}))}
function prepared():any{return {schema:'harbeat.metric-mix-result.v1',id:job,status:'ready',policyVersion:'metric-mix-v1.0',codeVersion:'d'.repeat(64),plan:{from:aid,to:bid,start:30,end:34,duration:4,rate:1,bStart:2,bEnd:6,beatErrorMs:12,windowId:'w1'},assets:{original:{url:`/listen/smart-media/${job}/original.wav`,sha256:'e'.repeat(64),bytes:100,duration:4.008}},decision:{recommended:'original',methods:{original:{eligible:true,name:'原渐混'},bass:{eligible:false,name:'贝斯'}}}}}
const runs:MetricRun[]=[]
function setup(read?:any){
 const p:any={ctx:{resume:async()=>{}},initialize:async()=>{},current:null,position:0,transition:null,busy:false,paused:false,
  start:vi.fn(async(t:any)=>{p.current=t}),pause:vi.fn(()=>{p.paused=true}),resume:vi.fn(),stop:vi.fn(()=>{p.current=null}),
  setVolume:vi.fn(),dispose:vi.fn(),export:()=>({logs:[]})}
 const host:any={requestFocus:()=>true,saveSession:vi.fn(),prepareMetric:()=>JSON.stringify({ok:true,data:{id:job}})}
 const load=read??vi.fn(async(path:string)=>path===aid?{track:a}:path===bid?{track:b}:prepared())
 const run=new MetricRun({...index,tracks:index.tracks.map((t:any)=>({...t}))},new URL('https://example.test/listen/'),()=>{},host,(_base,changed)=>{p.changed=changed;return p},load);runs.push(run)
 return {run,p,host}
}
afterEach(()=>{runs.splice(0).forEach(r=>r.dispose());vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers()})
it('choosing next keeps current audio and only prepare requests cloud measurements',async()=>{
 const {run,p}=setup();await run.start(aid);run.choose(bid);expect(p.start).toHaveBeenCalledTimes(1);expect(p.current.id).toBe(aid);expect(run.result).toBe(null)
 await run.prepare();expect(run.result?.id).toBe(job);expect(run.snapshot().canArm).toBe(true);expect(p.start).toHaveBeenCalledTimes(1)
})
it('cancel ignores a late cloud result without stopping the current song',async()=>{
 let done!:(x:any)=>void,entered!:(x?:any)=>void;const waiting=new Promise(r=>entered=r)
 const {run,p}=setup(async(path:string)=>path===aid?{track:a}:path===bid?{track:b}:(entered(),await new Promise(r=>done=r)))
 await run.start(aid);run.choose(bid);const preparing=run.prepare();await waiting;run.cancel();done(prepared());await preparing
 expect(run.result).toBe(null);expect(run.working).toBe(false);expect(p.current.id).toBe(aid);expect(p.stop).not.toHaveBeenCalled()
})
it('pause during preparation cancels its adoption and suspends current audio',async()=>{
 let done!:(x:any)=>void,entered!:(x?:any)=>void;const waiting=new Promise(r=>entered=r)
 const {run,p}=setup(async(path:string)=>path===aid?{track:a}:path===bid?{track:b}:(entered(),await new Promise(r=>done=r)))
 await run.start(aid);run.choose(bid);const preparing=run.prepare();await waiting;run.pause();done(prepared());await preparing
 expect(run.result).toBe(null);expect(p.pause).toHaveBeenCalledTimes(1);expect(p.current.id).toBe(aid)
})
it('backgrounding while metadata loads cannot start stale audio',async()=>{
 let done!:(x:any)=>void,entered!:(x?:any)=>void;const waiting=new Promise(r=>entered=r)
 const {run,p}=setup(async()=>{entered();return new Promise(r=>done=r)});const start=run.start(aid);await waiting;run.pauseForHost();done({track:a});await start;expect(p.start).not.toHaveBeenCalled()
})
it('an expired result remains auditionable but cannot claim an upcoming cue',async()=>{
 const {run,p}=setup();await run.start(aid);run.choose(bid);await run.prepare();p.position=40;expect(run.snapshot().canArm).toBe(false);expect(run.result?.id).toBe(job)
})
it('rejects a method that lacks a source-approved asset',async()=>{
 const {run}=setup();await run.start(aid);run.choose(bid);await run.prepare();expect(()=>run.selectMethod('bass')).toThrow('检查');expect(run.method).toBe('original')
})
it('handoff clears the selected B instead of offering to mix it into itself',async()=>{
 const {run,p}=setup();await run.start(aid);run.choose(bid);p.current=b;p.changed();expect(run.selected).toBe(null);expect(run.snapshot().notice).toContain('B')
})
it('native cloud requests return asynchronously and bind the reply to its request ID',async()=>{
 const events=new EventTarget();vi.stubGlobal('window',events)
 const host:any={requestMetric:vi.fn((id:number)=>{queueMicrotask(()=>events.dispatchEvent(Object.assign(new Event('harbeat-metric-result'),{detail:{id,reply:JSON.stringify({ok:true,data:{id:job}})}})))})}
 expect(await nativeMetricJob(host,{from:aid},new AbortController().signal)).toEqual({id:job});expect(host.requestMetric).toHaveBeenCalledTimes(1)
})
it('cancelled native requests reject immediately and ignore a late native reply',async()=>{
 const events=new EventTarget();vi.stubGlobal('window',events);let id=0
 const host:any={requestMetric:(value:number)=>{id=value}},controller=new AbortController()
 const pending=nativeMetricJob(host,{},controller.signal);const rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});controller.abort();await rejected
 events.dispatchEvent(Object.assign(new Event('harbeat-metric-result'),{detail:{id,reply:JSON.stringify({ok:true,data:{id:job}})}}))
})
it('validates exact pair, window, full hash, duration and fixed media paths',()=>{
 expect(validatePrepared(prepared(),a,b,30,'w1').id).toBe(job)
 for(const change of [(r:any)=>r.plan.to=aid,(r:any)=>r.plan.windowId='other',(r:any)=>r.plan.rate=1.2,(r:any)=>r.plan.beatErrorMs=66,(r:any)=>r.assets.original.sha256='bad',(r:any)=>r.assets.original.url='https://untrusted.test/a.wav',(r:any)=>r.assets.original.duration=8,(r:any)=>r.decision.recommended='bass']){
  const r=prepared();change(r);expect(()=>validatePrepared(r,a,b,30,'w1')).toThrow()
 }
})
function setManifest(){
 const proof=(id:string)=>({trackId:id,runId:'run',reportSha256:'a'.repeat(64),assets:{master:{sha256:'a'.repeat(64)},vocals:{sha256:'a'.repeat(64)}}})
 const source=(t:any)=>({...t,reportId:'report',provenance:{runId:'run',reportSha256:'a'.repeat(64),masterSha256:'a'.repeat(64),vocalSha256:'a'.repeat(64)},native:{...t.native,sha256:'a'.repeat(64),bytes:10,duration:120}})
 const tracks=[source(a),source(b)],result=prepared(),packId='f'.repeat(32);result.sourceProof={a:proof(aid),b:proof(bid)};result.assets.original.url=`/listen/set-media/${packId}/${job}/original.wav`
 return {tracks,manifest:{schema:'harbeat.activity-set.v1',packId,state:'ready',trackIds:[aid,bid],initialTrackId:aid,sourceFingerprints:tracks,results:[result]}}
}
it('a reservation restricts selection and reuses an exact prepared cue without a cloud submission',async()=>{
 const {tracks,manifest}=setManifest(),{run,host,p}=setup(async(path:string)=>({track:tracks.find(t=>t.id===path)}))
 host.prepareMetric=vi.fn(()=>{throw Error('should not submit')})
 p.logs=[];await run.setSession(manifest,'我的活动');expect(run.snapshot().activitySet?.trackCount).toBe(2)
 expect(()=>run.choose('outside')).toThrow('预约');await run.start(aid)
 const plan:any={start:30,end:34,rate:1,window:{id:'w1',start:2,end:6}}
 expect((await (run as any).automaticResult(p,tracks[0],tracks[1],plan,new AbortController().signal)).id).toBe(job)
 expect(host.prepareMetric).not.toHaveBeenCalled();run.clearSet();expect(run.snapshot().activitySet).toBe(null)
})
it('a slower session load cannot replace the latest reservation or restart after stop',async()=>{
 const {ActivitySession}=await import('./activity-session'),{run}=setup();let finish!:(v:any)=>void
 const old=new Promise<any>(resolve=>finish=resolve),session=(name:string)=>({packId:name,name,ids:new Set([aid,bid]),results:[],initialTrackId:aid})
 vi.spyOn(ActivitySession,'open').mockImplementationOnce(()=>old).mockResolvedValueOnce(session('new') as any)
 const first=run.setSession({},'old'),rejected=expect(first).rejects.toMatchObject({name:'AbortError'});await run.setSession({},'new');finish(session('old'));await rejected;expect(run.snapshot().activitySet?.packId).toBe('new')
})
it('refreshing after an import appends new tracks without replacing audio or an armed handoff',async()=>{
 const cid='track-'+'f'.repeat(20),entry={...index.tracks[0],id:cid,title:'Imported',detailUrl:cid}
 const {run,p}=setup(async(path:string)=>path===aid?{track:a}:path===bid?{track:b}:path==='/listen/library.json'?{...index,tracks:[{...index.tracks[0],title:'Changed'},index.tracks[1],entry]}:{track:{...a,id:cid}})
 await run.start(aid);run.choose(bid);const transition=p.transition={marker:'committed'};await run.refreshLibrary()
 expect(p.current).toBe(a);expect(p.start).toHaveBeenCalledTimes(1);expect(p.stop).not.toHaveBeenCalled();expect(p.transition).toBe(transition)
 expect(run.index.tracks.find(t=>t.id===aid)?.title).toBe('A');expect(run.index.tracks.some(t=>t.id===cid)).toBe(true);expect(run.selected).toBe(bid)
 await run.refreshLibrary();expect(run.index.tracks.filter(t=>t.id===cid)).toHaveLength(1)
})
