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

    def test_jetson_data_plans_use_their_own_bounded_endpoint(self):
        payload = {'from': 'track-a', 'to': 'track-b', 'windowId': 'w1-4', 'start': 30.5}
        upstream = MagicMock(status_code=202, content=b'{"id":"test","status":"queued"}')
        with patch('serve_preview.requests.post', return_value=upstream) as post:
            response = requests.Session().post(self.base + '/listen/smart-api/plans',
                json=payload, headers={'Origin': self.base, 'Cookie': 'private=ignore'})
            self.assertEqual(response.status_code, 202)
            self.assertEqual(post.call_args.args[0], 'https://8.136.120.255/listen/smart-api/plans')
            self.assertEqual(post.call_args.kwargs['json'], payload)
            self.assertEqual(post.call_args.kwargs['headers'], {'Origin': 'https://8.136.120.255'})
        upstream = MagicMock(status_code=200, headers={'Content-Type': 'application/json'})
        upstream.__enter__.return_value = upstream
        upstream.iter_content.return_value = [b'{"status":"working"}']
        with patch('serve_preview.requests.get', return_value=upstream) as get:
            path = '/listen/smart-api/plans/' + 'a' * 64
            self.assertEqual(requests.Session().get(self.base + path).status_code, 200)
            self.assertEqual(get.call_args.args[0], 'https://8.136.120.255' + path)

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

    def test_reservations_forward_only_workspace_bearer_on_exact_paths(self):
        upstream = MagicMock(status_code=200, content=b'{"reservations":[]}', headers={})
        with patch('serve_preview.requests.request', return_value=upstream) as request:
            client=requests.Session()
            token='a'*43
            response=client.get(self.base+'/listen/set-api/reservations',headers={'Authorization':'Bearer '+token,'Cookie':'private=ignore'})
            self.assertEqual(response.status_code,200)
            self.assertEqual(request.call_args.kwargs['headers'],{'Authorization':'Bearer '+token,'Origin':'https://8.136.120.255','Content-Type':'application/json','Accept':'application/json'})
            self.assertEqual(client.get(self.base+'/listen/set-api/reservations?url=x').status_code,404)
            self.assertEqual(client.post(self.base+'/listen/set-api/workspaces',json={},headers={'Origin':'https://bad.test'}).status_code,403)
            self.assertEqual(request.call_count,1)

    def test_music_search_query_is_bounded_and_only_private_music_api_gets_bearer(self):
        upstream=MagicMock(status_code=200,content=b'{"results":[]}',headers={})
        with patch('serve_preview.requests.request',return_value=upstream) as call:
            client=requests.Session()
            self.assertEqual(client.get(self.base+'/listen/set-api/music/search',params={'q':'95 bpm hiphop','scope':'library'},headers={'Authorization':'Bearer '+'a'*43}).status_code,200)
            self.assertIn('q=95+bpm+hiphop',call.call_args.args[1])
            for extra in ['q=x&url=http://private','q=x&q=y','q=x&scope=admin']:
                self.assertEqual(client.get(self.base+'/listen/set-api/music/search?'+extra).status_code,404)
            self.assertEqual(call.call_count,1)

    def test_music_upload_forwards_only_bounded_multipart_not_an_admin_route(self):
        upstream=MagicMock(status_code=200,content=b'{"status":"queued"}',headers={})
        with patch('serve_preview.requests.request',return_value=upstream) as call:
            def inspect(*args,**kwargs):
                self.assertIn('multipart/form-data',kwargs['headers']['Content-Type'])
                self.assertIn(b'small audio',kwargs['data'].read())
                return upstream
            call.side_effect=inspect
            response=requests.Session().post(self.base+'/listen/set-api/music/upload',files={'audio':('clip.mp3',b'small audio')},headers={'Origin':self.base,'Authorization':'Bearer '+'a'*43})
            self.assertEqual(response.status_code,200)
            self.assertEqual(call.call_count,1)

    def test_bad_media_hash_and_private_paths_are_not_forwarded(self):
        with patch('serve_preview.requests.get') as get:
            client = requests.Session()
            for path in ['/listen/media/a.flac?sha256=bad', '/listen/smart-api/private',
                         '/listen/media/a.flac?sha256=' + 'a' * 64 + '&url=https://untrusted.test']:
                self.assertEqual(client.get(self.base + path).status_code, 404)
            get.assert_not_called()

    def test_execution_assets_are_read_only_hash_bound_and_public(self):
        upstream=MagicMock(status_code=200,headers={'Content-Type':'audio/flac'})
        upstream.__enter__.return_value=upstream
        upstream.iter_content.return_value=[b'fixture']
        sha='a'*64
        with patch('serve_preview.requests.get',return_value=upstream) as get:
            client=requests.Session()
            for path in ['/listen/execution/index.json','/listen/execution/tracks/track-a.json',f'/listen/execution-media/{sha}.flac?sha256={sha}',f'/listen/execution/profiles/{sha}.json?sha256={sha}']:
                self.assertEqual(client.get(self.base+path,headers={'Authorization':'Bearer private'}).status_code,200,path)
                self.assertNotIn('Authorization',get.call_args.kwargs['headers'])
            calls=get.call_count
            for path in [f'/listen/execution-media/{sha}.flac?sha256='+('b'*64),'/listen/execution/tracks/..%2Fprivate.json','/listen/execution/credentials.json']:
                self.assertEqual(client.get(self.base+path).status_code,404,path)
            self.assertEqual(get.call_count,calls)

    def test_dart_multipart_boundary_with_plus_and_dot_is_forwarded(self):
        boundary='dart-http-boundary-abc+DEF.123_-'
        body=('--'+boundary+'\r\nContent-Disposition: form-data; name="audio"; filename="clip.mp3"\r\n\r\nsmall audio\r\n--'+boundary+'--\r\n').encode()
        upstream=MagicMock(status_code=200,content=b'{"status":"queued"}',headers={})
        with patch('serve_preview.requests.request',return_value=upstream) as call:
            def inspect(*args,**kwargs):
                self.assertEqual(kwargs['data'].read(),body)
                return upstream
            call.side_effect=inspect
            response=requests.Session().post(self.base+'/listen/set-api/music/upload',data=body,headers={'Origin':self.base,'Authorization':'Bearer '+'a'*43,'Content-Type':'multipart/form-data; boundary='+boundary})
            self.assertEqual(response.status_code,200)
            self.assertEqual(call.call_count,1)


if __name__ == '__main__':
    unittest.main()
