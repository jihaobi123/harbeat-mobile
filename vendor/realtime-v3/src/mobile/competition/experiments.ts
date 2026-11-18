import type {Track} from '../../listen-upstream/realtime/planner'
import {enumerateCrossGenre,nativeTakeover,type CrossPlan} from '../crossgenre/planner'
import {planLoopRamp,validateBridge,type BridgeMaterial} from '../crossgenre/bridge'
import type {CrossProfile} from '../crossgenre/contract'
import {canonicalJson} from '../jetson-contract'
import {measuredHalfDouble} from './music'
import {exitEffectPlans} from './exit-plans'
export function experimentalPlans(base:CrossPlan[],a:Track,b:Track,materials:BridgeMaterial[],enabled:boolean,catalogSha256:string){
 if(!enabled)return[];const plans:CrossPlan[]=[]
 for(const cut of base.filter(p=>p.family==='structural-cut')){
  plans.push(...exitEffectPlans(cut,a,b))
  const mapping=measuredHalfDouble(a,b,cut.exit,cut.entry)
  if(mapping)plans.push({...cut,id:cut.id+':half-double',baseId:cut.id,family:'half-double',mapping})
  for(const material of materials){validateBridge(material)
   for(const family of ['drum-bridge','loop-ramp'] as const){
    const middle=(a.bpm+b.bpm)/2;if(family==='drum-bridge'&&Math.max(Math.abs(a.bpm/middle-1),Math.abs(b.bpm/middle-1))>.08)continue
    try{const ramp=planLoopRamp(material,family==='loop-ramp'?a.bpm:middle,family==='loop-ramp'?b.bpm:middle,1),end=cut.exit+ramp.duration
     if(end>=a.duration-.5)continue
     plans.push({...cut,id:cut.id+':'+family+':'+material.asset.sha256,baseId:cut.id,family,end,bridge:{material,ramp,catalogSha256},peakBound:Math.max(cut.peakBound,.60*material.peak)})
    }catch{}
   }
  }
 }
 return plans
}
const identity=(p:CrossPlan)=>canonicalJson(Object.fromEntries(['id','policy','schema','family','from','to','source','outgoing','incoming','echo','exit','entry','start','end','rate','peakBound','baseId','bridge','mapping','fx'].map(k=>[k,(p as any)[k]])))
export function validateNativeWinner(p:CrossPlan,a:Track,b:Track,ap:CrossProfile,bp:CrossProfile,materials:BridgeMaterial[],enabled:boolean,catalogSha256:string){
 const base=enumerateCrossGenre(a,b,ap,bp,0,a.duration),all=[...base,...experimentalPlans(base,a,b,materials,enabled,catalogSha256)]
 if(!all.some(v=>identity(v)===identity(p))||Math.abs(nativeTakeover(p)-p.end)>1/44100)throw Error('获胜方案的来源、接点、实验授权或素材已变化')
}
