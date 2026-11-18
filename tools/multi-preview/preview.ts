const root=document.querySelector('#cases')!,key='harbeat-multisource-20261106';let records:Record<string,unknown>={};try{records=JSON.parse(localStorage.getItem(key)||'{}')}catch{}
const index=await(await fetch('cases.json',{cache:'no-store'})).json();const players:HTMLAudioElement[]=[]
for(const [i,item]of index.cases.entries()){
 const section=document.createElement('section'),title=document.createElement('h2');title.textContent=`${String(i+1).padStart(2,'0')} · ${item.title}`;section.append(title)
 const description=document.createElement('p');description.className='muted';description.textContent=item.description;section.append(description)
 const audio=document.createElement('audio');audio.controls=true;audio.preload='metadata';audio.src=item.variants[0].url;section.append(audio);players.push(audio);audio.onplay=()=>players.filter(a=>a!==audio).forEach(a=>a.pause())
 const controls=document.createElement('div');controls.className='control';section.append(controls)
 for(const variant of item.variants){const button=document.createElement('button');button.textContent=variant.label;button.onclick=async()=>{const position=audio.currentTime||0;players.forEach(a=>a.pause());audio.src=variant.url;audio.currentTime=Math.min(position,38);try{await audio.play()}catch(e){status.textContent=String(e)}controls.querySelectorAll('button').forEach(b=>b.classList.remove('active'));button.classList.add('active')};controls.append(button)}
 const status=document.createElement('output');section.append(status);const note=document.createElement('p');note.textContent='你更喜欢哪版？';section.append(note);const stored=records[item.id]as any
 for(const label of [...item.variants.map((v:any)=>v.label),'差不多','都不理想']){const row=document.createElement('label'),choice=document.createElement('input');choice.type='radio';choice.name=item.id;choice.value=label;choice.checked=stored?.choice===label;choice.onchange=()=>save(label);row.append(choice,' '+label);section.append(row)}
 const comments=document.createElement('textarea');comments.placeholder='例如：鼓更连贯／更拥挤／几乎听不出区别';comments.value=stored?.comments||'';comments.oninput=()=>save(section.querySelector<HTMLInputElement>('input:checked')?.value||'');section.append(comments)
 function save(choice:string){records[item.id]={choice,comments:comments.value,updatedAt:new Date().toISOString(),title:item.title};localStorage.setItem(key,JSON.stringify(records));document.querySelector('#saved')!.textContent='选择已保存在这台浏览器。'}
 root.append(section)
}
document.querySelector('#export')!.addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({schema:'harbeat.multi-listening.v1',records},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='harbeat-multisource-choices.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)})
