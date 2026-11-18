"""Verify exactly the master/vocal evidence consumed by crossgenre preprocessing."""
import hashlib,json,re

def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for block in iter(lambda:f.read(8*1024*1024),b''):h.update(block)
 return h.hexdigest()

def source_assets(track,nas,reports,info=None):
 if info is None:
  import soundfile
  info=soundfile.info
 p=track['provenance'];tid=track['id'];run=p['runId']
 if not all(re.fullmatch('[A-Za-z0-9_-]{1,160}',x) for x in [tid,run]) or not re.fullmatch('[a-f0-9]{64}',track['reportId']):raise ValueError('invalid source identity')
 folder=nas/'published/tracks'/tid/'runs'/run;mf=folder/'manifest.json';m=json.loads(mf.read_bytes());success=json.loads((folder/'_SUCCESS.json').read_bytes());report=reports/(track['reportId']+'.json');manifest=sha(mf)
 if manifest!=success['manifest_sha256'] or sha(report)!=p['reportSha256'] or m['track_id']!=tid or m['analysis_run_id']!=run or m['assets']['master']['sha256']!=p['masterSha256'] or m['assets']['stems']['vocals']['sha256']!=p['vocalSha256']:raise ValueError('manifest or report fingerprint mismatch')
 paths={};proof={}
 # Other stems are not inputs to this policy. Reading/hashing their full audio
 # would add NAS traffic without supplying evidence for any crossgenre cue.
 for key,asset in [('master',m['assets']['master']),('vocals',m['assets']['stems']['vocals'])]:
  path=(nas/asset['storage_key']).resolve()
  if nas.resolve() not in path.parents or not path.is_file() or sha(path)!=asset['sha256']:raise ValueError('audio fingerprint mismatch')
  meta=info(path)
  if meta.channels!=2 or abs(meta.duration-track['duration'])>.05:raise ValueError('audio shape mismatch')
  paths[key]=path;proof[key]=dict(sha256=asset['sha256'],duration=meta.duration,sampleRate=meta.samplerate,channels=meta.channels)
 return paths,dict(trackId=tid,runId=run,manifestSha256=manifest,reportSha256=p['reportSha256'],assets=proof)
