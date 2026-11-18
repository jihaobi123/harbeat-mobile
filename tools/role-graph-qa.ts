/** Synthetic Web Audio execution QA. These fixtures are not music approvals. */
import {RoleGraph} from '../vendor/realtime-v3/src/mobile/longmix/role-graph'
import {LiveGraph} from '../vendor/realtime-v3/src/mobile/longmix/live-graph'
import {roleFixture,sealRoleFixture} from '../vendor/realtime-v3/src/mobile/longmix/role-fixture'
import {verifyRoleHashes,roleFrames,type RoleApproval} from '../vendor/realtime-v3/src/mobile/longmix/role-contract'
import type {PCM} from '../vendor/realtime-v3/src/mobile/longmix/graph'

const SR=44100,AT_FRAME=4410,AT=AT_FRAME/SR,FADE=.008
const MAX_ERROR=2e-6,RMS_ERROR=2e-7,SILENCE=1e-12,ROLES=['drums','bass','other','vocals'] as const
const assert=(ok:unknown,message:string)=>{if(!ok)throw Error(message)}
type P=[number,number]
type Channels=[Float32Array,Float32Array]
type CaseResult={mode:string;exitIndex:number;clone:boolean;plain:boolean;only:string;cancel:string;deferredExit:boolean;selectedAt:number;nonzeroSceneInputs:number;frames:number;peak:number;maxError:number;rmsError:number;channels:Channels;approval:RoleApproval}
// Independent CPU interpolation: no runtime curve/valueAt helper is used.
function linear(points:readonly P[],t:number){
 if(t<=points[0][0])return points[0][1]
 for(let j=1;j<points.length;j++){const a=points[j-1],b=points[j];if(t<=b[0])return a[1]+(b[1]-a[1])*(t-a[0])/(b[0]-a[0])}
 return points[points.length-1][1]
}
const clamp=(t:number)=>Math.max(0,Math.min(1,t))
function signal(key:string,frame:number,channel:number){
 const hz:Record<string,number>={'a.drums':104,'a.bass':164,'a.other':232,'b.drums':128,'b.bass':196,'b.other':292,'b.vocals':356,'c.other':428,'d.vocals':536,'original':176,'native':268}
 const amp:Record<string,number>={'a.drums':.11,'a.bass':.035,'a.other':.035,'b.drums':.035,'b.bass':.14,'b.other':.035,'b.vocals':.07,'c.other':.12,'d.vocals':.10,'original':.12,'native':.11}
 return amp[key]*Math.sin(2*Math.PI*hz[key]*frame/SR+channel*.43)+amp[key]*.17*Math.sin(2*Math.PI*(hz[key]+12)*frame/SR+channel*.21)
}
function makeBuffer(ctx:BaseAudioContext,key:string,length:number,sourceFirst=0,audible=true){
 const b=ctx.createBuffer(2,length,SR)
 if(audible)for(let c=0;c<2;c++){const out=b.getChannelData(c);for(let f=0;f<length;f++)out[f]=key==='d.vocals'&&(f<Math.ceil(.08*SR)||f>=length-Math.ceil(.15*SR))?0:signal(key,f+sourceFirst,c)}
 return b
}
function compare(actual:Channels,expected:Channels){let peak=0,maxError=0,squared=0,worstFrame=0,worstChannel=0
 for(let c=0;c<2;c++)for(let f=0;f<actual[c].length;f++){const x=actual[c][f],d=x-expected[c][f];assert(Number.isFinite(x),'non-finite rendered sample');peak=Math.max(peak,Math.abs(x));if(Math.abs(d)>maxError){maxError=Math.abs(d);worstFrame=f;worstChannel=c}squared+=d*d}
 return {peak,maxError,rmsError:Math.sqrt(squared/(actual[0].length*2)),worstFrame,worstChannel,worstSamples:[...actual[worstChannel].subarray(Math.max(0,worstFrame-2),worstFrame+3)],expectedSamples:[...expected[worstChannel].subarray(Math.max(0,worstFrame-2),worstFrame+3)]}
}
function peakIn(x:Channels,start:number,end:number){let max=0;for(let c=0;c<2;c++)for(let f=Math.max(0,Math.ceil(start*SR));f<Math.min(x[c].length,Math.ceil(end*SR));f++)max=Math.max(max,Math.abs(x[c][f]));return max}
function rmsIn(x:Channels,start:number,end:number){let energy=0,count=0;for(let c=0;c<2;c++)for(let f=Math.max(0,Math.ceil(start*SR));f<Math.min(x[c].length,Math.ceil(end*SR));f++){energy+=x[c][f]**2;count++}return Math.sqrt(energy/Math.max(1,count))}
async function render(mode:'roles-c'|'roles-cd',exitIndex:number,options:{clone?:boolean;plain?:boolean;only?:string;cancel?:'silent'|'restore';deferredExit?:boolean}={}):Promise<CaseResult>{
 const v=roleFixture(mode) as RoleApproval
 // Non-unity calibration/output scales detect missing or duplicated gain paths.
 v.base.scene.sourceGains={a:.87,b:1.13};v.base.scene.outputGain=.46
 // The unused C tail is deliberately nonzero; explicit window stopping matters.
 v.layers[0].lengthFrames=12*SR
 await sealRoleFixture(v);await verifyRoleHashes(v)
 const approval=options.clone?JSON.parse(JSON.stringify(v)) as RoleApproval:v
 const exits=JSON.parse(JSON.stringify(v.base.scene.exits)),exit=exits[exitIndex],duration=approval.base.scene.duration
 const total=Math.ceil((AT+exit.at+.1)*SR),ctx=new OfflineAudioContext(2,total,SR),audioCtx=ctx as unknown as AudioContext,scene=approval.base.scene
 const pcm:PCM={aMaster:null!,bMaster:null!,a:{},b:{}},entries=new Map<string,AudioBuffer>(),only=options.only??'all'
 const included=(key:string)=>only==='all'||only===key||only===key[0]||only===key.slice(2)
 for(const l of scene.layers){const key=l.side+'.'+l.role,length=l.side==='a'?Math.round((scene.clips.aEnd-scene.clips.aStart)*SR):Math.ceil((duration+FADE)*SR),sourceFirst=Math.round(scene.clips[l.side==='a'?'aStart':'bStart']*SR)
  const b=makeBuffer(ctx,key,length,sourceFirst,included(key));(pcm[l.side] as any)[l.role]=b;entries.set(key,b)
 }
 for(const l of approval.layers)entries.set(l.source+'.'+l.role,makeBuffer(ctx,l.source+'.'+l.role,roleFrames(l),l.sourceStartFrame,included(l.source+'.'+l.role)&&!options.plain))
 const nonzeroSceneInputs=[...entries.values()].filter(b=>b.getChannelData(0).some(v=>Math.abs(v)>1e-9)).length
 const external=only==='all'&&options.cancel!=='silent',original=ctx.createGain();original.gain.value=.76;original.connect(ctx.destination)
 const originalBuffer=makeBuffer(ctx,'original',total,Math.round(scene.clips.aStart*SR)-AT_FRAME,external)
 if(external){const source=ctx.createBufferSource();source.buffer=originalBuffer;source.connect(original);source.start(0)}
 const ready={approval,buffers:new Map(approval.layers.map(l=>[l.source+':'+l.role,entries.get(l.source+'.'+l.role)!])),release:()=>{}}
 const graph=options.plain?new LiveGraph(audioCtx,ctx.destination,approval.base,pcm,original.gain,AT,()=>{}):new RoleGraph(audioCtx,ctx.destination,ready,pcm,original.gain,AT,()=>{},options.clone?exits:undefined)
 // Select separately parsed exits, as independent metadata files do in the app.
 let selectedAt=ctx.currentTime
 if(!options.deferredExit)graph.setExit(options.plain?scene.exits[exitIndex]:exits[exitIndex])
 const nativeBuffer=makeBuffer(ctx,'native',total,Math.round(exit.bPosition*SR),external)
 if(options.cancel)graph.cancel()
 else if(external){const gain=ctx.createGain(),source=ctx.createBufferSource();gain.gain.value=0;gain.connect(ctx.destination);source.connect(gain);source.buffer=nativeBuffer;gain.gain.setValueAtTime(0,AT+exit.at);gain.gain.linearRampToValueAtTime(.76,AT+exit.at+FADE);source.start(AT+exit.at)}
 const checkpoint=options.deferredExit?ctx.suspend(AT+11):null,rendering=ctx.startRendering()
 if(checkpoint){await checkpoint;selectedAt=ctx.currentTime;graph.setExit(options.plain?scene.exits[exitIndex]:exits[exitIndex]);await ctx.resume()}
 const rendered=await rendering,channels:Channels=[rendered.getChannelData(0),rendered.getChannelData(1)],expected:Channels=[new Float32Array(total),new Float32Array(total)]
 const loopFrames=Math.round((scene.clips.aEnd-scene.clips.aStart)*SR),nativeFirst=AT_FRAME+Math.round(exit.at*SR)
 for(let f=0;f<total;f++){
  const t=(f-AT_FRAME)/SR,entered=clamp(t/FADE),left=clamp((t-exit.at)/FADE),bus=t<0||t>=exit.at+FADE?0:scene.outputGain*entered*(1-left)
  for(let channel=0;channel<2;channel++){
   let output=external?originalBuffer.getChannelData(channel)[f]*.76*(options.cancel?1:1-entered):0
   if(!options.cancel&&external&&f>=nativeFirst)output+=nativeBuffer.getChannelData(channel)[f-nativeFirst]*.76*left
   if(!options.cancel&&t>=0){
    for(const l of scene.layers){const points=options.plain||l.side!=='b'?l.points:l.role==='other'?approval.bOther:l.role==='vocals'?(approval.bVocals??l.points):l.points
     const phase=clamp((t-exit.fadeStart)/(exit.at-exit.fadeStart)),envelope=t<exit.fadeStart?linear(points,t):linear(points,exit.fadeStart)*(1-phase)+Number(l.side==='b')*phase
     const b=entries.get(l.side+'.'+l.role)!,index=l.loop?(f-AT_FRAME)%loopFrames:f-AT_FRAME
     if(index>=0&&index<b.length)output+=b.getChannelData(channel)[index]*envelope*scene.sourceGains[l.side]*bus
    }
    if(!options.plain)for(const l of approval.layers){const b=entries.get(l.source+'.'+l.role)!,index=f-AT_FRAME-Math.round(l.outputStart*SR),stop=l.source==='c'?approval.window[1]:l.outputStart+roleFrames(l)/SR
     if(index>=0&&index<b.length&&t<stop)output+=b.getChannelData(channel)[index]*linear(l.points,t)*l.gain
    }
   }
   expected[channel][f]=output
  }
 }
 const measured=compare(channels,expected)
 assert(measured.maxError<=MAX_ERROR&&measured.rmsError<=RMS_ERROR,JSON.stringify({mode,exitIndex,options,...measured}))
 if(options.cancel==='silent'){assert(nonzeroSceneInputs===scene.layers.length+approval.layers.length,'cancel test must contain nonzero audio in every scene input');assert(measured.peak===0,'canceled graph emitted audio')}
 return{mode,exitIndex,clone:!!options.clone,plain:!!options.plain,only,cancel:options.cancel??'none',deferredExit:!!options.deferredExit,selectedAt,nonzeroSceneInputs,frames:total,...measured,channels,approval}
}
const compact=({channels,approval,...v}:CaseResult)=>v
export async function runRoleGraphQA(){
 const cases:any[]=[],invariants:any[]=[],contributions:any[]=[]
 for(const mode of ['roles-c','roles-cd'] as const){
  for(const clone of [false,true])for(let exit=0;exit<3;exit++)cases.push(compact(await render(mode,exit,{clone})))
  for(const exit of [0,1])cases.push(compact(await render(mode,exit,{clone:true,deferredExit:true})))
  for(const cancel of ['silent','restore'] as const){const result=await render(mode,2,{clone:true,only:'all',cancel});cases.push(compact(result))}
  for(const role of ['drums','bass',...(mode==='roles-c'?['b.vocals']:[])] as const){const plain=await render(mode,1,{plain:true,only:role}),changed=await render(mode,1,{clone:true,only:role}),difference=compare(changed.channels,plain.channels)
   assert(difference.maxError<=SILENCE,mode+' changed retained '+role);invariants.push({mode,role,...difference})
  }
 }
 for(const source of ['a','b','c','d']){const result=await render('roles-cd',2,{clone:true,only:source}),rms=rmsIn(result.channels,AT+7.5,AT+8.5),minimum=10**(-45/20)
  assert(rms>=minimum,'four-source probe was silent for '+source)
  let outsidePeak=0
  if(source==='c'||source==='d'){const l=result.approval.layers.find(x=>x.source===source)!,end=source==='c'?result.approval.window[1]:l.outputStart+roleFrames(l)/SR;outsidePeak=Math.max(peakIn(result.channels,0,AT+l.outputStart),peakIn(result.channels,AT+end,result.channels[0].length/SR));assert(outsidePeak<=SILENCE,source+' sounded outside approved window')}
  contributions.push({source,probeStart:AT+7.5,probeEnd:AT+8.5,actualRms:rms,minimum,...(source==='c'||source==='d'?{outsidePeak}: {})})
 }
 const muted=await render('roles-cd',2,{only:'b.vocals',clone:true}),insidePeak=peakIn(muted.channels,AT+6.25,AT+10.25),beforeRms=rmsIn(muted.channels,AT+3,AT+4),afterRms=rmsIn(muted.channels,AT+12,AT+13)
 assert(insidePeak<=SILENCE&&beforeRms>1e-4&&afterRms>1e-4,'B vocal replacement did not preserve surrounding original timeline')
 return{schema:'harbeat.role-graph-numerical-qa.v1',scope:'synthetic-runtime-qa-only',passed:true,engine:'actual OfflineAudioContext; real AudioBufferSourceNode and AudioParam automation',sampleRate:SR,channels:2,limitations:['All audio is generated synthetic PCM. Placeholder source proofs are structural fixtures, not analyzed music or Jetson approvals.','This receipt validates execution arithmetic and ownership, not listening preference or music compatibility.','CPU reference is independent interpolation of source PCM, role curves, calibration scales and 8 ms boundary gains.'],tolerances:{maxAbsoluteError:MAX_ERROR,rmsError:RMS_ERROR,silence:SILENCE},cases,invariants,contributions,bVocalReplacement:{insidePeak,beforeRms,afterRms},summary:{actualOfflineRenders:cases.length+2*invariants.length+contributions.length+1,numericalCases:cases.length,retainedRoleComparisons:invariants.length,actualSourceProbes:contributions.length,maxAbsoluteError:Math.max(...cases.map(x=>x.maxError)),maxRmsError:Math.max(...cases.map(x=>x.rmsError)),maxRenderedPeak:Math.max(...cases.map(x=>x.peak))}}
}
;(window as any).roleGraphQA={run:runRoleGraphQA}
