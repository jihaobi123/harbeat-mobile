export type ExitExperiment='vinyl-brake'|'backspin-echo'|'loop-roll'|'reverb-out'
export type ExitEffectSpec={algorithm:'phone-exit-v1';method:ExitExperiment;captureStart:number;captureEnd:number;tailSeconds:.55}
export const exitNames:Record<ExitExperiment,string>={'vinyl-brake':'刹车停盘','backspin-echo':'倒转搓碟＋回声','loop-roll':'缩短循环 Roll','reverb-out':'混响收尾'}
/** A-only replacement, generated on the phone with the desktop's exact kernel. */
export function renderExitLayer(method:ExitExperiment,a:Float32Array[],sr:number,bpm:number){
 if(a[0]?.length!==Math.round(sr*3))throw Error('退出效果只接受三秒来源区间')
 const rendered=renderExitExperiment(method,a,a.map(()=>new Float32Array(sr)),sr,bpm)
 return{channels:rendered.channels.map(c=>Float32Array.from(c.slice(0,rendered.tailEndFrame),v=>v/.646)),sampleRate:sr,handoffFrame:rendered.handoffFrame,tailEndFrame:rendered.tailEndFrame}
}
/** Offline listening experiments only. Incoming PCM stays at native speed. */
export function renderExitExperiment(method:ExitExperiment,a:Float32Array[],b:Float32Array[],sr:number,bpm:number){
 if(!Object.hasOwn(exitNames,method)||![sr,bpm].every(Number.isFinite)||sr<8000||sr>96000||bpm<40||bpm>240||!a.length||a.length!==b.length||a.length>2||a.some(x=>x.length!==a[0].length)||b.some(x=>x.length!==b[0].length)||a[0].length<sr*3||b[0].length<sr||[...a,...b].some(x=>!x.every(Number.isFinite)))throw Error('Invalid bounded exit experiment input')
 const cut=a[0].length,beat=Math.round(sr*60/bpm),span=Math.min(cut,2*beat),from=cut-span,edge=Math.max(2,Math.round(.004*sr)),tail=Math.round(.55*sr)
 const channels=a.map((input,c)=>{
  const out=new Float32Array(cut+b[0].length),effect=new Float32Array(cut+tail);effect.set(input)
  const read=(p:number)=>{p=Math.max(0,Math.min(cut-1,p));const i=Math.floor(p);return input[i]+(input[Math.min(cut-1,i+1)]-input[i])*(p-i)}
  if(method==='vinyl-brake'){let p=from;for(let i=from;i<cut;i++){const u=(i-from)/span;effect[i]=read(p)*Math.min(1,(cut-i)/edge);p+=Math.max(.025,(1-u)**1.8)}}
  if(method==='backspin-echo'){
   const n=Math.min(span,Math.round(sr*.8)),start=cut-n;let p=cut-1
   for(let i=start;i<cut;i++){const u=(i-start)/n,fade=Math.min(1,(i-start)/edge);effect[i]=input[i]*(1-fade)+read(p)*fade*Math.min(1,(cut-i)/edge)*.65;p-=1+1.4*u}
   const delay=Math.round(sr*Math.min(.24,60/bpm/2));for(let i=start+delay;i<cut+tail;i++)effect[i]+=(i-delay<cut?effect[i-delay]:effect[i-delay]*.24)*.16*Math.min(1,(cut+tail-i)/edge)
  }
  if(method==='loop-roll'){
   for(let i=from;i<cut;i++){const part=Math.min(3,Math.floor((i-from)/span*4)),n=Math.max(edge*2,Math.round(beat/2**part)),j=(i-from)%n,fade=Math.min(1,j/edge,(n-1-j)/edge),blend=Math.min(1,(i-from)/edge);effect[i]=input[i]*(1-blend)+read(from+j)*Math.max(0,fade)*blend}
  }
  if(method==='reverb-out'){
   const capture=input.slice(from),taps=24
   for(let tap=0;tap<taps;tap++){const delay=Math.round(sr*(.019+.0197*tap)),gain=.07*Math.exp(-tap/7)*(tap%2?-.85:1);for(let i=0;i<capture.length&&from+i+delay<effect.length;i++)effect[from+i+delay]+=capture[i]*gain*Math.min(1,(effect.length-from-i-delay)/edge)}
  }
  for(let i=0;i<out.length;i++){
   const outgoing=i<effect.length?effect[i]*(i<cut?Math.min(1,(cut-i)/edge):Math.min(1,(cut+tail-i)/edge)):0
   out[i]=.646*(outgoing+(i>=cut?b[c][i-cut]*Math.min(1,(i-cut)/edge):0))
  }
  return out
 })
 return{channels,sampleRate:sr,handoffFrame:cut,tailEndFrame:cut+tail,method,nativeIncomingRate:1 as const,scope:'desktop-audition-only' as const}
}
