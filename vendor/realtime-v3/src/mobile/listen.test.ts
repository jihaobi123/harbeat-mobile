import {describe,it,expect,vi} from 'vitest'
import {ListenRun,loadListenIndex} from './listen'
import {ActivitySession} from './activity-session'

const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()}
function fixture(ids=['a','b','c']){
 const tracks=ids.map(id=>({id,title:id,bpm:100,duration:240,native:{},windows:[],bars:[]}))
 const index:any={schema:'harbeat.continuous-library.v1',tracks:tracks.map(t=>({...t,collection:'web',styleLabels:['Hip-Hop'],detailUrl:t.id+'.json',playStatus:'ready',mixStatus:'ready'}))}
 const p:any={current:tracks[0],tracks,playing:true,paused:false,busy:false,pending:null,position:40,automaticStart:200,ctx:{currentTime:0,state:'running',suspend:vi.fn(async()=>{})},gate:{locked:false},cache:{sizeMB:0},logs:[],
 initialize:vi.fn(async()=>{}),setVolume:vi.fn(),cancel:vi.fn(),cancelAutomatic:vi.fn(),cancelPreparation:vi.fn(),prepareNext:vi.fn(async()=>{}),prepareAutomatic:vi.fn(async(ids:string[])=>ids[0]),queueSetContinuation:vi.fn(async()=>{}),request:vi.fn(async()=>{}),start:vi.fn(async()=>{}),stop:vi.fn(),togglePause:vi.fn(async()=>{p.paused=!p.paused}),seek:vi.fn(async()=>{}),export:()=>({}),dispose:vi.fn(),log:vi.fn()}
 const run=new ListenRun(index,new URL('https://appassets.androidplatform.net/listen/'),vi.fn(),undefined,()=>p,async(file:string)=>({track:tracks.find(t=>file===t.id+'.json')}))
 run.player=p
 return{run,p,tracks,index}
}
it('resets stale B selection after same-track A return without counting another full play',async()=>{
 const {run,p}=fixture();p.liveLayeringReturnRevision=0;run.tick();await flush();expect((run.export() as any).playHistory).toEqual([{id:'a',count:1}]);run.next.state={id:'b',status:'ready',error:''};p.prepareAutomatic.mockClear();p.position=100;p.liveLayeringReturnRevision=1;run.tick();await flush();expect(p.prepareAutomatic).toHaveBeenCalledTimes(1);expect((run.export() as any).playHistory).toEqual([{id:'a',count:1}]);run.tick();await flush();expect(p.prepareAutomatic).toHaveBeenCalledTimes(1)
})
it('freezes an arranged outcome and passes an idle return choice into transport preparation',async()=>{
 const {run,p}=fixture();p.configureLiveLayering=vi.fn(async()=>{});await run.setLiveLayering(true,'return-a');expect(p.configureLiveLayering).toHaveBeenLastCalledWith(true,run.base,'return-a');p.liveLayeringPending={plan:{from:'a',to:'a'}};await expect(run.setLiveLayering(true,'takeover-b')).rejects.toThrow();expect(p.configureLiveLayering).toHaveBeenCalledTimes(1)
})
it('automatically arms a fully prepared longmix before the ordinary fallback, keeping history until native B takeover',async()=>{
 const {run,p,tracks}=fixture();p.configureLiveLayering=vi.fn(async()=>{});p.prepareLiveLayering=vi.fn(async()=>{});p.armLiveLayering=vi.fn(()=>true)
 await run.setLiveLayering(true);run.tick();await flush();expect(p.prepareLiveLayering).toHaveBeenCalledWith(['b','c'])
 p.liveLayeringUpcoming={approval:{entry:{sourcePosition:100},scene:{sources:{b:{trackId:'c'}}}}};p.position=93;run.tick();await flush()
 expect(p.armLiveLayering).toHaveBeenCalled();expect(p.request).not.toHaveBeenCalled();expect(p.current).toBe(tracks[0]);expect(run.next.state.id).toBe('c');expect((run.export() as any).playHistory).toEqual([{id:'a',count:1}])
})
it('manual next requests a safe exit from active longmix instead of replacing either deck',async()=>{
 const {run,p}=fixture();p.liveLayeringPending={plan:{from:'a',to:'b'}};p.gate.locked=true;p.exitLiveLayering=vi.fn(()=>true)
 run.requestNext();expect(p.exitLiveLayering).toHaveBeenCalled();expect(p.request).not.toHaveBeenCalled();expect(p.cancel).not.toHaveBeenCalled()
})
it('changing musical direction during an active longmix requests the nearest safe exit and defers new candidates',()=>{
 const {run,p}=fixture();p.liveLayeringPending={plan:{from:'a',to:'b'}};p.gate.locked=true;p.exitLiveLayering=vi.fn(()=>true)
 run.direction({energy:4});expect(p.exitLiveLayering).toHaveBeenCalled();expect(p.cancel).not.toHaveBeenCalled();expect(p.prepareAutomatic).not.toHaveBeenCalled()
})
it('canceling a future prepared longmix prevents it from automatically arming on the next tick',async()=>{
 const {run,p}=fixture();run.tick();await flush();p.liveLayeringUpcoming={approval:{entry:{sourcePosition:100},scene:{sources:{b:{trackId:'c'}}}}};p.armLiveLayering=vi.fn(()=>true);p.cancelLivePreparation=vi.fn(()=>{p.liveLayeringUpcoming=null});p.position=93
 run.cancel();run.tick();expect(p.cancelLivePreparation).toHaveBeenCalled();expect(p.armLiveLayering).not.toHaveBeenCalled()
})
it('next before a longmix starts cancels that future scene and searches an ordinary nearby cue',async()=>{
 const {run,p}=fixture();run.tick();await flush();p.liveLayeringPending={plan:{from:'a',to:'b'}};p.cancel.mockImplementation(()=>{p.liveLayeringPending=null;return true});p.exitLiveLayering=vi.fn()
 run.requestNext();await flush();expect(p.cancel).toHaveBeenCalled();expect(p.exitLiveLayering).not.toHaveBeenCalled();expect(p.request).toHaveBeenCalled()
})
it('a late ordinary shortlist result cannot overwrite a longmix that took execution ownership',async()=>{
 const {run,p}=fixture();let finish!:(id:string)=>void;p.prepareAutomatic.mockImplementationOnce(()=>new Promise<string>(r=>finish=r));run.tick();await flush();p.liveLayeringUpcoming={approval:{entry:{sourcePosition:100},scene:{sources:{b:{trackId:'c'}}}}};p.position=93;p.armLiveLayering=vi.fn(()=>true)
 run.tick();finish('b');await flush();expect(run.next.state).toMatchObject({id:'c',status:'ready'})
})
it('longmix preparation failure cannot exclude an otherwise prepared ordinary candidate',async()=>{
 const {run,p}=fixture();p.configureLiveLayering=vi.fn(async()=>{});p.prepareLiveLayering=vi.fn(async()=>{throw Error('missing longmix')})
 await run.setLiveLayering(true);run.tick();await flush();expect(run.next.state.status).toBe('ready');expect(run.next.state.id).toBe('b');p.position=194;run.tick();await flush();expect(p.request).toHaveBeenCalled();expect(p.log.mock.calls.some(([kind]:any)=>kind==='selection_candidates_exhausted')).toBe(true)
})
it('publishes the stem method and comparison actually supplied by the running transport',()=>{
 const {run,p}=fixture();run.next.state={id:'b',status:'ready',error:''}
 p.stemComparison=()=>({state:'ready',recommended:'filter',reason:'旋律滤波',methods:{original:{eligible:true,score:50},filter:{name:'旋律滤波',eligible:true,score:63}}})
 const snapshot=run.snapshot();expect(snapshot.method).toBe('filter');expect(snapshot.strategyComparison?.methods.filter.score).toBe(63);expect(snapshot.recommendation?.reason).toContain('旋律滤波')
})
it('reports published stem coverage separately from basic mixing and playback',()=>{
 const {run,index}=fixture();index.stemIndex={schema:'harbeat.execution-library.v1',tracks:[{trackId:'a',assetsReady:false},{trackId:'b',assetsReady:true}]}
 run.next.state={id:'b',status:'ready',error:''};const state:any=run.snapshot()
 expect(state.catalog).toMatchObject({playable:3,mixable:3,stemProfiles:2,stemPublished:1})
 expect(state.currentReadiness).toMatchObject({state:'profile-only',label:'分轨分析已发布 · 音频待发布'})
 expect(state.selectedReadiness).toMatchObject({state:'published',label:'分轨音频已发布 · 接点待核验'})
 expect((run as any).catalogEntries()[2].mixReadiness.state).toBe('not-published')
})
it('does not equate a failed publication lookup with absent analysis',()=>{
 const {run}=fixture();const state:any=run.snapshot()
 expect(state.catalog.stemPublished).toBeNull()
 expect(state.currentReadiness.state).toBe('unknown')
})
it('describes preparation and source gaps instead of claiming an original fallback is selected',()=>{
 const {run,p,index}=fixture();run.next.state={id:'b',status:'ready',error:''}
 index.stemIndex={schema:'harbeat.execution-library.v1',tracks:[]}
 p.stemComparison=()=>({state:'preparing',reason:'正在比较接点',recommended:'original',methods:{}})
 expect(run.snapshot().recommendation?.reason).toContain('正在比较接点')
 expect((run.snapshot() as any).methodStatus).toBe('evaluating')
 p.stemComparison=()=>({state:'ready',reason:'',recommended:'original',methods:{}})
 expect(run.snapshot().recommendation?.reason).toContain('分轨分析未发布')
})
it('does not display an intermediate rejection while candidate details are still loading',()=>{
 const {run,p}=fixture();run.next.state={id:'b',status:'loading',error:''}
 p.stemComparison=()=>({state:'unavailable',reason:'没有达到共同门槛的可执行方案，保留当前播放',recommended:'original',methods:{}})
 const state=run.snapshot();expect(state.methodStatus).toBe('evaluating');expect(state.recommendation?.reason).toContain('正在');expect(state.recommendation?.reason).not.toContain('共同门槛')
})
it('replaces the style candidate without changing the current deck or accepting the old late result',async()=>{
 const {run,p,index}=fixture();index.tracks[1].styleLabels=['KPOP'];index.tracks[2].styleLabels=['boombap']
 let release!:(id:string)=>void;p.prepareAutomatic.mockImplementationOnce(()=>new Promise<string>(r=>release=r))
 run.direction({style:'KPOP'});await flush();expect(release).toBeTypeOf('function')
 run.direction({style:'boombap'});await flush();expect(run.next.state).toMatchObject({id:'c',status:'ready'})
 release('b');await flush();expect(run.next.state).toMatchObject({id:'c',status:'ready'})
 expect(p.current.id).toBe('a');expect(p.start).not.toHaveBeenCalled();expect(p.stop).not.toHaveBeenCalled();expect(p.request).not.toHaveBeenCalled()
})
describe('phone Listen playback',()=>{
 it('uses published mix readiness without requiring execution stems',async()=>{
  const read=vi.fn(async(_path:string,_base:URL)=>({schema:'harbeat.continuous-library.v1',tracks:[{id:'no-stems',title:'song',bpm:100,duration:240,collection:'web',styleLabels:[],detailUrl:'a.json',playStatus:'ready',mixStatus:'ready'}]}))
  expect((await loadListenIndex(new URL('https://example.test/'),read)).tracks[0].mixStatus).toBe('ready')
  expect(read.mock.calls[0][0]).toBe('/listen/library.json')
  expect(read).toHaveBeenCalledWith('/listen/catalog/bassment-fm-v1/library.json',expect.any(URL))
  expect(read).toHaveBeenCalledWith('/listen/dj-pair-references/v1/index.json',expect.any(URL))
 })
 it('loads optional stem comparison coverage while preserving normal mix readiness',async()=>{
  const read=vi.fn(async(path:string)=>path==='/listen/execution/index.json'?{schema:'harbeat.execution-library.v1',tracks:[],excluded:[]}:{schema:'harbeat.continuous-library.v1',tracks:[{id:'a',title:'song',bpm:100,duration:240,collection:'web',styleLabels:[],detailUrl:'a.json',playStatus:'ready',mixStatus:'ready'}]})
  const index=await loadListenIndex(new URL('https://test.local/'),read)
  expect(index.stemIndex?.schema).toBe('harbeat.execution-library.v1');expect(index.tracks[0].mixStatus).toBe('ready')
 })
 it('manual next searches the live web planner without restarting the current deck',async()=>{
  const {run,p}=fixture();run.direction({automatic:false});run.choose('b');await flush();await run.mixSoon()
  expect(p.prepareNext).toHaveBeenCalledWith('b',{automatic:false})
  expect(p.request.mock.calls.map((c:any)=>c[1])).toEqual([18,60]);expect(p.start).not.toHaveBeenCalled();expect(p.stop).not.toHaveBeenCalled()
 })
 it('never labels a stale search cue from another source or target as the current recommendation',async()=>{
  const {run,p}=fixture();run.direction({automatic:false});run.next.state={id:'b',status:'ready',error:''}
  p.lastSearch={best:{from:'old-a',to:'b',start:200,end:208,window:{start:10,end:18}}};expect(run.snapshot().recommendation?.cue).toBeNull()
  p.lastSearch.best.from='a';p.lastSearch.best.to='c';expect(run.snapshot().recommendation?.cue).toBeNull()
  p.lastSearch.best.to='b';expect(run.snapshot().recommendation?.cue?.start).toBe(200)
 })
 it('prepares automatic choices with the web cross-track quality planner',async()=>{
  const {run,p}=fixture();run.tick();await flush();expect(p.prepareAutomatic).toHaveBeenCalledWith(['b','c']);expect(p.request).not.toHaveBeenCalled()
 })
 it('retains a next request made while its entry is loading',async()=>{
  const {run,p}=fixture();let ready!:()=>void;p.prepareNext.mockImplementation(()=>new Promise<void>(r=>ready=r));run.direction({automatic:false});run.choose('b');run.requestNext();await flush();expect(p.request).not.toHaveBeenCalled();ready();await flush();run.tick();await flush();expect(p.request).toHaveBeenCalled()
 })
 it('reprepares an idle choice after auto is disabled during loading',async()=>{
  const {run,p}=fixture();let finish!:()=>void;p.prepareAutomatic.mockImplementation(()=>new Promise<void>(r=>finish=r));run.tick();await flush();run.direction({automatic:false});expect(run.next.state.status).toBe('idle');run.requestNext();await flush();expect(p.prepareNext).toHaveBeenCalled();run.tick();await flush();expect(p.request).toHaveBeenCalled();finish()
 })
 it('resumes preparation after host interruption during loading',async()=>{
  const {run,p}=fixture();let finish!:()=>void;p.prepareAutomatic.mockImplementation(()=>new Promise<void>(r=>finish=r));run.tick();await flush();await run.pauseForHost();expect(run.next.state.status).toBe('idle');await run.resume();await flush();expect(p.prepareNext).toHaveBeenCalled();finish()
 })
 it('shares first initialization and cancels source loading on pause',async()=>{
  const {run,p}=fixture();run.player=null;let initialized!:()=>void;p.ctx.resume=vi.fn(async()=>{});p.initialize.mockImplementation(()=>new Promise<void>(r=>initialized=r));const a=run.start('a'),b=run.start('b');await flush();expect(p.start).not.toHaveBeenCalled();initialized();await Promise.all([a,b]);expect(p.start).toHaveBeenCalledTimes(1)
  let loaded!:()=>void;p.current=null;p.busy=true;p.start.mockImplementation(()=>new Promise<void>(r=>loaded=r));const c=run.start('c');await flush();await run.pause();expect(p.stop).toHaveBeenCalled();expect(run.working).toBe(false);loaded();await c
 })
 it('handles next immediately after deck takeover before its periodic tick',async()=>{
  const {run,p,tracks}=fixture();run.tick();await flush();run.next.state={id:'b',status:'ready',error:''};p.current=tracks[1];run.requestNext();await flush();run.tick();await flush();expect(p.request.mock.calls.length).toBeGreaterThan(0);expect(p.request.mock.calls.every((c:any)=>c[0].targetId==='c')).toBe(true)
 })
 it('refreshes pinned source metadata with the fresh reader and cancels caching in background',async()=>{
  const {run,p,index,tracks}=fixture();let version='old';(run as any).read=async(path:string)=>path==='/listen/library.json'?index:{track:{...tracks.find(t=>path===t.id+'.json'),native:{sha256:version}}};(run as any).pins=['b'];await run.refreshLibrary();expect((await run.library.load('b')).native.sha256).toBe('old');version='new';await run.refreshLibrary();expect((await run.library.load('b')).native.sha256).toBe('new');const c=new AbortController();(run as any).cacheController=c;await run.pauseForHost();expect(c.signal.aborted).toBe(true)
 })
 it('cannot start after stop supersedes an unfinished detail load',async()=>{
  const {run,p}=fixture();let ready!:(v:any)=>void;vi.spyOn(run.library,'load').mockImplementation(()=>new Promise(r=>ready=r));const start=run.start('b');await flush();run.stop();ready({id:'b'});await start;expect(p.start).not.toHaveBeenCalled()
 })
 it('host suspension cancels preparation and pauses the existing shared clock',async()=>{
  const {run,p}=fixture();await run.pauseForHost();expect(p.cancelPreparation).toHaveBeenCalled();expect(p.ctx.suspend).toHaveBeenCalled();expect(p.paused).toBe(true)
 })
 it('keeps saved reservations as a source-validated song scope with explicit Listen policy',async()=>{
  const {run,p,tracks}=fixture();vi.spyOn(ActivitySession,'open').mockResolvedValueOnce({packId:'pack',name:'saved',ids:new Set(['a','b']),tracks:tracks.slice(0,2),initialTrackId:'a'} as any)
  await run.setSession({},'saved');expect(()=>run.choose('c')).toThrow(/预约/);expect(run.snapshot().activitySet?.executionPolicy).toBe('listen-live-v1');expect(p.request).not.toHaveBeenCalled();vi.restoreAllMocks()
 })
 it('does not prepare or schedule an automatic handoff after auto is disabled',async()=>{
  const {run,p}=fixture();run.tick();await flush();run.direction({automatic:false});p.prepareAutomatic.mockClear();p.position=230;run.tick();await flush();expect(p.request).not.toHaveBeenCalled();expect(p.prepareAutomatic).not.toHaveBeenCalled();expect(p.cancelAutomatic).toHaveBeenCalled()
 })
})

