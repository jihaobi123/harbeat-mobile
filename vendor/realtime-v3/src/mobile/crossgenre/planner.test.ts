import {describe,it,expect} from 'vitest'
import {planCrossGenre,enumerateCrossGenre} from './planner'
import {validateProfile,validateIndex,ALGORITHM_SHA,DECODER_SHA} from './contract'
import {fixture} from './fixtures'
it('enumerates cut and echo independently for the same eligible musical geometry',()=>{
 const a=fixture(),b=fixture('b',129.7);a.profile.exits[0].echoEligible=true
 expect(new Set(enumerateCrossGenre(a.track,b.track,a.profile,b.profile,20,18).map(p=>p.family))).toEqual(new Set(['structural-cut','echo-out']))
})

describe('native-tempo crossgenre planning',()=>{
 it('plans 95→129.7 without a beatmatched variant and keeps B native',()=>{
  const a=fixture(),b=fixture('b',129.7)
  const plan=planCrossGenre(a.track,b.track,a.profile,b.profile,20,18)!
  expect(plan).toMatchObject({schema:'harbeat.crossgenre-plan.v1',family:'structural-cut',from:'a',to:'b',exit:32,entry:16,rate:1})
  expect(plan.id).toContain('out-16');expect(plan.echo).toBeNull()
 })
 it('rejects missed cues, mismatched source identity and excessive level jumps',()=>{
  const a=fixture(),b=fixture('b',129.7)
  expect(planCrossGenre(a.track,b.track,a.profile,b.profile,31,18)).toBeNull()
  b.profile.source.masterSha256='0'.repeat(64)
  expect(()=>planCrossGenre(a.track,b.track,a.profile,b.profile,20,18)).toThrow(/来源/)
  b.profile.source.masterSha256='a'.repeat(64);b.profile.entries[0].body.rmsDbfs=-5
  expect(planCrossGenre(a.track,b.track,a.profile,b.profile,20,18)).toBeNull()
 })
 it('uses bounded outgoing echo only where Jetson permits its capture',()=>{
  const a=fixture(),b=fixture('b',129.7);a.profile.exits[0].echoEligible=true
  const p=planCrossGenre(a.track,b.track,a.profile,b.profile,20,18)!
  expect(p.family).toBe('echo-out');expect(p.echo!.feedback).toBeLessThan(.3)
  expect(p.echo!.tailSeconds).toBeLessThanOrEqual(60/129.7)
  expect(p.peakBound).toBeLessThan(.98)
 })
 it('does not assert semantic phrase or perceptual quality confidence',()=>{
  const a=fixture(),b=fixture('b',129.7),p=planCrossGenre(a.track,b.track,a.profile,b.profile,20,18)!
  expect(p.evidence.semanticPhraseStatus).toBe('unverified')
  expect(p.evidence).not.toHaveProperty('successProbability')
 })
})

describe('published sidecar authority',()=>{
 it('checks compiled algorithm and exact report/master/run binding',()=>{
  const {track,profile}=fixture();expect(validateProfile(profile,track,profile.source)).toBe(profile)
  expect(()=>validateProfile({...profile,algorithmSha256:'0'.repeat(64)},track,profile.source)).toThrow()
  expect(()=>validateProfile(profile,{...track,provenance:{...track.provenance,runId:'stale'}},profile.source)).toThrow()
 })
 it('rejects malformed echo flags, nonfinite cues and impossible capture geometry',()=>{
  const {track,profile}=fixture(),copy=()=>structuredClone(profile)
  const p=copy();p.exits[0].time=NaN;expect(()=>validateProfile(p,track,profile.source)).toThrow()
  const q=copy();q.exits[0].capture.end=33;expect(()=>validateProfile(q,track,profile.source)).toThrow()
  const r=copy();r.exits[0].echoEligible='true' as any;expect(()=>validateProfile(r,track,profile.source)).toThrow()
 })
 it('only accepts immutable same-service descriptors with bounded byte sizes',()=>{
  const {profile}=fixture(),row={trackId:'a',source:profile.source,algorithmSha256:ALGORITHM_SHA,entryCount:1,exitCount:1,echoExitCount:0,profile:{sha256:'f'.repeat(64),bytes:1500,url:'/listen/crossgenre/objects/'+'f'.repeat(64)+'.json'}}
  const index={schema:'harbeat.crossgenre-library.v1',policy:'crossgenre-structural-v1',producer:'jetson',algorithmSha256:ALGORITHM_SHA,tracks:[row],excluded:[]}
  expect(validateIndex(index).tracks).toHaveLength(1)
  expect(()=>validateIndex({...index,tracks:[{...row,profile:{...row.profile,url:'https://elsewhere.test/a'}}]})).toThrow()
  expect(()=>validateIndex({...index,tracks:[row,row]})).toThrow()
 })
})

it('automatic crossgenre retains at least half A and prefers the later structural region',()=>{
 const a=fixture(),b=fixture('b',129.7)
 expect(planCrossGenre(a.track,b.track,a.profile,b.profile,0,119,3,{automatic:true})).toBeNull()
 a.profile.exits.push({...a.profile.exits[0],id:'out-late',time:96,voiceEnd:95.7,capture:{...a.profile.exits[0].capture,start:95,end:95.7}})
 expect(planCrossGenre(a.track,b.track,a.profile,b.profile,0,119,3,{automatic:true})?.exit).toBe(96)
 expect(planCrossGenre(a.track,b.track,a.profile,b.profile,20,18)?.exit).toBe(32)
})

it('requires the pinned strict decoder evidence when a sidecar used PCM fallback',()=>{
 const {track,profile}=fixture();profile.analysis.inputDecoder={policy:'crossgenre-native-decoder-v1',moduleSha256:'0'.repeat(64),master:'ffmpeg',vocals:'libsndfile'}
 expect(()=>validateProfile(profile,track,profile.source)).toThrow()
 ;(profile.analysis.inputDecoder as any).moduleSha256=DECODER_SHA;expect(validateProfile(profile,track,profile.source)).toBe(profile)
})

import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
it('pins the acoustic and fallback decoder modules used by Jetson',()=>{
 for(const [name,sha] of [['preprocess.py',ALGORITHM_SHA],['decode.py',DECODER_SHA]])expect(createHash('sha256').update(readFileSync(new URL('../../../../../tools/crossgenre/'+name,import.meta.url))).digest('hex')).toBe(sha)
})
