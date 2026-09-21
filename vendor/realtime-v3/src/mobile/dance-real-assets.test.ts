import {describe,it,expect,vi} from 'vitest'
import {readFileSync,existsSync} from 'node:fs'
import {DanceRun,validateDanceSet} from './dance'
import {planNext,Track} from '../realtime/planner'

// Saved responses from the owner's real NAS deployment. This tests the boundary
// between server-selected routes and the unchanged upstream V3 cue planner.
describe('NAS prepared dance sets',()=>{
 for(const style of ['hip-hop','house']){
  const path=new URL(`../../../../outputs/Dance-${style}-5min-20260921.json`,import.meta.url)
  it.skipIf(!existsSync(path))(`${style} supports an unattended five-minute route`,()=>{
   const set=validateDanceSet(JSON.parse(readFileSync(path,'utf8'))),run=new DanceRun(set)
   let entered=0,offset=0,handoffs=0;const attempts:any[]=[]
   const ready=new Set(set.tracks.flatMap(t=>[t.native.url,...t.windows.flatMap(w=>Object.values(w.variants).map(a=>a.url))]))
   const p:any={current:set.tracks[0],tracks:set.tracks,ctx:{currentTime:0,suspend:vi.fn()},position:0,playing:true,busy:false,pending:null,log:vi.fn(),cancel:vi.fn(),setVolume:vi.fn(),stop:vi.fn(()=>{p.playing=false})}
   p.request=vi.fn(async(intent:any,budget:number)=>{
    const result=planNext(p.current,p.tracks,p.position,intent,ready,budget)
    attempts.push({now:p.ctx.currentTime,from:p.current.title,position:p.position,to:intent.targetId,best:result.best?.end,reasons:result.exclusions.map(x=>x.code).filter((v,i,a)=>a.indexOf(v)===i)})
    if(result.best)p.pending={plan:result.best,end:p.ctx.currentTime+result.best.end-p.position}
   })
   for(let now=0;now<=301&&!run.finished;now+=.25){
    p.ctx.currentTime=now
    if(p.pending&&now>=p.pending.end){
     entered=p.pending.end;offset=p.pending.plan.window.end
     p.current=set.tracks.find(t=>t.id===p.pending.plan.to) as Track
     p.pending=null;handoffs++
    }
    p.position=now-entered+offset
    expect(p.position,`source ended early at ${now}: ${JSON.stringify(attempts.slice(-6))}`).toBeLessThanOrEqual(p.current.duration)
    run.tick(p)
   }
   expect(run.finished).toBe(true);expect(handoffs).toBe(set.tracks.length-1)
   expect(run.elapsed).toBeGreaterThanOrEqual(299);expect(run.elapsed).toBeLessThanOrEqual(301)
  })
 }
})
