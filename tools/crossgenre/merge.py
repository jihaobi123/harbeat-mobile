"""Verify and atomically merge isolated preprocessing publications."""
import hashlib,json,os,re,time
from pathlib import Path
from export import atomic,encoded
from preprocess import algorithm_sha,binding_for,POLICY
from decode import decoder_matches

def merge(catalog,parts,out):
 tracks={t['id']:t for t in catalog['tracks']};rows={};excluded={};algorithm=algorithm_sha();(out/'objects').mkdir(parents=True,exist_ok=True)
 for part in parts:
  if not (part/'index.json').exists():continue
  index=json.loads((part/'index.json').read_bytes())
  for row in index.get('tracks',[]):
   tid=row['trackId'];d=row['profile'];checksum=d['sha256']
   if tid in rows or tid not in tracks or not re.fullmatch('[a-f0-9]{64}',checksum):raise ValueError('duplicate or invalid source row')
   raw=(part/'objects'/(checksum+'.json')).read_bytes()
   if len(raw)!=d['bytes'] or hashlib.sha256(raw).hexdigest()!=checksum:raise ValueError('object fingerprint mismatch')
   profile=json.loads(raw)
   if not decoder_matches(profile.get('analysis',{}).get('inputDecoder')):raise ValueError('unsupported input decoder')
   try:source=binding_for(tracks[tid],row['source']['manifestSha256'])
   except (KeyError,TypeError) as e:raise ValueError('incomplete source binding') from e
   if row.get('algorithmSha256')!=algorithm or profile.get('algorithmSha256')!=algorithm or row.get('source')!=source or profile.get('source')!=source:raise ValueError('stale preprocessing source')
   if row['entryCount']!=len(profile['entries']) or row['exitCount']!=len(profile['exits']) or row['echoExitCount']!=sum(x['echoEligible'] for x in profile['exits']):raise ValueError('cue count mismatch')
   dest=out/'objects'/(checksum+'.json')
   if dest.exists():
    if dest.read_bytes()!=raw:raise ValueError('immutable object conflict')
   else:atomic(dest,raw)
   rows[tid]=row
  for row in index.get('excluded',[]):
   if row['trackId'] not in tracks or row['trackId'] in rows or row['trackId'] in excluded:raise ValueError('duplicate excluded row')
   excluded[row['trackId']]=row
 value=dict(schema='harbeat.crossgenre-library.v1',policy=POLICY,producer='jetson',algorithmSha256=algorithm,tracks=sorted(rows.values(),key=lambda x:x['trackId']),excluded=sorted(excluded.values(),key=lambda x:x['trackId']),generatedAt=time.time(),coverage=dict(public=len(tracks),prepared=len(rows),withEntries=sum(x['entryCount']>0 for x in rows.values()),withExits=sum(x['exitCount']>0 for x in rows.values())))
 atomic(out/'index.json',encoded(value));return value
