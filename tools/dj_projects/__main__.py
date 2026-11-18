"""Import a downloaded author package; never grant playback approval."""
import argparse,json,pathlib
from .importer import import_project,compile_requests
from .traktor_pack import import_trak
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('project',type=pathlib.Path);p.add_argument('--format',choices=['rekordbox','traktor','trak'],required=True)
p.add_argument('--source-url',required=True);p.add_argument('--audio-root',type=pathlib.Path,required=True)
p.add_argument('--output',type=pathlib.Path,required=True);p.add_argument('--expected-hashes',type=pathlib.Path);p.add_argument('--rules',type=pathlib.Path)
args=p.parse_args();raw=args.project.read_bytes()
project=import_trak(raw,args.audio_root,args.source_url)if args.format=='trak'else import_project(raw,args.format,args.audio_root,args.source_url,json.loads(args.expected_hashes.read_text())if args.expected_hashes else None)
args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(project,ensure_ascii=False,indent=2,allow_nan=False))
if args.rules:
 requests=compile_requests(project,json.loads(args.rules.read_text()));args.output.with_suffix('.requests.json').write_text(json.dumps(requests,ensure_ascii=False,indent=2,allow_nan=False))
print(json.dumps(dict(tracks=len(project['tracks']),verifiedAudio=sum(t.get('audioVerified',False)for t in project['tracks']),performanceOrder=project['performanceOrder'],executionApproved=False),ensure_ascii=False))
