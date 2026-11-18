"""Time-local retained-role ranking proxies; never an execution approval."""
from dataclasses import dataclass
import numpy as np


@dataclass
class FeatureSeries:
    starts: np.ndarray
    ends: np.ndarray
    rms: np.ndarray
    chroma: np.ndarray

    @classmethod
    def from_profile(cls, rows):
        if not rows:
            raise ValueError('missing role frames for local ranking')
        starts=np.asarray([r['start'] for r in rows],float)
        ends=np.asarray([r['end'] for r in rows],float)
        rms=10**(np.asarray([r['rmsDb'] for r in rows],float)/20)
        chroma=np.asarray([r.get('chroma') or [0]*12 for r in rows],float)
        if (chroma.shape!=(len(rows),12) or not all(np.isfinite(x).all() for x in [starts,ends,rms,chroma])
                or np.any(ends<=starts) or np.any(np.diff(starts)<0)):
            raise ValueError('invalid role frames for local ranking')
        return cls(starts,ends,rms,chroma)

    @classmethod
    def from_pcm(cls, audio, sr=44100, start=0., step=.05):
        if audio.ndim!=2 or audio.shape[1]!=2 or not np.isfinite(audio).all():
            raise ValueError('invalid aligned PCM for local ranking')
        span=round(step*sr);starts=[];ends=[];rms=[];vectors=[]
        for first in range(0,len(audio),span):
            end=min(first+span,len(audio));center=(first+end)//2
            # RMS is measured over the actual 50 ms output frame. A longer
            # centered FFT reduces bass-bin ambiguity; it remains a proxy.
            x=audio[max(0,center-round(.125*sr)):min(len(audio),center+round(.125*sr))].mean(axis=1)
            n=2**int(np.ceil(np.log2(max(2,len(x)))))
            hz=np.fft.rfftfreq(n,1/sr);keep=(hz>=40)&(hz<=4000)
            bins=np.floor(69+12*np.log2(hz[keep]/440)+.5).astype(int)%12
            power=abs(np.fft.rfft(x*np.hanning(len(x)),n=n))**2
            vectors.append(np.bincount(bins,weights=power[keep],minlength=12))
            starts.append(start+first/sr);ends.append(start+end/sr)
            rms.append(float(np.sqrt(np.mean(audio[first:end].astype(float)**2))))
        return cls(np.asarray(starts),np.asarray(ends),np.asarray(rms),np.asarray(vectors))

    def sample(self, times):
        times=np.asarray(times);index=np.searchsorted(self.starts,times,side='right')-1
        safe=np.clip(index,0,len(self.starts)-1)
        covered=(index>=0)&(times<self.ends[safe])
        rms=np.where(covered,self.rms[safe],0.)
        chroma=np.where(covered[:,None],self.chroma[safe],0.)
        norm=np.linalg.norm(chroma,axis=1)
        return rms,chroma/np.maximum(norm[:,None],1e-20),covered

    def rms_db(self, start, end):
        weights=np.maximum(0,np.minimum(end,self.ends)-np.maximum(start,self.starts))
        if end<=start or weights.sum()<(end-start)*.95:
            return float('inf')
        rms=np.sqrt(np.dot(weights,self.rms**2)/weights.sum())
        return 20*np.log10(max(1e-12,float(rms)))


def local_fit(candidate, *, source_start, rate, output_start, output_end,
              gain, points, retained, support, step=.05):
    """Compare only audible local roles after their real output envelopes.

    Profile proposals may be sampled at coarser source resolution. The unchanged
    raw-PCM compatibility/coactivity checks remain the final authority.
    """
    if rate<=0 or output_end<=output_start or step<=0:
        raise ValueError('invalid local ranking clock')
    edges=np.arange(output_start,output_end,step)
    widths=np.minimum(step,output_end-edges);times=edges+widths/2
    raw,chroma,covered=candidate.sample(source_start+(times-output_start)*rate)
    envelope=np.interp(times,*zip(*points))*gain;audible_rms=raw*envelope
    threshold=10**(-45/20);active=audible_rms>=threshold
    role_risks={};weighted_risk=0.;total_weight=0.
    for key,reference in retained.items():
        rms,ref_chroma,_=reference.sample(times)
        weight=np.minimum(rms,audible_rms)*widths*(active&(rms>=threshold))
        has_pitch=(np.linalg.norm(chroma,axis=1)>0)&(np.linalg.norm(ref_chroma,axis=1)>0)
        weight*=has_pitch
        if weight.sum()>0:
            distance=np.clip(1-np.sum(chroma*ref_chroma,axis=1),0,1)
            value=float(np.dot(distance,weight)/weight.sum());role_risks[key]=value
            weighted_risk+=float(np.dot(distance,weight));total_weight+=float(weight.sum())
    together=active.copy()
    for reference in support:
        rms,_,_=reference.sample(times);together&=rms>=threshold
    return dict(rankingOnly=True,basis='time-local post-envelope RMS and chroma proxy; raw gates unchanged',
                pitchedRiskProxy=weighted_risk/total_weight if total_weight else 1.,roleRisks=role_risks,
                coactiveSeconds=float(widths[together].sum()),audibleSeconds=float(widths[active].sum()),
                coveredSeconds=float(widths[covered].sum()),outputStart=output_start,outputEnd=output_end)


def fit_order(fit):
    if not fit:return (True,2.,0.)
    return (fit['coactiveSeconds']<1.,fit['pitchedRiskProxy'],-fit['coactiveSeconds'])


def score_windows(rows, evaluate, limit=64):
    """A rejected complete-phrase window must not discard the whole source."""
    accepted,rejected=[],[]
    for row in rows[:limit]:
        try:
            details=evaluate(row)
        except ValueError as error:
            rejected.append(dict(start=row['start'],end=row.get('end'),
                                 delayBeats=row.get('delayBeats'),reason=str(error)))
            continue
        accepted.append({**row,**details})
    return accepted,rejected


def distinct_phrases(rows):
    first,alternatives,seen=[],[],set()
    for row in rows:
        key=row['phraseStart']
        (alternatives if key in seen else first).append(row)
        seen.add(key)
    return first+alternatives
