import type {LiveTransport} from '../../listen-upstream/realtime/transport';
import type {Plan, Track} from '../../listen-upstream/realtime/planner';
import {nativeSegment} from '../../listen-upstream/continuous/segments';
import {PAIR_GAIN} from './pair';

type Deck = NonNullable<LiveTransport['active']>;
type Seam = {
  graph:(t:Track, at:number, offset:number)=>Deck;
  nativeSource:(d:Deck, buffer:AudioBuffer, at:number, offset:number, edge:boolean)=>void;
  retire:(d:Deck, fade:boolean)=>void;
  protected:()=>void;
  monitor:AudioWorkletNode;
};

export const SET_CONTINUATION = '原曲顺序续播';

/** Use the same native stream and audio clock as ordinary B takeover. */
export async function queueSetContinuation(host:LiveTransport, target:Track, signal:AbortSignal, origin:'set'|'automatic'='set') {
  const source = host.active;
  if (!source || !host.playing || host.pending || source.track.id === target.id) throw Error('当前不能准备原曲续播');
  const end = source.track.duration;
  const at = source.at + end - source.offset;
  const asset = nativeSegment(target,0).asset;
  const buffer = await host.cache.load(asset,signal);
  signal.throwIfAborted();
  if (host.active !== source || !host.playing || host.pending || at - host.ctx.currentTime < .15)
    throw Error('未赶上原曲续播边界');

  const seam = host as unknown as Seam;
  const deck = seam.graph(target,at,0);
  const requestId = (origin==='set'?'dj-set-native:':'auto-native:') + source.track.id + ':' + target.id;
  const planId = requestId + ':' + host.gate.revision;
  const plan:Plan = {id:planId,from:source.track.id,to:target.id,asset,start:end,end,duration:0,restore:end,rate:1,
    window:{id:planId,start:0,end:0,bars:0,role:'native-continuation',energy:0,variants:{}},
    score:0,midDuck:false,aVocal:0,bVocal:0,aEnergy:0,bEnergy:0,gridError:0,
    reason:SET_CONTINUATION,section:'原曲结尾',prepared:true};
  const events = [{name:'原曲结尾 / 指定下一首起播',frame:Math.round(at * host.ctx.sampleRate),planId,requestId}];
  try {
    deck.gain.gain.value = PAIR_GAIN;
    seam.nativeSource(deck,buffer,at,0,true);
    seam.monitor.port.postMessage({kind:'arm',events});
    host.pending = {automatic:true,plan,deck,start:at,end:at,id:planId,committed:false,requestId};
    host.lastPlan = plan;
    seam.protected();
    host.log('plan_scheduled',{planId,requestId,plan,start:at,end:at,events,transitionFamily:'native-continuation',origin});
    host.status = '已准备原曲顺序续播';
  } catch (error) {
    host.pending = null;
    seam.monitor.port.postMessage({kind:'cancel',planId});
    seam.retire(deck,false);
    seam.protected();
    throw error;
  }
}
