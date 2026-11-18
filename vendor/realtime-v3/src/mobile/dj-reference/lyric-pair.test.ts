import {describe,expect,it} from 'vitest';
import type {Track} from '../../listen-upstream/realtime/planner';
import {STEM_ROLES} from '../stem-timeline';
import {canonicalCase,sha256} from './contract';
import {LYRIC_PAIR_SCHEMA,readLyricPairIndex,validateLyricPair,type LyricPair} from './lyric-pair';
import {LYRIC_PAIR_REASON,pairPlan,upcomingPairTargets} from './pair';

const h=(c:string)=>c.repeat(64);
const makeSource=(c:string,sourceStart:number)=>({trackId:'track-'+c.repeat(20),sourceStart,
  originalSha256:h(c),masterSha256:h(c),reportSha256:h('2'),vocalSha256:h('3'),runId:'run-'+c,
  manifestSha256:h('4'),profileSha256:h('5'),stemSha256:Object.fromEntries(STEM_ROLES.map(r=>[r,h('3')]))});
function fixture(){
  const a=makeSource('a',60), b=makeSource('b',5), duration=4;
  const roles=(side:'a'|'b')=>Object.fromEntries(STEM_ROLES.map(role=>[role,side==='a'?
    [[0,1],[2,1],[3,0],[4,0]]:[[0,0],[3,0],[3.5,1],[4,1]]])) as LyricPair['timeline']['a'];
  const delta={errorRatio:.05,levelDeltaDb:.1},reconstruction={...delta,boundary:delta};
  const recipe:LyricPair={schema:LYRIC_PAIR_SCHEMA,id:h('1'),producer:'jetson',approved:true,
    technique:'intro-tail-handover',duration,rate:1,outputGain:.76,sources:{a,b},sourceGains:{a:1,b:1},
    aRelease:2,bVoiceEntry:3.6,timeline:{schema:'harbeat.stem-timeline.v1',clock:'transition-start',duration,a:roles('a'),b:roles('b')},
    evidence:{beatErrorMs:48,pitchedRisk:0,compatible:true,peak:.6,riseDb:1,
      reconstruction:{a:reconstruction,b:reconstruction},vocalConflict:0,improvement:.15,minimumLevelDbfs:-40}};
  const track=(s:typeof a)=>({id:s.trackId,duration:100,native:{url:'https://example.test/native.flac',duration:100},provenance:s}) as unknown as Track;
  return {recipe,a:track(a),b:track(b)};
}

describe('Jetson lyric pair admission',()=>{
  it('only admits source-bound approved curves with adequate lead and headroom',()=>{
    const {recipe,a,b}=fixture();
    expect(validateLyricPair(recipe)).toBe(recipe);
    expect(upcomingPairTargets([recipe],a,58)).toEqual([b.id]);
    expect(pairPlan(recipe,a,b,58,42,true)?.reason).toBe(LYRIC_PAIR_REASON);
    expect(pairPlan(recipe,a,b,60,40,true)).toBeNull();
    expect(pairPlan(recipe,a,{...b,provenance:{...b.provenance!,reportSha256:h('6')}},58,42,true)).toBeNull();
    expect(()=>validateLyricPair({...recipe,evidence:{...recipe.evidence,riseDb:3.01}})).toThrow();
    expect(()=>validateLyricPair({...recipe,aRelease:2.5})).toThrow();
  });
  it('rejects alteration of a valid Jetson record',async()=>{
    const {recipe}=fixture();
    recipe.id=await sha256(new TextEncoder().encode(canonicalCase(recipe)).buffer);
    expect(await readLyricPairIndex([recipe,{...recipe,sourceGains:{a:1.1,b:1}}])).toEqual([recipe]);
  });
});
