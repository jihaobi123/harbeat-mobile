"""Bounded planner + existing metric gateway, checkpointed after every job."""
from __future__ import annotations

import errno
import fcntl
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from functools import lru_cache

import requests

HASH = re.compile(r'^[a-f0-9]{64}$')
IDENTIFIER = re.compile(r'^[A-Za-z0-9_-]{1,160}$')
PACK_ID = re.compile(r'^[a-f0-9]{32}$')
METHODS = {'original','bass','filter','yield','vocal','bass_filter'}
GATEWAY = 'http://127.0.0.1:8791'
ORIGIN = 'https://8.136.120.255'


class PreparationError(ValueError):
    pass


def file_identity(path):
    stat=path.stat()
    return (stat.st_dev,stat.st_ino,stat.st_size,stat.st_mtime_ns,stat.st_ctime_ns)


@lru_cache(maxsize=2048)
def _file_digest(path,identity):
    result=hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda:source.read(1024*1024),b''): result.update(chunk)
    return result.hexdigest()


def digest(path):
    # inode/size/mtime/ctime changes invalidate cache, including hardlink writes.
    return _file_digest(path,file_identity(path))


def finite(value):
    return type(value) in (int,float) and math.isfinite(value)


def confined(root, relative):
    root=root.resolve()
    path=root/relative
    resolved=path.resolve()
    if root not in resolved.parents or path.is_symlink() or path != resolved:
        raise PreparationError('untrusted_media_path')
    return resolved


def media_valid(path, asset):
    try:
        return path.is_file() and not path.is_symlink() and path.stat().st_size==asset['bytes'] and digest(path)==asset['sha256']
    except (KeyError,ValueError,OSError):
        return False


def validate_result(result):
    if not isinstance(result,dict) or result.get('schema')!='harbeat.metric-mix-result.v1' or result.get('status')!='ready' or not HASH.fullmatch(str(result.get('id',''))) or not HASH.fullmatch(str(result.get('codeVersion',''))) or result.get('policyVersion')!='metric-mix-v1.0':
        raise PreparationError('invalid_metric_result')
    p=result.get('plan',{})
    if not all(finite(p.get(k)) for k in ('start','end','duration','rate','bStart','bEnd','beatErrorMs')) or not 1<=p['duration']<=32 or p['start']<0 or abs(p['end']-p['start']-p['duration'])>.01 or not .95<=p['rate']<=1.05 or p['bStart']<0 or abs(p['bEnd']-p['bStart']-p['duration']*p['rate'])>.05 or not 0<=p['beatErrorMs']<=65:
        raise PreparationError('invalid_metric_plan')
    if any(not IDENTIFIER.fullmatch(str(p.get(k,''))) for k in ('from','to','windowId')) or p['from']==p['to']:
        raise PreparationError('invalid_metric_plan')
    recommended=result.get('decision',{}).get('recommended')
    assets=result.get('assets',{})
    if recommended not in METHODS or result.get('decision',{}).get('methods',{}).get(recommended,{}).get('eligible') is not True or not isinstance(assets,dict) or not {'original',recommended}.issubset(assets) or not isinstance(result.get('sourceProof'),dict):
        raise PreparationError('invalid_metric_decision')
    for method, asset in assets.items():
        if method not in METHODS or not isinstance(asset,dict) or not HASH.fullmatch(str(asset.get('sha256',''))) or type(asset.get('bytes')) is not int or not 0<asset['bytes']<=64*1024*1024 or not finite(asset.get('duration')) or abs(asset['duration']-p['duration'])>.04:
            raise PreparationError('invalid_metric_asset')
    return recommended