it('treats a pending native crossgenre handoff as a real pending transition',async()=>{
 const {run,p}=fixture();p.crossGenrePending={plan:{from:'a',to:'b'},end:60};p.gate.locked=false
 await expect(run.start('c')).rejects.toThrow(/交接/)
 run.choose('c');expect(p.cancel).toHaveBeenCalled()
 p.cancel.mockClear();run.next.state={id:'b',status:'ready',error:''};run.tick();await flush();expect(p.request).not.toHaveBeenCalled()
})

it('merges the phone source library without replacing existing web entries',async()=>{
 const row=(id:string)=>({id,title:id,bpm:100,duration:240,collection:'DJ',styleLabels:['Funk'],detailUrl:id+'.json',playStatus:'ready',mixStatus:'ready'})
 const web={schema:'harbeat.continuous-library.v1',tracks:[row('a')]},mobile={schema:'harbeat.continuous-library.v1',executionPolicy:'device-native-windows-v1',tracks:[{...row('a'),title:'wrong duplicate'},row('new')]}
 const read=vi.fn(async(path:string)=>path==='/listen/library.json'?web:mobile)
 const index=await loadListenIndex(new URL('https://example.test/'),read)
 expect(index.tracks.map(t=>t.title)).toEqual(['a','new']);expect((index as any).deviceSourceIds).toEqual(['new'])
})


