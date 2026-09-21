"""Derived, read-only dance sets for the existing Analysis Lab.

No models, production tables, source audio or original reports are modified.
The owner installs this module beside analysis_platform.server and calls
install(app, store, registry). Audio preparation runs in one bounded worker.
"""
import concurrent.futures
import bisect
import hashlib
import json
import math
import random
import re
import shutil
import statistics
import subprocess
import threading
import time
from pathlib import Path

VERSION = 'dance-v1'
STYLES = ['Hip-Hop', 'House', 'Funk', 'Disco', 'Electronic', 'K-Pop', 'Pop', 'R&B', 'Afro', 'Amapiano', 'Dancehall', 'Jersey Club', 'Baile Funk', 'Breakbeat']


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''):
            h.update(b)
    return h.hexdigest()


def styles_for(core, report):
    labels = (core.get('source') or {}).get('style_labels') or []
    genre = (report.get('extensions') or {}).get('genre') or {}
    top = (genre.get('data') or {}).get('top') or []
    # Explicit source labels take precedence. Model results are a fallback,
    # never silently presented as manually verified dance labels.
    evidence = 'catalog' if labels else 'model'
    if not labels and genre.get('status') == 'ready' and top:
        labels = [top[0].get('parent', ''), top[0].get('style', '')]
    result = set()
    for raw in labels:
        s = str(raw).lower().replace('-', '').replace(' ', '')
        if s in ('hiphop', 'rap', 'trap', 'grime', 'boombap', 'jazzhiphop'):
            result.add('Hip-Hop')
        elif 'house' in s:
            result.add('House')
        elif s == 'bailefunk':
            result.add('Baile Funk')
        elif 'funk' in s:
            result.add('Funk')
        elif 'disco' in s:
            result.add('Disco')
        elif s in ('electronic', 'edm', 'techno', 'trance', 'dubstep', 'drum&bass', 'future_bass', 'futurebass'):
            result.add('Electronic')
        elif s in ('r&b', 'rnb', 'soul'):
            result.add('R&B')
        elif s == 'pop':
            result.add('Pop')
        elif s == 'kpop':
            result.add('K-Pop')
        elif s in ('afro', 'amapiano', 'dancehall', 'jerseyclub', 'breakbeat'):
            result.add({'afro': 'Afro', 'amapiano': 'Amapiano', 'dancehall': 'Dancehall', 'jerseyclub': 'Jersey Club', 'breakbeat': 'Breakbeat'}[s])
    return sorted(result), evidence


