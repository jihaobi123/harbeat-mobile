import {expect,it} from 'vitest'
import {cohorts,selectCohorts,drumDistance} from './cohorts'

it('requires measured drum differences for the near-tempo group',()=>{
 expect(cohorts({aBpm:100,bBpm:103,drumDifference:null,aVocal:.1,bVocal:.1})).not.toContain('near-groove')
 expect(cohorts({aBpm:100,bBpm:103,drumDifference:.4,aVocal:.1,bVocal:.1})).toContain('near-groove')
 expect(drumDistance([1,0,0,0],[0,1,0,0])).toBe(1)
 expect(drumDistance([0,0],[0,0])).toBeNull()
})
it('separates half/double candidates from other large tempo gaps and keeps dense vocals explicit',()=>{
 expect(cohorts({aBpm:64,bBpm:125,drumDifference:.4,aVocal:.8,bVocal:.7})).toEqual(['dense-vocals','half-double'])
 expect(cohorts({aBpm:94,bBpm:130,drumDifference:.4,aVocal:.2,bVocal:.1})).toEqual(['large-gap'])
})
it('selects 24 distinct source pairs with six per group and reports missing coverage',()=>{
 const names=['near-groove','large-gap','dense-vocals','half-double'] as const
 const rows=names.flatMap(group=>Array.from({length:8},(_,i)=>({id:group+i,from:group+'a'+i,to:group+'b'+i,groups:[group],score:8-i})))
 const result=selectCohorts(rows,6)
 expect(result).toHaveLength(24);expect(new Set(result.map(r=>r.id)).size).toBe(24)
 for(const group of names)expect(result.filter(r=>r.cohort===group)).toHaveLength(6)
 expect(()=>selectCohorts(rows.filter(r=>r.groups[0]!=='half-double'),6)).toThrow(/half-double/)
})
