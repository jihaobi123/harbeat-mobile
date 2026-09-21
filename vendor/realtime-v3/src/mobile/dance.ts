import type {Track} from '../realtime/planner'
import type {LiveTransport} from '../realtime/transport'

export type DanceSet={id:string;style:string;seconds:number;tracks:Track[]}
/** Session orchestration only; pinned V3 cue selection and DSP are unchanged. */
export class DanceRun {
 private began:number|null=null;private lastId='';private entered=0;private retryAt=0;private ending:number|null=null;private requestAfter=0
 finished=false;stopped=false;message='已生成舞程，点击开始播放';index=0;elapsed=0
 constructor(readonly set:DanceSet){}
 tick(p:LiveTransport){
  if(this.finished||this.stopped)return
  if(!p.current){
   if(this.began!==null){this.stopped=true;this.message='播放已中断，请重新生成舞程后开始'}
   return
  }
  const now=p.ctx.currentTime
  if(this.began===null){this.began=now;p.log('dance_start',{setId:this.set.id,style:this.set.style,targetSeconds:this.set.seconds,orderedTracks:this.set.tracks.map(t=>({id:t.id,reportId:t.reportId,provenance:t.provenance}))})}
  this.elapsed=Math.max(0,now-this.began)
  if(p.current.id!==this.lastId){
   this.lastId=p.current.id;this.index=this.set.tracks.findIndex(t=>t.id===this.lastId);this.entered=now;this.retryAt=0
   const available=p.current.duration-p.position
   const future=this.set.tracks.slice(this.index+1).map(t=>Math.max(0,t.duration-Math.max(...t.windows.map(w=>w.end))))
   const futureCapacity=future.reduce((a,b)=>a+b,0)
   const needed=this.set.seconds-this.elapsed
   const share=needed*available/Math.max(1,available+futureCapacity)
   // A late first downbeat can leave less than a minute of B body. Equal
   // per-song quotas would run out early; reserve actual remaining body time.
   this.requestAfter=Math.max(35,share-10,needed-futureCapacity)
   // The existing V3 end-of-source fallback must not replay previous songs.
   p.tracks=this.set.tracks.slice(this.index)
   p.log('dance_track',{setId:this.set.id,index:this.index,elapsed:this.elapsed})
  }
  if(!p.playing)return
  const left=this.set.seconds-this.elapsed
  if(left<=2&&this.ending===null){
   p.cancel();this.ending=now+1.5;this.message='舞程即将结束';return
  }
  if(this.ending!==null){
   p.setVolume(.85*Math.max(0,(this.ending-now)/1.5))
   if(now>=this.ending){this.finished=true;this.message='本次舞程已完成';p.log('dance_complete',{setId:this.set.id,elapsed:this.elapsed});p.stop();void p.ctx.suspend()}
   return
  }
  const remaining=this.set.tracks.length-this.index
  this.message=`自动混音 · 第 ${this.index+1}/${this.set.tracks.length} 首`
  if(remaining<=1||p.pending||p.busy||now<this.retryAt)return
  const sourceLeft=p.current.duration-p.position
  if(now-this.entered>=this.requestAfter||sourceLeft<32){
   this.retryAt=now+5
   const next=this.set.tracks[this.index+1]
   void p.request({kind:'next',targetId:next.id},30,{origin:'dance_auto'}).catch(()=>{})
  }
 }
 postpone(p:LiveTransport){this.retryAt=p.ctx.currentTime+15}
 stop(){this.stopped=true;this.message='舞程已停止'}
 snapshot(){return {id:this.set.id,style:this.set.style,total:this.set.seconds,elapsed:this.elapsed,index:this.index,count:this.set.tracks.length,finished:this.finished,stopped:this.stopped,message:this.message}}
}

export function validateDanceSet(value:any):DanceSet{
 if(!value||value.schema!=='harbeat.dance_set.v1'||!Number.isFinite(value.seconds)||value.seconds<60||value.seconds>1800||!Array.isArray(value.tracks)||value.tracks.length<2||value.tracks.length>32)throw Error('舞程格式不正确')
 const ids=new Set<string>()
 for(const t of value.tracks){
  if(!/^track-[a-f0-9]{20}$/.test(t.id)||ids.has(t.id)||!Number.isFinite(t.duration)||t.duration<60||t.duration>151||!Array.isArray(t.windows)||!Array.isArray(t.bars)||!Array.isArray(t.energy)||!Array.isArray(t.vocals))throw Error('舞程歌曲或时间轴不正确')
  ids.add(t.id)
  for(const asset of [t.native,...t.windows.flatMap((w:any)=>Object.values(w.variants||{}))] as any[]){
   if(!asset||!/^\/dance-assets\/[a-f0-9]{64}\.flac$/.test(asset.url)||asset.url!==`/dance-assets/${asset.sha256}.flac`||!Number.isFinite(asset.duration)||asset.duration<=0||asset.bytes>64*1024*1024)throw Error('混音素材路径或大小不正确')
  }
 }
 return value as DanceSet
}
