#!/usr/bin/env python3
"""Additional Jetson approval for temporary layering and source-A slip return.

Reuses verified stems, never distributes this module's private measurement PCM.
Every return curve is exported verbatim and checked with the phone's existing
processed-stem compatibility functions at the exact declared source gains.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import math
import pathlib
import socket
import subprocess
import tempfile

def value_at(points,t):
    for (a,x),(b,y) in zip(points,points[1:]):
        if t<=b:return x+(y-x)*max(0.,min(1.,(t-a)/(b-a)))
    return points[-1][1]

def return_layers(scene,exit_point):
    f,end=exit_point['fadeStart'],exit_point['at'];result=[]
    for original in scene['layers']:
        l=copy.deepcopy(original);value=value_at(l['points'],f)
        points=[p for p in l['points'] if p[0]<f]+[[f,value]]
        if l['role'] in ('bass','other'):
            # Withdraw pitched B before restoring pitched A, rather than
            # introducing a new bar-long melodic overlap at return.
            points += [[f+.25,value if l['side']=='a' else 0.],
                       [min(end,f+1.25),float(l['side']=='a')]]
        points += [[end,float(l['side']=='a')]]
        l['points']=[p for i,p in enumerate(points) if not i or p[0]>points[i-1][0]]
        result.append(l)
    return result

def require_intervals(value):
    if not isinstance(value,list):raise ValueError('published vocal intervals unknown')
    for row in value:
        if not isinstance(row,(list,tuple)) or len(row)!=2 or not all(isinstance(x,(int,float)) and math.isfinite(x) for x in row) or row[0]<0 or row[1]<row[0]:raise ValueError('invalid published vocal intervals')
    return value

def quiet_window(path,intervals,start,end,read,sr):
    import numpy as np
    require_intervals(intervals)
    if start<0 or end<=start:raise ValueError('invalid quiet source coverage')
    audio=read(path,start,end-start)
    if audio.shape!=(round((end-start)*sr),2) or not np.isfinite(audio).all():raise ValueError('vocal quiet source coverage incomplete')
    hop=round(.05*sr);maximum=max(float(np.sqrt(np.mean(audio[i:i+hop].astype(np.float64)**2))) for i in range(0,len(audio),hop))
    return dict(start=start,end=end,coverageVerified=True,intervalsClear=not any(a<end and b>start for a,b in intervals),maximumFrameDb=20*math.log10(max(1e-12,maximum)))

def export_return(base,data,implementation_sha,host):
    rows=data.get('exits',[])
    if base.get('schema')!='harbeat.live-layering.v1' or base.get('approved') is not True or data.get('timeline')!='slip' or len(data.get('verifierSha256',''))!=64 or not rows:raise ValueError('missing independent return approval')
    for r in rows:
        if abs(r.get('aPosition',-1)-(base['entry']['sourcePosition']+r.get('at',0)))>1/44100 or r.get('nativeBodySeconds')!=16:raise ValueError('return coordinate/coverage not verified')
        if any(not isinstance(r.get(k),(int,float)) or not math.isfinite(r[k]) or not 0<=r[k]<=.95 for k in ('peak','scenePeak','handoffPeak','nativeBodyPeak')):raise ValueError('return boundary peak not approved')
        if not r.get('layers') or r.get('compatibility',{}).get('pass') is not True:raise ValueError('return processed layers not approved')
        for key in ('aQuiet','bQuiet'):
            q=r.get(key,{})
            if q.get('intervalsClear') is not True or q.get('coverageVerified') is not True or not isinstance(q.get('maximumFrameDb'),(int,float)) or not math.isfinite(q['maximumFrameDb']) or q['maximumFrameDb']> -45:raise ValueError('return vocal gap not verified')
    value=copy.deepcopy(base);value['schema']='harbeat.live-layering-return.v1';value['implementationSha256']=implementation_sha
    value['evidence'].update(runtime='live-layering-return-linear-8ms-v1',producerHost=host,returnToA=data)
    value['evidence']['limitations']+=['Temporary return uses the source-A slip timeline and separately verified exits; listening preference remains unverified.']
    value.pop('id',None);value['id']=hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
    return value

def run(args):
    import longmix_scene as s
    import live_longmix_scene as live
    s.audio_dependencies();np=s.np
    base=json.loads(args.scene.read_text());scene=base['scene'];tracks=s.load_tracks(args.metadata)
    if base.get('schema')!='harbeat.live-layering.v1' or scene['rate']!=1 or base.get('approved') is not True:raise ValueError('requires original same-speed B-takeover scene')
    if hashlib.sha256(live.canonical_scene_bytes(scene)).hexdigest()!=base['sceneSha256']:raise ValueError('embedded scene fingerprint mismatch')
    paths={};a,b=[tracks[scene['sources'][side]['trackId']] for side in ('a','b')]
    for side,track in [('a',a),('b',b)]:
        require_intervals(track.get('vocals'));files,proof=s.source_assets(track,args.nas,args.reports);actual=s.profile_proof(track,proof,args.execution_root)
        if actual!=scene['sources'][side]:raise ValueError('source proof changed: '+side)
        paths[side]=files
    sr=s.SR;count=math.ceil((scene['duration']+.008)*sr);loop={k:s.read_segment(paths['a'][k],scene['clips']['aStart'],scene['clips']['aEnd']-scene['clips']['aStart']) for k in ('master',*s.ROLES)}
    audio={'a':{k:np.tile(x,(math.ceil(count/len(x)),1))[:count] for k,x in loop.items()},'b':{k:s.read_segment(paths['b'][k],scene['clips']['bStart'],count/sr) for k in ('master',*s.ROLES)}}
    candidates=[];rejected=[]
    for e in scene['exits']:
        pos=scene['clips']['aStart']+e['at'];row=dict(at=e['at'],aPosition=pos,layers=return_layers(scene,e))
        try:
            if pos+16>a['duration']:raise ValueError('A native body coverage insufficient')
            row['aQuiet']=quiet_window(paths['a']['vocals'],a['vocals'],pos-.15,pos+.3,s.read_segment,sr)
            row['bQuiet']=quiet_window(paths['b']['vocals'],b['vocals'],scene['clips']['bStart']+e['fadeStart']-.1,e['bPosition']+.1,s.read_segment,sr)
            if any(not row[k]['intervalsClear'] or row[k]['maximumFrameDb']> -45 for k in ('aQuiet','bQuiet')):raise ValueError('A return or B fade intersects vocals/tail')
            candidates.append((e,row))
        except Exception as error:rejected.append(dict(at=e['at'],reason=str(error),measurement=row))
    args.output.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='longmix-return-') as folder:
        root=pathlib.Path(folder);files={}
        for side,values in audio.items():
            files[side]={}
            for role,x in values.items():
                path=root/(side+'-'+role+'.f32le');path.write_bytes(x.astype('<f4').tobytes());files[side][role]=str(path)
        timelines=[]
        for e,row in candidates:
            timeline=dict(duration=e['at'],a={},b={})
            for l in row['layers']:timeline[l['side']][l['role']]=l['points']
            timeline['a']['vocals']=[[0,0],[e['at'],0]];timelines.append(timeline)
        job=root/'job.json';result=root/'result.json';job.write_text(json.dumps(dict(files=files,sourceGains=scene['sourceGains'],timelines=timelines,bpm=scene['bpm'],result=str(result))))
        subprocess.run(['/usr/local/bin/node',str(args.helper),str(job)],check=True,timeout=180);evidence=json.loads(result.read_text())
    approved=[];fade_frames=round(.008*sr);alpha=np.minimum(1,np.arange(fade_frames)/(sr*.008))[:,None]
    grid=max(s.source_grid_error(a,scene['clips']['aStart'],scene['clips']['aEnd']-scene['clips']['aStart'],1),s.source_grid_error(b,scene['clips']['bStart'],scene['duration'],1))
    for (e,row),ev in zip(candidates,evidence):
        n=round(e['at']*sr);size=n+fade_frames;time=np.arange(size)/sr;out=np.zeros((size,2),dtype=np.float32)
        for l in row['layers']:
            points=l['points'];gain=np.interp(time,[p[0] for p in points],[p[1] for p in points])*scene['sourceGains'][l['side']]*scene['outputGain'];out+=audio[l['side']][l['role']][:size]*gain[:,None]
        native=s.read_segment(paths['a']['master'],row['aPosition'],16)*.76;handoff=out[n:n+fade_frames]*(1-alpha)+native[:fade_frames]*alpha
        row.update(scenePeak=float(np.max(abs(out[:n]))),handoffPeak=float(np.max(abs(handoff))),nativeBodyPeak=float(np.max(abs(native))),nativeBodySeconds=16,compatibility=ev['compatibility'])
        row['peak']=max(base['entry']['peak'],row['scenePeak'],row['handoffPeak'],row['nativeBodyPeak'])
        metrics=dict(peak=row['peak'],reconstructionRelativeError=max(v['errorRatio'] for x in ev['reconstruction'].values() for v in (x,x['boundary'])),reconstructionLevelDeltaDb=max(abs(v['levelDeltaDb']) for x in ev['reconstruction'].values() for v in (x,x['boundary'])),loopBoundaryDb=max(s.loop_boundary(loop[k]) for k in ('bass','drums')),aVocalDb=s.db(s.rms(loop['vocals'])),melodyClash=ev['compatibility']['pitchedRisk'],beatErrorMs=grid,compatibilityPass=ev['compatibility']['pass'],bEntrySafe=s.vocal_safe_entry(b['vocals'],scene['clips']['bStart']))
        decision=s.approval(metrics)
        if decision['approved']:approved.append(row)
        else:rejected.append(dict(at=e['at'],reason='unchanged source/compatibility/peak gates',decision=decision,metrics=metrics,measurement=row))
    measurements=dict(timeline='slip',exits=approved,rejected=rejected,sourceProof=scene['sources'],helperSha256=hashlib.sha256(args.helper.read_bytes()).hexdigest())
    (args.output/'return-measurements.json').write_text(json.dumps(measurements,ensure_ascii=False,indent=2,allow_nan=False))
    value=export_return(base,dict(timeline='slip',exits=approved,verifierSha256=measurements['helperSha256']),hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),socket.gethostname())
    path=args.output/'return-scene.json';path.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False));print(json.dumps(dict(path=str(path),exits=[dict(at=r['at'],aPosition=r['aPosition'],peak=r['peak']) for r in approved],rejected=len(rejected))),flush=True)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('scene','metadata','output','helper'):p.add_argument('--'+name,type=pathlib.Path,required=True)
    p.add_argument('--nas',type=pathlib.Path,default=pathlib.Path('/mnt/nas/harbeat/preprocess'));p.add_argument('--reports',type=pathlib.Path,default=pathlib.Path('/mnt/nas/harbeat/data/analysis-platform/reports'));p.add_argument('--execution-root',type=pathlib.Path,default=pathlib.Path('/mnt/nas/harbeat/preprocess/device-execution-v1'));run(p.parse_args())

if __name__=='__main__':main()
