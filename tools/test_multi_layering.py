import unittest
from multi_layering import decide,layer_points,projection_gain
class MultiTests(unittest.TestCase):
 def fixture(self):return dict(pairwise={k:dict(beatErrorMs=25,pitchedClash=.2)for k in ['A/C','B/C']},reconstruction=.1,sourceVerified=True,baseUnchanged=True,sourceCount=3,peak=.9,lowEnergyRatio=1.02,addedRmsDb=-30,onsetGrowth=1.1,maximumDrumSources=2,melodyClash=.2,vocalMaxDb=-60,vocalClear=True,beatErrorMs=25,loopSeamDb=-30,exitPeaks=[dict(at=x,peak=.9)for x in [20,30,40]])
 def test_pairwise_pass_does_not_override_aggregate_failure(self):
  self.assertTrue(decide(self.fixture(),3))
  for field,value in [('peak',.96),('lowEnergyRatio',1.2),('onsetGrowth',1.7),('vocalMaxDb',-30),('beatErrorMs',60),('loopSeamDb',-10),('baseUnchanged',False),('sourceCount',4)]:
   e=self.fixture();e[field]=value;self.assertFalse(decide(e,3),field)
 def test_every_extra_curve_enters_and_leaves_with_zero_endpoint(self):
  p=layer_points(60/98,39.183673469387756,.2);self.assertEqual(p[0],[0,0]);self.assertEqual(p[-1],[39.183673469387756,0]);self.assertEqual(max(x[1]for x in p),.2)
  self.assertLessEqual(next(t for t,g in p if t>16*60/98 and g==0),28*60/98)
 def test_voice_projection_cannot_amplify_quiet_vocal_noise_into_a_false_failure(self):
  self.assertEqual(projection_gain(5,1),1);self.assertEqual(projection_gain(-5,1),-1);self.assertEqual(projection_gain(.2,1),.2)
 def test_cd_pair_cannot_hide_behind_passed_aggregate_checks(self):
  e=self.fixture();e['sourceCount']=4
  e['pairwise'].update({k:dict(beatErrorMs=25,pitchedClash=.2)for k in ['A/D','B/D','C/D']})
  self.assertTrue(decide(e,4));e['pairwise']['C/D']['pitchedClash']=.5;self.assertFalse(decide(e,4));del e['pairwise']['C/D'];self.assertFalse(decide(e,4))
if __name__=='__main__':unittest.main()
