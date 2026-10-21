import {it,expect} from 'vitest'
import {qualityTrack} from '../metric-upstream/continuous/qualityFixture'
import {ActivitySession} from './activity-session'
import {planActivitySet} from './activity-plan'

const hash=(x:string)=>x.repeat(64)
function fixture(){
 const tracks=['a','b','c','d'].map((id,i)=>{
  const t=qualityTrack(id),master=hash(String(i+1)),vocal=hash('e'),report=hash('f')
  t.provenance={runId:'run'+id,masterSha256:master,reportSha256:report,vocalSha256:vocal}
  t.native={url:'/listen/media/'+master+'.flac',sha256:master,bytes:1000,duration:80}
  Object.assign(t.alignment!.source,{masterSha256:master,reportSha256:report,vocalSha256:vocal})
  Object.assign(t.preprocessing!,{masterSha256:master,reportSha256:report})
  ;(t.preprocessing!.vocalActivity.source as Record<string,unknown>).vocal_sha256=vocal
  return {...t,styleLabels:['Hip-Hop']}
 })
 for(const t of tracks)for(const w of t.windows)w.variants=Object.fromEntries(tracks.map(a=>[a.id,{...w.variants.a,sha256:hash('d')}]))
 const planned=planActivitySet({tracks,styles:['Hip-Hop'],energy:3,maxTracks:4})
 const sources=tracks.map(t=>({schema:'harbeat.execution-track.v1',trackId:t.id,runId:'run'+t.id,manifestSha256:hash('c'),sourceSha256:t.provenance!.masterSha256,reportSha256:t.provenance!.reportSha256,sampleRate:44100,channels:2,duration:80,frames:80*44100,sourceTimeOrigin:'master_audio_start',profile:{sha256:hash('a'),url:'/listen/execution/profiles/'+hash('a')+'.json',bytes:100},stems:{vocals:{sourceSha256:hash('e'),segments:Array.from({length:5},(_,i)=>({start:i*16,end:(i+1)*16,startFrame:i*16*44100,endFrame:(i+1)*16*44100,asset:{url:'/listen/execution-media/'+hash('b')+'.flac',sha256:hash('b'),bytes:1000,duration:16,sampleRate:44100,channels:2,frames:16*44100}}))}}}))
 const value={schema:'harbeat.activity-set.v1',packId:'a'.repeat(32),state:'ready',trackIds:planned.trackIds,initialTrackId:planned.initialTrackId,sourceFingerprints:tracks,results:[],execution:{schema:'harbeat.activity-execution.v2',tracks:sources,edges:planned.edges,coverage:planned.coverage,energy:3}}
 return {tracks,value}
}
it('opens v2 multi-cue packs and returns only still qualified source-bound future plans',async()=>{
 const {tracks,value}=fixture(),s=await ActivitySession.open(value,'多接点',async id=>tracks.find(t=>t.id===id)!)
 expect(s.candidateCount).toBe(value.execution.edges.length)
 const candidates=s.candidates(tracks[0],0,3)
 expect(new Set(candidates.map(c=>c.plan.start)).size).toBeGreaterThan(2)
 expect(candidates.every(c=>c.plan.v30Eq&&c.plan.start>=.5)).toBe(true)
 expect(s.candidates(tracks[0],70,3).every(c=>c.plan.start>=70.5)).toBe(true)
 const changed=structuredClone(tracks[0]);changed.provenance!.runId='new-run'
 expect(s.candidates(changed,0,3)).toEqual([])
})
it('rejects forged geometry, source identities, and newly unsafe vocals before warming',async()=>{
 for(const mutate of [(m:any)=>m.execution.edges[0].rate=1.04,(m:any)=>m.execution.edges[0].source.a.runId='old-run']){
  const {tracks,value}=fixture();mutate(value)
  await expect(ActivitySession.open(value,'损坏候选',async id=>tracks.find(t=>t.id===id)!)).rejects.toThrow()
 }
 const {tracks,value}=fixture();for(const t of tracks){t.vocals=[[0,80]];t.preprocessing!.vocalActivity.intervals=[{start_ms:0,end_ms:80000}]}
 await expect(ActivitySession.open(value,'人声冲突',async id=>tracks.find(t=>t.id===id)!)).rejects.toThrow()
})
