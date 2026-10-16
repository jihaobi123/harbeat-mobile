"""Local-only HarBeat preview, with mutable build assets kept out of cache."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
import requests

ROOT = Path(__file__).resolve().parents[1] / "build" / "web"


class PreviewHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if not self.path.startswith(('/api/analysis-lab/', '/analysis-lab-static/mobile-artwork-v1/')):
            return super().do_GET()
        # Development-only, loopback-bound, fixed upstream and read-only paths.
        # Never forward cookies, Authorization, user-supplied URLs or write verbs.
        if self.headers.get('Host') not in ('127.0.0.1:8765','localhost:8765') or self.headers.get('Origin') not in (None,'http://127.0.0.1:8765','http://localhost:8765'):
            return self.send_error(403)
        if not re.fullmatch(r'(?:/api/analysis-lab/(reports(?:/[a-f0-9]{64})?|media/[a-f0-9]{64})|/analysis-lab-static/mobile-artwork-v1/(?:catalog\.json|[a-f0-9]{64}\.jpg))',self.path):
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


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8765), PreviewHandler).serve_forever()