def read_track(r):
    """Fail closed when music, beat-grid or vocal analysis identities disagree."""
    audio = r.get('audio') or {}
    core = (r.get('documents') or {}).get('core') or {}
    a = core.get('analysis') or {}
    master = ((audio.get('assets') or {}).get('master') or {})
    cm = ((core.get('assets') or {}).get('master') or {})
    tid = core.get('track_id', '')
    if (audio.get('binding') != 'published_manifest_reference'
            or tid != audio.get('catalog_track_id')
            or not re.fullmatch(r'track-[a-f0-9]{20}', tid)
            or master.get('status') != 'available'
            or not re.fullmatch(r'[a-f0-9]{64}', cm.get('sha256', ''))
            or master.get('declared_sha256') != cm['sha256']):
        raise ValueError('missing verified source')
    duration = min(150, cm['duration_ms'] / 1000)
    bars = [x / 1000 for x in a['beat_grid']['bars_ms'] if 0 <= x / 1000 < duration]
    bpm = a['tempo']['bpm']
    if len(bars) < 12 or bars != sorted(set(bars)) or not 55 <= bpm <= 210:
        raise ValueError('invalid bar grid')
    if abs(240 / statistics.median([b - x for x, b in zip(bars, bars[1:])]) / bpm - 1) > .05:
        raise ValueError('tempo disagrees with bar grid')
    v = r['documents'].get('vocal_activity') or {}
    vs = v.get('source') or {}
    if (v.get('status') != 'ready' or not isinstance(v.get('intervals'), list)
            or vs.get('track_id') != tid or vs.get('analysis_run_id') != core.get('analysis_run_id')
            or vs.get('vocal_sha256') != core['assets']['stems']['vocals']['sha256']):
        raise ValueError('missing bound vocal timeline')
    sections = [dict(start=x['start_ms'] / 1000, end=x['end_ms'] / 1000, label=x['label']) for x in a['sections']['items']]
    curve = [dict(start=x['start_ms'] / 1000, end=x['end_ms'] / 1000, value=x['value']) for x in a['energy']['curve']]
    groups, evidence = styles_for(core, r)
    if not groups or not sections or not curve or duration < 80:
        raise ValueError('missing style or local analysis')
    if any(not math.isfinite(x['value']) for x in curve):
        raise ValueError('invalid energy')
    windows = []
    # Early entry windows preserve enough dance time and limit preparation cost.
    anchors = sorted({0, *[min(range(len(bars)), key=lambda i: abs(bars[i] - s['start'])) for s in sections if s['start'] < 25]})[:2]
    for i in anchors:
        for n in (2, 4):
            if i + n >= len(bars) or bars[i + n] + 45 > duration:
                continue
            start, end = bars[i], bars[i + n]
            weights = [(max(0, min(end + 16, e['end']) - max(end, e['start'])), e['value']) for e in curve]
            total = sum(w for w, _ in weights)
            if total <= 0:
                continue
            windows.append(dict(id=f'w{i}-{n}', start=start, end=end, bars=n,
                                role=next((s['label'] for s in sections if s['start'] <= start < s['end']), 'entry'),
                                energy=sum(w * e for w, e in weights) / total, variants={}))
    if not windows:
        raise ValueError('no entry window')
    return dict(id=tid, title=r['title'], artist=(core.get('source') or {}).get('artist') or 'NAS 音乐库',
                bpm=bpm, style=groups[0], groups=groups, styleEvidence=evidence, styleScore=1,
                duration=duration, bars=bars, sections=sections, energy=curve,
                vocals=[[x['start_ms'] / 1000, x['end_ms'] / 1000] for x in v['intervals']], windows=windows,
                reportId=r['id'], provenance=dict(masterSha256=cm['sha256'], runId=core['analysis_run_id'], vocalSha256=vs['vocal_sha256']),
                mediaId=master['id'], warnings=['风格与小节仍需试听确认'])


def compatible(a, b):
    """Require an actual V3 future grid window, not just nearby BPM."""
    for w in b['windows']:
        length = w['bars'] * 240 / a['bpm']
        rate = (w['end'] - w['start']) / length
        if .8 <= rate <= 1.2:
            for out in a['bars']:
                if not 45 <= out <= a['duration'] - 8:
                    continue
                start = out - length
                i = bisect.bisect_left(a['bars'], start)
                if any(abs(x - start) <= .065 for x in a['bars'][max(0, i - 1):i + 1]):
                    return True
    return False


def choose(tracks, style, minutes, variation):
    pool = [t for t in tracks if style in t['groups']]
    rng = random.Random(f'{VERSION}:{style}:{minutes}:{variation}')
    rng.shuffle(pool)
    # Account conservatively for the entry section and transition lead time.
    # The player ends against elapsed audio time, independent of source seeks.
    target = minutes * 60
    if sum(max(0, t['duration'] - 24) for t in pool) < target:
        raise ValueError(f'{style} 的可用素材不足约 {minutes} 分钟，请缩短时长或换一种风格。')
    pairs = {}
    best = []
    for first in pool[:32]:
        route = [first]
        while len(route) < 32:
            capacity = route[0]['duration'] - 24 + sum(t['duration'] - max(w['end'] for w in t['windows']) - 24 for t in route[1:])
            if capacity >= target + 12 and len(route) >= 2:
                return route
            def can_follow(t):
                pair = (route[-1]['id'], t['id'])
                if pair not in pairs:
                    pairs[pair] = compatible(route[-1], t)
                return pairs[pair]
            left = [t for t in pool if t not in route and can_follow(t)]
            if not left:
                break
            # Avoid large tempo jumps while retaining variation between sets.
            left.sort(key=lambda t: abs(math.log(t['bpm'] / route[-1]['bpm'])) + rng.random() * .035)
            route.append(left[0])
        if len(route) > len(best):
            best = route
    raise ValueError(f'{style} 当前缺少足够的兼容素材组成约 {minutes} 分钟的连续舞程，请缩短时长或换一种风格。')


