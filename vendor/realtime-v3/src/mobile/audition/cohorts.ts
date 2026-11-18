export type Cohort='near-groove'|'large-gap'|'dense-vocals'|'half-double'
export const COHORTS:Cohort[]=['near-groove','large-gap','dense-vocals','half-double']
type Evidence={aBpm:number;bBpm:number;drumDifference:number|null;aVocal:number;bVocal:number}
/** L1 distance between measured, normalized beat-phase onset histograms. */
export function drumDistance(a:number[],b:number[]):number|null{
 if(!a.length||a.length!==b.length||[...a,...b].some(x=>!Number.isFinite(x)||x<0))return null
 const aa=a.reduce((s,x)=>s+x,0),bb=b.reduce((s,x)=>s+x,0)
 return aa>0&&bb>0?a.reduce((s,x,i)=>s+Math.abs(x/aa-b[i]/bb),0)/2:null
}
export function cohorts(e:Evidence):Cohort[]{
 if(![e.aBpm,e.bBpm,e.aVocal,e.bVocal].every(Number.isFinite)||Math.min(e.aBpm,e.bBpm)<=0)return []
 const gap=Math.abs(Math.log2(e.bBpm/e.aBpm)),half=Math.abs(gap-1)<=Math.log2(1.05),result:Cohort[]=[]
 if(gap<=Math.log2(1.05)&&e.drumDifference!==null&&e.drumDifference>=.25)result.push('near-groove')
 if(gap>=Math.log2(1.25)&&!half)result.push('large-gap')
 if(Math.min(e.aVocal,e.bVocal)>=.45)result.push('dense-vocals')
 if(half)result.push('half-double')
 return result
}
type Candidate={id:string;from:string;to:string;groups:Cohort[];score:number}
export function selectCohorts<T extends Candidate>(rows:T[],perGroup=6):(T&{cohort:Cohort})[]{
 const selected:(T&{cohort:Cohort})[]=[],seen=new Set<string>(),used=new Map<string,number>()
 for(const group of [...COHORTS].sort((a,b)=>rows.filter(x=>x.groups.includes(a)).length-rows.filter(x=>x.groups.includes(b)).length)){
  let count=0
  for(const cap of [2,4,6])for(const row of rows.filter(x=>x.groups.includes(group)).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id))){
   if(count===perGroup)break
   if(seen.has(row.id)||(used.get(row.from)??0)>=cap||(used.get(row.to)??0)>=cap)continue
   selected.push({...row,cohort:group});seen.add(row.id);count++
   for(const id of [row.from,row.to])used.set(id,(used.get(id)??0)+1)
  }
  if(count!==perGroup)throw Error(`Incomplete cohort ${group}: ${count}/${perGroup}`)
 }
 return selected.sort((a,b)=>COHORTS.indexOf(a.cohort)-COHORTS.indexOf(b.cohort)||b.score-a.score||a.id.localeCompare(b.id))
}
