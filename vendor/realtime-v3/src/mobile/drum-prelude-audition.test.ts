import {afterEach,expect,it,vi} from 'vitest'
import {verifyDrumPreludeProof,saveAuditionChoice,validateDrumPreparedAssets,validateDrumTakeoverAsset,loadDrumAuditionPCM} from './drum-prelude-audition'
import {canonicalDrumPreludeProof} from './device-execution'
afterEach(()=>vi.unstubAllGlobals())
it('checks the Jetson approval proof before a listening experiment can run',async()=>{
 const approval:any={schema:'harbeat.drum-prelude.v1',scope:'audition-only',authority:'jetson',approved:true,planId:'a'.repeat(64),basis:{proxy:'measured'},checks:{drumCompatible:true}}
 const bytes=new TextEncoder().encode(canonicalDrumPreludeProof(approval))
 approval.proofSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('')
 await expect(verifyDrumPreludeProof(approval)).resolves.toBeUndefined()
 await expect(verifyDrumPreludeProof({...approval,basis:{proxy:'changed'}})).rejects.toThrow('证明')
})
it('stores a preference before any audio is played, with the blinded version mapping',()=>{
 const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v)}}
 const ratings=saveAuditionChoice(storage,'test','group-01',{order:['single','original','combined'],choice:'02',issues:['drums-dense']})
 expect(ratings.groups['group-01'].choice).toBe('02');expect(ratings.groups['group-01'].order[1]).toBe('original')
 expect(JSON.parse(values.get('test')!).groups['group-01'].issues).toEqual(['drums-dense'])
})
it('binds every prepared PCM identity to the approval while allowing deployment URL changes',()=>{
 const asset={sha256:'a'.repeat(64),bytes:100,duration:14},approval:any={preparedAssets:{a:{master:asset},b:{master:asset,drums:asset}}},pcm:any={a:{master:{...asset,url:'./new/a.wav'}},b:{master:{...asset,url:'./new/b.wav'},drums:{...asset,url:'./new/drums.wav'}}}
 expect(()=>validateDrumPreparedAssets(approval,pcm)).not.toThrow()
 for(const mutate of [(p:any)=>p.b.drums.sha256='b'.repeat(64),(p:any)=>p.b.drums.bytes=101,(p:any)=>p.b.drums.duration=13,(p:any)=>delete p.a.master,(p:any)=>p.a.vocals={...asset,url:'./extra.wav'}]){const changed=structuredClone(pcm);mutate(changed);expect(()=>validateDrumPreparedAssets(approval,changed)).toThrow('证明')}
})
it('requires the native B body at the frozen endpoint and binds it separately from the overlapped stems',()=>{
 const body={sha256:'a'.repeat(64),bytes:100,duration:8,url:'./b-body.wav'},approval:any={sourceWindow:{effectiveBEnd:28,bEnd:28.008},takeoverAsset:{...body,sourceStart:28}}
 expect(()=>validateDrumTakeoverAsset(approval,body)).not.toThrow()
 for(const bad of [{...body,sha256:'b'.repeat(64)},{...body,bytes:101},{...body,duration:7},undefined])expect(()=>validateDrumTakeoverAsset(approval,bad as any)).toThrow()
 expect(()=>validateDrumTakeoverAsset({...approval,takeoverAsset:{...approval.takeoverAsset,sourceStart:27}},body)).toThrow()
})
it('loads and verifies the native body after bounded source windows, refusing a substituted body file',async()=>{
 const marker=(n:number)=>new Uint8Array([n]),digest=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer))).map(n=>n.toString(16).padStart(2,'0')).join('')
 const asset=async(id:number,duration:number)=>({url:`./${id}.wav`,sha256:await digest(marker(id)),bytes:1,duration})
 const am=await asset(1,14),bm=await asset(2,14.008),drums=await asset(3,14.008),body=await asset(4,8),sourceFingerprints={a:{id:'a'},b:{id:'b'}},h='a'.repeat(64)
 const approval:any={schema:'harbeat.drum-prelude.v1',scope:'audition-only',authority:'jetson',approved:true,planId:h,sourceFingerprints,preparedAssets:{a:{master:am},b:{master:bm,drums}},takeoverAsset:{...body,sourceStart:28},leadSeconds:6,fadeInSeconds:2,holdSeconds:4,maxGain:.25,sourceWindow:{aStart:34,aEnd:48,bStart:14,bEnd:28,rate:1},checks:{sourceAligned:true,beatAligned:true,vocalSafe:true,drumCompatible:true,headroomSafe:true}}
 approval.proofSha256=await digest(new TextEncoder().encode(canonicalDrumPreludeProof(approval)))
 const group:any={id:'fixture',approval,body,pcm:{a:{master:am},b:{master:bm,drums}},result:{id:h,execution:{sourceFingerprints,plan:{start:40,end:48,duration:8,rate:1,restore:46,window:{start:20,end:28}},controls:{duration:8,lastBarStart:4,bassTiming:{duckStart:0,swapStart:3,swapEnd:4}}}}}
 const durations=[0,14,14.008,14.008,8],ctx={decodeAudioData:async(bytes:ArrayBuffer)=>{const duration=durations[new Uint8Array(bytes)[0]];return{duration,length:Math.round(duration*44100),sampleRate:44100,numberOfChannels:2}}} as unknown as AudioContext
 const fetcher=vi.fn(async(url:URL)=>new Response(marker(Number(url.pathname.split('/').pop()!.split('.')[0]))));vi.stubGlobal('fetch',fetcher)
 const pcm=await loadDrumAuditionPCM(ctx,group,new URL('https://example.test/audition/manifest.json'),new AbortController().signal)
 expect(pcm.body.duration).toBe(8);expect(fetcher).toHaveBeenCalledTimes(4)
 vi.stubGlobal('fetch',vi.fn(async(url:URL)=>new Response(marker(url.pathname.endsWith('/4.wav')?9:Number(url.pathname.split('/').pop()!.split('.')[0])))))
 await expect(loadDrumAuditionPCM(ctx,group,new URL('https://example.test/audition/manifest.json'),new AbortController().signal)).rejects.toThrow('指纹')
})
