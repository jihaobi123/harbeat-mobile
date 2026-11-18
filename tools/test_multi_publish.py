import copy,hashlib,json,pathlib,tempfile,unittest
from publish_multi_layering import publish
import test_multi_layering as generator_tests
H='a'*64
class PublishTests(unittest.TestCase):
 def test_control_changes_cannot_reuse_an_old_passing_measurement(self):
  with tempfile.TemporaryDirectory()as directory:
   root=pathlib.Path(directory);stage=root/'stage';stage.mkdir();(stage/'measurements').mkdir();bases=root/'base';bases.mkdir();target=root/'public';history=root/'history'
   def proof(side):return dict(trackId='track-'+side*20,runId='run',masterSha256=H,reportSha256=H,vocalSha256=H,manifestSha256=H,profileSha256=H,stemSha256={r:H for r in ['drums','bass','other','vocals']})
   proofs={s:proof(s)for s in 'abc'};base=dict(id='b'*64,scene=dict(sources={s:proofs[s]for s in 'ab'}));raw=json.dumps(base).encode();bh=hashlib.sha256(raw).hexdigest();(bases/(bh+'.json')).write_bytes(raw);(bases/'index.json').write_text(json.dumps(dict(scenes=[dict(id=base['id'],sha256=bh)])))
   execution=root/'execution.json';execution.write_text(json.dumps(dict(tracks=[dict(trackId=p['trackId'],assetsReady=True,sourceSha256=p['masterSha256'],reportSha256=H,manifestSha256=H,profile=dict(sha256=H),runId='run',stemSha256=p['stemSha256'])for p in proofs.values()])))
   layers=[dict(source='c',role='drums',sourceStartFrame=44100,points=[[0,0],[1,.2],[20,0]])];m=generator_tests.MultiTests().fixture();m.update(arrangement=dict(base=base,sources=dict(c=proofs['c']),layers=copy.deepcopy(layers)),arrangementSha256=H);raw=json.dumps(m).encode();mh=hashlib.sha256(raw).hexdigest();(stage/'measurements'/(mh+'.json')).write_bytes(raw)
   checks={k:m[k]for k in ['reconstruction','vocalClear','vocalMaxDb','beatErrorMs','loopSeamDb','melodyClash','onsetGrowth','maximumDrumSources']};e={k:m[k]for k in ['peak','lowEnergyRatio','addedRmsDb','exitPeaks','pairwise']};e.update(checks=checks,measurementsSha256=mh,arrangementSha256=H)
   approval=dict(schema='harbeat.multi-layering.v1',producer='jetson',approved=True,mode='additive',base=base,sources=dict(c=proofs['c']),layers=layers,evidence=e)
   def stage_approval(p):
    data=json.dumps(p).encode();h=hashlib.sha256(data).hexdigest();(stage/(h+'.json')).write_bytes(data);(stage/'index.json').write_text(json.dumps(dict(schema='harbeat.multi-layering-index.v1',scenes=[dict(baseId=base['id'],sources=1,sha256=h,url='/listen/multi-layering/v1/'+h+'.json')])))
   stage_approval(approval);self.assertEqual(publish(stage,target,execution,bases,history)['newCount'],1);before=(target/'index.json').read_bytes()
   for mutate in [lambda p:p['layers'][0]['points'][1].__setitem__(1,.25),lambda p:p['layers'][0].__setitem__('sourceStartFrame',88200)]:
    bad=copy.deepcopy(approval);mutate(bad);stage_approval(bad)
    with self.assertRaises(AssertionError):publish(stage,target,execution,bases,history)
    self.assertEqual((target/'index.json').read_bytes(),before)
if __name__=='__main__':unittest.main()
