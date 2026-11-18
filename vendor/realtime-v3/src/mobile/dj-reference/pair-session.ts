import type {LiveTransport} from '../../listen-upstream/realtime/transport';
import type {Plan, Track} from '../../listen-upstream/realtime/planner';
import {nativeSegments} from '../../listen-upstream/continuous/segments';
import {sliceSceneSource, stretchSceneInputs} from '../longmix/prepare';
import {valueAt, type Point} from './contract';
import {PAIR_GAIN, pairPlan, type CuePair, type PairReference} from './pair';
import {measureCueBassInput,scheduleCueBass} from './cue-eq';
import {LYRIC_PAIR_SCHEMA,type LyricPair} from './lyric-pair';
import {LYRIC_EDGE,prepareLyricPair,scheduleLyricStems,type LyricPairAudio} from './lyric-pair-audio';

type Deck = NonNullable<LiveTransport['active']>;
type Seam = {
  graph:(t:Track, at:number, offset:number) => Deck;
  nativeSource:(d:Deck, b:AudioBuffer, at:number, offset:number, edge:boolean) => void;
  retire:(d:Deck, fade:boolean) => void;
  protected:() => void;
  monitor:AudioWorkletNode;
};

type Prepared = {source:Deck; target:Track; plan:Plan; body:AudioBuffer} & (
  {kind:'reference';recipe:PairReference;entry:AudioBuffer} |
  {kind:'lyric';recipe:LyricPair;audio:LyricPairAudio}
);
const edge = .004;

export class PairSession {
  private controller:AbortController|null = null;
  private prepared:Prepared|null = null;
  private sequence = 0;

  constructor(private host:LiveTransport, private references:CuePair[],
    private continuation:(target:Track, position:number)=>boolean, private base?:URL) {}

  cancel() {
    this.controller?.abort();
    this.controller = null;
    this.prepared = null;
  }

  get upcoming() {
    const ready = this.prepared, host = this.host;
    return ready && ready.source === host.active && ready.plan.start >= host.position + .25 ? ready.plan : null;
  }

