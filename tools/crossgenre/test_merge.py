import hashlib,json,tempfile,unittest
from pathlib import Path
from merge import merge
from preprocess import algorithm_sha
class MergeTest(unittest.TestCase):
 def test_merger_rejects_tampered_object_and_duplicate_source_rows(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);part=root/'part';(part/'objects').mkdir(parents=True)
   raw=b'{}';sha=hashlib.sha256(raw).hexdigest();(part/'objects'/(sha+'.json')).write_bytes(raw)
   row={'trackId':'x','profile':{'sha256':sha,'bytes':2},'algorithmSha256':algorithm_sha()}
   (part/'index.json').write_text(json.dumps({'tracks':[row],'excluded':[]}))
   with self.assertRaises(ValueError):merge({'tracks':[{'id':'x'}]},[part],root/'out')
   (part/'objects'/(sha+'.json')).write_bytes(b'xx')
   with self.assertRaises(ValueError):merge({'tracks':[{'id':'x'}]},[part],root/'out')
 def test_valid_partitions_are_merged_with_object_and_source_verification(self):
  from test_preprocess import fixture
  from preprocess import build_profile
  t,m,v=fixture();profile=build_profile(t,m,v,manifest_sha='e'*64,algorithm_sha=algorithm_sha())
  raw=json.dumps(profile).encode();sha=hashlib.sha256(raw).hexdigest()
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);part=root/'part';(part/'objects').mkdir(parents=True);(part/'objects'/(sha+'.json')).write_bytes(raw)
   row={'trackId':t['id'],'source':profile['source'],'profile':{'sha256':sha,'bytes':len(raw)},'algorithmSha256':algorithm_sha(),'entryCount':len(profile['entries']),'exitCount':len(profile['exits']),'echoExitCount':0}
   (part/'index.json').write_text(json.dumps({'tracks':[row],'excluded':[]}))
   self.assertEqual(merge({'tracks':[t]},[part],root/'out')['coverage']['prepared'],1)
   with self.assertRaisesRegex(ValueError,'duplicate'):merge({'tracks':[t]},[part,part],root/'out')
if __name__=='__main__':unittest.main()
