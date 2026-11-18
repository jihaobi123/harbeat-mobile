"""Prepare isolated execution profiles from already analyzed NAS tracks."""
import argparse,json,pathlib,shutil
from four_role import target_rate


def run(a):
    target_rate(a.target_bpm,a.target_bpm)
    if not 60<=a.target_bpm<=120:raise ValueError('target BPM outside original scope')
    from analysis_platform.device_export import export_track
    a.output.mkdir(parents=True,exist_ok=True);(a.output/'profiles').mkdir(exist_ok=True)
    base=json.loads((a.base/'index.json').read_text());rows={r['trackId']:r for r in base['tracks']}
    for r in rows.values():
        name=r['profile']['sha256']+'.json';dest=a.output/'profiles'/name
        if not dest.exists():shutil.copyfile(a.base/'profiles'/name,dest)
    results=[]
    def save():
        (a.output/'profile-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
        (a.output/'index.json').write_text(json.dumps(dict(schema=base['schema'],targetBpm=a.target_bpm,tracks=list(rows.values()))))
    save()
    for p in sorted(a.metadata.glob('*-detail.json')):
        if p.name.startswith('._'):continue
        t=json.loads(p.read_text());t=t.get('track',t)
        if t['id']in rows:continue
        try:rate=target_rate(a.target_bpm,t['bpm'])
        except ValueError as error:
            results.append(dict(trackId=t['id'],title=t['title'],profileReady=False,reason='invalid-tempo',error=str(error)));save();continue
        if not .95<=rate<=1.05:
            results.append(dict(trackId=t['id'],title=t['title'],profileReady=False,reason='tempo-outside-original-range',sourceBpm=t['bpm'],targetBpm=a.target_bpm));save();continue
        try:
            r=export_track(t,a.nas,a.reports,a.output,profiles_only=True);rows[t['id']]=r
            results.append(dict(trackId=t['id'],title=t['title'],targetBpm=a.target_bpm,profileReady=True,assetsReady=r['assetsReady']))
        except Exception as e:results.append(dict(trackId=t['id'],title=t['title'],targetBpm=a.target_bpm,profileReady=False,error=str(e)))
        print(json.dumps(results[-1],ensure_ascii=False),flush=True)
        save()


def argument_parser():
    p=argparse.ArgumentParser()
    for k in ['base','metadata','output','nas','reports']:p.add_argument('--'+k,type=pathlib.Path,required=True)
    p.add_argument('--target-bpm',type=float,required=True)
    return p


if __name__=='__main__':
    run(argument_parser().parse_args())