describe('session-wide unplayed selection',()=>{
 it('does not re-enter the old nine-song cycle while fresh songs remain',async()=>{
  const {run,p,tracks}=fixture(Array.from({length:20},(_,i)=>'song-'+String(i).padStart(2,'0'))),played=new Set<string>()
  for(let i=0;i<15;i++){
   played.add(p.current.id);run.tick();await flush()
   const next=run.next.state.id!;expect(next).toBeTruthy();expect(played.has(next)).toBe(false)
   p.current=tracks.find(t=>t.id===next)
  }
 })
 it('checks later fresh batches before falling back to a previously played song',async()=>{
  const {run,p}=fixture(Array.from({length:20},(_,i)=>'song-'+String(i).padStart(2,'0')))
  p.prepareAutomatic.mockRejectedValueOnce(Error('No reliable complete cue in first batch'))
  run.tick();await flush();expect(run.next.state.status).toBe('failed');run.tick();await flush()
  expect(p.prepareAutomatic.mock.calls.map((c:any)=>c[0])).toEqual([
   Array.from({length:8},(_,i)=>'song-'+String(i+1).padStart(2,'0')),
   Array.from({length:8},(_,i)=>'song-'+String(i+9).padStart(2,'0')),
  ])
  expect(run.next.state.status).toBe('ready');expect(p.log.mock.calls.some(([kind,data]:any)=>kind==='selection_batch'&&data.mode==='unplayed')).toBe(true)
 })
 it('logs repeat fallback only after every compatible fresh candidate was exhausted',async()=>{
  const {run,p}=fixture();p.prepareAutomatic.mockRejectedValueOnce(Error('No source-bound cue for either fresh song'))
  run.tick();await flush();run.tick();await flush()
  const fallback=p.log.mock.calls.find(([kind,data]:any)=>kind==='selection_batch'&&data.mode==='repeat-fallback')
  // The current song itself is never a repeat candidate; with only A played,
  // exhausted B/C means there is no safe repeat and playback keeps its source.
  expect(fallback).toBeUndefined();expect(run.next.state.id).toBeNull()
 })
 it('prefers the least played compatible songs once fresh songs are exhausted',async()=>{
  const {run,p,tracks}=fixture()
  for(const id of ['a','b','a','c']){p.current=tracks.find(t=>t.id===id);run.tick();await flush()}
  expect(run.next.state.id).toBe('b')
  const fallback=p.log.mock.calls.find(([kind,data]:any)=>kind==='selection_batch'&&data.mode==='repeat-fallback')
  expect(fallback?.[1]).toMatchObject({reason:'all_compatible_tracks_played'})
 })
 it('preserves session history through pause, seek and direction changes and resets on stop',async()=>{
  const {run,p,tracks}=fixture();run.tick();await flush();p.current=tracks[1];run.tick();await flush()
  await run.pause();await run.resume();await run.seek(60);run.direction({style:'Hip-Hop',energy:4});await flush()
  expect((run.export() as any).playHistory).toEqual([{id:'a',count:1},{id:'b',count:1}])
  run.stop();p.current=tracks[0];run.tick();await flush();expect((run.export() as any).playHistory).toEqual([{id:'a',count:1}])
 })
 it('allows an explicit manual request for a song played earlier in the session',async()=>{
  const {run,p,tracks}=fixture();run.tick();await flush();p.current=tracks[1];run.tick();await flush();run.choose('a');await flush()
  expect(run.next.state.id).toBe('a');expect(p.prepareNext).toHaveBeenLastCalledWith('a',{automatic:true})
  expect(p.log.mock.calls.find(([kind,data]:any)=>kind==='selection_batch'&&data.mode==='explicit')?.[1]).toMatchObject({reason:'manual_target',ids:['a'],targetPlayCount:1})
 })
})

