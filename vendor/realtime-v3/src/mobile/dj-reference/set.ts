import type {Plan, Track} from '../../listen-upstream/realtime/planner';
import {pairPlan,type PairReference} from './pair';
import {assessContinuation} from '../set-continuity';

export const TOUCAN_SET_PATH = '/assets/realtime/pair-reference-lab/toucan-set.json';

export function toucanCueList(tracks:Track[], references:PairReference[], continuous=false) {
  return tracks.slice(0,-1).flatMap((a,i) => {
    const b=tracks[i+1];
    for (const recipe of references) {
      const plan=pairPlan(recipe,a,b,0,a.duration,true);
      if(plan&&(!continuous||assessContinuation(b,plan.window.end).allowed))
        return [{slot:i+1,from:a.title,to:b.title,position:Math.max(0,plan.start-10)}];
    }
    return [];
  });
}

export function readToucanSet(value: any): Track[] {
  if (value?.schema !== 'harbeat.ordered-dj-set.v1' || value.id !== 'toucan-2014' ||
      !Array.isArray(value.tracks) || value.tracks.length !== 19) throw Error('Toucan Set 清单不完整');
  const ids = new Set<string>();
  for (const track of value.tracks) {
    const original = track?.provenance?.originalSha256;
    if (typeof original !== 'string' || !/^[a-f0-9]{64}$/.test(original) ||
        track.id !== 'track-' + original.slice(0,20) || ids.has(track.id) ||
        typeof track.title !== 'string' || !track.title || !Number.isFinite(track.duration) ||
        track.duration <= 12 || !track.audioSegments?.length || !Array.isArray(track.windows) ||
        !Array.isArray(track.bars)) throw Error('Toucan Set 曲目身份或原曲资料不完整');
    let end = 0;
    for (const segment of track.audioSegments) {
      const {asset} = segment;
      if (segment.start !== end || !Number.isFinite(segment.end) || segment.end <= end ||
          !/^[a-f0-9]{64}$/.test(asset?.sha256) || asset.url !== '/listen/media/' + asset.sha256 + '.flac' ||
          !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 ||
          !Number.isFinite(asset.duration) || Math.abs(asset.duration - (segment.end - end)) > 1 / 44100)
        throw Error('Toucan Set 原曲分段不连续或指纹缺失');
      end = segment.end;
    }
    if (end !== track.duration || track.native?.sha256 !== track.audioSegments[0].asset.sha256)
      throw Error('Toucan Set 原曲分段范围不完整');
    ids.add(track.id);
  }
  return value.tracks;
}

type Host = {
  current:Track|null; position:number; playing:boolean; busy?:boolean; pending:unknown;
  readySetPair:(id:string)=>Promise<Plan|null>;
  armSetPair:(id:string)=>boolean;
  queueSetContinuation:(track:Track, signal:AbortSignal)=>Promise<void>;
  log:(kind:string, data:Record<string,unknown>)=>void;
};

export class OrderedDjSet {
  private index = -1;
  private operation = new AbortController();
  private prepared: Plan|null|undefined;
  private queued = false;
  private retryAt = 0;
  private state: 'playing'|'complete'|'blocked' = 'playing';
  private error = '';

  constructor(readonly tracks:Track[], private host:Host, private save:()=>void, private changed:()=>void,
    private firstIndex=0) {}

  get next() { return this.state === 'playing' && this.index >= 0 ? this.tracks[this.index + 1] : undefined; }

  resetPreparation() {
    this.operation.abort();
    this.operation = new AbortController();
    this.prepared = undefined;
    this.queued = false;
    this.retryAt = 0;
  }

  close() { this.operation.abort(); }

  private finish(state:'complete'|'blocked', error='') {
    this.state = state;
    this.error = error;
    this.close();
    this.host.log('dj_set_'+state, {slot:this.index+1,total:this.tracks.length,reason:error});
    this.save();
    this.changed();
  }

  tick() {
    const host = this.host;
    if (this.state !== 'playing' || host.busy) return;
    const current = host.current;
    if (!current) {
      if (this.index >= 0) {
        if (this.index === this.tracks.length - 1) this.finish('complete');
        else this.finish('blocked',this.error || '未能接到 Set 的指定下一首');
      }
      return;
    }
    if (current.id !== this.tracks[this.index]?.id) {
      const nextIndex = this.index < 0 ? this.firstIndex : this.index + 1;
      if (current.id !== this.tracks[nextIndex]?.id) {
        this.finish('blocked','播放器未按 Set 的固定曲序接管');
        return;
      }
      this.index=nextIndex;
      this.resetPreparation();
      this.error = '';
      host.log('dj_set_track_enter',{slot:this.index+1,track:current.id,title:current.title,sourceOffset:host.position});
      this.save();
      this.changed();
    }
    const next = this.next;
    if (!next || !host.playing || host.pending || this.queued || host.position < this.retryAt) return;
    const signal = this.operation.signal;
    if (this.prepared === undefined) {
      this.queued = true;
      void host.readySetPair(next.id).then(plan => {
        if (!signal.aborted) this.prepared = plan;
      }).catch(error => {
        if (!signal.aborted) {
          this.prepared = null;
          host.log('dj_set_reference_unavailable',{from:current.id,to:next.id,reason:String(error)});
        }
      }).finally(() => { if (!signal.aborted) { this.queued = false; this.changed(); } });
      return;
    }
    if (this.prepared) {
      if (host.position < this.prepared.start - 8) return;
      if (host.armSetPair(next.id)) return;
      this.prepared = null;
      host.log('dj_set_reference_unavailable',{from:current.id,to:next.id,reason:'参考接点无法在当前播放位置执行'});
    }
    if (current.duration - host.position > 14) return;
    this.queued = true;
    void host.queueSetContinuation(next,signal).catch(error => {
      if (!signal.aborted) {
        this.error = (error as Error).message;
        this.retryAt = host.position + 1;
        host.log('dj_set_continuation_retry',{from:current.id,to:next.id,reason:this.error});
      }
    }).finally(() => { if (!signal.aborted) { this.queued = false; this.changed(); } });
  }

  snapshot() {
    return {id:'toucan-2014',name:'Toucan 2014',slot:this.index+1,total:this.tracks.length,
      state:this.state,next:this.next?.title??null,nextId:this.next?.id??null,error:this.error};
  }
}
