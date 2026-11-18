import {MATERIAL_INDEX_SHA} from './material-pin'
import {validateBridge,type BridgeMaterial} from '../crossgenre/bridge'
export class MaterialCatalog{
 readonly sha256=MATERIAL_INDEX_SHA;materials:BridgeMaterial[]=[];reason='鼓素材尚未载入';private pending:Promise<void>|null=null
 constructor(private base:URL){}
 async load(signal?:AbortSignal){
  if(this.materials.length)return
  if(!this.pending)this.pending=(async()=>{
   const response=await fetch(new URL('transition-materials/index.json',this.base),{signal,cache:'force-cache'});if(!response.ok)throw Error('鼓素材清单尚未发布')
   const raw=await response.arrayBuffer();if(raw.byteLength>128*1024)throw Error('鼓素材目录超出预算')
   const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw))).map(v=>v.toString(16).padStart(2,'0')).join('');if(sha!==MATERIAL_INDEX_SHA)throw Error('鼓素材清单版本不一致')
   const value=JSON.parse(new TextDecoder().decode(raw));if(value.schema!=='harbeat.transition-library.v1'||!Array.isArray(value.materials)||value.materials.length>16)throw Error('鼓素材清单不完整')
   for(const m of value.materials){validateBridge(m);if(!/^[a-z0-9-]+\.wav$/.test(m.asset.url)||!Number.isInteger(m.asset.bytes)||m.asset.bytes<1||m.asset.bytes>8*1024*1024)throw Error('鼓素材地址或字节数无效')}
   this.materials=value.materials;this.reason='实验素材待真人评分'
  })().catch(e=>{this.reason=(e as Error).message;throw e}).finally(()=>{this.pending=null})
  return this.pending
 }
 asset(m:BridgeMaterial){const original=this.materials.find(v=>v.asset.sha256===m.asset.sha256);if(!original||JSON.stringify(original)!==JSON.stringify(m))throw Error('鼓素材未在当前固定目录中');return{url:new URL('transition-materials/'+m.asset.url,this.base).href,sha256:m.asset.sha256,bytes:(m.asset as any).bytes as number,duration:m.asset.frames/m.asset.sampleRate}}
}
