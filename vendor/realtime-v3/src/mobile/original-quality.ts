import type {Track,Plan} from '../metric-upstream/realtime/planner'
import {alignedVocalOverlap} from '../metric-upstream/vocal-overlap/score'
/** Full-duration dual vocals are evidence against an ordinary-master fallback.
 * This does not claim that shorter overlaps are semantically safe. */
export function fullVocalCollision(a:Track,b:Track,p:Plan){
 const m=alignedVocalOverlap(a.vocals!,b.vocals!,{aStart:p.start,bStart:p.window.start,bEnd:p.window.end,duration:p.duration,rate:p.rate})
 return m.simultaneousSec>=p.duration-.065
}
