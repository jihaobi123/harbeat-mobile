import {scheduleCrossGraph} from '../src/mobile/crossgenre/graph'
import {fixture} from '../src/mobile/crossgenre/fixtures'
import {planCrossGenre} from '../src/mobile/crossgenre/planner'
const SR=44100,LENGTH=SR*4,cut=2
async function render(echo:boolean,audibleA:boolean,audibleB:boolean,cancel=false){
 const ctx=new OfflineAudioContext(2,LENGTH,SR),a=fixture(),b=fixture('b',129.7)
 a.profile.exits[0].echoEligible=echo
 const plan=planCrossGenre(a.track,b.track,a.profile,b.profile,20,18)!
 // Keep capture geometry valid under the translated context handoff.
 const input=ctx.createGain(),ag=ctx.createGain(),bg=ctx.createGain();ag.gain.value=.76;bg.gain.value=0
 input.connect(ag);ag.connect(ctx.destination);bg.connect(ctx.destination)
 const ba=ctx.createBuffer(2,LENGTH,SR),bb=ctx.createBuffer(2,LENGTH,SR)
 for(let c=0;c<2;c++)for(let i=0;i<LENGTH;i++){
  const t=i/SR
  ba.getChannelData(c)[i]=audibleA?echo&&!cancel?(Math.abs(t-1.03)<.0001?.5:0):.3*Math.sin(2*Math.PI*220*t):0
  bb.getChannelData(c)[i]=audibleB?.25*Math.sin(2*Math.PI*880*(t-cut)):0
 }
 const as=ctx.createBufferSource(),bs=ctx.createBufferSource();as.buffer=ba;bs.buffer=bb;as.connect(input);bs.connect(bg);as.start(0);as.stop(cancel?4:cut);bs.start(cut,cut)
 const graph=scheduleCrossGraph(ctx,input,ag.gain,bg.gain,ctx.destination,plan,cut)
 if(cancel){const suspended=ctx.suspend(.5);void suspended.then(()=>{graph.cancel();void ctx.resume()})}
 const result=await ctx.startRendering();graph.dispose();return result.getChannelData(0).slice()
}
const peak=(x:Float32Array,from=0,to=x.length)=>{let p=0;for(let i=from;i<to;i++)p=Math.max(p,Math.abs(x[i]));return p}
async function run(){
 const status=document.querySelector('#status')!;status.textContent='正在渲染…'
 const dry=await render(false,true,true),tail=await render(true,true,false),bonly=await render(true,false,true),reference=await render(false,false,true),cancel=await render(true,false,true,true),continued=await render(true,true,false,true)
 let difference=0;for(let i=0;i<LENGTH;i++)difference=Math.max(difference,Math.abs(bonly[i]-reference[i]))
 const checks={sampleRate:SR,nativeRate:1,dryPeak:peak(dry),dryPreCutPeak:peak(dry,SR,cut*SR-300),incomingBeforeCut:peak(reference,0,cut*SR),echoWindows:[1,1.3,1.6,1.9,2.2].map(t=>peak(tail,Math.round(t*SR),Math.round((t+.25)*SR))),outgoingEchoAfterCut:peak(tail,cut*SR,Math.round(2.36*SR)),echoAfterTail:peak(tail,Math.ceil(2.37*SR)),incomingDelayContamination:difference,cancelledAContinuationPeak:peak(continued,Math.ceil(2.1*SR)),cancelledIncomingAfterCut:peak(cancel,cut*SR),cancelledEffectsAfterTail:peak(cancel,Math.ceil(2.37*SR))}
 const pass=checks.dryPeak<.98&&checks.dryPreCutPeak>.2&&checks.incomingBeforeCut===0&&checks.outgoingEchoAfterCut>1e-7&&checks.echoAfterTail<1e-7&&difference<1e-7&&checks.cancelledIncomingAfterCut<1e-7&&checks.cancelledAContinuationPeak>.2
 const result={pass,checks,basis:'OfflineAudioContext at 44100 Hz using product scheduleCrossGraph; synthetic signals; excludes device output and subjective listening'}
 await fetch('/qa-output/synthetic.json',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result,null,2)})
 status.textContent=JSON.stringify(result,null,2)
}
document.querySelector('#run')!.addEventListener('click',()=>void run().catch(e=>document.querySelector('#status')!.textContent=String(e)))
import {runCorpus} from './corpus'
const corpusButton=document.createElement('button');corpusButton.textContent='生成真实歌曲对比';corpusButton.onclick=()=>void runCorpus().catch(e=>document.querySelector('#status')!.textContent=String(e));document.querySelector('#run')!.after(corpusButton)
