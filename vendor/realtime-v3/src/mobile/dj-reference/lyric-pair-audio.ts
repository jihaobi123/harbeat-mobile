import type {Plan,Track} from '../../listen-upstream/realtime/planner';
import type {LiveTransport} from '../../listen-upstream/realtime/transport';
import {nativeSegments} from '../../listen-upstream/continuous/segments';
import {readMetadata,sliceSceneSource,stretchSceneInputs} from '../longmix/prepare';
import {validateExecutionTrack,valueAt} from '../device-execution';
import {verifyExecutionProfile} from '../device-prepare';
import {STEM_ROLES,validateTimelineVoices} from '../stem-timeline';
import {matchLyricManifest,type LyricPair} from './lyric-pair';

export const LYRIC_EDGE=.004;
type Deck=NonNullable<LiveTransport['active']>;
type AudioBySide=Record<'a'|'b',Record<string,AudioBuffer>>;
export type LyricPairAudio={stems:AudioBySide;body:AudioBuffer;peak:number};

export async function prepareLyricPair(host:LiveTransport,base:URL,recipe:LyricPair,a:Track,b:Track,plan:Plan,signal:AbortSignal):Promise<LyricPairAudio> {
  validateTimelineVoices(recipe.timeline,a,b,plan);
  const {ctx,cache}=host, sr=ctx.sampleRate, edgeFrames=Math.ceil(LYRIC_EDGE*sr);
  if(sr!==44100)throw Error('人声交接需要 44.1 kHz 播放环境');
  const frames=Math.round(plan.duration*sr);
  const getManifest=async (track:Track,side:'a'|'b')=>{
    const manifest=validateExecutionTrack(await readMetadata('/listen/execution/tracks/'+track.id+'.json',base,signal),track);
    matchLyricManifest(recipe.sources[side],manifest);
    await verifyExecutionProfile(manifest,base,signal);
    return manifest;
  };
  const [am,bm]=await Promise.all([getManifest(a,'a'),getManifest(b,'b')]);
  const bFrames=frames+edgeFrames;
  const bDuration=bFrames/sr*plan.rate+(plan.rate===1?0:.35);
  const aMaster=await sliceSceneSource(ctx,cache,nativeSegments(a),plan.start,plan.duration,signal);
  const incoming={master:await sliceSceneSource(ctx,cache,nativeSegments(b),plan.window.start,bDuration,signal)} as AudioBySide['b'];
  const stems:AudioBySide={a:{},b:{}};
  for(const role of STEM_ROLES){
    stems.a[role]=await sliceSceneSource(ctx,cache,am.stems[role]!.segments,plan.start,plan.duration,signal);
    incoming[role]=await sliceSceneSource(ctx,cache,bm.stems[role]!.segments,plan.window.start,bDuration,signal);
  }
  stems.b=await stretchSceneInputs(incoming,ctx,plan.rate,bFrames,signal);
  const body=await cache.load(plan.asset,signal);
  const segment=nativeSegments(b).find(s=>s.asset.url===plan.asset.url)!;
  const bodyFrame=Math.round((plan.window.end-segment.start)*sr);
  if(body.sampleRate!==sr||body.numberOfChannels!==2||body.length<bodyFrame+edgeFrames)
    throw Error('B 原曲未覆盖人声交接边界');

  let peak=0, lowest=Infinity, power=0, count=0;
  for(let i=0;i<bFrames;i++){
    const t=Math.min(plan.duration,i/sr), entry=Math.min(1,i/(LYRIC_EDGE*sr));
    const exit=Math.max(0,1-Math.max(0,i-frames)/(LYRIC_EDGE*sr));
    const gains=STEM_ROLES.map(role=>({a:valueAt(recipe.timeline.a[role],t),b:valueAt(recipe.timeline.b[role],t)}));
    for(let ch=0;ch<2;ch++){
      let sample=i<frames?aMaster.getChannelData(ch)[i]*(1-entry):body.getChannelData(ch)[bodyFrame+i-frames]*(1-exit);
      for(let j=0;j<STEM_ROLES.length;j++){
        const role=STEM_ROLES[j];
        if(i<frames)sample+=stems.a[role].getChannelData(ch)[i]*gains[j].a*entry*recipe.sourceGains.a;
        sample+=stems.b[role].getChannelData(ch)[i]*gains[j].b*exit*recipe.sourceGains.b;
      }
      sample*=recipe.outputGain;
      peak=Math.max(peak,Math.abs(sample));
      if(i<frames){power+=sample*sample;count++;}
    }
    if(i<frames&&(i+1)%2205===0){lowest=Math.min(lowest,10*Math.log10(Math.max(1e-12,power/count)));power=0;count=0;}
  }
  if(!Number.isFinite(peak)||peak>.95||lowest< -55)throw Error('手机实际重叠超出峰值或连续性门槛');
  signal.throwIfAborted();
  return {stems,body,peak};
}

export function scheduleLyricStems(ctx:AudioContext,deck:Deck,audio:LyricPairAudio,recipe:LyricPair,start:number) {
  const end=start+recipe.duration;
  for(const side of ['a','b'] as const){
    const edge=ctx.createGain();
    edge.connect(deck.nodes[0]);
    deck.nodes.push(edge);
    edge.gain.setValueAtTime(side==='a'?0:1,start);
    if(side==='a')edge.gain.linearRampToValueAtTime(1,start+LYRIC_EDGE);
    else{edge.gain.setValueAtTime(1,end);edge.gain.linearRampToValueAtTime(0,end+LYRIC_EDGE);}
    let remaining=STEM_ROLES.length;
    for(const role of STEM_ROLES){
      const node=ctx.createBufferSource(), gain=ctx.createGain();
      deck.sources.push(node);deck.nodes.push(gain);
      node.buffer=audio.stems[side][role];
      node.connect(gain).connect(edge);
      const points=recipe.timeline[side][role];
      gain.gain.setValueAtTime(points[0][1]*recipe.sourceGains[side],start);
      for(const [t,v] of points.slice(1))gain.gain.linearRampToValueAtTime(v*recipe.sourceGains[side],start+t);
      node.onended=()=>{
        node.disconnect();gain.disconnect();node.buffer=null;
        deck.sources=deck.sources.filter(item=>item!==node);
        deck.nodes=deck.nodes.filter(item=>item!==gain);
        if(--remaining===0){edge.disconnect();deck.nodes=deck.nodes.filter(item=>item!==edge);}
      };
      node.start(start,0,recipe.duration+(side==='b'?LYRIC_EDGE:0));
    }
  }
}
