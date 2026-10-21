"""Private workspace reservations; a single persistent worker owns preparation."""
from __future__ import annotations

import contextlib
import hashlib
import ipaddress
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator

ID = re.compile(r'^[a-f0-9]{32}$')


@dataclass(frozen=True)
class Settings:
    root: Path = Path('/srv/harbeat-listen/activity-sets')
    site: Path = Path('/srv/harbeat-listen/current')
    gateway_media: Path = Path('/srv/harbeat-listen/metric-mix/media')
    planner: Path = Path('/srv/harbeat-listen/activity-sets/code/set-plan.cjs')
    node: str = '/usr/bin/node'
    execution_root: Path | None = None
    execution_requests: Path | None = None
    max_active: int = 3
    max_reservations: int = 50

    @classmethod
    def from_env(cls):
        values = {key: Path(os.environ[env]) for key, env in (
            ('root', 'ACTIVITY_SETS_ROOT'), ('site', 'LISTEN_SITE_CURRENT'),
            ('gateway_media', 'ACTIVITY_GATEWAY_MEDIA'), ('planner', 'ACTIVITY_SET_PLANNER'),
            ('execution_root','ACTIVITY_EXECUTION_ROOT'),('execution_requests','ACTIVITY_EXECUTION_REQUESTS')) if env in os.environ}
        if 'ACTIVITY_NODE' in os.environ: values['node'] = os.environ['ACTIVITY_NODE']
        return cls(**values)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


class Schedule(BaseModel):
    model_config = ConfigDict(extra='forbid')
    startsAt: datetime
    durationMinutes: Annotated[StrictInt, Field(ge=15, le=480)]

    @field_validator('startsAt', mode='before')
    @classmethod
    def iso_only(cls, value):
        if not isinstance(value, str): raise ValueError('ISO timestamp with timezone required')
        return value

    @field_validator('startsAt')
    @classmethod
    def valid_schedule(cls, value):
        current = datetime.now(timezone.utc)
        if value.tzinfo is None or value.utcoffset() is None: raise ValueError('Timezone required')
        if not current-timedelta(seconds=60) <= value <= current+timedelta(days=366): raise ValueError('Activity must start within the next year')
        return value.astimezone(timezone.utc)


class CreateReservation(Schedule):
    name: Annotated[str, Field(min_length=1, max_length=100)]
    styles: Annotated[list[str], Field(min_length=1, max_length=8)]
    energy: Annotated[StrictInt, Field(ge=1, le=5)]
    trackLimit: Annotated[StrictInt, Field(ge=4, le=12)] = 8

    @field_validator('name')
    @classmethod
    def clean_name(cls, value):
        value = value.strip()
        if not value or any(ord(c)<32 for c in value): raise ValueError('Name required')
        return value

    @field_validator('styles')
    @classmethod
    def valid_styles(cls, values):
        if any(not s.strip() or len(s)>80 or any(ord(c)<32 for c in s) for s in values): raise ValueError('Style labels invalid')
        return list(dict.fromkeys(s.strip() for s in values))


class ReuseReservation(Schedule):
    name: Annotated[Optional[str], Field(min_length=1, max_length=100)] = None

    @field_validator('name')
    @classmethod
    def clean_name(cls, value):
        return CreateReservation.clean_name(value) if value is not None else None


