import copy
import unittest
import numpy as np
from preprocess import build_profile, measure_frames, binding_for


def fixture():
    p = dict(masterSha256='a'*64, reportSha256='b'*64, vocalSha256='c'*64, runId='run-1')
    source = dict(reportId='d'*64, **{k:p[k] for k in ('masterSha256','reportSha256','vocalSha256')})
    bars = [dict(index=i, start=i*2., end=(i+1)*2., beats=[i*2.+j*.5 for j in range(4)], valid=True) for i in range(20)]
    track = dict(id='track-test', reportId='d'*64, provenance=p, duration=40., bpm=120.,
                 vocals=[], sections=[dict(start=0., end=16., label='intro'),dict(start=16., end=40., label='verse')],
                 alignment=dict(source=source, bars=bars))
    master = measure_frames(np.full((4000,2), .1), 100)
    vocal = measure_frames(np.zeros((4000,2)), 100)
    return track, master, vocal


class PreprocessingTest(unittest.TestCase):
    def profile(self, track=None, master=None, vocal=None):
        t,m,v = fixture()
        return build_profile(track or t, m if master is None else master, v if vocal is None else vocal,
                             manifest_sha='e'*64, algorithm_sha='f'*64)

    def test_native_structural_candidates_keep_unknown_semantics(self):
        result = self.profile()
        self.assertEqual(result['schema'], 'harbeat.crossgenre-track.v1')
        self.assertEqual(result['source']['masterSha256'], 'a'*64)
        self.assertTrue(any(x['time']==16. for x in result['exits']))
        self.assertTrue(any(x['time']==16. for x in result['entries']))
        self.assertEqual(result['analysis']['semanticPhraseStatus'], 'unverified')
        self.assertFalse(any(x['echoEligible'] for x in result['exits']))

    def test_rejects_cut_inside_vocal_and_midword_entry(self):
        track,_,_ = fixture(); track['vocals']=[[15.7,16.4]]
        result=self.profile(track)
        self.assertFalse(any(x['time']==16. for x in result['exits']))
        self.assertFalse(any(x['time']==16. for x in result['entries']))

    def test_measured_voice_overrides_empty_vad(self):
        _,_,v=fixture()
        for frame in v:
            if 15.7<=frame['start']<16.3:frame.update(rms=.05,peak=.1)
        result=self.profile(vocal=v)
        self.assertFalse(any(x['time']==16. for x in result['exits']))

    def test_unknown_vocals_and_incomplete_measurements_are_not_silence(self):
        track,master,vocal=fixture();track['vocals']=None
        with self.assertRaisesRegex(ValueError,'vocal'):self.profile(track)
        with self.assertRaisesRegex(ValueError,'coverage'):self.profile(master=master[:-2])
        broken=copy.deepcopy(vocal);broken[10]['start']+=.01
        with self.assertRaisesRegex(ValueError,'coverage'):self.profile(vocal=broken)

    def test_stale_identity_and_incomplete_bars_fail_closed(self):
        track,_,_=fixture();track['alignment']['source']['masterSha256']='0'*64
        with self.assertRaisesRegex(ValueError,'binding'):self.profile(track)
        track,_,_=fixture();track['alignment']['bars'][8]['valid']=False
        result=self.profile(track)
        self.assertFalse(any(x['time']==16. for x in result['entries']))

    def test_requires_real_section_boundary_and_audible_incoming(self):
        result=self.profile()
        self.assertFalse(any(x['time']==10. for x in result['entries']))
        _,m,_=fixture()
        for frame in m:frame.update(rms=0.,peak=0.)
        self.assertEqual(self.profile(master=m)['entries'],[])

    def test_echo_capture_has_audible_voice_then_protected_gap(self):
        track,_,v=fixture();track['vocals']=[[14.9,15.65]]
        for frame in v:
            if 14.9<=frame['start']<15.65:frame.update(rms=.04,peak=.15)
        exit=next(x for x in self.profile(track,vocal=v)['exits'] if x['time']==16.)
        self.assertTrue(exit['echoEligible'])
        self.assertLessEqual(exit['capture']['end'],15.8)
        self.assertGreater(exit['capture']['rms'],0.)

    def test_invalid_audio_is_rejected(self):
        with self.assertRaises(ValueError):measure_frames(np.array([[np.nan,np.nan]]),100)
        with self.assertRaises(ValueError):measure_frames(np.zeros((200,1)),100)


if __name__=='__main__':unittest.main()
