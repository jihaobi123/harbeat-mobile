import hashlib,json,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from sources import source_assets
class SourceTest(unittest.TestCase):
 def test_checks_current_master_vocals_report_and_manifest_but_does_not_read_unused_stems(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);nas=root/'nas';reports=root/'reports';reports.mkdir();folder=nas/'published/tracks/track-test/runs/run-1';folder.mkdir(parents=True)
   sha=lambda raw:hashlib.sha256(raw).hexdigest()
   master=folder/'master.wav';vocal=folder/'vocals.wav';master.write_bytes(b'master');vocal.write_bytes(b'vocal');report=b'{}';rid='a'*64;(reports/(rid+'.json')).write_bytes(report)
   p={'runId':'run-1','masterSha256':sha(b'master'),'vocalSha256':sha(b'vocal'),'reportSha256':sha(report)};track={'id':'track-test','reportId':rid,'duration':40,'provenance':p}
   m={'track_id':'track-test','analysis_run_id':'run-1','assets':{'master':{'storage_key':str(master.relative_to(nas)),'sha256':p['masterSha256']},'stems':{'vocals':{'storage_key':str(vocal.relative_to(nas)),'sha256':p['vocalSha256']},'drums':{'storage_key':'not-needed.wav','sha256':'0'*64}}}}
   raw=json.dumps(m).encode();(folder/'manifest.json').write_bytes(raw);(folder/'_SUCCESS.json').write_text(json.dumps({'manifest_sha256':sha(raw)}));info=lambda _:SimpleNamespace(channels=2,duration=40,samplerate=44100)
   paths,proof=source_assets(track,nas,reports,info=info);self.assertEqual(set(paths),{'master','vocals'});self.assertEqual(proof['manifestSha256'],sha(raw))
   vocal.write_bytes(b'tampered')
   with self.assertRaisesRegex(ValueError,'audio fingerprint'):source_assets(track,nas,reports,info=info)
   vocal.write_bytes(b'vocal');(reports/(rid+'.json')).write_bytes(b'changed')
   with self.assertRaisesRegex(ValueError,'manifest or report'):source_assets(track,nas,reports,info=info)
