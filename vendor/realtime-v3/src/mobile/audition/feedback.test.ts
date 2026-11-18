import {it,expect} from 'vitest'
import {addHeard,heardSeconds,validateRating,blindOrder} from './feedback'
it('records real played intervals while a seek creates no imaginary listening',()=>{
 let spans=addHeard([],0,.25,10)
 spans=addHeard(spans,.25,.5,10);spans=addHeard(spans,.5,8,10)
 expect(heardSeconds(spans)).toBe(.5)
 spans=addHeard(spans,8,8.5,10);spans=addHeard(spans,0,.5,10)
 expect(heardSeconds(spans)).toBe(1)
})
it('keeps missing ratings unknown and rejects scores outside the scale',()=>{
 expect(validateRating(null)).toBeNull();expect(validateRating('')).toBeNull()
 expect(validateRating(3)).toBe(3);expect(()=>validateRating(0)).toThrow();expect(()=>validateRating(6)).toThrow()
})
it('keeps blind order stable for one saved round and retains every available method',()=>{
 const methods=['legacy','structural','echo']
 const first=blindOrder(methods,123)
 expect(blindOrder(methods,123)).toEqual(first);expect([...first].sort()).toEqual([...methods].sort())
 expect(new Set(Array.from({length:20},(_,i)=>blindOrder(methods,i+1).join())).size).toBeGreaterThan(1)
})
