import {qualityTrack} from '../metric-upstream/continuous/qualityFixture'
import {nearbyPlan} from './nearby'
import {sealJetsonDecision,type JetsonDecision} from './jetson-contract'
const h=(x:string)=>x.repeat(64)
/** Source-bound test evidence shared by approval and consumer tests. */
export async function jetsonFixture(){
 const a=qualityTrack('approval-a'),b=qualityTrack('approval-b')
 for(const [i,t] of [a,b].entries()){
  t.provenance={runId:'run'+t.id,masterSha256:h(String(i+3)),reportSha256:h('b'),vocalSha256:h('c')}
  t.native={url:'/listen/media/'+t.provenance.masterSha256+'.flac',sha256:String(t.provenance.masterSha256),bytes:1000,duration:t.duration}
  Object.assign(t.alignment!.source,{...t.provenance,reportId:t.reportId})
  Object.assign(t.preprocessing!,{masterSha256:t.provenance.masterSha256,reportSha256:t.provenance.reportSha256})
  t.preprocessing!.vocalActivity.source={track_id:t.id,analysis_run_id:t.provenance.runId,vocal_sha256:t.provenance.vocalSha256}
 }
 b.windows[0].variants={[a.id]:{url:'/listen/media/entry.flac',sha256:h('a'),bytes:1000,duration:8,rate:1}}
 const p=nearbyPlan(a,b,10)!
 if(!p)throw Error('Fixture is not a qualified transition')
 const binding=(t:typeof a)=>({trackId:t.id,...t.provenance!,manifestSha256:h('d'),profileSha256:h('e'),stemSha256:{drums:h('f'),bass:h('f'),other:h('f'),vocals:h('c')}})
 const methods=Object.fromEntries(['original','bass','filter','yield','vocal','bass_filter'].map(m=>[m,{name:m,eligible:['original','bass'].includes(m),score:m==='original'?50:m==='bass'?80:null,reason:'Jetson approved reference',processingCost:0,levelPenalty:0}]))
 const raw={schema:'harbeat.jetson-mix-plan.v1',id:h('1'),status:'ready',producer:'jetson',analysisVersion:'jetson-decision-v1',algorithmSha256:h('2'),plan:{from:a.id,to:b.id,windowId:p.window.id,start:p.start,end:p.end,duration:p.duration,rate:p.rate,bStart:p.window.start,bEnd:p.window.end,beatErrorMs:0},sourceProof:{a:binding(a),b:binding(b)},controls:{duration:p.duration,lastBarStart:6,bassTiming:{duckStart:4,swapStart:5.5,swapEnd:6}},metrics:{bassOverlap:.9,bassDifference:.9,otherOverlap:null,otherDifference:null,vocalSafe:false,vocalBenefit:0,definitions:{status:'Jetson observed window'}},decision:{recommended:'bass',methods,explanation:'Jetson bass decision',policy:{version:'device-source-execution-v1'},limitations:[]},eq:p.v30Eq,restore:p.restore,requiredStems:['bass']} as unknown as JetsonDecision
 return{a,b,p,result:await sealJetsonDecision(raw)}
}
