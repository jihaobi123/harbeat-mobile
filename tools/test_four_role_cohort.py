import copy,json,pathlib,tempfile,unittest
from four_role_cohort import validate_cohort,summarize,scan_outcome,source_snapshot_unchanged

class FixedCohortTests(unittest.TestCase):
 def manifest(self):
  return dict(pairs=[dict(caseId=f'pair-{i:02}',a='track-'+f'{i:020x}',b='track-'+f'{i+20:020x}',start=20.,bStart=30.)for i in range(1,13)],policy={'denominator':12})
 def test_denominator_is_12_unique_directed_pairs(self):
  validate_cohort(self.manifest())
  m=self.manifest();m['pairs'][1]=copy.deepcopy(m['pairs'][0])
  with self.assertRaises(ValueError):validate_cohort(m)
 def test_failure_and_unfinished_pairs_stay_in_both_denominators(self):
  m=self.manifest();r={'pair-01':dict(c='approved',d='no-compatible-d'),'pair-02':dict(c='base-ineligible',d='base-ineligible')}
  result=summarize(m,r)
  self.assertEqual(sum(result['stages']['c'].values()),12)
  self.assertEqual(sum(result['stages']['d'].values()),12)
  self.assertEqual(result['stages']['c']['not-run'],10)
  self.assertEqual(result['stages']['d']['no-compatible-d'],1)
 def test_pending_voice_is_never_counted_as_approved(self):
  with tempfile.TemporaryDirectory()as tmp:
   p=pathlib.Path(tmp);(p/'approved-c-only.json').write_text(json.dumps([{'approved':False,'qualityStatus':'needs-vocal-review','case':str(p/'abc-1')}]))
   (p/'abc-1').mkdir();(p/'abc-1/scene.json').write_text(json.dumps({'approved':False,'qualityStatus':'needs-vocal-review'}));(p/'scan-results.json').write_text('[]')
   r=scan_outcome(p)
   self.assertEqual(r['c'],'needs-vocal-review');self.assertEqual(r['d'],'no-compatible-d')
 def test_resume_rechecks_role_named_source_snapshot(self):
  with tempfile.TemporaryDirectory()as tmp:
   p=pathlib.Path(tmp)/'drums.wav';p.write_bytes(b'original');s=p.stat()
   snapshot={'tracks':{'id':{'files':{'drums':{'path':str(p),'size':s.st_size,'mtime_ns':s.st_mtime_ns}}}}}
   self.assertTrue(source_snapshot_unchanged(snapshot))
   p.write_bytes(b'changed!')
   self.assertFalse(source_snapshot_unchanged(snapshot))
   self.assertFalse(source_snapshot_unchanged({'tracks':{}}))
 def test_absent_results_and_error_are_distinct_from_music_rejection(self):
  with tempfile.TemporaryDirectory()as tmp:
   r=scan_outcome(pathlib.Path(tmp),returncode=1)
   self.assertEqual(r['c'],'error');self.assertEqual(r['d'],'error')

if __name__=='__main__':unittest.main()
