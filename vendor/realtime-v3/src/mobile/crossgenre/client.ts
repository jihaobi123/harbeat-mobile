import type {Track} from '../../listen-upstream/realtime/planner'
import {validateIndex,validateProfile,sourceMatches,type CrossIndex,type CrossProfile} from './contract'

/** Only descriptors advertised by the trusted static index authorize sidecars. */
export class CrossGenreClient{
 readonly index:CrossIndex|null
 private profiles=new Map<string,CrossProfile>()
 constructor(private base:URL,index:CrossIndex|null,private read:typeof fetch=fetch){this.index=index?validateIndex(index):null}
 get entryIds(){return new Set(this.index?.tracks.filter(t=>t.entryCount>0).map(t=>t.trackId)??[])}
 canExit(id:string){return !!this.index?.tracks.some(t=>t.trackId===id&&t.exitCount>0)}
 async load(track:Track,signal:AbortSignal):Promise<CrossProfile>{
  signal.throwIfAborted()
  const row=this.index?.tracks.find(t=>t.trackId===track.id)
  if(!row)throw Error('这首歌尚未完成跨风格预处理')
  if(!sourceMatches(track,row.source))throw Error('跨风格资料与当前歌曲来源不一致')
  const key=row.profile.sha256,hit=this.profiles.get(key)
  if(hit)return validateProfile(hit,track,row.source)
  const controller=new AbortController(),abort=()=>controller.abort(signal.reason)
  signal.addEventListener('abort',abort,{once:true})
  const timeout=setTimeout(()=>controller.abort(new DOMException('跨风格资料读取超时','TimeoutError')),15000)
  let bytes:ArrayBuffer
  try{
   const response=await this.read(new URL(row.profile.url,this.base),{signal:controller.signal,cache:'force-cache',credentials:'same-origin',redirect:'error'})
  if(!response.ok)throw Error('跨风格资料读取失败 '+response.status)
  // Descriptors are <=512KiB; reject advertised oversized bodies before reading.
  const declared=response.headers.get('Content-Length')
  if(declared!==null&&Number(declared)!==row.profile.bytes)throw Error('跨风格资料字节校验失败')
  const reader=response.body?.getReader()
  if(!reader)throw Error('跨风格资料缺少可校验的数据流')
  const chunks:Uint8Array[]=[];let length=0
  for(;;){
   signal.throwIfAborted();const {done,value}=await reader.read();if(done)break
   length+=value.byteLength
   if(length>row.profile.bytes){await reader.cancel();throw Error('跨风格资料字节超出预算')}
   chunks.push(value)
  }
  const joined=new Uint8Array(length);let offset=0
  for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length}
  bytes=joined.buffer;signal.throwIfAborted()
  if(bytes.byteLength!==row.profile.bytes)throw Error('跨风格资料字节校验失败')
  }finally{clearTimeout(timeout);signal.removeEventListener('abort',abort)}
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('')
  if(digest!==key)throw Error('跨风格资料内容校验失败')
  const profile=validateProfile(JSON.parse(new TextDecoder().decode(bytes)),track,row.source)
  if(profile.entries.length!==row.entryCount||profile.exits.length!==row.exitCount||profile.exits.filter(x=>x.echoEligible).length!==row.echoExitCount)throw Error('跨风格索引与接点数量不一致')
  signal.throwIfAborted();this.profiles.set(key,profile)
  while(this.profiles.size>24)this.profiles.delete(this.profiles.keys().next().value!)
  return profile
 }
}
