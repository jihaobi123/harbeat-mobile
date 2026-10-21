import type {Track,Plan} from '../metric-upstream/realtime/planner'
import {planContinuous} from '../metric-upstream/continuous/beatAlignment'
import {buildV30Eq} from '../metric-upstream/v30/eq'
import {rankChoices,choiceForPlan} from './smart-selection'
import {analyseWindow,pcmBuffer,rms} from './decision-core'
import {jointStretch} from './joint-stretch'
import {stemCurves,valueAt,type Controls} from './device-execution'
import type {Method} from '../metric-upstream/metric-mix/types'
import {sealJetsonDecision,jsonFingerprint,verifyJetsonDecision,type JetsonDecision} from './jetson-contract'

export function rebuildJetsonPlan(a:Track,b:Track,windowId:string,start:number):Plan{
 const window=b.windows.find(w=>w.id===windowId);if(!window||!Number.isFinite(start))throw Error('Unknown cue')
 const target={...b,windows:[window]},position=Math.max(0,start-.75),rows=[...rankChoices(a,[target],0,3).choices.map(c=>c.plan),...planContinuous(a,[target],position,{kind:'next',targetId:b.id},new Set(),60,false).candidates]
 const found=rows.find(p=>Math.abs(p.start-start)<.002)
 if(!found)throw Error('Cue failed current beat or vocal planner')
 const plan={...found,v30Eq:buildV30Eq(a,b,found)};if(!choiceForPlan(a,b,plan,3))throw Error('Cue failed current level or voice gate')
 return plan
}
export function floatWave(data:Float32Array,sr:number){
 const bytes=new Uint8Array(44+data.byteLength),v=new DataView(bytes.buffer),s=(at:number,text:string)=>{for(let i=0;i<text.length;i++)bytes[at+i]=text.charCodeAt(i)}
 s(0,'RIFF');v.setUint32(4,bytes.length-8,true);s(8,'WAVE');s(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,3,true);v.setUint16(22,2,true);v.setUint32(24,sr,true);v.setUint32(28,sr*8,true);v.setUint16(32,8,true);v.setUint16(34,32,true);s(36,'data');v.setUint32(40,data.byteLength,true)
 for(let i=0;i<data.length;i++)v.setFloat32(44+i*4,data[i],true);return bytes
}
/** Require full contiguous 4/4 bars, with one ordered observed beat per slot. */
function measuredBars(t:Track,start:number,end:number){
 const bars=t.alignment?.bars??[],first=bars.findIndex(r=>Math.abs(r.start-start)<=.065)
 if(first<0)return null
 const rows:typeof bars=[]
 for(const row of bars.slice(first)){
  if(row.start>=end-.065)break
  const previous=rows.at(-1)
  if(!row.valid||row.beats.length!==4||!Number.isFinite(row.end)||row.end<=row.start||Math.abs(row.beats[0]-row.start)>.001||row.beats.some((x,i)=>!Number.isFinite(x)||x>=row.end||i>0&&x<=row.beats[i-1])||previous&&Math.abs(previous.end-row.start)>.001)return null
  rows.push(row)
 }
 return rows.length&&Math.abs(rows.at(-1)!.end-end)<=.065?rows:null
}
export function checkPreludeBeats(a:Track,b:Track,as:number,bs:number,d:number,rate:number){
 const aa=measuredBars(a,as,as+d),bb=measuredBars(b,bs,bs+d*rate)
 if(!aa||!bb||aa.length!==bb.length||aa.length<1)return Infinity
 const times=(rows:NonNullable<typeof aa>)=>[...rows.flatMap(r=>r.beats),rows.at(-1)!.end]
 const x=times(aa),y=times(bb)
 return Math.max(...x.map((t,i)=>Math.abs(t-(as+(y[i]-bs)/rate))))*1000
}
export function mainBeatErrorMs(a:Track,b:Track,p:Plan){return checkPreludeBeats(a,b,p.start,p.window.start,p.duration,p.rate)}
type Coeff=[number,number,number,number,number]
function rbj(kind:'low'|'mid'|'high'|'hp',frequency:number,gain=0):Coeff{
 const w=2*Math.PI*frequency/44100,c=Math.cos(w),s=Math.sin(w),A=10**(gain/40),alpha=s/(2*(kind==='mid'?1.05:Math.SQRT1_2)),beta=2*Math.sqrt(A)*s/Math.SQRT2
 let b0:number,b1:number,b2:number,a0:number,a1:number,a2:number
 if(kind==='low'){b0=A*((A+1)-(A-1)*c+beta);b1=2*A*((A-1)-(A+1)*c);b2=A*((A+1)-(A-1)*c-beta);a0=(A+1)+(A-1)*c+beta;a1=-2*((A-1)+(A+1)*c);a2=(A+1)+(A-1)*c-beta}
 else if(kind==='high'){b0=A*((A+1)+(A-1)*c+beta);b1=-2*A*((A-1)+(A+1)*c);b2=A*((A+1)+(A-1)*c-beta);a0=(A+1)-(A-1)*c+beta;a1=2*((A-1)-(A+1)*c);a2=(A+1)-(A-1)*c-beta}
 else if(kind==='mid'){b0=1+alpha*A;b1=-2*c;b2=1-alpha*A;a0=1+alpha/A;a1=-2*c;a2=1-alpha/A}
 else{b0=(1+c)/2;b1=-(1+c);b2=b0;a0=1+alpha;a1=-2*c;a2=1-alpha}
 return[b0/a0,b1/a0,b2/a0,a1/a0,a2/a0]
}
function processor(){const states=Array.from({length:2},()=>[0,0,0,0]);return(x:number,c:Coeff,ch:number)=>{const q=states[ch],y=c[0]*x+c[1]*q[0]+c[2]*q[1]-c[3]*q[2]-c[4]*q[3];q[1]=q[0];q[0]=x;q[3]=q[2];q[2]=y;return y}}
function drumProxy(a:Float32Array|undefined,b:Float32Array|undefined,frames:number){
 if(!a||!b)return{pass:false,densityRatio:null,onsetAgreement:null}
 const step=Math.round(44100*.125),levels=(x:Float32Array)=>{const rows:number[]=[];for(let i=0;i<frames;i+=step){let power=0;for(let j=i*2;j<Math.min(frames,i+step)*2;j++)power+=x[j]**2;rows.push(Math.sqrt(power/(2*Math.min(step,frames-i))))}return rows},aa=levels(a),bb=levels(b),active=(x:number[])=>{const gate=Math.max(10**(-45/20),Math.max(...x)*.2);return x.filter(v=>v>=gate).length/x.length},da=active(aa),db=active(bb)
 if(db===0)return{pass:false,densityRatio:null,onsetAgreement:null}
 if(da===0)return{pass:true,densityRatio:0,onsetAgreement:1}
 const densityRatio=Math.max(da,db)/Math.min(da,db),onsets=(x:number[])=>{const gate=Math.max(10**(-45/20),Math.max(...x)*.25);return x.flatMap((v,i)=>v-(x[i-1]??0)>=gate?[i]:[])},oa=onsets(aa),ob=onsets(bb),agreement=ob.filter(i=>oa.some(j=>Math.abs(i-j)<=1)).length/Math.max(1,ob.length)
 return{pass:densityRatio<=2.5&&oa.length>=3&&ob.length>=3&&agreement>=.5,densityRatio,onsetAgreement:agreement}
}
/** Sample-wise RBJ proxy, including the full signed single-method and drum curves.
 * Coefficients update every 128 samples. Browser implementations may differ;
 * this is measured evidence with 6dB peak margin, never a proof of sound quality. */
