import json
from http.server import ThreadingHTTPServer
import threading
import unittest
from unittest.mock import patch, MagicMock

import requests
from serve_preview import PreviewHandler


class ProxyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), PreviewHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def test_metadata_proxy_does_not_forward_credentials(self):
        upstream = MagicMock(status_code=200, headers={'Content-Type': 'application/json'})
        upstream.__enter__.return_value = upstream
        upstream.iter_content.return_value = [b'{"tracks":[]}']
        with patch('serve_preview.requests.get', return_value=upstream) as get:
            # Use a separate client; patching requests.get also affects module aliases.
            response = requests.Session().get(self.base + '/listen/library.json',
                headers={'Authorization': 'Bearer local-only', 'Cookie': 'local=only'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(get.call_args.args[0], 'https://8.136.120.255/listen/library.json')
            self.assertEqual(get.call_args.kwargs['headers'], {'Accept-Encoding': 'identity'})

    def test_only_a_bounded_exact_render_request_is_forwarded(self):
        payload = {'from': 'track-a', 'to': 'track-b', 'windowId': 'w1-4', 'start': 30.5}
        upstream = MagicMock(status_code=202, content=b'{"id":"test","status":"queued"}')
        with patch('serve_preview.requests.post', return_value=upstream) as post:
            response = requests.Session().post(self.base + '/listen/smart-api/jobs',
                json=payload, headers={'Origin': self.base, 'Authorization': 'Bearer local-only'})
            self.assertEqual(response.status_code, 202)
            self.assertEqual(post.call_args.kwargs['json'], payload)
            self.assertEqual(post.call_args.kwargs['headers'], {'Origin': 'https://8.136.120.255'})
            self.assertFalse(post.call_args.kwargs['allow_redirects'])

    def test_bad_origin_extra_paths_and_oversized_body_are_not_forwarded(self):
        with patch('serve_preview.requests.post') as post:
            client = requests.Session()
            self.assertEqual(client.post(self.base + '/listen/smart-api/jobs',
                data='{}', headers={'Origin': 'https://untrusted.test'}).status_code, 403)
            self.assertEqual(client.post(self.base + '/listen/smart-api/jobs',
                data='x' * 8193, headers={'Origin': self.base}).status_code, 413)
            self.assertEqual(client.post(self.base + '/api/admin/reset',
                data='{}', headers={'Origin': self.base}).status_code, 404)
            payload = {'from': 'a', 'to': 'b', 'windowId': 'w1', 'start': 3, 'path': '/private'}
            self.assertEqual(client.post(self.base + '/listen/smart-api/jobs',
                data=json.dumps(payload), headers={'Origin': self.base}).status_code, 422)
            post.assert_not_called()

    def test_bad_media_hash_and_private_paths_are_not_forwarded(self):
        with patch('serve_preview.requests.get') as get:
            client = requests.Session()
            for path in ['/listen/media/a.flac?sha256=bad', '/listen/smart-api/private',
                         '/listen/media/a.flac?sha256=' + 'a' * 64 + '&url=https://untrusted.test']:
                self.assertEqual(client.get(self.base + path).status_code, 404)
            get.assert_not_called()


if __name__ == '__main__':
    unittest.main()
