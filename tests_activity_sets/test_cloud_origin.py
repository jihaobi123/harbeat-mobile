"""Deployment origin changes are explicit and shared by local upstream requests."""
import os
import subprocess
import sys
import unittest


class CloudOriginTests(unittest.TestCase):
    def test_default_and_explicit_origin_reach_worker_and_music_bridge(self):
        code = 'from activity_sets.worker import ORIGIN; from activity_sets.music import PUBLIC_ORIGIN; print(ORIGIN); print(PUBLIC_ORIGIN)'
        for configured in (None, 'https://8.136.120.255', 'https://custom.example:8443/'):
            env = os.environ.copy()
            env.pop('LISTEN_PUBLIC_ORIGIN', None)
            if configured is not None:
                env['LISTEN_PUBLIC_ORIGIN'] = configured
            result = subprocess.run([sys.executable, '-c', code], env=env,
                check=True, text=True, capture_output=True)
            expected = (configured or 'https://47.108.118.177').rstrip('/')
            self.assertEqual(result.stdout.splitlines(), [expected, expected])
