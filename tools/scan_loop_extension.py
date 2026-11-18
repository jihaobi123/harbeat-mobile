#!/usr/bin/env python3
"""Propose loops on Jetson; final independent measurement still required."""
import argparse,pathlib,json,sys
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=pathlib.Path,required=True);p.add_argument('--track',action='append',required=True);args=p.parse_args();root=args.root;sys.path.insert(0,str(pathlib.Path(__file__).parent));import longmix_scene as s
s.audio_dependencies();np=s.np;tracks=s.load_tracks(root/'metadata');nas=pathlib.Path('/mnt/nas/harbeat/preprocess');results=[]
for tid in args.track:
 t=tracks[tid];paths,proof=s.source_assets(t,nas,pathlib.Path('/mnt/nas/harbeat/data/analysis-platform/reports'));audio={k:s.read_segment(p,0,t['duration']-.02) for k,p in paths.items()};proposals=[]
 for bar in t['alignment']['bars']:
  start=bar['start'];duration=960/t['bpm'];n=round(duration*s.SR)
  if start<12 or start+duration+16>=t['duration'] or any(a<start+duration+.1 and b>start-.1 for a,b in t['vocals']):continue
  for ms in range(-25,26):
   pos=start+ms/1000;l=round(pos*s.SR);x={k:v[l:l+n] for k,v in audio.items()}
   if any(len(z)!=n for z in x.values()):continue
   seam=max(s.loop_boundary(x[k]) for k in ['master','drums','bass','other']);vocal=s.db(s.rms(x['vocals']));peak=float(np.max(np.abs(x['master'])))*.76
   if seam<=-20 and vocal<=-45 and peak<=.95:proposals.append(dict(start=pos,barStart=start,bars=4,seam=seam,vocalDb=vocal,peak=peak,grid=s.source_grid_error(t,pos,duration,1)))
 out=[]
 for row in sorted(proposals,key=lambda r:r['seam']):
  if row['grid']>50 or any(abs(row['start']-old['start'])<8 for old in out):continue
  # Re-read each final proposal independently; scanning whole decoded files
  # does not approve a source window.
  row['start']=round(row['start']*s.SR)/s.SR;x={k:s.read_segment(p,row['start'],960/t['bpm']) for k,p in paths.items()};row['actualSeam']=max(s.loop_boundary(x[k]) for k in ['master','drums','bass','other']);row['actualPeak']=float(np.max(np.abs(x['master'])))*.76
  row['actualVocalDb']=s.db(s.rms(x['vocals']))
  if row['actualSeam']> -20 or row['actualPeak']>.95 or row['actualVocalDb']> -45:continue
  out.append(row)
  if len(out)>=4:break
 result=dict(track=tid,title=t['title'],bpm=t['bpm'],proposals=len(proposals),selected=out);results.append(result);(root/'loop-scan-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False),flush=True)
