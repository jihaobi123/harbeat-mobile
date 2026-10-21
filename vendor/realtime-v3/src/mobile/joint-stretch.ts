import {Stretch} from '@soundtouchjs/core'

/** SoundTouch WSOLA, with the master's overlap choices reused by every stem.
 * No gains, filters, other track or mixed audio enter this reusable source step.
 * Feeding a padded source interval avoids worklet startup latency and truncated
 * tails. The returned buffers have an exact, declared output sample count. */
export function jointStretch(input:Record<string,Float32Array>,sampleRate:number,rate:number,frames:number){
 if(!input.master||!Number.isFinite(rate)||rate<.95||rate>1.05||!Number.isInteger(frames)||frames<1)throw Error('Invalid source stretch request')
 const length=input.master.length
 if(length%2||Object.values(input).some(x=>x.length!==length))throw Error('Source stems must share the same sample timeline')
 if(Math.abs(rate-1)<1e-10){if(length<frames*2)throw Error('Source interval too short');return Object.fromEntries(Object.entries(input).map(([k,x])=>[k,x.slice(0,frames*2)]))}
 const choices:number[]=[],out:Record<string,Float32Array>={}
 for(const [key,x] of Object.entries(input)){
  const pipe=new Stretch({sampleRate,createBuffers:true});pipe.tempo=rate;pipe.setStretchParameters({sequenceMs:80,seekWindowMs:20,overlapMs:8,quickSeek:false})
  const seek=pipe.seekBestOverlapPosition.bind(pipe);let choice=0
  pipe.seekBestOverlapPosition=buffer=>{
   if(key==='master'){const value=choice++===0?0:seek(buffer);choices.push(value);return value}
   const value=choices[choice++];if(value===undefined)throw Error('Stem WSOLA mapping differs from master');return value
  }
  pipe.inputBuffer!.putSamples(x,0,length/2);pipe.process()
  if(pipe.outputBuffer!.frameCount<frames)throw Error('Padded source does not cover stretched interval')
  const samples=new Float32Array(frames*2);pipe.outputBuffer!.extract(samples,0,frames)
  if(samples.some(v=>!Number.isFinite(v)))throw Error('Non-finite stretched source')
  out[key]=samples;pipe.clear()
 }
 return out
}
