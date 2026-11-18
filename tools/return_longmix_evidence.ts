import fs from 'node:fs'
import {measureReconstruction} from '../vendor/realtime-v3/src/mobile/timeline-audio-evidence'
import {measureStemCompatibility} from '../vendor/realtime-v3/src/mobile/stem-compatibility'
const job=JSON.parse(fs.readFileSync(process.argv[2],'utf8'))
const pcm=(path:string,gain:number)=>{const bytes=fs.readFileSync(path);if(bytes.length%8)throw Error('stereo PCM coverage invalid');const samples=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),channels=[new Float32Array(samples.length/2),new Float32Array(samples.length/2)];for(let i=0;i<channels[0].length;i++){channels[0][i]=samples[i*2]*gain;channels[1][i]=samples[i*2+1]*gain}return{length:channels[0].length,sampleRate:44100,numberOfChannels:2,getChannelData:(i:number)=>channels[i]}}
const audio=Object.fromEntries(['a','b'].map(side=>[side,Object.fromEntries(Object.entries(job.files[side]).map(([role,path])=>[role,pcm(path as string,role==='master'?1:job.sourceGains[side])]))])) as any
const exits=job.timelines.map((timeline:any)=>({at:timeline.duration,reconstruction:measureReconstruction(audio,timeline.duration),compatibility:measureStemCompatibility(audio,timeline,job.bpm)}))
fs.writeFileSync(job.result,JSON.stringify(exits))
