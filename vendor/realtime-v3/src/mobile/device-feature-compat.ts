/** Compatibility entry for historical parity tests. The production device
 * preparation path consumes Jetson decisions and does not call this worker. */
import type {DevicePCM} from './device-prepare'
type FeatureBudget={position:()=>number;start:number;onUnavailable?:(reason:string)=>void}
export async function pitchDifferences(buffers:DevicePCM,sampleRate:number,signal:AbortSignal,budget?:FeatureBudget){
 signal.throwIfAborted()
 if(!buffers.a.bass&&!buffers.a.other)return{bass:null,other:null}
 if(budget&&budget.start-budget.position()<=1){budget.onUnavailable?.('optional_feature_cue_deadline');return{bass:null,other:null}}
 const mono:Record<string,Float32Array>={}
 for(const side of ['a','b'] as const)for(const [stem,key] of [['bass','Bass'],['other','Other']] as const){const b=buffers[side][stem];if(!b)continue;const n=buffers.a.master.length,x=new Float32Array(n),l=b.getChannelData(0),r=b.getChannelData(1);for(let i=0;i<n;i++)x[i]=(l[i]+r[i])*.5;mono[side+key]=x}
 return new Promise<{bass:number|null;other:number|null}>((resolve,reject)=>{
  const worker=new Worker(new URL('./feature-worker.ts',import.meta.url),{type:'module'});let settled=false
  const unknown=(reason:string)=>{budget?.onUnavailable?.(reason);finish(undefined,{bass:null,other:null})},timer=setTimeout(()=>unknown('optional_feature_timeout'),15000),deadline=budget?setInterval(()=>{if(budget.start-budget.position()<=1)unknown('optional_feature_cue_deadline')},50):undefined,cancel=()=>finish(signal.reason??new DOMException('已取消','AbortError'))
  function finish(error?:unknown,value?:{bass:number|null;other:number|null}){if(settled)return;settled=true;clearTimeout(timer);clearInterval(deadline);signal.removeEventListener('abort',cancel);worker.terminate();error?reject(error):resolve(value!)}
  signal.addEventListener('abort',cancel,{once:true});if(signal.aborted){cancel();return}worker.onerror=()=>finish(Error('窗口特征处理器无法启动'));worker.onmessage=({data})=>data.error?finish(Error(data.error)):finish(undefined,data.difference);worker.postMessage({mono,sampleRate},Object.values(mono).map(x=>x.buffer))
 })
}
