import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from dj_projects.prepare_case import measured_grid_error, verified_voice_activity


class ReferenceEvidenceTest(unittest.TestCase):
    def test_vocal_activity_must_match_manifest_and_separated_vocals(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            manifest_file = root / 'manifest.json'
            manifest_file.write_text('{}')
            vocals = root / 'vocals.wav'
            vocals.write_bytes(b'vocal-source')
            manifest = dict(track_id='track-a', analysis_run_id='run-a')
            directory = root / 'published/vocal_activity/track-a/run-a/hash'
            directory.mkdir(parents=True)
            file = directory / 'vocal_activity.json'
            activity = dict(status='ready', unit='ms', has_vocals=False, intervals=[],
                            source=dict(analysis_run_id='run-a',
                                        manifest_sha256=hashlib.sha256(manifest_file.read_bytes()).hexdigest(),
                                        vocal_sha256=hashlib.sha256(vocals.read_bytes()).hexdigest()))
            file.write_text(json.dumps(activity))
            success = file.with_name('_SUCCESS.json')
            success.write_text(json.dumps(dict(vocal_activity_sha256=hashlib.sha256(file.read_bytes()).hexdigest())))
            actual, _ = verified_voice_activity(root, manifest, manifest_file, {'vocals': vocals})
            self.assertEqual(actual['intervals'], [])
            vocals.write_bytes(b'another-vocal-source')
            with self.assertRaisesRegex(ValueError, 'not bound'):
                verified_voice_activity(root, manifest, manifest_file, {'vocals': vocals})

    def test_measured_grid_drift_is_retained_for_the_unchanged_gate(self):
        beat = 60 / 124
        aligned = dict(analysis=dict(beat_grid=dict(beats_ms=[i * beat * 1000 for i in range(10)])))
        self.assertLess(measured_grid_error(aligned, 0, 1, 10 * beat), 1e-6)
        drifted = dict(analysis=dict(beat_grid=dict(beats_ms=[i * beat * 1000 + 100 for i in range(10)])))
        self.assertGreater(measured_grid_error(drifted, 0, 1, 10 * beat), 50)


if __name__ == '__main__':
    unittest.main()
