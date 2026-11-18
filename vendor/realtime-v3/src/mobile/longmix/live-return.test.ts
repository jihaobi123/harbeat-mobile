import {it,expect} from 'vitest'
import {validateLiveScene,validateLiveIndex,approvedExits,continuationPosition} from './live-contract'
import {returnFixture} from './return-fixture'
import {liveFixture} from './live-fixture'
it('requires separate return measurements and binds A slip positions, not the B coordinate',()=>{
 const v=returnFixture();expect(validateLiveScene(v)).toBe(v)
 expect(approvedExits(v).map(e=>e.at)).toEqual([20,30]);expect(continuationPosition(v,v.scene.exits[0])).toBe(60)
 const relabeled:any=liveFixture();relabeled.schema=v.schema;expect(()=>validateLiveScene(relabeled)).toThrow()
 const noVerifier=returnFixture();delete noVerifier.evidence.returnToA.verifierSha256;expect(()=>validateLiveScene(noVerifier)).toThrow()
 for(const mutate of [(x:any)=>x.evidence.returnToA.exits[0].aPosition+=1,(x:any)=>x.evidence.returnToA.exits[0].aQuiet.intervalsClear=false,(x:any)=>x.evidence.returnToA.exits[0].bQuiet.maximumFrameDb=-40,(x:any)=>x.evidence.returnToA.exits[0].nativeBodySeconds=15,(x:any)=>x.evidence.returnToA.exits[0].compatibility.drumOnsetAgreement=.1,(x:any)=>x.evidence.returnToA.exits[0].compatibility.drumOverlapSeconds=3,(x:any)=>x.evidence.returnToA.exits[0].layers[0].points[0][1]=.5]){
  const x=returnFixture();mutate(x);if(x.evidence.returnToA.exits[0].compatibility.drumOnsetAgreement===.1)x.evidence.returnToA.exits[0].compatibility.drumOverlapSeconds=3
  if(x.evidence.returnToA.exits[0].compatibility.drumOverlapSeconds===3)x.evidence.returnToA.exits[0].compatibility.drumOnsetAgreement=.1
  expect(()=>validateLiveScene(x)).toThrow()
 }
})
it('return routes and index cannot cross into the B takeover catalog',()=>{
 const v=returnFixture(),sha='c'.repeat(64),row={id:v.id,sha256:sha,url:'/listen/longmix-return/v1/'+sha+'.json',sceneSha256:v.sceneSha256,from:v.scene.sources.a.trackId,to:v.scene.sources.b.trackId,sourcePosition:v.entry.sourcePosition}
 expect(validateLiveIndex({schema:'harbeat.live-layering-return-index.v1',scenes:[row]},'return-a')).toEqual([row])
 expect(()=>validateLiveIndex({schema:'harbeat.live-layering-index.v1',scenes:[row]})).toThrow()
})
