"""Source-bound acoustic transition evidence. Musical semantics stay unverified."""
import hashlib
import math
import re
from pathlib import Path
import numpy as np

SCHEMA='harbeat.crossgenre-track.v1'
POLICY='crossgenre-structural-v1'
FRAME_SECONDS=.05
HASH=re.compile(r'^[a-f0-9]{64}$')


def number(value):
    return type(value) in (int,float) and math.isfinite(value)


def algorithm_sha():
    return hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


def binding_for(track,manifest_sha):
    p=track.get('provenance') or {}; s=(track.get('alignment') or {}).get('source') or {}
    if (not HASH.fullmatch(str(manifest_sha)) or not HASH.fullmatch(str(track.get('reportId','')))
        or not isinstance(p.get('runId'),str) or not p['runId']
        or any(not HASH.fullmatch(str(p.get(k,''))) or s.get(k)!=p[k]
               for k in ('masterSha256','reportSha256','vocalSha256'))
        or s.get('reportId')!=track['reportId']):
        raise ValueError('source binding mismatch')
    return dict(trackId=track['id'],reportId=track['reportId'],manifestSha256=manifest_sha,
                **{k:p[k] for k in ('masterSha256','reportSha256','vocalSha256','runId')})


def measure_frames(audio,sample_rate,*,start=0):
    x=np.asarray(audio)
    if (x.ndim!=2 or x.shape[1]!=2 or not np.isfinite(x).all()
        or not number(sample_rate) or sample_rate<20 or not number(start) or start<0):
        raise ValueError('invalid stereo audio')
    size=round(sample_rate*FRAME_SECONDS);rows=[]
    for i in range(0,len(x),size):
        part=x[i:i+size].astype(np.float64)
        rows.append(dict(start=round(start+i/sample_rate,9),end=round(start+(i+len(part))/sample_rate,9),
                         rms=float(np.sqrt(np.mean(part*part))),peak=float(np.max(np.abs(part)))))
    return rows


def measure_file(path):
    import soundfile as sf
    rows=[]
    with sf.SoundFile(path) as stream:
        if stream.channels!=2:raise ValueError('stereo source required')
        size=round(stream.samplerate*FRAME_SECONDS)*320;at=0
        while True:
            data=stream.read(size,dtype='float32',always_2d=True)
            if not len(data):break
            rows.extend(measure_frames(data,stream.samplerate,start=at/stream.samplerate));at+=len(data)
    return rows


def validate_frames(rows,duration):
    cursor=0.
    if not rows:raise ValueError('measurement coverage missing')
    for f in rows:
        if (any(not number(f.get(k)) for k in ('start','end','rms','peak'))
            or abs(f['start']-cursor)>.00001 or f['end']<=f['start']
            or f['end']-f['start']>FRAME_SECONDS+.00001 or f['rms']<0 or f['peak']<f['rms']-1e-8):
            raise ValueError('measurement coverage invalid')
        cursor=f['end']
    if abs(cursor-duration)>.05:raise ValueError('measurement coverage incomplete')


def summarize(rows,start,end):
    if start<0 or end<=start:return None
    selected=[f for f in rows if f['end']>start+1e-9 and f['start']<end-1e-9]
    if not selected or selected[0]['start']>start+.00001 or selected[-1]['end']<end-.00001:return None
    power=sum(f['rms']**2*max(0,min(end,f['end'])-max(start,f['start'])) for f in selected)
    rms=math.sqrt(power/(end-start))
    return dict(rms=round(rms,8),rmsDbfs=round(20*math.log10(max(1e-9,rms)),4),
                peak=round(max(f['peak'] for f in selected),8))


def merge_intervals(intervals,gap=.15):
    merged=[]
    for start,end in sorted(intervals):
        if merged and start<=merged[-1][1]+gap:merged[-1][1]=max(merged[-1][1],end)
        else:merged.append([start,end])
    return merged


def valid_bars(track):
    rows=[]
    for b in (track.get('alignment') or {}).get('bars',[]):
        beats=b.get('beats',[]);start=b.get('start');end=b.get('end')
        if (b.get('valid') is not True or len(beats)!=4 or not all(number(t) for t in [start,end,*beats])
            or start<0 or end>track['duration']+.002 or abs(beats[0]-start)>.001
            or any(y<=x for x,y in zip(beats,beats[1:])) or beats[-1]>=end):continue
        rows.append(dict(index=b['index'],start=start,end=end,beats=beats))
    return rows


