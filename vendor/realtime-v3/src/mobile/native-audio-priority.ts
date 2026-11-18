/** The APK transport owns its HTTP connections even after a JS fetch aborts.
 * Tag validated local audio requests so Native can reserve playback capacity.
 * This changes headers only; source URLs, hashes and cache identities stay intact. */
export function nativeAudioPriorityFetch(base:URL,foreground:(url:URL)=>boolean,transport:typeof fetch):typeof fetch{
 return (input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input),base)
  const audio=/^\/(?:api\/analysis-lab\/media\/[a-f0-9]{64}|dance-assets\/[a-f0-9]{64}\.flac|listen\/(?:execution-media\/[a-f0-9]{64}\.(?:flac|wav)|(?:catalog\/[A-Za-z0-9_-]+\/)?media\/[A-Za-z0-9_.-]+\.(?:flac|wav)|smart-media\/[a-f0-9]{64}\/(?:original|bass|filter|yield|vocal|bass_filter)\.wav)|analysis-lab-static\/(?:v3-live-baseline-20260922|v31-candidate-20260923|vocal-overlap-corpus-20260924)\/media\/[A-Za-z0-9_.-]+\.flac)$/.test(url.pathname)
  if(base.origin!=='https://appassets.androidplatform.net'||url.origin!==base.origin||!audio||!/^[a-f0-9]{64}$/.test(url.searchParams.get('sha256')??''))return transport(input,init)
  const headers=new Headers(input instanceof Request?input.headers:undefined)
  if(init?.headers)new Headers(init.headers).forEach((value,key)=>headers.set(key,value))
  headers.set('X-HarBeat-Audio-Purpose',foreground(url)?'playback':'prepare')
  return transport(input,{...init,headers})
 }
}