def pin_result(settings, pack_id, result):
    if not PACK_ID.fullmatch(pack_id): raise PreparationError('invalid_pack_id')
    recommended=validate_result(result)
    job=result['id']
    for method,asset in result['assets'].items():
        if asset.get('url')!=f'/listen/smart-media/{job}/{method}.wav': raise PreparationError('untrusted_media_path')
    pinned=json.loads(json.dumps(result))
    pinned['assets']={}
    root=settings.root/'media'
    root.mkdir(exist_ok=True,mode=0o755)
    os.chmod(root,0o755)
    for method in {'original',recommended}:
        asset=result['assets'][method]
        source=confined(settings.gateway_media,f'{job}/{method}.wav')
        if not media_valid(source,asset): raise PreparationError('metric_media_invalid')
        target=confined(root,f'{pack_id}/{job}/{method}.wav')
        for folder in (root/pack_id,root/pack_id/job):
            folder.mkdir(exist_ok=True,mode=0o755)
            os.chmod(folder,0o755)
        if not media_valid(target,asset):
            # Unique temporary names avoid concurrent writer collisions. A verified
            # hardlink survives gateway cleanup; cross-filesystem fallback copies.
            fd,temp=tempfile.mkstemp(prefix='.pin-',dir=target.parent)
            os.close(fd)
            temporary=Path(temp)
            try:
                temporary.unlink()
                copied=False
                try:
                    if not source.stat().st_mode & 0o004:raise OSError(errno.EXDEV,'Copy nonpublic source mode')
                    os.link(source,temporary,follow_symlinks=False)
                except OSError as error:
                    if error.errno!=errno.EXDEV: raise
                    copied=True
                    with source.open('rb') as src,temporary.open('xb') as dst:
                        shutil.copyfileobj(src,dst,1024*1024)
                        dst.flush();os.fsync(dst.fileno())
                if not media_valid(temporary,asset): raise PreparationError('pinned_media_invalid')
                if copied:os.chmod(temporary,0o644)
                os.replace(temporary,target)
                descriptor=os.open(target.parent,os.O_RDONLY)
                try:os.fsync(descriptor)
                finally:os.close(descriptor)
            finally:
                temporary.unlink(missing_ok=True)
        pinned['assets'][method]={**asset,'url':f'/listen/set-media/{pack_id}/{job}/{method}.wav'}
    return pinned


def valid_pinned_result(settings,pack_id,result):
    try:
        recommended=validate_result(result)
        if set(result['assets'])!={'original',recommended}: return False
        for method,asset in result['assets'].items():
            if asset['url']!=f"/listen/set-media/{pack_id}/{result['id']}/{method}.wav": return False
            path=confined(settings.root/'media',f"{pack_id}/{result['id']}/{method}.wav")
            if not media_valid(path,asset): return False
        return True
    except (ValueError,KeyError,TypeError,OSError): return False


def compact_track(track):
    out={**track}
    if isinstance(track.get('preprocessing'),dict):
        # The unchanged planner's requireBoundVocals reads only these fields.
        # Full source detail bytes are still hashed and retained as audit identity.
        out['preprocessing']={key:track['preprocessing'][key] for key in ('schema','reportId','reportSha256','masterSha256','bindingChecks','vocalActivity') if key in track['preprocessing']}
    return out


def read_library(settings, styles):
    release=settings.site.resolve()
    index=json.loads((release/'library.json').read_text())
    rows=index.get('tracks')
    if index.get('schema')!='harbeat.continuous-library.v1' or not isinstance(rows,list) or len(rows)>5000: raise PreparationError('invalid_library')
    ids=[r.get('id') for r in rows]
    if len(ids)!=len(set(ids)): raise PreparationError('invalid_library')
    def style_key(value):return re.sub(r'[\s_-]','',value.lower())
    def matches(labels,style):
        key=style_key(style)
        return any(style_key(label)==key or key=='hiphop' and style_key(label) in {'hiphop','boombap','trap','jazzhiphop','grime'} for label in labels)
    eligible=[r for r in rows if r.get('playStatus')=='ready' and r.get('mixStatus')=='ready' and any(matches(r.get('styleLabels',[]),style) for style in styles)]
    # Stable bounded style pool; CLI chooses the connected subset without changing
    # upstream music thresholds. Nonmatching rows are never passed as substitutes.
    eligible=sorted(eligible,key=lambda r:r['id'])[:64]
    tracks=[];sources=[]
    for row in eligible:
        tid=row['id'];detail=row.get('detailUrl','')
        if not IDENTIFIER.fullmatch(str(tid)) or not isinstance(detail,str) or not re.fullmatch(r'(?:catalog/[A-Za-z0-9_-]{1,160}/)?details/'+re.escape(tid)+r'\.json',detail): raise PreparationError('untrusted_library_detail')
        file=confined(release,detail)
        if not file.is_file() or file.stat().st_size>32*1024*1024: raise PreparationError('invalid_library_detail')
        data=file.read_bytes();track=json.loads(data).get('track')
        if not isinstance(track,dict) or track.get('id')!=tid or not finite(track.get('duration')) or abs(track['duration']-row['duration'])>.05 or not isinstance(track.get('native'),dict) or not isinstance(track.get('windows'),list) or not isinstance(track.get('bars'),list): raise PreparationError('invalid_library_detail')
        tracks.append({**compact_track(track),'styleLabels':row.get('styleLabels',[])})
        sources.append({'id':tid,'duration':track['duration'],'detailUrl':detail,'detailSha256':hashlib.sha256(data).hexdigest(),'reportId':track.get('reportId'),'provenance':track.get('provenance',{}),'native':track['native'],'audioSegments':track.get('audioSegments',[])})
    return tracks,sources,len(eligible)==64


