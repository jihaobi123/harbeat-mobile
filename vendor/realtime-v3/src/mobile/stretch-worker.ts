import {jointStretch} from './joint-stretch'
const scope=self as unknown as {onmessage:((e:MessageEvent)=>void)|null;postMessage:(message:unknown,transfer?:Transferable[])=>void}
scope.onmessage=({data})=>{try{const output=jointStretch(data.input,data.sampleRate,data.rate,data.frames);scope.postMessage({output},Object.values(output).map(x=>x.buffer))}catch(e){scope.postMessage({error:(e as Error).message})}}
