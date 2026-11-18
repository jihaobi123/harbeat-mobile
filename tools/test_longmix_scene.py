"""Tests for the isolated, fail-closed longmix measurement runner."""
import unittest
import pathlib
import tempfile
import subprocess
import longmix_scene as scene

class DecodeTests(unittest.TestCase):
    def test_compressed_seek_matches_warm_continuous_decode(self):
        import numpy as np
        import soundfile as sf
        # A real codec regression: starting MP3 decoding exactly at the wanted
        # boundary loses decoder history; it must be decoded before that point.
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder);sr=44100
            rng=np.random.default_rng(24)
            audio=rng.normal(0,.1,(sr*4,2)).astype('float32')
            sf.write(root/'source.wav',audio,sr,subtype='FLOAT')
            subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(root/'source.wav'),'-c:a','libmp3lame','-b:a','192k',str(root/'source.mp3')],check=True)
            raw=subprocess.check_output(['ffmpeg','-nostdin','-v','error','-i',str(root/'source.mp3'),'-f','f32le','-ac','2','-ar',str(sr),'pipe:1'])
            continuous=np.frombuffer(raw,dtype='<f4').reshape(-1,2)
            start=2.137;n=round(.4*sr)
            actual=scene.decode_source_segment(root/'source.mp3',start,.4)
            np.testing.assert_allclose(actual,continuous[round(start*sr):round(start*sr)+n],atol=2e-5,rtol=0)
            sf.write(root/'exact.flac',audio,sr,subtype='PCM_16')
            expected,_=sf.read(root/'exact.flac',start=round(start*sr),frames=n,dtype='float32',always_2d=True)
            np.testing.assert_array_equal(scene.decode_source_segment(root/'exact.flac',start,.4),expected)

    def test_resampling_seek_preserves_continuous_decoder_phase(self):
        import numpy as np
        import soundfile as sf
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder);sr=48000
            audio=np.random.default_rng(48).normal(0,.1,(sr*4,2)).astype('float32')
            sf.write(root/'source.wav',audio,sr,subtype='FLOAT')
            subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(root/'source.wav'),'-c:a','libmp3lame','-b:a','192k',str(root/'source.mp3')],check=True)
            for suffix in ('wav','mp3'):
                source=root/('source.'+suffix)
                raw=subprocess.check_output(['ffmpeg','-nostdin','-v','error','-i',str(source),'-ar','44100','-ac','2','-f','f32le','pipe:1'])
                continuous=np.frombuffer(raw,dtype='<f4').reshape(-1,2)
                for start in (.05,1.001,2.137):
                    actual=scene.decode_source_segment(source,start,.4);first=round(start*44100)
                    np.testing.assert_allclose(actual,continuous[first:first+round(.4*44100)],atol=2e-5,rtol=0)


