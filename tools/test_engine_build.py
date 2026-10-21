import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from engine_build import npm_executable, sha256, source_fingerprints, verify_bundle, verify_metric_source, verify_upstream_source


class EngineBuildTests(unittest.TestCase):
    def test_new_executor_changes_invalidate_source_fingerprint(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            module = root / 'vendor/realtime-v3/src/mobile/local-executor.ts'
            module.parent.mkdir(parents=True)
            module.write_text('export const version = 1')
            before = source_fingerprints(root)
            module.write_text('export const version = 2')
            self.assertNotEqual(before, source_fingerprints(root))
            self.assertIn('vendor/realtime-v3/src/mobile/local-executor.ts', before)

    def test_pinned_clock_rejects_changed_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'public').mkdir()
            clock = root / 'public/v3-clock.js'
            clock.write_bytes(b'clock\n')
            (root / 'metric-upstream.json').write_text(json.dumps({'clockSha256': sha256(clock), 'files': {}}))
            verify_metric_source(root)
            clock.write_bytes(b'clock\r\n')
            with self.assertRaisesRegex(ValueError, 'clock differs'):
                verify_metric_source(root)

    def test_bundle_requires_executable_assets(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'metric-engine.html').touch()
            (root / 'v3-clock.js').touch()
            (root / 'v3-device-clock.js').touch()
            with self.assertRaisesRegex(ValueError, 'JavaScript'):
                verify_bundle(root)
            (root / 'assets').mkdir()
            (root / 'assets/worklet.js').touch()
            verify_bundle(root)

    def test_missing_npm_is_actionable(self):
        with patch('engine_build.shutil.which', return_value=None):
            with self.assertRaisesRegex(RuntimeError, 'Node.js/npm'):
                npm_executable()

    def test_dependency_overlay_cannot_rebind_dsp_or_clock(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'upstream.json').write_text(json.dumps({'files': {}}))
            (root / 'dependency-overlay.json').write_text(json.dumps({'files': {'web/public/v3-clock.js': {}}}))
            with self.assertRaisesRegex(ValueError, 'only package'):
                verify_upstream_source(root)

    def test_dependency_overlay_requires_original_binding_and_current_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            package = root / 'package.json'
            package.write_text('{"dependencies":{}}')
            original = sha256(package)
            (root / 'upstream.json').write_text(json.dumps({'files': {'web/package.json': original}}))
            package.write_text('{"dependencies":{"soundtouch":"2.1.1"}}')
            overlay = {'files': {'web/package.json': {'upstreamSha256': original, 'sha256': sha256(package)}}}
            (root / 'dependency-overlay.json').write_text(json.dumps(overlay))
            verify_upstream_source(root)
            package.write_text('{"dependencies":{"different":"1.0.0"}}')
            with self.assertRaisesRegex(ValueError, 'source changed'):
                verify_upstream_source(root)


if __name__ == '__main__':
    unittest.main()
