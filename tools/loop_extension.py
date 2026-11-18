#!/usr/bin/env python3
"""Jetson-only finite instrumental-loop approval. No two-source approval reuse."""
import argparse,hashlib,json,math,pathlib,socket

def decision(e):
 limits={'reconstruction':.25,'reconstructionLevelDeltaDb':1.5,'loopSeamDb':-20,'vocalMaxDb':-45,'beatErrorMs':50,'peak':.95,'entryPeak':.95}
 return (e.get('vocalClear') is True and all(isinstance(e.get(k),(int,float)) and math.isfinite(e[k]) and (abs(e[k]) if k=='reconstructionLevelDeltaDb' else e[k])<=v for k,v in limits.items()) and len(e.get('exitPeaks',[]))==2 and all(math.isfinite(x['peak']) and 0<=x['peak']<=.95 for x in e['exitPeaks']))

def run(args):
 import longmix_scene as s
 s.audio_dependencies();np=s.np;tracks=s.load_tracks(args.metadata);scans=json.loads(args.scan.read_text());results=[];args.output.mkdir(parents=True,exist_ok=True)
 for row in scans:
  t=tracks[row['track']];paths,origin=s.source_assets(t,args.nas,args.reports);proof=s.profile_proof(t,origin,args.execution_root)
  for proposal in row['selected']:
   first=round(proposal['start']*s.SR);length=round(960/t['bpm']*s.SR/2)*2;start=first/s.SR;duration=length/s.SR
   x={k:s.read_segment(p,start,(length+math.ceil(.008*s.SR))/s.SR) for k,p in paths.items()};mix=sum(x[k][:length] for k in s.ROLES);master=x['master'][:length];rms=s.rms(master);error=s.rms(mix-master)/max(rms,1e-12);level=s.db(s.rms(mix)/max(rms,1e-12))
   # DC-correct 50 ms energy follows quiet short tails; whole-loop mean alone
   # would dilute a single sung syllable. Published VAD remains an extra guard.
   vocal=x['vocals'][:length];step=round(.05*s.SR);vmax=max(s.db(s.rms(vocal[i:i+step]-np.mean(vocal[i:i+step],axis=0))) for i in range(0,length,step) if len(vocal[i:i+step])>1)
   clear=not any(a<start+duration+.1 and b>start-.1 for a,b in t['vocals']);fade=round(.008*s.SR);alpha=(np.arange(fade)/(s.SR*.008))[:,None];peaks=[]
   for phase in [length//2,length]:
    body=s.read_segment(paths['master'],(first+phase)/s.SR,16)*.76;loop=x['master'][phase%length:phase%length+fade]*.76
    handoff=loop*(1-alpha)+body[:fade]*alpha;peaks.append(dict(phaseFrame=phase,peak=max(float(np.max(np.abs(body))),float(np.max(np.abs(handoff))))))
   e=dict(sourceVerified=True,producerHost=socket.gethostname(),reconstruction=error,reconstructionLevelDeltaDb=level,loopSeamDb=max(s.loop_boundary(x[k][:length]) for k in ['master','drums','bass','other']),vocalMaxDb=vmax,vocalClear=clear,beatErrorMs=s.source_grid_error(t,start,duration,1),peak=float(np.max(np.abs(master)))*.76,entryPeak=float(np.max(np.abs(master[:fade])))*.76,exitPeaks=peaks)
   accepted=decision(e);result=dict(trackId=t['id'],title=t['title'],startFrame=first,lengthFrames=length,accepted=accepted,evidence=e);results.append(result)
   if accepted:
    p=dict(schema='harbeat.loop-extension.v1',scope='normal-playback-lab',producer='jetson',approved=True,implementationSha256=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),title=t['title'],sampleRate=s.SR,bpm=t['bpm'],nativeGain=.76,fadeSeconds=.008,startFrame=first,lengthFrames=length,maxCycles=16,source=proof,evidence=e);p['id']=hashlib.sha256(json.dumps(p,sort_keys=True,separators=(',',':')).encode()).hexdigest();data=json.dumps(p,ensure_ascii=False,indent=2,allow_nan=False).encode();sha=hashlib.sha256(data).hexdigest();(args.output/(sha+'.json')).write_bytes(data);result.update(id=p['id'],sha256=sha,url='/listen/loop-extension/v1/'+sha+'.json')
   print(json.dumps(result,ensure_ascii=False),flush=True)
 (args.output/'measurements.json').write_text(json.dumps(results,ensure_ascii=False,indent=2,allow_nan=False));index=dict(schema='harbeat.loop-extension-index.v1',loops=[{k:r[k] for k in ['id','sha256','url','trackId','startFrame']} for r in results if r['accepted']]);(args.output/'index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__)
 for k in ['metadata','scan','output']:p.add_argument('--'+k,type=pathlib.Path,required=True)
 p.add_argument('--nas',type=pathlib.Path,default=pathlib.Path('/mnt/nas/harbeat/preprocess'));p.add_argument('--reports',type=pathlib.Path,default=pathlib.Path('/mnt/nas/harbeat/data/analysis-platform/reports'));p.add_argument('--execution-root',type=pathlib.Path,default=pathlib.Path('/mnt/nas/harbeat/preprocess/device-execution-v1'));run(p.parse_args())
