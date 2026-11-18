#!/usr/bin/env python3
"""Isolated two-source longmix audition measurements, never a production planner.

Run on Jetson with the existing source-bound NAS helpers. All decisions include
numeric measurements and thresholds. Semantic phrase meaning remains unverified;
entry safety means the published VAD and measured vocal energy do not truncate
an active vocal at the selected source boundary.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import pathlib
import socket
import sys
import tempfile
import subprocess

ROLES = ('drums', 'bass', 'other', 'vocals')
OUTPUT_GAIN = .50
STRETCH_CLI = None
LIMITS = dict(peak=.95, reconstructionRelativeError=.25, reconstructionLevelDeltaDb=1.5,
              loopBoundaryDb=-20,aVocalDb=-45, melodyClash=.35, beatErrorMs=50)



# Rebuild the isolated Node verifier from the exact checked-out phone modules.
RUNTIME_HELPER_TS = "import fs from 'node:fs'\nimport {calibrateStemSources} from '__MOBILE_ROOT__/stem-calibration'\nimport {measureReconstruction} from '__MOBILE_ROOT__/timeline-audio-evidence'\nimport {measureStemCompatibility} from '__MOBILE_ROOT__/stem-compatibility'\nimport {jointStretch} from '__MOBILE_ROOT__/joint-stretch'\nconst job=JSON.parse(fs.readFileSync(process.argv[2],'utf8'))\nif(job.analysis){\n const pcm=(p:string)=>{const b=fs.readFileSync(p);const x=new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));const c=[new Float32Array(x.length/2),new Float32Array(x.length/2)];for(let i=0;i<c[0].length;i++){c[0][i]=x[i*2];c[1][i]=x[i*2+1]}return {length:c[0].length,sampleRate:44100,numberOfChannels:2,getChannelData:(i:number)=>c[i]}}\n const audio=Object.fromEntries(['a','b'].map(side=>[side,Object.fromEntries(Object.entries(job.files[side]).map(([key,path])=>[key,pcm(path as string)]))])) as any\n const calibrated=calibrateStemSources(audio,job.duration);if(!calibrated)throw Error('calibration gain outside bounds');\n const result={gains:calibrated.gains,rawReconstruction:calibrated.evidence.rawReconstruction,exits:job.timelines.map((timeline:any)=>({at:timeline.duration,reconstruction:measureReconstruction(calibrated.audio,timeline.duration),compatibility:measureStemCompatibility(calibrated.audio,timeline,job.bpm)}))};fs.writeFileSync(job.result,JSON.stringify(result));\n}else {\nconst input=Object.fromEntries(Object.entries(job.files).map(([k,p])=>{const b=fs.readFileSync(p as string);return [k,new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength))]}))\nconst out=jointStretch(input,job.sampleRate,job.rate,job.frames)\nfor(const [key,samples] of Object.entries(out))fs.writeFileSync(job.output+'/'+key+'.f32le',Buffer.from(samples.buffer,samples.byteOffset,samples.byteLength))\n\n}\n"

def build_runtime_helper(repository, output):
    repository=pathlib.Path(repository).resolve()
    mobile=repository/'vendor/realtime-v3/src/mobile'
    executable=repository/'vendor/realtime-v3/node_modules/.bin/esbuild'
    source=RUNTIME_HELPER_TS.replace('__MOBILE_ROOT__',str(mobile))
    with tempfile.TemporaryDirectory(prefix='longmix-helper-build-') as folder:
        entry=pathlib.Path(folder)/'helper.ts';entry.write_text(source)
        subprocess.run([str(executable),str(entry),'--bundle','--platform=node','--format=cjs','--outfile='+str(pathlib.Path(output).resolve())],check=True)


def vocal_safe_entry(intervals, start, guard=.08):
    return not any(s < start + guard and e > start - guard for s, e in intervals)


def timeline(a, b, a_bpm, b_bpm, start, b_start):
    if a == b:
        raise ValueError('requires two distinct sources')
    values = (a_bpm, b_bpm, start, b_start)
    if not all(isinstance(x, (int, float)) and math.isfinite(x) for x in values) or min(a_bpm, b_bpm) <= 0 or min(start, b_start) < 0:
        raise ValueError('invalid timeline')
    rate = b_bpm / a_bpm
    if not .95 <= rate <= 1.05:
        raise ValueError('rate outside .95–1.05')
    beat = 60 / a_bpm
    return dict(a=a, b=b, start=start, bStart=b_start, rate=rate,
                beatSeconds=beat, duration=64*beat, loopDuration=8*beat,
                exits=[dict(bar=bar, at=bar*4*beat, fadeStart=(bar-1)*4*beat,
                            bResume=b_start+bar*4*beat*rate) for bar in (8, 12, 16)])


def ramp(t, start, end):
    return max(0., min(1., (t-start)/(end-start)))


def output_gain(t):
    value=t.get('outputGain',OUTPUT_GAIN)
    if not isinstance(value,(int,float)) or not math.isfinite(value) or not .3<=value<=OUTPUT_GAIN:
        raise ValueError('scene headroom gain outside .3–.5')
    return value


def gains(timeline, t, exit_point=None):
    beat = timeline['beatSeconds']
    other = ramp(t, 0, 4*beat)
    bass = ramp(t, 30*beat, 32*beat)
    drums = ramp(t, 60*beat, 64*beat)
    result = {'a.other': 1-other, 'b.other': other, 'a.bass': 1-bass,
              'b.bass': bass, 'a.drums': 1-drums, 'b.drums': drums,
              'a.vocals': 0., 'b.vocals': 1.}
    if timeline.get('recipe') in ('drum-bed', 'drum-bed-fast-tonal-exit'):
        leave=ramp(t,0,4*beat);enter=ramp(t,4*beat,8*beat)
        if timeline['recipe']=='drum-bed-fast-tonal-exit':
            # Respect the existing maximum gain slope (4/sec), leaving B's
            # complete vocal alone while A's pitched instruments give way.
            leave=ramp(t,0,.25);enter=ramp(t,.25,1.25)
        for role in ('bass','other'):
            result['a.'+role]=1-leave
            result['b.'+role]=enter
    if exit_point is not None:
        f = ramp(t, exit_point['fadeStart'], exit_point['at'])
        if t >= exit_point['fadeStart']:
            result = gains(timeline, exit_point['fadeStart'])
            for role in ROLES:
                result['a.'+role] *= 1-f
                result['b.'+role] += (1-result['b.'+role])*f
    return result


def gain_knots(t, exit_point=None):
    """One curve representation shared by analysis, rendering and export."""
    beat=t['beatSeconds']
    points=[0.,4*beat,8*beat,30*beat,32*beat,60*beat,t['duration']]
    if t.get('recipe')=='drum-bed-fast-tonal-exit':
        points += [.25,1.25]
    if exit_point is not None:
        points += [exit_point['fadeStart'],exit_point['at']]
        points = [x for x in points if x<=exit_point['at']]
    return sorted(set(points))


def approval(metrics):
    expected = set(LIMITS) | {'bEntrySafe','compatibilityPass'}
    if not expected <= set(metrics):
        raise ValueError('missing numerical evidence: '+','.join(sorted(expected-set(metrics))))
    if any(not isinstance(metrics[k], (int, float)) or not math.isfinite(metrics[k]) for k in LIMITS):
        raise ValueError('invalid numerical evidence')
    checks = {k: metrics[k] <= v for k, v in LIMITS.items()}
    checks['bEntrySafe'] = metrics['bEntrySafe'] is True
    checks['compatibilityPass'] = metrics['compatibilityPass'] is True
    return dict(approved=all(checks.values()), checks=checks, limits=LIMITS,
                rejected=[k for k, value in checks.items() if not value])


def audio_dependencies():
    global np, sf, SR, read_segment, source_assets, profile_proof, sha
    import numpy as np
    import soundfile as sf
    from metric_mix.prepare import SR, source_assets, sha
    from analysis_platform.jetson_plan import profile_proof
    read_segment=decode_source_segment


def decode_source_segment(path,start,duration):
    """Read a source frame window without a cold compressed-decoder boundary.

    The phone slices continuously decoded published PCM. A fast MP3 seek at
    the exact requested sample can lose decoder history and falsely fail the
    first-quarter-second reconstruction gate. Decode one second beforehand;
    lossless 44.1-kHz PCM still uses exact frame seeks. Thresholds are unchanged.
    """
    import numpy as np
    import soundfile as sf
    sr=44100
    if not math.isfinite(start) or start<0 or not math.isfinite(duration) or duration<=0:
        raise ValueError('invalid source frame window')
    first=round(start*sr);n=round(duration*sr);info=sf.info(path)
    if info.samplerate==sr and info.format in ('WAV','WAVEX','FLAC'):
        with sf.SoundFile(path) as f:
            f.seek(first);x=f.read(n,dtype='float32',always_2d=True)
    else:
        # Whole-second preroll also preserves the input/output resampler phase
        # when the source rate differs from the phone's 44.1 kHz.
        warm=max(0,(first//sr-1)*sr)
        raw=subprocess.check_output(['ffmpeg','-nostdin','-v','error','-ss',str(warm/sr),'-i',str(path),
                                     '-ss',str((first-warm)/sr),'-t',str(duration+.02),
                                     '-ar',str(sr),'-ac','2','-f','f32le','pipe:1'],timeout=90)
        x=np.frombuffer(raw,dtype='<f4').reshape(-1,2)[:n]
    if len(x)!=n:raise ValueError('source frame coverage missing')
    return x


def rms(x):
    return float(np.sqrt(np.mean(np.asarray(x, dtype=float)**2)))


def db(x):
    return float(20*np.log10(max(1e-12, x)))


def chroma(x):
    mono = x.mean(axis=1)
    n = 8192
    result = np.zeros(12)
    freqs = np.fft.rfftfreq(n, 1/SR)
    keep = (freqs >= 50) & (freqs <= 4000)
    bins = np.rint(69+12*np.log2(np.maximum(1, freqs[keep])/440)).astype(int) % 12
    for start in range(0, max(1, len(mono)-n), n//2):
        frame = mono[start:start+n]
        if len(frame) < n:
            frame = np.pad(frame, (0, n-len(frame)))
        power = abs(np.fft.rfft(frame*np.hanning(n)))**2
        result += np.bincount(bins, weights=power[keep], minlength=12)
    return result / max(1e-20, result.sum())


def clash(a, b):
    if rms(a) < 1e-5 or rms(b) < 1e-5:
        return 0.
    aa, bb = chroma(a), chroma(b)
    # Adjacent semitones, seconds, tritone, and sevenths. This is an acoustic
    # screening score, not a claim about harmonic intent or listener preference.
    return float(sum(aa[i]*bb[j] for i in range(12) for j in range(12)
                     if (i-j) % 12 in (1, 2, 6, 10, 11)))


def loop_boundary(x):
    jump = rms(x[-1]-x[0])
    return db(jump/max(1e-12, rms(x)))


def stretch(paths, start, duration, rate):
    if abs(rate-1) <= 1e-10:
        return {key: read_segment(path, start, duration) for key, path in paths.items()}
    if STRETCH_CLI is None:
        raise ValueError('phone-equivalent master-guided stretch CLI required')
    with tempfile.TemporaryDirectory(prefix='longmix-source-') as folder:
        root=pathlib.Path(folder)
        files={}
        for key,path in paths.items():
            file=root/(key+'-input.f32le')
            file.write_bytes(read_segment(path,start,duration*rate+.5).astype('<f4').tobytes())
            files[key]=str(file)
        job=root/'job.json'
        job.write_text(json.dumps(dict(files=files,sampleRate=SR,rate=rate,frames=round(duration*SR),output=folder)))
        subprocess.run(['/usr/local/bin/node',str(STRETCH_CLI),str(job)],check=True,timeout=120)
        return {key:np.fromfile(root/(key+'.f32le'),dtype='<f4').reshape(-1,2) for key in paths}


def source_grid_error(track, start, output_duration, rate):
    beats = [v for row in track['alignment']['bars'] for v in row['beats']]
    beat = 60/track['bpm']/rate
    expected = [start+i*beat*rate for i in range(round(output_duration/beat)+1)]
    relevant = [v for v in beats if start-.065 <= v <= start+output_duration*rate+.065]
    if not relevant:
        raise ValueError('missing measured beat grid')
    return max(min(abs(v-e) for e in expected) for v in relevant)*1000/rate


def coverage_frames(duration,sr=44100):
    return math.ceil((duration+.008)*sr)


def measure(a, b, paths_a, paths_b, t, output, write_reference=False):
    scale=output_gain(t)
    n = round(t['duration']*SR)
    loop = stretch(paths_a, t['start'], t['loopDuration'], 1)
    continuous = stretch(paths_b, t['bStart'], coverage_frames(t['duration'],SR)/SR, t['rate'])
    a_audio = {key: np.tile(value, (math.ceil(n/len(value)), 1))[:n] for key, value in loop.items()}
    with tempfile.TemporaryDirectory(prefix='longmix-evidence-') as folder:
        root=pathlib.Path(folder)
        files={}
        for side,values in [('a',a_audio),('b',continuous)]:
            files[side]={}
            for key,value in values.items():
                file=root/(side+'-'+key+'.f32le');file.write_bytes(value.astype('<f4').tobytes());files[side][key]=str(file)
        timelines=[]
        for exit_point in t['exits']:
            knots=gain_knots(t,exit_point)
            timelines.append(dict(duration=exit_point['at'],**{side:{role:[[x,gains(t,x,exit_point)[side+'.'+role]] for x in knots] for role in ROLES} for side in ('a','b')}))
        job=root/'analysis.json';result=root/'evidence.json'
        job.write_text(json.dumps(dict(analysis=True,files=files,duration=t['duration'],bpm=a['bpm'],timelines=timelines,result=str(result))))
        subprocess.run(['/usr/local/bin/node',str(STRETCH_CLI),str(job)],check=True,timeout=180)
        established=json.loads(result.read_text())
    for side,values in [('a',a_audio),('b',continuous)]:
        for role in ROLES:values[role] *= established['gains'][side]
    reconstruction={side:max(max(row['reconstruction'][side]['errorRatio'],row['reconstruction'][side]['boundary']['errorRatio']) for row in established['exits']) for side in ('a','b')}
    grid_error = max(source_grid_error(a, t['start'], t['loopDuration'], 1),
                     source_grid_error(b, t['bStart'], t['duration'], t['rate']))
    rows = []
    for exit_index,exit_point in enumerate(t['exits']):
        established_exit=established['exits'][exit_index]
        length = round(exit_point['at']*SR)
        # Gain breakpoints are linear; interpolation is identical to runtime.
        knots = gain_knots(t,exit_point)
        time = np.arange(length)/SR
        rendered = np.zeros((length, 2), dtype=np.float32)
        processed = {}
        for side, values in [('a', a_audio), ('b', continuous)]:
            for role in ROLES:
                gain = np.interp(time, knots, [gains(t, x, exit_point)[side+'.'+role] for x in knots])
                processed[side+'.'+role] = values[role][:length]*gain[:,None]
                rendered += processed[side+'.'+role]
        # Screening checks each four-beat overlap block, preserving short clashes.
        melody, bass, flam = [], [], []
        block = round(4*t['beatSeconds']*SR)
        for left in range(0, length, block):
            right = min(left+block, length)
            aa = processed['a.bass'][left:right]+processed['a.other'][left:right]
            bb = processed['b.other'][left:right]+processed['b.vocals'][left:right]
            if rms(aa) > .002 and rms(bb) > .002:
                melody.append(clash(aa, bb))
            ab, bbass = processed['a.bass'][left:right], processed['b.bass'][left:right]
            if rms(ab) > .002 and rms(bbass) > .002:
                bass.append(clash(ab, bbass))
            ad, bd = processed['a.drums'][left:right], processed['b.drums'][left:right]
            if rms(ad) > .002 and rms(bd) > .002:
                # Onset-envelope cross-correlation measures phase mismatch within
                # one beat; max shift is capped to +/-100 ms, no wrapping.
                hop = round(.005*SR)
                def envelope(x):
                    energy = np.array([rms(x[i:i+hop]) for i in range(0, len(x), hop)])
                    return np.maximum(0, np.diff(energy))
                ea, eb = envelope(ad), envelope(bd)
                scores=[]
                for offset in range(-20,21):
                    xa, xb = (ea[-offset:],eb[:len(eb)+offset]) if offset<0 else (ea[:len(ea)-offset or None], eb[offset:])
                    scores.append(float(np.dot(xa,xb)) if len(xa)==len(xb) and len(xa) else 0.)
                flam.append(abs(int(np.argmax(scores))-20)*5.)
        handoff_frames=round(.008*SR)
        native=read_segment(paths_b['master'],exit_point['bResume'],.008)
        outgoing=sum(continuous[role][length:length+handoff_frames] for role in ROLES)
        if len(outgoing)!=len(native):raise ValueError('native handoff PCM coverage missing')
        fade=np.linspace(0,1,len(native))[:,None]
        handoff=(outgoing*(1-fade)+native*fade)*scale
        raw_jump=float(np.max(abs(outgoing[0]-native[0])))*scale
        metrics = dict(peak=max(float(np.max(abs(rendered)))*scale,float(np.max(abs(handoff)))) ,
                       reconstructionRelativeError=max(reconstruction.values()),
                       reconstructionLevelDeltaDb=max(abs(value['levelDeltaDb']) for row in established['exits'] for side in ('a','b') for value in (row['reconstruction'][side],row['reconstruction'][side]['boundary'])),
                       loopBoundaryDb=max(loop_boundary(loop[k]) for k in ('bass','drums')),
                       aVocalDb=db(rms(loop['vocals'])), melodyClash=established_exit['compatibility']['pitchedRisk'],
                       bassClash=max(bass,default=0.),drumFlamMs=max(flam,default=0.),
                       beatErrorMs=grid_error,compatibilityPass=established_exit['compatibility']['pass'],bEntrySafe=vocal_safe_entry(b['vocals'], t['bStart']))
        row = dict(**exit_point, metrics=metrics, decision=approval(metrics),
                   reconstructionBySource=reconstruction,rawPeak=float(np.max(abs(rendered))),outputGain=scale,
                   processedDissonanceDiagnostic=melody,establishedCompatibility=established_exit['compatibility'],
                   sourceCalibration=established['gains'],rawReconstruction=established['rawReconstruction'],
                   reconstructionDetails=established_exit['reconstruction'],
                   takeover=dict(crossfadeSeconds=.008,nativePosition=exit_point['bResume'],unfadedSampleDifference=raw_jump,renderedPeak=float(np.max(abs(handoff))),renderedStartStep=float(np.max(abs(rendered[-1]*scale-handoff[0]))),renderedEndError=float(np.max(abs(handoff[-1]-native[-1]*scale)))), processedBassBlocks=bass,
                   processedDrumFlamMs=flam)
        rows.append(row)
        if write_reference:
            file=output/('measurement-exit-'+str(exit_point['bar'])+'.wav')
            sf.write(file,np.concatenate([rendered*scale,handoff]),SR,subtype='FLOAT')
            row['privateReference'] = dict(path=str(file),sha256=sha(file),gain=scale,
                                          purpose='measurement only; never phone source')
    return dict(timeline=t, sourceGains=established['gains'],exits=rows, approved=all(r['decision']['approved'] for r in rows),
                limitations=['Acoustic compatibility screening does not establish musical preference.',
                             'Phrase semantics are unverified; complete published VAD onset is preserved. Compatibility uses the existing sourceChroma proxy and production limits.',
                             'Processed measurements use the same master-guided SoundTouch function as the phone.'])


def export_scene(measurements, identity, implementation_sha):
    """Export only an actually approved measurement, preserving source identity."""
    if not measurements.get('approved') or any(not x['decision']['approved'] for x in measurements['exits']):
        raise ValueError('cannot export rejected measurements')
    if any(len(x)!=64 or any(c not in '0123456789abcdef' for c in x) for x in (identity,implementation_sha)):
        raise ValueError('invalid implementation or job fingerprint')
    t=measurements['timeline'];d=t['duration'];beat=t['beatSeconds']
    knots=gain_knots(t)
    layers=[dict(side=side,role=role,loop=side=='a',points=[[x,gains(t,x)[side+'.'+role]] for x in knots]) for side in ('a','b') for role in ROLES if not(side=='a' and role=='vocals')]
    return dict(schema='harbeat.two-source-scene.v1',scope='audition-only',producer='jetson',approved=True,
                id=identity,implementationSha256=implementation_sha,title='鼓循环长混试听' if t.get('recipe')=='drum-bed' else '两来源长混试听',
                fromTitle=measurements['sourceTitles']['a'],toTitle=measurements['sourceTitles']['b'],
                sampleRate=44100,bpm=60/beat,rate=t['rate'],duration=d,lead=8,tail=16,outputGain=output_gain(t),
                sourceGains=measurements['sourceGains'],sources=measurements['sourceProof'],
                clips=dict(aStart=t['start'],aEnd=t['start']+t['loopDuration'],bStart=t['bStart'],bEnd=t['bStart']+d*t['rate']),
                layers=layers,exits=[dict(at=r['at'],fadeStart=r['fadeStart'],bPosition=r['bResume'],peak=r['metrics']['peak']) for r in measurements['exits']],
                evidence=dict(aVocalSilent=True,bEntryComplete=True,
                              reconstruction={side:max(max(r['reconstructionDetails'][side]['errorRatio'],r['reconstructionDetails'][side]['boundary']['errorRatio']) for r in measurements['exits']) for side in ('a','b')},
                              pitchedRisk=max(r['metrics']['melodyClash'] for r in measurements['exits']),
                              peak=max(r['metrics']['peak'] for r in measurements['exits']),
                              loopSeamDb=max(r['metrics']['loopBoundaryDb'] for r in measurements['exits']),
                              beatErrorMs=max(r['metrics']['beatErrorMs'] for r in measurements['exits']),
                              runtime='master-guided-wsola-v1',limitations=measurements['limitations']))


def load_tracks(folder):
    return {t['id']:t for file in folder.glob('*-detail.json')
            if not file.name.startswith('._')
            for raw in [json.loads(file.read_text())] for t in [raw.get('track',raw)]}


def run(args):
    global STRETCH_CLI
    STRETCH_CLI=args.stretch_cli
    audio_dependencies()
    tracks=load_tracks(args.metadata)
    a,b=tracks[args.a],tracks[args.b]
    args.output.mkdir(parents=True,exist_ok=True)
    paths_a,proof_a=source_assets(a,args.nas,args.reports)
    paths_b,proof_b=source_assets(b,args.nas,args.reports)
    proof={'a':profile_proof(a,proof_a,args.execution_root),
           'b':profile_proof(b,proof_b,args.execution_root)}
    t=timeline(a['id'],b['id'],a['bpm'],b['bpm'],args.start,args.b_start)
    t['recipe']=args.recipe
    t['outputGain']=getattr(args,'output_gain',OUTPUT_GAIN)
    output_gain(t)
    if not vocal_safe_entry(a['vocals'],args.start) or any(s<t['start']+t['loopDuration'] and e>t['start'] for s,e in a['vocals']):
        raise ValueError('A loop intersects published vocal activity')
    if args.b_start+t['duration']*t['rate']+12>b['duration']:
        raise ValueError('insufficient continuous B body')
    result=measure(a,b,paths_a,paths_b,t,args.output,args.reference)
    result.update(schema='harbeat.longmix-measurements.v1',sourceProof=proof,
                  producer=dict(hostname=socket.gethostname(),python=sys.version,
                                sourceReadMode='continuous-decoder-preroll-1s-v1',
                                stretchCliSha256=sha(STRETCH_CLI) if STRETCH_CLI else None,
                                codeSha256=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()),
                  sourceTitles=dict(a=a['title'],b=b['title']))
    file=args.output/'measurements.json'
    file.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False))
    if args.implementation_sha:
        identity=hashlib.sha256(json.dumps(dict(timeline=t,sourceProof=proof,producer=result['producer']),sort_keys=True,separators=(',',':')).encode()).hexdigest()
        scene=export_scene(result,identity,args.implementation_sha)
        (args.output/'scene.json').write_text(json.dumps(scene,ensure_ascii=False,indent=2,allow_nan=False))
    file=args.output/'measurements.json'
    file.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False))
    print(json.dumps(dict(path=str(file),approved=result['approved'],exits=[dict(bar=r['bar'],metrics=r['metrics'],rejected=r['decision']['rejected']) for r in result['exits']]),ensure_ascii=False))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metadata',type=pathlib.Path,required=True)
    parser.add_argument('--a',required=True);parser.add_argument('--b',required=True)
    parser.add_argument('--start',type=float,required=True);parser.add_argument('--b-start',type=float,required=True)
    parser.add_argument('--output',type=pathlib.Path,required=True)
    parser.add_argument('--nas',type=pathlib.Path,default=pathlib.Path('/mnt/nas/harbeat/preprocess'))
    parser.add_argument('--reports',type=pathlib.Path,default=pathlib.Path('/mnt/nas/harbeat/data/analysis-platform/reports'))
    parser.add_argument('--execution-root',type=pathlib.Path,default=pathlib.Path('/mnt/nas/harbeat/preprocess/device-execution-v1'))
    parser.add_argument('--recipe',choices=('bass-drums-bed','drum-bed','drum-bed-fast-tonal-exit'),default='bass-drums-bed')
    parser.add_argument('--output-gain',type=float,default=OUTPUT_GAIN,help='scene headroom .3–.5; original peak threshold remains .95')
    parser.add_argument('--implementation-sha')
    parser.add_argument('--stretch-cli',type=pathlib.Path)
    parser.add_argument('--reference',action='store_true')
    run(parser.parse_args())

if __name__=='__main__':main()
