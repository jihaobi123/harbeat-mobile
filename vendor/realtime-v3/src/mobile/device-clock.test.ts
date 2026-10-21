import {it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
it('reports fresh five second output windows so old peaks cannot conceal a later silent deck',()=>{
 let Processor:any;const messages:any[]=[];const sandbox:any={sampleRate:8000,currentFrame:0,Float32Array,Float64Array,Math,AudioWorkletProcessor:class{port={onmessage:null,postMessage:(v:any)=>messages.push(v)}},registerProcessor:(_name:string,p:any)=>{Processor=p}}
 vm.runInNewContext(readFileSync(new URL('../../public/v3-device-clock.js',import.meta.url),'utf8'),sandbox)
 const processor=new Processor()
 for(let block=0;block<939;block++){const input=new Float32Array(128).fill(block<313?.25:0);sandbox.currentFrame=block*128;processor.process([[input,input]],[[new Float32Array(128),new Float32Array(128)]])}
 const windows=messages.filter(m=>m.kind==='audio_health')
 expect(windows).toHaveLength(3);expect(windows[0].rms).toBeGreaterThan(.24)
 expect(windows[2].peak).toBe(0);expect(windows[2].rms).toBe(0)
})
