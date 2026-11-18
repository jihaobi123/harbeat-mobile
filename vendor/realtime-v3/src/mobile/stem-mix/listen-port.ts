import type {LiveTransport} from '../../listen-upstream/realtime/transport'
import type {Plan,Track,Intent} from '../../listen-upstream/realtime/planner'
import {nativeSegment} from '../../listen-upstream/continuous/segments'
import type {Method} from '../../metric-upstream/metric-mix/types'
import {hasMethod,type ExecutionMethod,type DevicePrepared,type DrumPreludeApproval} from '../device-execution'
import {getDevicePCM,pinDevicePCM,releaseDevicePCM} from '../device-prepare'
import {scheduleDeviceGraph} from '../device-graph'
import type {StemPreparation} from './preparation'
type Deck=NonNullable<LiveTransport['active']>
type Host=Pick<LiveTransport,'ctx'|'cache'|'active'|'pending'|'position'|'playing'|'tracks'|'lastPlan'|'log'|'status'>
type Schedule=(plan:Plan,requestedAt:number,intent:Intent,requestId:string,search:any)=>void
type Seam={schedule:Schedule;cancelScheduled:()=>void;monitor:AudioWorkletNode;graph:(t:Track,at:number,offset:number)=>Deck;nativeSource:(d:Deck,b:AudioBuffer,at:number,offset:number,edge:boolean)=>void;retire:(d:Deck,fade:boolean)=>void;protected:()=>void}
type Dependencies={graph:typeof scheduleDeviceGraph;pcm:typeof getDevicePCM;pin:typeof pinDevicePCM}
type Current={method:ExecutionMethod;prelude:boolean;pending:NonNullable<LiveTransport['pending']>;source:Deck;result:DevicePrepared;nodes:AudioNode[];entry:GainNode;bridge:GainNode;restore:()=>void;release:()=>void;nativeStopped:boolean}
/** Same verified beatmatched Plan, base pending and request accounting; own PCM graph. */
export class StemExecution{
 private seam:Seam;private current:Current|null=null;private originalSchedule:Schedule;private originalCancel:()=>void;private scheduleWrapper:Schedule;private cancelWrapper:()=>void
 constructor(private host:Host,private pool:Pick<StemPreparation,'ready'>,private changed:()=>void,private deps:Dependencies={graph:scheduleDeviceGraph,pcm:getDevicePCM,pin:pinDevicePCM},private selection:{method?:(p:Plan,r:DevicePrepared)=>ExecutionMethod|null;prelude?:(p:Plan,r:DevicePrepared)=>DrumPreludeApproval|null;allowOriginal?:()=>boolean}={}){
  this.seam=host as unknown as Seam
  if(!['schedule','cancelScheduled','graph','nativeSource','retire','protected'].every(k=>typeof (this.seam as any)[k]==='function'))throw Error('播放器分轨执行接口不匹配')
  this.originalSchedule=this.seam.schedule;this.originalCancel=this.seam.cancelScheduled
  this.scheduleWrapper=(...args)=>{if(!this.schedule(...args)){if(this.selection.allowOriginal?.()===false)throw Error('当前竞争方案已失效，自动请求不使用原渐混后备');this.originalSchedule.apply(host,args)}}
  this.cancelWrapper=()=>{if(this.current&&host.pending===this.current.pending)this.clear();this.originalCancel.call(host)}
  this.seam.schedule=this.scheduleWrapper;this.seam.cancelScheduled=this.cancelWrapper
 }
 get method():ExecutionMethod|null{return this.current&&this.host.pending===this.current.pending?this.current.method:null}
 get prelude(){return !!this.current?.prelude&&this.host.pending===this.current.pending}
 get result(){return this.current&&this.host.pending===this.current.pending?this.current.result:null}
 private schedule(plan:Plan,_requestedAt:number,_intent:Intent,requestId:string,_search:any){
  const source=this.host.active,b=this.host.tracks.find(t=>t.id===plan.to),result=this.pool.ready(plan)
  const method=result?(this.selection.method?this.selection.method(plan,result):result.decision.recommended):null
  if(!source||!b||!result||!method||method==='original'||!hasMethod(result,method))return false
  const approval=this.selection.prelude?.(plan,result),at=source.at+plan.start-source.offset,sourceAt=at-(approval?.leadSeconds??0),end=at+plan.duration,ctx=this.host.ctx
  if(!this.host.playing||sourceAt<ctx.currentTime+.2)return false
  const body=this.host.cache.buffers.get(nativeSegment(b,plan.window.end).asset.url);if(!body)return false
  let deck:Deck|undefined,graph:ReturnType<typeof scheduleDeviceGraph>|undefined,bridge:GainNode|undefined,release:(()=>void)|undefined,restore=()=>{}
  try{
   const pcm=this.deps.pcm(result);release=this.deps.pin(result)
   bridge=ctx.createGain();bridge.gain.value=.76/.60;bridge.connect(this.seam.monitor)
   deck=this.seam.graph(b,end,plan.window.end);deck.gain.gain.value=0
   this.seam.nativeSource(deck,body,end,plan.window.end,false)
   graph=this.deps.graph(ctx,bridge,result,method,pcm,at,approval?{prelude:{approval,enabled:true}}:undefined)
   graph.entry.gain.setValueAtTime(0,sourceAt);graph.entry.gain.linearRampToValueAtTime(1,sourceAt+.004)
   source.gain.gain.setValueAtTime(.76,sourceAt);source.gain.gain.linearRampToValueAtTime(0,sourceAt+.004)
   // Device graph B falls over 8ms; native B must rise over the same interval.
   deck.gain.gain.setValueAtTime(0,end);deck.gain.gain.linearRampToValueAtTime(.76,end+.008)
   const original=source.stream
   if(original){const proxy=new Proxy(original,{get:(target,key)=>{
    if(key==='deadline'&&(this.current?.nativeStopped||target.deadline>=sourceAt+.004-1/ctx.sampleRate))return Infinity
    if(key==='pins'&&this.current?.nativeStopped)return new Set<string>()
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value
   }});source.stream=proxy;restore=()=>{if(source.stream===proxy)source.stream=original}}
   const pending={plan,deck,start:sourceAt,end,id:result.id,committed:false,requestId}
   this.current={method,prelude:!!approval,pending,source,result,nodes:graph.nodes,entry:graph.entry,bridge,restore,release,nativeStopped:false};this.host.pending=pending;this.host.lastPlan=plan
   this.host.status=approval?'已安排鼓先行与分轨交接':'已安排分轨交接';this.seam.protected();this.seam.monitor.port.postMessage({kind:'arm',events:[{name:approval?'本机鼓先行开始':'本机分轨交接开始',frame:Math.round(sourceAt*ctx.sampleRate),planId:result.id,requestId},{name:'B 原速正文接管',frame:Math.round(end*ctx.sampleRate),planId:result.id,requestId}]})
   this.host.log('stem_plan_scheduled',{requestId,planId:result.id,method:approval?'drum-first':method,baseMethod:method,preludeProof:approval?.proofSha256,analysisRecommended:result.execution.arrangement?.recommended?'stem-handover':result.decision.recommended,timeline:method==='stem-handover'?result.execution.arrangement?.timeline:undefined,processedEvidence:method==='stem-handover'?result.execution.arrangement?.evidence:undefined,plan,decision:result.decision,metrics:result.metrics,contextStart:sourceAt,contextMain:at,contextHandoff:end,gainScale:.76/.60,bodyEdgeSeconds:.008,preparation:result.execution.preparation,renderRequested:false})
   this.changed();return true
  }catch(error){
   if(this.current?.result===result){this.host.pending=null;this.clear();if(deck)this.seam.retire(deck,false)}
   else{restore();release?.();if(graph)this.stopNodes(graph.nodes);graph?.entry.disconnect();bridge?.disconnect();if(deck)this.seam.retire(deck,false)}
   const gain=source.gain.gain;if(gain.cancelAndHoldAtTime)gain.cancelAndHoldAtTime(ctx.currentTime);else gain.cancelScheduledValues(ctx.currentTime);gain.setValueAtTime(.76,ctx.currentTime)
   this.host.log('stem_execution_unavailable',{from:plan.from,to:plan.to,reason:(error as Error).message});return false
  }
 }
 private stopNodes(nodes:AudioNode[]){for(const node of nodes){if('stop' in node)try{(node as AudioBufferSourceNode).stop()}catch{};try{node.disconnect()}catch{}}}
 private clear(){const c=this.current;if(!c)return;this.current=null;c.restore();this.stopNodes(c.nodes);c.entry.disconnect();c.bridge.disconnect();c.release();releaseDevicePCM(c.result);this.seam.monitor.port.postMessage({kind:'cancel',planId:c.pending.id})}
 tick(){
  const c=this.current;if(!c)return;const now=this.host.ctx.currentTime
  if(this.host.pending===c.pending){
   if(!c.nativeStopped&&now>=c.pending.start+.004){c.nativeStopped=true;c.source.stream?.dispose();for(const source of c.source.sources)try{source.stop()}catch{}}
  }else if(this.host.active!==c.pending.deck||now>=c.pending.end+.010)this.clear()
 }
 stop(){this.clear()}
 dispose(){this.clear();if(this.seam.schedule===this.scheduleWrapper)this.seam.schedule=this.originalSchedule;if(this.seam.cancelScheduled===this.cancelWrapper)this.seam.cancelScheduled=this.originalCancel}
}
