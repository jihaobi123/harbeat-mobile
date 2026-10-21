"""Shared, platform-neutral checks for the bundled audio engine."""
import hashlib
import json
from pathlib import Path
import shutil


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def npm_executable():
    command = shutil.which('npm.cmd') or shutil.which('npm')
    if not command:
        raise RuntimeError('Node.js/npm is missing from PATH. Install Node.js 22 LTS, then reopen the terminal.')
    return command


def verify_metric_source(source):
    manifest = json.loads((source / 'metric-upstream.json').read_text(encoding='utf-8'))
    if sha256(source / 'public/v3-clock.js') != manifest['clockSha256']:
        raise ValueError('Metric audio clock differs')
    for path, expected in manifest['files'].items():
        if sha256(source / 'src/metric-upstream' / path.removeprefix('web/src/')) != expected:
            raise ValueError('Metric source differs: ' + path)
    return manifest


def verify_upstream_source(source):
    """Retain upstream DSP pins while recording explicit build dependency changes."""
    manifest = json.loads((source / 'upstream.json').read_text(encoding='utf-8'))
    overlay_path = source / 'dependency-overlay.json'
    overlay = json.loads(overlay_path.read_text(encoding='utf-8')) if overlay_path.is_file() else {'files': {}}
    changes = overlay.get('files', {})
    if not set(changes).issubset({'web/package.json', 'web/package-lock.json'}):
        raise ValueError('Dependency overlay may change only package.json and package-lock.json')
    for path, original in manifest['files'].items():
        expected = original
        if path in changes:
            if changes[path].get('upstreamSha256') != original:
                raise ValueError('Dependency overlay upstream binding differs: ' + path)
            expected = changes[path].get('sha256')
        if sha256(source / path.removeprefix('web/')) != expected:
            raise ValueError('Upstream source changed: ' + path)
    return manifest


def source_fingerprints(root):
    """Bind generated assets to inputs, including new non-pinned executors."""
    source = root / 'vendor/realtime-v3'
    paths = list((source / 'src').rglob('*'))
    paths += [source / name for name in (
        'package.json', 'package-lock.json', 'tsconfig.json', 'upstream.json',
        'dependency-overlay.json', 'metric-upstream.json', 'continuous-source.json', 'public/catalog.json',
        'engine.html', 'mobile.html', 'metric-engine.html',
        'vite.mobile.config.ts', 'vite.metric-mobile.config.ts', 'public/v3-clock.js')]
    paths += [root / 'tools' / name for name in ('build_realtime.py', 'engine_build.py', 'prepare_continuous.py')]
    return {path.relative_to(root).as_posix(): sha256(path)
            for path in sorted(set(paths)) if path.is_file()}


def verify_bundle(directory):
    for required in ('metric-engine.html', 'v3-clock.js'):
        if not (directory / required).is_file():
            raise ValueError('Missing built audio engine asset: ' + required)
    if not any((directory / 'assets').glob('*.js')):
        raise ValueError('The built audio engine has no JavaScript assets')


def stage_notices(source, destination):
    package = source / 'node_modules/@soundtouchjs/core'
    metadata = json.loads((package / 'package.json').read_text(encoding='utf-8'))
    if metadata.get('version') != '2.1.1' or metadata.get('license') != 'MPL-2.0':
        raise ValueError('SoundTouch dependency version/license differs from the reviewed build')
    notices = destination / 'third-party'
    notices.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(package / 'LICENSE', notices / 'soundtouch-core-LICENSE.txt')
    (notices / 'NOTICE.txt').write_text(
        '@soundtouchjs/core 2.1.1\nCopyright its contributors. MPL-2.0.\n'
        'The bundled JavaScript contains the unmodified npm package.\n'
        'Source and package: https://www.npmjs.com/package/@soundtouchjs/core/v/2.1.1\n'
        'Project: https://github.com/cutterbl/SoundTouchJS\n'
        'License: https://www.mozilla.org/MPL/2.0/\n', encoding='utf-8')
