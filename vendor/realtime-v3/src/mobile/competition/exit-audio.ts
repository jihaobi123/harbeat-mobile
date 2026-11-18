import type {Track,Asset} from '../../listen-upstream/realtime/planner'
import {nativeSegments} from '../../listen-upstream/continuous/segments'
import type {CrossPlan} from '../crossgenre/planner'
import {sourceMatches} from '../crossgenre/contract'
import {canonicalJson} from '../jetson-contract'
import {renderExitLayer,exitNames} from './exit-experiments'
type Cache={load:(asset:Asset,signal?:AbortSignal)=>Promise<AudioBuffer>}
export type PreparedExit={key:string;buffer:AudioBuffer;peakBound:number;proof:{algorithm:'phone-exit-v1';sourceAssets:Asset[];sourceStart:number;sourceEnd:number;outputSha256:string;sampleRate:number;frames:number;peak:number;tailPeak:number;peakBound:number}}
export const exitAudioKey=(p:CrossPlan)=>canonicalJson({id:p.id,from:p.from,to:p.to,source:p.source,entry:p.entry,exit:p.exit,fx:p.fx,peakBound:p.peakBound})
export function exitSourceAssets(a:Track,p:CrossPlan){return p.fx?nativeSegments(a).filter(s=>s.end>p.fx!.captureStart&&s.start<p.fx!.captureEnd).map(s=>s.asset):[]}
/** Callers supply only SHA-verified decoded native segments through AudioCache. */
export async function prepareExitAudio(ctx:BaseAudioContext,cache:Cache,a:Track,p:CrossPlan,signal:AbortSignal):Promise<PreparedExit>{
 signal.throwIfAborted();const fx=p.fx,sr=ctx.sampleRate
 if(!sourceMatches(a,p.source.a))throw Error('退出效果来源已变化')
 if(!fx||fx.algorithm!=='phone-exit-v1'||fx.method!==p.family||!Object.hasOwn(exitNames,fx.method)||fx.captureStart!==p.exit-3||fx.captureEnd!==p.exit||p.start!==fx.captureStart||p.end!==p.exit||fx.tailSeconds!==.55||p.echo||p.bridge||p.mapping||p.rate!==1||p.peakBound!==.98)throw Error('退出效果的固定参数已变化')
 const start=Math.round(fx.captureStart*sr),count=Math.round(3*sr),end=start+count,channels=Array.from({length:2},()=>new Float32Array(count)),assets:Asset[]=[];let next=start
 for(const segment of nativeSegments(a)){
  const segStart=Math.round(segment.start*sr),from=Math.max(start,segStart),to=Math.min(end,Math.round(segment.end*sr));if(to<=from)continue
  if(from!==next)throw Error('退出效果原曲覆盖不完整')
  const buffer=await cache.load(segment.asset,signal);signal.throwIfAborted()
  if(buffer.sampleRate!==sr||buffer.numberOfChannels<1||buffer.numberOfChannels>2||buffer.length<to-segStart)throw Error('退出效果解码覆盖或采样率不一致')
  for(let c=0;c<2;c++)channels[c].set(buffer.getChannelData(Math.min(c,buffer.numberOfChannels-1)).subarray(from-segStart,to-segStart),from-start)
  next=to;assets.push(segment.asset)
 }
 if(next!==end)throw Error('退出效果原曲覆盖不完整')
 const rendered=renderExitLayer(fx.method,channels,sr,a.bpm);let peak=0,tailPeak=0
 for(const channel of rendered.channels)for(let i=0;i<channel.length;i++){const v=Math.abs(channel[i]);if(!Number.isFinite(v))throw Error('退出效果包含非有限音频');peak=Math.max(peak,v);if(i>=count)tailPeak=Math.max(tailPeak,v)}
 const peakBound=.76*Math.max(peak,Math.max(p.incoming.head.peak,p.incoming.body.peak)+tailPeak)
 if(peakBound>p.peakBound||!Number.isFinite(peakBound))throw Error('退出效果与新歌叠加的峰值超过预算')
 const buffer=ctx.createBuffer(2,rendered.channels[0].length,sr),bytes=new Uint8Array(buffer.length*2*4)
 rendered.channels.forEach((c,i)=>{buffer.copyToChannel(c,i);bytes.set(new Uint8Array(c.buffer,c.byteOffset,c.byteLength),i*c.byteLength)})
 const outputSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');signal.throwIfAborted()
 const proof={algorithm:'phone-exit-v1' as const,sourceAssets:assets,sourceStart:fx.captureStart,sourceEnd:fx.captureEnd,outputSha256,sampleRate:sr,frames:buffer.length,peak,tailPeak,peakBound}
 return{key:exitAudioKey(p),buffer,peakBound,proof}
}
export class ExitAudioCache{
 private rows=new Map<string,PreparedExit>()
 constructor(private ctx:BaseAudioContext,private cache:Cache){}
 get size(){return this.rows.size}
 get(p:CrossPlan){return this.rows.get(exitAudioKey(p))}
 async prepare(a:Track,p:CrossPlan,signal:AbortSignal){signal.throwIfAborted();const key=exitAudioKey(p),hit=this.rows.get(key);if(hit)return hit
  const result=await prepareExitAudio(this.ctx,this.cache,a,p,signal);signal.throwIfAborted();this.rows.set(key,result);while(this.rows.size>2)this.rows.delete(this.rows.keys().next().value!);return result
 }
}
