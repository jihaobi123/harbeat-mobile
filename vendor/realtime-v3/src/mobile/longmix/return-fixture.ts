import {liveFixture} from './live-fixture'
import {valueAt} from '../device-execution'
/** Deliberately independent fixture: never produced by the validator under test. */
export function returnFixture():any{
 const v:any=liveFixture();v.schema='harbeat.live-layering-return.v1';v.evidence.runtime='live-layering-return-linear-8ms-v1'
 v.evidence.returnToA={timeline:'slip',verifierSha256:'e'.repeat(64),exits:v.scene.exits.slice(0,2).map((e:any)=>({
  at:e.at,aPosition:v.entry.sourcePosition+e.at,peak:.8,scenePeak:.8,handoffPeak:.7,nativeBodyPeak:.8,nativeBodySeconds:16,
  aQuiet:{start:v.entry.sourcePosition+e.at-.15,end:v.entry.sourcePosition+e.at+.3,intervalsClear:true,coverageVerified:true,maximumFrameDb:-60},
  bQuiet:{start:v.scene.clips.bStart+e.fadeStart-.1,end:e.bPosition+.1,intervalsClear:true,coverageVerified:true,maximumFrameDb:-60},
  compatibility:{pitchedRisk:.1,incompatiblePitchedSeconds:0,drumOverlapSeconds:.2,drumOverlapLimit:.3325,drumDensityRatio:1,drumOnsetAgreement:.8,drumEvidence:'observed',pass:true},
  layers:v.scene.layers.map((l:any)=>({...l,points:[[0,l.points[0][1]],[e.fadeStart,valueAt(l.points,e.fadeStart)],[e.at,Number(l.side==='a')]]}))
 }))};return v
}
