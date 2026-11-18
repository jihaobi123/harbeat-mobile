import unittest
from four_role_vocal_candidates import rank_vocal_windows


class VocalCandidateTests(unittest.TestCase):
    def rank(self, phrases, starts, rms, **changes):
        opts=dict(rate=1,bpm=120,left=2,right=6,exit_fade=9,duration=30,
                  bed_intervals=[],bed_source_start=20,rms_db=rms)
        return rank_vocal_windows(phrases,starts,**{**opts,**changes})

    def test_prefers_quiet_complete_phrase_and_keeps_different_phrases(self):
        def rms(lo,hi):
            return -64 if lo>=11 and hi<15 else -24
        rows=self.rank([(2.25,4.5),(12.25,14.5)],[1.5,2,11.5,12],rms)
        self.assertEqual(rows[0]['phraseStart'],12.25)
        self.assertEqual(rows[1]['phraseStart'],2.25)
        self.assertLessEqual(rows[0]['rawBoundaryDb'],-45)

    def test_moves_by_whole_beats_to_an_available_b_gap(self):
        rows=self.rank([(2.25,4.5)],[2],lambda *_:-72,bed_intervals=[(21,23.41)])
        self.assertTrue(rows)
        self.assertEqual(rows[0]['delayBeats'],3)
        self.assertEqual(rows[0]['outputStart'],3.5)
        self.assertTrue(all(x['outputStart']>=3.5 for x in rows))

    def test_can_include_natural_decay_after_old_tail_cap_without_next_phrase(self):
        def rms(lo,hi):
            return -32 if 4.5<=lo and hi<5.4 else -60
        rows=self.rank([(2.3,4.5),(5.7,8.2)],[2],rms)
        self.assertGreaterEqual(rows[0]['end'],5.4)
        self.assertLessEqual(rows[0]['end'],5.7-.12)
        self.assertGreaterEqual(rows[0]['end']-4.5,.22)

    def test_no_fit_never_proposes_truncated_phrase(self):
        rows=self.rank([(2.3,8)],[2],lambda *_:-72,exit_fade=6)
        self.assertEqual(rows,[])

if __name__=='__main__':unittest.main()
