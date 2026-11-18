import type {ExtraLayer} from './multi-contract'
/** Deterministic biquad; warm its state around the same periodic loop. */
export function filterLoop(input:Float32Array,sampleRate:number,filter:ExtraLayer['filter']){
 if(input.length%2||!input.length||sampleRate!==44100)throw Error('多源过滤输入网格无效')
 for(const v of input)if(!Number.isFinite(v))throw Error('多源输入包含无效样本')
 if(filter.kind==='none')return input
 if(filter.kind!=='highpass'||filter.frequency!==180||filter.warmupCycles!==3||Math.abs(filter.q-Math.SQRT1_2)>1e-12)throw Error('多源过滤参数未批准')
 const w=2*Math.PI*filter.frequency/sampleRate,c=Math.cos(w),alpha=Math.sin(w)/(2*filter.q),a0=1+alpha,b0=(1+c)/2/a0,b1=-(1+c)/a0,b2=b0,a1=-2*c/a0,a2=(1-alpha)/a0,n=input.length/2,out=new Float32Array(input.length)
 for(let ch=0;ch<2;ch++){let z1=0,z2=0;for(let cycle=0;cycle<3;cycle++)for(let i=0;i<n;i++){const x=input[2*i+ch],y=b0*x+z1;z1=b1*x-a1*y+z2;z2=b2*x-a2*y;if(cycle===2)out[2*i+ch]=y}}
 return out
}