def asset_identity(asset):
    return {key:asset.get(key) for key in ('sha256','bytes','duration','rate')}


def segment_identity(segments):
    return [{'start':s.get('start'),'end':s.get('end'),'asset':asset_identity(s.get('asset',{}))} for s in segments]


def stable_source_identity(track):
    return {'id':track['id'],'duration':track['duration'],'reportId':track.get('reportId'),
        'provenance':{key:track.get('provenance',{}).get(key) for key in ('masterSha256','reportSha256','vocalSha256','runId')},
        'native':asset_identity(track['native']),'audioSegments':segment_identity(track.get('audioSegments',[]))}


@lru_cache(maxsize=128)
def _current_source_identity(path,identity):
    if identity[2]>32*1024*1024:raise PreparationError('invalid_library_detail')
    return stable_source_identity(json.loads(path.read_bytes())['track'])


@lru_cache(maxsize=8)
def _current_index(path,identity):
    if identity[2]>8*1024*1024:raise PreparationError('invalid_library')
    index=json.loads(path.read_bytes())
    if index.get('schema')!='harbeat.continuous-library.v1' or not isinstance(index.get('tracks'),list):raise PreparationError('invalid_library')
    rows={r['id']:r for r in index['tracks']}
    if len(rows)!=len(index['tracks']):raise PreparationError('invalid_library')
    return rows


def current_sources_match(settings, sources):
    try:
        release=settings.site.resolve()
        index_path=release/'library.json'
        rows=_current_index(index_path,file_identity(index_path))
        for source in sources:
            # Resolve current ID through the current index. A retained older detail
            # file in a new release must not conceal a report/source replacement.
            row=rows.get(source['id'],{})
            detail=row.get('detailUrl','')
            if row.get('playStatus')!='ready' or row.get('mixStatus')!='ready' or not isinstance(detail,str) or not re.fullmatch(r'(?:catalog/[A-Za-z0-9_-]{1,160}/)?details/'+re.escape(source['id'])+r'\.json',detail):return False
            path=confined(release,detail)
            if _current_source_identity(path,file_identity(path))!=stable_source_identity(source):return False
        return True
    except (OSError,ValueError,KeyError,TypeError):return False


def source_proof_matches(result,sources):
    by_id={s['id']:s for s in sources}
    for side,tid in [('a',result['plan']['from']),('b',result['plan']['to'])]:
        source=by_id.get(tid)
        if source is None: return False
        provenance=source['provenance'];proof=result['sourceProof'].get(side,{})
        # The existing gateway reports independently verified NAS source identities.
        if proof.get('trackId')!=tid or proof.get('runId')!=provenance.get('runId') or proof.get('reportSha256')!=provenance.get('reportSha256'): return False
        for key,field in [('master','masterSha256'),('vocals','vocalSha256')]:
            expected=provenance.get(field)
            if not HASH.fullmatch(str(expected or '')) or proof.get('assets',{}).get(key,{}).get('sha256')!=expected:return False
    return True


