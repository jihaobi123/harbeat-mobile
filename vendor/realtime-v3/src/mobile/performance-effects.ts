export const scratchRouting=Object.freeze({mode:'slip-takeover-v1',originalGain:0,scratchGain:.6,edgeSeconds:.008})
/** Master performance bus. Scratch replaces audible original; its clock stays live. */
export class PerformanceEffects{
 readonly input:GainNode
 private dry:GainNode;private bass:GainNode;private filters:BiquadFilterNode[]
 private active:{source:AudioBufferSourceNode;gain:GainNode;end:number}|null=null
 mc=false;lastScratchEnd=0
 constructor(private ctx:BaseAudioContext,private output:AudioNode){
  this.input=ctx.createGain();this.dry=ctx.createGain();this.bass=ctx.createGain()
  this.filters=[ctx.createBiquadFilter(),ctx.createBiquadFilter()]
  for(const f of this.filters){f.type='lowpass';f.frequency.value=320;f.Q.value=-3.0103}
  this.input.connect(this.dry);this.dry.connect(output)
  this.input.connect(this.filters[0]);this.filters[0].connect(this.filters[1]);this.filters[1].connect(this.bass);this.bass.connect(output);this.bass.gain.value=0
 }
 private ramp(param:AudioParam,value:number,duration:number){
  const now=this.ctx.currentTime
  if(param.cancelAndHoldAtTime)param.cancelAndHoldAtTime(now)
  else{const held=param.value;param.cancelScheduledValues(now);param.setValueAtTime(held,now)}
  param.linearRampToValueAtTime(value,now+duration)
 }
 setMC(enabled:boolean){this.cancelScratch(true);this.mc=enabled;this.ramp(this.dry.gain,enabled?0:1,.45);this.ramp(this.bass.gain,enabled?1:0,.45)}
 get scratching(){if(this.active&&this.ctx.currentTime>=this.active.end)this.active=null;return this.active!==null}
 scratch(clip:AudioBuffer,at:number){
  if(this.scratching)return false
  if(!Number.isFinite(at)||at<this.ctx.currentTime+.02||!Number.isFinite(clip.duration)||clip.duration<=0||clip.duration>3)throw Error('搓碟拍点已过，请重新触发')
  this.cancelScratch(true);if(this.mc)this.setMC(false)
  const source=this.ctx.createBufferSource(),gain=this.ctx.createGain(),end=at+clip.duration
  source.buffer=clip;source.connect(gain);gain.connect(this.output);gain.gain.value=scratchRouting.scratchGain
  const active={source,gain,end};this.active=active;this.lastScratchEnd=end
  source.onended=()=>{source.disconnect();gain.disconnect();source.buffer=null}
  // Slip: original clock continues silently. Finish recovery AT the ending beat.
  const param=this.input.gain,now=this.ctx.currentTime
  if(param.cancelAndHoldAtTime)param.cancelAndHoldAtTime(now);else param.cancelScheduledValues(now)
  const edge=Math.min(scratchRouting.edgeSeconds,clip.duration/4)
  param.setValueAtTime(1,Math.max(now,at-edge));param.linearRampToValueAtTime(scratchRouting.originalGain,at);param.setValueAtTime(scratchRouting.originalGain,end-edge);param.linearRampToValueAtTime(1,end)
  source.start(at);return true
 }
 cancelScratch(immediate=false){
  const active=this.active;if(!active)return
  this.active=null;const now=this.ctx.currentTime
  this.ramp(active.gain.gain,0,immediate?0:.02)
  try{active.source.stop(now+(immediate?0:.02))}catch{}
  this.ramp(this.input.gain,1,immediate?0:.04)
 }
 reset(){this.cancelScratch(true);this.setMC(false)}
 dispose(){this.reset();for(const node of [this.input,this.dry,this.bass,...this.filters])node.disconnect()}
}