class TimelineTests(unittest.TestCase):
    def test_headroom_gain_is_bounded_without_changing_peak_threshold(self):
        self.assertEqual(scene.output_gain({}),.5)
        self.assertEqual(scene.output_gain({'outputGain':.475}),.475)
        for value in (.29,.51,float('nan')):
            with self.assertRaises(ValueError):scene.output_gain({'outputGain':value})
        self.assertEqual(scene.LIMITS['peak'],.95)

    def test_tail_coverage_includes_every_fractional_exit_frame(self):
        d=64*60/111
        frames=scene.coverage_frames(d)
        self.assertGreaterEqual(frames/44100,d+.008)
        self.assertGreaterEqual(frames,round(d*44100)+round(.008*44100))
        self.assertEqual(scene.coverage_frames(64*60/98),round((64*60/98+.008)*44100))

    def test_exactly_two_sources(self):
        with self.assertRaisesRegex(ValueError, 'two distinct'):
            scene.timeline('a', 'a', 94, 94, 10, 5)

    def test_rate_bounds(self):
        with self.assertRaisesRegex(ValueError, 'rate'):
            scene.timeline('a', 'b', 90, 100, 10, 5)

    def test_only_complete_phrase_entry(self):
        self.assertFalse(scene.vocal_safe_entry([[4, 9]], 5))
        self.assertTrue(scene.vocal_safe_entry([[24, 25]], 5))

    def test_nonfinite_evidence_rejected(self):
        metrics = dict(scene.LIMITS, bEntrySafe=True, compatibilityPass=True)
        metrics['peak'] = float('nan')
        with self.assertRaisesRegex(ValueError, 'invalid numerical'):
            scene.approval(metrics)

    def test_scene_and_exits(self):
        value = scene.timeline('a', 'b', 93.9, 95, 125.318, 5.08)
        self.assertAlmostEqual(value['duration'], 64 * 60 / 93.9)
        self.assertEqual([x['bar'] for x in value['exits']], [8, 12, 16])
        for row in value['exits']:
            self.assertAlmostEqual(row['fadeStart'], row['at'] - 240 / 93.9)
            self.assertAlmostEqual(row['bResume'], 5.08 + row['at'] * value['rate'])

    def test_gain_ownership_and_exit(self):
        t = scene.timeline('a', 'b', 94, 94, 10, 5)
        beat = t['beatSeconds']
        for x in [0, beat, 31*beat, 32*beat, 61*beat, t['duration']]:
            g = scene.gains(t, x)
            self.assertEqual(g['a.vocals'], 0)
            self.assertEqual(g['b.vocals'], 1)
            self.assertLessEqual(g['a.bass'] + g['b.bass'], 1.000001)
            self.assertLessEqual(g['a.drums'] + g['b.drums'], 1.000001)
        e = t['exits'][0]
        g = scene.gains(t, e['at'], e)
        for role in ['bass', 'drums', 'other', 'vocals']:
            self.assertEqual(g['a.'+role], 0)
            self.assertEqual(g['b.'+role], 1)

    def test_exit_cancels_future_base_automation(self):
        t = scene.timeline('a', 'b', 94, 94, 10, 5)
        g = scene.gains(t, 31*t['beatSeconds'], t['exits'][0])
        self.assertAlmostEqual(g['a.bass'], .25)
        self.assertAlmostEqual(g['b.bass'], .75)

    def test_drum_bed_separates_pitched_sources(self):
        t = scene.timeline('a', 'b', 98, 95, 137.14, 20.259)
        t['recipe'] = 'drum-bed'
        for i in range(65):
            g = scene.gains(t, i*t['beatSeconds'])
            for role in ('bass', 'other'):
                self.assertEqual(g['a.'+role] * g['b.'+role], 0)
        self.assertEqual(scene.gains(t, 4*t['beatSeconds'])['b.other'], 0)
        self.assertEqual(scene.gains(t, 8*t['beatSeconds'])['b.other'], 1)

    def test_export_refuses_rejected_audio(self):
        with self.assertRaisesRegex(ValueError, 'rejected'):
            scene.export_scene({'approved': False}, 'a'*64, 'b'*64)

    def test_fast_tonal_exit_preserves_vocals_and_curve_evidence(self):
        t = scene.timeline('a', 'b', 98, 98, 137.14, 62.14)
        t['recipe'] = 'drum-bed-fast-tonal-exit'
        self.assertEqual(scene.gains(t, .25)['a.other'], 0)
        self.assertEqual(scene.gains(t, .25)['b.other'], 0)
        self.assertEqual(scene.gains(t, 1.25)['b.bass'], 1)
        knots = scene.gain_knots(t)
        self.assertTrue({.25, 1.25} <= set(knots))
        for exit_point in [None, *t['exits']]:
            points = scene.gain_knots(t, exit_point)
            for x, y in zip(points, points[1:]):
                for fraction in (.1, .5, .9):
                    time = x + (y-x)*fraction
                    actual = scene.gains(t, time, exit_point)
                    left, right = scene.gains(t, x, exit_point), scene.gains(t, y, exit_point)
                    for role in ('bass', 'other', 'drums'):
                        self.assertLessEqual(actual['a.'+role]+actual['b.'+role], 1.000001)
                    for key in actual:
                        self.assertAlmostEqual(actual[key], left[key]+(right[key]-left[key])*fraction)
                        self.assertLessEqual(abs(right[key]-left[key])/(y-x), 4.000001)
                    self.assertEqual(actual['a.vocals'], 0)
                    self.assertEqual(actual['b.vocals'], 1)

    def test_missing_or_bad_evidence_never_approves(self):
        with self.assertRaisesRegex(ValueError, 'missing'):
            scene.approval({})
        values = dict(peak=.5, reconstructionRelativeError=.01, reconstructionLevelDeltaDb=.1, loopBoundaryDb=-40,
                      aVocalDb=-60, melodyClash=.2, bassClash=.1, drumFlamMs=10,
                      beatErrorMs=10, bEntrySafe=True, compatibilityPass=True)
        self.assertTrue(scene.approval(values)['approved'])
        values['peak'] = 1.01
        self.assertFalse(scene.approval(values)['approved'])

if __name__ == '__main__':
    unittest.main()