it('advances through all fresh candidates before a logged repeat fallback',async()=>{
 const {run,p,tracks}=fixture(['a','b','c','d','e'])
 run.tick();await flush();p.current=tracks[1];run.tick();await flush()
 p.prepareAutomatic.mockRejectedValueOnce(Error('No reliable fresh cue'));p.current=tracks[2];run.tick();await flush()
 expect(p.prepareAutomatic.mock.calls.at(-1)?.[0]).toEqual(['d','e']);expect(run.next.state.status).toBe('failed')
 run.tick();await flush();expect(run.next.state.status).toBe('ready')
 expect(p.prepareAutomatic.mock.calls.at(-1)?.[0]).toEqual(['a','b'])
 const batch=p.log.mock.calls.filter(([kind]:any)=>kind==='selection_batch').at(-1)?.[1]
 expect(batch).toMatchObject({mode:'repeat-fallback',reason:'unplayed_candidates_exhausted',unplayedCompatibleCount:2,unplayedRemainingCount:0,excludedUnplayedCount:2})
})
it('preserves played tracks when refreshing library metadata',async()=>{
 const {run,p,index,tracks}=fixture();run.tick();await flush();p.current=tracks[1];run.tick();await flush()
 ;(run as any).read=async(path:string)=>path==='/listen/library.json'?index:{track:tracks.find(t=>path===t.id+'.json')}
 await run.refreshLibrary();expect((run.export() as any).playHistory).toEqual([{id:'a',count:1},{id:'b',count:1}]);expect(run.next.state.id).toBe('c')
})
it('only excludes the song actually tried when automatic playback is re-enabled',async()=>{
 const {run,p,tracks}=fixture(['a','b','c','d','e','f']);run.direction({automatic:false})
 for(const id of ['a','b']){p.current=tracks.find(t=>t.id===id);run.tick();await flush()}
 p.prepareNext.mockRejectedValueOnce(Error('D has no reliable nearby cue'));p.current=tracks[2];run.tick();await flush();expect(run.next.state.status).toBe('failed')
 run.direction({automatic:true});run.tick();await flush()
 expect(p.prepareAutomatic).toHaveBeenLastCalledWith(['e','f'])
 expect(p.log.mock.calls.find(([kind]:any)=>kind==='selection_candidates_exhausted')?.[1].ids).toEqual(['d'])
 expect(run.next.state.id).toBe('e')
})
it('retries only the actual single selection after foreground resume',async()=>{
 const {run,p,tracks}=fixture(['a','b','c','d','e','f'])
 for(const id of ['a','b']){p.current=tracks.find(t=>t.id===id);run.tick();await flush()}
 let release!:()=>void;p.prepareAutomatic.mockImplementationOnce(()=>new Promise<void>(r=>release=r));p.current=tracks[2];run.tick();await flush()
 await run.pauseForHost();p.prepareNext.mockRejectedValueOnce(Error('D no longer has a cue'));await run.resume();await flush();expect(run.next.state.status).toBe('failed')
 run.tick();await flush();expect(p.prepareAutomatic).toHaveBeenLastCalledWith(['e','f']);expect(run.next.state.id).toBe('e');release()
})
it('replaces an unlocked repeat recommendation after fresh songs arrive on refresh',async()=>{
 const {run,p,tracks,index}=fixture()
 for(const t of tracks){p.current=t;run.tick();await flush()}
 expect(run.next.state.id).toBe('a')
 const d={...tracks[0],id:'d',title:'d'},newIndex={...index,tracks:[...index.tracks,{...index.tracks[0],id:'d',title:'d',detailUrl:'d.json'}]}
 ;(run as any).read=async(path:string)=>path==='/listen/library.json'?newIndex:{track:[...tracks,d].find(t=>path===t.id+'.json')}
 await run.refreshLibrary();await flush();expect(run.next.state.id).toBe('d');expect(p.prepareAutomatic).toHaveBeenLastCalledWith(['d'])
 p.position=194;run.tick();await flush();expect(p.request.mock.calls.every((c:any)=>c[0].targetId==='d')).toBe(true)
})
it('keeps an armed handoff intact when fresh songs arrive on refresh',async()=>{
 const {run,p,tracks,index}=fixture();for(const t of tracks){p.current=t;run.tick();await flush()}
 const pending={plan:{to:'a'}};p.pending=pending;p.gate.locked=true;const before=p.prepareAutomatic.mock.calls.length
 const d={...tracks[0],id:'d'},newIndex={...index,tracks:[...index.tracks,{...index.tracks[0],id:'d',detailUrl:'d.json'}]}
 ;(run as any).read=async(path:string)=>path==='/listen/library.json'?newIndex:{track:[...tracks,d].find(t=>path===t.id+'.json')}
 await run.refreshLibrary();await flush();expect(p.pending).toBe(pending);expect(p.prepareAutomatic).toHaveBeenCalledTimes(before)
})
it('records a single-song retry before its metadata load can fail',async()=>{
 const {run,p,tracks}=fixture(['a','b','c','d','e','f'])
 for(const id of ['a','b']){p.current=tracks.find(t=>t.id===id);run.tick();await flush()}
 const original=run.library.load.bind(run.library),failures:((e:Error)=>void)[]=[]
 vi.spyOn(run.library,'load').mockImplementation(id=>id==='d'?new Promise((_resolve,reject)=>failures.push(reject)):original(id))
 p.current=tracks[2];run.tick();await flush();await run.pauseForHost();await run.resume();await flush()
 failures.forEach(reject=>reject(Error('D metadata unavailable')));await flush();expect(run.next.state.status).toBe('failed')
 run.tick();await flush();expect(p.prepareAutomatic).toHaveBeenLastCalledWith(['e','f']);expect(run.next.state.id).toBe('e')
})

