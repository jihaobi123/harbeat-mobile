import copy
import functools
from http.server import HTTPServer
import json
from pathlib import Path
import re
import tempfile
import threading
import unittest
from urllib.request import Request, urlopen

from dj_projects.serve_preview import AuditionHandler, validate_feedback


class PreviewFeedbackTest(unittest.TestCase):
    def setUp(self):
        self.case = dict(id='a' * 64, lead=4, duration=24, tail=8,
                         sources={'a': {'originalSha256': 'b' * 64}}, reference={'url': 'https://example.com'})
        self.record = dict(schema='harbeat.dj-reference-feedback.v1', caseId=self.case['id'],
                           preference='same', notes='', sources=self.case['sources'],
                           reference=self.case['reference'], updatedAt='2026-11-07T04:00:00Z',
                           coverage={side: dict(intervals=[], seconds=0, fraction=0)
                                     for side in ('original', 'reference')})

    def test_all_page_choices_accept_incomplete_listening(self):
        html = Path(__file__).with_name('preview.html').read_text()
        choices = re.findall(r'name="preference"\s+value="([a-z]+)"', html)
        self.assertEqual(set(choices), {'original', 'reference', 'same', 'neither'})
        for choice in choices:
            self.record['preference'] = choice
            validate_feedback(self.record, self.case)

    def test_rejects_different_source_and_fabricated_coverage(self):
        changed = copy.deepcopy(self.record)
        changed['sources']['a']['originalSha256'] = 'c' * 64
        with self.assertRaises(ValueError):
            validate_feedback(changed, self.case)
        self.record['coverage']['original']['seconds'] = 3
        with self.assertRaises(ValueError):
            validate_feedback(self.record, self.case)

    def test_post_preserves_choice_on_disk(self):
        with tempfile.TemporaryDirectory() as folder:
            handler = functools.partial(AuditionHandler, directory=folder)
            server = HTTPServer(('127.0.0.1', 0), handler)
            server.origin = f'http://127.0.0.1:{server.server_port}'
            server.case = self.case
            server.feedback = Path(folder) / 'feedback.json'
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                request = Request(server.origin + '/feedback',
                                  data=json.dumps(self.record).encode(),
                                  headers={'Origin': server.origin, 'Content-Type': 'application/json'})
                with urlopen(request) as response:
                    self.assertEqual(response.status, 204)
                self.assertEqual(json.loads(server.feedback.read_text()), self.record)
            finally:
                server.shutdown()
                thread.join()
                server.server_close()


if __name__ == '__main__':
    unittest.main()
