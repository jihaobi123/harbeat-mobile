import {jetsonFixture} from './jetson-test-fixture'
import {analyseStemArrangement} from './stem-arrangement'
import {pcmBuffer,type WindowPCM} from './decision-core'
import {sealJetsonDecision} from './jetson-contract'
export async function timelineFixture(){
 const f=await jetsonFixture(),sr=44100,d=f.p.duration,pcm:WindowPCM={a:{},b:{}}
 for(const [side,t] of [['a',f.a],['b',f.b]] as const){t.vocals=[];t.alignment!.phrases=[];t.preprocessing!.vocalActivity.intervals=[]
  for(const [role,hz] of Object.entries({bass:side==='a'?110:146.83,other:side==='a'?440:622.25,drums:70,vocals:0})){const x=new Float32Array(Math.round(d*sr)*2);for(let i=0;i<x.length/2;i++)x[i*2]=x[i*2+1]=hz?.035*Math.sin(2*Math.PI*hz*i/sr):0;pcm[side][role]=pcmBuffer(x,sr)}
  const sum=new Float32Array(Math.round(d*sr)*2);for(let i=0;i<sum.length/2;i++)sum[i*2]=sum[i*2+1]=Object.values(pcm[side]).reduce((s,v)=>s+v.getChannelData(0)[i],0);pcm[side].master=pcmBuffer(sum,sr)
 }
 const arrangement=analyseStemArrangement(f.a,f.b,f.p,pcm);if(!arrangement.eligible)throw Error(arrangement.reason)
 const approval=await sealJetsonDecision({...f.result,analysisVersion:'jetson-decision-v2',stemArrangement:arrangement,requiredStems:arrangement.requiredStems} as any)
 return{...f,pcm,arrangement,approval}
}
