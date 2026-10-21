"""Validate reusable execution assets, independently of pair-rendered WAVs."""
from __future__ import annotations

import json
import fcntl
import os
import time
from .worker import HASH, IDENTIFIER, PreparationError, confined, finite, media_valid

STEMS=('drums','bass','other','vocals')
MAX_EDGES=288
MAX_EDGES_PER_TRACK=24
REGIONS_PER_TRACK=8
TARGETS_PER_REGION=3


def unavailable_execution_ids(settings):
    """Exclude known publisher failures, retaining not-yet-published sources.

    A manifest can appear before the next index write. Let its normal identity
    and media validation decide readiness rather than a stale excluded entry.
    """
    root=settings.execution_root
    if root is None:return set()
    index=root/'index.json'
    if not index.is_file():return set()
    if index.stat().st_size>8*1024*1024:raise PreparationError('invalid_execution_index')
    value=json.loads(index.read_bytes())
    excluded=value.get('excluded',[])
    if value.get('schema')!='harbeat.execution-library.v1' or not isinstance(excluded,list) or len(excluded)>5000:raise PreparationError('invalid_execution_index')
    ids=set()
    for row in excluded:
        if not isinstance(row,dict) or not IDENTIFIER.fullmatch(str(row.get('trackId',''))):raise PreparationError('invalid_execution_index')
        if not (root/'tracks'/(row['trackId']+'.json')).is_file():ids.add(row['trackId'])
    return ids


def source_identity(source):
    return {'reportId':source.get('reportId'),**{key:source.get('provenance',{}).get(key) for key in ('runId','masterSha256','reportSha256','vocalSha256')}}


def validate_candidate_edges(edges, sources, coverage, tracks=None, *, allow_empty=False):
    """Check the bounded source-bound v2 wire protocol, never infer musical gates.

    The trusted bundled TS planner supplies beat/vocal decisions; the device
    reconstructs them again from its current catalog before using a saved edge.
    """
    by_id={source['id']:source for source in sources}
    if not isinstance(edges,list) or len(edges)>MAX_EDGES or not edges and not allow_empty:raise PreparationError('invalid_candidate_edges')
    signatures=set();outgoing={};regions={};targets={}
    for edge in edges:
        if not isinstance(edge,dict):raise PreparationError('invalid_candidate_edge')
        a,b=by_id.get(edge.get('from')),by_id.get(edge.get('to'))
        if (a is None or b is None or a['id']==b['id'] or edge.get('version')!='activity-candidate-v2'
            or not isinstance(edge.get('id'),str) or not 1<=len(edge['id'])<=512
            or not IDENTIFIER.fullmatch(str(edge.get('windowId','')))
            or edge.get('kind') not in ('automatic','nearby')
            or not all(finite(edge.get(key)) for key in ('start','end','duration','rate','bStart','bEnd','score'))):raise PreparationError('invalid_candidate_edge')
        if (not 0<=edge['start']<edge['end']<=a['duration']+.002 or not 1<=edge['duration']<=32
            or abs(edge['end']-edge['start']-edge['duration'])>.002 or not .95<=edge['rate']<=1.05
            or not 0<=edge['bStart']<edge['bEnd']<=b['duration']-16+.002
            or abs((edge['bEnd']-edge['bStart'])/edge['rate']-edge['duration'])>.002):raise PreparationError('invalid_candidate_geometry')
        if edge.get('source')!={'a':source_identity(a),'b':source_identity(b)}:raise PreparationError('candidate_source_mismatch')
        if any(not isinstance(source_identity(s)[k],str) or not 1<=len(source_identity(s)[k])<=512 for s in (a,b) for k in ('reportId','runId')):raise PreparationError('candidate_source_mismatch')
        if any(not HASH.fullmatch(str(source_identity(s)[k] or '')) for s in (a,b) for k in ('masterSha256','reportSha256','vocalSha256')):raise PreparationError('candidate_source_mismatch')
        region=min(REGIONS_PER_TRACK-1,int(edge['start']/a['duration']*REGIONS_PER_TRACK))
        if type(edge.get('region')) is not int or edge['region']!=region:raise PreparationError('invalid_candidate_region')
        signature=(a['id'],b['id'],edge['windowId'],edge['start'])
        if signature in signatures:raise PreparationError('duplicate_planner_edge')
        signatures.add(signature)
        outgoing[a['id']]=outgoing.get(a['id'],0)+1
        bucket=(a['id'],region);regions[bucket]=regions.get(bucket,0)+1
        if b['id'] in targets.setdefault(bucket,set()):raise PreparationError('candidate_target_duplicate')
        targets[bucket].add(b['id'])
        if outgoing[a['id']]>MAX_EDGES_PER_TRACK or regions[bucket]>TARGETS_PER_REGION:raise PreparationError('planner_edge_limit')
        if tracks is not None:
            target=next(t for t in tracks if t['id']==b['id'])
            window=next((w for w in target['windows'] if w.get('id')==edge['windowId']),None)
            asset=window.get('variants',{}).get(a['id']) if window else None
            if (not asset or any(not finite(window.get(k)) for k in ('start','end'))
                or abs(window['start']-edge['bStart'])>.002 or abs(window['end']-edge['bEnd'])>.002
                or not finite(asset.get('rate')) or abs(asset['rate']-edge['rate'])>.00001
                or not finite(asset.get('duration')) or abs(asset['duration']-edge['duration'])>.002):raise PreparationError('candidate_window_mismatch')
    if (not isinstance(coverage,dict) or coverage.get('schema')!='harbeat.activity-coverage.v1'
        or coverage.get('maxEdgesPerTrack')!=MAX_EDGES_PER_TRACK or coverage.get('maxTargetsPerRegion')!=TARGETS_PER_REGION
        or coverage.get('regionsPerTrack')!=REGIONS_PER_TRACK or not isinstance(coverage.get('tracks'),list)
        or len(coverage['tracks'])!=len(by_id) or {row.get('trackId') for row in coverage['tracks']}!=set(by_id)):raise PreparationError('invalid_candidate_coverage')
    for row in coverage['tracks']:
        source=by_id[row['trackId']];buckets=row.get('regions')
        if not isinstance(buckets,list) or len(buckets)!=REGIONS_PER_TRACK:raise PreparationError('invalid_candidate_coverage')
        for index,bucket in enumerate(buckets):
            if (not isinstance(bucket,dict) or bucket.get('index')!=index or not finite(bucket.get('start')) or not finite(bucket.get('end'))
                or abs(bucket['start']-index*source['duration']/REGIONS_PER_TRACK)>.002
                or abs(bucket['end']-(index+1)*source['duration']/REGIONS_PER_TRACK)>.002
                or type(bucket.get('candidates')) is not int or bucket['candidates']!=regions.get((source['id'],index),0)):raise PreparationError('invalid_candidate_coverage')
        if type(row.get('complete')) is not bool or row['complete']!=all(bucket['candidates']>0 for bucket in buckets):raise PreparationError('invalid_candidate_coverage')
    return True


