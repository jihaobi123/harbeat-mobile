#!/usr/bin/env python3
"""Append verified immutable loop approvals. Run on cloud, never changes music."""
import argparse,fcntl,hashlib,json,os,pathlib,time
sha=lambda b:hashlib.sha256(b).hexdigest()
def atomic(path,data):
 tmp=path.with_name('.'+path.name+'.'+str(time.time_ns()))
 with tmp.open('xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
 os.chmod(tmp,0o644);os.replace(tmp,path);fd=os.open(path.parent,os.O_RDONLY);os.fsync(fd);os.close(fd)
def publish(stage,root,execution,history):
 stage,root,execution,history=map(pathlib.Path,(stage,root,execution,history));root.mkdir(parents=True,exist_ok=True);history.mkdir(mode=0o700,parents=True,exist_ok=True)
 with (root.parent/'.index.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX);before=(root/'index.json').read_bytes() if (root/'index.json').exists() else None
  old=json.loads(before) if before else dict(schema='harbeat.loop-extension-index.v1',loops=[]);assert old['schema']=='harbeat.loop-extension-index.v1'
  source=json.loads(execution.read_text());ready={r['trackId']:r for r in source['tracks'] if r['assetsReady']};index=json.loads((stage/'index.json').read_text());assert index['schema']==old['schema'];rows=list(old['loops']);byid={r['id']:r for r in rows};additions=[]
  for row in rows:assert sha((root/(row['sha256']+'.json')).read_bytes())==row['sha256']
  for row in index['loops']:
   h=row['sha256'];assert len(h)==64 and all(c in '0123456789abcdef' for c in h) and row['url']=='/listen/loop-extension/v1/'+h+'.json';raw=(stage/(h+'.json')).read_bytes();assert len(raw)<=2*1024*1024 and sha(raw)==h;p=json.loads(raw);assert p['schema']=='harbeat.loop-extension.v1' and p['producer']=='jetson' and p['approved'] is True and p['id']==row['id'] and p['startFrame']==row['startFrame'];proof=p['source'];r=ready[row['trackId']];assert proof['trackId']==row['trackId'] and proof['masterSha256']==r['sourceSha256'] and proof['reportSha256']==r['reportSha256'] and proof['manifestSha256']==r['manifestSha256'] and proof['profileSha256']==r['profile']['sha256'] and proof['runId']==r['runId'] and proof['stemSha256']==r['stemSha256']
   if row['id'] in byid:assert row==byid[row['id']];continue
   byid[row['id']]=row;rows.append(row);additions.append((row,raw))
  assert len(rows)<=256
  if before:atomic(history/('index-before-'+sha(before)+'.json'),before)
  for row,raw in additions:
   dest=root/(row['sha256']+'.json')
   if dest.exists():assert dest.read_bytes()==raw
   else:
    with dest.open('xb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
    os.chmod(dest,0o644)
  assert ((root/'index.json').read_bytes() if (root/'index.json').exists() else None)==before
  after=(json.dumps(dict(schema=old['schema'],loops=rows),ensure_ascii=False,indent=2)+'\n').encode();atomic(root/'index.json',after)
  receipt=dict(beforeSha256=sha(before) if before else None,afterSha256=sha(after),oldCount=len(old['loops']),addedCount=len(additions),newCount=len(rows),sourceAudioModified=False,plannerModified=False,executionIndexSha256=sha(execution.read_bytes()));atomic(history/('receipt-'+sha(after)+'.json'),json.dumps(receipt,indent=2).encode());return receipt
if __name__=='__main__':
 p=argparse.ArgumentParser();[p.add_argument('--'+k,required=True) for k in ['stage','root','execution','history']];a=p.parse_args();print(json.dumps(publish(a.stage,a.root,a.execution,a.history)))
