import unittest
from loop_extension import decision
class Gate(unittest.TestCase):
 def metrics(self):return dict(reconstruction=.01,reconstructionLevelDeltaDb=0,loopSeamDb=-30,vocalMaxDb=-60,vocalClear=True,beatErrorMs=20,peak=.8,entryPeak=.8,exitPeaks=[{'phaseFrame':216000,'peak':.8},{'phaseFrame':432000,'peak':.8}])
 def test_tail_and_unsafe_phase_remain_rejected(self):
  m=self.metrics();self.assertTrue(decision(m));m['vocalMaxDb']=-42;self.assertFalse(decision(m));m=self.metrics();m['exitPeaks'][1]['peak']=1;self.assertFalse(decision(m));m=self.metrics();m['peak']=float('nan');self.assertFalse(decision(m))
if __name__=='__main__':unittest.main()
