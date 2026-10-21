import type {Prepared,Method} from '../metric-upstream/metric-mix/types'
import type {Track} from '../metric-upstream/realtime/planner'
const hash=/^[a-f0-9]{64}$/
export const METHODS:Method[]=['original','bass','filter','yield','vocal','bass_filter']
export const METRIC_RELEASE={id:'jetson-decision-device-execution-20261021',sourceCommit:'978df49191450a602f1b473b31f630a687585a8d',policyVersion:'metric-mix-v1.0'}
export function validatePrepared(value:Prepared,a:Track,b:Track,start:number,windowId:string,packId?:string):Prepared{
 if(value?.schema!=='harbeat.metric-mix-result.v1'||value.status!=='ready'||!hash.test(value.id)||value.policyVersion!==METRIC_RELEASE.policyVersion||!hash.test(value.codeVersion))throw Error('混音结果版本不匹配')
 const p=value.plan
 if(!p||p.from!==a.id||p.to!==b.id||p.windowId!==windowId||!Number.isFinite(p.start)||Math.abs(p.start-start)>.002||
  ![p.end,p.duration,p.rate,p.bStart,p.bEnd,p.beatErrorMs].every(Number.isFinite)||p.duration<1||p.duration>32||
  Math.abs(p.end-p.start-p.duration)>.01||p.end>a.duration+.05||p.rate<.95||p.rate>1.05||p.bStart<0||p.bEnd>b.duration-12||Math.abs(p.bStart+p.duration*p.rate-p.bEnd)>.05||p.beatErrorMs>65||p.beatErrorMs<0)throw Error('云端结果与本次接点不一致')
 if(!value.decision?.methods||!METHODS.includes(value.decision.recommended))throw Error('推荐方案不完整')
 for(const [key,asset] of Object.entries(value.assets??{})){
  if(!METHODS.includes(key as Method)||!asset||asset.url!==(packId?`/listen/set-media/${packId}/${value.id}/${key}.wav`:`/listen/smart-media/${value.id}/${key}.wav`)||!hash.test(asset.sha256)||!Number.isFinite(asset.bytes)||asset.bytes<=0||asset.bytes>64*1024*1024||!Number.isFinite(asset.duration)||Math.abs(asset.duration-p.duration)>.04)throw Error('交接素材身份或时长不一致')
 }
 const method=value.decision.recommended
 if(!value.assets[method]||value.decision.methods[method]?.eligible!==true)throw Error('推荐方案没有通过素材检查')
 return value
}
