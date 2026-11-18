import {it,expect,vi} from 'vitest'
import {CrossGenreSession} from './lifecycle'
import {enumerateCrossGenre} from './planner'
import {CompetitionSession} from '../competition/session'
it('executes the exact winning cue rather than replacing it with the nearest manual cue',async()=>{
 const s=setup(),e=s.a.profile.exits[0];s.a.profile.exits.push({...e,id:'later',time:40,voiceEnd:39.7,capture:{...e.capture,start:39,end:39.7}})
 const plan=enumerateCrossGenre(s.a.track,s.b.track,s.a.profile,s.b.profile,20,24).find(p=>p.exit===40)!
 await s.session.preparePlan(plan);await s.session.requestPlan(plan,24,false)
 expect(s.session.pending?.plan).toBe(plan);expect(s.session.pending?.plan.exit).toBe(40)
})
it('rejects changed source/geometry in a fixed winning plan before creating B',async()=>{
 const s=setup(),plan=enumerateCrossGenre(s.a.track,s.b.track,s.a.profile,s.b.profile,20,18)[0]
 await expect(s.session.preparePlan({...plan,entry:17})).rejects.toThrow();expect(s.port.createDeck).not.toHaveBeenCalled()
})
import {fixture} from './fixtures'
import {planCrossGenre} from './planner'

function setup(){
 const a=fixture(),b=fixture('b',129.7),ctx={currentTime:10},active={track:a.track,at:-10,offset:0,gain:{gain:{}},nodes:[{}]},decks:any[]=[]
 const state={active:active as any,position:20,playing:true,busy:false,locked:false},cache={protected:new Set<string>(),load:vi.fn(async()=>({})),dispose:vi.fn()},graph={end:22.4,cancel:vi.fn(),dispose:vi.fn()}
 const port:any={ctx,cache,active:()=>state.active,position:()=>state.position,playing:()=>state.playing,tracks:()=>[a.track,b.track],setBusy:(v:boolean)=>state.busy=v,setLocked:(v:boolean)=>state.locked=v,status:vi.fn(),notify:vi.fn(),log:vi.fn(),schedule:vi.fn(()=>graph),
  createDeck:vi.fn((track:any,at:number,offset:number)=>{const d={track,at,offset,gain:{gain:{}},nodes:[],stream:{pump:vi.fn(),pins:new Set(),deadline:100,error:null,late:false}};decks.push(d);return d}),retire:vi.fn(),commit:vi.fn((deck:any)=>state.active=deck)}
 const client:any={load:vi.fn(async(track:any)=>track.id==='a'?a.profile:b.profile)}
 // Native source descriptors are verified by AudioCache in production.
 for(const t of [a.track,b.track])t.native={url:t.id+'.flac',sha256:'a'.repeat(64),bytes:10,duration:120}
 return{a,b,state,ctx,port,client,graph,decks,session:new CrossGenreSession(port,client)}
}

