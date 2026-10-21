"""Private user music bridge. Only the existing import worker consumes audio jobs."""
from __future__ import annotations
import hashlib
import json
import os
import re
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Literal
import requests
from fastapi import Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, ConfigDict, Field

STYLES=['EDM','KPOP','Hip-Hop','afro','amapiano','baile funk','boombap','breakbeat','dancehall','disco','funk','grime','house','jazz hiphop','jersey club','trap']
ACTIVE=('queued','submitting','downloading','transferring','analyzing','publishing')
TERMINAL=('ready','ready_playback','failed')
PUBLIC_ORIGIN='https://8.136.120.255'

class Match(BaseModel):
    model_config=ConfigDict(extra='forbid')
    discoveryId:str=Field(pattern=r'^[a-f0-9]{32}$')
class Download(BaseModel):
    model_config=ConfigDict(extra='forbid')
    candidateId:str=Field(pattern=r'^[a-f0-9]{32}$')
    style:str=Field(default='',max_length=80)
class Playlist(BaseModel):
    model_config=ConfigDict(extra='forbid')
    url:str=Field(min_length=1,max_length=4000)

def checked_style(style):
    if style not in ['',*STYLES]:raise HTTPException(422,'请选择现有风格，或留空自动分析。')
    return style

def safe_candidate(value):
    if not isinstance(value,dict) or value.get('source') not in ('netease','kuwo','fangpi') or not re.fullmatch(r'\d{1,24}',str(value.get('id',''))):raise HTTPException(502,'音源编号无效，请重新匹配。')
    title=value.get('title');duration=value.get('duration')
    if not isinstance(title,str) or not 0<len(title)<=300 or (duration is not None and (isinstance(duration,bool) or not isinstance(duration,(float,int)) or not 0<=duration<=1200)):raise HTTPException(502,'音源资料不完整。')
    result={k:value.get(k) for k in ('source','id','title','artist','duration')}
    if value.get('expected_duration') is not None:
        expected=value['expected_duration']
        if not isinstance(expected,(int,float)) or not 20<=expected<=1200:raise HTTPException(502,'歌曲时长无效。')
        result['expected_duration']=expected
    return result

