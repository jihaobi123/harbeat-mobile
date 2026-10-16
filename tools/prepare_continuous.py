"""Prepare SHA-bound, lazy metadata for the currently published continuous-player fallback.

No audio is downloaded here. The complete-library URL is checked at runtime;
this 26-track preview catalog is explicitly identified when it is unavailable.
"""
import gzip
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def prepare(download=False):
    vendor = ROOT / 'vendor/realtime-v3'
    source = json.loads((vendor / 'continuous-source.json').read_text())
    out = vendor / 'public/continuous'
    cache = vendor / '.source-cache'
    raw_path = cache / (source['decodedSha256'] + '.json')
    if not raw_path.is_file():
        if not download:
            raise RuntimeError('Missing continuous metadata; run tools/build_realtime.py --download')
        data = gzip.decompress(urllib.request.urlopen(source['sourceUrl'], timeout=90).read())
        assert hashlib.sha256(data).hexdigest() == source['decodedSha256']
        assert len(data) == source['decodedBytes']
        cache.mkdir(exist_ok=True)
        raw_path.write_bytes(data)
    data = raw_path.read_bytes()
    assert hashlib.sha256(data).hexdigest() == source['decodedSha256']
    catalog = json.loads(data)
    assert len(catalog['tracks']) == source['tracks']
    (out / 'details').mkdir(parents=True, exist_ok=True)
    entries = []
    for t in catalog['tracks']:
        tid = t['id']
        assert len(tid) == 26 and tid.startswith('track-') and all(c in '0123456789abcdef' for c in tid[6:])
        detail = json.dumps({'track': t}, ensure_ascii=False, separators=(',', ':')).encode()
        for suffix, value in [('.json', detail), ('.json.gz', gzip.compress(detail, mtime=0))]:
            (out / 'details' / (tid + suffix)).write_bytes(value)
        entries.append(dict(id=tid, title=t['title'], bpm=t['bpm'], duration=t['duration'], style=t['style'],
            collection='已发布试听', styleLabels=[t['style']], playStatus='ready', mixStatus='ready',
            detailUrl='continuous/details/' + tid + '.json'))
    index = dict(schema='harbeat.continuous-library.v1', tracks=entries,
        coverage=dict(indexed=len(entries), playable=len(entries), mixReady=len(entries), fullSongs=False,
                      source='published-preview', sourceCatalogSha256=source['decodedSha256']))
    (out / 'library.json').write_text(json.dumps(index, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print('Continuous fallback metadata:', len(entries), 'published previews; full-library readiness is checked separately')


if __name__ == '__main__':
    import sys
    prepare('--download' in sys.argv)