it('prepares source data and B continuation before scheduling a native handoff',async()=>{
 const s=setup();await s.session.prepare(['b'],false)
 expect(s.session.automaticStart).toBeNull();expect(s.session.upcoming?.start).toBeLessThanOrEqual(32);expect(s.port.schedule).not.toHaveBeenCalled()
 await s.session.request('b',18)
 expect(s.session.pending?.plan).toMatchObject({family:'structural-cut',entry:16,exit:32,rate:1})
 expect(s.port.createDeck).toHaveBeenCalledWith(s.b.track,22,16,expect.anything())
 s.ctx.currentTime=22.01;s.session.tick();expect(s.port.commit).toHaveBeenCalledTimes(1);expect(s.session.pending).toBeNull()
 expect(s.state.active.offset).toBe(16);expect(s.state.busy).toBe(false)
})
it('superseded audio loads cannot create a deck or take over later',async()=>{
 const s=setup();let release!:(v:any)=>void;s.port.cache.load.mockImplementation(()=>new Promise(r=>release=r))
 const preparation=s.session.prepare(['b'],false);await new Promise(r=>setTimeout(r,0));s.session.cancelPreparation();release({})
 await expect(preparation).rejects.toMatchObject({name:'AbortError'});expect(s.port.createDeck).not.toHaveBeenCalled()
})
it('competition cancellation aborts the actual final native load before it can schedule B',async()=>{
 const s=setup();let release!:(v:any)=>void,signal:AbortSignal|undefined,calls=0
 s.a.track.sections=[{start:0,end:32} as any];s.b.track.sections=[{start:16,end:120} as any]
 s.port.cache.load.mockImplementation((_asset:any,arg:AbortSignal)=>++calls===2?new Promise(r=>{release=r;signal=arg}):Promise.resolve({}))
 const session=new CompetitionSession({active:s.port.active,position:s.port.position,now:()=>s.ctx.currentTime,tracks:s.port.tracks,energy:()=>3,client:()=>({...s.client,canExit:()=>true}),native:()=>s.session,materials:{materials:[],load:async()=>{},sha256:'a'.repeat(64)} as any,gradual:()=>[],warm:async()=>{},stem:()=>null,loadGradual:async()=>{},executeStem:async()=>{},executeFallback:async()=>{},log:()=>{},changed:()=>{}})
 const task=session.request('b',18,false),rejected=expect(task).rejects.toMatchObject({name:'AbortError'})
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'));session.cancel();expect(signal?.aborted).toBe(true);release({});await rejected
 expect(s.port.createDeck).not.toHaveBeenCalled();expect(s.port.schedule).not.toHaveBeenCalled();expect(s.session.pending).toBeNull()
})
it('cancels an unlocked plan, restores A and retires only B',async()=>{
 const s=setup();await s.session.prepare(['b'],false);await s.session.request('b',18);expect(s.session.cancel()).toBe(true)
 expect(s.graph.cancel).toHaveBeenCalled();expect(s.port.retire).toHaveBeenCalledWith(s.decks[0]);expect(s.state.active.track.id).toBe('a')
 s.ctx.currentTime=30;s.session.tick();expect(s.port.commit).not.toHaveBeenCalled()
})
it('uses the audio clock for lock and pause and forbids late replacement',async()=>{
 const s=setup();await s.session.prepare(['b'],false);await s.session.request('b',18)
 s.ctx.currentTime=21.9;s.session.tick();expect(s.state.locked).toBe(true);expect(s.session.cancel()).toBe(false)
 s.state.playing=false;s.session.tick();expect(s.port.commit).not.toHaveBeenCalled()
 s.ctx.currentTime=22.01;s.session.tick();expect(s.port.commit).toHaveBeenCalledTimes(1)
})
it('source changes during preparation leave the active music untouched',async()=>{
 const s=setup();s.client.load.mockImplementation(async(track:any)=>{s.state.active={...s.state.active};return track.id==='a'?s.a.profile:s.b.profile})
 await expect(s.session.prepare(['b'],false)).rejects.toMatchObject({name:'AbortError'});expect(s.port.schedule).not.toHaveBeenCalled()
})
it('stop removes feedback and preparation pins without delayed takeover',async()=>{
 const s=setup();await s.session.prepare(['b'],false);await s.session.request('b',18);s.session.stop()
 expect(s.graph.dispose).toHaveBeenCalled();expect(s.port.cache.protected.size).toBe(0);s.ctx.currentTime=40;s.session.tick();expect(s.port.commit).not.toHaveBeenCalled()
})

it('stop aborts the final native load and source mutation cannot schedule a stale deck',async()=>{
 const s=setup();await s.session.prepare(['b'],false)
 let signal:AbortSignal|undefined,release!:(v:any)=>void
 // First request preparation reuses the earlier load; pause only its final load.
 let calls=0;s.port.cache.load.mockImplementation((_asset:any,arg:AbortSignal)=>{calls++;if(calls===2){signal=arg;return new Promise(r=>release=r)}return Promise.resolve({})})
 const request=s.session.request('b',18);await new Promise(r=>setTimeout(r,0));s.session.stop()
 expect(signal?.aborted).toBe(true);release({});await expect(request).rejects.toMatchObject({name:'AbortError'})
 expect(s.port.createDeck).not.toHaveBeenCalled()
})

it('cancels an incoming scheduler failure before its audible handoff even after lock',async()=>{
 const s=setup();await s.session.request('b',18);s.ctx.currentTime=21.9
 s.decks[0].stream.error='chunk failed';s.session.tick()
 expect(s.session.pending).toBeNull();expect(s.graph.cancel).toHaveBeenCalled();expect(s.port.commit).not.toHaveBeenCalled()
 expect(s.state.active.track.id).toBe('a');expect(s.state.locked).toBe(false)
})
it('rejects a pending deck with no native coverage at the audible boundary',async()=>{
 const s=setup();await s.session.request('b',18);s.decks[0].stream.deadline=22;s.session.tick()
 expect(s.session.pending).toBeNull();expect(s.port.retire).toHaveBeenCalledWith(s.decks[0]);expect(s.port.commit).not.toHaveBeenCalled()
})

it('automatic fallback without a reusable preparation cannot select an intro exit',async()=>{
 const s=setup()
 await expect(s.session.request('b',120,true)).rejects.toThrow(/没有通过/)
 expect(s.session.pending).toBeNull();expect(s.port.createDeck).not.toHaveBeenCalled()
})

it('does not reuse a manual intro preparation as an automatic retention-qualified plan',async()=>{
 const s=setup();await s.session.prepare(['b'],false)
 expect(s.session.automaticStart).toBeNull()
 await expect(s.session.request('b',120,true)).rejects.toThrow(/没有通过/)
 expect(s.port.createDeck).not.toHaveBeenCalled()
})
it('reuses a qualified automatic plan at the normal eight second due point',async()=>{
 const s=setup(),exit=s.a.profile.exits[0]
 s.a.profile.exits=[{...exit,id:'late',time:96,voiceEnd:95.7,capture:{...exit.capture,start:95,end:95.7}}]
 await s.session.prepare(['b'],true);expect(s.session.automaticStart).toBeCloseTo(95.98)
 s.state.position=88;s.ctx.currentTime=78
 await s.session.request('b',30,true);expect(s.session.pending?.plan.exit).toBe(96)
})