class Store:
    def __init__(self, settings: Settings):
        self.settings = settings
        settings.root.mkdir(parents=True, exist_ok=True, mode=0o755)
        os.chmod(settings.root,0o755)
        self.path = settings.root/'activity-sets.sqlite3'
        with self.connection() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, credential_hash TEXT UNIQUE NOT NULL, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS workspace_requests (ip_hash TEXT NOT NULL, created REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS workspace_requests_created ON workspace_requests(created);
                CREATE TABLE IF NOT EXISTS packs (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL, priority TEXT NOT NULL, created TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, pack_id TEXT NOT NULL, data TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS reservations_workspace ON reservations(workspace);
                CREATE INDEX IF NOT EXISTS packs_queue ON packs(state,priority);
            ''')
        os.chmod(self.path, 0o600)

    @contextlib.contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            db.execute('PRAGMA busy_timeout=30000')
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def new_workspace(self, ip: str):
        stamp = time.time()
        ip_hash = hashlib.sha256(ip.encode()).hexdigest()
        token = secrets.token_urlsafe(32)
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM workspace_requests WHERE created < ?', (stamp-3600,))
            local = db.execute('SELECT count(*) FROM workspace_requests WHERE ip_hash=? AND created>?', (ip_hash, stamp-60)).fetchone()[0]
            total = db.execute('SELECT count(*) FROM workspace_requests').fetchone()[0]
            if local >= 5 or total >= 60: raise HTTPException(429, 'Workspace creation limit reached; try later')
            db.execute('INSERT INTO workspace_requests VALUES (?,?)', (ip_hash, stamp))
            db.execute('INSERT INTO workspaces VALUES (?,?,?)', (uuid.uuid4().hex, hashlib.sha256(token.encode()).hexdigest(), stamp))
        return token

    def authenticate(self, token: str):
        if not re.fullmatch(r'[A-Za-z0-9_-]{43}', token): return None
        with self.connection() as db:
            row = db.execute('SELECT id FROM workspaces WHERE credential_hash=?', (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
        return row['id'] if row else None

    def pack(self, pack_id: str, workspace: str | None = None):
        with self.connection() as db:
            row = db.execute('SELECT * FROM packs WHERE id=?'+(' AND workspace=?' if workspace else ''), (pack_id, workspace) if workspace else (pack_id,)).fetchone()
        if row is None: raise HTTPException(404, 'Set not found')
        return json.loads(row['data'])

    def save_pack(self, pack):
        with self.connection() as db:
            db.execute('UPDATE packs SET state=?,data=? WHERE id=?', (pack['state'], json.dumps(pack, separators=(',',':')), pack['packId']))

    def reservation(self, workspace, reservation_id):
        with self.connection() as db:
            row = db.execute('SELECT data FROM reservations WHERE id=? AND workspace=?', (reservation_id, workspace)).fetchone()
        if row is None: raise HTTPException(404, 'Reservation not found')
        return json.loads(row['data'])

    def list_reservations(self, workspace):
        with self.connection() as db:
            rows = db.execute('SELECT data FROM reservations WHERE workspace=?', (workspace,)).fetchall()
        return sorted((json.loads(row['data']) for row in rows), key=lambda r:r['startsAt'])

    def create_reservation(self, workspace, body: CreateReservation | ReuseReservation, original=None):
        reservation_id, pack_id, created = uuid.uuid4().hex, original['packId'] if original else uuid.uuid4().hex, now_iso()
        data = dict(original or {})
        data.update(id=reservation_id, packId=pack_id, createdAt=created, startsAt=body.startsAt.isoformat(), endsAt=(body.startsAt+timedelta(minutes=body.durationMinutes)).isoformat(), durationMinutes=body.durationMinutes)
        if original:
            if body.name is not None: data['name'] = body.name
        else:
            data.update(name=body.name, styles=body.styles, energy=body.energy, trackLimit=body.trackLimit)
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            count = db.execute('SELECT count(*) FROM reservations WHERE workspace=?',(workspace,)).fetchone()[0]
            if count >= self.settings.max_reservations: raise HTTPException(429, 'Reservation limit reached')
            if not original:
                active = db.execute("SELECT count(*) FROM packs WHERE workspace=? AND state IN ('queued','preparing')",(workspace,)).fetchone()[0]
                global_active = db.execute("SELECT count(*) FROM packs WHERE state IN ('queued','preparing')").fetchone()[0]
                if active >= self.settings.max_active or global_active >= 20: raise HTTPException(429, 'Preparation queue full; wait for an existing set')
                pack = dict(schema='harbeat.activity-set.v1',packId=pack_id,state='queued',createdAt=created,prepared=0,total=0,failed=0,trackIds=[],initialTrackId=None,tracks=[],sourceFingerprints=[],warnings=[],error=None,tasks=[],request={k:data[k] for k in ('styles','energy','trackLimit')})
                db.execute('INSERT INTO packs VALUES (?,?,?,?,?,?)',(pack_id,workspace,'queued',json.dumps(pack,separators=(',',':')),data['startsAt'],created))
            else:
                db.execute('UPDATE packs SET priority=min(priority,?) WHERE id=? AND workspace=?',(data['startsAt'],pack_id,workspace))
            db.execute('INSERT INTO reservations VALUES (?,?,?,?)',(reservation_id,workspace,pack_id,json.dumps(data,separators=(',',':'))))
        return data

    def next_pack(self):
        with self.connection() as db:
            rows=db.execute("SELECT data FROM packs WHERE state IN ('queued','preparing') ORDER BY priority,created LIMIT 20").fetchall()
        for row in rows:
            pack=json.loads(row['data'])
            if pack.get('executionRetryAt',0)<=time.time():return pack
        return None

    def public_manifest(self, workspace, pack_id):
        from .worker import valid_pinned_result, current_sources_match
        pack=self.pack(pack_id,workspace)
        results=[]
        corrupted=False
        if pack.get('execution'):
            from .execution import validate_execution_pack
            output={k:v for k,v in pack.items() if k not in ('tasks','request')}
            output['results']=[]
            if not validate_execution_pack(self.settings,pack):
                output.update(state='partial',prepared=0,failed=pack['total'])
                output['warnings']=list(dict.fromkeys([*output['warnings'],'execution_assets_invalid']))
            if not current_sources_match(self.settings,pack['sourceFingerprints']):
                output['state']='stale'
                output['warnings']=list(dict.fromkeys([*output['warnings'],'source_revision_changed']))
            return output
        for task in pack['tasks']:
            if task.get('state')=='ready':
                if valid_pinned_result(self.settings,pack_id,task['result']): results.append(task['result'])
                else: corrupted=True
        output={k:v for k,v in pack.items() if k not in ('tasks','request')}
        output['results']=results
        if corrupted:
            output.update(state='partial',prepared=len(results),failed=len(pack['tasks'])-len(results))
            output['warnings']=list(dict.fromkeys([*output['warnings'],'pinned_media_invalid']))
        if pack.get('planned') and not current_sources_match(self.settings,pack['sourceFingerprints']):
            output['state']='stale'
            output['warnings']=list(dict.fromkeys([*output['warnings'],'source_revision_changed']))
        return output

    def view(self, workspace, reservation):
        manifest=self.public_manifest(workspace,reservation['packId'])
        progress={k:manifest[k] for k in ('state','prepared','total','failed','warnings','error','trackIds','initialTrackId')}
        return {**reservation,'pack':{'id':reservation['packId'],**progress}}


def create_app(settings: Settings | None = None, *, run_worker=True, music_queue=None, music_upstream=None):
    settings=settings or Settings.from_env()
    store=Store(settings)

    @contextlib.asynccontextmanager
    async def lifespan(app):
        if run_worker:
            from .worker import Worker
            worker=Worker(settings,store)
            thread=threading.Thread(target=worker.run_forever,name='activity-set-worker',daemon=True)
            thread.start()
        if run_worker:
            music_thread=threading.Thread(target=app.state.music.run_forever,name='music-outbox-monitor',daemon=True)
            music_thread.start()
        yield
        if run_worker:
            app.state.music.stop.set()
            music_thread.join(timeout=12)
        if run_worker:
            worker.stop.set()
            thread.join(timeout=40)

    app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None,lifespan=lifespan)
    app.state.store=store

    @app.middleware('http')
    async def bounded_body(request, call_next):
        # Bound all mutable endpoints before Pydantic parses untrusted JSON.
        if request.method=='POST' and request.url.path=='/music/upload':
            # Authenticate before multipart parsing can spool bytes, then bound the ASGI stream.
            auth=request.headers.get('authorization','')
            if not store.authenticate(auth[7:] if auth.startswith('Bearer ') else ''):
                from fastapi.responses import JSONResponse
                return JSONResponse({'detail':'Workspace credential required'},status_code=401)
            limit=100*1024**2+65536
            try: declared=int(request.headers.get('content-length','0'))
            except ValueError: declared=limit+1
            if declared>limit:
                from fastapi.responses import JSONResponse
                return JSONResponse({'detail':'每个音乐文件最大 100 MB。'},status_code=413)
            receive=request._receive
            received=0
            async def bounded_receive():
                nonlocal received
                message=await receive()
                received+=len(message.get('body',b''))
                if received>limit:raise HTTPException(413,'每个音乐文件最大 100 MB。')
                return message
            request._receive=bounded_receive
        if request.method=='POST' and request.url.path!='/music/upload':
            raw=b''
            async for chunk in request.stream():
                raw+=chunk
                if len(raw)>8192:
                    from fastapi.responses import JSONResponse
                    return JSONResponse({'detail':'Request too large'},status_code=413)
            request._body=raw
        response=await call_next(request)
        response.headers['Cache-Control']='no-store'
        return response

    def workspace(request: Request):
        auth=request.headers.get('Authorization','')
        token=auth[7:] if auth.startswith('Bearer ') else ''
        ident=store.authenticate(token)
        if not ident: raise HTTPException(401,'Workspace credential required',headers={'WWW-Authenticate':'Bearer'})
        return ident

    @app.get('/health')
    def health(): return {'status':'ok','schema':'harbeat.activity-set.v1'}

    @app.post('/workspaces',status_code=201)
    def new_workspace(request: Request):
        ip=request.client.host if request.client else 'unknown'
        if ip in ('127.0.0.1','::1'):
            # Nginx overwrites this header; never trust X-Forwarded-For from clients.
            forwarded=request.headers.get('x-real-ip','')
            try: ip=str(ipaddress.ip_address(forwarded))
            except ValueError: pass
        return {'token':store.new_workspace(ip)}

    @app.get('/reservations')
    def reservations(ws=Depends(workspace)):
        return {'reservations':[store.view(ws,r) for r in store.list_reservations(ws)]}

    @app.post('/reservations',status_code=201)
    def create(body: CreateReservation,ws=Depends(workspace)):
        return store.view(ws,store.create_reservation(ws,body))

    @app.get('/reservations/{reservation_id}')
    def reservation(reservation_id: str,ws=Depends(workspace)):
        return store.view(ws,store.reservation(ws,reservation_id))

    @app.post('/reservations/{reservation_id}/reuse',status_code=201)
    def reuse(reservation_id: str,body: ReuseReservation,ws=Depends(workspace)):
        return store.view(ws,store.create_reservation(ws,body,store.reservation(ws,reservation_id)))

    @app.post('/reservations/{reservation_id}/prepare')
    def prepare(reservation_id: str,ws=Depends(workspace)):
        from .worker import valid_pinned_result
        from .execution import validate_execution_pack
        reservation=store.reservation(ws,reservation_id)
        # Serialize reset against worker checkpoints; active packs already continue.
        with store.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT data FROM packs WHERE id=? AND workspace=?',(reservation['packId'],ws)).fetchone()
            pack=json.loads(row['data'])
            corrupted=(not validate_execution_pack(settings,pack)) if pack.get('execution') else any(task.get('state')=='ready' and not valid_pinned_result(settings,pack['packId'],task['result']) for task in pack['tasks'])
            if pack['state'] not in ('queued','preparing') and (pack['state']!='ready' or corrupted):
                active=db.execute("SELECT count(*) FROM packs WHERE workspace=? AND state IN ('queued','preparing')",(ws,)).fetchone()[0]
                global_active=db.execute("SELECT count(*) FROM packs WHERE state IN ('queued','preparing')").fetchone()[0]
                if active>=settings.max_active or global_active>=20: raise HTTPException(429,'Preparation queue full')
                for task in pack['tasks']:
                    if pack.get('execution') or task.get('state')!='ready' or not valid_pinned_result(settings,pack['packId'],task['result']):
                        task.update(state='pending');task.pop('result',None);task.pop('error',None);task.pop('jobId',None)
                pack.update(state='queued',error=None,prepared=sum(t['state']=='ready' for t in pack['tasks']),failed=0)
                pack['warnings']=[w for w in pack['warnings'] if w!='some_edges_failed']
                db.execute('UPDATE packs SET state=?,data=? WHERE id=?',('queued',json.dumps(pack,separators=(',',':')),pack['packId']))
        return store.view(ws,reservation)

    @app.get('/packs/{pack_id}/manifest')
    def manifest(pack_id: str,ws=Depends(workspace)):
        return store.public_manifest(ws,pack_id)

    from .music import install_music
    install_music(app,store,workspace,music_queue,music_upstream)
    return app
