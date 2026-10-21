import {it,expect} from 'vitest'
import {qualityTrack} from '../metric-upstream/continuous/qualityFixture'
import {nearbyPlan} from './nearby'
import {sealJetsonDecision,verifyJetsonDecision,type JetsonDecision} from './jetson-contract'
const h=(x:string)=>x.repeat(64)
export async function approvedFixture(){
 const a=qualityTrack('a'),b=qualityTrack('b'),p=nearbyPlan(a,b,10)!
 for(const t of [a,b])t.provenance={runId:'run'+t.id,masterSha256:h('a'),reportSha256:h('b'),vocalSha256:h('c')}
 const binding=(t:typeof a)=>({trackId:t.id,...t.provenance!,manifestSha256:h('d'),profileSha256:h('e'),stemSha256:{drums:h('f'),bass:h('f'),other:h('f'),vocals:h('c')}})
 const methods=Object.fromEntries(['original','bass','filter','yield','vocal','bass_filter'].map(m=>[m,{name:m,eligible:m==='original',score:m==='original'?50:null,reason:'reference',processingCost:0,levelPenalty:0}]))
 const raw={schema:'harbeat.jetson-mix-plan.v1',id:h('1'),status:'ready',producer:'jetson',analysisVersion:'jetson-decision-v1',algorithmSha256:h('2'),plan:{from:a.id,to:b.id,windowId:p.window.id,start:p.start,end:p.end,duration:p.duration,rate:p.rate,bStart:p.window.start,bEnd:p.window.end,beatErrorMs:0},sourceProof:{a:binding(a),b:binding(b)},controls:{duration:p.duration,lastBarStart:6,bassTiming:{duckStart:4,swapStart:5.5,swapEnd:6}},metrics:{bassOverlap:null,bassDifference:null,otherOverlap:null,otherDifference:null,vocalSafe:false,vocalBenefit:0},decision:{recommended:'original',methods,explanation:'reference',policy:{version:'device-source-execution-v1'},limitations:[]},eq:p.v30Eq,restore:p.restore,requiredStems:[]} as unknown as JetsonDecision
 return{a,b,p,result:await sealJetsonDecision(raw)}
}
it('accepts a complete source-bound Jetson decision without performing acoustic analysis',async()=>{const f=await approvedFixture();expect(await verifyJetsonDecision(f.result,f.a,f.b,f.p)).toEqual(f.result)})
it('rejects modified controls and cannot grant an unapproved original fallback',async()=>{const f=await approvedFixture();f.result.controls.bassTiming.swapEnd+=.1;await expect(verifyJetsonDecision(f.result,f.a,f.b,f.p)).rejects.toThrow();f.result.decision.methods.original.eligible=false;await expect(verifyJetsonDecision(await sealJetsonDecision(f.result),f.a,f.b,f.p)).rejects.toThrow()})
it('rejects correctly hashed plans for a different source, cue or EQ',async()=>{for(const field of ['source','cue','eq']){const f=await approvedFixture();if(field==='source')f.result.sourceProof.a.masterSha256=h('f');if(field==='cue')f.result.plan.start+=.01;if(field==='eq')f.result.eq={bad:true} as any;await expect(verifyJetsonDecision(await sealJetsonDecision(f.result),f.a,f.b,f.p)).rejects.toThrow()}})
it('rejects vocal eligibility without a supplied safe tail curve',async()=>{const f=await approvedFixture();f.result.decision.methods.vocal.eligible=true;f.result.decision.methods.vocal.score=60;f.result.requiredStems=['vocals'];await expect(verifyJetsonDecision(await sealJetsonDecision(f.result),f.a,f.b,f.p)).rejects.toThrow()})

it('accepts cross-engine floating point EQ rounding but rejects audible or structural changes',async()=>{
 const f=await approvedFixture();const value=structuredClone(f.result);value.eq!.a[1].low+=1e-12
 await expect(verifyJetsonDecision(await sealJetsonDecision(value),f.a,f.b,f.p)).resolves.toBeDefined()
 value.eq!.a[1].low+=.001;await expect(verifyJetsonDecision(await sealJetsonDecision(value),f.a,f.b,f.p)).rejects.toThrow()
})
