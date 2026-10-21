type Entry<T>={controller:AbortController;promise:Promise<T>;waiters:number;value?:T;settled:boolean}
/** A small source-bound result pool. Each subscriber owns its wait, while the
 * shared DSP operation is cancelled only after the last subscriber leaves.
 * DSP jobs are serialized so rolling warming cannot multiply worker memory. */
export class PreparedPool<T>{
 private items=new Map<string,Entry<T>>()
 private tail:Promise<unknown>=Promise.resolve()
 constructor(readonly limit=3,private valid:(value:T)=>boolean=()=>true,private drop:(value:T)=>void=()=>{}){}
 entries(){return [...this.items].filter(([,e])=>e.settled&&e.value!==undefined&&this.valid(e.value)).map(([key,e])=>({key,value:e.value!}))}
 private remove(key:string,entry:Entry<T>){if(this.items.get(key)!==entry)return;this.items.delete(key);entry.controller.abort();if(entry.value!==undefined)this.drop(entry.value)}
 prune(keep:(value:T)=>boolean){for(const [key,e] of this.items)if(e.value!==undefined&&(!this.valid(e.value)||!keep(e.value)))this.remove(key,e)}
 clear(){for(const [key,e] of this.items)this.remove(key,e)}
 get(key:string,create:(signal:AbortSignal)=>Promise<T>,signal:AbortSignal):Promise<T>{
  signal.throwIfAborted()
  let entry=this.items.get(key)
  if(entry&&(entry.controller.signal.aborted||entry.value!==undefined&&!this.valid(entry.value))){this.remove(key,entry);entry=undefined}
  if(!entry){
   const e:Entry<T>={controller:new AbortController(),promise:null!,waiters:0,settled:false}
   e.promise=this.tail.catch(()=>{}).then(()=>{e.controller.signal.throwIfAborted();return create(e.controller.signal)}).then(value=>{
    e.controller.signal.throwIfAborted();e.value=value;e.settled=true
    while(this.entries().length>this.limit){const oldest=[...this.items].find(([,item])=>item!==e&&item.settled);if(!oldest)break;this.remove(...oldest)}
    return value
   }).catch(error=>{this.remove(key,e);throw error})
   // The queue also consumes rejections when all subscribers have left.
   this.tail=e.promise.catch(()=>{});this.items.set(key,e);entry=e
  }else{this.items.delete(key);this.items.set(key,entry)}
  const selected=entry;selected.waiters++
  return new Promise<T>((resolve,reject)=>{
   let finished=false
   const done=(error?:unknown,value?:T)=>{if(finished)return;finished=true;signal.removeEventListener('abort',cancel);selected.waiters--;if(!selected.waiters&&!selected.settled)this.remove(key,selected);error?reject(error):resolve(value!)}
   const cancel=()=>done(signal.reason??new DOMException('已取消','AbortError'))
   signal.addEventListener('abort',cancel,{once:true});selected.promise.then(value=>done(undefined,value),error=>done(error));if(signal.aborted)cancel()
  })
 }
}
