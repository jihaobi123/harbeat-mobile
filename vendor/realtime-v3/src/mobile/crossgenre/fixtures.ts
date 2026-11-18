import {ALGORITHM_SHA,type CrossProfile} from './contract'
import type {Track} from '../../listen-upstream/realtime/planner'

export function fixture(id='a',bpm=95){
 const provenance={masterSha256:'a'.repeat(64),reportSha256:'b'.repeat(64),vocalSha256:'c'.repeat(64),runId:'run-'+id}
 const track={id,title:id,bpm,duration:120,style:id==='a'?'Hip-Hop':'House',provenance,reportId:'d'.repeat(64),bars:[16,32,48],windows:[],vocals:[]} as unknown as Track
 const level={rms:.1,rmsDbfs:-20,peak:.6},source={trackId:id,reportId:track.reportId!,...provenance,manifestSha256:'e'.repeat(64)}
 const profile={schema:'harbeat.crossgenre-track.v1',policy:'crossgenre-structural-v1',producer:'jetson',algorithmSha256:ALGORITHM_SHA,source,duration:120,
  entries:[{id:'in-8',time:16,barIndex:8,localBpm:bpm,section:'verse',head:level,body:level,semanticStatus:'unverified'}],
  exits:[{id:'out-16',time:32,barIndex:16,localBpm:bpm,section:'verse',before:level,echoEligible:false,capture:{start:31,end:31.7,...level},voiceEnd:31.7,semanticStatus:'unverified'}],
  analysis:{frameSeconds:.05,semanticPhraseStatus:'unverified'},limitations:['unverified acoustic cue']} as CrossProfile
 return{track,profile}
}
