"""Recheck a verified Toucan transition on Jetson and publish a source-bound player recipe.

Run with the pinned Toucan evaluator directory as the current directory.
Only the approved recipe and source analysis metadata leave this process.
"""
from __future__ import annotations

import argparse
import hashlib
from fractions import Fraction
import json
import math
from pathlib import Path
import socket
import subprocess

import numpy as np
import soundfile as sf

SAMPLE_RATE = 44100
OUTPUT_GAIN = .76
ROLES = ('drums', 'bass', 'other', 'vocals')


def adaptation_curves(observed, duration, beat, headroom_db=0, offset=0):
    if offset < 0 or not 8 * beat <= duration <= 32 or any(offset + duration >= observed[side][-1][0] for side in ('a', 'b')):
        raise ValueError('adaptation must fit the observed overlap and eight-beat minimum')
    takeover = round((duration - 4 * beat) * SAMPLE_RATE) / SAMPLE_RATE
    baseline_end = min(duration, round(8 * beat * SAMPLE_RATE) / SAMPLE_RATE)
    original, reference = {}, {}
    for side, final in [('a', 0), ('b', 1)]:
        points = observed[side]
        gain = float(np.interp(offset + takeover, *zip(*points)))
        relative = [[round((t-offset)*SAMPLE_RATE)/SAMPLE_RATE,v]
                    for t,v in points if offset < t < offset + takeover]
        reference[side] = [[0,1-final],*relative,[takeover,gain],[duration,final]]
        if headroom_db:
            curve = reference[side]
            times = sorted({t for t,_ in curve} | {beat, duration-beat})
            scale = 10 ** (-headroom_db / 20)
            values = [float(np.interp(t,*zip(*curve))) *
                      (1 - (1-scale)*min(1,t/beat,(duration-t)/beat)) for t in times]
            monotonic = np.minimum.accumulate(values) if side == 'a' else np.maximum.accumulate(values)
            reference[side] = [[t,float(v)] for t,v in zip(times,monotonic)]
        original[side] = [[0, 1 - final], [baseline_end, final]]
        if baseline_end < duration:
            original[side].append([duration, final])
    return {'original':original, 'reference':reference}


def cue_bass_eq(pcm, side, duration, release):
    from scipy.signal import lfilter

    amplitude = 10 ** ((-9 if side == 'a' else -7) / 40)
    angular = 2 * math.pi * 140 / SAMPLE_RATE
    cosine, beta = math.cos(angular), math.sqrt(2 * amplitude) * math.sin(angular)
    add, sub = amplitude + 1, amplitude - 1
    numerator = amplitude * np.array([add - sub*cosine + beta, 2*(sub - add*cosine), add - sub*cosine - beta])
    denominator = np.array([add + sub*cosine + beta, -2*(sub + add*cosine), add + sub*cosine - beta])
    time = np.arange(len(pcm)) / SAMPLE_RATE
    wet = np.clip(time / .02 if side == 'a' else (duration - time) / release, 0, 1)[:, None]
    return (pcm + wet * (lfilter(numerator,denominator,pcm,axis=0) - pcm)).astype(np.float32)


