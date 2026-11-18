"""Fetch owner-library excerpts for a local scratch A/B. Does not publish audio."""
import concurrent.futures
import hashlib
import json
import re
from pathlib import Path
import subprocess
import urllib.request
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.impeccable/review/scratch-ab-v2'
BASE = 'https://8.136.120.255/listen/'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def get(path):
    url = urljoin(BASE, path)
    if urlparse(url).hostname != '8.136.120.255' or urlparse(url).scheme != 'https':
        raise ValueError('Unexpected library origin')
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    return op.open(url, timeout=60).read()

def prepare(row):
    payload = json.loads(get(row['detailUrl']))
    track = payload.get('track', payload)
    if not isinstance(track.get('id'), str) or not re.fullmatch(r'track-[0-9a-f]{20}', track['id']):
        raise ValueError('Unexpected catalog track id')
    segments = track.get('audioSegments') or [{'start': 0, 'end': track['native']['duration'], 'asset': track['native']}]
    valid = [b for b in track['alignment']['bars'] if b.get('valid')]
    position = max(20.3, valid[0]['start'] + 5.3)
    segment = next(s for s in segments if s['start'] <= position - 2 and s['end'] >= position + 6)
    asset = segment['asset']
    audio = get(asset['url'])
    assert hashlib.sha256(audio).hexdigest() == asset['sha256']
    directory = OUT / track['id']
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'source.flac').write_bytes(audio)
    (directory / 'track.json').write_text(json.dumps(track), encoding='utf-8')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(directory / 'source.flac'), '-ar', '44100', '-ac', '2', '-f', 'f32le', str(directory / 'source.f32')], check=True)
    return {'id': track['id'], 'title': track['title'], 'bpm': track['bpm'], 'position': position, 'offset': segment['start']}

if __name__ == '__main__':
    rows = json.loads(get('library.json'))['tracks']
    names = ['HIPHOP', 'All Falls Down', 'Lose Control']
    selected = [next(r for r in rows if r['title'] == name and r.get('playStatus') == 'ready') for name in names]
    OUT.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        groups = list(pool.map(prepare, selected))
    (OUT / 'inputs.json').write_text(json.dumps(groups), encoding='utf-8')
    print(json.dumps(groups, ensure_ascii=False))
