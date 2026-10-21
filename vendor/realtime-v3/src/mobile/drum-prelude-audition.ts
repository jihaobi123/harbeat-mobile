import type {Asset} from '../metric-upstream/realtime/planner'
import type {Method} from '../metric-upstream/metric-mix/types'
import {canonicalDrumPreludeProof,validateDrumPreludeApproval,hasMethod,type DevicePrepared,type DrumPreludeApproval} from './device-execution'
import {scheduleDeviceGraph} from './device-graph'
import type {DevicePCM} from './device-prepare'

const sha=async(bytes:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('')
export async function verifyDrumPreludeProof(value:any){
 if(value?.authority!=='jetson'||value.scope!=='audition-only'||value.approved!==true||!/^[a-f0-9]{64}$/.test(value.proofSha256))throw Error('试听缺少 Jetson 批准证明')
 const {proofSha256,...body}=value
 if(await sha(new TextEncoder().encode(canonicalDrumPreludeProof(body)).buffer)!==proofSha256)throw Error('Jetson 批准证明指纹不一致')
}
type Variant='original'|'single'|'combined'
type Vote={order:Variant[];choice:string|null;issues:string[];updatedAt?:string}
type Ratings={schema:'harbeat.drum-prelude-ratings.v1';groups:Record<string,Vote>}
export function saveAuditionChoice(storage:Pick<Storage,'getItem'|'setItem'>,key:string,id:string,vote:Vote):Ratings{
 if(!id||new Set(vote.order).size!==3||vote.order.some(v=>!['original','single','combined'].includes(v))||vote.choice!==null&&!['01','02','03','same','neither'].includes(vote.choice)||!Array.isArray(vote.issues)||vote.issues.some(v=>typeof v!=='string'))throw Error('试听记录格式不完整')
 let ratings:Ratings={schema:'harbeat.drum-prelude-ratings.v1',groups:{}}
 try{const old=JSON.parse(storage.getItem(key)??'null');if(old?.schema===ratings.schema&&old.groups&&typeof old.groups==='object')ratings=old}catch{}
 ratings.groups[id]={...vote,updatedAt:new Date().toISOString()};storage.setItem(key,JSON.stringify(ratings));return ratings
}
export type DrumAuditionPCM=DevicePCM&{body:AudioBuffer}
export type DrumAuditionGroup={id:string;title:string;skip?:string;result:DevicePrepared;approval:DrumPreludeApproval;singleMethod:Method;pcm:{a:Record<string,Asset>;b:Record<string,Asset>};body:Asset;variantOrder?:Variant[]}
type Manifest={schema:'harbeat.drum-prelude-audition.v1';groups:DrumAuditionGroup[];title?:string;audit?:{attempted:number;approved:number;target:number}}
export function validateDrumPreparedAssets(approval:DrumPreludeApproval,pcm:DrumAuditionGroup['pcm']){
 for(const side of ['a','b'] as const){
  const approved=approval.preparedAssets?.[side],actual=pcm?.[side]
  if(!approved||!actual||Object.keys(approved).sort().join(',')!==Object.keys(actual).sort().join(','))throw Error('试听制备声部与 Jetson 证明不一致')
  for(const [stem,asset] of Object.entries(actual)){const proof=approved[stem];if(!proof||proof.sha256!==asset.sha256||proof.bytes!==asset.bytes||!Number.isFinite(proof.duration)||!Number.isFinite(asset.duration)||Math.abs(proof.duration-asset.duration)>1e-6)throw Error('试听制备文件与 Jetson 证明不一致')}
 }
}
export function validateDrumTakeoverAsset(approval:DrumPreludeApproval,body:Asset){
 const proof=approval.takeoverAsset,end=approval.sourceWindow?.effectiveBEnd??approval.sourceWindow?.bEnd
 if(!proof||!body||proof.sha256!==body.sha256||proof.bytes!==body.bytes||!Number.isFinite(proof.duration)||Math.abs(proof.duration-8)>.002||Math.abs(proof.duration-body.duration)>1e-6||!Number.isFinite(proof.sourceStart)||!Number.isFinite(end)||Math.abs(proof.sourceStart-end)>.002)throw Error('B 正文素材与 Jetson 接管证明不一致')
}
async function assetBytes(asset:Asset,base:URL,signal:AbortSignal){
 const url=new URL(asset.url,base)
 if(url.origin!==base.origin||!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash||!/^.*\.(wav|flac)$/.test(url.pathname)||!/^[a-f0-9]{64}$/.test(asset.sha256)||!Number.isInteger(asset.bytes)||asset.bytes<1||asset.bytes>64*1024*1024||!Number.isFinite(asset.duration)||asset.duration<=0||asset.duration>24.1)throw Error('试听素材地址、身份或时长无效')
 url.searchParams.set('sha256',asset.sha256)
 const response=await fetch(url,{signal});if(!response.ok)throw Error('试听素材未发布 '+response.status)
 let bytes:ArrayBuffer
 if(response.body){const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;try{for(;;){signal.throwIfAborted();const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>asset.bytes)throw Error('试听素材大小超出清单');chunks.push(part.value)}const joined=new Uint8Array(size);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length}bytes=joined.buffer}catch(error){await reader.cancel().catch(()=>{});throw error}}
 else bytes=await response.arrayBuffer()
 signal.throwIfAborted();if(bytes.byteLength!==asset.bytes||await sha(bytes)!==asset.sha256)throw Error('试听素材指纹或字节数不一致');return bytes
}
export async function loadDrumAuditionPCM(ctx:AudioContext,group:DrumAuditionGroup,base:URL,signal:AbortSignal,progress:(message:string)=>void=()=>{}):Promise<DrumAuditionPCM>{
 await verifyDrumPreludeProof(group.approval);signal.throwIfAborted()
 validateDrumPreparedAssets(group.approval,group.pcm)
 validateDrumTakeoverAsset(group.approval,group.body)
 const files=(['a','b'] as const).flatMap(side=>Object.entries(group.pcm[side]).map(([stem,asset])=>({side,stem,asset})))
 if(files.length<3||files.length>10||files.some(f=>!['master','drums','bass','other','vocals'].includes(f.stem)))throw Error('试听声部清单不完整')
 const estimated=files.reduce((sum,f)=>sum+Math.ceil(f.asset.duration*44100)*2*4,Math.ceil(group.body.duration*44100)*2*4)
 if(estimated>96*1024*1024)throw Error('本组延展 PCM 超过 96 MiB，已跳过')
 const pcm:DevicePCM={a:{},b:{}};let bytes=0
 for(const {side,stem,asset} of files){signal.throwIfAborted();progress(`正在准备 ${side.toUpperCase()} · ${stem}`);const encoded=await assetBytes(asset,base,signal);signal.throwIfAborted();const buffer=await ctx.decodeAudioData(encoded);signal.throwIfAborted();if(Math.abs(buffer.duration-asset.duration)>.04)throw Error('试听素材解码时长不一致');bytes+=buffer.length*buffer.numberOfChannels*4;if(bytes>96*1024*1024)throw Error('本组实际 PCM 超过 96 MiB，已跳过');pcm[side][stem]=buffer}
 progress('正在准备 B 原速正文');const encoded=await assetBytes(group.body,base,signal);signal.throwIfAborted();const body=await ctx.decodeAudioData(encoded);signal.throwIfAborted();if(Math.abs(body.duration-group.body.duration)>.04)throw Error('B 正文解码时长不一致')
 const full={...pcm,body};validateDrumPreludeApproval(group.approval,group.result,full);return full
}
export function scheduleDrumPreludeAudition(ctx:AudioContext,target:AudioNode,result:DevicePrepared,method:Method,pcm:DrumAuditionPCM,at:number,approval:DrumPreludeApproval,enabled:boolean){
 validateDrumPreludeApproval(approval,result,pcm)
 if(!hasMethod(result,method))throw Error('该单项没有通过 Jetson 资格检查')
 const graph=scheduleDeviceGraph(ctx,target,result,method,pcm,at+approval.leadSeconds,{prelude:{approval,enabled}})
 const bodyAt=at+approval.leadSeconds+result.execution.plan.duration,source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=pcm.body;source.connect(gain);gain.connect(graph.entry)
 gain.gain.setValueAtTime(0,bodyAt);gain.gain.linearRampToValueAtTime(.60,bodyAt+.008);gain.gain.setValueAtTime(.60,bodyAt+pcm.body.duration-.25);gain.gain.linearRampToValueAtTime(0,bodyAt+pcm.body.duration)
 source.onended=()=>{source.disconnect();gain.disconnect()};source.start(bodyAt,0,pcm.body.duration);graph.nodes.push(source,gain);return graph
}

