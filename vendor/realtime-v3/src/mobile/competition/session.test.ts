import {it,expect,vi} from 'vitest'
import {CompetitionSession} from './session'
import {jetsonFixture} from '../jetson-test-fixture'
import {fixture} from '../crossgenre/fixtures'
async function setup(){
 const f=await jetsonFixture(),source={track:f.a},state={source,position:10,now:0},a=fixture(),b=fixture('b',120)
 for(const [p,t] of [[a.profile,f.a],[b.profile,f.b]] as const){p.source={...p.source,trackId:t.id,reportId:t.reportId!,...t.provenance!};p.duration=t.duration;p.exits.forEach(e=>{e.localBpm=120});p.entries.forEach(e=>e.localBpm=120)}
 for(const [p,t] of [[a.profile,f.a],[b.profile,f.b]] as const){t.reportId='d'.repeat(64);p.source.reportId=t.reportId}
 const approval:any={...f.result,decision:{...f.result.decision,methods:{...f.result.decision.methods,bass:{...f.result.decision.methods.bass,score:50}}}}
 const native={cancelPreparation:vi.fn(),preparePlan:vi.fn(async()=>f.b.id),requestPlan:vi.fn(async()=>{})},port:any={active:()=>state.source,position:()=>state.position,now:()=>state.now,tracks:()=>[f.a,f.b],energy:()=>3,client:()=>({canExit:()=>true,load:async(t:any)=>t.id===f.a.id?a.profile:b.profile}),native:()=>native,materials:{materials:[],sha256:'a'.repeat(64),load:async()=>{}},gradual:()=>[f.p],warm:async()=>{},stem:()=>approval,loadGradual:vi.fn(async()=>{}),executeStem:vi.fn(async()=>{}),executeFallback:vi.fn(async()=>{}),log:vi.fn(),changed:vi.fn()}
 return{...f,ap:a.profile,bp:b.profile,state,port,native,session:new CompetitionSession(port)}
}
it('does not warm or adopt a tail-only fallback when continuous-set preparation is unavailable',async()=>{
 const f=await setup();f.port.client=()=>null;f.port.continuation=()=>({allowed:false,code:'continuation-window-unavailable',reason:'下一跳准备空间不足',reserveSeconds:60});f.port.warm=vi.fn(async()=>{})
 await expect(f.session.prepare([f.b.id],true)).rejects.toThrow(/下一跳/);expect(f.port.loadGradual).not.toHaveBeenCalled();expect(f.port.warm).not.toHaveBeenCalled()
})
it('applies the additional resource condition to native automatic candidates while leaving manual playback unchanged',async()=>{
 const f=await setup();f.port.gradual=()=>[];f.port.continuation=()=>({allowed:false,code:'continuation-window-unavailable',reason:'下一跳准备空间不足',reserveSeconds:60})
 f.ap.exits=[{...f.ap.exits[0],time:64,voiceEnd:63.7,capture:{...f.ap.exits[0].capture,start:63,end:63.7}}];f.a.sections=[{start:0,end:64} as any];f.b.sections=[{start:16,end:f.b.duration} as any]
 await expect(f.session.prepare([f.b.id],true)).rejects.toThrow(/下一跳/);expect(f.native.preparePlan).not.toHaveBeenCalled()
 await f.session.prepare([f.b.id],false,60);expect(f.session.upcoming?.kind).toBe('native')
})
it('selects a reliable cut even though the exact same pair has an approved gradual stem method',async()=>{
 const f=await setup();await f.session.prepare([f.b.id],false,30)
 expect(f.session.upcoming?.method).toBe('structural-cut');await f.session.request(f.b.id,30,false)
 expect(f.native.requestPlan).toHaveBeenCalled();expect(f.port.executeStem).not.toHaveBeenCalled();expect(f.port.executeFallback).not.toHaveBeenCalled()
 expect(f.session.snapshot().methods.bass.eligible).toBe(true)
})
it('uses gradual only as explicit manual fallback and keeps automatic no-winner requests on A',async()=>{
 const f=await setup();f.port.client=()=>null;f.port.stem=()=>null
 await expect(f.session.request(f.b.id,18,true)).rejects.toThrow();expect(f.port.executeFallback).not.toHaveBeenCalled()
 await f.session.request(f.b.id,18,false);expect(f.port.executeFallback).toHaveBeenCalledTimes(1);expect(f.session.snapshot().fallback).toBe(true)
})
it('cannot execute a late native preparation after cancellation or source replacement',async()=>{
 const f=await setup();let release!:()=>void;f.native.preparePlan.mockImplementation(()=>new Promise<void>(r=>release=r) as any)
 const p=f.session.request(f.b.id,30,false),rejected=expect(p).rejects.toMatchObject({name:'AbortError'})
 await vi.waitFor(()=>expect(f.native.preparePlan).toHaveBeenCalled());f.session.cancel();release();await rejected;expect(f.native.requestPlan).not.toHaveBeenCalled()
})
it('does not lose cancellation while automatic preparation is waiting for a cold stem job',async()=>{
 const f=await setup();f.port.client=()=>null;f.port.stem=()=>null;f.port.warm=()=>new Promise(()=>{})
 const p=f.session.prepare([f.b.id],true),rejected=expect(p).rejects.toMatchObject({name:'AbortError'});await Promise.resolve();f.session.cancel();await rejected
})
it('waits for bounded cold stem evidence before choosing even when a native candidate is already eligible',async()=>{
 const f=await setup();let release!:()=>void,ready=false;const approved=f.port.stem()
 f.port.stem=()=>ready?approved:null;f.port.warm=()=>new Promise<void>(r=>release=()=>{ready=true;r()})
 const task=f.session.prepare([f.b.id],false,30);await vi.waitFor(()=>expect(release).toBeTypeOf('function'))
 expect(f.native.preparePlan).not.toHaveBeenCalled();release();await task
 expect(f.session.snapshot().methods.bass.eligible).toBe(true)
})
it('tries a fifth qualified candidate before permitting manual gradual fallback',async()=>{
 const f=await setup(),result:any={rows:[],fallback:null};let failed=0
 const base:any={id:'x',kind:'stem',method:'bass',score:90,eligible:true,reason:'',plan:{...f.p,start:15,end:20}}
 result.rows=Array.from({length:5},(_,i)=>({...base,id:String(i),score:90-i}))
 ;(f.session as any).evaluate=async()=>{f.session.rows=result.rows;return result}
 f.port.loadGradual=async()=>{if(++failed<5)throw Error('PCM unavailable')}
 await f.session.request(f.b.id,30,false);expect(failed).toBe(5);expect(f.port.executeStem).toHaveBeenCalledTimes(1);expect(f.port.executeFallback).not.toHaveBeenCalled()
})
it('bounds cold warming by a frozen automatic cue at its normal eight-second trigger',async()=>{
 const f=await setup();f.ap.exits=[{...f.ap.exits[0],time:64,voiceEnd:63.7,capture:{...f.ap.exits[0].capture,start:63,end:63.7}}];f.a.sections=[{start:0,end:64} as any];f.b.sections=[{start:16,end:f.b.duration} as any];f.port.gradual=()=>[]
 await f.session.prepare([f.b.id],true);const old=f.session.upcoming!;expect(old).toBeTruthy();f.state.position=old.plan.start-8
 f.port.gradual=()=>[{...f.p,start:110,end:114}];f.port.stem=()=>null;f.port.warm=()=>new Promise(()=>{});f.native.requestPlan.mockClear()
 vi.useFakeTimers()
 try{const task=f.session.request(f.b.id,30,true);for(let i=0;i<20;i++)await Promise.resolve();f.state.position+=6;f.state.now+=6;await vi.advanceTimersByTimeAsync(6000);await task
  expect(f.native.requestPlan).toHaveBeenCalledWith(old.plan,24,true);expect(f.port.executeFallback).not.toHaveBeenCalled()
 }finally{vi.useRealTimers()}
})
it('honors a prepared manual cue within its original thirty-second deadline instead of discarding it at eighteen seconds',async()=>{
 const f=await setup();f.port.gradual=()=>[];await f.session.prepare([f.b.id],false,30);const old=f.session.upcoming!
 expect(old.plan.end-f.state.position).toBeGreaterThan(18)
 await f.session.request(f.b.id,18,false);expect(f.native.requestPlan).toHaveBeenCalledWith(old.plan,22.5,false);expect(f.port.executeFallback).not.toHaveBeenCalled()
})
it('shows the actual gradual fallback after every prepared creative execution becomes unavailable',async()=>{
 const f=await setup();f.port.gradual=()=>[];await f.session.prepare([f.b.id],false,30);expect(f.session.snapshot().recommended).not.toBe('original')
 f.native.preparePlan.mockRejectedValue(Error('asset missing'));await f.session.request(f.b.id,30,false)
 expect(f.port.executeFallback).toHaveBeenCalled();expect(f.session.snapshot().fallback).toBe(true);expect(f.session.snapshot().recommended).toBe('original');expect(f.session.choice).toBeNull()
})
it('reselects the manual fallback after cold warming has passed the original nearest cue',async()=>{
 const f=await setup(),old={...f.p,start:12,end:16},fresh={...f.p,id:'fresh',start:26,end:30};f.port.client=()=>null;f.port.stem=()=>null
 f.port.gradual=()=>[f.state.position<20?old:fresh];f.port.warm=async()=>{f.state.position=23;f.state.now=13}
 f.port.loadGradual.mockImplementation(async(p:any)=>{if(p.start<f.state.position)throw Error('cue expired')})
 await f.session.prepare([f.b.id],false,30);expect(f.port.loadGradual).toHaveBeenCalledWith(fresh,expect.anything());expect(f.session.snapshot().state).toBe('fallback-ready')
})
it('skips a fallback cue inside the scheduling lead and prepares a later candidate within the same deadline',async()=>{
 const f=await setup(),near={...f.p,id:'too-near',start:10.45,end:15},later={...f.p,id:'later',start:20,end:25};f.port.client=()=>null;f.port.stem=()=>null;f.port.gradual=()=>[near,later]
 await f.session.prepare([f.b.id],false,30)
 expect(f.port.loadGradual).toHaveBeenCalledWith(later,expect.anything());expect(f.port.loadGradual).not.toHaveBeenCalledWith(near,expect.anything());expect(f.session.snapshot().state).toBe('fallback-ready')
 expect(f.session.upcomingFallback).toBe(later);f.state.source={track:f.a};expect(f.session.upcomingFallback).toBeNull()
})
it('keeps an automatic candidate loading beyond twelve seconds while its approved cue is still ahead',async()=>{
 const f=await setup(),plan={...f.p,start:170,end:174};f.a.duration=240;f.a.sections=[{start:0,end:174} as any];f.b.sections=[{start:plan.window.start,end:f.b.duration} as any];f.port.client=()=>null;f.port.gradual=()=>[plan]
 let ready=false,settled=false;const approved=f.port.stem();approved.decision.methods.bass.score=85;f.port.stem=()=>ready?approved:null
 vi.useFakeTimers()
 try{
  f.port.warm=()=>new Promise<void>(resolve=>setTimeout(()=>{ready=true;resolve()},40000))
  const task=f.session.prepare([f.b.id],true).then(id=>{settled=true;return id});const outcome=task.catch(e=>e)
  await vi.advanceTimersByTimeAsync(12001);expect(settled).toBe(false);expect(f.session.phase).toBe('preparing')
  f.state.position=50;f.state.now=40;await vi.advanceTimersByTimeAsync(28000)
  const result=await outcome;expect(result).toBe(f.b.id);expect(f.session.automaticStart).toBe(170)
 }finally{vi.useRealTimers()}
})
it('executes a source-revalidated reservation using the Jetson recommended eligible method without a second phone scoring veto',async()=>{
 const f=await setup();f.p.aVocal=.6;f.p.bVocal=.6;f.port.reservation=()=>true;f.port.client=()=>null;f.port.stem=()=>f.result
 await f.session.prepare([f.b.id],true);expect(f.session.upcoming?.method).toBe(f.result.decision.recommended)
 await f.session.request(f.b.id,30,true);expect(f.port.executeStem).toHaveBeenCalled();expect(f.port.executeFallback).not.toHaveBeenCalled()
})
it('never substitutes another creative method or native effect for an unexecutable reservation recommendation',async()=>{
 const f=await setup();f.port.reservation=()=>true
 const approved={...f.result,decision:{...f.result.decision,methods:{...f.result.decision.methods,bass:{...f.result.decision.methods.bass,eligible:false},filter:{...f.result.decision.methods.bass,eligible:true,score:99}}}}
 f.port.stem=()=>approved
 await expect(f.session.request(f.b.id,30,true)).rejects.toThrow();expect(f.port.executeStem).not.toHaveBeenCalled();expect(f.native.requestPlan).not.toHaveBeenCalled();expect(f.port.executeFallback).not.toHaveBeenCalled()
})
it('retains the full frozen manual deadline for an eligible saved Jetson recommendation below the unrelated local score threshold',async()=>{
 const f=await setup(),plan={...f.p,start:28,end:36};f.port.reservation=()=>true;f.port.client=()=>null;f.port.gradual=()=>[plan]
 const approved={...f.result,decision:{...f.result.decision,methods:{...f.result.decision.methods,bass:{...f.result.decision.methods.bass,score:55}}}};f.port.stem=()=>approved
 await f.session.prepare([f.b.id],false,30);await f.session.request(f.b.id,18,false)
 expect(f.port.executeStem).toHaveBeenCalledWith(expect.objectContaining({method:'bass',score:55}),26.5,false);expect(f.port.executeFallback).not.toHaveBeenCalled()
})
it('prepares and executes a qualified automatic gradual cue when creative material is unavailable',async()=>{
 const f=await setup(),p={...f.p,start:60,end:68};f.port.client=()=>null;f.port.stem=()=>null;f.port.gradual=()=>[p]
 await expect(f.session.prepare([f.b.id],true)).resolves.toBe(f.b.id)
 expect(f.session.upcomingFallback).toEqual(p);expect(f.session.automaticStart).toBe(60)
 f.state.position=52;await f.session.request(f.b.id,27,true)
 expect(f.port.executeFallback).toHaveBeenCalledWith(f.b.id,27,true,p)
 expect(f.session.snapshot().fallback).toBe(true);expect(f.port.executeStem).not.toHaveBeenCalled()
})
it('never uses an early or expired cue as an automatic gradual fallback',async()=>{
 const f=await setup();f.port.client=()=>null;f.port.stem=()=>null
 await expect(f.session.prepare([f.b.id],true)).rejects.toThrow();expect(f.port.loadGradual).not.toHaveBeenCalled()
 f.state.position=70;f.port.gradual=()=>[{...f.p,start:60,end:68}]
 await expect(f.session.request(f.b.id,9,true)).rejects.toThrow();expect(f.port.executeFallback).not.toHaveBeenCalled()
})
it('continues to later stem windows before falling back when automatic preparation has time',async()=>{
 const f=await setup();f.port.client=()=>null;const ready=new Set<string>(),approved=f.port.stem();approved.decision.methods.bass.score=85
 const plans=Array.from({length:3},(_,i)=>({...f.p,id:'window-'+i,start:60+i*2,end:68+i*2}))
 f.a.sections=[{start:0,end:72} as any];f.b.sections=[{start:f.p.window.start,end:80} as any];f.port.gradual=()=>plans;f.port.stem=(p:any)=>ready.has(p.id)?approved:null
 f.port.warm=vi.fn(async(p:any)=>{if(p.id==='window-2')ready.add(p.id)})
 await f.session.prepare([f.b.id],true)
 expect(f.port.warm).toHaveBeenCalledWith(plans[2]);expect(f.session.upcoming?.plan.id).toBe('window-2');expect(f.session.upcomingFallback).toBeNull()
})
it('keeps a nonterminal preparation message between cold batches with no winner yet',async()=>{
 const f=await setup();f.port.client=()=>null;f.port.stem=()=>null
 let release!:()=>void,calls=0
 ;(f.session as any).evaluate=async()=>{if(++calls===2)await new Promise<void>(r=>release=r);return{rows:[],fallback:null,hasDeferred:calls===1}}
 const task=f.session.prepare([f.b.id],true)
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'))
 const during=f.session.snapshot();release();await expect(task).rejects.toThrow()
 expect(during.state).toBe('preparing');expect(during.reason).toContain('正在');expect(during.reason).not.toContain('共同门槛')
 expect(f.session.phase).toBe('unavailable')
})
it('describes the actual validated automatic fallback while arming instead of reporting no executable plan',async()=>{
 const f=await setup(),p={...f.p,start:60,end:68};f.port.client=()=>null;f.port.stem=()=>null;f.port.gradual=()=>[p]
 await f.session.prepare([f.b.id],true);f.state.position=52
 await f.session.request(f.b.id,27,true)
 expect(f.session.snapshot()).toMatchObject({state:'fallback',fallback:true,recommended:'original'})
 expect(f.session.reason).toContain('渐进交接');expect(f.session.reason).not.toContain('没有达到共同门槛')
})
it('reports a real fallback scheduling failure as unavailable without concealing its cause',async()=>{
 const f=await setup();f.port.client=()=>null;f.port.stem=()=>null;f.port.executeFallback.mockRejectedValue(Error('接点已过'))
 await expect(f.session.request(f.b.id,18,false)).rejects.toThrow('接点已过')
 expect(f.session.snapshot()).toMatchObject({state:'unavailable',reason:'接点已过',fallback:false})
})
it('does not spend the two-window PCM allowance on unpublished pairs ahead of a published pair',async()=>{
 const f=await setup();f.port.client=()=>null;const ready=new Set<string>(),approved=f.port.stem();approved.decision.methods.bass.score=85
 const plans=Array.from({length:3},(_,i)=>({...f.p,id:'window-'+i,start:60+i*2,end:68+i*2}))
 f.a.sections=[{start:0,end:72} as any];f.b.sections=[{start:f.p.window.start,end:80} as any];f.port.gradual=()=>plans;f.port.stem=(p:any)=>ready.has(p.id)?approved:null
 f.port.stemStatus=(p:any)=>({canPrepare:p.id==='window-2',code:p.id==='window-2'?'pending':'source-unpublished',reason:'source publication checked'})
 f.port.warm=vi.fn(async(p:any)=>{ready.add(p.id)})
 await f.session.prepare([f.b.id],true)
 expect(f.port.warm).toHaveBeenCalledTimes(1);expect(f.port.warm).toHaveBeenCalledWith(plans[2]);expect(f.session.upcoming?.plan.id).toBe('window-2')
})

