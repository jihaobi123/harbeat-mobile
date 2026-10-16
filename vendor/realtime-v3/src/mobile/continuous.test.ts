import {describe,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import {ContinuousRun} from './continuous'
import {planVocalOverlap} from '../vocal-overlap/planner'
import {planV31} from '../v31-release/release'
import type {LibraryIndex} from '../continuous/catalog'

const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}
function fixture(read?:any){
 const tracks=['a','b','c'].map(id=>({id,title:id,bpm:100,duration:240,style:'Hip-Hop',native:{},windows:[],bars:[]}))
 const index:LibraryIndex={schema:'harbeat.continuous-library.v1',tracks:tracks.map(t=>({...t,collection:'test',styleLabels:['Hip-Hop'],detailUrl:t.id+'.json',playStatus:'ready',mixStatus:'ready'}))}
 const run=new ContinuousRun(index,new URL('https://appassets.androidplatform.net/assets/realtime/'),vi.fn(),undefined,read??(async(file:string)=>({track:tracks.find(t=>file===t.id+'.json')})))
 const p:any={current:tracks[0],tracks,playing:true,paused:false,busy:false,pending:null,position:40,ctx:{currentTime:0},gate:{locked:false},
  cancel:vi.fn(),cancelPreparation:vi.fn(),prepareNext:vi.fn(async()=>{}),request:vi.fn(async()=>{}),setVolume:vi.fn(),seek:vi.fn(async()=>{}),export:()=>({}),stop:vi.fn()}
 run.session.player=p
 vi.spyOn(run.session,'save').mockImplementation(()=>{})
 vi.spyOn(run.session,'start').mockImplementation(async(id)=>{p.current=tracks.find(t=>t.id===id)})
 vi.spyOn(run.session,'stop').mockImplementation(()=>{p.current=null;p.playing=false})
 return {run,p,tracks}
}
describe('mobile continuous adapter',()=>{
 it('prepares another song without restarting or stopping the current deck',async()=>{
  const {run,p}=fixture();run.choose('b');await flush();expect(p.prepareNext).toHaveBeenCalledWith('b');expect(p.current.id).toBe('a');expect(run.session.start).not.toHaveBeenCalled();expect(run.next.state.status).toBe('ready')
  await run.mix();expect(p.request).toHaveBeenCalledWith({kind:'next',targetId:'b'},18,{origin:'continuous_user'})
 })
 it('queues a selection during a locked handoff and prepares it after takeover',async()=>{
  const {run,p,tracks}=fixture();run.tick();await flush();p.prepareNext.mockClear();p.pending={plan:{to:'b'}};p.gate.locked=true
  run.choose('c');await flush();expect(run.next.state.status).toBe('queued');expect(p.prepareNext).not.toHaveBeenCalled();expect(p.cancel).not.toHaveBeenCalled()
  p.current=tracks[1];p.pending=null;p.gate.locked=false;run.tick();await flush();expect(p.prepareNext).toHaveBeenCalledWith('c')
 })
 it('ignores an obsolete song detail response after a newer choice',async()=>{
  let resolve!:(value:any)=>void;const {run,p,tracks}=fixture((file:string)=>file==='b.json'?new Promise(r=>resolve=r):Promise.resolve({track:tracks.find(t=>file===t.id+'.json')}))
  run.choose('b');run.choose('c');await flush();resolve({track:tracks[1]});await flush();expect(run.next.state.id).toBe('c');expect(p.prepareNext.mock.calls).toEqual([['c']])
 })
 it('does not start after an initial metadata request resolves in the background',async()=>{
  let resolve!:(value:any)=>void;const {run,tracks}=fixture(()=>new Promise(r=>resolve=r));const start=run.start('a');run.pauseForHost();resolve({track:tracks[0]});await start;expect(run.session.start).not.toHaveBeenCalled();expect(run.starting).toBe(false)
 })
 it('does not start after a user stops while details are loading',async()=>{
  let resolve!:(value:any)=>void;const {run,tracks}=fixture(()=>new Promise(r=>resolve=r));const start=run.start('a');run.stop();resolve({track:tracks[0]});await start;expect(run.session.start).not.toHaveBeenCalled()
 })
 it('retains the chosen next song through a seek and retries preparation',async()=>{
  const {run,p}=fixture();run.choose('b');await flush();p.prepareNext.mockClear();await run.seek(170);await flush();expect(p.seek).toHaveBeenCalledWith(170);expect(p.prepareNext).toHaveBeenCalledWith('b')
 })
 it('does not automatically mix when the user disabled continuation',async()=>{
  const {run,p}=fixture();run.tick();await flush();run.setAutomatic(false);p.position=230;run.tick();await flush();expect(p.request).not.toHaveBeenCalled();run.setVolume(.42);expect(p.setVolume).toHaveBeenCalledWith(.42)
 })
})

describe('published source-bound new algorithm',()=>{
 const index=JSON.parse(readFileSync(new URL('../../public/continuous/library.json',import.meta.url),'utf8'))
 const tracks=index.tracks.map((entry:any)=>JSON.parse(readFileSync(new URL('../../public/'+entry.detailUrl,import.meta.url),'utf8')).track)
 it('uses the published changed-cue example with dynamic EQ and real VAD evidence',()=>{
  const a=tracks.find((t:any)=>t.title==='24K Magic (1)'),b=tracks.find((t:any)=>t.title==='Clap Clap')
  expect(a).toBeTruthy();expect(b).toBeTruthy()
  const args=[a,tracks,80,{kind:'next' as const,targetId:b.id},new Set<string>(),18,false] as const
  const original=planV31(...args).best,changed=planVocalOverlap(...args).best as any
  expect(original).toBeTruthy();expect(changed).toBeTruthy();expect(changed.v30Eq).toBeTruthy()
  expect(changed.vocalOverlap.version).toBe('vocal-overlap-v1');expect(changed.start).toBeGreaterThan(original!.start)
  expect(changed.asset.sha256).toBe(original!.asset.sha256);expect(changed.duration).toBe(original!.duration)
  expect(changed.vocalOverlap.weightedOverlap).toBeLessThan(changed.vocalOverlap.oldVocalProduct)
 })
 it('rejects a track whose report/VAD binding was changed',()=>{
  const a=structuredClone(tracks.find((t:any)=>t.title==='24K Magic (1)')),b=tracks.find((t:any)=>t.title==='Clap Clap')
  a.preprocessing.bindingChecks.reportHash=false
  expect(planVocalOverlap(a,[a,b],80,{kind:'next',targetId:b.id},new Set(),18,false).best).toBeNull()
 })
})