class Worker:
    def __init__(self,settings,store,*,planner=None,submit=None,poll=None):
        self.settings=settings;self.store=store;self.stop=threading.Event()
        self.planner=planner or self.invoke_planner
        self.submit=submit or self.submit_job
        self.poll=poll or self.poll_job
        self.session=requests.Session()
        self.session.trust_env=False

    def invoke_planner(self,data):
        result=subprocess.run([self.settings.node,str(self.settings.planner)],input=json.dumps(data,separators=(',',':')),capture_output=True,text=True,timeout=120,check=True)
        if len(result.stdout)>1024*1024: raise PreparationError('planner_output_too_large')
        return json.loads(result.stdout)

    def submit_job(self,edge):
        response=self.session.post(GATEWAY+'/jobs',json={k:edge[k] for k in ('from','to','windowId','start')},headers={'Origin':ORIGIN},timeout=(5,35),allow_redirects=False)
        # A busy external queue does not consume a render task attempt. Retry is
        # bounded and uses the same deterministic gateway request identity.
        for _ in range(12):
            if response.status_code!=429 or self.stop.wait(5):break
            response=self.session.post(GATEWAY+'/jobs',json={k:edge[k] for k in ('from','to','windowId','start')},headers={'Origin':ORIGIN},timeout=(5,35),allow_redirects=False)
        response.raise_for_status()
        return response.json()

    def poll_job(self,job):
        response=self.session.get(GATEWAY+'/jobs/'+job,timeout=(5,35),allow_redirects=False)
        response.raise_for_status()
        return response.json()

    def plan_pack(self,pack):
        tracks,sources,truncated=read_library(self.settings,pack['request']['styles'])
        plan=self.planner({'tracks':tracks,'styles':pack['request']['styles'],'energy':pack['request']['energy'],'maxTracks':pack['request']['trackLimit']})
        selected=plan.get('trackIds');initial=plan.get('initialTrackId');edges=plan.get('edges');summaries=plan.get('tracks')
        source_ids={s['id'] for s in sources}
        if not isinstance(selected,list) or not selected or len(selected)>pack['request']['trackLimit'] or any(not isinstance(t,str) for t in selected) or len(set(selected))!=len(selected) or not set(selected)<=source_ids or initial not in selected or not isinstance(edges,list) or len(edges)>24 or not isinstance(summaries,list) or {t.get('id') for t in summaries}!=set(selected): raise PreparationError('invalid_planner_output')
        signatures=set();outgoing={}
        for edge in edges:
            if not isinstance(edge,dict) or edge.get('from') not in selected or edge.get('to') not in selected or edge['from']==edge['to'] or not IDENTIFIER.fullmatch(str(edge.get('windowId',''))) or not finite(edge.get('start')) or not 0<=edge['start']<=86400: raise PreparationError('invalid_planner_edge')
            signature=(edge['from'],edge['to'],edge['windowId'],edge['start'])
            if signature in signatures: raise PreparationError('duplicate_planner_edge')
            signatures.add(signature);outgoing[edge['from']]=outgoing.get(edge['from'],0)+1
            if outgoing[edge['from']]>2:raise PreparationError('planner_edge_limit')
        warnings=plan.get('warnings',[])
        if not isinstance(warnings,list) or any(not isinstance(w,str) or len(w)>300 for w in warnings) or len(warnings)>24:raise PreparationError('invalid_planner_warnings')
        if len(selected)<pack['request']['trackLimit']:warnings.append('insufficient_candidates')
        if any(t not in outgoing for t in selected):warnings.append('tracks_without_exit')
        if truncated:warnings.append('candidate_pool_bounded')
        pack.update(trackIds=selected,initialTrackId=initial,tracks=summaries,sourceFingerprints=[s for s in sources if s['id'] in selected],warnings=warnings,total=len(edges),tasks=[{'edge':e,'state':'pending'} for e in edges],planned=True)
        self.store.save_pack(pack)

    def run_once(self):
        pack=self.store.next_pack()
        if pack is None:return False
        pack.update(state='preparing',error=None)
        self.store.save_pack(pack)
        try:
            if not pack.get('planned'):self.plan_pack(pack)
            if not current_sources_match(self.settings,pack['sourceFingerprints']):raise PreparationError('source_revision_changed')
            if self.settings.execution_root is not None:
                from .execution import read_execution_track,request_execution_tracks
                try:
                    execution_tracks=[read_execution_track(self.settings,s) for s in pack['sourceFingerprints']]
                except PreparationError as error:
                    if str(error)=='execution_assets_pending' and request_execution_tracks(self.settings,pack['trackIds']):
                        pack.update(state='preparing',error=None,prepared=0,failed=0,executionRetryAt=time.time()+30)
                        pack['warnings']=list(dict.fromkeys([*pack['warnings'],'preparing_source_assets']))
                        self.store.save_pack(pack)
                        self.stop.wait(2)
                        return True
                    raise
                if not current_sources_match(self.settings,pack['sourceFingerprints']):raise PreparationError('source_revision_changed')
                if not pack['tasks']:raise PreparationError('no_qualified_edges')
                pack['execution']={'schema':'harbeat.activity-execution.v1','tracks':execution_tracks,'edges':[t['edge'] for t in pack['tasks']]}
                for task in pack['tasks']:task.update(state='ready')
                pack.update(state='ready',prepared=len(pack['tasks']),failed=0,error=None)
                pack.pop('executionRetryAt',None)
                pack['warnings']=[w for w in pack['warnings'] if w!='preparing_source_assets']
                self.store.save_pack(pack)
                return True
            if not pack['tasks']:
                pack.update(state='partial',error='no_qualified_edges')
                self.store.save_pack(pack)
                return True
            for task in pack['tasks']:
                if self.stop.is_set():return True
                if task['state'] in ('ready','failed'):continue
                try:
                    if not current_sources_match(self.settings,pack['sourceFingerprints']):raise PreparationError('source_revision_changed')
                    if not task.get('jobId'):
                        job=self.submit(task['edge'])
                        if not HASH.fullmatch(str(job.get('id',''))):raise PreparationError('invalid_job_identity')
                        task.update(jobId=job['id'],state='running')
                        self.store.save_pack(pack)
                    # Resume a persisted job instead of resubmitting when restarted.
                    deadline=time.monotonic()+480
                    while True:
                        if self.stop.is_set():return True
                        result=self.poll(task['jobId'])
                        if result.get('status')=='failed':raise PreparationError('metric_job_failed')
                        if result.get('status')=='ready':break
                        if result.get('status') not in ('queued','running'):raise PreparationError('invalid_job_state')
                        if time.monotonic()>deadline:raise PreparationError('metric_job_timeout')
                        if self.stop.wait(2):return True
                    if result.get('id')!=task['jobId']:raise PreparationError('invalid_job_identity')
                    validate_result(result)
                    edge=task['edge'];p=result['plan']
                    if any(p[k]!=edge[k] for k in ('from','to','windowId')) or abs(p['start']-edge['start'])>.002:raise PreparationError('metric_plan_mismatch')
                    if any(k in edge and (not finite(edge[k]) or abs(p[k]-edge[k])>.002) for k in ('end','duration','rate','bStart','bEnd')):raise PreparationError('metric_plan_mismatch')
                    selected_sources={s['id']:s for s in pack['sourceFingerprints']}
                    if p['end']>selected_sources[p['from']]['duration']+.05 or p['bEnd']>selected_sources[p['to']]['duration']-12:raise PreparationError('metric_plan_mismatch')
                    if not source_proof_matches(result,pack['sourceFingerprints']) or not current_sources_match(self.settings,pack['sourceFingerprints']):raise PreparationError('source_revision_changed')
                    task.update(result=pin_result(self.settings,pack['packId'],result),state='ready')
                except Exception as error:
                    code=str(error) if isinstance(error,PreparationError) else 'preparation_unavailable'
                    task.update(state='failed',error=code)
                pack['prepared']=sum(t['state']=='ready' for t in pack['tasks'])
                pack['failed']=sum(t['state']=='failed' for t in pack['tasks'])
                self.store.save_pack(pack)
            pack['state']='ready' if pack['prepared']==pack['total'] else ('partial' if pack['prepared'] else 'failed')
            if pack['failed']:
                pack['warnings']=list(dict.fromkeys([*pack['warnings'],'some_edges_failed']))
                pack['error']=next((t['error'] for t in pack['tasks'] if t.get('error')),None)
        except Exception as error:
            pack.update(state='failed',error=str(error) if isinstance(error,PreparationError) else 'preparation_unavailable')
        self.store.save_pack(pack)
        return True

    def run_forever(self):
        # Lifetime process lock avoids duplicate worker instances across accidental
        # uvicorn processes; release on crash makes checkpoints recoverable.
        lockfile=(self.settings.root/'worker.lock').open('a')
        try:
            try:fcntl.flock(lockfile,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:return
            while not self.stop.is_set():
                try:found=self.run_once()
                except Exception:found=False
                if not found:self.stop.wait(2)
        finally:
            lockfile.close();self.session.close()