it('reprepares a manual selection under automatic rules when auto is enabled while paused',async()=>{
 const {run,p}=fixture();run.direction({automatic:false});run.choose('b');await flush()
 expect(run.next.state.status).toBe('ready');p.playing=false;p.paused=true;p.prepareNext.mockClear()
 run.direction({automatic:true});await flush()
 expect(p.prepareNext).toHaveBeenCalledWith('b',{automatic:true});expect(p.start).not.toHaveBeenCalled();expect(p.request).not.toHaveBeenCalled()
})
it('attaches validated reservation strategies to the live transport and detaches them on exit',async()=>{
 const {run,p,tracks}=fixture(),activity:any={packId:'pack',name:'saved',ids:new Set(['a','b']),tracks:tracks.slice(0,2),initialTrackId:'a',strategyVersion:'jetson-decision-v1',cacheStrategies:vi.fn(async()=>{})}
 p.setReservation=vi.fn();vi.spyOn(ActivitySession,'open').mockResolvedValueOnce(activity)
 try{await run.setSession({},'saved');expect(p.setReservation).toHaveBeenCalledWith(activity);expect(activity.cacheStrategies).toHaveBeenCalledWith(run.base)
  run.clearSet();expect(p.setReservation).toHaveBeenLastCalledWith(null)
 }finally{vi.restoreAllMocks()}
})
it('cannot stop a handoff that starts while saved approvals are being registered',async()=>{
 const {run,p}=fixture(),activity:any={cacheStrategies:async()=>{p.gate.locked=true}}
 vi.spyOn(ActivitySession,'open').mockResolvedValueOnce(activity)
 try{await expect(run.setSession({},'saved')).rejects.toThrow(/交接完成/);expect(p.stop).not.toHaveBeenCalled()}
 finally{vi.restoreAllMocks()}
})
it('prepares explicit next with manual fallback even while automatic playback is enabled',async()=>{
 const {run,p}=fixture();p.prepareAutomatic.mockRejectedValueOnce(Error('No creative winner'))
 run.tick();await flush();expect(run.next.state.status).toBe('failed');run.requestNext();await flush()
 expect(p.prepareNext).toHaveBeenLastCalledWith('b',{automatic:false,budget:60});run.tick();await flush();expect(p.request).toHaveBeenCalledWith({kind:'next',targetId:'b'},18,{origin:'mobile_user',automatic:false})
})
it('switches an in-flight automatic preparation to the bounded nearby manual request',async()=>{
 const {run,p}=fixture();let release!:(v:string)=>void;p.prepareAutomatic.mockImplementationOnce(()=>new Promise<string>(r=>release=r))
 run.tick();await flush();run.requestNext();await flush();expect(p.prepareNext).toHaveBeenLastCalledWith('b',{automatic:false,budget:60})
 release('c');await flush();expect(run.next.state.id).toBe('b');expect(run.next.state.status).toBe('ready')
})
it('retries a manual preparation as source time advances after no cue was available in its first bounded window',async()=>{
 const {run,p}=fixture();run.direction({automatic:false});run.choose('b');await flush();run.next.state.status='failed'
 p.prepareNext.mockRejectedValueOnce(Error('No cue in next sixty seconds'));run.requestNext();await flush();expect(run.next.state.status).toBe('failed')
 run.tick();await flush();expect(run.next.state.status).toBe('ready');expect(p.prepareNext).toHaveBeenLastCalledWith('b',{automatic:false,budget:60})
})
it('preserves a manual next request when an already-running automatic request later fails',async()=>{
 const {run,p}=fixture();run.tick();await flush();p.position=194
 let finish!:()=>void;p.request.mockImplementationOnce(()=>new Promise<void>(resolve=>finish=resolve))
 run.tick();await flush();expect(finish).toBeTypeOf('function');run.requestNext();await flush();finish();await flush()
 expect(p.cancel).toHaveBeenCalled();expect(run.next.state.id).toBe('b');expect(run.next.state.status).toBe('ready')
 run.tick();await flush();expect(p.request).toHaveBeenLastCalledWith({kind:'next',targetId:'b'},60,{origin:'mobile_user_extended'})
})

