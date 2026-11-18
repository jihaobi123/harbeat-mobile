import {it,expect} from 'vitest'
import {fixture} from './fixture'
import {liveFixture,liveTracks} from './live-fixture'
import {validateLiveScene,verifyLiveTracks,validateLiveIndex} from './live-contract'
it('requires a distinct live Jetson approval rather than an audition scene',()=>{
 expect(()=>validateLiveScene(fixture())).toThrow();expect(validateLiveScene(liveFixture()).scene.sources.a.trackId).toBe(fixture().sources.a.trackId)
})
it('binds the real current source metadata and complete future scene coverage',()=>{
 const live=liveFixture(),tracks=liveTracks(live);expect(()=>verifyLiveTracks(live,tracks.a,tracks.b)).not.toThrow()
 for(const key of ['masterSha256','reportSha256','vocalSha256','runId']){const wrong=structuredClone(tracks.a);wrong.provenance![key]='changed';expect(()=>verifyLiveTracks(live,wrong,tracks.b)).toThrow()}
 tracks.a.duration=live.entry.sourcePosition+live.scene.duration;expect(()=>verifyLiveTracks(live,tracks.a,tracks.b)).toThrow()
})
it('rejects missing or altered live entry/exit evidence and unverified source claims',()=>{
 const mutate=[(x:any)=>delete x.evidence,(x:any)=>x.entry.sourcePosition+=1,(x:any)=>x.nativeGain=.9,(x:any)=>x.scene.rate=1.01,(x:any)=>x.evidence.sourceVerified=false,(x:any)=>x.evidence.entryPeak=1.01,(x:any)=>x.evidence.exitPeaks.pop(),(x:any)=>x.evidence.exitPeaks[0].bPosition+=1]
 for(const change of mutate){const x=liveFixture();change(x);expect(()=>validateLiveScene(x)).toThrow()}
})
it('validates bounded immutable index routes and exact row source anchors',()=>{
 const x=liveFixture(),sha='c'.repeat(64),row={id:x.id,sha256:sha,url:'/listen/longmix-live/v1/'+sha+'.json',sceneSha256:x.sceneSha256,from:x.scene.sources.a.trackId,to:x.scene.sources.b.trackId,sourcePosition:x.entry.sourcePosition}
 expect(validateLiveIndex({schema:'harbeat.live-layering-index.v1',scenes:[row]})).toEqual([row])
 for(const change of [(r:any)=>r.url='https://other.example/live.json',(r:any)=>r.sourcePosition=NaN,(r:any)=>r.to=r.from]){const r={...row};change(r);expect(()=>validateLiveIndex({schema:'harbeat.live-layering-index.v1',scenes:[r]})).toThrow()}
 expect(()=>validateLiveIndex({schema:'harbeat.live-layering-index.v1',scenes:[row,row]})).toThrow()
})
