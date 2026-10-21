"""Validated upload into the same durable source queue; never invoke analysis here."""
from __future__ import annotations
import asyncio
import hashlib
import json
from pathlib import Path
import subprocess
import uuid
from fastapi import HTTPException
from .music import checked_style
from .music_covers import embedded_cover
MAX_BYTES=100*1024**2
SUFFIXES={'.mp3','.wav','.flac','.m4a','.aac','.ogg','.opus','.aif','.aiff'}

def validate_audio(path):
    try:
        result=subprocess.run(['ffprobe','-v','error','-protocol_whitelist','file,pipe','-format_whitelist','mp3,wav,flac,mov,aac,ogg,aiff','-show_entries','format=duration:stream=codec_type','-of','json',str(path)],check=True,capture_output=True,text=True,timeout=20)
        value=json.loads(result.stdout);duration=float(value['format']['duration'])
        if not 20<=duration<=1200 or not any(s.get('codec_type')=='audio' for s in value['streams']):raise ValueError()
    except (OSError,ValueError,KeyError,subprocess.SubprocessError):raise HTTPException(422,'请上传可解码的音乐文件，时长需在 20 秒至 20 分钟之间。')

async def upload_music(bridge,workspace,audio,style,title):
    style=checked_style(style);bridge.capacity();filename=Path((audio.filename or '').replace('\\','/')).name;suffix=Path(filename).suffix.lower()
    if suffix not in SUFFIXES:raise HTTPException(422,'支持 MP3、WAV、FLAC、M4A、AAC、OGG、Opus 和 AIFF。')
    folder=bridge.import_root/'uploads';folder.mkdir(exist_ok=True,parents=True);target=folder/(uuid.uuid4().hex+suffix);owned=False;pending=None;keep_cover=False
    try:
        total=0;digest=hashlib.sha256()
        with target.open('wb') as output:
            while True:
                chunk=await audio.read(1024**2)
                if not chunk:break
                total+=len(chunk)
                if total>MAX_BYTES:raise HTTPException(413,'每个音乐文件最大 100 MB。')
                bridge.capacity();digest.update(chunk);output.write(chunk)
        await asyncio.to_thread(validate_audio,target)
        # Extract before enqueue: the independent import worker deletes duplicate/successful input files.
        image=await asyncio.to_thread(embedded_cover,target)
        if image:
            coverfolder=bridge.settings.root/'pending-covers';coverfolder.mkdir(exist_ok=True,mode=0o700);pending=coverfolder/(uuid.uuid4().hex+'.jpg');pending.write_bytes(image)
        payload=dict(kind='upload',path=str(target),sha256=digest.hexdigest(),title=(title.strip() or Path(filename).stem)[:300],artist='',style=style)
        result=await asyncio.to_thread(bridge.record,workspace,'sha:'+digest.hexdigest(),payload,None,pending.name if pending else None)
        # An existing per-workspace or global dedup job must not retain another random upload file.
        with bridge.store.connection() as db:row=db.execute('SELECT payload,global_id,data FROM music_jobs WHERE id=? AND workspace=?',(result['id'],workspace)).fetchone()
        owned=json.loads(row['payload']).get('path')==str(target)
        if owned and row['global_id']:
            owned=json.loads(bridge.queue.get(row['global_id'])['payload']).get('path')==str(target)
        keep_cover=bool(pending and json.loads(row['data']).get('cover')==pending.name)
        if pending and not keep_cover:pending.unlink(missing_ok=True)
        return result
    finally:
        await audio.close()
        if not owned:target.unlink(missing_ok=True)
        if pending and not keep_cover:pending.unlink(missing_ok=True)
