import {canonicalCase, sha256, validReferenceCurve, type ReferenceCurve} from './contract';
import {nativeSegment} from '../../listen-upstream/continuous/segments';
import type {Plan, Track} from '../../listen-upstream/realtime/planner';
import {LYRIC_PAIR_SCHEMA,sourceMatches,type LyricPair,type PairSource} from './lyric-pair';

const bindings = ['originalSha256','masterSha256','reportSha256','vocalSha256','runId'] as const;
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const frames = (value: number) => Math.abs(value * 44100 - Math.round(value * 44100)) < 1e-6;
type Source = PairSource;
export const PAIR_INDEX = '/listen/dj-pair-references/v1/index.json';
export const PAIR_LAB = '/assets/realtime/pair-reference-lab';
export const SET_TECHNIQUES = PAIR_LAB + '/set-techniques.json';
export const PAIR_GAIN = .76;
export const PAIR_REASON = 'DJ 曲对参考';
export const LYRIC_PAIR_REASON = 'Jetson 人声接力';
export type PairReference = ReferenceCurve & {
  schema:'harbeat.dj-pair-reference.v1';
  id:string;
  producer:'jetson';
  approved:true;
  sources:Record<'a'|'b',Source>;
  reference:{url:string; coordinateProofSha256:string};
  duration:number;
  rate:number;
  outputGain:typeof PAIR_GAIN;
  technique?:'cue-gradual'|'cue-low-eq';
  eq?:{releaseSec:number};
};
export type CuePair = PairReference | LyricPair;

export function validatePair(value: any): PairReference {
  const fail = () => { throw Error('DJ 曲对参考未通过来源或质量复核'); };
  if (value?.schema !== 'harbeat.dj-pair-reference.v1' || value.producer !== 'jetson' ||
      value.approved !== true || !hash(value.id) || value.outputGain !== PAIR_GAIN ||
      !Number.isFinite(value.duration) || value.duration < 1 || value.duration > 32 || !frames(value.duration) ||
      !Number.isFinite(value.rate) || value.rate < .95 || value.rate > 1.05 || !frames(value.duration * value.rate) ||
      !hash(value.reference?.coordinateProofSha256) ||
      typeof value.reference?.url !== 'string' || new URL(value.reference.url).protocol !== 'https:' || !validReferenceCurve(value, value.duration))
    fail();
  const pair = value as PairReference;
  if (pair.technique !== undefined && !['cue-gradual','cue-low-eq'].includes(pair.technique)) fail();
  if (pair.technique === 'cue-low-eq') {
    const release = pair.eq?.releaseSec;
    if (typeof release !== 'number' || !Number.isFinite(release) ||
        release < .1 || release > 2 || release >= pair.duration) fail();
  } else if (pair.eq !== undefined) fail();
  for (const side of ['a','b'] as const) {
    const source = pair.sources?.[side];
    if (typeof source?.trackId !== 'string' || !source.trackId || source.trackId.length > 200 ||
        !Number.isFinite(source.sourceStart) || source.sourceStart < 0 || !frames(source.sourceStart) ||
        typeof source.runId !== 'string' || !source.runId || source.runId.length > 200 ||
        bindings.slice(0, 4).some(key => !hash(source[key]))) fail();
  }
  if (pair.sources.a.trackId === pair.sources.b.trackId) fail();
  return pair;
}

export async function readPairIndex(value: unknown): Promise<PairReference[]> {
  if (!Array.isArray(value) || value.length > 32) return [];
  const rows = await Promise.allSettled(value.map(async row => {
    const pair = validatePair(row);
    if (pair.id !== await sha256(new TextEncoder().encode(canonicalCase(pair)).buffer))
      throw Error('DJ 曲对参考指纹不一致');
    return pair;
  }));
  return rows.flatMap(row => row.status === 'fulfilled' ? [row.value] : []);
}

export function upcomingPairTargets(rows:CuePair[], track:Track, position:number) {
  return rows.filter(pair => {
    const {sourceStart:start} = pair.sources.a;
    return sourceMatches(pair.sources.a, track, pair.schema===LYRIC_PAIR_SCHEMA) && start >= position + .25 &&
      start >= track.duration * .5 && start + pair.duration < track.duration - .1;
  }).map(pair => pair.sources.b.trackId);
}

export function pairPlan(pair: CuePair, a: Track, b: Track, position: number, budget: number, automatic: boolean): Plan|null {
  const lyric=pair.schema===LYRIC_PAIR_SCHEMA;
  if (!sourceMatches(pair.sources.a,a,lyric) || !sourceMatches(pair.sources.b,b,lyric)) return null;
  const start = pair.sources.a.sourceStart, end = start + pair.duration;
  const bStart = pair.sources.b.sourceStart, bEnd = bStart + pair.duration * pair.rate;
  if (!Number.isFinite(position) || !Number.isFinite(budget) || start < position + .25 ||
      end > position + budget || end >= a.duration - .1 || bEnd + 12 > b.duration ||
      (automatic && start < a.duration * .5)) return null;
  const asset = nativeSegment(b, bEnd).asset;
  return {
    id:pair.id, from:a.id, to:b.id, start, end, duration:pair.duration, rate:pair.rate,
    window:{id:pair.id,start:bStart,end:bEnd,bars:0,role:pair.technique??'dj-pair-reference',energy:0,variants:{}},
    asset, restore:end, score:0, midDuck:false, aVocal:0, bVocal:0, aEnergy:0, bEnergy:0,
    gridError:pair.evidence.beatErrorMs / 1000,
    reason:lyric?LYRIC_PAIR_REASON:PAIR_REASON,
    section:lyric?'人声接力接点':'DJ 参考接点', prepared:true,
  };
}
