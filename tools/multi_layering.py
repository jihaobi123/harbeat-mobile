#!/usr/bin/env python3
"""Source-bound Jetson additive percussion experiment; original AB stays exact."""
import argparse,hashlib,json,math,pathlib,socket

def layer_points(beat,duration,gain):
 return [[0,0],[16*beat,0],[17*beat,gain],[27*beat,gain],[28*beat,0],[duration,0]]

def projection_gain(dot,energy):
 return max(-1.,min(1.,dot/max(1e-20,energy)))

def decide(e,count):
 limits={'peak':.95,'lowEnergyRatio':1.1,'onsetGrowth':1.35,'maximumDrumSources':3,'melodyClash':.35,'vocalMaxDb':-45,'beatErrorMs':50,'loopSeamDb':-20,'reconstruction':.25}
 pairs=['A/C','B/C']+(['A/D','B/D','C/D']if count==4 else[])
 if count not in (3,4)or not isinstance(e.get('pairwise'),dict)or set(e['pairwise'])!=set(pairs):return False
 for pair in pairs:
  p=e['pairwise'][pair]
  if any(not isinstance(p.get(k),(int,float))or not math.isfinite(p[k])or not 0<=p[k]<=limit for k,limit in [('pitchedClash',.35),('beatErrorMs',50)]):return False
 return(e.get('sourceVerified')is True and e.get('baseUnchanged')is True and e.get('sourceCount')==count and e.get('vocalClear')is True and all(isinstance(e.get(k),(int,float))and math.isfinite(e[k])and e[k]<=v for k,v in limits.items())and -50<=e.get('addedRmsDb',0)<=-12 and len(e.get('exitPeaks',[]))==3 and all(math.isfinite(x['peak'])and 0<=x['peak']<=.95 for x in e['exitPeaks']))

