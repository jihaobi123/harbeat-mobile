"""Validate reusable execution assets, independently of pair-rendered WAVs."""
from __future__ import annotations

import json
import fcntl
import os
import time
from .worker import HASH, IDENTIFIER, PreparationError, confined, finite, media_valid

STEMS=('drums','bass','other','vocals')


def read_execution_track(settings, source):
    root=settings.execution_root
    if root is None:raise PreparationError('execution_not_configured')
    path=confined(root,'tracks/'+source['id']+'.json')
    if not path.is_file() or path.stat().st_size>4*1024*1024:
        index=root/'index.json'
        if index.is_file() and index.stat().st_size<=8*1024*1024:
            excluded=json.loads(index.read_bytes()).get('excluded',[])
            if any(x.get('trackId')==source['id'] for x in excluded):raise PreparationError('execution_source_unavailable')
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
        if execution.get('schema')!='harbeat.activity-execution.v1':return False
        saved={t['trackId']:t for t in execution['tracks']}
        sources=pack['sourceFingerprints']
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