def vocal_window_safe(report, start, end):
    local = (report['analysisStart'], report['vocals'])
    whole = (0, report.get('fullVocalActivity', {}).get('intervals', []))
    return not any(
        origin + row['start_ms'] / 1000 < end + .3
        and origin + row['end_ms'] / 1000 > start - .3
        for origin, intervals in (local, whole)
        for row in intervals
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--preprocess', type=Path, help='Required to publish a player recipe')
    parser.add_argument('--case', type=Path, default=Path('cases/17-18'))
    parser.add_argument('--bars', type=int, choices=[2,4,8,16], help='Keep the measured entry and adapt the exit at this many bars')
    parser.add_argument('--headroom-db', type=float, default=0, choices=[0,1.5])
    parser.add_argument('--offset-bars', type=int, choices=range(-2,9), default=0)
    parser.add_argument('--technique', choices=['reference','original','low_eq'], default='reference')
    args = parser.parse_args()
    if (args.headroom_db or args.offset_bars) and not args.bars:
        parser.error('headroom and start offset require an adapted duration')
    if (args.technique == 'reference' and args.offset_bars < 0) or (args.technique != 'reference' and args.headroom_db):
        parser.error('the measured DJ curve and HarBeat techniques have separate controls')
    import jetson_review as review
    import compare as comparison
    from prepare_case import digest, verified_source, verified_voice_activity

    sr = SAMPLE_RATE
    case = args.case
    previous = json.loads((case / 'candidate.json').read_text())
    coordinate = case / 'coordinate.json'
    if (previous['producer'] != 'jetson' or (not args.bars and not previous['variants'][args.technique if args.technique != 'low_eq' else 'original']['approved'])
            or digest(coordinate) != previous['reference']['coordinateProofSha256']):
        raise ValueError('missing Toucan coordinate evidence')
    row = json.loads(coordinate.read_text())
    slots = row['a'], row['b']
    if slots[1] != slots[0] + 1 or case.name != f'{slots[0]:02}-{slots[1]:02}':
        raise ValueError('different reference direction')
    comparison.audio_tools.SR = sr
    comparison.audio_tools.np = np
    comparison.audio_tools.read_segment = comparison.audio_tools.decode_source_segment
    comparison.audio_tools.STRETCH_CLI = Path('stretch.cjs').resolve()
    duration, rate, bpm = (previous[k] for k in ('duration', 'rate', 'bpm'))
    if not .95 <= rate <= 1.05 or not 60 <= bpm <= 240:
        raise ValueError('unapproved local tempo')
    variants = {name:{side:curve[side] for side in ('a','b')} for name,curve in previous['variants'].items()}
    offset = 0
    if args.bars:
        period = Fraction(rate).limit_denominator(1000).denominator
        bars_frames = round(args.bars * 240 / bpm * sr / period) * period
        minimum_frames = math.ceil(480 / bpm * sr / period) * period
        duration = max(bars_frames,minimum_frames) / sr
        offset = round(args.offset_bars * 240 / bpm * sr / period) * period / sr
        if args.technique == 'reference':
            variants = adaptation_curves(variants['reference'],duration,60 / bpm,args.headroom_db,offset)
        else:
            variants = {'original':{'a':[[0,1],[duration,0]],'b':[[0,0],[duration,1]]}}
    frames = round(duration * sr)
    source_report, sources, pcm, native, errors = {}, {}, {}, {}, {}
    voices = review.SileroDetector()
    for side, slot in zip(('a','b'), slots):
        source = previous['sources'][side]
        original = Path('originals') / f'{slot:02}.mp3'
        if digest(original) != source['originalSha256']:
            raise ValueError('original edition hash mismatch')
        local_rate = 1 if side == 'a' else rate
        cue = round((source['sourceStart'] + offset * local_rate) * sr) / sr
        local = case / f'{side}-analysis.wav'
        proof_file = case / f'{side}-analysis.json'
        proof = json.loads(proof_file.read_text())
        if (digest(local) != source['masterSha256'] or digest(proof_file) != source['reportSha256']
                or digest(review.BEAT) != proof['beatModelSha256']):
            raise ValueError('local analysis evidence was changed')
        audio, _ = sf.read(local, dtype='float32', always_2d=True)
        full = subprocess.check_output(['ffmpeg','-nostdin','-v','error','-i',str(original),
                                        '-ar',str(sr),'-ac','2','-f','f32le','-'], timeout=90)
        samples = np.frombuffer(full, dtype='<f4').reshape(-1,2)
        first = round(proof['analysisStart'] * sr)
        if not np.array_equal(audio, samples[first:first + len(audio)]):
            raise ValueError('local analysis audio does not match the full original')
        stems = sorted(case.glob(f'{side}-*/audio/stems'))
        if len(stems) != 1:
            raise ValueError('ambiguous analysis stems')
        paths = {role:stems[0] / (('other-compat' if role == 'other' else role) + '.wav') for role in ROLES}
        if digest(paths['vocals']) != source['vocalSha256']:
            raise ValueError('vocal stem changed')
        vocal_activity, _ = voices.detect(paths['vocals'])
        lead = 4 if side == 'a' else 0
        end = cue + duration * local_rate + (0 if side == 'a' else 8.5)
        native[side] = samples[round((cue - lead) * sr):round(end * sr)].copy()
        beat_data = review._analyze_rhythm_beat_this(audio.mean(axis=1),sr)
        beats = np.asarray(beat_data['beat_times']) + first / sr
        errors[side] = review.max_error(beats,cue,local_rate,frames,60 / bpm)
        original_hash = source['originalSha256']
        track_id = 'track-' + original_hash[:20]
        if args.preprocess:
            manifest, manifest_path, full_paths = verified_source(args.preprocess,side,(track_id,original_hash))
            activity, activity_path = verified_voice_activity(args.preprocess,manifest,manifest_path,full_paths)
            if digest(full_paths['master']) != original_hash:
                raise ValueError('full analysis master does not match the original')
            pcm[side] = comparison.audio_tools.stretch(
                full_paths,cue,(frames + math.ceil(.008 * sr)) / sr,local_rate)
        else:
            pcm[side] = comparison.audio_tools.stretch(
                {'master':local,**paths},cue - first / sr,(frames + math.ceil(.008 * sr)) / sr,local_rate)
        report = dict(schema='harbeat.toucan-pair-source.v1', sourceSha256=digest(original), durationFrames=len(samples),
                      localAnalysisSha256=digest(local), vocalSha256=source['vocalSha256'],
                      stemSha256={role:digest(path) for role,path in paths.items()},
                      analysisStart=first / sr, analysisEnd=(first + len(audio)) / sr, beats=beats.tolist(),
                      downbeats=(np.asarray(beat_data['downbeats']) + first / sr).tolist(), vocals=vocal_activity,
                      bpm=source['sourceBpm'], beatModelSha256=proof['beatModelSha256'], stemModelSha256=proof['stemModelSha256'])
        if args.preprocess:
            report['fullAnalysis'] = manifest['analysis']
            report['fullVocalActivity'] = activity
            report['fullVocalActivitySha256'] = digest(activity_path)
            sources[side] = dict(trackId=track_id, sourceStart=cue, originalSha256=original_hash,
                                 masterSha256=original_hash, reportSha256=digest(manifest_path),
                                 vocalSha256=digest(full_paths['vocals']), runId=manifest['analysis_run_id'])
        else:
            sources[side] = {**source,'sourceStart':cue}
        source_report[side] = report

    measurements = comparison.measure_pair(pcm,variants,frames,bpm)
    release = round(120 / bpm * sr) / sr
    eq_pcm = None
    if args.technique == 'low_eq':
        eq_pcm = {side:{role:cue_bass_eq(samples,side,duration,release) for role,samples in rows.items()}
                  for side,rows in pcm.items()}
        variants['low_eq'] = variants['original']
        measurements['low_eq'] = comparison.measure_pair(eq_pcm,{'original':variants['original']},frames,bpm)['original']
    def safe_vocals(side, report):
        start = sources[side]['sourceStart']
        end = start + duration * (1 if side == 'a' else rate)
        return vocal_window_safe(report,start,end)
    vocal_safe = all(safe_vocals(side,report) for side,report in source_report.items())
    if any(value is None for value in errors.values()):
        raise ValueError('insufficient measured beats')
    accepted = {}
    for name, curve in variants.items():
        m = measurements[name]
        reconstructed = {
            side:dict(errorRatio=max(v['errorRatio'],v['boundary']['errorRatio']),
                      levelDeltaDb=max((v['levelDeltaDb'],v['boundary']['levelDeltaDb']),key=abs))
            for side,v in m['reconstruction'].items()
        }
        body = native['b'][round(frames * rate):]
        outgoing, entry = native['a'], pcm['b']['master']
        if name == 'low_eq':
            outgoing = outgoing.copy()
            outgoing[4 * sr:] = cue_bass_eq(outgoing[4 * sr:],'a',duration,release)
            entry = eq_pcm['b']['master']
        rendered = comparison.render(outgoing,entry,body,curve,duration,OUTPUT_GAIN)
        peak = max(float(np.max(np.abs(rendered))), float(np.max(np.abs(body))) * OUTPUT_GAIN)
        power = float(np.mean(rendered[4 * sr:4 * sr + frames].astype(float) ** 2))
        if name == 'original':
            baseline = power
        evidence = dict(sourceAligned=True,vocalSafe=vocal_safe,compatibilityPass=m['compatibility']['pass'],
                        melodyClash=m['compatibility']['pitchedRisk'],peak=peak,beatErrorMs=max(errors.values()),
                        riseDb=10 * math.log10(power / baseline),reconstruction=reconstructed)
        accepted[name] = dict(**evidence,approved=(
            vocal_safe and evidence['compatibilityPass'] and peak <= .95 and evidence['melodyClash'] <= .35
            and evidence['beatErrorMs'] <= 50 and evidence['riseDb'] <= 3
            and all(r['errorRatio'] <= .25 and abs(r['levelDeltaDb']) <= 1.5 for r in reconstructed.values())
        ))
    args.output.mkdir(parents=True,exist_ok=True)
    review.dump(args.output / 'receipt.json',dict(host=socket.gethostname(),sources=sources,reports=source_report,
                                                 measurements=accepted,beatResidualMs=errors,
                                                 compatibility={name:row['compatibility'] for name,row in measurements.items()}))
    if not args.preprocess:
        return
    if not accepted[args.technique]['approved']:
        raise ValueError('Toucan technique failed normal playback recheck')
    source_reference = previous['reference'].copy()
    if args.technique != 'reference':
        source_reference['note'] = f'Toucan {case.name}: HarBeat {args.technique} at the measured beat phase, {args.offset_bars:+d} bars from the measured cue'
    elif args.bars:
        source_reference['note'] = f'Toucan {case.name}: measured entry and gain curve, adapted exit after {args.bars} bars'
        if args.offset_bars:
            source_reference['note'] += f', entry delayed by {args.offset_bars} bars within the measured overlap'
        if args.headroom_db:
            source_reference['note'] += f', shared {args.headroom_db:g} dB overlap attenuation'
    recipe = dict(schema='harbeat.dj-pair-reference.v1',producer='jetson',approved=True,sources=sources,
                  reference=source_reference,duration=duration,rate=rate,outputGain=OUTPUT_GAIN,
                  **variants[args.technique],evidence=accepted[args.technique])
    if args.technique == 'original':
        recipe['technique'] = 'cue-gradual'
    if args.technique == 'low_eq':
        recipe.update(technique='cue-low-eq',eq={'releaseSec':release})
    # Use JSON.stringify for the same number serialization as the mobile verifier.
    canonical = subprocess.check_output(['/usr/local/bin/node','-e',"""
      const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?
        Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
      process.stdout.write(JSON.stringify(sort(JSON.parse(require('fs').readFileSync(0,'utf8')))));
    """],input=json.dumps(recipe,allow_nan=False).encode(),timeout=10)
    recipe['id'] = hashlib.sha256(canonical).hexdigest()
    review.dump(args.output / 'index.json',[recipe])


if __name__ == '__main__':
    main()
