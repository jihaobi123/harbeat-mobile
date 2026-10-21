/** Same observed-window FFT chroma proxy as metric_mix/features.py.
 * Returns null for quiet or insufficient audio; it is not a musical key label. */
export function sourceChroma(mono:Float32Array,sampleRate:number){
 let energy=0;for(const x of mono)energy+=x*x
 if(mono.length<1024||Math.sqrt(energy/mono.length)<1e-6)return null
 const n=2**Math.floor(Math.log2(Math.min(mono.length,32768))),profile=Array(12).fill(0)
 for(let at=0;at<Math.max(1,mono.length-n+1);at+=n){
  const real=new Float64Array(n),imag=new Float64Array(n)
  for(let i=0;i<n;i++)real[i]=mono[at+i]*(.5-.5*Math.cos(2*Math.PI*i/(n-1)))
  for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){const temp=real[i];real[i]=real[j];real[j]=temp}}
  for(let size=2;size<=n;size*=2){const half=size/2,angle=-2*Math.PI/size,wr=Math.cos(angle),wi=Math.sin(angle);for(let start=0;start<n;start+=size){let r=1,im=0;for(let i=0;i<half;i++){const even=start+i,odd=even+half,tr=r*real[odd]-im*imag[odd],ti=r*imag[odd]+im*real[odd];real[odd]=real[even]-tr;imag[odd]=imag[even]-ti;real[even]+=tr;imag[even]+=ti;const next=r*wr-im*wi;im=r*wi+im*wr;r=next}}}
  for(let i=Math.ceil(40*n/sampleRate);i<=Math.min(n/2,Math.floor(4000*n/sampleRate));i++){const hz=i*sampleRate/n,midi=Math.round(69+12*Math.log2(hz/440));profile[((midi%12)+12)%12]+=real[i]*real[i]+imag[i]*imag[i]}
 }
 const norm=Math.hypot(...profile);return norm>1e-10?profile.map(x=>x/norm):null
}
export function chromaDifference(a:number[]|null,b:number[]|null){return a&&b?Math.max(0,Math.min(1,1-a.reduce((sum,x,i)=>sum+x*b[i],0))):null}
