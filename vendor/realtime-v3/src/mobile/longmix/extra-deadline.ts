/** Paused preheat gets wall time; running playback always keeps AB cue reserve. */
export function extraDeadline(anchor:number,position:()=>number,playing:()=>boolean,parent:AbortSignal){
 const controller=new AbortController(),signal=AbortSignal.any([parent,controller.signal]),born=performance.now();let running:number|null=playing()?born:null,timer:ReturnType<typeof setInterval>|undefined
 const dispose=()=>{if(timer!==undefined)clearInterval(timer);signal.removeEventListener('abort',dispose)}
 const check=()=>{const now=performance.now(),active=playing();if(active&&running===null)running=now;if(!active)running=null;if(now-born>=60000||active&&(anchor-position()<=12||running!==null&&now-running>=8000))controller.abort(new DOMException('额外声部准备超过可用预算','TimeoutError'))}
 signal.addEventListener('abort',dispose,{once:true});check();if(!signal.aborted)timer=setInterval(check,100)
 return{signal,dispose}
}
