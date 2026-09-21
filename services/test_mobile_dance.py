import copy
import unittest
from mobile_dance import choose, compatible, styles_for, read_track


def song(i, bpm=120, group='Hip-Hop'):
    return dict(id=str(i), bpm=bpm, groups=[group], duration=150,
                bars=[x * 240 / bpm for x in range(70)],
                windows=[dict(start=0, end=8 * 120 / bpm, bars=4)])


class SelectionTests(unittest.TestCase):
    def test_source_labels_beat_conflicting_model(self):
        genre={'extensions': {'genre': {'status': 'ready', 'data': {'top': [{'parent': 'Electronic', 'style': 'House'}]}}}}
        self.assertEqual(styles_for({'source': {'style_labels': ['KPOP']}}, genre), (['K-Pop'], 'catalog'))
        self.assertEqual(styles_for({'source': {'style_labels': ['jazz hiphop', 'boombap']}}, {}), (['Hip-Hop'], 'catalog'))
        self.assertEqual(styles_for({'source': {'style_labels': ['baile funk']}}, {}), (['Baile Funk'], 'catalog'))

    def test_route_uses_unique_style_matches_and_enough_duration(self):
        tracks=[song(i) for i in range(20)]+[song('house',group='House')]
        route=choose(tracks,'Hip-Hop',10,0)
        self.assertGreaterEqual(len(route),6)
        self.assertEqual(len(route),len({t['id'] for t in route}))
        self.assertTrue(all('Hip-Hop' in t['groups'] for t in route))
        self.assertTrue(all(compatible(a,b) for a,b in zip(route,route[1:])))
        self.assertEqual(route,choose(tracks,'Hip-Hop',10,0))
        self.assertNotEqual(route,choose(tracks,'Hip-Hop',10,1))

    def test_insufficient_music_is_not_padded_with_repeats(self):
        with self.assertRaises(ValueError): choose([song(1),song(2)],'Hip-Hop',10,0)
        with self.assertRaises(ValueError): choose([song(i) for i in range(8)],'House',5,0)

    def test_tempo_and_real_grid_are_both_checked(self):
        self.assertFalse(compatible(song(1,60),song(2,170)))
        off=song(1);off['bars']=[i*2.13 for i in range(70)]
        self.assertFalse(compatible(off,song(2)))

    def test_missing_audio_or_timeline_never_becomes_eligible(self):
        with self.assertRaises(ValueError):read_track({'audio':{'catalog_track_id':'track-'+'a'*20},'documents':{}})

if __name__=='__main__':unittest.main()