class MusicBridge:
    def __init__(self,store,queue=None,upstream=None):
        self.store=store;self.settings=store.settings;self._queue=queue;self.upstream=upstream or self.request
        self.http=requests.Session();self.http.trust_env=False
        self.stop=threading.Event();self.lock=threading.RLock();self.import_root=Path(os.environ.get('LISTEN_IMPORT_ROOT','/srv/harbeat-listen/imports'))
        with store.connection() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS music_candidates(id TEXT PRIMARY KEY,workspace TEXT NOT NULL,kind TEXT NOT NULL,data TEXT NOT NULL,created REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS music_candidate_owner ON music_candidates(workspace,created);
            CREATE TABLE IF NOT EXISTS music_jobs(id TEXT PRIMARY KEY,workspace TEXT NOT NULL,dedup TEXT NOT NULL,payload TEXT NOT NULL,data TEXT NOT NULL,global_id TEXT,created REAL NOT NULL,UNIQUE(workspace,dedup));
            CREATE TABLE IF NOT EXISTS music_actions(workspace TEXT NOT NULL,created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS music_rates(workspace TEXT NOT NULL,created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS music_covers(track_id TEXT PRIMARY KEY,master_sha TEXT NOT NULL,input_sha TEXT NOT NULL,cover_sha TEXT NOT NULL);
            ''')
    @property
    def queue(self):
        if self._queue is None:
            from listen_imports.store import Jobs
            self._queue=Jobs(self.import_root)
        return self._queue
    def request(self,kind,body):
        headers={'Origin':PUBLIC_ORIGIN,'X-Harbeat-Import':'1'}
        try:
            if kind in ('library','discover'):
                endpoint='listen-search' if kind=='library' else 'listen-discover'
                response=self.http.get('http://127.0.0.1:8773/api/'+endpoint,params=body,headers=headers,timeout=28)
            else:
                endpoint={'matches':'discovery-match','title_matches':'search','playlist':'playlist'}[kind]
                response=self.http.post('http://127.0.0.1:8771/api/listen-import/'+endpoint,json=body,headers=headers,timeout=38)
            if response.status_code>=400:
                detail=response.json().get('detail','音乐服务暂时不可用。')
                raise HTTPException(response.status_code if response.status_code in (422,429,503,507) else 502,detail)
            if len(response.content)>2*1024**2:raise ValueError('oversized response')
            return response.json()
        except HTTPException:raise
        except (requests.RequestException,ValueError,KeyError):raise HTTPException(502,'音乐搜索暂未返回结果，请稍后重试。')
    def rate(self,workspace):
        now=time.time()
        with self.store.connection() as db:
            db.execute('BEGIN IMMEDIATE');db.execute('DELETE FROM music_rates WHERE created<?',(now-60,))
            if db.execute('SELECT count(*) FROM music_rates WHERE workspace=?',(workspace,)).fetchone()[0]>=20 or db.execute('SELECT count(*) FROM music_rates').fetchone()[0]>=120:raise HTTPException(429,'搜索请求较多，请稍后重试。')
            db.execute('INSERT INTO music_rates VALUES (?,?)',(workspace,now))
    def candidate(self,workspace,kind,data):
        ident=uuid.uuid4().hex;now=time.time()
        with self.store.connection() as db:
            db.execute('DELETE FROM music_candidates WHERE created<?',(now-86400,))
            db.execute('INSERT INTO music_candidates VALUES (?,?,?,?,?)',(ident,workspace,kind,json.dumps(data),now))
            db.execute('DELETE FROM music_candidates WHERE workspace=? AND id NOT IN (SELECT id FROM music_candidates WHERE workspace=? ORDER BY created DESC LIMIT 250)',(workspace,workspace))
        return ident
    def resolve(self,workspace,identifier,kind):
        with self.store.connection() as db:row=db.execute('SELECT * FROM music_candidates WHERE id=? AND workspace=? AND kind=?',(identifier,workspace,kind)).fetchone()
        if not row:raise HTTPException(404,'找不到这条搜索结果。')
        if row['created']<time.time()-86400:raise HTTPException(410,'搜索结果已过期，请重新搜索。')
        return json.loads(row['data'])
    def discovery_rows(self,workspace,rows):
        output=[]
        for row in rows[:24]:
            if row.get('provider') not in ('netease','qq') or not re.fullmatch(r'[A-Za-z0-9]{1,64}',str(row.get('source_id',''))) or not isinstance(row.get('title'),str):continue
            safe={k:row[k] for k in ('provider','source_id','title','artist','duration','reason') if k in row}
            safe['title']=safe['title'][:300];safe['artist']=str(safe.get('artist',''))[:300]
            safe['discoveryId']=self.candidate(workspace,'discovery',safe)
            output.append(safe)
        return output
    def search(self,workspace,scope,q,provider):
        self.rate(workspace)
        result=self.upstream(scope,dict(q=q,**({'provider':provider} if scope=='discover' else {})))
        if scope=='discover':result={**result,'results':self.discovery_rows(workspace,result.get('results',[]))}
        else:
            try:
                catalog=json.loads((self.settings.site/'library.json').read_text())
                current={row['id']:row for row in catalog['tracks'] if row.get('playStatus')=='ready'}
                covers=self.covers()['covers']
                hits=[]
                for hit in result.get('results',[])[:100]:
                    if not isinstance(hit,dict) or hit.get('id') not in current:continue
                    row=current[hit['id']]
                    item={**row,**{k:hit[k] for k in ('score','match') if k in hit}}
                    if row['id'] in covers:item['coverUrl']=covers[row['id']]['url']
                    hits.append(item)
                result={**result,'results':hits}
            except (OSError,ValueError,KeyError):
                raise HTTPException(503,'曲库正在更新，请稍后再试。')
        return {**result,'scope':scope}
    def matches(self,workspace,identifier):
        self.rate(workspace);discovery=self.resolve(workspace,identifier,'discovery')
        if discovery.get('metadataOnly'):
            result=self.upstream('title_matches',{k:discovery[k] for k in ('title','artist') if k in discovery})
        else:
            result=self.upstream('matches',{k:discovery[k] for k in ('provider','source_id','title','artist','duration') if k in discovery})
        output=[]
        for raw in result.get('candidates',[])[:8]:
            # Resolve through the import service's trusted candidate store, never accept a URL from the client.
            source=self.queue.resolve_candidate(raw.get('candidate_id',''));source=safe_candidate(source)
            identifier=self.candidate(workspace,'download',dict(candidate=source,discovery=discovery))
            output.append({**source,'candidateId':identifier})
        return {'candidates':output,'notes':result.get('notes',[])[:5]}
    def capacity(self):
        if shutil.disk_usage(self.import_root if self.import_root.exists() else self.settings.root).free<5*1024**3:raise HTTPException(507,'服务器音乐空间不足，请稍后重试；现有音乐仍可播放。')
    def record(self,workspace,key,payload,discovery=None,cover=None):
        self.capacity();self.tick()
        with self.store.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT * FROM music_jobs WHERE workspace=? AND dedup=?',(workspace,key)).fetchone()
            if row:return self.public(row)
            self.quota(db,workspace)
            ident=uuid.uuid4().hex;now=time.time();data=dict(id=ident,status='submitting',title=payload['title'],message='正在提交下载分析',trackId=None,created=now,updated=now,discovery=discovery,cover=cover)
            db.execute('INSERT INTO music_jobs VALUES (?,?,?,?,?,?,?)',(ident,workspace,key,json.dumps(payload),json.dumps(data),None,now))
            db.execute('INSERT INTO music_actions VALUES (?,?)',(workspace,now))
        self.tick()
        return self.job(workspace,ident)
    def quota(self,db,workspace):
        rows=db.execute('SELECT data FROM music_jobs WHERE workspace=?',(workspace,)).fetchall()
        if sum(json.loads(r[0])['status'] in ACTIVE for r in rows)>=2:raise HTTPException(429,'已有两首正在处理，请等待完成后再添加。')
        now=time.time();db.execute('DELETE FROM music_actions WHERE created<?',(now-86400,))
        if db.execute('SELECT count(*) FROM music_actions WHERE workspace=?',(workspace,)).fetchone()[0]>=8:raise HTTPException(429,'24 小时内最多添加或重试 8 首音乐，请稍后继续。')
    def download(self,workspace,body):
        value=self.resolve(workspace,body.candidateId,'download');candidate=safe_candidate(value['candidate']);style=checked_style(body.style)
        return self.record(workspace,'provider:'+candidate['source']+':'+str(candidate['id']),dict(kind='download',candidate=candidate,title=candidate['title'],artist=candidate.get('artist') or '',style=style),value.get('discovery'))
    def public(self,row):
        data=json.loads(row['data'])
        if data.get('coverUrl'):
            from .music_covers import verified_cover
            verified=verified_cover(self,data.get('trackId'))
            if not verified or verified['url']!=data['coverUrl']:data.pop('coverUrl',None)
        output={k:v for k,v in data.items() if k not in ('discovery','cover','coverTried','metadataTried')}
        if any(path in output.get('message','') for path in ('/srv/','/mnt/','/home/')):output['message']='音乐处理暂未完成，请重试；现有音乐仍可播放。'
        return output
    def job(self,workspace,identifier):
        with self.store.connection() as db:row=db.execute('SELECT * FROM music_jobs WHERE id=? AND workspace=?',(identifier,workspace)).fetchone()
        if not row:raise HTTPException(404,'找不到这个下载任务。')
        return self.public(row)
    def jobs(self,workspace):
        with self.store.connection() as db:rows=db.execute('SELECT * FROM music_jobs WHERE workspace=? ORDER BY created DESC LIMIT 100',(workspace,)).fetchall()
        return {'jobs':[self.public(r) for r in rows],'styles':STYLES}
    def retry(self,workspace,identifier):
        self.capacity();self.tick()
        with self.lock,self.store.connection() as db:
            db.execute('BEGIN IMMEDIATE');row=db.execute('SELECT * FROM music_jobs WHERE id=? AND workspace=?',(identifier,workspace)).fetchone()
            if not row:raise HTTPException(404,'找不到这个下载任务。')
            data=json.loads(row['data'])
            if data['status']!='failed':raise HTTPException(422,'只有失败的任务可以重试。')
            self.quota(db,workspace)
            # Queue retry is idempotent if an acknowledgement is lost: next tick reads its actual state.
            if row['global_id']:
                try:
                    current=self.queue.public(row['global_id'])
                    if current['status']=='failed':self.queue.retry(row['global_id'])
                except ValueError:raise HTTPException(429,'导入队列已满，请稍后重试。')
            data.update(status='queued' if row['global_id'] else 'submitting',message='等待继续处理')
            db.execute('UPDATE music_jobs SET data=? WHERE id=?',(json.dumps(data),identifier));db.execute('INSERT INTO music_actions VALUES (?,?)',(workspace,time.time()))
        return self.job(workspace,identifier)
    def tick(self):
        if not self.lock.acquire(blocking=False):return
        try:
            with self.store.connection() as db:rows=db.execute('SELECT * FROM music_jobs ORDER BY created').fetchall()
            for row in rows:
                data=json.loads(row['data']);global_id=row['global_id']
                try:
                    if not global_id and data['status']=='failed':continue
                    if not global_id:
                        submitted=self.queue.submit(row['dedup'],json.loads(row['payload']));global_id=submitted['id']
                        # Checkpoint immediately; an acknowledgement lost before this point reuses dedup next run.
                        with self.store.connection() as db:db.execute('UPDATE music_jobs SET global_id=? WHERE id=?',(global_id,row['id']))
                    state=self.queue.public(global_id)
                    data.update(status=state['status'],message=state.get('message','')[:350],trackId=state.get('track_id'),updated=state.get('updated',time.time()))
                    with self.store.connection() as db:
                        latest=json.loads(db.execute('SELECT data FROM music_jobs WHERE id=?',(row['id'],)).fetchone()['data'])
                        latest.update({key:data[key] for key in ('status','message','trackId','updated')})
                        db.execute('UPDATE music_jobs SET data=? WHERE id=?',(json.dumps(latest),row['id']))
                except ValueError as error:
                    data.update(status='failed',message=str(error)[:250])
                    with self.store.connection() as db:db.execute('UPDATE music_jobs SET data=? WHERE id=?',(json.dumps(data),row['id']))
                except Exception:
                    # Keep durable outbox pending. Never create a second GPU worker or recover the shared queue.
                    continue
        finally:self.lock.release()
    def run_forever(self):
        while not self.stop.is_set():
            try:self.tick()
            except Exception:pass
            try:self.complete_covers()
            except Exception:pass
            self.stop.wait(3)
    def complete_covers(self):
        from .music_covers import complete_covers
        complete_covers(self)
    def covers(self):
        from .music_covers import verified_covers
        return {'covers':verified_covers(self)}

def install_music(app,store,workspace,queue=None,upstream=None):
    bridge=MusicBridge(store,queue,upstream);app.state.music=bridge
    @app.get('/music/search')
    def search(scope:Literal['library','discover']='library',q:str=Query(min_length=1,max_length=300),provider:Literal['all','netease','qq']='all',ws=Depends(workspace)):
        if not q.strip():raise HTTPException(422,'请输入歌名、艺人或音乐氛围。')
        return bridge.search(ws,scope,q.strip(),provider)
    @app.post('/music/matches')
    def matches(body:Match,ws=Depends(workspace)):return bridge.matches(ws,body.discoveryId)
    @app.post('/music/download')
    def download(body:Download,ws=Depends(workspace)):return bridge.download(ws,body)
    @app.get('/music/jobs')
    def jobs(ws=Depends(workspace)):return bridge.jobs(ws)
    @app.post('/music/jobs/{identifier}/retry')
    def retry(identifier:str,ws=Depends(workspace)):return bridge.retry(ws,identifier)
    @app.get('/music/covers')
    def covers(ws=Depends(workspace)):return bridge.covers()
    @app.post('/music/playlist')
    def playlist(body:Playlist,ws=Depends(workspace)):
        bridge.rate(ws);result=bridge.upstream('playlist',{'url':body.url})
        # Legacy parser returns metadata only. Resolve each track through the same confirmed matching step.
        output=[]
        for row in result.get('tracks',[])[:24]:
            title=row.get('title') or row.get('name') or ''
            if not isinstance(title,str) or not title.strip():continue
            discovery=dict(provider='qq' if result.get('platform')=='qqmusic' else 'netease',title=title[:300],artist=str(row.get('artist') or '')[:300],duration=row.get('duration') or 0,metadataOnly=True)
            identifier=bridge.candidate(ws,'discovery',discovery)
            output.append({**{k:v for k,v in discovery.items() if k!='metadataOnly'},'discoveryId':identifier})
        return {'title':result.get('name') or result.get('title') or '歌单','results':output,'message':'每次展示前 24 首，匹配确认后再下载。'}
    @app.post('/music/upload')
    async def upload(audio:UploadFile=File(...),style:str=Form(''),title:str=Form(''),ws=Depends(workspace)):
        from .music_upload import upload_music
        return await upload_music(bridge,ws,audio,style,title)
    return bridge
