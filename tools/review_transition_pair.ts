import fs from 'node:fs'
import {pcmBuffer, type PCM, type WindowPCM} from '../vendor/realtime-v3/src/mobile/decision-core'
import {calibrateStemSources} from '../vendor/realtime-v3/src/mobile/stem-calibration'
import {measureStemCompatibility} from '../vendor/realtime-v3/src/mobile/stem-compatibility'
import {measureReconstruction, measureTimelineAudio} from '../vendor/realtime-v3/src/mobile/timeline-audio-evidence'
import {jointStretch} from '../vendor/realtime-v3/src/mobile/joint-stretch'
import {evaluateStemConflicts} from '../vendor/realtime-v3/src/mobile/stem-arrangement'
import {STEM_ROLES, validateStemTimeline, validateTimelineVoices, type StemTimeline} from '../vendor/realtime-v3/src/mobile/stem-timeline'
import {chromaDifference, sourceChroma} from '../vendor/realtime-v3/src/mobile/source-features'
import {canonicalCase, sha256} from '../vendor/realtime-v3/src/mobile/dj-reference/contract'
import {LYRIC_PAIR_SCHEMA, validateLyricPair, type LyricPair} from '../vendor/realtime-v3/src/mobile/dj-reference/lyric-pair'

const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const audio = Object.fromEntries(['a','b'].map(side => {
  const raw = Object.fromEntries(Object.entries(input.files[side]).map(([role, file]) => {
    const raw = fs.readFileSync(file as string)
    return [role, new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset + raw.byteLength))]
  }))
  const aligned = side === 'b' && input.rate && input.rate !== 1
    ? jointStretch(raw, 44100, input.rate, Math.round(input.duration * 44100)) : raw
  if (input.alignedB && side === 'b') for (const [role, samples] of Object.entries(aligned)) {
    fs.writeFileSync(input.alignedB[role], Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength))
  }
  return [side, Object.fromEntries(Object.entries(aligned).map(([role, samples]) => [role, pcmBuffer(samples,44100)]))]
})) as WindowPCM
const result = calibrateStemSources(audio,input.duration)
if (!result) throw Error('Stem calibration failed')
const reconstruction = measureReconstruction(result.audio,input.duration)
function checkOriginalGates(timeline: StemTimeline) {
  const {a,b,cue} = input.sources
  const duration = timeline.duration
  const plan = { start:cue.aStart, end:cue.aExit, restore:cue.aExit, rate:cue.rate,
    window:{start:cue.bStart,end:cue.bStart+duration*cue.rate} }
  try {
    validateStemTimeline(timeline,duration)
    validateTimelineVoices(timeline,a,b,plan as any)
  } catch (error) {
    return {pass:false, reason:(error as Error).message}
  }
  const baseline = {...timeline,
    a:Object.fromEntries(STEM_ROLES.map(role => [role,[[0,1],[duration,0]]])),
    b:Object.fromEntries(STEM_ROLES.map(role => [role,[[0,0],[duration,1]]])) } as StemTimeline
  const raw = evaluateStemConflicts(result!.audio,baseline)
  const processed = evaluateStemConflicts(result!.audio,timeline)
  const mono = (source: PCM) => source.getChannelData(0).map((x,i) => (x+source.getChannelData(1)[i])*.5)
  const improvement = 2*(raw.vocals-processed.vocals) + (['bass','other'] as const).reduce((sum,role) => {
    const delta = chromaDifference(sourceChroma(mono(audio.a[role]),44100),sourceChroma(mono(audio.b[role]),44100))??1
    return sum+(raw[role]-processed[role])*delta
  },0)
  const headroom = measureTimelineAudio(result!.audio,timeline,plan as any)
  const sourceReconstruction = Object.values(reconstruction).every(r => [r,r.boundary].every(x =>
    x.errorRatio<=.25&&Math.abs(x.levelDeltaDb)<=1.5))
  return {pass:sourceReconstruction&&headroom.peak<=.95&&headroom.riseDb<=3&&processed.vocals<=.01&&improvement>=.08,
    sourceReconstruction,headroom,improvement,processed}
}
const variants = input.timelines.map(({name,bVoiceEntry,...gains}:any) => {
  const timeline: StemTimeline = {...gains, schema:'harbeat.stem-timeline.v1', clock:'transition-start'}
  return {name,evidence:measureStemCompatibility(result.audio,timeline,input.bpm),
    ...(input.sources?{originalGates:checkOriginalGates(timeline)}:{}),timeline,bVoiceEntry}
})

async function finish() {
  const approvals:LyricPair[]=[]
  if(input.bindings)for(const variant of variants){
    const {evidence,originalGates:gates,timeline}=variant
    if(!evidence.pass||evidence.pitchedRisk>.35||!gates?.pass||!gates.headroom||!gates.processed)continue
    let floor=Infinity, power=0, count=0
    for(let i=0;i<Math.round(input.duration*44100);i++){
      for(let c=0;c<2;c++){
        let sample=0
        for(const side of ['a','b'] as const)for(const role of STEM_ROLES){
          const points=timeline[side][role], next=points.findIndex(([t])=>t>i/44100), a=points[next-1], b=points[next]
          const gain=next<0?points.at(-1)![1]:a[1]+(b[1]-a[1])*(i/44100-a[0])/(b[0]-a[0])
          sample+=result!.audio[side][role].getChannelData(c)[i]*gain
        }
        power+=(sample*.76)**2;count++
      }
      if((i+1)%2205===0){floor=Math.min(floor,10*Math.log10(Math.max(1e-12,power/count)));power=0;count=0}
    }
    const cue=input.sources.cue
    const row:LyricPair={schema:LYRIC_PAIR_SCHEMA,id:'0'.repeat(64),producer:'jetson',approved:true,
      technique:cue.method,duration:input.duration,rate:cue.rate,outputGain:.76,sources:input.bindings,
      aRelease:cue.aRelease-cue.aStart,bVoiceEntry:variant.bVoiceEntry??input.duration,sourceGains:result!.gains,timeline,
      evidence:{beatErrorMs:cue.maxBeatErrorMs,pitchedRisk:evidence.pitchedRisk,compatible:true,
        peak:gates.headroom.peak,riseDb:gates.headroom.riseDb,minimumLevelDbfs:floor,
        reconstruction,vocalConflict:gates.processed.vocals,improvement:gates.improvement!}}
    try{validateLyricPair(row)}catch{continue}
    row.id=await sha256(new TextEncoder().encode(canonicalCase(row)).buffer)
    approvals.push(row)
  }
  console.log(JSON.stringify({reconstruction,gains:result!.gains,variants,approvals}))
}
void finish().catch(error=>{console.error(error);process.exitCode=1})
