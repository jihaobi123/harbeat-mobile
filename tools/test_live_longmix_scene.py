import copy
import unittest
import live_longmix_scene as live

class LiveBoundaryTests(unittest.TestCase):
    def scene(self):
        return dict(schema='harbeat.two-source-scene.v1', scope='audition-only', approved=True,
                    producer='jetson', rate=1, id='a'*64, clips=dict(aStart=40),
                    exits=[dict(at=20,bPosition=40),dict(at=30,bPosition=50)])

    def metrics(self):
        return dict(sourceVerified=True, entryPeak=.7,
                    exitPeaks=[dict(at=20,bPosition=40,peak=.8),dict(at=30,bPosition=50,peak=.82)])

    def test_never_promotes_a_rejected_or_stretched_audition(self):
        for key,value in [('approved',False),('rate',1.01)]:
            scene=self.scene();scene[key]=value
            with self.assertRaises(ValueError):live.export_live(scene,'b'*64,self.metrics(),'c'*64,'jetson')

    def test_requires_new_actual_live_boundary_measurements(self):
        for metrics in [{},dict(sourceVerified=False,entryPeak=.7,exitPeaks=[])]:
            with self.assertRaises(ValueError):live.export_live(self.scene(),'b'*64,metrics,'c'*64,'jetson')
        metrics=self.metrics();metrics['entryPeak']=float('nan')
        with self.assertRaises(ValueError):live.export_live(self.scene(),'b'*64,metrics,'c'*64,'jetson')

    def test_all_exits_match_exact_source_offsets_and_peak_limit(self):
        for change in [lambda x:x['exitPeaks'].pop(), lambda x:x['exitPeaks'][0].update(bPosition=41), lambda x:x['exitPeaks'][0].update(peak=.951)]:
            metrics=self.metrics();change(metrics)
            with self.assertRaises(ValueError):live.export_live(self.scene(),'b'*64,metrics,'c'*64,'jetson')

    def test_export_is_distinct_and_keeps_original_scene_immutable(self):
        scene=self.scene();original=copy.deepcopy(scene)
        value=live.export_live(scene,'b'*64,self.metrics(),'c'*64,'jetson')
        self.assertEqual(scene,original);self.assertEqual(value['schema'],'harbeat.live-layering.v1')
        self.assertEqual(value['entry']['sourcePosition'],40);self.assertEqual(value['nativeGain'],.76)

if __name__=='__main__':unittest.main()
