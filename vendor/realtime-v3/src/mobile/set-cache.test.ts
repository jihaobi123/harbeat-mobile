import {expect,it} from 'vitest'
import {webcrypto} from 'node:crypto'
import {cacheActivityAssets} from './set-cache'
const bytes=new Uint8Array([1,2,3]).buffer
const sha=Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('')
const asset={url:'/listen/media/a.flac',bytes:3,duration:1,sha256:sha}
function deps(){const saved=new Map<string,ArrayBuffer>();return{saved,remove:async(k:string)=>{saved.delete(k)},read:async(k:string)=>saved.get(k)??null,write:async(k:string,b:ArrayBuffer)=>{saved.set(k,b)},fetch:async()=>new Response(bytes),digest:async(b:ArrayBuffer)=>Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('')}}
it('verifies encoded bytes without decoding PCM and reports actual cache retention',async()=>{const d=deps(),r=await cacheActivityAssets([asset],new URL('https://a.test/listen/'),new AbortController().signal,()=>{},d);expect(r.completed).toBe(1);expect(r.state).toBe('ready');expect([...d.saved.keys()][0]).toContain('?sha256=')})
it('does not count corrupt or quota-rejected downloads as locally ready',async()=>{for(const d of [{...deps(),fetch:async()=>new Response(new Uint8Array([9]))},{...deps(),write:async()=>{}}]){const r=await cacheActivityAssets([asset],new URL('https://a.test/listen/'),new AbortController().signal,()=>{},d);expect(r.completed).toBe(0);expect(r.state).toBe('partial')}})
it('bounds reservation cache usage and disallows arbitrary origins',async()=>{const r=await cacheActivityAssets([{...asset,bytes:300*1024*1024}],new URL('https://a.test/listen/'),new AbortController().signal,()=>{},deps());expect(r.completed).toBe(0);await expect(cacheActivityAssets([{...asset,url:'https://evil.test/a'}],new URL('https://a.test/listen/'),new AbortController().signal,()=>{},deps())).rejects.toThrow()})

it('repairs corrupt bytes even when cache writes never overwrite existing keys',async()=>{const d=deps(),key='https://a.test/listen/media/a.flac?sha256='+sha;d.saved.set(key,new Uint8Array([9]).buffer);const write=d.write;d.write=async(k,b)=>{if(!d.saved.has(k))await write(k,b)};const r=await cacheActivityAssets([asset],new URL('https://a.test/listen/'),new AbortController().signal,()=>{},d);expect(r.state).toBe('ready')})

it('reports partial rather than ready when the device available-space budget cannot hold the requested set',async()=>{
 const d={...deps(),limit:async()=>3},r=await cacheActivityAssets([asset,{...asset,url:'/listen/media/b.flac'}],new URL('https://a.test/listen/'),new AbortController().signal,()=>{},d)
 expect(r.state).toBe('partial');expect(r.completed).toBe(1);expect(r.total).toBe(2)
})
