import {liveFixture} from './live-fixture'
import {valueAt} from '../device-execution'
import {canonicalJson} from '../jetson-contract'
const H='a'.repeat(64)
/** Independent structural fixture with placeholder hashes. Cryptographic tests
 * seal fresh synthetic evidence below; no research approval is promoted. */
export function roleFixture(mode:'roles-c'|'roles-cd'='roles-c'):any{
 const base=liveFixture(),duration=base.scene.duration,beat=60/base.scene.bpm,left=5,right=15,cross=[[0,0],[left,0],[left+beat,1],[right-beat,1],[right,0],[duration,0]] as [number,number][]
 const original=base.scene.layers.find(l=>l.side==='b'&&l.role==='other')!.points
 const bOther=[...new Set([...original,...cross].map(p=>p[0]))].sort((a,b)=>a-b).map(t=>[t,valueAt(original,t)*(1-valueAt(cross,t))])
 const sources:any={c:{...base.scene.sources.a,trackId:'track-'+'c'.repeat(20)}},layers:any[]=[{source:'c',role:'other',sourceBpm:96,outputStart:left,sourceStartFrame:441000,lengthFrames:441000,rate:1,loop:false,gain:.5,points:cross}]
 const v:any={schema:'harbeat.role-replacement.v1',scope:'normal-playback-lab',producer:'jetson',approved:true,id:H,implementationSha256:H,mode,base,sources,window:[left,right],layers,bOther,evidence:{sourceVerified:true,pairwisePass:true,aggregatePass:true,measurementsSha256:H,arrangementSha256:H,peak:.9,lowEnergyRatio:1.02,checks:{reconstruction:.1,vocalClear:true,vocalMaxDb:-60,beatErrorMs:25,loopSeamDb:-30,melodyClash:.2,onsetGrowth:1.1,originalVocalPreserved:true,vocalBoundariesClear:true,simultaneousFourRoleSeconds:mode==='roles-cd'?2:0},pairwise:{'A/B':{pass_:true,pitchedRisk:.2,incompatiblePitchedSeconds:0},'A/C':{pass_:true,pitchedRisk:.2,incompatiblePitchedSeconds:0},'B/C':{pass_:true,pitchedRisk:.2,incompatiblePitchedSeconds:0}},exitPeaks:base.scene.exits.map(e=>({at:e.at,peak:.9}))}}
 if(mode==='roles-cd'){
  sources.d={...base.scene.sources.a,trackId:'track-'+'d'.repeat(20)}
  const start=6.25,end=10.25
  layers.push({source:'d',role:'vocals',sourceBpm:96,outputStart:start,sourceStartFrame:882000,lengthFrames:176400,rate:1,loop:false,gain:.5,points:[[0,0],[start,0],[start+.08,1],[end-.15,1],[end,0],[duration,0]],vocalBoundary:{entryClear:true,tailComplete:true,headMaxDb:-60,tailMaxDb:-60}})
  v.bVocals=[[0,1],[start-.08,1],[start,0],[end,0],[end+.08,1],[duration,1]]
  for(const pair of ['A/D','B/D','C/D'])v.evidence.pairwise[pair]={pass_:true,pitchedRisk:.2,incompatiblePitchedSeconds:0}
 }
 return v
}
/** Test-only sealing, composed independently of roleMeasurements/roleIdentity. */
export async function sealRoleFixture(v:any){
 const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJson(value))))).map(x=>x.toString(16).padStart(2,'0')).join('')
 v.base.sceneSha256=await hash(v.base.scene)
 v.evidence.arrangementSha256=await hash({mode:v.mode,base:v.base,sources:v.sources,window:v.window,layers:v.layers,bOther:v.bOther,...(v.bVocals?{bVocals:v.bVocals}:{})})
 const {measurementsSha256,...measurements}=v.evidence
 v.evidence.measurementsSha256=await hash(measurements)
 return v
}
