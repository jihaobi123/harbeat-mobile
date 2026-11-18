import {addHeard,heardSeconds,validateRating,blindOrder,type Span} from './feedback'
declare global{interface Window{HARBEAT_AUDITION:any}}
const data=window.HARBEAT_AUDITION,key='harbeat-audition-v2:'+data.fingerprint+(new URLSearchParams(location.search).has('qa')?':qa':'')
const labels:Record<string,string>={legacy:'原有渐进方案',structural:'段落短切',echo:'回声收尾'}
const names:Record<string,string>={'near-groove':'近速度、鼓重音分布不同','large-gap':'大速度跨度','dense-vocals':'人声密集','half-double':'半／双拍比例候选，重音映射待人工判断'}
let saved:any=null;try{saved=JSON.parse(localStorage.getItem(key)??'null')}catch{}
const state=saved?.corpusFingerprint===data.fingerprint?saved:{schema:'harbeat.audition-feedback.v2',roundId:crypto.randomUUID(),corpusFingerprint:data.fingerprint,createdAt:new Date().toISOString(),listener:{djExperience:'unspecified'},pairs:{}}
const note=document.querySelector('#save-status')!
function save(){try{localStorage.setItem(key,JSON.stringify(state));note.textContent='记录已保存在本机'}catch{note.textContent='本机存储不可用，请及时导出记录'}}
const element=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el}
const root=document.querySelector('#pairs')!
for(const pair of data.pairs){
 const entry=state.pairs[pair.id]??={seed:crypto.getRandomValues(new Uint32Array(1))[0],revealed:false,preference:null,notes:'',methods:{}}
 const section=element('section'),heading=element('h2',`${pair.id} · ${pair.a.title} → ${pair.b.title}`)
 section.append(heading,element('p',`${names[pair.cohort]} · ${pair.a.bpm} → ${pair.b.bpm} BPM`))
 if(pair.evidence?.drumDifference!==null&&pair.evidence?.drumDifference!==undefined)section.append(element('p',`鼓起音相位分布差异 ${pair.evidence.drumDifference.toFixed(3)}；属于声学代理。`))
 const order=blindOrder<any>(pair.methods,entry.seed),grid=element('div');grid.className='grid';const titles:HTMLElement[]=[]
 for(let i=0;i<order.length;i++){
  const method:any=order[i],letter=String.fromCharCode(65+i),m=entry.methods[method.family]??={letter,fileSha256:method.sha256,heard:[],ratings:{continuity:null,drums:null,vocals:null,level:null},playbacks:0}
  if(m.fileSha256!==method.sha256)throw Error('Audition identity changed')
  const cell=element('div'),title=element('h3',entry.revealed?`${letter} · ${labels[method.family]}`:`版本 ${letter}`);titles.push(title)
  const audio=element('audio');audio.controls=true;audio.preload='none';audio.src=method.immutableFile
  const coverage=element('p');let previous:number|null=null
  const refresh=()=>coverage.textContent=`实际听过 ${heardSeconds(m.heard).toFixed(1)} / ${method.seconds.toFixed(1)} 秒`
  const track=()=>{const at=audio.currentTime;if(previous!==null&&!audio.seeking)m.heard=addHeard(m.heard as Span[],previous,at,method.seconds);previous=audio.paused||audio.seeking?null:at;refresh();save()}
  audio.addEventListener('play',()=>{document.querySelectorAll('audio').forEach(other=>{if(other!==audio)other.pause()});previous=audio.currentTime;m.playbacks++;save()})
  audio.addEventListener('timeupdate',track);audio.addEventListener('pause',track);audio.addEventListener('ended',track)
  audio.addEventListener('seeking',()=>{previous=null});audio.addEventListener('seeked',()=>{previous=audio.paused?null:audio.currentTime})
  refresh();cell.append(title,audio,coverage)
  for(const [field,label] of [['continuity','衔接自然'],['drums','鼓点连贯'],['vocals','人声完整'],['level','音量平稳']]){
   const wrapper=element('label',label+' '),select=element('select');select.setAttribute('aria-label',`${pair.id} ${letter} ${label}`)
   const empty=element('option','未评分');empty.value='';select.append(empty)
   for(let n=1;n<=5;n++){const option=element('option',String(n));option.value=String(n);select.append(option)}
   select.value=m.ratings[field]===null?'':String(m.ratings[field]);select.onchange=()=>{m.ratings[field]=validateRating(select.value);save()};wrapper.append(select);cell.append(wrapper)
  }
  grid.append(cell)
 }
 section.append(grid)
 const preferenceLabel=element('label','更喜欢：'),preference=element('select');preference.setAttribute('aria-label',pair.id+' 更喜欢')
 for(const [value,label] of [['','未选择'],...order.map((_:any,i:number)=>[String.fromCharCode(65+i),'版本 '+String.fromCharCode(65+i)]),['none','都不合适']]){const option=element('option',label);option.value=value;preference.append(option)}
 preference.value=entry.preference??'';preference.onchange=()=>{entry.preference=preference.value||null;save()};preferenceLabel.append(preference)
 const reveal=element('button',entry.revealed?'已揭晓方法':'揭晓本组方法');reveal.disabled=entry.revealed
 reveal.onclick=()=>{entry.revealed=true;entry.revealedAt=new Date().toISOString();titles.forEach((title,i)=>title.textContent=`${String.fromCharCode(65+i)} · ${labels[order[i].family]}`);reveal.textContent='已揭晓方法';reveal.disabled=true;save()}
 const notes=element('textarea');notes.placeholder='哪里生硬、断句、鼓点冲突，或你会怎么接';notes.setAttribute('aria-label',pair.id+' 试听备注');notes.value=entry.notes;notes.oninput=()=>{entry.notes=notes.value.slice(0,4000);save()}
 section.append(preferenceLabel,reveal,notes)
 for(const unavailable of pair.unavailable??[])section.append(element('p',`${labels[unavailable.family]}不可用：${unavailable.reason}`))
 root.append(section)
}
const experience=document.querySelector<HTMLSelectElement>('#dj-experience')!;experience.value=state.listener.djExperience
experience.onchange=()=>{state.listener.djExperience=experience.value;save()}
document.querySelector('#export')!.addEventListener('click',()=>{
 const history=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i)!;if(k.startsWith(key+':archive:'))try{history.push(JSON.parse(localStorage.getItem(k)!))}catch{}}
 const blob=new Blob([JSON.stringify({...state,history,exportedAt:new Date().toISOString(),corpus:data,automatedTest:new URLSearchParams(location.search).has('qa'),interpretation:'未评分为未知；实际播放覆盖单独记录。声学规则不是听感概率，DJ身份由试听者自述。'},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=element('a');a.href=url;a.download='HarBeat-audition-'+state.roundId+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
})
document.querySelector('#new-round')!.addEventListener('click',()=>{save();localStorage.setItem(key+':archive:'+state.roundId,JSON.stringify(state));localStorage.removeItem(key);location.reload()})
save()
