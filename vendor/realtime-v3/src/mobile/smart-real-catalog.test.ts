import {expect,it} from 'vitest'
import fs from 'node:fs'
import {rankChoices,shortlist} from './smart-selection'
const fixture=process.env.SMART_LIBRARY_FIXTURE
it.skipIf(!fixture)('uses the actual published source-bound catalogue for autonomous direction planning',()=>{
 const data=JSON.parse(fs.readFileSync(fixture!,'utf8'))
 const current=data.index.tracks.find((t:any)=>t.id===data.current)
 const picks=shortlist(data.index.tracks,current,data.style,[],new Set())
 const a=data.tracks.find((t:any)=>t.id===data.current)
 const b=data.tracks.filter((t:any)=>picks.some(e=>e.id===t.id))
 const results=[1,2,3,4,5].map(level=>{
  const before=performance.now(),r=rankChoices(a,b,35,level),choice=r.best
  return {level,elapsedMs:Math.round(performance.now()-before),candidates:r.choices.length,
   selected:choice?{title:choice.track.title,from:a.id,to:choice.track.id,windowId:choice.plan.window.id,start:choice.plan.start,end:choice.plan.end,rate:choice.plan.rate,duration:choice.plan.duration,energy:choice.energy,reason:choice.reason}:null}
 })
 console.log(JSON.stringify(results))
 expect(results[2].selected).not.toBeNull()
 for(const r of results)if(r.selected){
  expect(picks.some(t=>t.id===r.selected!.to)).toBe(true)
  expect(r.selected.rate).toBeGreaterThanOrEqual(.95);expect(r.selected.rate).toBeLessThanOrEqual(1.05)
  expect(r.selected.energy.deltasDb).toHaveLength(4)
 }
 if(process.env.SMART_PLAN_OUT)fs.writeFileSync(process.env.SMART_PLAN_OUT,JSON.stringify({date:'2026-10-20',current:a.title,style:data.style,sourceCommit:'978df49191450a602f1b473b31f630a687585a8d',results},null,2))
},30000)
