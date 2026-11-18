#!/usr/bin/env python3
"""Jetson-only four-role auditions; never writes production catalogues."""
import argparse, copy, hashlib, itertools, json, math, pathlib, socket, subprocess, tempfile, shutil, collections, atexit, signal
from four_role import validate_steps, approve, projected_rms, reviewable, vocal_schedule, coactivity_seconds, target_rate, source_grid_error, ScanBudget, replace_accompaniment, original_vocal_gap
from four_role_cache import VerifiedCache
from four_role_vocal_candidates import merge_vocal_intervals, phrase_window, rank_vocal_windows
from four_role_local_rank import FeatureSeries, local_fit, fit_order, score_windows, distinct_phrases
import longmix_scene as s


def run(args):
    s.audio_dependencies()
    import numpy as np
    import scipy.signal as sig
    s.STRETCH_CLI = args.stretch
    algorithm_paths=dict(scan=pathlib.Path(__file__),rules=pathlib.Path(__file__).with_name('four_role.py'),cache=pathlib.Path(__file__).with_name('four_role_cache.py'),vocalRanking=pathlib.Path(__file__).with_name('four_role_vocal_candidates.py'),localRanking=pathlib.Path(__file__).with_name('four_role_local_rank.py'),measure=args.measure,stretch=args.stretch,longmix=pathlib.Path(s.__file__))
    algorithms={k:s.sha(p) for k,p in algorithm_paths.items()}
    sr = 44100
    tracks = s.load_tracks(args.metadata)
    base = json.loads(args.base.read_text()); scene = base['scene']
    target_bpm=scene['bpm'];target_rate(target_bpm,target_bpm)
    if not 60<=target_bpm<=120:raise ValueError('base target BPM outside original scope')
    budget=ScanBudget(**{k:getattr(args,k,default) for k,default in ScanBudget.DEFAULTS.items()})
    duration = scene['duration']; n = math.ceil((duration+.008)*sr); times = np.arange(n)/sr
    beat = 60/scene['bpm']; left, right = args.extra_start_beat*beat, args.extra_end_beat*beat
    if args.extra_start_beat not in (4,8,12,16) or not 8<=args.extra_end_beat-args.extra_start_beat<=12 or args.extra_end_beat>28:raise ValueError('extra role must finish before first approved exit fade')
    args.output.mkdir(parents=True, exist_ok=True)
    files, proofs, stamps = {}, {}, {}
    def save_sources():
        value=dict(schema='harbeat.four-role-source-snapshot.v1',targetBpm=target_bpm,baseId=base.get('id'),baseSha256=s.sha(args.base),implementations=algorithms,tracks={tid:dict(proof=proofs[tid],files={role:dict(path=str(path),size=stamps[tid][role][0],mtime_ns=stamps[tid][role][1])for role,path in fs.items()})for tid,fs in files.items()})
        temp=args.output/'source-snapshot.json.tmp';temp.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False));temp.replace(args.output/'source-snapshot.json')
    source_cache_root=tempfile.TemporaryDirectory(prefix='harbeat-four-role-cache-');atexit.register(source_cache_root.cleanup)
    source_cache=VerifiedCache(source_cache_root.name,512*1024*1024);expected={};decode=s.read_segment
    def cleanup_signal(signum,frame):source_cache_root.cleanup();raise SystemExit(128+signum)
    signal.signal(signal.SIGTERM,cleanup_signal)
    def read_cached(path,start,length):
        path=pathlib.Path(path);key=str(path)
        if key not in expected:raise ValueError('source not verified for temporary cache')
        target=source_cache.stage(path,expected[key])
        return decode(target,start,length)
    s.read_segment=read_cached
    def source(t):
        if t['id'] not in files:
            print(json.dumps(dict(kind='verifying-source',title=t['title'])),flush=True)
            f, p = s.source_assets(t, args.nas, args.reports)
            p = s.profile_proof(t, p, args.execution)
            files[t['id']], proofs[t['id']] = f, p
            stamps[t['id']] = {k:(v.stat().st_size, v.stat().st_mtime_ns) for k,v in f.items()}
            for k,path in f.items():expected[str(path)]=p['masterSha256'] if k=='master' else p['stemSha256'][k]
            save_sources()
        return files[t['id']], proofs[t['id']]
    a,b = (tracks[scene['sources'][k]['trackId']] for k in 'ab')
    raw, layers = {}, []
    for side,t in [('a',a),('b',b)]:
        f,p = source(t)
        if p != scene['sources'][side]: raise ValueError('original A/B source changed')
        for original in [x for x in scene['layers'] if x['side']==side]:
            role=original['role']; length=(scene['clips']['aEnd']-scene['clips']['aStart']) if side=='a' else n/sr
            x=s.read_segment(f[role], scene['clips'][side+'Start'], length)
            key=side+'.'+role;raw[key]=x
            layers.append(dict(key=key, source=side, role=role, loop=side=='a', outputStart=0,
                               sourceStart=scene['clips'][side+'Start'], rate=1,
                               gain=scene['sourceGains'][side]*scene['outputGain'], points=original['points']))
    def render(ls, pcm, exit):
        parts={};out=np.zeros((n,2),np.float32)
        for l in ls:
            x=pcm[l['key']]; start=round(l['outputStart']*sr)
            z=np.zeros((n,2),np.float32)
            length=n-start
            if l['loop']: z[start:]=np.tile(x,(math.ceil(length/len(x)),1))[:length]
            else: z[start:start+min(length,len(x))]=x[:length]
            g=np.interp(times,*zip(*l['points']))*l['gain']
            mask=times>=exit['fadeStart'];v=np.interp(exit['fadeStart'],*zip(*l['points']))*l['gain']
            alpha=np.minimum(1,(times[mask]-exit['fadeStart'])/(exit['at']-exit['fadeStart']))
            target=scene['sourceGains']['b']*scene['outputGain'] if l['source']=='b' else 0
            g[mask]=v*(1-alpha)+target*alpha
            part=z*g[:,None]; parts[l['key']]=part.astype(np.float32);out+=part
        return out,parts
    reference,original_parts=render(layers,raw,scene['exits'][-1])
    active_window=slice(round(left*sr),round(right*sr))
    # C changes B.other only. B's original vocals remain intact and participate
    # in the unchanged processed-role compatibility checks with C.
    cross=[[0,0],[left,0],[left+beat,1],[right-beat,1],[right,0],[duration,0]]
    def role_map(ls):return {r:[x for x in ls if x['role']==r] for r in s.ROLES}
    def pairwise(ls,pcm,exit,folder):
        folder.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='harbeat-four-role-pairs-') as temp:
            work=pathlib.Path(temp);mapping={};curves={};frames=round(exit['at']*sr)
            for l in ls:
                x=pcm[l['key']];start=round(l['outputStart']*sr);z=np.zeros((frames,2),np.float32);length=frames-start
                if length<=0:continue
                if l['loop']:z[start:]=np.tile(x,(math.ceil(length/len(x)),1))[:length]
                else:z[start:start+min(length,len(x))]=x[:length]
                z*=l['gain'];side,role=l['source'],l['role'];path=work/(l['key']+'.f32le');z.astype('<f4').tofile(path);mapping.setdefault(side,{})[role]=str(path)
                points=[p for p in l['points'] if p[0]<exit['fadeStart']]
                points=points+[[exit['fadeStart'],float(np.interp(exit['fadeStart'],*zip(*l['points'])))],[exit['at'],int(side=='b')]]
                curves.setdefault(side,{})[role]=points
            job=work/'job.json';job.write_text(json.dumps(dict(files=mapping,curves=curves,frames=frames,bpm=scene['bpm'],result=str(work/'result.json'))))
            subprocess.run(['/usr/local/bin/node',str(args.measure),str(job)],check=True,timeout=120)
            result=json.loads((work/'result.json').read_text());(folder/'result.json').write_text(json.dumps(result))
            return result
    # Local FFT screening matches the existing chroma cosine metric; final checks
    # run the unchanged phone measureStemCompatibility implementation above.
    def chroma(x):
        mono=x.mean(axis=1); size=2**int(np.floor(np.log2(min(len(mono),32768))))
        f=np.fft.rfftfreq(size,1/sr);keep=(f>=40)&(f<=4000);bins=np.floor(69+12*np.log2(f[keep]/440)+.5).astype(int)%12
        p=np.zeros(12)
        for at in range(0,max(1,len(mono)-size+1),size):
            power=abs(np.fft.rfft(mono[at:at+size]*np.hanning(size)))**2;p+=np.bincount(bins,weights=power[keep],minlength=12)
        return p/max(1e-20,np.linalg.norm(p))
    bass=original_parts['b.bass'][active_window];bass_chroma=chroma(bass)
    results=[];proposals=[];reconstruction={}
    def save_budget():
        state=dict(targetBpm=target_bpm,baseId=base.get('id'),sceneDuration=duration,**budget.snapshot())
        temp=args.output/'budget.json.tmp';temp.write_text(json.dumps(state,ensure_ascii=False,indent=2));temp.replace(args.output/'budget.json')
    def record(row):
        row.setdefault('targetBpm',target_bpm);results.append(row);save_budget();(args.output/'scan-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));print(json.dumps(row,ensure_ascii=False),flush=True)
    execution={r['trackId']:r for r in json.loads((args.execution/'index.json').read_text())['tracks']};ready=set(execution)
    c_hints=json.loads(args.c_proposals.read_text())if args.c_proposals else None
    d_hints=json.loads(args.d_proposals.read_text())if args.d_proposals else None
    rank={};local_mode=getattr(args,'retained_ranking',False);profile_series={};local_ranks={}
    retained={};support=[]
    if local_mode:
        rank_frames=round(scene['exits'][0]['fadeStart']*sr)
        for key in ['a.drums','a.bass','a.other','b.bass','b.other','b.vocals']:
            part=original_parts[key][:rank_frames]
            if key=='b.other':part=part*(1-np.interp(times[:rank_frames],*zip(*cross)))[:,None]
            features=FeatureSeries.from_pcm(part,sr)
            if key=='a.drums':support.append(features)
            else:retained[key]=features
        support.append(retained['b.bass'])
    def profile_role(t,role):
        key=(t['id'],role)
        if key not in profile_series:
            path=args.execution/'profiles'/(execution[t['id']]['profile']['sha256']+'.json')
            profile_series[key]=FeatureSeries.from_profile(json.loads(path.read_text())['stems'][role]['frames'])
        return profile_series[key]
    def local_c(features,start,rate,gain):
        return local_fit(features,source_start=start,rate=rate,output_start=left,output_end=right,
                         gain=gain,points=cross,retained=retained,support=support)
    def estimated_c_gain(features,start,rate):
        rms=10**(features.rms_db(start,start+(right-left)*rate)/20)
        return float(np.clip(s.rms(original_parts['b.other'][active_window])/max(1e-12,rms)/scene['outputGain'],.5,2))*scene['outputGain']
    def eligible(t,side):
        if t['id'] in (a['id'],b['id']):return False
        reason=None
        if t['id'] not in ready:reason='source-profile-unavailable'
        else:
            try:
                if not .95<=target_rate(target_bpm,t['bpm'])<=1.05:reason='tempo-outside-original-range'
            except ValueError:reason='invalid-tempo'
        if reason:record(dict(kind=side+'-source-rejected',trackId=t['id'],title=t['title'],reason=reason,sourceBpm=t.get('bpm') if type(t.get('bpm')) in (int,float) and math.isfinite(t['bpm']) else str(t.get('bpm'))))
        return reason is None
    eligible_c=[t for t in tracks.values() if eligible(t,'C')]
    eligible_d=[]
    def check_hints(hints,t):
        for hint in hints or []:
            if hint['trackId']!=t['id']:continue
            rate=target_rate(target_bpm,t['bpm'])
            if hint.get('targetBpm',target_bpm)!=target_bpm or not math.isclose(hint.get('rate',rate),rate,rel_tol=1e-10,abs_tol=1e-12):raise ValueError('proposal target tempo does not match base scene')
    save_budget()
    # Profiles rank proposals only. Raw whole-window chroma is never an
    # acceptance gate; the retained roles and real curves decide below.
    for t in eligible_c:
        try:
            profile=args.execution/'profiles'/(execution[t['id']]['profile']['sha256']+'.json')
            rows=json.loads(profile.read_text())['stems']['other']['frames'];starts=np.array([r['start'] for r in rows]);weights=np.array([10**(r['rmsDb']/10)for r in rows]);vectors=np.array([r.get('chroma') or [0]*12 for r in rows])*weights[:,None];summed=np.vstack([np.zeros(12),np.cumsum(vectors,axis=0)]);scores=[]
            for bar in t['alignment']['bars']:
                i,j=np.searchsorted(starts,[bar['start'],bar['start']+(right-left)*target_rate(target_bpm,t['bpm'])]);v=summed[j]-summed[i]
                if j>i and np.mean(weights[i:j])>10**(-35/10):scores.append(1-float(np.dot(v/max(1e-20,np.linalg.norm(v)),bass_chroma)))
            rank[t['id']]=min(scores,default=2)
            if local_mode:
                features=profile_role(t,'other');rate=target_rate(target_bpm,t['bpm'])
                fits=[local_c(features,bar['start'],rate,estimated_c_gain(features,bar['start'],rate))for bar in t['alignment']['bars'] if bar['start']>=1 and bar['start']+(right-left)*rate+1<t['duration']]
                if fits:local_ranks[t['id']]=min(fits,key=fit_order)
        except Exception as error:
            rank[t['id']]=2;record(dict(kind='profile-ranking-unavailable',trackId=t['id'],title=t['title'],error=str(error)))
    (args.output/'profile-ranking.json').write_text(json.dumps([dict(trackId=k,title=tracks[k]['title'],targetBpm=target_bpm,sourceBpm=tracks[k]['bpm'],score=v,**({'localFit':local_ranks.get(k)}if local_mode else {}))for k,v in sorted(rank.items(),key=lambda x:x[1])],ensure_ascii=False,indent=2))
    for t in sorted(eligible_c,key=lambda t:(*fit_order(local_ranks.get(t['id'])),rank.get(t['id'],3),t['id'])if local_mode else (bool(t['vocals']) if args.voice_review else False,rank.get(t['id'],3),t['id'])):
        if args.c_track and t['id']not in args.c_track:continue
        if c_hints is not None and not any(r['trackId']==t['id']for r in c_hints):continue
        if not budget.take('c','track',t['id']):
            record(dict(kind='budget-truncated',stage='C',resource='tracks',trackId=t['id'],title=t['title']));continue
        try:
            check_hints(c_hints,t)
            f,p=source(t);rate=target_rate(target_bpm,t['bpm']);source_duration=(right-left)*rate;other=s.read_segment(f['other'],0,t['duration']-.03)if c_hints is None else None
            candidates=[];preliminary=collections.Counter()
            for bar in t['alignment']['bars']if c_hints is None else []:
                start=bar['start']
                if start<1 or start+source_duration+1>=t['duration']:
                    preliminary['source-window-coverage']+=1;continue
                for shift in [-.012,0,.012]:
                    pos=round((start+shift)*sr)/sr;x=other[round(pos*sr):round((pos+source_duration)*sr)]
                    if len(x)<2048 or s.db(s.rms(x))< -35:
                        preliminary['short-or-quiet-accompaniment']+=1;continue
                    risk=float(1-np.dot(chroma(x),bass_chroma))
                    candidates.append((risk,pos))
            if c_hints is not None:candidates=[(r['risk'],r['start'])for r in c_hints if r['trackId']==t['id']]
            shortlist=[];attempted=[];window_fits={}
            if local_mode:
                features=profile_role(t,'other')
                window_fits={pos:local_c(features,pos,rate,estimated_c_gain(features,pos,rate))for _,pos in candidates}
            ordered=sorted(candidates,key=lambda r:(*fit_order(window_fits.get(r[1])),r[0],r[1])if local_mode else r)
            if local_mode:record(dict(kind='C-local-ranking',trackId=t['id'],rankingOnly=True,candidates=len(ordered),top=[dict(start=pos,globalRisk=risk,localFit=window_fits[pos])for risk,pos in ordered[:8]]))
            for candidate_index,(risk,start) in enumerate(ordered):
                if any(abs(start-z)<source_duration for z in attempted):continue
                if not budget.take('c','window',t['id']):
                    record(dict(kind='budget-truncated',stage='C',resource='windows',trackId=t['id'],remainingCandidates=len(candidates)-candidate_index));break
                attempted.append(start);record(dict(kind='C-window',trackId=t['id'],title=t['title'],start=start,rate=rate,attempt=len(attempted)))
                stretched=s.stretch({'master':f['master'],'other':f['other'],'vocals':f['vocals']},start,right-left,rate)
                x=stretched['other'][:round((right-left)*sr)];grid=source_grid_error(t,start,right-left,rate,target_bpm)
                if grid>50:record(dict(kind='C-window-rejected',trackId=t['id'],title=t['title'],start=start,reason='beat-grid',measured=grid));continue
                gain=float(np.clip(s.rms(original_parts['b.other'][active_window])/max(1e-12,s.rms(x))/scene['outputGain'],.5,2))*scene['outputGain']
                if c_hints is not None:
                    gain=next(r['gain']for r in c_hints if r['trackId']==t['id']and abs(r['start']-start)<.0001)
                    if not math.isfinite(gain)or not .25<=gain<=1:raise ValueError('C gain outside original source-gain range')
                voice=stretched['vocals'][:len(x)];step=round(.05*sr);residual=[]
                for i in range(0,len(x)-step,step//2):
                    v=voice[i:i+step].astype(float);v-=v.mean(axis=0);z=x[i:i+step].astype(float);z-=z.mean(axis=0)
                    residual.append(projected_rms(float(np.sum(z*v)),float(np.sum(v*v)),v.size)*gain)
                leak=s.db(max(residual,default=1))
                if leak> -45 and not args.voice_review:record(dict(kind='C-window-rejected',trackId=t['id'],title=t['title'],start=start,reason='vocal-projection',measured=leak));continue
                master=s.read_segment(f['master'],start,source_duration);recon=sum(s.read_segment(f[r],start,source_duration) for r in s.ROLES)
                reconstruction[t['id']]=s.rms(recon-master)/max(1e-12,s.rms(master))
                if reconstruction[t['id']]>.25:record(dict(kind='C-window-rejected',trackId=t['id'],title=t['title'],start=start,reason='reconstruction',measured=reconstruction[t['id']]));continue
                row=dict(trackId=t['id'],title=t['title'],targetBpm=target_bpm,start=start,rate=rate,loop=False,seam=scene['evidence']['loopSeamDb'],boundaryJumpDb=s.loop_boundary(x),grid=grid,leak=leak,referenceVocalRmsDb=s.db(s.rms(voice)*gain),sourceVocalOverlapSeconds=sum(max(0,min(start+source_duration,hi)-max(start,lo))for lo,hi in t['vocals']),risk=risk,gain=gain)
                if local_mode:row['localFit']=local_c(FeatureSeries.from_pcm(x,sr),0,1,gain)
                shortlist.append(row);cache=args.output/('candidate-'+t['id']+'-'+str(round(start*sr))+'.wav');s.sf.write(cache,x,sr,subtype='FLOAT');row['pcm']=str(cache)
            proposals+=shortlist;record(dict(kind='melody-scan',trackId=t['id'],title=t['title'],preliminaryExclusions=dict(preliminary),rankedCandidates=len(candidates),proposals=shortlist))
        except Exception as e:record(dict(kind='melody-scan',trackId=t['id'],title=t['title'],error=str(e)))
    (args.output/'melody-proposals.json').write_text(json.dumps(proposals,ensure_ascii=False,indent=2))
    # D is scanned separately; only complete, naturally ending phrases inside
    # the original B silence are candidates. No loop or breath-based cut.
    voices=[]
    if proposals:eligible_d=[t for t in tracks.values() if eligible(t,'D') and t['vocals']]
    else:record(dict(kind='D-blocked-no-C',reason='blocked-no-C',explanation='没有 C proposal，D 未扫描；不代表 D 素材不合格'))
    c_contexts={}
    if local_mode:
        for c in proposals:
            pcm=s.sf.read(c['pcm'],dtype='float32',always_2d=True)[0]
            gain=np.interp(left+np.arange(len(pcm))/sr,*zip(*cross))*c['gain']
            features=FeatureSeries.from_pcm(pcm*gain[:,None],sr,start=left)
            c_contexts[c['pcm']]=dict(trackId=c['trackId'],retained={**retained,'c.other':features},support=[*support,features])
    def local_d(features,timing,gain,rate,track_id):
        output_duration=round((timing['end']-timing['start'])/rate*sr)/sr
        end=timing['outputStart']+output_duration
        points=vocal_schedule(left,output_duration,timing['delayBeats'],target_bpm,scene['exits'][0]['fadeStart'],duration)['voicePoints']
        if not original_vocal_gap(b['vocals'],scene['clips']['bStart'],timing['outputStart'],end):
            raise ValueError('original B vocal would be cut')
        fits={key:local_fit(features,source_start=timing['start'],rate=rate,output_start=timing['outputStart'],output_end=end,gain=gain,points=points,retained=context['retained'],support=context['support'])for key,context in c_contexts.items()if context['trackId']!=track_id}
        return fits
    def annotate_timings(t,timings):
        features=profile_role(t,'vocals');rate=target_rate(target_bpm,t['bpm']);gain=scene['sourceGains']['b']*scene['outputGain']
        def evaluate(timing):
            fits=local_d(features,timing,timing.get('gain',gain),rate,t['id'])
            return dict(localFits=fits,localFit=min(fits.values(),key=fit_order,default=None))
        accepted,rejected=score_windows(timings,evaluate,limit=64)
        if rejected:record(dict(kind='D-local-window-rejected',trackId=t['id'],rankingOnly=True,windows=rejected))
        ordered=sorted(accepted,key=lambda timing:(timing['rawBoundaryDb']> -45,*fit_order(timing.get('localFit')),timing['rawBoundaryDb'],timing['delayBeats'],timing['start']))
        return distinct_phrases(ordered)
    d_profile_ranks={}
    if local_mode and d_hints is None:
        eligible_d=[t for t in eligible_d if any(context['trackId']!=t['id']for context in c_contexts.values())]
        for t in eligible_d:
            try:
                features=profile_role(t,'vocals');rate=target_rate(target_bpm,t['bpm'])
                starts=sorted({max(0.,v)for bar in t['alignment']['bars']for v in [bar['start']-60/t['bpm'],*bar['beats']]})
                timings=rank_vocal_windows(t['vocals'],starts,rate=rate,bpm=target_bpm,left=left,right=right,exit_fade=scene['exits'][0]['fadeStart'],duration=t['duration'],bed_intervals=b['vocals'],bed_source_start=scene['clips']['bStart'],rms_db=features.rms_db)
                ordered=annotate_timings(t,timings)
                if ordered:d_profile_ranks[t['id']]=ordered[0]
                record(dict(kind='D-local-profile-ranking',trackId=t['id'],title=t['title'],rankingOnly=True,feasibleTimings=len(timings),timingBudget=64,best=ordered[:1]))
            except Exception as error:record(dict(kind='D-local-ranking-unavailable',trackId=t['id'],error=str(error)))
    def voice_priority(t):
        tags=str(t.get('style',''))+' '+str(t.get('styleLabels',[]))+' '+t['title']
        return(not any(x in tags.lower() for x in ['hip','rap','wu tang','doom']),abs(t['bpm']-target_bpm))
    def d_source_order(t):
        timing=d_profile_ranks.get(t['id'])
        return (not bool(timing),bool(timing and timing['rawBoundaryDb']> -45),*fit_order(timing.get('localFit')if timing else None),t['id'])if local_mode else (voice_priority(t),t['id'])
    for t in sorted(eligible_d,key=d_source_order):
        if args.d_track and t['id']not in args.d_track:continue
        if d_hints is not None and not any(r['trackId']==t['id']for r in d_hints):continue
        if not budget.take('d','track',t['id']):
            record(dict(kind='budget-truncated',stage='D',resource='tracks',trackId=t['id'],title=t['title']));continue
        try:
            check_hints(d_hints,t)
            f,p=source(t);rate=target_rate(target_bpm,t['bpm'])
            merged=merge_vocal_intervals(t['vocals'])
            starts=sorted({max(0.,v) for bar in t['alignment']['bars'] for v in [bar['start']-60/t['bpm'],*bar['beats']]})
            if d_hints is None:
                raw_vocals=s.read_segment(f['vocals'],0,t['duration']-.03)
                def raw_boundary_db(lo,hi):
                    x=raw_vocals[round(lo*sr):round(hi*sr)]
                    return s.db(s.rms(x)) if len(x)>0 else float('inf')
                timings=rank_vocal_windows(merged,starts,rate=rate,bpm=target_bpm,left=left,right=right,
                    exit_fade=scene['exits'][0]['fadeStart'],duration=t['duration'],bed_intervals=b['vocals'],
                    bed_source_start=scene['clips']['bStart'],rms_db=raw_boundary_db)
                if local_mode:timings=annotate_timings(t,timings)
                del raw_vocals
                record(dict(kind='D-window-ranking',trackId=t['id'],title=t['title'],beatStarts=len(starts),
                            feasibleTimings=len(timings),top=timings[:budget.limits['max_d_windows']]))
            else:timings=[r for r in d_hints if r['trackId']==t['id']]
            attempted=0;preliminary=collections.Counter()
            for start_index,timing in enumerate(timings):
                start=timing['start'];delay=timing.get('delayBeats',0)
                if type(delay)not in(int,float)or not math.isfinite(delay)or delay!=int(delay)or not 0<=delay<=8:raise ValueError('D delay must preserve beat grid')
                d_output=left+delay*beat;safe_tail=scene['exits'][0]['fadeStart']-d_output-.15
                if d_hints is None:lo,hi,end=timing['phraseStart'],timing['phraseEnd'],timing['end']
                else:
                    phrase,reason=phrase_window(merged,start,start+safe_tail*rate,t['duration'],.65)
                    if phrase is None:preliminary[reason]+=1;continue
                    lo,hi,end=phrase
                d=end-start;output_duration=d/rate;sung=hi-lo
                if not budget.take('d','window',t['id']):
                    record(dict(kind='budget-truncated',stage='D',resource='windows',trackId=t['id'],remainingCandidates=len(timings)-start_index));break
                grid=source_grid_error(t,start,output_duration,rate,target_bpm)
                if grid>50:
                    record(dict(kind='D-window-rejected',trackId=t['id'],title=t['title'],start=start,reason='beat-grid',measured=grid));continue
                attempted+=1;record(dict(kind='D-window',trackId=t['id'],title=t['title'],start=start,rate=rate,outputDuration=output_duration,attempt=attempted))
                stretched=s.stretch({'master':f['master'],'vocals':f['vocals']},start,output_duration,rate);x=stretched['vocals'][:round(output_duration*sr)]
                head_db=s.db(s.rms(x[:round(.08*sr)]));tail_db=s.db(s.rms(x[-round(.15*sr):]))
                if head_db> -45 or tail_db> -45:
                    record(dict(kind='D-window-rejected',trackId=t['id'],title=t['title'],start=start,reason='vocal-boundaries',headDb=head_db,tailDb=tail_db));continue
                master=s.read_segment(f['master'],start,d);recon=sum(s.read_segment(f[r],start,d) for r in s.ROLES);reconstruction[t['id']]=s.rms(recon-master)/max(1e-12,s.rms(master))
                if reconstruction[t['id']]>.25:
                    record(dict(kind='D-window-rejected',trackId=t['id'],title=t['title'],start=start,reason='reconstruction',measured=reconstruction[t['id']]));continue
                voice_gain=timing.get('gain',scene['sourceGains']['b']*scene['outputGain'])
                if type(voice_gain)not in(int,float)or not math.isfinite(voice_gain)or not .25<=voice_gain<=1:raise ValueError('D gain outside original source-gain range')
                row=dict(trackId=t['id'],title=t['title'],targetBpm=target_bpm,start=start,rate=rate,grid=grid,vocalBoundary=dict(headMaxDb=head_db,tailMaxDb=tail_db,entryClear=True,tailComplete=True),sungSeconds=sung,outputDuration=output_duration,delayBeats=delay,outputStart=d_output,intervals=[v for v in merged if v[0]<end and v[1]>start],gain=voice_gain)
                if local_mode:
                    row['localFits']=local_d(FeatureSeries.from_pcm(x,sr),dict(start=0,end=len(x)/sr,outputStart=d_output,delayBeats=delay),voice_gain,1,t['id'])
                    row['localFit']=min(row['localFits'].values(),key=fit_order,default=None)
                cache=args.output/f"voice-{t['id']}-{round(start*sr)}-{len(x)}-{delay}.wav";s.sf.write(cache,x,sr,subtype='FLOAT');row['pcm']=str(cache);voices.append(row)
            record(dict(kind='voice-scan',trackId=t['id'],title=t['title'],attempts=attempted,preliminaryExclusions=dict(preliminary),proposals=[v for v in voices if v['trackId']==t['id']]))
        except Exception as e:record(dict(kind='voice-scan',trackId=t['id'],title=t['title'],error=str(e)))
    (args.output/'voice-proposals.json').write_text(json.dumps(voices,ensure_ascii=False,indent=2))
    for side,t in [('a',a),('b',b)]: reconstruction[t['id']]=scene['evidence']['reconstruction'][side]
    low_b,low_a=sig.butter(2,120,fs=sr,btype='lowpass');base_low=s.rms(sig.lfilter(low_b,low_a,reference,axis=0))
    def onsets(x):
        step=round(.012*sr);env=np.array([s.rms(x[i:i+step]) for i in range(0,len(x),step)])
        novel=np.maximum(0,np.diff(env));peaks,_=sig.find_peaks(novel,height=max(.001,float(np.max(novel))*.12),distance=4)
        return len(peaks)
    accepted=[];c_only=[]
    def write_case(name,steps,pcm,used,measurements):
        current={k:s.sha(p) for k,p in algorithm_paths.items()}
        if current!=algorithms:raise ValueError('producer implementation changed during measurement')
        for tid in [t['id']for t in used.values()]:
            if {k:(v.stat().st_size,v.stat().st_mtime_ns)for k,v in files[tid].items()}!=stamps[tid]:raise ValueError('source changed during measurement')
        validate_steps([role_map(z) for z in steps]);case=args.output/name;case.mkdir(exist_ok=True)
        assets={}
        for key in sorted({l['key'] for ls in steps for l in ls}):
            x=pcm[key];path=case/(key+'.wav');s.sf.write(path,x,sr,subtype='FLOAT');assets[key]=dict(url=key+'.wav',sha256=s.sha(path),frames=len(x))
        strict=all(approve(m,3+i)for i,m in enumerate(measurements[1:]));eligible=all(approve(m,3+i) or args.voice_review and reviewable(m,3+i)for i,m in enumerate(measurements[1:]))
        if not eligible:raise ValueError('non-reviewable quality failure')
        contract=dict(schema='harbeat.four-role-audition.v1',scope='audition-only',producer='jetson',producerHost=socket.gethostname(),implementations=algorithms,approved=strict,qualityStatus='approved-for-audition' if strict else 'needs-vocal-review',requiresReview=[] if strict else ['vocal-identity'],sampleRate=sr,duration=duration,bpm=scene['bpm'],base=base,window=[left,right],sources={k:dict(title=t['title'],proof=proofs[t['id']])for k,t in used.items()},assets=assets,stages=[dict(id=i,layers=z,evidence=measurements[i]) for i,z in enumerate(steps)],limitations=['other is separated accompaniment, not a certified single melodic instrument.','Coherent projection is not vocal identity; failing projection may require explicit human review.','Acoustic compatibility and VAD boundaries do not prove semantic phrase meaning or preference.','Audition only; production AB and phone fallback unchanged.'])
        contract['id']=hashlib.sha256(json.dumps(contract,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest();(case/'scene.json').write_text(json.dumps(contract,ensure_ascii=False,indent=2,allow_nan=False))
        for i,z in enumerate(steps):out,_=render(z,pcm,scene['exits'][-1]);s.sf.write(case/(str(i)+'-reference.wav'),out,sr,subtype='FLOAT')
        return dict(case=str(case),id=contract['id'],stages=len(steps),approved=strict,qualityStatus=contract['qualityStatus'])
    for c in sorted(proposals,key=lambda r:(*fit_order(r.get('localFit')),r['risk'],r['trackId'],r['start'])if local_mode else (r['risk'],r['trackId'],r['start'])):
        if not budget.take('c','check'):
            record(dict(kind='budget-truncated',stage='C',resource='checks',trackId=c['trackId'],start=c['start']));continue
        record(dict(kind='C-check-start',trackId=c['trackId'],start=c['start'],rate=c['rate']))
        cp=s.sf.read(c['pcm'],dtype='float32',always_2d=True)[0];raw_c={**raw,'c.other':cp}
        extra=dict(key='c.other',source='c',role='other',loop=False,outputStart=left,sourceStart=c['start'],rate=c['rate'],gain=c['gain'],points=cross)
        ls=replace_accompaniment(layers,extra,cross);pcm,parts=render(ls,raw_c,scene['exits'][-1]);folder=args.output/('check-c-'+str(len(results)));folder.mkdir(exist_ok=True)
        pair=pairwise(ls,raw_c,scene['exits'][-1],folder)
        def evidence(ls,raw,parts,pair,count,extra_grid,extra_seam,leak,ids):
            peaks=[];pair_results=[pair];low_ratios=[];growths=[];exit_checks=[]
            for index,exit in enumerate(scene['exits']):
                out,exit_parts=render(ls,raw,exit);base_out,_=render(layers,raw,exit);end=round(exit['at']*sr);f=round(.008*sr);alpha=(np.arange(f)/(sr*.008))[:,None];body=s.read_segment(files[b['id']]['master'],exit['bPosition'],16)*base['nativeGain']
                peaks.append(max(float(np.max(abs(out[:end]))),float(np.max(abs(out[end:end+f]*(1-alpha)+body[:f]*alpha))),float(np.max(abs(body))),base['entry']['peak']))
                low_ratios.append((s.rms(sig.lfilter(low_b,low_a,out[:end],axis=0))/max(1e-12,s.rms(sig.lfilter(low_b,low_a,base_out[:end],axis=0))))**2)
                growths.append(onsets(out[active_window])/max(1,onsets(base_out[active_window])))
                measured_pair=pair if index==2 else pairwise(ls,raw,exit,folder/('exit-'+str(index)))
                if index<2:pair_results.append(measured_pair)
                exit_checks.append(dict(at=exit['at'],pairwise=measured_pair,peak=peaks[-1],lowEnergyRatio=low_ratios[-1],onsetGrowth=growths[-1]))
            merged={k:{**pair[k], 'pass_':all(p[k]['pass_'] for p in pair_results),
                       'pitchedRisk':max(p[k]['pitchedRisk'] for p in pair_results),
                       'incompatiblePitchedSeconds':max(p[k]['incompatiblePitchedSeconds'] for p in pair_results)}for k in pair}
            e=dict(bpm=scene['bpm'],sourceVerified=True,peak=max(peaks),reconstruction=max(reconstruction[i] for i in ids),beatErrorMs=max(scene['evidence']['beatErrorMs'],extra_grid),loopSeamDb=max(scene['evidence']['loopSeamDb'],extra_seam),vocalMaxDb=leak,vocalBoundariesClear=True,originalVocalPreserved=True,lowEnergyRatio=max(low_ratios),onsetGrowth=max(growths),pairwise=merged,exitPeaks=peaks,exitChecks=exit_checks)
            return e
        e=evidence(ls,raw_c,parts,pair,3,c['grid'],c['seam'],c['leak'],[a['id'],b['id'],c['trackId']])
        record(dict(kind='C-check',C=c['title'],trackId=c['trackId'],start=c['start'],approved=approve(e,3),evidence=e))
        if not(approve(e,3)or args.voice_review and reviewable(e,3)):continue
        item=write_case('abc-'+str(len(c_only)+1),[layers,ls],raw_c,{'a':a,'b':b,'c':tracks[c['trackId']]},[base['evidence'],e]);item['C']=c;c_only.append(item)
        (args.output/'approved-c-only.json').write_text(json.dumps(c_only,ensure_ascii=False,indent=2))
        for d in sorted(voices,key=lambda row:fit_order(row.get('localFits',{}).get(c['pcm'])))if local_mode else voices:
            if d['trackId']==c['trackId']:continue
            voice=s.sf.read(d['pcm'],dtype='float32',always_2d=True)[0];allraw={**raw_c,'d.vocals':voice};allls=copy.deepcopy(ls)
            schedule=vocal_schedule(left,len(voice)/sr,d['delayBeats'],scene['bpm'],scene['exits'][0]['fadeStart'],duration)
            if not original_vocal_gap(b['vocals'],scene['clips']['bStart'],schedule['start'],schedule['end']):
                record(dict(kind='D-rejected',D=d['title'],trackId=d['trackId'],cTrackId=c['trackId'],start=d['start'],reason='original B vocal would be cut'));continue
            if not budget.take('d','check'):
                record(dict(kind='budget-truncated',stage='D',resource='checks',trackId=d['trackId'],cTrackId=c['trackId'],start=d['start']));continue
            record(dict(kind='D-check-start',trackId=d['trackId'],cTrackId=c['trackId'],start=d['start'],rate=d['rate']))
            bv=next(l for l in allls if l['key']=='b.vocals');bv['points']=schedule['bedPoints']
            dl=dict(key='d.vocals',source='d',role='vocals',loop=False,outputStart=schedule['start'],sourceStart=d['start'],rate=d['rate'],gain=d['gain'],points=schedule['voicePoints'])
            allls.append(dl);mix,allparts=render(allls,allraw,scene['exits'][-1]);folder=args.output/('check-d-'+str(len(results)));folder.mkdir(exist_ok=True);pair4=pairwise(allls,allraw,scene['exits'][-1],folder)
            e4=evidence(allls,allraw,allparts,pair4,4,max(c['grid'],d['grid']),c['seam'],c['leak'],[a['id'],b['id'],c['trackId'],d['trackId']])
            step=round(.05*sr);keys=['a.drums','b.bass','c.other','d.vocals'];coactive=[]
            for i in range(0,n,step):
                levels={k:s.rms(allparts[k][i:i+step]) for k in keys}
                if min(levels.values())>=10**(-45/20):coactive.append(dict(start=i/sr,end=min(n,i+step)/sr,rms=levels))
            e4['simultaneousFourRoleSeconds']=coactivity_seconds(coactive,sr)
            e4['roleProbe']=max(coactive,key=lambda r:min(r['rms'].values())) if coactive else None
            beatframes=round(beat*sr);beatrows=[];run=longest=0
            for first in range(round((left+beat)*sr),round((right-beat)*sr)-beatframes+1,beatframes):
                levels={k:s.rms(allparts[k][first:first+beatframes])for k in keys};all_roles_active=min(levels.values())>=10**(-45/20)
                run=run+1 if all_roles_active else 0;longest=max(longest,run);beatrows.append(dict(start=first/sr,end=(first+beatframes)/sr,rmsDb={k:s.db(v)for k,v in levels.items()},allRoles=all_roles_active))
            e4['roleProof']=dict(method='beat-participation-v1',coactivity50msSeconds=e4['simultaneousFourRoleSeconds'],longestConsecutiveBeats=longest,perBeat=beatrows)
            record(dict(kind='D-check',C=c['title'],D=d['title'],trackId=d['trackId'],cTrackId=c['trackId'],start=d['start'],approved=approve(e4,4),evidence=e4))
            if not(approve(e4,4)or args.voice_review and reviewable(e4,4)):continue
            used={'a':a,'b':b,'c':tracks[c['trackId']],'d':tracks[d['trackId']]}
            item=write_case('audition-'+str(len(accepted)+1),[layers,ls,allls],allraw,used,[base['evidence'],e,e4]);item.update(C=c,D=d)
            accepted.append(item);(args.output/'accepted.json').write_text(json.dumps(accepted,ensure_ascii=False,indent=2))
    for tid,stamp in stamps.items():
        if {k:(v.stat().st_size,v.stat().st_mtime_ns)for k,v in files[tid].items()}!=stamp:raise ValueError('source changed during audition')
    save_budget()
    print(json.dumps(dict(targetBpm=target_bpm,budget=budget.snapshot(),done=True,accepted=len(accepted),melodyProposals=len(proposals),voiceProposals=len(voices))))


def argument_parser():
    p=argparse.ArgumentParser()
    for k in ['metadata','base','output','stretch','measure','execution']:p.add_argument('--'+k,type=pathlib.Path,required=True)
    p.add_argument('--nas',type=pathlib.Path,default=pathlib.Path('/mnt/nas/harbeat/preprocess'))
    p.add_argument('--reports',type=pathlib.Path,default=pathlib.Path('/mnt/nas/harbeat/data/analysis-platform/reports'))
    p.add_argument('--retained-ranking',action='store_true',help='Rank actual local retained-role overlap; final raw gates are unchanged')
    p.add_argument('--voice-review',action='store_true',help='Emit explicitly unapproved auditions only when coherent projection is the sole unresolved gate')
    p.add_argument('--c-track',action='append');p.add_argument('--d-track',action='append')
    p.add_argument('--extra-end-beat',type=int,default=28)
    p.add_argument('--extra-start-beat',type=int,default=16)
    p.add_argument('--c-proposals',type=pathlib.Path);p.add_argument('--d-proposals',type=pathlib.Path)
    for name,default in ScanBudget.DEFAULTS.items():p.add_argument('--'+name.replace('_','-'),type=int,default=default)
    return p


if __name__=='__main__':
    run(argument_parser().parse_args())
