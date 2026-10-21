import {sourceChroma,chromaDifference} from './source-features'
const scope=self as unknown as {onmessage:((event:MessageEvent)=>void)|null;postMessage:(message:unknown)=>void}
scope.onmessage=({data})=>{try{const profiles=Object.fromEntries(Object.entries(data.mono as Record<string,Float32Array>).map(([key,x])=>[key,sourceChroma(x,data.sampleRate)]));scope.postMessage({difference:{bass:chromaDifference(profiles.aBass,profiles.bBass),other:chromaDifference(profiles.aOther,profiles.bOther)}})}catch(e){scope.postMessage({error:String(e)})}}
