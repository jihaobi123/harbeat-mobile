"""Build the same metric audio engine used in Android, then stage web assets.

Run after flutter build web. Does not bundle or download source music.
"""
import argparse
from pathlib import Path
import shutil
import subprocess
from engine_build import npm_executable, stage_notices, verify_bundle, verify_metric_source

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='build/web', help='Existing Flutter web output, relative to the repository or absolute')
    args = parser.parse_args()
    source = ROOT / 'vendor/realtime-v3'
    verify_metric_source(source)
    npm = npm_executable()
    subprocess.run([npm, 'exec', '--', 'tsc', '--noEmit'], cwd=source, check=True)
    subprocess.run([npm, 'exec', '--', 'vite', 'build', '--config', 'vite.metric-mobile.config.ts'], cwd=source, check=True)
    stage_notices(source, source / 'dist-metric-mobile')
    verify_bundle(source / 'dist-metric-mobile')
    web = ROOT / args.output
    if not (web / 'index.html').is_file():
        raise ValueError('Build Flutter web first')
    # Replace only generated engine output; stale chunks must not enter releases.
    destination = web / 'metric-engine'
    if destination.exists():
        shutil.rmtree(destination)
    shutil.copytree(source / 'dist-metric-mobile', destination)
    print('Staged metric engine:', web / 'metric-engine')

if __name__ == '__main__':
    main()