it('uses a mix-ready device detail when a play-only web duplicate would hide its verified entry windows',async()=>{
 const row={id:'same',title:'song',bpm:95,duration:124,collection:'web',styleLabels:[],detailUrl:'play-only.json',playStatus:'ready',mixStatus:'unavailable'}
 const source={...row,detailUrl:'/analysis-lab-static/mobile-library-v1/source.json',mixStatus:'ready'}
 const read=async(path:string)=>path==='/listen/library.json'?{schema:'harbeat.continuous-library.v1',tracks:[row]}:{schema:'harbeat.continuous-library.v1',executionPolicy:'device-native-windows-v1',tracks:[source]}
 const index=await loadListenIndex(new URL('https://example.test/'),read)
 expect(index.tracks).toHaveLength(1);expect(index.tracks[0]).toMatchObject({mixStatus:'ready',detailUrl:source.detailUrl});expect(index.deviceSourceIds).toEqual(['same'])
})
it('does not upgrade a duplicate whose duration or tempo disagrees with the active web source',async()=>{
 const row={id:'same',title:'song',bpm:95,duration:124,collection:'web',styleLabels:[],detailUrl:'play-only.json',playStatus:'ready',mixStatus:'unavailable'}
 for(const change of [{duration:130},{bpm:105}]){
  const read=async(path:string)=>path==='/listen/library.json'?{schema:'harbeat.continuous-library.v1',tracks:[row]}:{schema:'harbeat.continuous-library.v1',executionPolicy:'device-native-windows-v1',tracks:[{...row,...change,detailUrl:'other.json',mixStatus:'ready'}]}
  const index=await loadListenIndex(new URL('https://example.test/'),read);expect(index.tracks[0]).toEqual(row);expect(index.deviceSourceIds).toEqual([])
 }
})
it('retains the other batch targets after a prepared winner fails at execution',async()=>{
 const {run,p}=fixture();run.tick();await flush();expect(run.next.state.id).toBe('b')
 p.position=194;run.tick();await flush()
 expect(p.prepareAutomatic).toHaveBeenLastCalledWith(['c']);expect(run.next.state.id).toBe('c');expect(p.start).not.toHaveBeenCalled()
})

