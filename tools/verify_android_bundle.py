"""Check generated Android audio assets without invoking Gradle or packaging an APK."""
import json
from pathlib import Path

from engine_build import sha256, source_fingerprints, verify_bundle

ROOT = Path(__file__).resolve().parents[1]


def verify(root=ROOT):
    bundle = root / 'android/app/src/main/assets/realtime'
    manifest = json.loads((bundle / 'mobile-build.json').read_text(encoding='utf-8'))
    if manifest.get('schema') != 'harbeat.android-engine-build.v2':
        raise ValueError('Old audio bundle. Run python tools/build_realtime.py --download')
    if manifest.get('sourceFiles') != source_fingerprints(root):
        raise ValueError('Audio source changed after bundling. Run python tools/build_realtime.py')
    for name, expected in manifest['files'].items():
        path = (bundle / name).resolve()
        if not path.is_relative_to(bundle.resolve()) or not path.is_file() or sha256(path) != expected:
            raise ValueError('Missing or damaged bundled audio asset: ' + name)
    verify_bundle(bundle)
    return {'schema': manifest['schema'], 'verifiedFiles': len(manifest['files']),
            'verifiedSources': len(manifest['sourceFiles']), 'apkBuilt': False}


if __name__ == '__main__':
    print(json.dumps(verify(), indent=2))
