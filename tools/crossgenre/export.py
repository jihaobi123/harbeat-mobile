"""Jetson-only incremental exporter, isolated from existing analysis reports."""
import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from preprocess import build_profile, algorithm_sha, binding_for, POLICY
from decode import NativeDecoder,decoder_matches


def encoded(value):
    return json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()


def atomic(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_name(path.name+'.part-'+str(os.getpid()))
    temp.write_bytes(data);os.replace(temp,path)


def cache_current(entry,track,verified_proof,out,algorithm):
    if not entry or entry.get('algorithmSha256')!=algorithm:return False
    source=binding_for(track,verified_proof['manifestSha256'])
    if entry.get('source')!=source:return False
    descriptor=entry.get('profile',{});checksum=descriptor.get('sha256','')
    if len(checksum)!=64 or any(c not in '0123456789abcdef' for c in checksum):return False
    file=out/'objects'/(checksum+'.json')
    if not file.is_file() or file.stat().st_size!=descriptor.get('bytes'):return False
    raw=file.read_bytes()
    profile=json.loads(raw)
    return hashlib.sha256(raw).hexdigest()==checksum and profile.get('source')==source and decoder_matches(profile.get('analysis',{}).get('inputDecoder'))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--code',type=Path,default=Path('/home/mark/harbeat-metric-mix'))
    parser.add_argument('--nas',type=Path,default=Path('/mnt/nas/harbeat/preprocess'))
    parser.add_argument('--reports',type=Path,default=Path('/mnt/nas/harbeat/data/analysis-platform/reports'))
    parser.add_argument('--track-id',action='append',default=[])
    args=parser.parse_args();sys.path.insert(0,str(args.code))
    from metric_mix.prepare import bound
    from sources import source_assets
    catalog=json.loads(args.catalog.read_bytes());out=args.output;out.mkdir(parents=True,exist_ok=True)
    index_path=out/'index.json';old=json.loads(index_path.read_bytes()) if index_path.is_file() else {}
    rows={x['trackId']:x for x in old.get('tracks',[])};failures={x['trackId']:x for x in old.get('excluded',[])}
    algorithm=algorithm_sha();started=time.time()
    public_ids={t['id'] for t in catalog['tracks']}
    def checkpoint():
        rows_valid=[v for k,v in rows.items() if k in public_ids and v.get('algorithmSha256')==algorithm]
        atomic(index_path,encoded(dict(schema='harbeat.crossgenre-library.v1',policy=POLICY,producer='jetson',
                                      algorithmSha256=algorithm,tracks=rows_valid,excluded=[v for k,v in failures.items() if k in public_ids],
                                      generatedAt=time.time(),coverage=dict(public=len(public_ids),prepared=len(rows_valid),
                                                                          withEntries=sum(bool(x['entryCount']) for x in rows_valid),
                                                                          withExits=sum(bool(x['exitCount']) for x in rows_valid)))))
    for track in catalog['tracks']:
        tid=track['id']
        if args.track_id and tid not in args.track_id:continue
        try:
            bound(track)
            # Validate current NAS manifest, _SUCCESS, report and actual source
            # master/vocal input files before reuse. An old object digest alone is not authority.
            with NativeDecoder() as decoder:
                paths,proof=source_assets(track,args.nas,args.reports,info=decoder.info)
                previous=rows.get(tid)
                if cache_current(previous,track,proof,out,algorithm):
                    print(json.dumps(dict(trackId=tid,status='cached')),flush=True);continue
                profile=build_profile(track,decoder.measure(paths['master']),decoder.measure(paths['vocals']),
                                      manifest_sha=proof['manifestSha256'],algorithm_sha=algorithm)
                if decoder.decoded:profile['analysis']['inputDecoder']=decoder.evidence(paths)
            raw=encoded(profile);checksum=hashlib.sha256(raw).hexdigest();file=out/'objects'/(checksum+'.json')
            if file.exists() and file.read_bytes()!=raw:raise ValueError('immutable object conflict')
            if not file.exists():atomic(file,raw)
            rows[tid]=dict(trackId=tid,source=profile['source'],algorithmSha256=algorithm,
                           profile=dict(url='/listen/crossgenre/objects/'+checksum+'.json',sha256=checksum,bytes=len(raw)),
                           entryCount=len(profile['entries']),exitCount=len(profile['exits']),
                           echoExitCount=sum(x['echoEligible'] for x in profile['exits']))
            failures.pop(tid,None);checkpoint()
            print(json.dumps(dict(trackId=tid,status='ready',entries=len(profile['entries']),exits=len(profile['exits']),
                                  echoes=rows[tid]['echoExitCount'],elapsedSec=round(time.time()-started,2))),flush=True)
        except Exception as exc:
            rows.pop(tid,None);failures[tid]=dict(trackId=tid,status='unavailable',reason='source_or_acoustic_evidence_failed')
            checkpoint();print(json.dumps(dict(trackId=tid,status='failed',diagnostic=str(exc))),flush=True)
    checkpoint()


if __name__=='__main__':main()
