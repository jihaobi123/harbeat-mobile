// Single-thread core is bundled locally; no network or SharedArrayBuffer needed.
importScripts('device-tempo/ffmpeg-core.js');
const coreURL=new URL('device-tempo/ffmpeg-core.js',self.location.href).href;
const core=createFFmpegCore({mainScriptUrlOrBlob:coreURL+'#'+btoa(JSON.stringify({wasmURL:coreURL.replace(/\.js$/,'.wasm')}))});
let chain=Promise.resolve();
self.onmessage=({data})=>{chain=chain.then(async()=>{
 const f=await core;
 try{
  f.FS.writeFile('source.f32',new Uint8Array(data.pcm));
  f.setTimeout(20000);f.exec('-nostdin','-v','error','-f','f32le','-ar',String(data.sampleRate),'-ac','2','-i','source.f32','-af',`atempo=${data.rate.toFixed(9)},apad=whole_len=${data.frames},atrim=end_sample=${data.frames}`,'-f','f32le','-y','entry.f32');
  if(f.ret!==0)throw Error('端侧变速未完成：'+f.ret);
  const bytes=f.FS.readFile('entry.f32');const output=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  if(output.byteLength!==data.frames*8)throw Error('端侧变速时长不一致');
  self.postMessage({id:data.id,output},[output]);
 }catch(e){self.postMessage({id:data.id,error:String(e)});}
 finally{for(const n of ['source.f32','entry.f32'])try{f.FS.unlink(n)}catch{}f.reset();}
 }).catch(e=>self.postMessage({id:data.id,error:String(e)}));};