class DanceLibrary:
    def __init__(self, store, registry):
        self.store, self.registry = store, registry
        self.root = store.root / 'mobile-dance-v1'
        self.root.mkdir(exist_ok=True)
        (self.root / 'assets').mkdir(exist_ok=True)
        (self.root / 'recipes').mkdir(exist_ok=True)
        self.lock = threading.RLock()
        self.pool = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix='mobile-dance')
        self.tracks, self.excluded, self.stamp = [], 0, 0
        self.jobs = {}
        self.created = []
        self.summary = None
        self.refreshing = False
        snapshot = self.root / 'catalog-snapshot.json'
        if snapshot.is_file():
            try:
                value = json.loads(snapshot.read_text())
                if value.get('version') == VERSION:
                    self.tracks, self.summary = value['tracks'], value['summary']
                    self.stamp = time.monotonic() - min(601, time.time() - snapshot.stat().st_mtime)
            except (ValueError, KeyError):
                pass

    def _refresh(self):
        if self.summary and time.monotonic() - self.stamp < 600:
            return self.summary
        if time.monotonic() - self.stamp > 600:
            rows = self.store.reports()
            latest = {}
            for row in sorted(rows, key=lambda x: x.get('created_at') or '', reverse=True):
                a = row.get('audio') or {}
                if a.get('catalog_track_id'):
                    latest.setdefault(a['catalog_track_id'], row)
            tracks, excluded = [], 0
            for row in latest.values():
                try:
                    tracks.append(read_track(self.store.get_report(row['id'])))
                except (ValueError, KeyError, TypeError, ZeroDivisionError):
                    excluded += 1
            self.tracks, self.excluded, self.stamp = tracks, excluded, time.monotonic()
        styles = []
        for style in STYLES:
            count = sum(style in t['groups'] for t in self.tracks)
            durations = []
            for minutes in (5, 10, 15, 20, 30):
                try:
                    choose(self.tracks, style, minutes, 0)
                    durations.append(minutes)
                except ValueError:
                    pass
            styles.append(dict(style=style, count=count, durations=durations))
        self.summary = dict(styles=styles, eligible=len(self.tracks), excluded=self.excluded,
                            source='Jetson NAS', maxTrackSeconds=150)
        self.store.write(self.root / 'catalog-snapshot.json', dict(version=VERSION, tracks=self.tracks, summary=self.summary))
        return self.summary

    def catalog(self):
        if not self.refreshing and time.monotonic() - self.stamp > 600:
            self.refreshing = True
            def refresh():
                try:
                    self._refresh()
                finally:
                    self.refreshing = False
            self.pool.submit(refresh)
        return self.summary or dict(loading=True, styles=[], eligible=0, excluded=0)

    def asset(self, source, filters):
        recipe = hashlib.sha256((VERSION + sha(source) + filters).encode()).hexdigest()
        record = self.root / 'recipes' / (recipe + '.json')
        if record.is_file():
            saved = json.loads(record.read_text())
            if (self.root / 'assets' / (saved['sha256'] + '.flac')).is_file():
                return saved
        if shutil.disk_usage(self.root).free < 1024 ** 3:
            raise ValueError('素材缓存空间不足，请联系维护者清理派生素材')
        temp = self.root / 'assets' / (recipe + '.part.flac')
        subprocess.run(['ffmpeg', '-nostdin', '-y', '-v', 'error', '-threads', '1', '-i', str(source), '-vn', '-af', filters,
                        '-ar', '44100', '-ac', '2', '-c:a', 'flac', '-sample_fmt', 's16', '-frame_size', '4096', str(temp)],
                       check=True, timeout=180, capture_output=True)
        import soundfile as sf
        info = sf.info(temp)
        digest = sha(temp)
        dest = self.root / 'assets' / (digest + '.flac')
        if not dest.exists():
            temp.replace(dest)
        else:
            temp.unlink()
        result = dict(url='/dance-assets/' + digest + '.flac', sha256=digest, duration=info.duration, bytes=dest.stat().st_size)
        record.write_text(json.dumps(result))
        return result

    def build(self, key, route, style, minutes):
        try:
            tracks = json.loads(json.dumps(route))
            for i, t in enumerate(tracks):
                self.jobs[key].update(message=f'正在准备 {i + 1}/{len(tracks)} · {t["title"]}', progress=i / len(tracks))
                source = self.registry.resolve(t.pop('mediaId'))
                if sha(source) != t['provenance']['masterSha256']:
                    raise ValueError('原曲内容已变化，请刷新分析')
                t['native'] = self.asset(source, f'atrim=end={t["duration"]:.6f},asetpts=PTS-STARTPTS')
                t['duration'] = t['native']['duration']
                if i:
                    a = tracks[i - 1]
                    for w in t['windows']:
                        length = w['bars'] * 240 / a['bpm']
                        rate = (w['end'] - w['start']) / length
                        if not .8 <= rate <= 1.2:
                            continue
                        filters = f'atrim=start={w["start"]:.6f}:end={w["end"]:.6f},asetpts=PTS-STARTPTS,atempo={rate:.9f},apad=whole_dur={length:.9f},atrim=end={length:.9f}'
                        w['variants'][a['id']] = {**self.asset(source, filters), 'rate': rate}
            result = dict(id=key, style=style, seconds=minutes * 60, tracks=tracks,
                          source='Jetson NAS', schema='harbeat.dance_set.v1')
            path = self.root / (key + '.json')
            self.store.write(path, result)
            self.jobs[key] = dict(status='ready', progress=1, result=result)
        except Exception as e:
            self.jobs[key] = dict(status='failed', message=str(e) if isinstance(e, ValueError) else '素材准备失败，请稍后重试。')

    def prepare(self, style, minutes, variation):
        if style not in STYLES or minutes not in (5, 10, 15, 20, 30) or not 0 <= variation <= 999:
            raise ValueError('不支持的风格或时长')
        self.catalog()
        with self.lock:
            route = choose(self.tracks, style, minutes, variation)
            key = hashlib.sha256(json.dumps([VERSION, style, minutes, [t['reportId'] for t in route]]).encode()).hexdigest()
            cached = self.root / (key + '.json')
            if cached.is_file():
                return dict(id=key, status='ready', progress=1, result=json.loads(cached.read_text()))
            if key in self.jobs and self.jobs[key]['status'] != 'failed':
                return dict(id=key, **self.jobs[key])
            if sum(j['status'] == 'preparing' for j in self.jobs.values()) >= 3:
                raise ValueError('素材准备队列已满，请稍后重试')
            self.created = [t for t in self.created if time.monotonic() - t < 3600]
            if len(self.created) >= 12:
                raise ValueError('本小时已准备多组新舞程，请复用已有歌单或稍后再试')
            self.created.append(time.monotonic())
            self.jobs[key] = dict(status='preparing', progress=0, message='已选好歌曲，正在准备混音素材')
            self.pool.submit(self.build, key, route, style, minutes)
            return dict(id=key, **self.jobs[key])


