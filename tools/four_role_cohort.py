"""Fixed-denominator, resumable Jetson experiment runner; never publishes audio."""
from __future__ import annotations
import argparse,collections,datetime,hashlib,json,math,os,pathlib,re,shutil,subprocess,sys

STATUSES={'approved','needs-vocal-review','no-compatible-c','no-compatible-d','source-unavailable','base-ineligible','error','not-run'}

def digest(p):
 h=hashlib.sha256()
 with pathlib.Path(p).open('rb')as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()

def atomic(p,value):
 p=pathlib.Path(p);p.parent.mkdir(parents=True,exist_ok=True);tmp=p.with_suffix(p.suffix+'.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False));os.replace(tmp,p)

def validate_cohort(m):
 rows=m.get('pairs',[])
 if len(rows)!=12 or m.get('policy',{}).get('denominator')!=12:raise ValueError('exactly 12 fixed pairs required')
 ids=set();pairs=set()
 for r in rows:
  if not re.fullmatch(r'pair-\d{2}',r.get('caseId',''))or r['caseId']in ids or (r.get('a'),r.get('b'))in pairs or r.get('a')==r.get('b'):raise ValueError('duplicate or invalid fixed pair')
  if any(not re.fullmatch(r'track-[a-f0-9]{20}',r.get(k,''))for k in ['a','b']):raise ValueError('invalid track id')
  if any(type(r.get(k))not in(int,float)or not math.isfinite(r[k])or r[k]<0 for k in ['start','bStart']):raise ValueError('invalid frozen source cue')
  ids.add(r['caseId']);pairs.add((r['a'],r['b']))
 return rows

def summarize(m,results):
 rows=validate_cohort(m);stages={k:collections.Counter()for k in ['c','d']};full=[]
 for r in rows:
  outcome=results.get(r['caseId'],dict(c='not-run',d='not-run'))
  for k in stages:
   if outcome.get(k)not in STATUSES:raise ValueError('unknown outcome')
   stages[k][outcome[k]]+=1
  full.append({**r,**outcome})
 return dict(schema='harbeat.four-role-cohort-results.v1',denominator=12,stages={k:dict(v)for k,v in stages.items()},pairs=full)

def scan_outcome(root,returncode=0):
 root=pathlib.Path(root)
 if returncode:return dict(c='error',d='error',returncode=returncode,artifacts=str(root))
 def read(name):
  p=root/name;return json.loads(p.read_text())if p.exists()else[]
 def cases(name):
  result=[]
  for row in read(name):
   p=pathlib.Path(row['case']).resolve()
   if not p.is_relative_to(root.resolve()):raise ValueError('case path escaped experiment')
   scene=json.loads((p/'scene.json').read_text())
   if row.get('approved')is True and scene.get('approved')is True:status='approved'
   elif row.get('approved')is False and scene.get('approved')is False and scene.get('qualityStatus')=='needs-vocal-review':status='needs-vocal-review'
   else:raise ValueError('case approval receipt mismatch')
   result.append(dict(path=str(p),id=row.get('id'),status=status,sha256=digest(p/'scene.json')))
  return result
 c=cases('approved-c-only.json');d=cases('accepted.json')
 best=lambda values: 'approved'if any(x['status']=='approved'for x in values)else'needs-vocal-review'
 rows=read('scan-results.json');only_errors=bool(rows)and all(r.get('error')for r in rows)
 cs=best(c)if c else'source-unavailable'if only_errors else'no-compatible-c'
 ds=best(d)if d else'source-unavailable'if only_errors else'no-compatible-d'if c else'no-compatible-c'
 return dict(c=cs,d=ds,cases={'c':c,'d':d},artifacts=str(root),blockedD=not bool(c),candidateRecords=len(rows))

def base_state(pair,folder):
 measurement=folder/'measurements.json';live=folder/'live-scene.json'
 if not measurement.exists():return None,dict(c='source-unavailable',d='source-unavailable',reason='base measurements missing')
 m=json.loads(measurement.read_text())
 if m.get('approved')is not True:
  reasons=sorted({x for row in m.get('exits',[])for x in row.get('decision',{}).get('rejected',[])})
  return None,dict(c='base-ineligible',d='base-ineligible',reason='original AB did not pass',rejected=reasons,baseMeasurementSha256=digest(measurement))
 if not live.exists():return None,dict(c='source-unavailable',d='source-unavailable',reason='approved live base missing')
 b=json.loads(live.read_text());s=b.get('scene',{})
 if b.get('approved')is not True or s.get('approved')is not True or any(s.get('sources',{}).get(side,{}).get('trackId')!=pair[k]for side,k in [('a','a'),('b','b')])or any(abs(s.get('clips',{}).get(k,-1)-pair[v])>1/44100 for k,v in [('aStart','start'),('bStart','bStart')]):raise ValueError('base no longer matches frozen AB source coordinates')
 return live,None

def source_snapshot_unchanged(snapshot):
 tracks=snapshot.get('tracks',{})
 if not tracks:return False
 try:
  for item in tracks.values():
   if not item.get('files'):return False
   for stamp in item['files'].values():
    p=pathlib.Path(stamp['path']);info=p.stat()
    if info.st_size!=stamp['size']or info.st_mtime_ns!=stamp['mtime_ns']:return False
  return True
 except (OSError,KeyError,TypeError):return False


def run(a):
 m=json.loads(a.manifest.read_text());pairs=validate_cohort(m);a.output.mkdir(parents=True,exist_ok=True);manifest_hash=digest(a.manifest);frozen=a.output/'frozen-cohort.json'
 if frozen.exists()and digest(frozen)!=manifest_hash:raise ValueError('cohort already frozen with another manifest')
 if not frozen.exists():shutil.copyfile(a.manifest,frozen)
 implementation={str(p):digest(p)for p in [pathlib.Path(__file__),a.scanner,a.scanner.with_name('four_role.py'),a.scanner.with_name('four_role_cache.py'),a.scanner.with_name('four_role_vocal_candidates.py'),a.scanner.with_name('four_role_local_rank.py'),a.measure,a.stretch]};execution_hash=digest(a.execution/'index.json');results={}
 receipt=a.output/'run-results.json'
 if receipt.exists():results={r['caseId']:{k:v for k,v in r.items()if k not in next(p for p in pairs if p['caseId']==r['caseId'])}for r in json.loads(receipt.read_text())['pairs']if r.get('c')!='not-run'}
 def save():atomic(receipt,{**summarize(m,results), 'manifestSha256':manifest_hash,'implementations':implementation,'executionIndexSha256':execution_hash,'updatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
 save()
 for pair in pairs:
  case=pair['caseId'];basefolder=a.base_root/('generality12-'+case[-2:]);live,state=base_state(pair,basefolder)
  if state:results[case]=state;save();print(json.dumps(dict(caseId=case,**state)),flush=True);continue
  fingerprint=dict(manifestSha256=manifest_hash,implementations=implementation,executionIndexSha256=execution_hash,baseSha256=digest(live))
  old=results.get(case);oldroot=pathlib.Path(old.get('artifacts',''))if old else None
  if old and old.get('fingerprint')==fingerprint and old.get('c')!='error'and oldroot and(oldroot/'source-snapshot.json').exists():
   # Only resume after freshly checking the recorded source-stat snapshot.
   snapshot=json.loads((oldroot/'source-snapshot.json').read_text())
   if source_snapshot_unchanged(snapshot):print(json.dumps(dict(caseId=case,resumed=True)),flush=True);continue
  if any(digest(p)!=h for p,h in implementation.items()):raise ValueError('implementation changed during fixed experiment')
  parent=a.output/case;parent.mkdir(exist_ok=True);num=len(list(parent.glob('attempt-*')))+1;out=parent/f'attempt-{num:02}';out.mkdir();shutil.copyfile(live,out/'base.json');atomic(out/'request.json',dict(pair=pair,fingerprint=fingerprint))
  command=[str(a.python),'-u',str(a.scanner),'--voice-review','--extra-start-beat','12','--extra-end-beat','20','--metadata',str(a.metadata),'--base',str(out/'base.json'),'--output',str(out),'--stretch',str(a.stretch),'--measure',str(a.measure),'--execution',str(a.execution),'--max-c-tracks','4','--max-c-windows','2','--max-d-tracks','4','--max-d-windows','2','--max-c-checks','8','--max-d-checks','8']
  print(json.dumps(dict(caseId=case,started=True,attempt=str(out))),flush=True)
  with(out/'scan.log').open('w')as log:
   try:returncode=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT,timeout=a.case_timeout).returncode
   except subprocess.TimeoutExpired:returncode=124
  try:result=scan_outcome(out,returncode)
  except Exception as e:result=dict(c='error',d='error',reason=str(e),artifacts=str(out))
  results[case]={**result,'fingerprint':fingerprint};save();print(json.dumps(dict(caseId=case,**result)),flush=True)
 print(json.dumps(dict(done=True,summary=str(receipt))),flush=True)

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__)
 for k in ['manifest','base-root','metadata','execution','output','scanner','measure','stretch','python']:p.add_argument('--'+k,type=pathlib.Path,required=True)
 p.add_argument('--case-timeout',type=int,default=1800);run(p.parse_args())
