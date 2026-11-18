import {it,expect} from 'vitest'
import {scoreTransition,chooseTransition,type MusicalFeatures} from './score'
const safe:MusicalFeatures={boundary:1,vocalConflict:0,drumConflict:.1,levelJumpDb:0,tempoChange:.01,waitFraction:.2,benefit:0,tailFit:0,uncertainty:0}
it('lets a cut win over a possible stem blend when simultaneous grooves and vocals conflict',()=>{
 const blend=scoreTransition('bass',{...safe,drumConflict:.9,vocalConflict:.7,benefit:.4})
 const cut=scoreTransition('structural-cut',{...safe,drumConflict:.9,vocalConflict:0})
 expect(cut.score).toBeGreaterThan(blend.score);expect(cut.components.drumConflict).toBeGreaterThanOrEqual(0)
})
it('lets an approved beneficial stem method win for compatible music',()=>{
 expect(scoreTransition('bass',{...safe,benefit:1}).score).toBeGreaterThan(scoreTransition('structural-cut',safe).score)
})
it('requires a common threshold and reserves raw gradual fallback for an explicit manual action',()=>{
 const rows=[{id:'cut',...scoreTransition('structural-cut',{...safe,uncertainty:1,levelJumpDb:6,boundary:0}),eligible:false,reason:'source missing'}]
 expect(chooseTransition(rows,false).fallback).toBe(false);expect(chooseTransition(rows,false).winner).toBeNull()
 expect(chooseTransition(rows,true).fallback).toBe(true)
})
it('is deterministic and never executes NaN or a self-asserted high raw score',()=>{
 expect(()=>scoreTransition('bass',{...safe,benefit:NaN})).toThrow()
 const row={...scoreTransition('structural-cut',safe),eligible:true,reason:'qualified'}
 expect(chooseTransition([{...row,id:'b'},{...row,id:'a'}],false).winner?.id).toBe('a')
})
it('preserves the requested energy direction on the same common candidate set',()=>{
 const candidates=(energy:number)=>[-2.5,2.5].map((levelJumpDb,i)=>({id:String(i),eligible:true,reason:'qualified',...scoreTransition('structural-cut',{...safe,levelJumpDb,energyTargetDb:(energy-3)*1.25})}))
 expect(chooseTransition(candidates(1),false).winner?.id).toBe('0');expect(chooseTransition(candidates(5),false).winner?.id).toBe('1')
})

it('lets a nearby approved reference break close automatic scores only after admission',()=>{
 const ordinary={id:'ordinary',score:74,eligible:true,reason:''}
 const learned={id:'learned',score:73,eligible:true,reason:''}
 const preferred=(row:typeof ordinary)=>row.id==='learned'
 expect(chooseTransition([ordinary,learned],false,preferred).winner?.id).toBe('learned')
 expect(chooseTransition([ordinary,{...learned,score:72}],false,preferred).winner?.id).toBe('ordinary')
 expect(chooseTransition([ordinary,{...learned,eligible:false}],false,preferred).winner?.id).toBe('ordinary')
 expect(chooseTransition([{...ordinary,score:65},{...learned,score:64.5}],false,preferred).winner?.id).toBe('ordinary')
 expect(chooseTransition([ordinary,learned],true,preferred).winner?.id).toBe('ordinary')
})