it('does not restart cold stem warming at the eight-second trigger of a prepared automatic baseline',async()=>{
 const f=await setup(),p={...f.p,start:60,end:68};f.port.client=()=>null;f.port.stem=()=>null;f.port.gradual=()=>[p];f.port.warm=vi.fn(async()=>{})
 await f.session.prepare([f.b.id],true);f.port.warm.mockClear();f.port.warm.mockImplementation(()=>new Promise(()=>{}));f.state.position=52
 await f.session.request(f.b.id,27,true);expect(f.port.warm).not.toHaveBeenCalled();expect(f.port.executeFallback).toHaveBeenCalled()
})
it('preserves a later prepared stem alternative when loading the first one passes its cue',async()=>{
 const f=await setup(),p1={...f.p,id:'first',start:12,end:16},p2={...f.p,id:'later',start:20,end:24},ready=new Set([p1.id,p2.id]),approved=f.port.stem()
 const rows=[p1,p2].map((plan,i)=>({id:plan.id,plan,kind:'stem',method:'bass',score:90-i,eligible:true,reason:'',experimental:false}))
 ;(f.session as any).evaluate=async()=>{f.session.rows=rows as any;return{rows,fallback:null}}
 f.port.client=()=>null;f.port.stem=(p:any)=>ready.has(p.id)?approved:null
 f.port.retainStem=(p:any,committed:boolean)=>{if(committed)for(const id of ready)if(id!==p?.id)ready.delete(id)}
 f.port.loadGradual=async(p:any)=>{if(p===p1)f.state.position=13}
 await f.session.prepare([f.b.id],false,30)
 expect(f.session.upcoming?.plan.id).toBe(p2.id);expect(ready.has(p2.id)).toBe(true)
})

