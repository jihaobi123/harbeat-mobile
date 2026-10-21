import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from PIL import Image
from activity_sets.service import Store,Settings
from activity_sets.music import MusicBridge
try:
    from activity_sets.music_covers import checked_cover_url,reencode,verified_covers,bind_cover
except ImportError:
    checked_cover_url=reencode=verified_covers=bind_cover=None
class CoverTests(unittest.TestCase):
    def test_reject_nonofficial_private_and_redirect_destinations(self):
        self.assertIsNotNone(checked_cover_url,'safe cover downloader required')
        public=lambda *args,**kwargs:[(2,1,6,'',('1.1.1.1',443))]
        private=lambda *args,**kwargs:[(2,1,6,'',('127.0.0.1',443))]
        for url in ('http://p1.music.126.net/a.jpg','https://example.com/a.jpg','https://user@p1.music.126.net/a.jpg','https://p1.music.126.net:8771/a.jpg','https://127.0.0.1/a.jpg'):
            with self.assertRaises(ValueError):checked_cover_url(url,public)
        with self.assertRaises(ValueError):checked_cover_url('https://p1.music.126.net/a.jpg',private)
        self.assertEqual(checked_cover_url('https://p1.music.126.net/a.jpg',public)[0],'p1.music.126.net')
    def test_reencode_jpeg_and_pixel_limit(self):
        self.assertIsNotNone(reencode,'reencoder required')
        raw=io.BytesIO();Image.new('RGBA',(64,64),(255,0,0,128)).save(raw,format='PNG')
        output=reencode(raw.getvalue());self.assertTrue(output.startswith(b'\xff\xd8'));self.assertNotEqual(raw.getvalue(),output)
        with self.assertRaises(ValueError):reencode(b'x'*(5*1024*1024+1))
        with self.assertRaises(ValueError):reencode(b'not an image')
        huge=io.BytesIO();Image.new('RGB',(5000,5000)).save(huge,format='PNG')
        with self.assertRaises(ValueError):reencode(huge.getvalue())
    def test_redirect_is_revalidated_before_connection(self):
        from unittest.mock import patch
        from activity_sets.music_covers import fetch_cover
        class Socket:
            def close(self):pass
        class Context:
            def wrap_socket(self,*args,**kwargs):return Socket()
        class Response:
            status=302
            def getheader(self,name):return 'https://127.0.0.1/private'
        class Connection:
            _context=Context()
            def __init__(self,*args,**kwargs):pass
            def request(self,*args,**kwargs):pass
            def getresponse(self):return Response()
            def close(self):pass
        with patch('activity_sets.music_covers.socket.getaddrinfo',return_value=[(2,1,6,'',('1.1.1.1',443))]),patch('activity_sets.music_covers.socket.create_connection',return_value=Socket()),patch('activity_sets.music_covers.http.client.HTTPSConnection',Connection):
            with self.assertRaises(ValueError):fetch_cover('https://p1.music.126.net/a.jpg')

    def test_existing_track_fast_path_requires_exact_worker_source_receipt(self):
        from activity_sets import music_covers
        helper=getattr(music_covers,'publication_input_sha',None)
        self.assertIsNotNone(helper,'existing-track fast path needs a source-bound SHA fallback')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);bridge=MusicBridge(Store(Settings(root=root/'sets')));bridge.import_root=root/'imports';bridge.import_root.mkdir()
            (bridge.import_root/'inventory.json').write_text(json.dumps({'items':[{'track_id':'track','input_sha256':'b'*64}]}))
            candidate={'source':'fangpi','id':'123','title':'Music'}
            class Queue:
                def get(self,identifier):return {'status':'ready','track_id':'track','payload':json.dumps({'kind':'download','candidate':candidate})}
            bridge._queue=Queue()
            row={'global_id':'f'*32,'payload':json.dumps({'kind':'download','candidate':dict(candidate)})}
            self.assertEqual(helper(bridge,row,{'trackId':'track'}),'b'*64)
            candidate['id']='456'
            with self.assertRaises(ValueError):helper(bridge,row,{'trackId':'track'})
            candidate['id']='123'
            with self.assertRaises(ValueError):helper(bridge,row,{'trackId':'another-track'})

    def test_wrong_input_or_current_master_never_displays_cover(self):
        self.assertIsNotNone(bind_cover,'source-bound cover association required')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);settings=Settings(root=root/'sets',site=root/'site');settings.site.mkdir();(settings.site/'details').mkdir()
            bridge=MusicBridge(Store(settings));bridge.import_root=root/'imports';bridge.import_root.mkdir()
            detail={'track':{'id':'track','provenance':{'masterSha256':'a'*64}}}
            (settings.site/'details/t.json').write_text(json.dumps(detail));(settings.site/'library.json').write_text(json.dumps({'tracks':[{'id':'track','playStatus':'ready','detailUrl':'details/t.json'}]}))
            (bridge.import_root/'inventory.json').write_text(json.dumps({'items':[{'track_id':'track','input_sha256':'b'*64}]}))
            with self.assertRaises(ValueError):bind_cover(bridge,'track','c'*64,b'jpeg')
            url=bind_cover(bridge,'track','b'*64,b'jpeg');self.assertIn('track',verified_covers(bridge));self.assertTrue(url.endswith('.jpg'))
            detail['track']['provenance']['masterSha256']='d'*64;(settings.site/'details/t.json').write_text(json.dumps(detail))
            self.assertNotIn('track',verified_covers(bridge))
if __name__=='__main__':unittest.main()
