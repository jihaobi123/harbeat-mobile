import {LiveGraph} from '../../vendor/realtime-v3/src/mobile/longmix/live-graph'
import {MultiGraph} from '../../vendor/realtime-v3/src/mobile/longmix/multi-graph'
import {filterLoop} from '../../vendor/realtime-v3/src/mobile/longmix/multi-dsp'
;(window as any).testMulti=async(folder:string,variant:string,exitIndex:number,cancel=false)=>{
 const approval=await(await fetch(folder+'/approval.json')).json(),scene=approval.base.scene,sr=44100,n=Math.round(scene.duration*sr),ctx=new OfflineAudioContext(2,n+512,sr)
 const load=async(name:string)=>ctx.decodeAudioData(await(await fetch(folder+'/'+name)).arrayBuffer()),pcm:any={a:{},b:{}}
 for(const layer of scene.layers)pcm[layer.side][layer.role]=await load('runtime-inputs/'+layer.side+'.'+layer.role+'.wav')
 const base=new LiveGraph(ctx,ctx.destination,approval.base,pcm,ctx.createGain().gain,0,()=>{}),buffers=new Map<string,AudioBuffer>();let filterError=0
 if(variant!=='ab')for(const layer of approval.layers){if(variant==='abc'&&layer.source==='d')continue;const input=await load(layer.source+'-before-filter.wav'),expected=await load(layer.source+'-processed.wav'),x=new Float32Array(input.length*2);for(let i=0;i<input.length;i++){x[i*2]=input.getChannelData(0)[i];x[i*2+1]=input.getChannelData(1)[i]};const out=filterLoop(x,sr,layer.filter),buffer=ctx.createBuffer(2,input.length,sr);for(let c=0;c<2;c++)for(let i=0;i<input.length;i++){buffer.getChannelData(c)[i]=out[i*2+c];filterError=Math.max(filterError,Math.abs(out[i*2+c]-expected.getChannelData(c)[i]))}buffers.set(layer.source+':'+layer.role,buffer)}
 const selected=approval.layers.filter((l:any)=>variant==='abcd'||variant==='abc'&&l.source==='c'),graph=selected.length?new MultiGraph(ctx,ctx.destination,base,{approval:{...approval,layers:selected},buffers,release:()=>{}},0):base,e=scene.exits[exitIndex]
 if(exitIndex<2)graph.setExit(e);if(cancel)graph.cancel();const rendered=await ctx.startRendering();let peak=0,error=0,count=0,maxError=0
 const reference=exitIndex===2&&!cancel&&true?await load(variant==='ab'?'AB.wav':'combined.wav'):null
 for(let c=0;c<2;c++)for(let i=0;i<n;i++){const value=rendered.getChannelData(c)[i];peak=Math.max(peak,Math.abs(value));if(reference&&i>=Math.ceil(.008*sr)){const d=value-reference.getChannelData(c)[i];error+=d*d;maxError=Math.max(maxError,Math.abs(d));count++}}
 return{folder,variant,exitIndex,cancel,sourceCount:variant==='ab'?2:2+new Set(selected.map((l:any)=>l.source)).size,peak,filterMaxError:filterError,referenceRmsError:count?Math.sqrt(error/count):null,referenceMaxError:reference?maxError:null,frames:rendered.length}
}
