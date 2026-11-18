"""Keep owner-library metadata from choosing arbitrary export paths."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import prepare_scratch_audition as target

class ExportBoundaryTest(unittest.TestCase):
    def test_remote_id_cannot_escape_local_export_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'exports'
            for ident in ['../outside', str(Path(tmp) / 'absolute')]:
                track = {'id': ident, 'title': 'test', 'bpm': 120,
                         'native': {'duration': 30, 'url': '/audio', 'sha256': hashlib.sha256(b'a').hexdigest()},
                         'alignment': {'bars': [{'valid': True, 'start': 0}]}}
                def fetch(path):
                    return json.dumps({'track': track}).encode() if path == 'metadata' else b'a'
                with patch.object(target, 'OUT', output), patch.object(target, 'get', fetch), patch.object(target.subprocess, 'run'):
                    with self.assertRaises(ValueError):
                        target.prepare({'detailUrl': 'metadata'})

if __name__ == '__main__':
    unittest.main()
