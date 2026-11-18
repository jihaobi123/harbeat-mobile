import type {Track} from '../../listen-upstream/realtime/planner'
import {POLICY,sourceMatches,type CrossProfile,type Source,type Entry,type Exit} from './contract'
import type {BridgeMaterial,LoopRamp} from './bridge'
import type {measuredHalfDouble} from '../competition/music'
import type {ExitExperiment,ExitEffectSpec} from '../competition/exit-experiments'

export type CrossFamily='structural-cut'|'echo-out'|'drum-bridge'|'loop-ramp'|'half-double'|ExitExperiment
export type Echo={captureStart:number;captureEnd:number;delaySeconds:number;feedback:number;sendGain:number;wetGain:number;highpassHz:number;lowpassHz:number;tailSeconds:number}
export type CrossPlan={schema:'harbeat.crossgenre-plan.v1';policy:typeof POLICY;id:string;family:CrossFamily;from:string;to:string;exit:number;entry:number;rate:1;start:number;end:number;source:{a:Source;b:Source};outgoing:Exit;incoming:Entry;echo:Echo|null;peakBound:number;score:number;evidence:{semanticPhraseStatus:'unverified';levelDeltaDb:number;basis:string};baseId?:string;bridge?:{material:BridgeMaterial;ramp:LoopRamp;catalogSha256:string};mapping?:NonNullable<ReturnType<typeof measuredHalfDouble>>;fx?:ExitEffectSpec}
export const nativeTakeover=(p:CrossPlan)=>p.exit+(p.bridge?.ramp.duration??0)

/** Separate native-tempo family: no matching variant, beat warp or old Plan. */
function candidatesFor(a:Track,b:Track,ap:CrossProfile,bp:CrossProfile,position:number,budget=18,energy=3,options:{family?:CrossFamily;automatic?:boolean}={}):CrossPlan[]{
 if(!sourceMatches(a,ap.source)||!sourceMatches(b,bp.source))throw Error('跨风格资料与当前歌曲来源不一致')
 if(a.id===b.id||![position,budget,energy].every(Number.isFinite)||position<0||budget<=0)return []
 const candidates:CrossPlan[]=[],target=Math.max(-2.5,Math.min(2.5,(energy-3)*1.25))
 for(const outgoing of ap.exits){
  const exit=outgoing.time
  if(options.automatic&&(exit<a.duration*.5||exit<position+12))continue
  if(exit<position+2.5||exit>position+budget||exit>=a.duration-.5)continue
  for(const incoming of bp.entries){
   const delta=incoming.body.rmsDbfs-outgoing.before.rmsDbfs
   if(Math.abs(delta)>6||incoming.time+16>b.duration||incoming.head.rmsDbfs< -42)continue
   let echo:Echo|null=null
   if(outgoing.echoEligible&&options.family!=='structural-cut')echo={captureStart:outgoing.capture.start,captureEnd:outgoing.capture.end,delaySeconds:Math.min(.5,30/outgoing.localBpm),feedback:.24,sendGain:.25,wetGain:.12,highpassHz:600,lowpassHz:4000,tailSeconds:Math.min(.35,45/incoming.localBpm)}
   if(options.family==='echo-out'&&!echo)continue
   const peakBound=.76*Math.max(outgoing.before.peak,incoming.body.peak)+(echo?outgoing.capture.peak*echo.sendGain*echo.wetGain/(1-echo.feedback):0)
   if(peakBound>.98)continue
   const family=echo?'echo-out':'structural-cut',start=echo?Math.min(exit-.02,echo.captureStart):exit-.02
   if(start<position+.5)continue
   candidates.push({schema:'harbeat.crossgenre-plan.v1',policy:POLICY,id:[POLICY,a.id,b.id,ap.source.reportSha256.slice(0,12),bp.source.reportSha256.slice(0,12),outgoing.id,incoming.id,family].join(':'),family,from:a.id,to:b.id,exit,entry:incoming.time,rate:1,start,end:exit,source:{a:ap.source,b:bp.source},outgoing,incoming,echo,peakBound,
    score:1+(options.automatic?(exit>=a.duration*.65?.2:0)+.1*exit/a.duration:-.12*(exit-position)/budget)-.06*Math.abs(delta-target)-.04*incoming.time/b.duration+(echo?.03:0),
    evidence:{semanticPhraseStatus:'unverified',levelDeltaDb:delta,basis:'Jetson source-bound complete-bar section candidates and VAD/RMS vocal release; no cross-tempo beatmatch claim'}})
  }
 }
 return candidates.sort((x,y)=>y.score-x.score||x.exit-y.exit||x.entry-y.entry||x.id.localeCompare(y.id))
}

export function planCrossGenre(...args:Parameters<typeof candidatesFor>):CrossPlan|null{return candidatesFor(...args)[0]??null}
export function enumerateCrossGenre(...args:Parameters<typeof candidatesFor>):CrossPlan[]{const [a,b,ap,bp,position,budget=18,energy=3,options={}]=args;return [...candidatesFor(a,b,ap,bp,position,budget,energy,{...options,family:'structural-cut'}),...candidatesFor(a,b,ap,bp,position,budget,energy,{...options,family:'echo-out'})]}
