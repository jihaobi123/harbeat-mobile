"""Optional, content-addressed artwork. Audio readiness never depends on artwork."""
from __future__ import annotations
import hashlib
import http.client
import io
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import ssl
import subprocess
import tempfile
import warnings
from urllib.parse import urljoin,urlsplit
import requests
from PIL import Image,ImageOps
MAX_BYTES=5*1024**2
MAX_PIXELS=20_000_000

def checked_cover_url(url,resolver=None):
    value=urlsplit(url)
    host=(value.hostname or '').lower()
    if value.scheme!='https' or value.username or value.password or value.port not in (None,443) or any(ord(c)<32 for c in url):raise ValueError('Invalid cover URL')
    if not (re.fullmatch(r'p\d+\.music\.126\.net',host) or host in ('y.gtimg.cn','y.qq.com')):raise ValueError('Cover CDN not allowed')
    answers=(resolver or socket.getaddrinfo)(host,443,type=socket.SOCK_STREAM)
    if not answers or any(not ipaddress.ip_address(a[4][0]).is_global for a in answers):raise ValueError('Cover address must be public')
    return host,answers[0][4][0]

def fetch_cover(url):
    for _ in range(4):
        host,ip=checked_cover_url(url);parsed=urlsplit(url)
        connection=http.client.HTTPSConnection(host,443,timeout=8,context=ssl.create_default_context())
        # Pin the already checked DNS address. Preserve TLS SNI and certificate hostname validation.
        raw=socket.create_connection((ip,443),8)
        try:
            connection.sock=connection._context.wrap_socket(raw,server_hostname=host)
            connection.request('GET',parsed.path+('?' + parsed.query if parsed.query else ''),headers={'Host':host,'User-Agent':'HarBeat artwork/1','Accept':'image/*'})
            response=connection.getresponse()
            if response.status in (301,302,303,307,308):
                url=urljoin(url,response.getheader('Location') or '');continue
            if response.status!=200 or not (response.getheader('Content-Type') or '').lower().startswith('image/'):raise ValueError('Cover unavailable')
            if int(response.getheader('Content-Length') or 0)>MAX_BYTES:raise ValueError('Cover too large')
            data=response.read(MAX_BYTES+1)
            if len(data)>MAX_BYTES:raise ValueError('Cover too large')
            return reencode(data)
        finally:
            connection.close();raw.close()
    raise ValueError('Too many cover redirects')

def reencode(data):
    if len(data)>MAX_BYTES:raise ValueError('Cover too large')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error',Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                if image.width*image.height>MAX_PIXELS:raise ValueError('Cover dimensions too large')
                image.load();image=ImageOps.exif_transpose(image).convert('RGB');image.thumbnail((1200,1200))
                output=io.BytesIO();image.save(output,format='JPEG',quality=86,optimize=True)
                return output.getvalue()
    except Exception as error:raise ValueError('Invalid artwork image') from error

