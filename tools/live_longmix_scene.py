#!/usr/bin/env python3
"""Measure live .76 master/stem boundaries on Jetson before publishing approval.

The embedded audition keeps its original role curves and source identities.
The additional measurements cover entry from the running A master, every safe
exit into native B at .76, and native B's following sixteen seconds. No rendered
mix is distributed to the phone.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import pathlib
import shutil
import socket
import subprocess

NATIVE_GAIN = .76
FADE_SECONDS = .008


def export_live(scene, scene_sha, metrics, implementation_sha, host):
    if (scene.get('schema') != 'harbeat.two-source-scene.v1' or
            scene.get('scope') != 'audition-only' or scene.get('producer') != 'jetson' or
            scene.get('approved') is not True or scene.get('rate') != 1):
        raise ValueError('only an approved same-speed source scene may be measured live')
    if metrics.get('sourceVerified') is not True or len(metrics.get('exitPeaks', [])) != len(scene['exits']):
        raise ValueError('missing live source verification or boundary measurements')
    peaks=[metrics.get('entryPeak')]+[r.get('peak') for r in metrics['exitPeaks']]
    if any(not isinstance(x,(int,float)) or not math.isfinite(x) or x<0 or x>.95 for x in peaks):
        raise ValueError('live boundary peak outside approved limit')
    for row, expected in zip(metrics['exitPeaks'],scene['exits']):
        if row.get('at')!=expected['at'] or row.get('bPosition')!=expected['bPosition']:
            raise ValueError('live exit source offset mismatch')
    for digest in (scene_sha,implementation_sha):
        if len(digest)!=64 or any(c not in '0123456789abcdef' for c in digest):
            raise ValueError('invalid live implementation or scene fingerprint')
    value=dict(schema='harbeat.live-layering.v1',scope='normal-playback-lab',producer='jetson',approved=True,
               implementationSha256=implementation_sha,sceneSha256=scene_sha,scene=scene,nativeGain=NATIVE_GAIN,
               entry=dict(sourcePosition=scene['clips']['aStart'],fadeSeconds=FADE_SECONDS,peak=metrics['entryPeak']),
               evidence=dict(runtime='live-layering-linear-8ms-v1',sourceVerified=True,producerHost=host,
                             entryPeak=metrics['entryPeak'],exitPeaks=metrics['exitPeaks'],
                             limitations=['Acoustic/source checks do not establish listening preference.',
                                          'Same-speed two-source lab scope; no arbitrary scene extension.']))
    value['id']=hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
    return value


def canonical_scene_bytes(scene):
    # Use the same ECMAScript number spelling and sorted-key JSON as the phone.
    node=shutil.which('node') or '/usr/local/bin/node'
    program="const fs=require('fs');const clean=v=>v===null||typeof v!=='object'?v:Array.isArray(v)?v.map(clean):Object.fromEntries(Object.keys(v).sort().map(k=>[k,clean(v[k])]));process.stdout.write(JSON.stringify(clean(JSON.parse(fs.readFileSync(0,'utf8')))))"
    return subprocess.check_output([node,'-e',program],input=json.dumps(scene,ensure_ascii=False).encode())


def measure_boundaries(scene, paths_a, paths_b, read_segment, sr):
    import numpy as np
    frames=round(scene['duration']*sr);fade_frames=round(FADE_SECONDS*sr)
    coverage_frames=math.ceil((scene['duration']+FADE_SECONDS)*sr)
    a_loop={r:read_segment(paths_a[r],scene['clips']['aStart'],scene['clips']['aEnd']-scene['clips']['aStart']) for r in ('bass','drums','other')}
    b_continuous={r:read_segment(paths_b[r],scene['clips']['bStart'],coverage_frames/sr) for r in ('bass','drums','other','vocals')}
    a_continuous={r:np.tile(x,(math.ceil(coverage_frames/len(x)),1))[:coverage_frames] for r,x in a_loop.items()}
    time=np.arange(coverage_frames)/sr
    def rendered(exit_point):
        out=np.zeros((coverage_frames,2),dtype=np.float32)
        for layer in scene['layers']:
            side,role=layer['side'],layer['role'];points=layer['points']
            gain=np.interp(time,[p[0] for p in points],[p[1] for p in points])
            # Exactly the live graph's immutable one-bar safe exit automation.
            mask=time>=exit_point['fadeStart'];start=np.interp(exit_point['fadeStart'],[p[0] for p in points],[p[1] for p in points]);mix=np.minimum(1,(time[mask]-exit_point['fadeStart'])/(exit_point['at']-exit_point['fadeStart']))
            gain[mask]=start*(1-mix)+float(side=='b')*mix
            pcm=a_continuous[role] if side=='a' else b_continuous[role]
            out+=pcm[:len(out)]*(gain*scene['sourceGains'][side]*scene['outputGain'])[:,None]
        return out
    alpha=np.minimum(1,np.arange(fade_frames)/(sr*FADE_SECONDS))[:,None]
    original_a=read_segment(paths_a['master'],scene['clips']['aStart'],FADE_SECONDS)*NATIVE_GAIN
    first=rendered(scene['exits'][-1]);entry=original_a*(1-alpha)+first[:fade_frames]*alpha
    entry_peak=float(np.max(np.abs(entry)));exits=[]
    for e in scene['exits']:
        out=rendered(e);n=round(e['at']*sr);body=read_segment(paths_b['master'],e['bPosition'],16)*NATIVE_GAIN
        if len(out[n:n+fade_frames])!=len(alpha) or len(body)<fade_frames:
            raise ValueError('missing measured native boundary coverage')
        handoff=out[n:n+fade_frames]*(1-alpha)+body[:fade_frames]*alpha
        peak=max(entry_peak,float(np.max(np.abs(out[:n]))),float(np.max(np.abs(handoff))),float(np.max(np.abs(body))))
        exits.append(dict(at=e['at'],bPosition=e['bPosition'],peak=peak,
                          scenePeak=float(np.max(np.abs(out[:n]))),handoffPeak=float(np.max(np.abs(handoff))),
                          nativeBodyPeak=float(np.max(np.abs(body))),nativeBodySeconds=16))
    return dict(sourceVerified=True,entryPeak=entry_peak,exitPeaks=exits,
                sourceEntryRmsDb=20*math.log10(max(1e-12,float(np.sqrt(np.mean(original_a**2))))),
                mixedEntryRmsDb=20*math.log10(max(1e-12,float(np.sqrt(np.mean(entry**2))))))


def run(args):
    import longmix_scene as source
    source.audio_dependencies()
    scene=json.loads(args.scene.read_text());tracks=source.load_tracks(args.metadata)
    if scene['rate']!=1:raise ValueError('same-speed live scope only')
    a,b=(tracks[scene['sources'][side]['trackId']] for side in ('a','b'))
    if a['duration']<=scene['clips']['aStart']+scene['duration']+.1 or b['duration']<scene['exits'][-1]['bPosition']+16:
        raise ValueError('live original/native source body coverage insufficient')
    paths={}
    for side,track in [('a',a),('b',b)]:
        files,proof=source.source_assets(track,args.nas,args.reports)
        actual=source.profile_proof(track,proof,args.execution_root)
        expected=scene['sources'][side]
        if any(actual.get(k)!=v for k,v in expected.items()):raise ValueError('source proof changed: '+side)
        paths[side]=files
    metrics=measure_boundaries(scene,paths['a'],paths['b'],source.read_segment,source.SR)
    args.output.mkdir(parents=True,exist_ok=True)
    (args.output/'live-measurements.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2,allow_nan=False))
    scene_sha=hashlib.sha256(canonical_scene_bytes(scene)).hexdigest()
    implementation_sha=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
    live=export_live(scene,scene_sha,metrics,implementation_sha,socket.gethostname())
    output=args.output/'live-scene.json';output.write_text(json.dumps(live,ensure_ascii=False,indent=2,allow_nan=False))
    print(json.dumps(dict(path=str(output),id=live['id'],sha256=hashlib.sha256(output.read_bytes()).hexdigest(),entryPeak=metrics['entryPeak'],exitPeaks=metrics['exitPeaks'],sourceTitles=[a['title'],b['title']]),ensure_ascii=False),flush=True)


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--scene',type=pathlib.Path,required=True);p.add_argument('--metadata',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,required=True)
    p.add_argument('--nas',type=pathlib.Path,default=pathlib.Path('/mnt/nas/harbeat/preprocess'));p.add_argument('--reports',type=pathlib.Path,default=pathlib.Path('/mnt/nas/harbeat/data/analysis-platform/reports'));p.add_argument('--execution-root',type=pathlib.Path,default=pathlib.Path('/mnt/nas/harbeat/preprocess/device-execution-v1'));run(p.parse_args())

if __name__=='__main__':main()
