import hashlib,pathlib,tempfile,unittest
from four_role_cache import VerifiedCache


class CacheTests(unittest.TestCase):
    def test_identical_sources_share_one_verified_object_and_eviction_is_safe(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d);a=p/'a.wav';b=p/'b.wav';c=p/'c.wav';a.write_bytes(b'AAAA');b.write_bytes(b'AAAA');c.write_bytes(b'BBBB')
            cache=VerifiedCache(p/'cache',4);sha=lambda x:hashlib.sha256(x).hexdigest()
            x=cache.stage(a,sha(b'AAAA'));y=cache.stage(b,sha(b'AAAA'))
            self.assertNotEqual(x,a);self.assertEqual(x,y);self.assertEqual(x.read_bytes(),b'AAAA')
            cache.stage(c,sha(b'BBBB'));self.assertFalse(x.exists())
            self.assertEqual(cache.stage(b,sha(b'AAAA')).read_bytes(),b'AAAA')

    def test_mismatched_hash_and_oversized_copy_are_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d);a=p/'a.wav';a.write_bytes(b'AAAA');cache=VerifiedCache(p/'cache',4)
            with self.assertRaises(ValueError):cache.stage(a,'0'*64)
            a.write_bytes(b'12345')
            with self.assertRaises(ValueError):cache.stage(a,hashlib.sha256(b'12345').hexdigest())


if __name__=='__main__':unittest.main()