/** Independent listening surface. Nothing here is imported by MetricRun. */
async function mount(){
 const host=document.querySelector<HTMLDivElement>('#groups'),status=document.querySelector<HTMLElement>('#status');if(!host||!status)return
 const state=(s:string)=>{status.textContent=s}
 try{
  const manifestUrl=new URL('./drum-prelude-audition.json',location.href),response=await fetch(manifestUrl)
  if(!response.ok)throw Error('试听清单尚未准备好')
  const bytes=await response.arrayBuffer();if(bytes.byteLength>4*1024*1024)throw Error('试听清单超过读取范围')
  const manifest=JSON.parse(new TextDecoder().decode(bytes)) as Manifest
  if(manifest.schema!=='harbeat.drum-prelude-audition.v1'||!Array.isArray(manifest.groups)||!manifest.groups.length||manifest.groups.length>12||new Set(manifest.groups.map(g=>g.id)).size!==manifest.groups.length)throw Error('试听清单格式不完整')
  const roundNote=document.querySelector('#round-note'),audit=manifest.audit
  if(roundNote&&audit&&[audit.attempted,audit.approved,audit.target].every(Number.isInteger)&&audit.attempted<=12&&audit.approved===manifest.groups.filter(g=>!g.skip).length)roundNote.textContent=`本轮检查了 ${audit.attempted} 个固定曲对，${audit.approved} 组通过，原定 ${audit.target} 组；其余保持原接点并跳过。新的鼓层仅供试听。`
  const manifestSha256=await sha(bytes),key='harbeat.drum-prelude-ratings.v1:'+manifestSha256
  let ratings:Ratings={schema:'harbeat.drum-prelude-ratings.v1',groups:{}}
  try{const saved=JSON.parse(localStorage.getItem(key)??'null');if(saved?.schema===ratings.schema&&saved.groups&&typeof saved.groups==='object')ratings=saved}catch{}
  let ctx:AudioContext|null=null,bus:GainNode|null=null,controller:AbortController|null=null,loaded:{id:string;pcm:DrumAuditionPCM}|null=null,nodes:AudioNode[]=[],activeButton:HTMLButtonElement|null=null
  const stop=()=>{for(const node of nodes){if('stop'in node)try{(node as AudioBufferSourceNode).stop()}catch{};node.disconnect()}nodes=[];activeButton?.removeAttribute('aria-pressed');activeButton=null}
  const newButton=(label:string,action:()=>void)=>{const button=document.createElement('button');button.textContent=label;button.type='button';button.onclick=action;return button}
  document.querySelector('#stop')?.addEventListener('click',()=>{controller?.abort();stop();state('已停止，可以继续选择。')})
  document.querySelector('#pause')?.addEventListener('click',()=>{if(!ctx)return;const pausing=ctx.state==='running';void(pausing?ctx.suspend():ctx.resume()).then(()=>state(pausing?'已暂停，同一音频时间线已冻结。':'继续播放。')).catch(error=>state((error as Error).message))})
  document.querySelector('#export')?.addEventListener('click',()=>{const output={...ratings,manifestSha256,cases:manifest.groups.map(g=>({id:g.id,title:g.title,singleMethod:g.singleMethod,planId:g.result?.id,proofSha256:g.approval?.proofSha256,skip:g.skip})),exportedAt:new Date().toISOString()},blob=new Blob([JSON.stringify(output,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='drum-prelude-ratings.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)})
  const play=async(group:DrumAuditionGroup,variant:Variant,button:HTMLButtonElement)=>{
   controller?.abort();stop();const own=controller=new AbortController()
   try{
    ctx??=new AudioContext({sampleRate:44100,latencyHint:'interactive'});await ctx.resume()
    if(!bus){bus=ctx.createGain();bus.gain.value=.7;const limiter=ctx.createDynamicsCompressor();limiter.threshold.value=-.5;limiter.knee.value=0;limiter.ratio.value=20;limiter.attack.value=.003;limiter.release.value=.12;bus.connect(limiter);limiter.connect(ctx.destination)}
    if(loaded?.id!==group.id){loaded=null;state('正在读取 Jetson 批准与同源素材…');const pcm=await loadDrumAuditionPCM(ctx,group,manifestUrl,own.signal,state);own.signal.throwIfAborted();loaded={id:group.id,pcm}}
    own.signal.throwIfAborted();await verifyDrumPreludeProof(group.approval);own.signal.throwIfAborted()
    const graph=scheduleDrumPreludeAudition(ctx,bus,group.result,variant==='original'?'original':group.singleMethod,loaded.pcm,ctx.currentTime+.12,group.approval,variant==='combined');nodes=graph.nodes;activeButton=button;button.setAttribute('aria-pressed','true');state(`${group.title} · 正在播放 ${button.dataset.version}，可随时选择或换版本。`)
   }catch(error){if(!own.signal.aborted)state((error as Error).message)}
  }
  for(const group of manifest.groups){
   if(typeof group.id!=='string'||!group.id||group.id.length>128||typeof group.title!=='string')throw Error('试听组标识不完整')
   const section=document.createElement('section'),title=document.createElement('h2');title.textContent=group.title;section.append(title)
   if(group.skip){const note=document.createElement('p');note.textContent='本组已跳过：'+group.skip;section.append(note);host.append(section);continue}
   const validOrder=(order:any):order is Variant[]=>Array.isArray(order)&&order.length===3&&new Set(order).size===3&&order.every(v=>['original','single','combined'].includes(v))
   if(group.variantOrder&&!validOrder(group.variantOrder))throw Error('试听版本映射不完整')
   const previous=ratings.groups[group.id],order=validOrder(previous?.order)?previous.order:group.variantOrder??(['original','single','combined'] as Variant[]).sort(()=>crypto.getRandomValues(new Uint32Array(1))[0]/2**32-.5)
   let vote:Vote={order,choice:previous?.choice??null,issues:previous?.issues??[]}
   const savedText=document.createElement('p');savedText.className='saved';savedText.textContent=vote.choice?'已保存选择':'可先试听任意一版，再随时记录选择。'
   const save=()=>{try{ratings=saveAuditionChoice(localStorage,key,group.id,vote);savedText.textContent=vote.choice||vote.issues.length?'已保存选择与标记':'尚未选择，可随时记录。'}catch(error){savedText.textContent=(error as Error).message}}
   save()
   const players=document.createElement('div');players.className='players'
   for(const [i,variant] of order.entries()){const version=String(i+1).padStart(2,'0'),button=newButton('播放 '+version,()=>{void play(group,variant,button)});button.dataset.version=version;players.append(button)}
   section.append(players)
   const choices=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='哪一版更顺？不用听完就能选择。';choices.append(legend)
   for(const [value,label] of [['01','01 更顺'],['02','02 更顺'],['03','03 更顺'],['same','差不多'],['neither','都不顺']]){const wrapper=document.createElement('label'),input=document.createElement('input');input.type='radio';input.name='choice-'+group.id;input.value=value;input.checked=vote.choice===value;input.onchange=()=>{vote={...vote,choice:value};save()};wrapper.append(input,document.createTextNode(label));choices.append(wrapper)}
   const issues=document.createElement('fieldset'),issueTitle=document.createElement('legend');issueTitle.textContent='听到的变化（可多选）';issues.append(issueTitle)
   for(const [value,label] of [['cleaner','交接更顺'],['drums-dense','鼓太密'],['pulse-drift','失拍或律动冲突'],['vocal-leak','人声残留'],['energy-jump','能量突变'],['hollow','变空了'],['exit-abrupt','退出突兀']]){const wrapper=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=vote.issues.includes(value);input.onchange=()=>{vote={...vote,issues:input.checked?[...vote.issues,value]:vote.issues.filter(v=>v!==value)};save()};wrapper.append(input,document.createTextNode(label));issues.append(wrapper)}
   section.append(choices,issues,savedText);host.append(section)
  }
  state('试听已就绪。每组的三版使用相同源片段与主交接点，选择会自动保存在本浏览器。')
 }catch(error){state((error as Error).message)}
}
if(typeof document!=='undefined')void mount()
