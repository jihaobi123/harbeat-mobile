import {it,expect} from 'vitest'
import {completeGradualPlans} from './gradual'
import {jetsonFixture} from '../jetson-test-fixture'
import {buildV30Eq} from '../../listen-upstream/v30/eq'
it('builds a source-bound EQ identity for each window, including non-best candidates',async()=>{
 const {a,b,p}=await jetsonFixture(),other={...p,id:p.id+'-second',start:p.start+1,end:p.end+1,v30Eq:undefined}
 const rows=completeGradualPlans(a,[b],[p,other]);expect(rows).toHaveLength(2)
 expect(rows[1].v30Eq).toEqual(buildV30Eq(a,b,other));expect(rows[1].v30Eq).toBeDefined()
})
it('uses only exact approved reservation cues within current target, wait budget and automatic half-track rule',async()=>{
 const {reservationGradualPlans}=await import('./gradual'),{a,b,p}=await jetsonFixture()
 const session={approvedCandidates:()=>[{track:b,plan:p}]}
 expect(reservationGradualPlans(session,a,[b],10,30,false,3)).toHaveLength(1)
 expect(reservationGradualPlans(session,a,[],10,30,false,3)).toHaveLength(0)
 expect(reservationGradualPlans(session,a,[b],10,1,false,3)).toHaveLength(0)
 expect(reservationGradualPlans(session,a,[b],10,30,true,3)).toHaveLength(0)
 const changed={...b,provenance:{...b.provenance,masterSha256:'0'.repeat(64)}}
 expect(reservationGradualPlans(session,a,[changed],10,30,false,3)).toHaveLength(0)
})