it('rejects a late seek when the transition audio is already locked',async()=>{
 const {run,p}=fixture()
 p.gate.locked=true
 await expect(run.seek(80)).rejects.toThrow('交接')
 expect(p.seek).not.toHaveBeenCalled()
 expect(p.cancelPreparation).not.toHaveBeenCalled()
})

it('includes a matching directed reference in the first normal candidate batch',async()=>{
 const {run,p,index}=fixture(['a','b','c','d','e','f','g','h','i','j','k','z'])
 const h='a'.repeat(64)
 const proof={originalSha256:h,masterSha256:h,reportSha256:h,vocalSha256:h,runId:'r'}
 p.current.provenance=proof
 index.pairReferences=[{sources:{a:{...proof,trackId:'a',sourceStart:208},b:{...proof,trackId:'z'}},duration:8}]
 run.tick();await flush()
 expect(p.prepareAutomatic.mock.calls[0][0]).toHaveLength(8)
 expect(p.prepareAutomatic.mock.calls[0][0][0]).toBe('z')
})

it('merges reference set songs into normal playback and honors a style restriction in both directions',async()=>{
 const {tracks}=fixture()
 const row=(id:string,collection:string,labels:string[])=>({id,title:id,bpm:100,duration:240,style:labels[0],collection,styleLabels:labels,detailUrl:id+'.json',playStatus:'ready',mixStatus:'ready'})
 const web=row('a','library',['Hip-Hop']), hip=row('b','Bassment FM',['Hip-Hop']), house=row('c','Toucan',['House'])
 const read=async(path:string)=>{
  if(path==='/listen/library.json')return {schema:'harbeat.continuous-library.v1',tracks:[web]}
  if(path.endsWith('/pair-reference-lab/library.json'))return {schema:'harbeat.continuous-library.v1',tracks:[{...web,collection:'Bassment FM'},hip,house]}
  if(path.endsWith('.json')&&!path.includes('/'))return {track:tracks.find(t=>t.id===path.slice(0,-5))}
  throw Error('unavailable')
 }
 const base=new URL('https://appassets.androidplatform.net'),index=await loadListenIndex(base,read)
 expect(index.tracks.map(t=>[t.id,t.collection])).toEqual([['a','library'],['b','Bassment FM'],['c','Toucan']])
 expect(index.deviceSourceIds).toEqual(['b','c'])
 const {p}=fixture()
 const run=new ListenRun(index,base,()=>{},undefined,()=>p as any,read)
 run.player=p as any;run.direction({style:'Hip-Hop'});run.tick();await flush()
 expect(p.prepareAutomatic).toHaveBeenLastCalledWith(['b'])
 p.current=tracks[1];run.tick();await flush()
 expect(p.prepareAutomatic).toHaveBeenLastCalledWith(['a'])
})

