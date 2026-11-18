#!/usr/bin/env python3
"""Publish source-verified additive lab metadata; no audio or existing AB changes."""
import argparse,fcntl,hashlib,json,pathlib,math
from publish_loop_extension import atomic
from multi_layering import decide
sha=lambda b:hashlib.sha256(b).hexdigest()
def publish(stage,root,execution,base_root,history):
 stage,root,execution,base_root,history=map(pathlib.Path,(stage,root,execution,base_root,history));root.mkdir(parents=True,exist_ok=True);history.mkdir(mode=0o700,parents=True,exist_ok=True)
 with (root.parent/'.index.lock').open('a')as lock:
  fcntl.flock(lock,fcntl.LOCK_EX);before=(root/'index.json').read_bytes()if(root/'index.json').exists()else None
  old=json.loads(before)if before else dict(schema='harbeat.multi-layering-index.v1',scenes=[]);new=json.loads((stage/'index.json').read_text());assert old['schema']==new['schema']=='harbeat.multi-layering-index.v1'
  ready={r['trackId']:r for r in json.loads(execution.read_text())['tracks']if r['assetsReady']}
  bases={}
  for row in json.loads((base_root/'index.json').read_text())['scenes']:
   raw=(base_root/(row['sha256']+'.json')).read_bytes();assert sha(raw)==row['sha256'];bases[row['id']]=json.loads(raw)
  additions=[];known={r['sha256']:r for r in old['scenes']};rows=list(old['scenes'])
  for r in rows:assert sha((root/(r['sha256']+'.json')).read_bytes())==r['sha256']
  for row in new['scenes']:
   h=row['sha256'];assert len(h)==64 and all(c in '0123456789abcdef'for c in h)and row['url']=='/listen/multi-layering/v1/'+h+'.json'
   raw=(stage/(h+'.json')).read_bytes();assert len(raw)<=2*1024*1024 and sha(raw)==h;p=json.loads(raw);json.dumps(p,allow_nan=False)
   assert p['schema']=='harbeat.multi-layering.v1'and p['producer']=='jetson'and p['approved']is True and p['mode']=='additive'and p['base']==bases[row['baseId']]and len(p['sources'])==row['sources']
   e=p['evidence'];mh=e['measurementsSha256'];assert len(mh)==64 and all(c in '0123456789abcdef'for c in mh);measure=(stage/'measurements'/(mh+'.json')).read_bytes();assert sha(measure)==mh;m=json.loads(measure);assert decide(m,2+row['sources']);assert m['arrangement']==dict(base=p['base'],sources=p['sources'],layers=p['layers'])and e['arrangementSha256']==m['arrangementSha256']
   for k in ['peak','lowEnergyRatio','addedRmsDb','exitPeaks']:assert e[k]==m[k]
   assert e['checks']=={k:m[k]for k in e['checks']}and e['pairwise']==m['pairwise']
   for proof in [*p['base']['scene']['sources'].values(),*p['sources'].values()]:
    r=ready[proof['trackId']];assert proof['masterSha256']==r['sourceSha256']and proof['reportSha256']==r['reportSha256']and proof['manifestSha256']==r['manifestSha256']and proof['profileSha256']==r['profile']['sha256']and proof['runId']==r['runId']and proof['stemSha256']==r['stemSha256']and proof['vocalSha256']==r['stemSha256']['vocals']
   if h in known:assert row==known[h];continue
   known[h]=row;rows.append(row);additions.append((h,raw))
  assert len(rows)<=256
  if before:atomic(history/('index-before-'+sha(before)+'.json'),before)
  for h,raw in additions:
   dest=root/(h+'.json')
   if dest.exists():assert dest.read_bytes()==raw
   else:atomic(dest,raw)
  assert ((root/'index.json').read_bytes()if(root/'index.json').exists()else None)==before
  after=json.dumps(dict(schema=old['schema'],scenes=rows),ensure_ascii=False,indent=2).encode();atomic(root/'index.json',after)
  receipt=dict(oldCount=len(old['scenes']),newCount=len(rows),beforeSha256=sha(before)if before else None,afterSha256=sha(after),executionIndexSha256=sha(execution.read_bytes()),sourceAudioModified=False,baseIndexModified=False)
  atomic(history/('receipt-'+sha(after)+'.json'),json.dumps(receipt,indent=2).encode());return receipt
if __name__=='__main__':
 p=argparse.ArgumentParser();[p.add_argument('--'+k,required=True)for k in ['stage','root','execution','base-root','history']];a=p.parse_args();print(json.dumps(publish(a.stage,a.root,a.execution,a.base_root,a.history)))
