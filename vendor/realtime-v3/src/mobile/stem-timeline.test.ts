import {it,expect} from 'vitest'
import {validateStemTimeline,STEM_ROLES} from './stem-timeline'
const timeline=()=>({schema:'harbeat.stem-timeline.v1',clock:'transition-start',duration:8,a:Object.fromEntries(STEM_ROLES.map(r=>[r,[[0,1],[8,0]]])),b:Object.fromEntries(STEM_ROLES.map(r=>[r,[[0,0],[8,1]]]))})
it('retains independent absolute gains while preserving source cue and role capacity',()=>{
 const t:any=timeline();t.a.bass=[[0,1],[2,0],[8,0]];t.b.bass=[[0,0],[2,1],[8,1]]
 expect(validateStemTimeline(t,8)).toBe(t)
 t.b.drums=[[0,0],[2,1],[8,1]]
 expect(()=>validateStemTimeline(t,8)).toThrow()
})
it('rejects malformed, discontinuous or excessive controls even with a valid outer fingerprint',()=>{
 for(const mutate of [(t:any)=>t.a.bass=[[0,1],[8,2]],(t:any)=>t.b.vocals=[[0,0],[4,1],[3,0],[8,1]],(t:any)=>delete t.a.drums,(t:any)=>t.a.other=[[0,1],[7,0]],(t:any)=>t.b.bass=[[0,0],[7.999,0],[8,1]]]){const t:any=timeline();mutate(t);expect(()=>validateStemTimeline(t,8)).toThrow()}
})