def embedded_cover(path):
    with tempfile.TemporaryDirectory() as folder:
        target=Path(folder)/'cover.jpg'
        try:
            subprocess.run(['ffmpeg','-nostdin','-v','error','-protocol_whitelist','file,pipe','-format_whitelist','mp3,wav,flac,mov,aac,ogg,aiff','-i',str(path),'-map','0:v:0','-frames:v','1','-vf','scale=1200:1200:force_original_aspect_ratio=decrease','-fs',str(MAX_BYTES),str(target)],check=True,timeout=12,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            return reencode(target.read_bytes())
        except (OSError,subprocess.SubprocessError,ValueError):return None

def metadata_cover(discovery):
    provider=discovery.get('provider');ident=str(discovery.get('source_id',''))
    if provider=='netease' and re.fullmatch(r'\d{1,24}',ident):
        response=requests.get('https://music.163.com/api/song/detail/',params={'id':ident,'ids':json.dumps([int(ident)])},headers={'Referer':'https://music.163.com/','User-Agent':'Mozilla/5.0'},timeout=8,allow_redirects=False)
        if response.status_code!=200 or len(response.content)>1024**2:return None
        rows=response.json().get('songs') or []
        if rows and str(rows[0].get('id'))==ident:
            album=rows[0].get('album') or rows[0].get('al') or {}
            url=album.get('picUrl')
            if url:
                # Legacy metadata may spell this official CDN URL with HTTP. Fetch only its HTTPS equivalent.
                return str(url).replace('http://','https://',1)
    if provider=='qq' and re.fullmatch(r'[A-Za-z0-9]{1,64}',ident):
        payload={'comm':{'ct':24,'cv':0},'req':{'module':'music.pf_song_detail_svr','method':'get_song_detail_yqq','param':{'song_mid':ident}}}
        response=requests.post('https://u.y.qq.com/cgi-bin/musicu.fcg',json=payload,timeout=8,allow_redirects=False)
        if response.status_code!=200 or len(response.content)>1024**2:return None
        data=response.json().get('req',{}).get('data',{}).get('track_info',{})
        album=str(data.get('album',{}).get('mid',''))
        if str(data.get('mid'))==ident and re.fullmatch(r'[A-Za-z0-9]{1,64}',album):return 'https://y.gtimg.cn/music/photo_new/T002R500x500M000'+album+'.jpg'
    return None

def current_track(bridge,track_id):
    root=bridge.settings.site.resolve();index=json.loads((root/'library.json').read_text())
    row=next((r for r in index['tracks'] if r['id']==track_id and r.get('playStatus')=='ready'),None)
    if not row:raise ValueError('Track is not publicly ready')
    relative=Path(row['detailUrl'])
    if relative.is_absolute() or '..' in relative.parts:raise ValueError('Invalid detail path')
    detail=(root/relative).resolve()
    if root not in detail.parents:raise ValueError('Invalid detail path')
    value=json.loads(detail.read_text())['track']
    sha=value.get('provenance',{}).get('masterSha256')
    if value.get('id')!=track_id or not re.fullmatch(r'[a-f0-9]{64}',str(sha)):raise ValueError('Track identity invalid')
    return sha

def ensure_table(bridge):
    with bridge.store.connection() as db:db.execute('CREATE TABLE IF NOT EXISTS music_covers(track_id TEXT PRIMARY KEY,master_sha TEXT NOT NULL,input_sha TEXT NOT NULL,cover_sha TEXT NOT NULL)')

def bind_cover(bridge,track_id,input_sha,data):
    if not re.fullmatch(r'[a-f0-9]{64}',str(input_sha)):raise ValueError('Input identity missing')
    inventory=json.loads((bridge.import_root/'inventory.json').read_text())
    if not any(item.get('track_id')==track_id and item.get('input_sha256')==input_sha for item in inventory.get('items',[])):raise ValueError('Published input mismatch')
    master=current_track(bridge,track_id);sha=hashlib.sha256(data).hexdigest();folder=bridge.settings.root/'music-covers';folder.mkdir(exist_ok=True,mode=0o755);folder.chmod(0o755)
    target=folder/(sha+'.jpg')
    if not target.exists():
        temp=folder/(sha+'.tmp');temp.write_bytes(data);temp.chmod(0o644);os.replace(temp,target)
    ensure_table(bridge)
    with bridge.store.connection() as db:db.execute('INSERT OR REPLACE INTO music_covers VALUES (?,?,?,?)',(track_id,master,input_sha,sha))
    return '/listen/music-covers/'+sha+'.jpg'

def checked_association(bridge,row):
    try:
        if not row or current_track(bridge,row['track_id'])!=row['master_sha']:return None
        path=bridge.settings.root/'music-covers'/(row['cover_sha']+'.jpg')
        if hashlib.sha256(path.read_bytes()).hexdigest()!=row['cover_sha']:return None
        return {'url':'/listen/music-covers/'+row['cover_sha']+'.jpg','masterSha256':row['master_sha']}
    except (OSError,ValueError,KeyError,StopIteration):return None

def verified_cover(bridge,track_id):
    with bridge.store.connection() as db:row=db.execute('SELECT * FROM music_covers WHERE track_id=?',(track_id,)).fetchone()
    return checked_association(bridge,row)

def verified_covers(bridge):
    output={}
    with bridge.store.connection() as db:rows=db.execute('SELECT * FROM music_covers').fetchall()
    for row in rows:
        value=checked_association(bridge,row)
        if value:output[row['track_id']]=value
    return output

def publication_input_sha(bridge,row,data):
    original=json.loads(row['payload'])
    if not row['global_id']:raise ValueError('Worker receipt missing')
    receipt=bridge.queue.get(row['global_id'])
    if receipt.get('status') not in ('ready','ready_playback') or receipt.get('track_id')!=data.get('trackId'):raise ValueError('Worker publication mismatch')
    payload=json.loads(receipt['payload'])
    if payload.get('kind')!=original.get('kind'):raise ValueError('Worker source kind mismatch')
    if original.get('kind')=='download':
        requested=original.get('candidate') or {};completed=payload.get('candidate') or {}
        if requested.get('source') not in ('netease','kuwo','fangpi') or any(str(requested.get(key))!=str(completed.get(key)) for key in ('source','id')):raise ValueError('Worker source identity mismatch')
        if not re.fullmatch(r'\d{1,24}',str(requested.get('id',''))):raise ValueError('Worker source ID invalid')
    elif original.get('kind')=='upload':
        if payload.get('sha256')!=original.get('sha256'):raise ValueError('Worker upload identity mismatch')
    else:raise ValueError('Worker source kind invalid')
    inventory=json.loads((bridge.import_root/'inventory.json').read_text())
    hashes={item.get('input_sha256') for item in inventory.get('items',[]) if item.get('track_id')==data['trackId']}
    if len(hashes)!=1:raise ValueError('Published input identity ambiguous')
    published=next(iter(hashes))
    if not re.fullmatch(r'[a-f0-9]{64}',str(published)):raise ValueError('Published input SHA invalid')
    checkpoint=bridge.import_root/'work'/row['global_id']/'input.json'
    if original.get('kind')=='upload':expected=original['sha256']
    elif checkpoint.exists():expected=json.loads(checkpoint.read_text()).get('sha256')
    else:
        # existing_track returns the real hash-matched published ID without a checkpoint.
        # Its immutable queue payload above proves this exact provider/source ID.
        expected=published
    if expected!=published:raise ValueError('Worker input hash mismatch')
    return published

def complete_covers(bridge):
    with bridge.store.connection() as db:rows=db.execute('SELECT * FROM music_jobs').fetchall()
    for row in rows:
        if bridge.stop.is_set():return
        data=json.loads(row['data'])
        if data.get('coverTried'):continue
        patch={}
        # Cache metadata while analysis runs. No unbound thumbnail is exposed to clients.
        if not data.get('cover') and not data.get('metadataTried') and data.get('discovery'):
            patch['metadataTried']=True
            try:
                url=metadata_cover(data['discovery'])
                if url:
                    cover=fetch_cover(url);folder=bridge.settings.root/'pending-covers';folder.mkdir(exist_ok=True,mode=0o700)
                    filename=row['id']+'.jpg';(folder/filename).write_bytes(cover);patch['cover']=filename
            except Exception:pass
            data.update(patch)
        if data['status'] in ('ready','ready_playback'):
            try:
                input_sha=publication_input_sha(bridge,row,data)
                if input_sha and data.get('cover'):
                    filename=data['cover']
                    if not re.fullmatch(r'[a-f0-9]{32}\.jpg',filename):raise ValueError('Invalid cover checkpoint')
                    cover=reencode((bridge.settings.root/'pending-covers'/filename).read_bytes())
                    patch['coverUrl']=bind_cover(bridge,data['trackId'],input_sha,cover)
            except Exception:pass
            patch['coverTried']=True
        if patch:
            # A concurrent request may have advanced queue status; only merge artwork fields.
            with bridge.store.connection() as db:
                latest=db.execute('SELECT data FROM music_jobs WHERE id=?',(row['id'],)).fetchone()
                merged={**json.loads(latest['data']),**patch}
                db.execute('UPDATE music_jobs SET data=? WHERE id=?',(json.dumps(merged),row['id']))