  async prepare(ids:string[], automatic:boolean, budget:number, accept?:(recipe:CuePair)=>boolean):Promise<string|null> {
    const host = this.host, source = host.active;
    if (!source) return null;
    for (const recipe of this.references) {
      if (recipe.sources.a.trackId !== source.track.id || !ids.includes(recipe.sources.b.trackId) || (accept && !accept(recipe))) continue;
      const target = host.tracks.find(track => track.id === recipe.sources.b.trackId);
      const plan = target && pairPlan(recipe, source.track, target, host.position, budget, automatic);
      if (!plan || !target) continue;
      if (automatic && !this.continuation(target,plan.window.end)) {
        host.log('dj_pair_reference_fallback',{planId:recipe.id, from:plan.from, to:plan.to, reason:'B 原曲缺少下一跳准备区间'});
        continue;
      }
      const controller = this.controller = new AbortController();
      const lyric=recipe.schema===LYRIC_PAIR_SCHEMA;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(lyric?20000:6000)]);
      try {
        if (recipe.schema===LYRIC_PAIR_SCHEMA) {
          if (!this.base) continue;
          const audio=await prepareLyricPair(host,this.base,recipe,source.track,target,plan,signal);
          signal.throwIfAborted();
          if (source!==host.active || target!==host.tracks.find(track=>track.id===plan.to) ||
              !pairPlan(recipe,source.track,target,host.position,budget,automatic)) throw Error('人声接力接点已过或音源变化');
          this.prepared={kind:'lyric',recipe,source,target,plan,body:audio.body,audio};
          host.log('lyric_pair_ready',{planId:recipe.id,from:plan.from,to:plan.to,devicePeak:audio.peak});
          return target.id;
        }
        const {ctx, cache} = host, sr = ctx.sampleRate;
        if (sr !== 44100) throw Error('DJ 参考需要 44.1 kHz 播放环境');
        const a = await sliceSceneSource(ctx, cache, nativeSegments(source.track), plan.start, plan.duration, signal);
        const input = await sliceSceneSource(ctx, cache, nativeSegments(target), plan.window.start, (plan.duration + .008) * plan.rate + .5, signal);
        const n = Math.round(plan.duration * sr);
        const {master:entry} = await stretchSceneInputs({master:input}, ctx, plan.rate, n + Math.ceil(.008 * sr), signal);
        const body = await cache.load(plan.asset, signal);
        signal.throwIfAborted();
        if (source !== host.active || target !== host.tracks.find(track => track.id === plan.to) ||
            !pairPlan(recipe, source.track, target, host.position, budget, automatic))
          throw Error('DJ 参考接点已过或原曲已变化');
        const segment = nativeSegments(target).find(s => s.asset.url === plan.asset.url)!;
        const bodyFrame = Math.round((plan.window.end - segment.start) * sr);
        const fadeFrames = Math.ceil(edge * sr);
        if (body.sampleRate !== sr || body.numberOfChannels !== 2 || body.length < bodyFrame + fadeFrames)
          throw Error('B 原曲未覆盖接管边界');
        const measured = recipe.eq ? await Promise.all([
          measureCueBassInput(a,'a',plan.duration,recipe.eq.releaseSec),
          measureCueBassInput(entry,'b',plan.duration,recipe.eq.releaseSec),
        ]) : [a,entry];
        signal.throwIfAborted();
        let peak = 0;
        for (let channel = 0; channel < 2; channel++) {
          const left = measured[0].getChannelData(channel), right = measured[1].getChannelData(channel);
          for (let i = 0; i < n; i++) {
            const t = i / sr;
            peak = Math.max(peak, Math.abs(left[i] * valueAt(recipe.a, t) + right[i] * valueAt(recipe.b, t)));
          }
          const native = body.getChannelData(channel);
          for (let i = 0; i < fadeFrames; i++) {
            const amount = i / (edge * sr);
            peak = Math.max(peak, Math.abs(right[n + i] * (1 - amount) + native[bodyFrame + i] * amount));
          }
        }
        if (!Number.isFinite(peak) || peak * PAIR_GAIN > .95)
          throw Error('手机变速后的实际音频超过峰值门槛');
        this.prepared = {kind:'reference',recipe, source, target, plan, entry, body};
        host.log('dj_pair_reference_ready',{planId:recipe.id, from:plan.from, to:plan.to, devicePeak:peak * PAIR_GAIN});
        return target.id;
      } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason;
        host.log(lyric?'lyric_pair_fallback':'dj_pair_reference_fallback',{planId:recipe.id, from:plan.from, to:plan.to, reason:(error as Error).message});
      } finally {
        if (this.controller === controller) this.controller = null;
      }
    }
    return null;
  }

  arm(id:string, budget:number, automatic:boolean):boolean {
    const host = this.host, ready = this.prepared, source = host.active;
    if (!ready || !source || ready.source !== source || ready.target.id !== id ||
        ready.target !== host.tracks.find(track => track.id === id) || host.buffering) return false;
    const {recipe, target, body} = ready, {ctx} = host;
    const plan = pairPlan(recipe, source.track, target, host.position, budget, automatic);
    if (!plan || (automatic && !this.continuation(target,plan.window.end))) return false;
    const start = source.at + plan.start - source.offset, end = start + plan.duration;
    if (start < ctx.currentTime + .2) return false;
    const seam = host as unknown as Seam;
    const deck = seam.graph(target,end,plan.window.end);
    if (ready.kind==='lyric') {
      const requestId=`lyric-pair-${++this.sequence}`, planId=`${requestId}:${recipe.id}`;
      const events=[{name:'人声接力 B 开始混入',frame:Math.round(start*ctx.sampleRate)},
        {name:'人声接力 B 原曲接管',frame:Math.round(end*ctx.sampleRate)}].map(event=>({...event,planId,requestId}));
      try {
        scheduleLyricStems(ctx,deck,ready.audio,ready.recipe,start);
        seam.nativeSource(deck,body,end,plan.window.end,true);
        seam.monitor.port.postMessage({kind:'arm',events});
        source.gain.gain.setValueAtTime(PAIR_GAIN,start);
        source.gain.gain.linearRampToValueAtTime(0,start+LYRIC_EDGE);
        host.pending={automatic,plan,deck,start,end,id:planId,committed:false,requestId};
        host.lastPlan=plan;seam.protected();
        host.log('plan_scheduled',{requestId,planId,plan,start,end,events,transitionFamily:recipe.technique,
          producer:recipe.producer,sources:recipe.sources,evidence:recipe.evidence});
        host.status='已安排人声接力';this.prepared=null;
        return true;
      } catch(error) {
        seam.monitor.port.postMessage({kind:'cancel',planId});
        seam.retire(deck,false);source.gain.gain.cancelScheduledValues(start);
        source.gain.gain.setValueAtTime(PAIR_GAIN,start);
        host.pending=null;seam.protected();
        host.log('lyric_pair_fallback',{planId:recipe.id,from:plan.from,to:plan.to,reason:(error as Error).message});
        return false;
      }
    }
    const {recipe:reference, entry}=ready;
    const technique = reference.technique??'dj-pair-reference';
    const label = technique==='cue-low-eq'?'DJ 接点 · 低频 EQ 渐混':
      technique==='cue-gradual'?'DJ 接点 · 原渐混':'DJ 参考';
    const requestId = `dj-pair-${++this.sequence}`;
    const planId = `${requestId}:${recipe.id}`;
    const schedule = (parameter:AudioParam, points:Point[]) => {
      for (const [i,[t,v]] of points.entries()) {
        if (i) parameter.linearRampToValueAtTime(v * PAIR_GAIN, start + t);
        else parameter.setValueAtTime(v * PAIR_GAIN, start);
      }
    };
    try {
      const node = ctx.createBufferSource(), fade = ctx.createGain();
      deck.sources.push(node);
      deck.nodes.push(fade);
      node.buffer = entry;
      node.connect(fade).connect(deck.nodes[0]);
      fade.gain.setValueAtTime(1, end);
      fade.gain.linearRampToValueAtTime(0, end + edge);
      node.onended = () => {
        node.disconnect();
        fade.disconnect();
        node.buffer = null;
        deck.sources = deck.sources.filter(item => item !== node);
        deck.nodes = deck.nodes.filter(item => item !== fade);
      };
      deck.gain.gain.value = 0;
      schedule(deck.gain.gain, reference.b);
      node.start(start, 0, plan.duration + edge);
      seam.nativeSource(deck,body,end,plan.window.end,true);
      if (reference.eq) {
        scheduleCueBass(source,'a',start,plan.duration,reference.eq.releaseSec);
        scheduleCueBass(deck,'b',start,plan.duration,reference.eq.releaseSec);
      }
      const events = [
        {name:label+' B 开始混入',frame:Math.round(start * ctx.sampleRate)},
        {name:label+' B 原曲接管',frame:Math.round(end * ctx.sampleRate)},
      ].map(event => ({...event,planId,requestId}));
      seam.monitor.port.postMessage({kind:'arm',events});
      schedule(source.gain.gain, reference.a);
      host.pending = {automatic, plan, deck, start, end, id:planId, committed:false, requestId};
      host.lastPlan = plan;
      seam.protected();
      host.log('plan_scheduled',{requestId,planId,plan,start,end,events,transitionFamily:technique,
        producer:reference.producer, reference:reference.reference, sources:reference.sources, evidence:reference.evidence,
        ...(reference.eq?{eq:{...reference.eq,frequencyHz:140,aDb:-9,bDb:-7}}:{})});
      host.status = '已安排 '+label;
      this.prepared = null;
      return true;
    } catch (error) {
      seam.monitor.port.postMessage({kind:'cancel',planId});
      seam.retire(deck,false);
      source.gain.gain.cancelScheduledValues(start);
      source.gain.gain.setValueAtTime(PAIR_GAIN, start);
      if (reference.eq) {
        for (const param of [source.low.gain,source.wet.gain,source.dry.gain])
          param.cancelScheduledValues(start);
        source.wet.gain.setValueAtTime(0,start);
        source.dry.gain.setValueAtTime(1,start);
      }
      host.pending = null;
      seam.protected();
      host.log('dj_pair_reference_fallback',{planId:recipe.id, from:plan.from, to:plan.to, reason:(error as Error).message});
      return false;
    }
  }
}