it('uses the published execution cohort in the normal catalog, ahead of bundled copies',async()=>{
 const row=(id:string,detailUrl:string)=>({id,title:id,bpm:100,duration:240,collection:'Hip-Hop',styleLabels:['Hip-Hop'],detailUrl,playStatus:'ready',mixStatus:'ready'})
 const main=row('main','main.json'),published=row('b','/listen/catalog/bassment-fm-v1/details/b.json')
 const read=async(path:string)=>{
  if(path==='/listen/library.json')return {schema:'harbeat.continuous-library.v1',tracks:[main]}
  if(path==='/listen/catalog/bassment-fm-v1/library.json')return {schema:'harbeat.continuous-library.v1',executionPolicy:'device-native-windows-v1',tracks:[published]}
  if(path.endsWith('/pair-reference-lab/library.json'))return {schema:'harbeat.continuous-library.v1',tracks:[row('b','bundled.json')]}
  throw Error('unavailable')
 }
 const index=await loadListenIndex(new URL('https://appassets.androidplatform.net'),read)
 expect(index.tracks).toEqual([main,published])
 expect(index.deviceSourceIds).toEqual(['b'])
})

it('arms an unheard playable original at EOF after mix preparation fails',async()=>{
 const {run,p,tracks,index}=fixture()
 index.tracks[2].mixStatus='unavailable'
 p.prepareAutomatic.mockRejectedValue(Error('no eligible cue'))
 p.automaticStart=null
 run.tick();await flush()
 expect(run.snapshot().nextDisplayId).toBeNull()
 run.next.state={id:'c',status:'loading',error:''}
 expect(run.snapshot().nextDisplayId).toBeNull()
 p.position=223
 p.queueSetContinuation.mockRejectedValueOnce(Error('asset unavailable'))
 run.tick();await flush();run.tick()
 expect(p.queueSetContinuation.mock.calls.map(([track]:any)=>track.id)).toEqual(['b','c'])
 expect(p.queueSetContinuation).toHaveBeenLastCalledWith(tracks[2],expect.any(AbortSignal),'automatic')
 expect(run.export().playHistory).toEqual([{id:'a',count:1}])
 expect(p.start).not.toHaveBeenCalled()
})
it('uses an approved mix near EOF before considering native continuation',async()=>{
 const {run,p}=fixture()
 run.tick();await flush()
 expect(run.snapshot().nextDisplayId).toBe('b')
 p.position=223;p.automaticStart=229
 run.tick();await flush()
 expect(p.request).toHaveBeenCalled()
 expect(p.queueSetContinuation).not.toHaveBeenCalled()
})
it('cancels late native preparation when auto-next is switched off',async()=>{
 const {run,p}=fixture()
 p.automaticStart=null;p.position=223
 let signal!:AbortSignal,finish!:()=>void
 p.queueSetContinuation.mockImplementation((_track:any,s:AbortSignal)=>{
  signal=s;return new Promise<void>(r=>finish=r)
 })
 run.tick();await flush()
 expect(signal.aborted).toBe(false)
 run.direction({automatic:false});expect(signal.aborted).toBe(true)
 finish();await flush();run.tick()
 expect(p.queueSetContinuation).toHaveBeenCalledTimes(1)
})