def build_profile(track,master,vocal,*,manifest_sha,algorithm_sha):
    source=binding_for(track,manifest_sha);duration=track.get('duration')
    if not number(duration) or duration<20 or not HASH.fullmatch(str(algorithm_sha)):raise ValueError('invalid duration or algorithm')
    validate_frames(master,duration);validate_frames(vocal,duration)
    intervals=track.get('vocals')
    if not isinstance(intervals,list):raise ValueError('vocal evidence unknown')
    for row in intervals:
        if (not isinstance(row,list) or len(row)!=2 or not all(number(x) for x in row)
            or row[0]<0 or row[1]<=row[0] or row[1]>duration+.05):raise ValueError('invalid vocal interval')
    gate=max(10**(-65/20),float(np.percentile([f['rms'] for f in vocal],95))*.008)
    measured=[[max(0,f['start']-.05),min(duration,f['end']+.08)] for f in vocal if f['rms']>=gate]
    voices=merge_intervals([*intervals,*measured]);bars=valid_bars(track)
    sections=track.get('sections')
    if not isinstance(sections,list):raise ValueError('section evidence missing')
    sections=[s for s in sections if number(s.get('start')) and number(s.get('end'))
              and 0<=s['start']<s['end']<=duration+.05 and isinstance(s.get('label'),str)]
    entries=[];exits=[]
    for bar in bars:
        t=bar['start'];beat=(bar['end']-t)/4
        nearby=[s for s in sections if min(abs(s['start']-t),abs(s['end']-t))<=.5]
        if not nearby or t+16>duration or beat<.2 or beat>1.5:continue
        label=min(nearby,key=lambda s:min(abs(s['start']-t),abs(s['end']-t)))['label']
        # Never begin in a pre-existing sung syllable. A new onset at the cue is allowed.
        entry_safe=not any(s<t-.02 and e>t-.02 for s,e in voices)
        head=summarize(master,t,t+min(2.,4*beat));body=summarize(master,t,t+16)
        if entry_safe and head and body and head['rmsDbfs']>=-42:
            entries.append(dict(id='in-'+str(bar['index']),time=t,barIndex=bar['index'],localBpm=60/beat,
                                section=label,head=head,body=body,semanticStatus='unverified'))
        # Require measured quiet after a complete vocal release; unknown never becomes silence.
        safe=t>=4 and not any(s<t+.08 and e>t-.2 for s,e in voices)
        before=summarize(master,max(0,t-4),t)
        if not safe or not before or before['rmsDbfs']< -45:continue
        ended=[e for s,e in voices if e<=t-.2];last=max(ended) if ended else None
        cap_end=min(t-.2,last) if last is not None else t-.2
        cap_start=max(0,cap_end-min(.8,beat))
        capture=summarize(master,cap_start,cap_end);cap_voice=summarize(vocal,cap_start,cap_end)
        echo=bool(last is not None and t-last<=1.25 and capture and cap_voice
                  and cap_voice['rms']>=max(gate*2,10**(-45/20)) and capture['peak']<=1.25)
        exits.append(dict(id='out-'+str(bar['index']),time=t,barIndex=bar['index'],localBpm=60/beat,
                          section=label,before=before,echoEligible=echo,
                          capture=dict(start=cap_start,end=cap_end,**(capture or dict(rms=0.,rmsDbfs=-180.,peak=0.))),
                          voiceEnd=last,semanticStatus='unverified'))
    return dict(schema=SCHEMA,policy=POLICY,producer='jetson',algorithmSha256=algorithm_sha,source=source,
                duration=duration,entries=entries,exits=exits,
                analysis=dict(frameSeconds=FRAME_SECONDS,vocalRmsGate=gate,
                              vocalPolicy='source-bound VAD union stereo vocal RMS, 50ms lead/80ms tail, 150ms gap merge',
                              semanticPhraseStatus='unverified',structuralBoundaryTolerance=.5),
                limitations=['Acoustic and model section candidates; semantic musical/lyric phrase correctness unverified.',
                             'RMS and sample peak are digital proxies, not integrated LUFS, true peak or listening quality.',
                             'Crossgenre controls require device headroom and listening validation.'])
