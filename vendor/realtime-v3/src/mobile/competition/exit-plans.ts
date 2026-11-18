import type {Track} from '../../listen-upstream/realtime/planner'
import type {CrossPlan} from '../crossgenre/planner'
import {boundarySupport,voiceFraction} from './music'
import {exitNames,type ExitExperiment} from './exit-experiments'
/** The same verified phrase exits as a dry cut, with finite phone-generated A FX. */
export function exitEffectPlans(cut:CrossPlan,a:Track,b:Track):CrossPlan[]{
 if(cut.family!=='structural-cut'||cut.exit<3||Math.min(boundarySupport(a,cut.exit),boundarySupport(b,cut.entry))<.5)return[]
 const beatSpan=Math.min(3,120/a.bpm),voice=voiceFraction(a,cut.exit-beatSpan,cut.exit),reverseVoice=voiceFraction(a,cut.exit-.8,cut.exit),incomingVoice=voiceFraction(b,cut.entry,cut.entry+.55)
 if(voice===null||reverseVoice===null||incomingVoice===null)return[]
 return (Object.keys(exitNames) as ExitExperiment[]).filter(m=>m==='reverb-out'?voice<=.5&&incomingVoice<=.3:m==='backspin-echo'?reverseVoice<=.1&&incomingVoice<=.5:voice<=.2).map(method=>({...cut,id:cut.id+':'+method+':phone-exit-v1',baseId:cut.id,family:method,start:cut.exit-3,peakBound:.98,fx:{algorithm:'phone-exit-v1',method,captureStart:cut.exit-3,captureEnd:cut.exit,tailSeconds:.55}}))
}