it('prepares an automatic baseline before cold stems and preserves its eight-second execution trigger',async()=>{
 const f=await setup(),p={...f.p,start:60,end:68};f.a.duration=120;f.port.client=()=>null;f.port.stem=()=>null;f.port.gradual=()=>[p];f.port.warm=vi.fn(()=>new Promise(()=>{}))
 vi.useFakeTimers()
 try{
  const task=f.session.prepare([f.b.id],true),outcome=task.catch(e=>e)
  await vi.advanceTimersByTimeAsync(1)
  expect(f.port.loadGradual).toHaveBeenCalledWith(p,expect.anything())
  f.state.position=52;f.state.now=42;await vi.advanceTimersByTimeAsync(42000)
  expect(await outcome).toBe(f.b.id);expect(f.session.automaticStart).toBe(60);expect(f.session.phase).toBe('fallback-ready')
 }finally{f.session.cancel();vi.useRealTimers()}
})
it('reports missing cue evidence instead of a score failure when no candidate was ever generated',async()=>{
 const f=await setup();f.port.client=()=>null;f.port.gradual=()=>[];f.port.gradualDiagnostics=()=>[{code:'vocal_overlap_unavailable',reason:'当前歌曲的人声报告来源不一致',count:1}]
 await expect(f.session.prepare([f.b.id],true)).rejects.toThrow(/人声报告来源不一致/)
 expect(f.session.reason).not.toContain('共同门槛');expect(f.session.phase).toBe('unavailable')
})
it('keeps the actual baseline download error instead of misreporting musical incompatibility',async()=>{
 const f=await setup(),p={...f.p,start:60,end:68};f.port.client=()=>null;f.port.gradual=()=>[p];f.port.stem=()=>null;f.port.stemStatus=()=>({canPrepare:false,code:'source-unpublished',reason:'素材尚未发布'});f.port.loadGradual.mockRejectedValue(Error('音频下载失败 503'))
 await expect(f.session.prepare([f.b.id],true)).rejects.toThrow(/音频下载失败 503/)
 expect(f.session.reason).not.toContain('共同门槛')
})
it('uses the protected automatic baseline at the trigger even if newly cached assets reorder other cues',async()=>{
 const f=await setup(),p={...f.p,start:60,end:68},newlyRanked={...f.p,id:'now-ranked-first',start:55,end:63};f.a.duration=120;f.port.client=()=>null;f.port.stem=()=>null;f.port.stemStatus=()=>({canPrepare:false,code:'source-unpublished',reason:'not published'});f.port.gradual=()=>[p]
 await f.session.prepare([f.b.id],true);f.state.position=52;f.port.gradual=()=>[newlyRanked,p]
 await f.session.request(f.b.id,27,true)
 expect(f.port.executeFallback).toHaveBeenCalledWith(f.b.id,27,true,p)
})
it('warms a verified arrangement priority before other cold windows and still waits for executable PCM',async()=>{
 const f=await setup();f.port.client=()=>null;f.port.reservation=()=>true;const ready=new Set<string>(),approved=f.port.stem();approved.decision.methods.bass.score=85
 const plans=Array.from({length:3},(_,i)=>({...f.p,id:'window-'+i,start:60+i*2,end:68+i*2}));f.port.gradual=()=>plans;f.port.stem=(p:any)=>ready.has(p.id)?approved:null;f.port.warmPriority=(p:any)=>p.id==='window-2'?1000:0
 f.port.warm=vi.fn(async(p:any)=>{if(p.id==='window-2')ready.add(p.id)})
 await f.session.prepare([f.b.id],true)
 expect(f.port.warm.mock.calls[0][0]).toBe(plans[2]);expect(f.port.warm).toHaveBeenCalledTimes(2);expect(f.session.upcoming?.plan.id).toBe('window-2')
})

it('prewarms the exact protected automatic cue before other cold windows',async()=>{
 const f=await setup(),baseline={...f.p,id:'z-protected',start:70,end:78}
 const alternatives=[{...baseline,id:'a-cold',start:64,end:72},{...baseline,id:'b-cold',start:66,end:74}]
 f.a.duration=120;f.a.sections=[{start:0,end:78} as any];f.b.sections=[{start:f.p.window.start,end:80} as any]
 const approved=f.port.stem();approved.decision.methods.bass.score=85
 let ready=false
 f.port.client=()=>null;f.port.gradual=()=>[baseline,...alternatives];f.port.warmPriority=(p:any)=>p.id===baseline.id?0:1
 f.port.stem=(p:any)=>p.id===baseline.id&&ready?approved:null
 f.port.warm=vi.fn(async(p:any)=>{if(p.id===baseline.id)ready=true})
 await f.session.prepare([f.b.id],true)
 expect(f.port.warm.mock.calls[0][0]).toBe(baseline)
 expect(f.session.upcoming?.plan.id).toBe(baseline.id)
})
