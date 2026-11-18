import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from export import cache_current
from test_preprocess import fixture


class ExportCacheTest(unittest.TestCase):
    def test_requires_current_verified_manifest_and_object(self):
        track,_,_=fixture();source=dict(trackId=track['id'],reportId=track['reportId'],manifestSha256='e'*64,**track['provenance'])
        raw=json.dumps({'source':source}).encode();checksum=hashlib.sha256(raw).hexdigest()
        entry=dict(source=source,algorithmSha256='f'*64,profile=dict(sha256=checksum,bytes=len(raw)))
        proof=dict(manifestSha256='e'*64)
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'objects').mkdir();(root/'objects'/(checksum+'.json')).write_bytes(raw)
            self.assertTrue(cache_current(entry,track,proof,root,'f'*64))
            self.assertFalse(cache_current(entry,track,dict(manifestSha256='0'*64),root,'f'*64))
            self.assertFalse(cache_current(entry,track,proof,root,'0'*64))
            (root/'objects'/(checksum+'.json')).write_bytes(raw+b' ')
            self.assertFalse(cache_current(entry,track,proof,root,'f'*64))


if __name__=='__main__':unittest.main()