def read_execution_track(settings, source):
    root=settings.execution_root
    if root is None:raise PreparationError('execution_not_configured')
    path=confined(root,'tracks/'+source['id']+'.json')
    if not path.is_file() or path.stat().st_size>4*1024*1024:
        if source['id'] in unavailable_execution_ids(settings):raise PreparationError('execution_source_unavailable')
        raise PreparationError('execution_assets_pending')
    value=json.loads(path.read_bytes())
    provenance=source['provenance']
    if (value.get('schema')!='harbeat.execution-track.v1' or value.get('trackId')!=source['id']
        or value.get('runId')!=provenance.get('runId')
        or value.get('sourceSha256')!=provenance.get('masterSha256')
        or value.get('reportSha256')!=provenance.get('reportSha256')
        or not HASH.fullmatch(str(value.get('sourceSha256','')))
        or not HASH.fullmatch(str(value.get('reportSha256','')))
        or value.get('sampleRate') not in (22050,24000,32000,44100,48000,88200,96000)
        or value.get('channels') not in (1,2)):
        raise PreparationError('execution_source_mismatch')
    sr=value['sampleRate'];frames=value.get('frames')
    if type(frames) is not int or frames<=0 or not finite(value.get('duration')) or abs(value['duration']-frames/sr)>1/sr or abs(value['duration']-source['duration'])>.05:
        raise PreparationError('execution_sample_timeline')
    profile=value.get('profile',{});psha=profile.get('sha256')
    if not HASH.fullmatch(str(psha)) or profile.get('url')!=f'/listen/execution/profiles/{psha}.json' or type(profile.get('bytes')) is not int or not 0<profile['bytes']<=16*1024*1024:
        raise PreparationError('execution_profile_invalid')
    profile_path=confined(root,f'profiles/{psha}.json')
    if not media_valid(profile_path,profile):raise PreparationError('execution_profile_invalid')
    evidence=json.loads(profile_path.read_bytes())
    if evidence.get('schema')!='harbeat.execution-profile.v1' or any(evidence.get(k)!=value.get(k) for k in ('trackId','runId','sourceSha256','reportSha256')):
        raise PreparationError('execution_profile_source_mismatch')
    grid=None
    for stem in STEMS:
        info=value.get('stems',{}).get(stem,{})
        if not HASH.fullmatch(str(info.get('sourceSha256',''))):raise PreparationError('execution_stem_identity')
        if stem=='vocals' and info['sourceSha256']!=provenance.get('vocalSha256'):raise PreparationError('execution_source_mismatch')
        if evidence.get('stems',{}).get(stem,{}).get('sourceSha256')!=info['sourceSha256']:raise PreparationError('execution_profile_source_mismatch')
        segments=info.get('segments')
        if not isinstance(segments,list) or not 1<=len(segments)<=5400:raise PreparationError('execution_segments_invalid')
        end=0;end_frame=0;boundaries=[]
        for segment in segments:
            start,stop=segment.get('start'),segment.get('end')
            if not finite(start) or not finite(stop) or abs(start-end)>.0001 or not start<stop<=source['duration']+.05:
                raise PreparationError('execution_segments_invalid')
            asset=segment.get('asset',{});sha=asset.get('sha256');url=asset.get('url','')
            first,last=segment.get('startFrame'),segment.get('endFrame')
            if (type(first) is not int or type(last) is not int or first!=end_frame or not first<last<=frames
                or abs(start-first/sr)>1e-6 or abs(stop-last/sr)>1e-6
                or asset.get('sampleRate')!=sr or asset.get('channels')!=value['channels'] or asset.get('frames')!=last-first):
                raise PreparationError('execution_sample_timeline')
            if not HASH.fullmatch(str(sha)) or url not in (f'/listen/execution-media/{sha}.flac',f'/listen/execution-media/{sha}.wav'):
                raise PreparationError('execution_asset_path')
            if not finite(asset.get('duration')) or abs(asset['duration']-(stop-start))>.0001 or type(asset.get('bytes')) is not int or not 0<asset['bytes']<=64*1024*1024:
                raise PreparationError('execution_asset_invalid')
            extension=url.rsplit('.',1)[1]
            if not media_valid(confined(root,f'objects/{sha}.{extension}'),asset):raise PreparationError('execution_asset_invalid')
            end=stop
            end_frame=last;boundaries.append((first,last))
        if abs(end-source['duration'])>.05:raise PreparationError('execution_segments_incomplete')
        if end_frame!=frames:raise PreparationError('execution_segments_incomplete')
        if grid is None:grid=boundaries
        elif boundaries!=grid:raise PreparationError('execution_sample_timeline')
    return value


