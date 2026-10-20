"""Verify pinned V3 source/media, compile and stage the Android offline engine.

python tools/build_realtime.py --download  # prepare missing media and npm dependencies
python tools/build_realtime.py             # verify/build from local inputs
"""
import argparse, concurrent.futures, hashlib, json, pathlib, shutil, subprocess, urllib.request
from prepare_continuous import prepare as prepare_continuous

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'vendor/realtime-v3'
DEST = ROOT / 'android/app/src/main/assets/realtime'
ORIGIN = 'https://8.136.120.255/analysis-lab-static/v3-live-20260920/'

def sha(data): return hashlib.sha256(data).hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--download', action='store_true')
    args = parser.parse_args()
    prepare_continuous(args.download)
    upstream = json.loads((SOURCE/'upstream.json').read_text())
    for path, digest in upstream['files'].items():
        local = SOURCE/path.removeprefix('web/')
        assert sha(local.read_bytes()) == digest, f'Upstream source changed: {local}'
    metric = json.loads((SOURCE/'metric-upstream.json').read_text())
    assert sha((SOURCE/'public/v3-clock.js').read_bytes()) == metric['clockSha256'], 'Metric audio clock differs'
    for path, digest in metric['files'].items():
        local = SOURCE/'src/metric-upstream'/path.removeprefix('web/src/')
        assert sha(local.read_bytes()) == digest, f'Metric upstream source changed: {local}'
    catalog = json.loads((SOURCE/'public/catalog.json').read_text(encoding='utf-8'))
    assets = {}
    def walk(value):
        if isinstance(value, dict):
            if 'url' in value and 'sha256' in value: assets[value['url']] = value
            for child in value.values(): walk(child)
        elif isinstance(value, list):
            for child in value: walk(child)
    walk(catalog)
    def prepare(item):
        path, asset = item
        file = (SOURCE/'public'/path).resolve()
        assert file.is_relative_to((SOURCE/'public/media').resolve()), path
        if not file.exists():
            assert args.download, f'Missing {path}; run with --download'
            file.parent.mkdir(parents=True, exist_ok=True)
            data = urllib.request.urlopen(ORIGIN + path, timeout=90).read()
            assert len(data) == asset['bytes'] and sha(data) == asset['sha256'], path
            file.write_bytes(data)
        assert file.stat().st_size == asset['bytes'] and sha(file.read_bytes()) == asset['sha256'], path
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: list(pool.map(prepare, assets.items()))
    npm = shutil.which('npm.cmd') or shutil.which('npm')
    if args.download: subprocess.run([npm, 'ci', '--no-audit', '--no-fund'], cwd=SOURCE, check=True)
    subprocess.run([npm, 'exec', '--', 'tsc'], cwd=SOURCE, check=True)
    subprocess.run([npm, 'exec', '--', 'vite', 'build', '--config', 'vite.mobile.config.ts'], cwd=SOURCE, check=True)
    subprocess.run([npm, 'exec', '--', 'vite', 'build', '--config', 'vite.metric-mobile.config.ts'], cwd=SOURCE, check=True)
    # Only this generated directory may be replaced. Never remove sources or user files.
    assert DEST.resolve() == (ROOT/'android/app/src/main/assets/realtime').resolve()
    if DEST.exists(): shutil.rmtree(DEST)
    # Android's asset merger treats foo.json.gz as foo.json, so shipping both
    # collides. The offline index uses .json URLs; APK compression handles size.
    shutil.copytree(SOURCE/'dist-mobile', DEST, ignore=shutil.ignore_patterns('*.json.gz'))
    shutil.copytree(SOURCE/'dist-metric-mobile', DEST, dirs_exist_ok=True)
    manifest = {'commit': upstream['commit'], 'catalogSha256': sha((SOURCE/'public/catalog.json').read_bytes()),
                'assetCount': len(assets), 'mediaBytes': sum(a['bytes'] for a in assets.values()),
                'engine': 'bundled Web Audio V3 + metric mix', 'foregroundOnly': True,
                'metricSourceCommit': metric['commit'],
                'files': {str(p.relative_to(DEST)).replace('\\','/'): sha(p.read_bytes()) for p in DEST.rglob('*') if p.is_file()}}
    (DEST/'mobile-build.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(json.dumps({k:v for k,v in manifest.items() if k != 'files'}), flush=True)

if __name__ == '__main__': main()
