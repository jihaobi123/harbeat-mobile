"""Local-only HarBeat preview, with mutable build assets kept out of cache."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import argparse
from pathlib import Path
import json
import math
import re
from urllib.parse import urlsplit, parse_qs
import requests

ROOT = Path(__file__).resolve().parents[1] / "build" / "web"


class BoundedUpload:
    def __init__(self, source, size):
        self.source, self.size, self.remaining = source, size, size
    def __len__(self): return self.size
    def read(self, size=-1):
        if not self.remaining: return b''
        chunk=self.source.read(min(self.remaining, self.remaining if size < 0 else size))
        if not chunk: raise ValueError('incomplete upload')
        self.remaining-=len(chunk)
        return chunk


class PreviewHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def allowed_hosts(self):
        port = self.server.server_port
        return (f'127.0.0.1:{port}', f'localhost:{port}')

    def activity_api(self):
        parsed=urlsplit(self.path)
        if not re.fullmatch(r'/listen/set-api/(?:health|workspaces|reservations(?:/[a-f0-9]{32}(?:/(?:reuse|prepare))?)?|packs/[a-f0-9]{32}/manifest|music/(?:search|matches|download|playlist|upload|covers|jobs(?:/[a-f0-9]{32}/retry)?))',parsed.path):
            return self.send_error(404)
        if parsed.query:
            try: query=parse_qs(parsed.query,keep_blank_values=True,strict_parsing=True)
            except ValueError:return self.send_error(404)
            if parsed.path!='/listen/set-api/music/search' or set(query)-{'q','scope','provider'} or any(len(v)!=1 for v in query.values()) or not 1<=len(query.get('q',[''])[0])<=300 or query.get('scope',['library'])[0] not in ('library','discover') or query.get('provider',['all'])[0] not in ('all','netease','qq'):
                return self.send_error(404)
        if self.headers.get('Host') not in self.allowed_hosts() or self.headers.get('Origin') not in (None, *(f'http://{h}' for h in self.allowed_hosts())):
            return self.send_error(403)
        if self.command=='POST' and self.headers.get('Origin') not in tuple(f'http://{h}' for h in self.allowed_hosts()):return self.send_error(403)
        is_get=parsed.path in ('/listen/set-api/music/search','/listen/set-api/music/jobs','/listen/set-api/music/covers') or parsed.path.endswith('/health') or parsed.path.endswith('/manifest') or re.fullmatch(r'/listen/set-api/reservations(?:/[a-f0-9]{32})?',parsed.path)
        is_post=bool(re.fullmatch(r'/listen/set-api/music/(?:matches|download|playlist|upload|jobs/[a-f0-9]{32}/retry)',parsed.path)) or parsed.path.endswith('/workspaces') or parsed.path.endswith('/reuse') or parsed.path.endswith('/prepare') or parsed.path=='/listen/set-api/reservations'
        if not (self.command=='GET' and is_get or self.command=='POST' and is_post):return self.send_error(404)
        headers={'Origin':'https://8.136.120.255','Content-Type':'application/json','Accept':'application/json'}
        bearer=self.headers.get('Authorization','')
        if bearer:
            if not re.fullmatch(r'Bearer [A-Za-z0-9_-]{43}',bearer):return self.send_error(401)
            headers['Authorization']=bearer
        try:
            size=int(self.headers.get('Content-Length','0'))
            upload=parsed.path=='/listen/set-api/music/upload' and self.command=='POST'
            if size<0 or size>(101*1024*1024 if upload else 8192):return self.send_error(413)
            if upload:
                content_type=self.headers.get('Content-Type','')
                if not re.fullmatch(r'multipart/form-data; boundary=[A-Za-z0-9_+.\-]{1,100}',content_type):return self.send_error(415)
                headers['Content-Type']=content_type
                body=BoundedUpload(self.rfile,size)
            else:
                body=self.rfile.read(size) if self.command=='POST' else None
                if body:json.loads(body)
            response=requests.request(self.command,'https://8.136.120.255'+self.path,headers=headers,data=body,timeout=(12,180 if upload else 75 if '/music/' in parsed.path else 35),allow_redirects=False)
            self.send_response(response.status_code)
            self.send_header('Content-Type','application/json; charset=utf-8')
            self.end_headers();self.wfile.write(response.content)
        except (ValueError,TypeError):self.send_error(422)
        except requests.RequestException:self.send_error(502,'Reservation service unavailable')

    def do_GET(self):
        if self.path.startswith('/listen/set-api/'):return self.activity_api()
        if not self.path.startswith(('/api/analysis-lab/', '/analysis-lab-static/mobile-artwork-v1/', '/listen/')):
            return super().do_GET()
        # Development-only, loopback-bound, fixed upstream and read-only paths.
        # Never forward cookies, Authorization, user-supplied URLs or write verbs.
        if self.headers.get('Host') not in self.allowed_hosts() or self.headers.get('Origin') not in (None, *(f'http://{h}' for h in self.allowed_hosts())):
            return self.send_error(403)
        parsed = urlsplit(self.path)
        original = re.fullmatch(r'(?:/api/analysis-lab/(reports(?:/[a-f0-9]{64})?|media/[a-f0-9]{64})|/analysis-lab-static/mobile-artwork-v1/(?:catalog\.json|[a-f0-9]{64}\.jpg))', parsed.path)
        execution = re.fullmatch(r'/listen/(?:execution/(?:index\.json|tracks/[A-Za-z0-9_-]{1,160}\.json|profiles/(?P<profile_digest>[a-f0-9]{64})\.json)|execution-media/(?P<digest>[a-f0-9]{64})\.(?:flac|wav))',parsed.path)
        listen = re.fullmatch(r'/listen/(?:music-covers/[a-f0-9]{64}\.jpg|library\.json|(?:catalog/[A-Za-z0-9_-]{1,160}/)?details/[A-Za-z0-9_-]{1,160}\.json|(?:catalog/[A-Za-z0-9_-]{1,160}/)?media/[A-Za-z0-9_.-]+\.(?:flac|wav)|smart-api/(?:health|rules|jobs/[a-f0-9]{64})|set-media/[a-f0-9]{32}/[a-f0-9]{64}/(?:original|bass|filter|yield|vocal|bass_filter)\.wav|smart-media/[a-f0-9]{64}/(?:original|bass|filter|yield|vocal|bass_filter)\.wav)', parsed.path)
        query = parse_qs(parsed.query, keep_blank_values=True)
        if execution:
            expected=execution.group('digest') or execution.group('profile_digest')
            if parsed.query and (not expected or set(query)!={'sha256'} or query['sha256']!=[expected]):return self.send_error(404)
        elif not (original or listen) or (parsed.query and (not listen or not re.search(r'/media/|/smart-media/|/set-media/', parsed.path) or set(query) != {'sha256'} or len(query['sha256']) != 1 or not re.fullmatch('[a-f0-9]{64}',query['sha256'][0]))):
            return self.send_error(404)
        headers={'Accept-Encoding':'identity'}
        value=self.headers.get('Range')
        if value and re.fullmatch(r'bytes=\d*-\d*',value):headers['Range']=value
        started=False
        try:
            with requests.get('https://8.136.120.255'+self.path,headers=headers,stream=True,timeout=(12,40),allow_redirects=False) as response:
                self.send_response(response.status_code)
                started=True
                for key in ['Content-Type','Content-Length','Content-Range','Accept-Ranges']:
                    if key in response.headers and not (key=='Content-Length' and response.headers.get('Content-Encoding')):self.send_header(key,response.headers[key])
                self.end_headers()
                for chunk in response.iter_content(64*1024):self.wfile.write(chunk)
        except (BrokenPipeError,ConnectionResetError):
            pass
        except requests.RequestException:
            if not started:self.send_error(502,'NAS temporarily unavailable')
            self.close_connection=True

    def do_POST(self):
        if self.path.startswith('/listen/set-api/'):return self.activity_api()
        # Explicit, bounded render preparation only. No account/admin/upload API.
        if self.path != '/listen/smart-api/jobs':
            return self.send_error(404)
        if self.headers.get('Host') not in self.allowed_hosts() or self.headers.get('Origin') not in tuple(f'http://{h}' for h in self.allowed_hosts()):
            return self.send_error(403)
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 1 <= size <= 8192:
                return self.send_error(413)
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict) or set(body) != {'from', 'to', 'windowId', 'start'}:
                return self.send_error(422)
            if any(not isinstance(body[k], str) or not re.fullmatch('[A-Za-z0-9_-]{1,160}', body[k]) for k in ('from','to','windowId')) or body['from'] == body['to'] or type(body['start']) not in (int,float) or not math.isfinite(body['start']) or not 0 <= body['start'] <= 86400:
                return self.send_error(422)
            response = requests.post('https://8.136.120.255/listen/smart-api/jobs',
                json=body, headers={'Origin': 'https://8.136.120.255'},
                timeout=(12, 35), allow_redirects=False)
            self.send_response(response.status_code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(response.content)
        except (ValueError, TypeError, json.JSONDecodeError):
            self.send_error(422)
        except requests.RequestException:
            self.send_error(502, 'Mix preparation unavailable')


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    ThreadingHTTPServer(("127.0.0.1", args.port), PreviewHandler).serve_forever()