export function evaluatePreludeAudio(a:Record<string,Float32Array>,b:Record<string,Float32Array>,p:Plan,controls:Controls,method:Method,lead:number,fade:number){
 const frames=Math.round((lead+p.duration)*44100),curves=stemCurves(method,controls),routes=Object.fromEntries(['a','b'].map(side=>[side,Object.fromEntries(Object.keys(side==='a'?a:b).map(stem=>[stem,[processor(),processor(),processor()]]))])) as Record<string,Record<string,ReturnType<typeof processor>[]>>,hp=processor()
 let peak=0,prePower=0,preReference=0,mainPower=0,mainReference=0,coeffs:Record<string,Coeff[]>={},hpCoeff:Coeff=rbj('hp',20)
 const eqAt=(side:'a'|'b',t:number)=>{const points=p.v30Eq?.[side];return (['low','high','mid'] as const).map((band,i)=>{let db=0;if(points?.length){const values=points.map(point=>[point.t,point[band]] as [number,number]);db=valueAt(values,t)}return rbj(band,[140,3600,1200][i],db)})}
 for(let i=0;i<frames;i++){
  const sourceTime=i/44100,t=sourceTime-lead,main=Math.max(0,t),g=Math.max(0,Math.min(1,t/p.duration)),drumGain=t<0?.25*Math.min(1,sourceTime/fade):Math.max(.25-g,0)
  if(i%128===0){coeffs={a:eqAt('a',main),b:eqAt('b',main)};const progress=Math.max(0,Math.min(1,(main-controls.lastBarStart)/(p.duration-controls.lastBarStart)));hpCoeff=rbj('hp',20*90**progress)}
  for(let ch=0;ch<2;ch++){
   const filtered:Record<string,Record<string,number>>={a:{},b:{}}
   for(const [side,rows] of [['a',a],['b',b]] as const){const restore=Math.max(0,Math.min(p.duration,p.restore-p.start)),wet=side==='a'?Math.max(0,Math.min(1,t/.02)):t<restore?1:Math.max(0,(p.duration-t)/(p.duration-restore||1));for(const [stem,x] of Object.entries(rows)){let y=x[i*2+ch];for(let k=0;k<3;k++)y=routes[side][stem][k](y,coeffs[side][k],ch);filtered[side][stem]=wet*y+(1-wet)*x[i*2+ch]}}
   const x=filtered.a,y=filtered.b;let single=x.master*(1-g)+y.master*g
   if(t>=0){if(method==='bass'||method==='bass_filter')single+=(x.bass??0)*valueAt(curves.aBass,t)+(y.bass??0)*valueAt(curves.bBass,t);if(method==='yield')single+=(x.other??0)*valueAt(curves.aOther,t);if(method==='vocal')single+=(x.vocals??0)*valueAt(curves.aVocal,t)+(y.vocals??0)*valueAt(curves.bVocal,t)}
   if(method==='filter'||method==='bass_filter'){const filteredOther=hp(x.other??0,hpCoeff,ch),enable=t<0?0:(1-g)*Math.max(0,Math.min(1,(t-controls.lastBarStart)/.02));single+=(filteredOther-(x.other??0))*enable}
   const mix=single+(y.drums??0)*drumGain,output=mix*.60*.70;peak=Math.max(peak,Math.abs(output));if(t<0){prePower+=mix*mix;preReference+=single*single}else{mainPower+=mix*mix;mainReference+=single*single}
  }
 }
 const rise=(x:number,y:number)=>10*Math.log10((x+1e-12)/(y+1e-12)),preludeRiseDb=rise(prePower,preReference),mainRiseDb=rise(mainPower,mainReference),drums=drumProxy(a.drums,b.drums,frames)
 return{headroomSafe:Number.isFinite(peak)&&peak<=.5&&preludeRiseDb<=3&&mainRiseDb<=3,drumCompatible:drums.pass,peak,preludeRiseDb,mainRiseDb,densityRatio:drums.densityRatio,onsetAgreement:drums.onsetAgreement}
}
type Input=any
type Wave={bytes:Uint8Array;asset:{sha256:string;bytes:number;duration:number;url:string}}
const digest=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer))).map(x=>x.toString(16).padStart(2,'0')).join('')
export async function analyseJetsonInput(input:Input,read:(file:string)=>Float32Array){
 if(input.schema!=='harbeat.jetson-plan-input.v1'||input.sampleRate!==44100||input.channels!==2||!/^[a-f0-9]{64}$/.test(input.jobId)||!/^[a-f0-9]{64}$/.test(input.plannerSha256))throw Error('Invalid analysis request')
 const a=input.a as Track,b=input.b as Track,request=input.request??input,p=rebuildJetsonPlan(a,b,request.windowId,request.start),sr=44100
 const load=(window:any,frames:number)=>{if(!window||!window.files?.master)throw Error('Missing PCM source');const rows:Record<string,Float32Array>={};for(const stem of ['master','bass','other','vocals','drums'])if(window.files[stem]){const x=read(window.files[stem]);if(x.length!==frames*2||x.some(v=>!Number.isFinite(v)))throw Error('PCM coverage is not exact');rows[stem]=x}return rows}
 if(Math.abs(input.pcm.a.start-p.start)>.00001||Math.abs(input.pcm.b.start-p.window.start)>.00001)throw Error('PCM source start changed')
 const extra=Math.abs(p.rate-1)>1e-10?.35:0,bDuration=(p.duration+.008)*p.rate+extra
 if(Math.abs(input.pcm.a.duration-p.duration)>.00001||Math.abs(input.pcm.b.duration-bDuration)>.00001)throw Error('PCM duration changed')
 const mainA=load(input.pcm.a,Math.round(p.duration*sr)),mainB=jointStretch(load(input.pcm.b,Math.round(bDuration*sr)),sr,p.rate,Math.round((p.duration+.008)*sr))
 const buffers=(rows:Record<string,Float32Array>)=>Object.fromEntries(Object.entries(rows).map(([k,x])=>[k,pcmBuffer(x,sr)]))
 const analysis=analyseWindow(a,b,p,{a:buffers(mainA),b:buffers(mainB)}),requiredStems=new Set<string>()
 for(const [m,ss] of [['bass',['bass']],['filter',['other']],['yield',['other']],['vocal',['vocals']],['bass_filter',['bass','other']]] as [string,string[]][])if((analysis.decision.methods as any)[m].eligible)ss.forEach(s=>requiredStems.add(s))
 let result={schema:'harbeat.jetson-mix-plan.v1',id:input.jobId,status:'ready',producer:'jetson',analysisVersion:'jetson-decision-v1',algorithmSha256:input.plannerSha256,plan:{from:a.id,to:b.id,windowId:p.window.id,start:p.start,end:p.end,duration:p.duration,rate:p.rate,bStart:p.window.start,bEnd:p.window.end,beatErrorMs:mainBeatErrorMs(a,b,p)},sourceProof:input.sourceProof,...analysis,eq:p.v30Eq,restore:p.restore,requiredStems:[...requiredStems]} as unknown as JetsonDecision
 const waves:Record<string,Wave>={},prelude=input.prelude
 let group:any={id:input.jobId,title:a.title+' → '+b.title,skip:'没有完整的前置鼓段'}
 if(prelude){try{
  if(!input.pcm.body||input.pcm.body.duration!==8)throw Error('B正文缺少同源八秒接管素材')
  const single=input.auditionSingleMethod
  if(!['bass','filter','yield','vocal'].includes(single)||!analysis.decision.methods[single as Method]?.eligible)throw Error('冻结的历史单项未指定或当前接点不合格')
  const lead=prelude.leadSeconds,fade=prelude.fadeInSeconds,hold=prelude.holdSeconds,total=lead+p.duration,as=p.start-lead,bs=p.window.start-lead*p.rate
  if(![lead,fade,hold].every(Number.isFinite)||lead<=0||fade<=0||Math.abs(hold-2*fade)>.1*2*fade+.002||Math.abs(lead-fade-hold)>.002||total>24||as<0||bs<0||Math.abs(prelude.pcm.a.start-as)>.00001||Math.abs(prelude.pcm.b.start-bs)>.00001)throw Error('前置长度或源时间不足')
  const extendedA=load(prelude.pcm.a,Math.round(total*sr)),extendedB=jointStretch(load(prelude.pcm.b,Math.round(((total+.008)*p.rate+extra)*sr)),sr,p.rate,Math.round((total+.008)*sr))
  const byteCount=[...Object.values(extendedA),...Object.values(extendedB)].reduce((n,x)=>n+x.byteLength,0);if(byteCount>96*1024*1024)throw Error('延展 PCM 超过设备预算')
  const prefixA=measuredBars(a,as,p.start),prefixB=measuredBars(b,bs,p.window.start)
  if(!prefixA||!prefixB||prefixA.length!==3||prefixB.length!==3||Math.abs(prefixA[0].end-as-fade)>.065)throw Error('前置必须为完整连续的一加二小节')
  const beatErrorMs=checkPreludeBeats(a,b,as,bs,total,p.rate);if(beatErrorMs>65)throw Error('前置拍点漂移超过原65ms门槛')
  const drum=extendedB.drums;if(!drum)throw Error('B鼓轨缺失')
  const n=Math.round(lead*sr),ad=extendedA.master,bv=extendedB.vocals;let peak=0,powerA=0,powerMix=0,dot=0,dPower=0,vPower=0
  for(let i=0;i<n*2;i++){const gain=.25*Math.min(1,i/2/sr/fade),mix=ad[i]+drum[i]*gain;peak=Math.max(peak,Math.abs(mix)*.60*.70);powerA+=ad[i]*ad[i];powerMix+=mix*mix;dot+=drum[i]*(bv?.[i]??0);dPower+=drum[i]*drum[i];vPower+=(bv?.[i]??0)**2}
  const levelRiseDb=10*Math.log10((powerMix+1e-12)/(powerA+1e-12)),vocalProjection=dPower>0&&vPower>0?dot*dot/(dPower*vPower):0
  if(rms(pcmBuffer(drum.subarray(0,n*2),sr))<10**(-45/20))throw Error('前置B鼓基本静音')
  if(levelRiseDb>3||peak>.80)throw Error('前置鼓组能量或峰值余量不足')
  if(vocalProjection>.10)throw Error('前置鼓轨与人声线性投影过高，需复核残留')
  const auditionAudio=evaluatePreludeAudio(extendedA,extendedB,p,analysis.controls,single,lead,fade)
  if(!auditionAudio.headroomSafe)throw Error('主交接或前置组合的RBJ峰值/能量代理超过保守余量')
  if(!auditionAudio.drumCompatible)throw Error('鼓密度或重音一致性代理不足，需跳过复核')
  const assets:any={a:{},b:{}}
  const needed={a:new Set(['master']),b:new Set(['master','drums'])};if(single==='bass'){needed.a.add('bass');needed.b.add('bass')}if(single==='filter'||single==='yield')needed.a.add('other');if(single==='vocal'){needed.a.add('vocals');needed.b.add('vocals')}
  for(const [side,rows] of [['a',extendedA],['b',extendedB]] as const)for(const [stem,x] of Object.entries(rows)){if(!needed[side].has(stem))continue;const name=side+'-'+stem+'.wav',bytes=floatWave(x,sr),asset={sha256:await digest(bytes),bytes:bytes.length,duration:x.length/2/sr,url:'./'+input.jobId+'/'+name};waves[name]={bytes,asset};assets[side][stem]=asset}
  const preparedAssets=Object.fromEntries(['a','b'].map(side=>[side,Object.fromEntries(Object.entries(assets[side]).map(([stem,asset]:[string,any])=>[stem,{sha256:asset.sha256,bytes:asset.bytes,duration:asset.duration}]))]))
  let approval:any={schema:'harbeat.drum-prelude.v1',authority:'jetson',scope:'audition-only',approved:true,planId:input.jobId,sourceFingerprints:{a:a.provenance,b:b.provenance},leadSeconds:lead,fadeInSeconds:fade,holdSeconds:hold,maxGain:.25,sourceWindow:{aStart:as,aEnd:p.end,bStart:bs,bEnd:p.window.end,rate:p.rate},preparedAssets,basis:{headroom:'Sample-wise RBJ biquad and signed gain-curve proxy across prelude and main; 128-frame coefficient updates; not a mathematical browser peak guarantee.',drumCompatible:'125ms drum RMS activity-density and onset coincidence proxy; not perceptual compatibility.'},limits:{peak:.5,maximumRiseDb:3,maximumDensityRatio:2.5,minimumOnsetAgreement:.5,minimumOnsets:3,deviceProtectionRequired:true},checks:{sourceAligned:true,beatAligned:true,vocalSafe:true,drumCompatible:true,headroomSafe:true},evidence:{auditionAudio,beatErrorMs,levelRiseDb,preludeBusPeak:peak,vocalProjection,basis:'Whole extended source beat gate; audible B drums; prelude energy/peak and vocal linear-projection proxies. Not a perceptual success probability; main method retains prior gates.'}}
  let body:any
  if(input.pcm.body){if(Math.abs(input.pcm.body.start-p.window.end)>.00001||input.pcm.body.duration!==8)throw Error('B正文源时间不一致');const x=load(input.pcm.body,8*sr).master,bytes=floatWave(x,sr),asset={sha256:await digest(bytes),bytes:bytes.length,duration:8,url:'./'+input.jobId+'/b-body.wav'};waves['b-body.wav']={bytes,asset};body=asset;approval.takeoverAsset={sha256:asset.sha256,bytes:asset.bytes,duration:8,sourceStart:p.window.end};if(byteCount+x.byteLength>96*1024*1024)throw Error('含正文 PCM 超过设备预算')}
  approval.proofSha256=await jsonFingerprint(approval);result.drumPrelude=approval
  const device={schema:'harbeat.device-execution-plan.v1',id:input.jobId,status:'ready',policyVersion:'device-source-execution-v1',codeVersion:'jetson-decision-v1',plan:result.plan,metrics:analysis.metrics,decision:analysis.decision,assets:{},sourceProof:{a:a.provenance,b:b.provenance},stats:{rendered:false},execution:{schema:'harbeat.device-execution-plan.v1',plan:p,controls:analysis.controls,sourceFingerprints:{a:a.provenance,b:b.provenance},preservePitch:true,tempoAfterTakeover:'native',preparation:'device-shared-source-wsola-v1'}}
  group={id:input.jobId,title:a.title+' → '+b.title,result:device,approval,pcm:assets,singleMethod:single,body}
 }catch(error){group.skip=(error as Error).message;result.drumPrelude={approved:false,scope:'audition-only',reason:group.skip}}}
 result=await sealJetsonDecision(result);await verifyJetsonDecision(result,a,b,p)
 return{result,waves,group,reference:{metrics:analysis.metrics,decision:analysis.decision,controls:analysis.controls}}
}