def run(args):
 import longmix_scene as s
 s.audio_dependencies();import scipy.signal as sig
 np=s.np;sf=s.sf;sr=s.SR;s.STRETCH_CLI=args.stretch
 tracks=s.load_tracks(args.metadata);scan=json.loads(args.scan.read_text());args.output.mkdir(parents=True,exist_ok=True);results=[];published=[]
 verified={}
 def signature(paths):return {k:(str(p),p.stat().st_ino,p.stat().st_size,p.stat().st_mtime_ns)for k,p in paths.items()}
 def source(t):
  if t['id']in verified:
   paths,proof,stamp=verified[t['id']]
   if signature(paths)!=stamp:raise ValueError('verified source file changed during measurement')
   return paths,proof
  paths,proof=s.source_assets(t,args.nas,args.reports);proof=s.profile_proof(t,proof,args.execution_root);verified[t['id']]=(paths,proof,signature(paths));return paths,proof
 for file in sorted(args.base.glob('*.json')):
  base=json.loads(file.read_text())
  if base.get('schema')!='harbeat.live-layering.v1':continue
  scene=base['scene'];a,b=(tracks[scene['sources'][k]['trackId']]for k in ('a','b'))
  # First control group is the previously approved 98 BPM family only.
  if scene['bpm']!=98 or not a['title'].startswith('GRILLZ'):continue
  paths={}
  for side,t in [('a',a),('b',b)]:
   paths[side],proof=source(t)
   if proof!=scene['sources'][side]:raise ValueError('AB proof changed')
  duration=scene['duration'];n=math.ceil((duration+.008)*sr);times=np.arange(n)/sr
  audio={}
  for side in ['a','b']:
   for role in (('drums','bass','other')if side=='a'else s.ROLES):
    start=scene['clips'][side+'Start'];d=(scene['clips']['aEnd']-start)if side=='a'else n/sr
    x=s.read_segment(paths[side][role],start,d)
    audio[side+'.'+role]=np.tile(x,(math.ceil(n/len(x)),1))[:n]if side=='a'else x
  def render(exit):
   parts={};out=np.zeros((n,2),np.float32)
   for layer in scene['layers']:
    k=layer['side']+'.'+layer['role'];p=layer['points'];g=np.interp(times,*zip(*p));mask=times>=exit['fadeStart'];v=np.interp(exit['fadeStart'],*zip(*p));alpha=np.minimum(1,(times[mask]-exit['fadeStart'])/(exit['at']-exit['fadeStart']));g[mask]=v*(1-alpha)+int(layer['side']=='b')*alpha
    parts[k]=audio[k]*(g*scene['sourceGains'][layer['side']]*scene['outputGain'])[:,None];out+=parts[k]
   return out,parts
  final,parts=render(scene['exits'][-1]);tonal=sum(x for k,x in parts.items()if k.endswith(('.bass','.other')))
  original_drums=sum(x for k,x in parts.items()if k.endswith('.drums'))
  candidate_rows=[r for r in scan if r['loops']and r['trackId']not in(a['id'],b['id'])]
  for c in candidate_rows:
   for ds in [[],*[ [d]for d in candidate_rows if d['trackId']!=c['trackId']]]:
    selected=[c]+ds;label=a['title']+'-'+b['title']+'-'+str(round(scene['clips']['aStart'],2))+'-'+c['title']+('-'+ds[0]['title']if ds else'');folder=args.output/label.replace('/','_');folder.mkdir(exist_ok=True)
    extras=[];layers=[];proofs={};source_evidence=[];pairwise={}
    try:
     for index,row in enumerate(selected):
      side='cd'[index];t=tracks[row['trackId']];files,proof=source(t)
      if proof!=row['proof']:raise ValueError('C/D proof changed')
      p=row['loops'][0];first=round(p['start']*sr);length=round(p['duration']*sr);start=first/sr;rate=scene['bpm']/t['bpm'];frames=round(length/rate);d=frames/sr
      # One master-guided WSOLA map is shared with the selected drum stem.
      stretched=s.stretch({'master':files['master'],'drums':files['drums'],'vocals':files['vocals']},start,d,rate);x=stretched['drums'][:frames]
      hpf_b,hpf_a=sig.butter(2,180,fs=sr,btype='highpass');filtered=sig.lfilter(hpf_b,hpf_a,np.tile(x,(3,1)),axis=0)[-frames:].astype(np.float32)
      vocal=s.read_segment(files['vocals'],start,length/sr);step=round(.05*sr);vmax=max(s.db(s.rms(vocal[i:i+step]-np.mean(vocal[i:i+step],axis=0)))for i in range(0,len(vocal),step)if len(vocal[i:i+step])>1)
      reference=s.read_segment(files['master'],start,length/sr);reconstructed=sum(s.read_segment(files[r],start,length/sr)for r in s.ROLES);reconstruction=s.rms(reconstructed-reference)/max(1e-12,s.rms(reference))
      source_vad_clear=not any(lo<start+length/sr+.1 and hi>start-.1 for lo,hi in t['vocals'])
      # Test the retained, filtered drum signal, not the omitted vocal stem.
      voice=stretched['vocals'][:frames];voice=sig.lfilter(hpf_b,hpf_a,np.tile(voice,(3,1)),axis=0)[-frames:]
      leakage=[]
      for offset in range(0,frames-step,step//2):
       v=voice[offset:offset+step].astype(float);v-=v.mean(axis=0);dr=filtered[offset:offset+step].astype(float);dr-=dr.mean(axis=0);coefficient=projection_gain(float(np.sum(dr*v)),float(np.sum(v*v)));leakage.append(s.rms(v*coefficient)*(.2 if index==0 else .1))
      leakage_db=s.db(max(leakage,default=1));clear=leakage_db<=-45
      concentrations=[]
      for offset in range(0,frames-4096,2048):
       spectrum=abs(np.fft.rfft(filtered[offset:offset+4096].mean(axis=1)*np.hanning(4096)))**2;freq=np.fft.rfftfreq(4096,1/sr);band=spectrum[(freq>=180)&(freq<=4000)];concentrations.append(float(np.sort(band)[-8:].sum()/max(1e-20,band.sum())))
      concentration=float(np.quantile(concentrations,.9))
      gain=.2 if index==0 else .1;points=layer_points(60/scene['bpm'],duration,gain);gain_array=np.interp(times,*zip(*points));extra=np.tile(filtered,(math.ceil(n/frames),1))[:n]*gain_array[:,None];extras.append(extra)
      layer=dict(source=side,role='drums',outputStart=0,sourceStartFrame=first,lengthFrames=length,rate=rate,loop=True,filter=dict(kind='highpass',frequency=180,q=math.sqrt(.5),warmupCycles=3),points=points);layers.append(layer);proofs[side]=proof
      source_evidence.append(dict(source=side,title=t['title'],start=start,sourceVadClear=source_vad_clear,sourceVocalMaxDb=vmax,tonalConcentration=concentration,vocalClear=clear,vocalMaxDb=leakage_db,beatErrorMs=s.source_grid_error(t,start,d,rate),loopSeamDb=s.loop_boundary(filtered),melodyClash=0 if concentration<=.5 else s.clash(tonal[round(16*60/98*sr):round(32*60/98*sr)],extra[round(16*60/98*sr):round(32*60/98*sr)])))
      sf.write(folder/(side+'-before-filter.wav'),x,sr,subtype='FLOAT')
      sf.write(folder/(side+'-processed.wav'),filtered,sr,subtype='FLOAT')
      source_evidence[-1]['reconstruction']=reconstruction
      for base_side in ['a','b']:
       pitched=sum(value for key,value in parts.items()if key.startswith(base_side+'.')and key.endswith(('.bass','.other')));pairwise[base_side.upper()+'/'+side.upper()]=dict(beatErrorMs=source_evidence[-1]['beatErrorMs'],pitchedClash=0 if concentration<=.5 else s.clash(pitched[round(16*60/98*sr):round(32*60/98*sr)],extra[round(16*60/98*sr):round(32*60/98*sr)]))
     addition=sum(extras);mixed=final+addition
     low_b,low_a=sig.butter(2,120,fs=sr,btype='lowpass')
     low_ratio=(s.rms(sig.lfilter(low_b,low_a,mixed,axis=0))/max(1e-12,s.rms(sig.lfilter(low_b,low_a,final,axis=0))))**2
     def onset_count(x):
      size=round(.012*sr);env=np.array([s.rms(x[i:i+size])for i in range(0,len(x),size)]);novel=np.maximum(0,np.diff(env));peaks,_=sig.find_peaks(novel,height=max(.001,float(np.max(novel))*.12),distance=4);return len(peaks)
     active=slice(round(16*60/98*sr),round(32*60/98*sr));growth=onset_count((original_drums+addition)[active])/max(1,onset_count(original_drums[active]));exit_peaks=[];drum_counts=[];onset_growths=[]
     for exit in scene['exits']:
      out,exit_parts=render(exit);extra=np.zeros_like(out);counts=np.zeros(n,dtype=np.int8)
      for key,part in exit_parts.items():
       if key.endswith('.drums'):counts+=(np.max(abs(part),axis=1)>1e-5).astype(np.int8)
      for pcm,layer in zip(extras,layers):
       points=layer['points'];g=np.interp(times,*zip(*points));mask=times>=exit['fadeStart'];v=np.interp(exit['fadeStart'],*zip(*points));g[mask]=v*np.maximum(0,1-(times[mask]-exit['fadeStart'])/(exit['at']-exit['fadeStart']));original_g=np.interp(times,*zip(*points));safe=np.divide(pcm,original_g[:,None],out=np.zeros_like(pcm),where=original_g[:,None]>0)*g[:,None];extra+=safe;counts+=(np.max(abs(safe),axis=1)>1e-5).astype(np.int8)
      drum_counts.append(int(np.max(counts)));ed=sum(part for key,part in exit_parts.items()if key.endswith('.drums'));onset_growths.append(onset_count((ed+extra)[active])/max(1,onset_count(ed[active])))
      out+=extra;end=round(exit['at']*sr);fade=round(.008*sr);alpha=(np.arange(fade)/(sr*.008))[:,None];body=s.read_segment(paths['b']['master'],exit['bPosition'],16)*base['nativeGain'];handoff=out[end:end+fade]*(1-alpha)+body[:fade]*alpha
      exit_peaks.append(dict(at=exit['at'],peak=max(float(np.max(abs(out[:end]))),float(np.max(abs(handoff))),float(np.max(abs(body))),base['entry']['peak'])))
     if len(extras)==2:pairwise['C/D']=dict(pitchedClash=0 if all(x['tonalConcentration']<=.5 for x in source_evidence)else s.clash(extras[0][active],extras[1][active]),beatErrorMs=max(x['beatErrorMs']for x in source_evidence))
     e=dict(reconstruction=max(x['reconstruction']for x in source_evidence),sourceVerified=True,baseUnchanged=True,producerHost=socket.gethostname(),sourceCount=2+len(selected),peak=max(x['peak']for x in exit_peaks),lowEnergyRatio=low_ratio,addedRmsDb=s.db(s.rms(addition[active])),onsetGrowth=max(onset_growths),maximumDrumSources=max(drum_counts),melodyClash=max(x['melodyClash']for x in source_evidence),vocalMaxDb=max(x['vocalMaxDb']for x in source_evidence),vocalClear=all(x['vocalClear']for x in source_evidence),beatErrorMs=max(x['beatErrorMs']for x in source_evidence),loopSeamDb=max(x['loopSeamDb']for x in source_evidence),exitPeaks=exit_peaks,sources=source_evidence,pairwise=pairwise)
     for source_files,_,stamp in verified.values():
      if signature(source_files)!=stamp:raise ValueError('source changed during processing')
     from live_longmix_scene import canonical_scene_bytes
     e['arrangement']=dict(base=base,sources=proofs,layers=layers);e['arrangementSha256']=hashlib.sha256(canonical_scene_bytes(e['arrangement'])).hexdigest()
     accepted=decide(e,2+len(selected));metrics=json.dumps(e,ensure_ascii=False,indent=2,allow_nan=False).encode();(folder/'measurements.json').write_bytes(metrics)
     if accepted:
      public_e={k:e[k]for k in ['sourceVerified','peak','lowEnergyRatio','addedRmsDb','exitPeaks']};public_e['checks']={k:e[k]for k in ['reconstruction','vocalClear','vocalMaxDb','beatErrorMs','loopSeamDb','melodyClash','onsetGrowth','maximumDrumSources']}
      public_e['pairwise']=pairwise
      public_e['arrangementSha256']=e['arrangementSha256']
      public_e.update(pairwisePass=True,aggregatePass=True,measurementsSha256=hashlib.sha256(metrics).hexdigest())
      approval=dict(schema='harbeat.multi-layering.v1',scope='normal-playback-lab',producer='jetson',approved=True,mode='additive',base=base,sources=proofs,layers=layers,evidence=public_e,implementationSha256=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest());approval['id']=hashlib.sha256(json.dumps(approval,sort_keys=True,separators=(',',':')).encode()).hexdigest();data=json.dumps(approval,ensure_ascii=False,indent=2,allow_nan=False).encode();sha=hashlib.sha256(data).hexdigest();(args.output/(sha+'.json')).write_bytes(data);published.append(dict(baseId=base['id'],sha256=sha,url='/listen/multi-layering/v1/'+sha+'.json',sources=len(selected)))
      # These are listening references only, not device execution media.
      sf.write(folder/'AB.wav',final[:round(duration*sr)],sr,subtype='PCM_24');sf.write(folder/'combined.wav',mixed[:round(duration*sr)],sr,subtype='PCM_24')
      (folder/'approval.json').write_bytes(data)
      inputs=folder/'runtime-inputs';inputs.mkdir(exist_ok=True)
      for key,pcm in audio.items():
       samples=pcm[:round((scene['clips']['aEnd']-scene['clips']['aStart'])*sr)]if key.startswith('a.')else pcm
       sf.write(inputs/(key+'.wav'),samples,sr,subtype='FLOAT')
     result=dict(label=label,accepted=accepted,metrics={k:e[k]for k in ['peak','lowEnergyRatio','onsetGrowth','addedRmsDb','beatErrorMs','loopSeamDb','vocalMaxDb','melodyClash']},folder=str(folder))
    except Exception as error:result=dict(label=label,accepted=False,error=str(error))
    results.append(result);print(json.dumps(result,ensure_ascii=False),flush=True)
    (args.output/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2,allow_nan=False))
 (args.output/'index.json').write_text(json.dumps(dict(schema='harbeat.multi-layering-index.v1',scenes=published),ensure_ascii=False,indent=2))

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__)
 for k in ['base','metadata','scan','output','stretch']:p.add_argument('--'+k,type=pathlib.Path,required=True)
 p.add_argument('--nas',type=pathlib.Path,default=pathlib.Path('/mnt/nas/harbeat/preprocess'));p.add_argument('--reports',type=pathlib.Path,default=pathlib.Path('/mnt/nas/harbeat/data/analysis-platform/reports'));p.add_argument('--execution-root',type=pathlib.Path,default=pathlib.Path('/mnt/nas/harbeat/preprocess/device-execution-v1'));run(p.parse_args())
