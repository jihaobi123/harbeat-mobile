import type {Asset} from '../metric-upstream/realtime/planner'
import {readEncoded,storeEncoded,deleteEncoded} from '../metric-upstream/realtime/encodedCache'
export type SetCacheProgress={completed:number;total:number;bytes:number;message:string;state:'downloading'|'ready'|'partial'}
const fingerprint=async(b:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(n=>n.toString(16).padStart(2,'0')).join('')
const defaults={read:readEncoded,write:storeEncoded,remove:deleteEncoded,fetch:(u:URL,o:RequestInit)=>fetch(u,o),digest:fingerprint}
/** Persist encoded audio only; decoding a whole set would exceed phone memory. */
export async function cacheActivityAssets(assets:Asset[],base:URL,signal:AbortSignal,changed:(p:SetCacheProgress)=>void,io=defaults){
 if(io===defaults&&typeof caches==='undefined')throw Error('当前设备无法保存本机缓存，播放时仍可联网读取')
 const limit=256*1024*1024,files=assets.map(asset=>{const u=new URL(asset.url,base);if(u.origin!==base.origin||!/^\/listen\/(?:(?:catalog\/[A-Za-z0-9_-]+\/)?media\/[A-Za-z0-9_.-]+\.(?:flac|wav)|execution-media\/[a-f0-9]{64}\.(?:flac|wav)|set-media\/[a-f0-9]{32}\/[a-f0-9]{64}\/(?:original|bass|filter|yield|vocal|bass_filter)\.wav)$/.test(u.pathname)||!/^[a-f0-9]{64}$/.test(asset.sha256)||!(asset.bytes>0)||(u.pathname.includes('/execution-media/')&&!u.pathname.includes('/'+asset.sha256+'.')))throw Error('预约音频地址或身份无效');u.searchParams.set('sha256',asset.sha256);return {asset,url:u}})
 const result:SetCacheProgress={completed:0,total:files.length,bytes:0,message:'正在下载到本机',state:'downloading'}
 const retained:typeof files=[];let budget=0
 for(const file of files){signal.throwIfAborted();const {asset,url}=file;if(asset.bytes>64*1024*1024||budget+asset.bytes>limit)continue;budget+=asset.bytes
  try{let bytes=await io.read(url.href);signal.throwIfAborted();if(bytes&&await io.digest(bytes)!==asset.sha256){await io.remove(url.href);bytes=null}
   signal.throwIfAborted();if(!bytes){const timeout=new AbortController(),abort=()=>timeout.abort(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();const timer=setTimeout(()=>timeout.abort(),90000)
    try{const response=await io.fetch(url,{signal:timeout.signal});if(!response.ok)throw Error('音频下载失败');const reader=response.body?.getReader();if(reader){const chunks:Uint8Array[]=[];let total=0;for(;;){const r=await reader.read();if(r.done)break;total+=r.value.byteLength;if(total>64*1024*1024||total>asset.bytes+65536){await reader.cancel();throw Error('音频大小异常')}chunks.push(r.value)}const joined=new Uint8Array(total);let offset=0;for(const c of chunks){joined.set(c,offset);offset+=c.length}bytes=joined.buffer}else bytes=await response.arrayBuffer()}finally{clearTimeout(timer);signal.removeEventListener('abort',abort)}
    if(bytes.byteLength!==asset.bytes||await io.digest(bytes)!==asset.sha256)throw Error('音频校验失败');signal.throwIfAborted();await io.write(url.href,bytes)
   }
   const check=await io.read(url.href);if(check&&await io.digest(check)===asset.sha256){retained.push(file);result.completed++;result.bytes+=check.byteLength}
  }catch(e){signal.throwIfAborted()}
  result.message=`本机已缓存 ${result.completed}/${result.total} 个片段`;changed({...result})
 }
 // Browser quota and ordinary playback can evict entries during the download.
 result.completed=0;result.bytes=0
 for(const file of retained){signal.throwIfAborted();const bytes=await io.read(file.url.href);if(bytes&&await io.digest(bytes)===file.asset.sha256){result.completed++;result.bytes+=bytes.byteLength}}
 signal.throwIfAborted();result.state=result.completed===result.total?'ready':'partial';result.message=`本机已缓存 ${result.completed}/${result.total} 个片段${result.state==='partial'?'，其余播放时联网读取':''}`;changed({...result});return result
}
