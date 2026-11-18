"""Prepare the verified DJ Hapa A/B comparison on Jetson from private analyses."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import socket
import subprocess
import tempfile

import numpy as np
import soundfile as sf
import longmix_scene as audio_tools

RATE = 124 / 128
SR = 44100
ROLES = ('drums', 'bass', 'other', 'vocals')
TRACKS = {
    'a': ('track-cdaf08680b5fff545e2a', 'cdaf08680b5fff545e2ad345ee466034efdcaa5b909aa8cc70c48fd79c74b14a'),
    'b': ('track-45964bc4912b6d749561', '45964bc4912b6d749561027e3109a8d89e04b46398e8e211238d6e10762e935a'),
}


def digest(file):
    value = hashlib.sha256()
    with Path(file).open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def clean_numbers(value):
    if isinstance(value, dict):
        return {key: clean_numbers(item) for key, item in value.items()}
    if isinstance(value, list):
        return [clean_numbers(item) for item in value]
    if type(value) is float:
        if not math.isfinite(value):
            raise ValueError('nonfinite case measurement')
        return int(value) if value.is_integer() else value
    return value


def verified_source(root, side, identity=None):
    track_id, original_sha = identity if identity is not None else TRACKS[side]
    verified = []
    for file in (root / 'published/tracks' / track_id / 'runs').glob('*/manifest.json'):
        manifest = json.loads(file.read_text())
        success_file = file.parent / '_SUCCESS.json'
        if not success_file.exists():
            continue
        success = json.loads(success_file.read_text())
        if success.get('manifest_sha256') != digest(file):
            raise ValueError('analysis manifest fingerprint mismatch')
        if success.get('analysis_run_id') != manifest['analysis_run_id']:
            raise ValueError('analysis success belongs to another run')
        if manifest['source']['input_sha256'] != original_sha:
            raise ValueError('analysis does not belong to the public original')
        files = {}
        for role, asset in {'master': manifest['assets']['master'], **manifest['assets']['stems']}.items():
            path = (root / asset['storage_key']).resolve()
            if not path.is_relative_to(root.resolve()) or digest(path) != asset['sha256']:
                raise ValueError('source asset identity mismatch')
            files[role] = path
        if set(files) != {'master', *ROLES}:
            raise ValueError('complete separated source evidence required')
        verified.append((manifest, file, files))
    if len(verified) != 1:
        raise ValueError(f'exactly one complete analysis required for {side}, found {len(verified)}')
    return verified[0]


def verified_voice_activity(root, manifest, manifest_file, files):
    candidates = []
    for file in (root / 'published/vocal_activity' / manifest['track_id']).glob('*/**/vocal_activity.json'):
        activity = json.loads(file.read_text())
        source = activity.get('source', {})
        if source.get('analysis_run_id') != manifest['analysis_run_id']:
            continue
        success = json.loads(file.with_name('_SUCCESS.json').read_text())
        if (success.get('vocal_activity_sha256') != digest(file)
                or source.get('manifest_sha256') != digest(manifest_file)
                or source.get('vocal_sha256') != digest(files['vocals'])
                or activity.get('status') != 'ready'
                or activity.get('unit') != 'ms'
                or not isinstance(activity.get('intervals'), list)):
            raise ValueError('vocal activity is not bound to the analyzed source')
        candidates.append((activity, file))
    if len(candidates) != 1:
        raise ValueError('exactly one bound vocal activity report required')
    return candidates[0]


def points_on_frames(points):
    return [[round(time * SR) / SR, level] for time, level in points]


def interpolate(points, frames):
    return np.interp(np.arange(frames) / SR, *zip(*points))


def plan_curves(duration):
    beat = 60 / 124
    return {
        'original': {
            'a': points_on_frames([[0, 1], [8 * beat, 0], [duration, 0]]),
            'b': points_on_frames([[0, 0], [8 * beat, 1], [duration, 1]]),
        },
        'reference': {
            'a': points_on_frames([[0, 1], [30 * beat, 1], [duration, 0]]),
            'b': points_on_frames([[0, 0], [3 * beat, 0], [19 * beat, 1], [duration, 1]]),
        },
    }


def measured_grid_error(manifest, cue, rate, duration):
    points = manifest['analysis']['beat_grid'].get('beats_ms', [])
    measured = [point / 1000 for point in points
                if cue - .065 <= point / 1000 <= cue + duration * rate + .065]
    if len(measured) < 8:
        raise ValueError('source has insufficient measured beats at the reference cue')
    beat = 60 / 124
    residuals = []
    for point in measured:
        position = (point - cue) / rate
        residuals.append(abs(position - round(position / beat) * beat) * 1000)
    return max(residuals)


def render(a, b, body, curves, duration, output_gain):
    frames = round(duration * SR)
    lead = 4 * SR
    tail = 8 * SR
    result = np.zeros((lead + frames + tail, 2), dtype=np.float32)
    result[:lead] = a[:lead] * output_gain
    result[lead:lead + frames] = (
        a[lead:lead + frames] * interpolate(curves['a'], frames)[:, None]
        + b[:frames] * interpolate(curves['b'], frames)[:, None]
    ) * output_gain
    crossfade = math.ceil(.008 * SR)
    weights = np.arange(crossfade) / (.008 * SR)
    body[:crossfade] = body[:crossfade] * weights[:, None] + b[frames:frames + crossfade] * (1 - weights[:, None])
    result[lead + frames:] = body[:tail] * output_gain
    result[-441:] *= (np.arange(441, 0, -1) / 441)[:, None]
    return result


def run(args):
    output = args.output.resolve()
    if not output.is_relative_to(Path('/mnt/nas/harbeat/experiments')):
        raise ValueError('this research producer writes only to a dedicated NAS experiment')
    output.mkdir(parents=True, exist_ok=True)
    sources = {side: verified_source(args.preprocess, side) for side in 'ab'}
    duration = round((48 * 60 / 124 * SR) / 32) * 32 / SR
    cues = {'a': round(11.68552688172043 * SR) / SR, 'b': round(.0247291666666667 * SR) / SR}
    frames = round(duration * SR)
    curves = plan_curves(duration)
    raw = {}
    native = {}
    assets = {}
    proof = {}
    voice = {}
    audio_tools.np = np
    audio_tools.SR = SR
    audio_tools.read_segment = audio_tools.decode_source_segment
    audio_tools.STRETCH_CLI = args.stretch
    for side, (manifest, manifest_file, files) in sources.items():
        activity, activity_file = verified_voice_activity(args.preprocess, manifest, manifest_file, files)
        voice[side] = activity
        rate = 1 if side == 'a' else RATE
        start = cues[side] - (4 if side == 'a' else 0)
        length = math.ceil(((4 + duration) if side == 'a' else (duration * RATE + 8.5)) * SR) / SR
        native[side] = audio_tools.decode_source_segment(files['master'], start, length)
        asset_path = output / (side + '.wav')
        sf.write(asset_path, native[side], SR, subtype='FLOAT')
        assets[side] = dict(url=f'reference-case/{side}.wav', sha256=digest(asset_path),
                            frames=len(native[side]), sampleRate=SR, channels=2, sourceStart=start)
        raw[side] = audio_tools.stretch(files, cues[side], (frames + math.ceil(.008 * SR)) / SR, rate)
        proof[side] = dict(trackId=TRACKS[side][0], runId=manifest['analysis_run_id'],
                           originalSha256=TRACKS[side][1], masterSha256=digest(files['master']),
                           reportSha256=digest(manifest_file), vocalSha256=digest(files['vocals']),
                           vocalActivitySha256=digest(activity_file),
                           analysisQuality=manifest['quality'],
                           sourceBpm=124 if side == 'a' else 128, sourceStart=cues[side])
    output_gain = .45
    beat_error = max(measured_grid_error(row[0], cues[side], 1 if side == 'a' else RATE, duration)
                     for side, row in sources.items())
    with tempfile.TemporaryDirectory(prefix='public-reference-measure-') as folder:
        work = Path(folder)
        files = {}
        for side in 'ab':
            files[side] = {}
            for role, pcm in raw[side].items():
                file = work / f'{side}-{role}.f32le'
                pcm[:frames].astype('<f4').tofile(file)
                files[side][role] = str(file)
        job = dict(files=files, frames=frames, bpm=124, outputGain=output_gain,
                   variants=curves, result=str(work / 'result.json'))
        job_file = work / 'request.json'
        job_file.write_text(json.dumps(job))
        subprocess.run(['/usr/local/bin/node', str(args.measure), str(job_file)], check=True, timeout=180)
        measurements = json.loads((work / 'result.json').read_text())
    body_start = round(duration * RATE * SR)
    baseline = None
    for name, controls in curves.items():
        waveform = render(native['a'], raw['b']['master'], native['b'][body_start:].copy(),
                          controls, duration, output_gain)
        sf.write(output / f'{name}-reference.wav', waveform, SR, subtype='FLOAT')
        power = float(np.mean(waveform[4 * SR:4 * SR + frames].astype(float) ** 2))
        if baseline is None:
            baseline = power
        measure = measurements[name]
        reconstruction = measure['reconstruction']
        worst = {
            side: dict(errorRatio=max(row['errorRatio'], row['boundary']['errorRatio']),
                       levelDeltaDb=max((row['levelDeltaDb'], row['boundary']['levelDeltaDb']), key=abs))
            for side, row in reconstruction.items()
        }
        compatibility = measure['compatibility']
        vocal_safe = all(activity.get('has_vocals') is False and not activity['intervals']
                         for activity in voice.values())
        evidence = dict(approved=False, sourceAligned=True, vocalSafe=vocal_safe,
                        compatibilityPass=compatibility['pass'], peak=float(np.max(np.abs(waveform))),
                        melodyClash=compatibility['pitchedRisk'], beatErrorMs=beat_error,
                        riseDb=10 * math.log10(power / baseline), reconstruction=worst,
                        compatibility=compatibility,
                        voiceBasis='author identifies both originals as instrumental; bound separated-vocal VAD has no active intervals')
        evidence['approved'] = (evidence['vocalSafe'] and evidence['compatibilityPass'] and evidence['peak'] <= .95
                                and evidence['melodyClash'] <= .35 and evidence['riseDb'] <= 3
                                and beat_error <= 50
                                and all(row['errorRatio'] <= .25 and abs(row['levelDeltaDb']) <= 1.5 for row in worst.values()))
        controls['evidence'] = evidence
    case = dict(schema='harbeat.dj-reference-case.v1', producer='jetson', scope='audition-only',
                approved=all(item['evidence']['approved'] for item in curves.values()),
                title='DJ Hapa 双曲交接对照', fromTitle='House Loop 2', toTitle='ElectroHouse vol1',
                sampleRate=SR, bpm=124, rate=RATE, duration=duration, lead=4, tail=8,
                outputGain=output_gain, sources=proof, assets=assets,
                reference=dict(url='https://www.youtube.com/watch?v=aqFRSSYp2bg',
                               coordinateProofSha256=digest(args.coordinates),
                               note='视频第二次示范。音频匹配坐标误差约±0.1秒，滑杆观察约±0.25秒。视频没有公布数值自动化，参考版用线性增益重建渐入、保持和渐出阶段，由 Jetson 对齐到拍点。'),
                variants=curves)
    case = clean_numbers(case)
    case = json.loads(subprocess.run(['/usr/local/bin/node', str(args.seal_helper)],
                                    input=json.dumps(case, ensure_ascii=False, allow_nan=False),
                                    capture_output=True, text=True, check=True).stdout)
    (output / 'case.json').write_text(json.dumps(case, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
    receipt = dict(hostname=socket.gethostname(), producerSha256=digest(__file__),
                   measureSha256=digest(args.measure), stretchSha256=digest(args.stretch),
                   contractVerifierSha256=digest(args.seal_helper),
                   coordinateProofSha256=digest(args.coordinates), caseSha256=digest(output / 'case.json'),
                   sourceManifestSha256={side: digest(row[1]) for side, row in sources.items()},
                   approved=case['approved'], measurements=measurements)
    (output / 'producer-receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2))
    print(json.dumps(dict(id=case['id'], approved=case['approved'], evidence={k:v['evidence'] for k,v in curves.items()}), ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for argument in ('preprocess', 'coordinates', 'measure', 'stretch', 'output', 'seal-helper'):
        parser.add_argument('--' + argument, type=Path, required=True)
    run(parser.parse_args())