def install(app, store, registry):
    from fastapi import HTTPException
    from fastapi.responses import FileResponse
    library = DanceLibrary(store, registry)

    @app.get('/api/analysis-lab/dance/catalog')
    def dance_catalog():
        return library.catalog()

    @app.get('/api/analysis-lab/dance/set')
    def dance_set(style: str, minutes: int, variation: int = 0):
        return library.prepare(style, minutes, variation)

    @app.get('/api/analysis-lab/dance/jobs/{key}')
    def dance_job(key: str):
        if not re.fullmatch(r'[a-f0-9]{64}', key):
            raise HTTPException(404)
        if key in library.jobs:
            return dict(id=key, **library.jobs[key])
        path = library.root / (key + '.json')
        if path.is_file():
            return dict(id=key, status='ready', result=json.loads(path.read_text()))
        raise HTTPException(404, '准备任务已中断，请重新生成')

    @app.get('/api/analysis-lab/dance/assets/{name}')
    def dance_asset(name: str):
        if not re.fullmatch(r'[a-f0-9]{64}\.flac', name):
            raise HTTPException(404)
        path = library.root / 'assets' / name
        if not path.is_file():
            raise HTTPException(404)
        return FileResponse(path, media_type='audio/flac', headers={'Cache-Control': 'public, max-age=31536000, immutable'})
