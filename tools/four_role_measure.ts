import fs from 'node:fs'
import {measureStemCompatibility} from '../vendor/realtime-v3/src/mobile/stem-compatibility'
import {measureIntervals} from './four_role_intervals'
const job=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),roles=['drums','bass','other','vocals'],sources=Object.keys(job.files),n=job.frames,sr=44100
const pcm=(path?:string)=>{const raw=path?fs.readFileSync(path):null,x=raw?new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)):new Float32Array(n*2);if(x.length!==n*2)throw Error('frame coverage');const c=[new Float32Array(n),new Float32Array(n)];for(let i=0;i<n;i++){c[0][i]=x[i*2];c[1][i]=x[i*2+1]}return{length:n,sampleRate:sr,numberOfChannels:2,getChannelData:(i:number)=>c[i]}}
if(!job.curves)throw Error('Raw aligned inputs require actual gain curves')
const zero=pcm(),audio=Object.fromEntries(sources.map(s=>[s,Object.fromEntries(roles.map(r=>[r,job.files[s][r]?pcm(job.files[s][r]):zero]))])),curves=(s:string)=>Object.fromEntries(roles.map(r=>[r,job.curves[s]?.[r]??[[0,0],[n/sr,0]]]))
const results:Record<string,unknown>={}
for(let i=0;i<sources.length;i++)for(let j=i+1;j<sources.length;j++){
 const result=measureStemCompatibility({a:audio[sources[i]],b:audio[sources[j]]}as any,{duration:n/sr,a:curves(sources[i]),b:curves(sources[j])}as any,job.bpm)
 const harmonicIntervals=measureIntervals(audio[sources[i]],audio[sources[j]],curves(sources[i]),curves(sources[j]),n/sr,job.bpm)
 results[sources[i].toUpperCase()+'/'+sources[j].toUpperCase()]={...result,pass_:result.pass,harmonicIntervals}
}
fs.writeFileSync(job.result,JSON.stringify(results))
