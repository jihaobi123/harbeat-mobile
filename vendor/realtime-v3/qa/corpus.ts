import {scheduleCrossGraph} from '../src/mobile/crossgenre/graph'
import {nativeSegment} from '../src/listen-upstream/continuous/segments'
import {LiveTransport} from '../src/listen-upstream/realtime/transport'
const SR=44100
async function readJson(name:string){const r=await fetch('/qa-data/'+name);if(!r.ok)throw Error('Missing '+name);return r.json()}
async function decode(ctx:OfflineAudioContext,asset:any){const r=await fetch('/qa-data/'+asset.url),raw=await r.arrayBuffer(),sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw))).map(x=>x.toString(16).padStart(2,'0')).join('');if(sha!==asset.sha256)throw Error('Excerpt hash mismatch');return ctx.decodeAudioData(raw)}
function wave(b:AudioBuffer){const bytes=new ArrayBuffer(44+b.length*4),v=new DataView(bytes),text=(at:number,s:string)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i))};text(0,'RIFF');v.setUint32(4,bytes.byteLength-8,true);text(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,SR,true);v.setUint32(28,SR*4,true);v.setUint16(32,4,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,b.length*4,true);for(let i=0;i<b.length;i++)for(let c=0;c<2;c++)v.setInt16(44+(i*2+c)*2,Math.round(Math.max(-1,Math.min(1,b.getChannelData(c)[i]))*32767),true);return bytes}
async function output(name:string,body:any){const r=await fetch('/qa-output/'+name,{method:'POST',body});if(!r.ok)throw Error('Save failed')}
async function render(pair:any,family:string,tracks:Map<string,any>){
 const legacy=family==='legacy',plan=legacy?pair.legacy.plan:pair[family],inputs=pair.inputs[family],at=(legacy?plan.end:plan.exit)-inputs.a.sourceStart,length=Math.ceil((at+8)*SR),ctx=new OfflineAudioContext(2,length,SR)
 const a=tracks.get(pair.a.id),b=tracks.get(pair.b.id),monitor=ctx.createGain();monitor.gain.value=.85;monitor.connect(ctx.destination);(monitor as any).port={postMessage:()=>{}}
 const host:any=Object.create(LiveTransport.prototype);Object.assign(host,{ctx,monitor,tracks:[a,b],cache:{buffers:new Map()},gate:{revision:1},options:{},protected:()=>{},update:()=>{},log:()=>{},comparisonMidDb:-5})
 const ab=await decode(ctx,inputs.a),bb=await decode(ctx,inputs.b),deck=(LiveTransport.prototype as any).graph.call(host,a,0,inputs.a.sourceStart);host.active=deck
 host.source(deck,ab,0,0,at,false)
 let graph:any=null
 if(legacy){
  const head=await decode(ctx,inputs.head);host.cache.buffers.set(b.native.url,bb);host.cache.buffers.set(nativeSegment(b,plan.window.end).asset.url,bb);host.cache.buffers.set(plan.asset.url,head)
  // Source excerpt starts exactly at the old native body offset; preserve the
  // product graph's clocks/EQ while translating excerpt-local buffer offsets.
  host.nativeSource=(d:any,buffer:AudioBuffer,start:number,_offset:number,edge:boolean)=>host.source(d,buffer,start,0,undefined,edge)
  ;(LiveTransport.prototype as any).schedule.call(host,plan,0,{kind:'next',targetId:b.id},'offline-corpus',{candidates:[plan]})
 }else{
  const next=host.graph(b,at,plan.entry);next.gain.gain.value=0;host.source(next,bb,at,0,undefined,true)
  graph=scheduleCrossGraph(ctx,deck.nodes[0],deck.gain.gain,next.gain.gain,monitor,plan,at)
 }
 const rendered=await ctx.startRendering();graph?.dispose();let peak=0,jump=0,quiet=0,total=0
 for(let c=0;c<2;c++){const data=rendered.getChannelData(c);for(let i=0;i<data.length;i++){peak=Math.max(peak,Math.abs(data[i]));if(Math.abs(i-at*SR)<SR*.02&&i>0)jump=Math.max(jump,Math.abs(data[i]-data[i-1]));total+=data[i]*data[i]}for(let i=Math.round((at-.05)*SR);i<Math.round((at+.05)*SR);i++)quiet+=data[i]*data[i]}
 const name=pair.id+'-'+family+'.wav';await output(name,wave(rendered));return{family,file:name,peak,peakDbfs:20*Math.log10(Math.max(1e-9,peak)),boundaryMaxSampleStep:jump,boundary100msRms:Math.sqrt(quiet/(.1*SR*2)),rms:Math.sqrt(total/(length*2)),seconds:length/SR,contextHandoff:at,nativeIncomingRate:legacy?plan.rate:1,clipFree:peak<1,subjectiveListening:'unscored',graph:legacy?'pinned LiveTransport.schedule + source excerpt translation; native FFmpeg entry':'product scheduleCrossGraph + pinned deck/source graph',postLimiter:false}
}
export async function runCorpus(){
 const status=document.querySelector('#status')!;status.textContent='读取真实歌曲与来源校验…'
 const corpus=await readJson('corpus-audio.json'),catalog=await readJson('catalog-full-qa.json'),tracks=new Map<string,any>(catalog.tracks.map((t:any)=>[t.id,t])),results=[]
 for(const pair of corpus.pairs){
  const methods=[];for(const family of ['structural','echo','legacy'])if(pair.inputs[family]){status.textContent=`正在渲染 ${pair.id} / ${family}`;methods.push(await render(pair,family,tracks))}
  results.push({id:pair.id,cohort:pair.cohort,a:pair.a,b:pair.b,evidence:pair.evidence,drumSources:pair.drumSources,halfDoubleStatus:pair.halfDoubleStatus,methods,legacyAvailable:pair.legacy.available,legacyExclusions:pair.legacy.exclusions});await output('real-corpus.json',JSON.stringify({pairs:results,complete:results.length===corpus.pairs.length},null,2))
 }
 status.textContent=JSON.stringify({pairs:results.length,renders:results.flatMap(x=>x.methods).length,clipFree:results.every(x=>x.methods.every((m:any)=>m.clipFree)),subjectiveListening:'unscored'},null,2)
}
