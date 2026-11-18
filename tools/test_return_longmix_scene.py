import copy
import unittest
import return_longmix_scene as r

class ReturnTests(unittest.TestCase):
    def scene(self):
        return dict(clips=dict(aStart=40,bStart=20),layers=[dict(side=side,role=role,loop=side=='a',points=[[0,1 if side=='a' or role=='vocals' else 0],[40,0 if side=='a' else 1]]) for side in ('a','b') for role in ('drums','bass','other','vocals') if not(side=='a' and role=='vocals')])
    def test_return_curves_keep_the_prefix_then_exchange_only_in_the_future(self):
        s=self.scene();before=copy.deepcopy(s);e=dict(at=20,fadeStart=17.5)
        layers=r.return_layers(s,e)
        self.assertEqual(s,before)
        for l in layers:
            self.assertEqual(l['points'][-1],[20,float(l['side']=='a')])
            original=next(o for o in s['layers'] if o['side']==l['side'] and o['role']==l['role'])
            self.assertAlmostEqual(r.value_at(l['points'],10),r.value_at(original['points'],10))
        a=next(l for l in layers if l['side']=='a' and l['role']=='bass');b=next(l for l in layers if l['side']=='b' and l['role']=='bass')
        self.assertEqual(r.value_at(b['points'],17.75),0)
        self.assertEqual(r.value_at(a['points'],18.75),1)
    def test_unknown_vocals_cannot_be_treated_as_an_instrumental_gap(self):
        for value in (None,{},[[2,1]],[[1,float('nan')]]):
            with self.assertRaises(ValueError):r.require_intervals(value)
        self.assertEqual(r.require_intervals([]),[])
    def test_measured_tail_is_not_hidden_by_empty_vad_or_average_silence(self):
        import numpy as np
        audio=np.zeros((1000,2),dtype=np.float32);audio[500:510]=.1
        q=r.quiet_window('vocals',[],1,2,lambda *_:audio,1000)
        self.assertTrue(q['intervalsClear']);self.assertGreater(q['maximumFrameDb'],-45)
        with self.assertRaises(ValueError):r.quiet_window('vocals',[],1,2,lambda *_:audio[:-1],1000)
    def test_export_requires_actual_return_measurements_and_a_slip_coordinates(self):
        base=dict(schema='harbeat.live-layering.v1',approved=True,scene=self.scene(),entry=dict(sourcePosition=40),evidence={})
        for data in ({},dict(timeline='slip',exits=[]),dict(timeline='slip',exits=[dict(at=20,aPosition=40)])):
            with self.assertRaises(ValueError):r.export_return(base,data,'c'*64,'jetson')

if __name__=='__main__':unittest.main()
