import {canonicalJson} from '../jetson-contract'
export type BridgeMaterial={schema:'harbeat.transition-material.v1';id:string;trackId:string;runId:string;masterSha256:string;reportSha256:string;stemSha256:string;profileSha256:string;asset:{sha256:string;url:string;frames:number;sampleRate:44100;channels:2};startFrame:number;endFrame:number;bpm:number;meter:[4,4];beats:number;accents:number[];rateRange:[number,number];edgeMs:number;peak:number;review:{status:'pending'|'approved'|'rejected';reviewer?:string;at?:string;fingerprint?:string;notes?:string}}
const hash=/^[a-f0-9]{64}$/,finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)
export function validateBridge(m:BridgeMaterial){
 if(m?.schema!=='harbeat.transition-material.v1'||![m.id,m.trackId,m.runId].every(s=>typeof s==='string'&&s.length>0&&s.length<160)||![m.masterSha256,m.reportSha256,m.stemSha256,m.profileSha256,m.asset?.sha256].every(h=>hash.test(h))||!Number.isInteger(m.startFrame)||m.startFrame<0||!Number.isInteger(m.endFrame)||m.endFrame<=m.startFrame||m.asset.frames!==m.endFrame-m.startFrame||m.asset.sampleRate!==44100||m.asset.channels!==2||!finite(m.bpm)||m.bpm<40||m.bpm>240||JSON.stringify(m.meter)!=='[4,4]'||!Number.isInteger(m.beats)||m.beats<4||m.beats>32||m.beats%4||Math.abs(m.asset.frames/44100-m.beats*60/m.bpm)>1/44100||m.accents?.length!==m.beats||!m.accents.every(v=>finite(v)&&v>=0&&v<=1)||!Array.isArray(m.rateRange)||m.rateRange.length!==2||!m.rateRange.every(finite)||m.rateRange[0]<.8||m.rateRange[0]>1||m.rateRange[1]<1||m.rateRange[1]>1.2||!finite(m.edgeMs)||m.edgeMs<2||m.edgeMs>10||!finite(m.peak)||m.peak<=0||m.peak>=1||!['pending','approved','rejected'].includes(m.review?.status))throw Error('Invalid source-bound percussion material')
 return m
}
export async function bridgeFingerprint(m:BridgeMaterial){validateBridge(m);const {review:_,...content}=m;return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJson(content))))).map(x=>x.toString(16).padStart(2,'0')).join('')}
export async function bridgeEligible(m:BridgeMaterial){validateBridge(m);return m.review.status==='approved'&&!!m.review.reviewer&&!!m.review.at&&m.review.fingerprint===await bridgeFingerprint(m)}
export type LoopRamp={schema:'harbeat.loop-ramp.v1';scope:'audition-only';materialId:string;assetSha256:string;loops:number;beats:number;duration:number;bpmFrom:number;bpmTo:number;sourceBpm:number;rateFrom:number;rateTo:number;pitch:'changes-with-percussion-rate';edgeMs:number}
/** Linear BPM in output time; the integral ends at an exact finite beat count. */
export function planLoopRamp(m:BridgeMaterial,from:number,to:number,loops:number):LoopRamp{
 validateBridge(m);if(![from,to].every(finite)||!Number.isInteger(loops)||loops<1||loops>4||[from/m.bpm,to/m.bpm].some(r=>r<m.rateRange[0]||r>m.rateRange[1]))throw Error('Loop ramp outside verified range')
 const beats=m.beats*loops,duration=beats*120/(from+to);if(duration>32)throw Error('Loop ramp exceeds finite duration budget')
 return{schema:'harbeat.loop-ramp.v1',scope:'audition-only',materialId:m.id,assetSha256:m.asset.sha256,loops,beats,duration,bpmFrom:from,bpmTo:to,sourceBpm:m.bpm,rateFrom:from/m.bpm,rateTo:to/m.bpm,pitch:'changes-with-percussion-rate',edgeMs:m.edgeMs}
}
export function sourceBeatAt(p:LoopRamp,t:number){t=Math.max(0,Math.min(p.duration,t));return p.bpmFrom*t/60+(p.bpmTo-p.bpmFrom)*t*t/(120*p.duration)}
export function halfDoubleMapping(a:number,b:number,e:{reviewed:boolean;pairs:[number,number][]}){
 if(!e.reviewed||!finite(a)||!finite(b)||a<=0||b<=0||e.pairs.length<2||!e.pairs.every(p=>p.length===2&&p.every(finite)))return null
 const factor=([.5,2] as const).find(f=>Math.abs(a/(b*f)-1)<=.05);if(!factor)return null
 const offset=e.pairs[0][1]-e.pairs[0][0]/factor
 if(!e.pairs.every(([x,y])=>Math.abs(y-(offset+x/factor))<1e-6)||new Set(e.pairs.map(p=>p[0])).size<2)return null
 return{factor,rate:a/(b*factor),aBeatToBBeat:(n:number)=>offset+n/factor,basis:'human-reviewed accent pairs; BPM ratio alone is insufficient'}
}
/** Finite experimental drum-only ramp; callers must enforce explicit authorization. */
export function scheduleLoopRamp(ctx:BaseAudioContext,target:AudioNode,buffer:AudioBuffer,m:BridgeMaterial,p:LoopRamp,at:number){
 validateBridge(m);const expected=planLoopRamp(m,p.bpmFrom,p.bpmTo,p.loops)
 if(canonicalJson(p)!==canonicalJson(expected)||buffer.sampleRate!==m.asset.sampleRate||buffer.length!==m.asset.frames||buffer.numberOfChannels!==2||at<ctx.currentTime)throw Error('Loop audio or schedule identity mismatch')
 const loop=ctx.createBuffer(2,buffer.length,buffer.sampleRate),edgeFrames=Math.round(m.edgeMs*buffer.sampleRate/1000)
 for(let c=0;c<2;c++){const data=loop.getChannelData(c);data.set(buffer.getChannelData(c));for(let i=0;i<edgeFrames;i++){data[i]*=i/edgeFrames;data[data.length-1-i]*=i/edgeFrames}}
 const src=ctx.createBufferSource(),gain=ctx.createGain();src.buffer=loop;src.loop=true;src.loopStart=0;src.loopEnd=loop.duration;src.playbackRate.setValueAtTime(p.rateFrom,at);src.playbackRate.linearRampToValueAtTime(p.rateTo,at+p.duration)
 src.connect(gain);gain.connect(target);const edge=m.edgeMs/1000;gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.60,at+edge);gain.gain.setValueAtTime(.60,at+p.duration-edge);gain.gain.linearRampToValueAtTime(0,at+p.duration);src.start(at);src.stop(at+p.duration)
 let ended=false;const dispose=()=>{if(ended)return;ended=true;try{src.stop()}catch{};src.disconnect();gain.disconnect()};src.onended=dispose
 return{end:at+p.duration,cancel:()=>{if(ended)return;const now=ctx.currentTime;gain.gain.cancelAndHoldAtTime(now);gain.gain.linearRampToValueAtTime(0,now+.005);try{src.stop(now+.005)}catch{}},dispose}
}
