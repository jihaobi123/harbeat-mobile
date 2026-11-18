import type {Track} from '../../listen-upstream/realtime/planner';
import {canonicalCase, sha256, type Point} from './contract';
import {STEM_ROLES, validateStemTimeline, type StemTimeline} from '../stem-timeline';
import type {ExecutionTrack} from '../device-execution';

export const LYRIC_PAIR_INDEX = '/listen/transition-policy/v1/index.json';
export const LYRIC_PAIR_SCHEMA = 'harbeat.lyric-pair.v1';
export const PAIR_SOURCE_KEYS = ['originalSha256','masterSha256','reportSha256','vocalSha256','runId'] as const;
export type PairSource = Record<(typeof PAIR_SOURCE_KEYS)[number],string> & {trackId:string;sourceStart:number};
type Source = PairSource & {manifestSha256:string;profileSha256:string;stemSha256:Record<string,string>};
type Reconstruction = {errorRatio:number;levelDeltaDb:number};
export type LyricPair = {
  schema:typeof LYRIC_PAIR_SCHEMA; id:string; producer:'jetson'; approved:true;
  technique:'intro-beatmix'|'intro-tail-handover'; duration:number; rate:number; outputGain:.76;
  sources:Record<'a'|'b',Source>; timeline:StemTimeline; aRelease:number; bVoiceEntry:number;
  sourceGains:Record<'a'|'b',number>;
  evidence:{beatErrorMs:number;pitchedRisk:number;compatible:true;peak:number;riseDb:number;
    reconstruction:Record<'a'|'b',Reconstruction & {boundary:Reconstruction}>;
    vocalConflict:number;improvement:number;minimumLevelDbfs:number};
};

const hash = (v:unknown) => typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
const bounded = (v:unknown, lo:number, hi:number) => typeof v==='number' && Number.isFinite(v) && lo<=v && v<=hi;
const frame = (v:number) => Math.abs(v*44100-Math.round(v*44100))<1e-6;

export function sourceMatches(source:PairSource, track:Track, allowOriginalMaster=false) {
  return source.trackId===track.id && PAIR_SOURCE_KEYS.every(key => {
    const value=track.provenance?.[key]??(allowOriginalMaster&&key==='originalSha256'?track.provenance?.masterSha256:undefined);
    return source[key]===value;
  });
}

export function matchLyricManifest(source:Source, manifest:ExecutionTrack) {
  if (source.manifestSha256!==manifest.manifestSha256 || source.profileSha256!==manifest.profile.sha256 ||
      STEM_ROLES.some(role => source.stemSha256[role]!==manifest.stems[role]?.sourceSha256))
    throw Error('人声交接的分轨发布版本已变化');
}

function preservesVoice(curve:Point[], duration:number, until:number, incoming:boolean) {
  if (incoming) return curve.some(([t,g])=>t<=until+.000001&&g===1) &&
    curve.every(([t,g])=>t<until||g===1);
  return curve.every(([t,g])=>t>until||g===1) && curve.some(([t,g])=>t>=until&&t<=duration&&g===1);
}

export function validateLyricPair(value:unknown):LyricPair {
  const row = value as LyricPair, e = row?.evidence;
  const fail = () => { throw Error('人声交接未通过 Jetson 质量复核'); };
  if (row?.schema!==LYRIC_PAIR_SCHEMA || row.producer!=='jetson' || row.approved!==true || !hash(row.id) ||
      !['intro-beatmix','intro-tail-handover'].includes(row.technique) || row.outputGain!==.76 ||
      !bounded(row.duration,1,16) || !frame(row.duration) || !bounded(row.rate,.95,1.05) ||
      !frame(row.duration*row.rate) || !bounded(row.aRelease,.15,row.duration-.10) ||
      !bounded(row.bVoiceEntry,row.aRelease+.15,row.duration) || !e || e.compatible!==true ||
      !bounded(e.beatErrorMs,0,65) || !bounded(e.pitchedRisk,0,.35) || !bounded(e.peak,0,.95) ||
      !bounded(e.riseDb,-120,3) || !bounded(e.minimumLevelDbfs,-55,0) ||
      !bounded(e.vocalConflict,0,.01) || !bounded(e.improvement,.08,4)) fail();
  validateStemTimeline(row.timeline,row.duration);
  if (!preservesVoice(row.timeline.a.vocals,row.duration,row.aRelease,false) ||
      !preservesVoice(row.timeline.b.vocals,row.duration,row.bVoiceEntry,true)) fail();
  for (const side of ['a','b'] as const) {
    const s = row.sources?.[side], r = e.reconstruction?.[side];
    if (!s || !/^track-[a-f0-9]{20}$/.test(s.trackId) || !bounded(s.sourceStart,0,7200) || !frame(s.sourceStart) ||
        typeof s.runId!=='string' || !/^[A-Za-z0-9_-]{1,160}$/.test(s.runId) ||
        [...PAIR_SOURCE_KEYS.slice(0,4).map(key=>s[key]),s.manifestSha256,s.profileSha256,
          ...STEM_ROLES.map(role=>s.stemSha256?.[role])].some(x=>!hash(x)) ||
        !bounded(row.sourceGains?.[side],.5,2) ||
        ![r,r?.boundary].every(x=>x&&bounded(x.errorRatio,0,.25)&&bounded(x.levelDeltaDb,-1.5,1.5))) fail();
  }
  if (row.sources.a.trackId===row.sources.b.trackId) fail();
  return row;
}

export async function readLyricPairIndex(value:unknown):Promise<LyricPair[]> {
  if (!Array.isArray(value) || value.length>64) return [];
  const results = await Promise.allSettled(value.map(async raw=>{
    const row=validateLyricPair(raw);
    if (row.id!==await sha256(new TextEncoder().encode(canonicalCase(row)).buffer))
      throw Error('人声交接方案指纹不一致');
    return row;
  }));
  return results.flatMap(r=>r.status==='fulfilled'?[r.value]:[]);
}
