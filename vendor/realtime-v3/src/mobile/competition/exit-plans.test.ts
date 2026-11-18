import {it,expect} from 'vitest'
import {fixture} from '../crossgenre/fixtures'
import {enumerateCrossGenre} from '../crossgenre/planner'
import {experimentalPlans,validateNativeWinner} from './experiments'
import {nativeCandidate} from './candidates'
import {exitNames} from './exit-experiments'
const hash='a'.repeat(64)
function pair(){const a=fixture('a',100),b=fixture('b',140);a.track.sections=[{start:0,end:32,label:'verse'}];b.track.sections=[{start:16,end:120,label:'chorus'}];return{a,b}}
it('enumerates all four source-bound phone exit effects and validates every fixed descriptor',()=>{
 const {a,b}=pair(),base=enumerateCrossGenre(a.track,b.track,a.profile,b.profile,20,30),all=experimentalPlans(base,a.track,b.track,[],true,hash)
 for(const method of Object.keys(exitNames)){
  const p=all.find(p=>p.family===method)!;expect(p,method).toBeTruthy();expect(p.fx?.captureStart).toBe(29);expect(p.start).toBe(29);expect(p.end).toBe(32)
  validateNativeWinner(p,a.track,b.track,a.profile,b.profile,[],true,hash)
  expect(()=>validateNativeWinner({...p,fx:{...p.fx!,captureStart:28}},a.track,b.track,a.profile,b.profile,[],true,hash)).toThrow()
  expect(()=>validateNativeWinner(p,a.track,b.track,a.profile,b.profile,[],false,hash)).toThrow()
 }
})
it('keeps intrusive reverse/roll effects away from ongoing words and excludes tails over dense incoming words',()=>{
 const {a,b}=pair();a.track.vocals=[[29,32]];b.track.vocals=[[16,18]]
 const plans=experimentalPlans(enumerateCrossGenre(a.track,b.track,a.profile,b.profile,20,30),a.track,b.track,[],true,hash)
 expect(plans.some(p=>Object.hasOwn(exitNames,p.family))).toBe(false)
})
it('adds different contextual rule contributions for tempo reset, drum conflict and incoming voice',()=>{
 const {a,b}=pair(),base=enumerateCrossGenre(a.track,b.track,a.profile,b.profile,20,30),plans=experimentalPlans(base,a.track,b.track,[],true,hash)
 const row=(method:string)=>nativeCandidate(a.track,b.track,plans.find(p=>p.family===method)!,20,30)
 expect(row('vinyl-brake').components.sceneFit).toBeGreaterThan(row('loop-roll').components.sceneFit)
 const reverb=row('reverb-out');b.track.vocals=[[16,18]];expect(row('reverb-out').components.sceneFit).toBeLessThan(reverb.components.sceneFit)
 expect(row('vinyl-brake').reason).toContain('速度跨度')
})
