import type {Point} from '../device-execution'
import {valueAt} from '../device-execution'
export type Role='drums'|'bass'|'other'|'vocals'
export type Proof={trackId:string;runId:string;masterSha256:string;reportSha256:string;vocalSha256:string;manifestSha256:string;profileSha256:string;stemSha256:Record<Role,string>}
export type Layer={side:'a'|'b';role:Role;loop:boolean;points:Point[]}
export type Exit={at:number;fadeStart:number;bPosition:number;peak:number}
export type Scene={schema:'harbeat.two-source-scene.v1';scope:'audition-only';producer:'jetson';approved:true;id:string;implementationSha256:string;title:string;fromTitle:string;toTitle:string;sampleRate:44100;bpm:number;rate:number;duration:number;lead:number;tail:number;outputGain:number;sourceGains:{a:number;b:number};sources:{a:Proof;b:Proof};clips:{aStart:number;aEnd:number;bStart:number;bEnd:number};layers:Layer[];exits:Exit[];evidence:{aVocalSilent:true;bEntryComplete:true;reconstruction:{a:number;b:number};pitchedRisk:number;peak:number;loopSeamDb:number;beatErrorMs:number;runtime:'master-guided-wsola-v1';limitations:string[];[key:string]:unknown}}
const hash=(s:any)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s),finite=(...xs:any[])=>xs.every(Number.isFinite),near=(a:number,b:number)=>Math.abs(a-b)<.002
export const sceneOutputFrames=(p:Pick<Scene,'duration'|'sampleRate'>)=>Math.ceil((p.duration+.008)*p.sampleRate)
export type ScenePreparation='reference'|'long'|'live'
export function sceneBytes(p:Scene,variant:ScenePreparation){
 const a=p.clips.aEnd-p.clips.aStart,b=sceneOutputFrames(p)/p.sampleRate
 if(p.rate===1){
  const frames=(s:number)=>Math.round(s*p.sampleRate)
  if(variant==='live')return 8*(sceneOutputFrames(p)*4+frames(a)*3)
  // Account each independently allocated slice on its actual integer grid.
  return 8*(frames(p.lead+p.clips.aEnd-p.clips.aStart+.008)+frames(p.clips.bEnd-p.clips.bStart+p.tail+.35)+sceneOutputFrames(p)*(variant==='long'?4:1)+(variant==='long'?frames(a)*3:0))
 }
 // Exact-size same-speed slices transfer ownership: four B stems, no copying
 // workspace. Other rates retain the previous conservative guide/copy bound.
 return Math.ceil(44100*8*(p.lead+a+(b*p.rate+.35+p.tail)+b*(variant==='long'?5:1)+(variant==='long'?a*3:0)))
}
export function validateScene(v:any,variant:'long'|'live'='long'):Scene{
 const fail=()=>{throw Error('长混试验方案未通过来源、声部或退出点校验')}
 if(!v||v.schema!=='harbeat.two-source-scene.v1'||v.scope!=='audition-only'||v.producer!=='jetson'||v.approved!==true||!hash(v.id)||!hash(v.implementationSha256)||v.sampleRate!==44100||!finite(v.duration,v.bpm,v.rate,v.lead,v.tail,v.outputGain)||v.duration<=32||v.duration>64||v.bpm<60||v.bpm>120||v.rate<.95||v.rate>1.05||v.lead!==8||v.tail!==16||v.outputGain<.3||v.outputGain>.6||!near(v.duration,64*60/v.bpm))fail()
 if(!['title','fromTitle','toTitle'].every(k=>typeof v[k]==='string'&&v[k].length>0&&v[k].length<=300)||!v.sources||Object.keys(v.sources).sort().join()!=='a,b'||!v.sourceGains)fail()
 for(const side of ['a','b']){const q=v.sources[side];if(!q||!/^track-[a-f0-9]{20}$/.test(q.trackId)||typeof q.runId!=='string'||!q.runId.length||q.runId.length>200||!['masterSha256','reportSha256','vocalSha256','manifestSha256','profileSha256'].every(k=>hash(q[k]))||!q.stemSha256||!['drums','bass','other','vocals'].every(k=>hash(q.stemSha256[k]))||q.stemSha256.vocals!==q.vocalSha256||!finite(v.sourceGains[side])||v.sourceGains[side]<.5||v.sourceGains[side]>2)fail()}
 if(v.sources.a.trackId===v.sources.b.trackId)fail()
 const c=v.clips;if(!c||!finite(c.aStart,c.aEnd,c.bStart,c.bEnd)||c.aStart<v.lead||c.bStart<0||!near(c.aEnd-c.aStart,v.duration/8)||!near(c.bEnd-c.bStart,v.duration*v.rate))fail()
 if(!Array.isArray(v.layers)||v.layers.length!==7)fail();const seen=new Set<string>()
 for(const l of v.layers){if(!l||!['a','b'].includes(l.side)||!['drums','bass','other','vocals'].includes(l.role)||l.side==='a'&&l.role==='vocals'||l.loop!==(l.side==='a')||seen.has(l.side+':'+l.role)||!Array.isArray(l.points)||l.points.length<2||l.points.length>32)fail();seen.add(l.side+':'+l.role)
  for(let i=0;i<l.points.length;i++){const p=l.points[i],q=l.points[i-1];if(!Array.isArray(p)||p.length!==2||!finite(...p)||p[0]<0||p[0]>v.duration||p[1]<0||p[1]>1||q&&(p[0]<=q[0]||Math.abs(p[1]-q[1])/(p[0]-q[0])>20.0001))fail()}
  if(l.points[0][0]!==0||!near(l.points.at(-1)[0],v.duration)||l.points.at(-1)[1]!==Number(l.side==='b')||l.side==='b'&&l.role==='vocals'&&l.points.some((p:Point)=>p[1]!==1))fail()
 }
 for(const role of ['drums','bass','other']){const a=v.layers.find((l:Layer)=>l.side==='a'&&l.role===role),b=v.layers.find((l:Layer)=>l.side==='b'&&l.role===role);if(!a||!b)fail();for(const t of new Set<number>([...a.points,...b.points].map((p:Point)=>p[0])))if(valueAt(a.points,t)+valueAt(b.points,t)>1.00001)fail()}
 if(!Array.isArray(v.exits)||v.exits.length<1||v.exits.length>4)fail()
 for(let i=0;i<v.exits.length;i++){const x=v.exits[i],last=v.exits[i-1];if(!x||!finite(x.at,x.fadeStart,x.bPosition,x.peak)||x.at<v.duration/4||x.at>v.duration||!near(x.fadeStart,x.at-240/v.bpm)||last&&x.at<=last.at||!near(x.bPosition,c.bStart+x.at*v.rate)||x.peak<0||x.peak>.95)fail()}
 if(!near(v.exits.at(-1).at,v.duration))fail()
 const e=v.evidence;if(!e||e.aVocalSilent!==true||e.bEntryComplete!==true||e.runtime!=='master-guided-wsola-v1'||!e.reconstruction||!finite(e.reconstruction.a,e.reconstruction.b,e.pitchedRisk,e.peak,e.loopSeamDb,e.beatErrorMs)||['a','b'].some(k=>e.reconstruction[k]<0||e.reconstruction[k]>.25)||e.pitchedRisk<0||e.pitchedRisk>.35||e.peak<0||e.peak>.95||e.beatErrorMs<0||e.beatErrorMs>50||e.loopSeamDb> -20||!Array.isArray(e.limitations)||e.limitations.some((s:any)=>typeof s!=='string'||s.length>2000))fail()
 if(sceneBytes(v,variant)>96*1024*1024)throw Error('长混场景超过 96 MiB 准备预算')
 return v
}
export function chooseExit(scene:Scene,position:number):Exit|null{if(!Number.isFinite(position))return null;return scene.exits.find(e=>e.fadeStart>position+.2)??null}
