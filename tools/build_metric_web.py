"""Build the same metric audio engine used in Android, then stage web assets.

Run after flutter build web. Does not bundle or download source music.
"""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def main():
    source = ROOT / 'vendor/realtime-v3'
    manifest = json.loads((source / 'metric-upstream.json').read_text(encoding='utf-8'))
    if hashlib.sha256((source / 'public/v3-clock.js').read_bytes()).hexdigest() != manifest['clockSha256']:
        raise ValueError('Metric audio clock differs')
    for path, expected in manifest['files'].items():
        file = source / 'src/metric-upstream' / path.removeprefix('web/src/')
        if hashlib.sha256(file.read_bytes()).hexdigest() != expected:
            raise ValueError('Metric source differs: ' + path)
    npm = shutil.which('npm.cmd') or shutil.which('npm')
    subprocess.run([npm, 'exec', '--', 'tsc', '--noEmit'], cwd=source, check=True)
    subprocess.run([npm, 'exec', '--', 'vite', 'build', '--config', 'vite.metric-mobile.config.ts'], cwd=source, check=True)
    web = ROOT / 'build/web'
    if not (web / 'index.html').is_file():
        raise ValueError('Build Flutter web first')
    shutil.copytree(source / 'dist-metric-mobile', web / 'metric-engine', dirs_exist_ok=True)
    print('Staged metric engine:', web / 'metric-engine')

if __name__ == '__main__':
    main()
