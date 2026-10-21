/** Fixed Jetson-only CLI. stdout is a public decision, never PCM or NAS paths. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {webcrypto} from 'node:crypto'
import {analyseJetsonInput} from '../vendor/realtime-v3/src/mobile/jetson-analysis'
if(!globalThis.crypto)Object.defineProperty(globalThis,'crypto',{value:webcrypto})
const raw=readFileSync(0);if(raw.length>32*1024*1024)throw Error('Analysis input too large')
const args=process.argv.slice(2);if(args.length&&!(args.length===2&&args[0]==='--audition-output'))throw Error('Invalid fixed CLI arguments')
const input=JSON.parse(raw.toString('utf8'))
const result=await analyseJetsonInput(input,file=>{
 const bytes=readFileSync(file);if(bytes.length>96*1024*1024||bytes.length%8)throw Error('Invalid PCM byte count')
 const x=new Float32Array(bytes.length/4);for(let i=0;i<x.length;i++)x[i]=bytes.readFloatLE(i*4);return x
})
if(args.length){
 const root=resolve(args[1]),out=join(root,input.jobId);mkdirSync(out,{recursive:true,mode:0o755})
 if(!result.group.skip)for(const [name,wave] of Object.entries(result.waves))writeFileSync(join(out,name),wave.bytes,{mode:0o644})
 writeFileSync(join(out,'group.json'),JSON.stringify(result.group,null,2),{mode:0o644})
 writeFileSync(join(out,'decision.json'),JSON.stringify(result.result,null,2),{mode:0o644})
}
process.stdout.write(JSON.stringify(result.result))
