import unittest
import numpy as np
from four_role_local_rank import FeatureSeries,local_fit,fit_order


def series(notes,rms=None):
    chroma=np.zeros((len(notes),12))
    for i,note in enumerate(notes):chroma[i,note]=1
    return FeatureSeries(np.arange(len(notes),dtype=float),np.arange(1,len(notes)+1,dtype=float),np.ones(len(notes))*.1 if rms is None else np.array(rms),chroma)


class LocalRankTests(unittest.TestCase):
    def test_same_whole_track_histogram_has_different_local_overlap_fit(self):
        bass=series([0,0,5,5]);good=series([0,0,5,5]);bad=series([5,5,0,0])
        opts=dict(source_start=0,rate=1,output_start=0,output_end=4,gain=1,points=[[0,1],[4,1]],retained={'b.bass':bass},support=[bass],step=1)
        a=local_fit(good,**opts);b=local_fit(bad,**opts)
        self.assertLess(a['pitchedRiskProxy'],b['pitchedRiskProxy']);self.assertEqual(a['coactiveSeconds'],4)

    def test_muted_roles_cannot_disqualify_the_retained_instrument(self):
        bass=series([0]*4);muted=series([6]*4,[0]*4)
        row=local_fit(bass,source_start=0,rate=1,output_start=0,output_end=4,gain=1,points=[[0,1],[4,1]],retained={'b.bass':bass,'a.other':muted},support=[bass],step=1)
        self.assertEqual(row['pitchedRiskProxy'],0);self.assertNotIn('a.other',row['roleRisks'])

    def test_coactivity_uses_actual_support_frames_not_nominal_phrase_intersection(self):
        bass=series([0]*8);c=series([0]*8,[0,0,0,0,.1,.1,.1,.1]);voice=series([0]*4)
        opts=dict(source_start=0,rate=1,gain=1,points=[[0,1],[8,1]],retained={'b.bass':bass},support=[bass,c],step=1)
        early=local_fit(voice,output_start=0,output_end=4,**opts);late=local_fit(voice,output_start=4,output_end=8,**opts)
        self.assertEqual(early['coactiveSeconds'],0);self.assertEqual(late['coactiveSeconds'],4)
        self.assertLess(fit_order(late),fit_order(early));self.assertTrue(late['rankingOnly'])

    def test_one_invalid_phrase_window_does_not_discard_the_other_complete_windows(self):
        from four_role_local_rank import score_windows
        from four_role import vocal_schedule
        rows=[dict(start=1,length=7.85000000001),dict(start=3,length=3)]
        good,bad=score_windows(rows,lambda row:dict(schedule=vocal_schedule(1,row['length'],0,120,9,32)))
        self.assertEqual([r['start'] for r in good],[3])
        self.assertEqual([r['start'] for r in bad],[1])
        self.assertIn('does not fit',bad[0]['reason'])

    def test_local_sort_still_preserves_distinct_complete_phrases_before_alternatives(self):
        from four_role_local_rank import distinct_phrases
        rows=[dict(phraseStart=1,delayBeats=0),dict(phraseStart=1,delayBeats=1),dict(phraseStart=3,delayBeats=0)]
        self.assertEqual([r['phraseStart'] for r in distinct_phrases(rows)],[1,3,1])

if __name__=='__main__':unittest.main()
