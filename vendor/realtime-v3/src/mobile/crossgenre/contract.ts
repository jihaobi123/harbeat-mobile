import type {Track} from '../../listen-upstream/realtime/planner'

export const POLICY='crossgenre-structural-v1'
export const ALGORITHM_SHA='2625a2ee1abfe25df02454a8e9607a7a7f10c47a90223722f20c163535dd3215'
export const DECODER_SHA='64f38cd53e96e0cb2d95aec08045460f1bccfbc6d0b3a999050aae6d6af08259'
export type Source={trackId:string;reportId:string;masterSha256:string;reportSha256:string;vocalSha256:string;runId:string;manifestSha256:string}
export type Level={rms:number;rmsDbfs:number;peak:number}
type Cue={id:string;time:number;barIndex:number;localBpm:number;section:string;semanticStatus:'unverified'}
export type Entry=Cue&{head:Level;body:Level}
export type Exit=Cue&{before:Level;echoEligible:boolean;capture:Level&{start:number;end:number};voiceEnd:number|null}
export type CrossProfile={schema:'harbeat.crossgenre-track.v1';policy:typeof POLICY;producer:'jetson';algorithmSha256:string;source:Source;duration:number;entries:Entry[];exits:Exit[];analysis:{frameSeconds:.05;semanticPhraseStatus:'unverified';[key:string]:unknown};limitations:string[]}
export type Descriptor={url:string;sha256:string;bytes:number}
export type IndexRow={trackId:string;source:Source;algorithmSha256:string;profile:Descriptor;entryCount:number;exitCount:number;echoExitCount:number}
export type CrossIndex={schema:'harbeat.crossgenre-library.v1';policy:typeof POLICY;producer:'jetson';algorithmSha256:string;tracks:IndexRow[];excluded:unknown[]}
const hash=/^[a-f0-9]{64}$/,id=/^[A-Za-z0-9_-]{1,160}$/
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)
function require(value:unknown,message='跨风格分析资料不完整'):asserts value{if(!value)throw Error(message)}
function sourceValid(s:Source){return s&&id.test(s.trackId)&&id.test(s.runId)&&['reportId','masterSha256','reportSha256','vocalSha256','manifestSha256'].every(k=>hash.test((s as any)[k]))}
export function sourceMatches(track:Track,s:Source){return sourceValid(s)&&s.trackId===track.id&&s.reportId===track.reportId&&['masterSha256','reportSha256','vocalSha256','runId'].every(k=>(s as any)[k]===track.provenance?.[k])}
function sameSource(a:Source,b:Source){return ['trackId','reportId','masterSha256','reportSha256','vocalSha256','runId','manifestSha256'].every(k=>(a as any)?.[k]===(b as any)?.[k])}
function level(v:Level){return v&&[v.rms,v.rmsDbfs,v.peak].every(finite)&&v.rms>=0&&v.peak>=v.rms-1e-7&&v.peak<=4&&v.rmsDbfs>=-181&&v.rmsDbfs<=13&&Math.abs(20*Math.log10(Math.max(1e-9,v.rms))-v.rmsDbfs)<.15}
export function validateIndex(value:any):CrossIndex{
 require(value?.schema==='harbeat.crossgenre-library.v1'&&value.policy===POLICY&&value.producer==='jetson'&&value.algorithmSha256===ALGORITHM_SHA&&Array.isArray(value.tracks)&&value.tracks.length<=5000)
 const seen=new Set<string>()
 for(const row of value.tracks as IndexRow[]){
  require(row&&id.test(row.trackId)&&!seen.has(row.trackId)&&sourceValid(row.source)&&row.source.trackId===row.trackId&&row.algorithmSha256===ALGORITHM_SHA)
  const d=row.profile;require(d&&hash.test(d.sha256)&&d.url==='/listen/crossgenre/objects/'+d.sha256+'.json'&&Number.isInteger(d.bytes)&&d.bytes>0&&d.bytes<=512*1024)
  require([row.entryCount,row.exitCount,row.echoExitCount].every(v=>Number.isInteger(v)&&v>=0&&v<=512)&&row.echoExitCount<=row.exitCount);seen.add(row.trackId)
 }
 return value
}
export function validateProfile(value:any,track:Track,published:Source):CrossProfile{
 require(value?.schema==='harbeat.crossgenre-track.v1'&&value.policy===POLICY&&value.producer==='jetson'&&value.algorithmSha256===ALGORITHM_SHA)
 require(sourceMatches(track,value.source)&&sameSource(value.source,published),'跨风格资料与当前歌曲来源不一致')
 require(finite(value.duration)&&Math.abs(value.duration-track.duration)<.05&&value.duration>=20&&value.duration<=14400)
 require(value.analysis?.frameSeconds===.05&&value.analysis.semanticPhraseStatus==='unverified'&&Array.isArray(value.limitations)&&value.limitations.length<=32)
 const decoder=value.analysis.inputDecoder
 if(decoder!==undefined)require(decoder?.policy==='crossgenre-native-decoder-v1'&&decoder.moduleSha256===DECODER_SHA&&['master','vocals'].every(k=>['libsndfile','ffmpeg'].includes(decoder[k])))
 for(const kind of ['entries','exits'] as const){
  const rows=value[kind];require(Array.isArray(rows)&&rows.length<=512);const seen=new Set<string>()
  for(const cue of rows as (Entry&Exit)[]){
   require(cue&&id.test(cue.id)&&!seen.has(cue.id)&&finite(cue.time)&&cue.time>=0&&cue.time+16<=value.duration+.002&&Number.isInteger(cue.barIndex)&&cue.barIndex>=0&&finite(cue.localBpm)&&cue.localBpm>=40&&cue.localBpm<=300&&typeof cue.section==='string'&&cue.section.length<=160&&cue.semanticStatus==='unverified')
   seen.add(cue.id)
   if(kind==='entries')require(level(cue.head)&&level(cue.body))
   else{
    const c=cue.capture;require(level(cue.before)&&typeof cue.echoEligible==='boolean'&&c&&level(c)&&finite(c.start)&&finite(c.end)&&c.start>=0&&c.end>c.start&&c.end<=cue.time-.15&&c.end-c.start<=.801&&(cue.voiceEnd===null||finite(cue.voiceEnd)&&cue.voiceEnd<=cue.time-.19&&cue.voiceEnd>=0))
    if(cue.echoEligible)require(cue.voiceEnd!==null&&cue.time-cue.voiceEnd<=1.251&&c.rms>0&&c.peak<=1.25)
   }
  }
 }
 return value
}