def validate_execution_pack(settings, pack):
    try:
        execution=pack['execution']
        if execution.get('schema') not in ('harbeat.activity-execution.v1','harbeat.activity-execution.v2'):return False
        if not isinstance(execution.get('tracks'),list) or not 1<=len(execution['tracks'])<=12:return False
        saved={t['trackId']:t for t in execution['tracks']}
        sources=pack['sourceFingerprints']
        if len(saved)!=len(execution['tracks']) or len(sources)!=len(saved) or {s['id'] for s in sources}!=set(saved):return False
        if execution['schema']=='harbeat.activity-execution.v2':
            if type(execution.get('energy')) is not int or not 1<=execution['energy']<=5:return False
            validate_candidate_edges(execution.get('edges'),sources,execution.get('coverage'))
        return set(saved)==set(pack['trackIds']) and all(read_execution_track(settings,s)==saved[s['id']] for s in sources)
    except (KeyError,TypeError,ValueError,OSError):return False


def request_execution_tracks(settings, ids):
    """Only public catalog IDs cross the CPU publisher queue, never shell text."""
    path=settings.execution_requests
    if path is None:return False
    if any(not isinstance(t,str) or not IDENTIFIER.fullmatch(t) for t in ids):raise PreparationError('invalid_execution_request')
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        data=json.loads(path.read_text()) if path.exists() else {}
        previous=data.get('trackIds',[])
        if not isinstance(previous,list) or any(not isinstance(t,str) or not IDENTIFIER.fullmatch(t) for t in previous):raise PreparationError('invalid_execution_queue')
        merged=list(dict.fromkeys([*previous,*ids]))
        if len(merged)>5000:raise PreparationError('execution_queue_limit')
        temp=path.with_name(path.name+'.part-'+str(os.getpid()))
        temp.write_text(json.dumps({'trackIds':merged,'updatedAt':int(time.time())},separators=(',',':')))
        os.chmod(temp,0o644);os.replace(temp,path)
    return True
