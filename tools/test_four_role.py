import copy
import unittest
from four_role import validate_steps, approve, projected_rms, reviewable, vocal_schedule, coactivity_seconds, target_rate, source_grid_error, ScanBudget


class FourRoleTests(unittest.TestCase):
    def test_target_tempo_is_bound_to_scene_not_legacy_98(self):
        for bpm in (90, 98, 110):
            self.assertEqual(target_rate(bpm, bpm), 1.)
            self.assertAlmostEqual(target_rate(bpm, bpm / 1.03), 1.03)
            self.assertFalse(.95 <= target_rate(bpm, bpm / 1.06) <= 1.05)
        for target, source in [(float('nan'),90), (90,float('inf')), (0,90), (90,-1), (True,90)]:
            with self.assertRaises(ValueError): target_rate(target, source)

    def test_measured_grid_must_match_the_requested_output_clock(self):
        for bpm in (90,98,110):
            track={'bpm':bpm,'alignment':{'bars':[{'beats':[i*60/bpm for i in range(25)]}]}}
            self.assertAlmostEqual(source_grid_error(track,0,16*60/bpm,1,bpm),0)
            if bpm!=98:
                with self.assertRaises(ValueError): source_grid_error(track,0,16*60/bpm,98/bpm,bpm)
        track={'bpm':90,'alignment':{'bars':[{'beats':[.06+i*60/90 for i in range(25)]}]}}
        self.assertGreater(source_grid_error(track,0,16*60/90,1,90),50)

    def test_candidate_budget_is_bounded_and_retains_truncation_counts(self):
        b=ScanBudget(max_c_tracks=4,max_c_windows=2,max_d_tracks=4,max_d_windows=2,max_c_checks=8,max_d_checks=8)
        for i in range(4): self.assertTrue(b.take('c','track',str(i)))
        self.assertFalse(b.take('c','track','5'))
        self.assertTrue(b.take('c','window','0'));self.assertTrue(b.take('c','window','0'))
        self.assertFalse(b.take('c','window','0'))
        for i in range(8): self.assertTrue(b.take('d','check'))
        self.assertFalse(b.take('d','check'))
        state=b.snapshot();self.assertEqual(state['consumed']['cTracks'],4)
        self.assertEqual(state['truncated']['cTracks'],1);self.assertEqual(state['truncated']['cWindows'],1)
        self.assertEqual(state['truncated']['dChecks'],1)
        with self.assertRaises(ValueError): ScanBudget(max_c_tracks=0)

    def test_cli_candidate_budgets_and_required_profile_target(self):
        import contextlib,io
        from four_role_scan import argument_parser
        from four_role_profiles import argument_parser as profile_parser
        scan=argument_parser().parse_args([v for k in ['metadata','base','output','stretch','measure','execution'] for v in ['--'+k,'test']])
        self.assertEqual({k:getattr(scan,k) for k in ScanBudget.DEFAULTS},ScanBudget.DEFAULTS)
        args=[v for k in ['base','metadata','output','nas','reports'] for v in ['--'+k,'test']]
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):profile_parser().parse_args(args)
        self.assertEqual(profile_parser().parse_args(args+['--target-bpm','90']).target_bpm,90)

    def test_profile_generation_uses_explicit_target_for_actual_source_filtering(self):
        import json,pathlib,tempfile,types,sys
        from unittest.mock import patch
        from four_role_profiles import run
        for bpm in (90,110):
            exported=[]
            def export(track,*args,**kwargs):
                exported.append(track['id'])
                return dict(trackId=track['id'],profile={'sha256':'a'*64},assetsReady=False)
            fake=types.ModuleType('analysis_platform.device_export');fake.export_track=export
            with tempfile.TemporaryDirectory(prefix='four-role-profile-tempo-') as d,patch.dict(sys.modules,{'analysis_platform.device_export':fake}):
                root=pathlib.Path(d);base=root/'base';meta=root/'metadata';base.mkdir();meta.mkdir()
                (base/'index.json').write_text(json.dumps({'schema':'harbeat.execution-library.v1','tracks':[]}))
                for name,source in [('same',bpm),('far',bpm/1.06)]:
                    (meta/(name+'-detail.json')).write_text(json.dumps({'id':name,'title':name,'bpm':source}))
                run(types.SimpleNamespace(target_bpm=bpm,base=base,metadata=meta,output=root/'output',nas=root,reports=root))
                self.assertEqual(exported,['same'])
                index=json.loads((root/'output/index.json').read_text());self.assertEqual(index['targetBpm'],bpm)
                self.assertEqual([r['trackId'] for r in index['tracks']],['same'])

    def steps(self):
        first = {role: [{'source': source, 'points': [[0, .5], [40, .5]]}]
                 for role, source in [('drums', 'a'), ('bass', 'b'), ('other', 'b'), ('vocals', 'b')]}
        second = copy.deepcopy(first)
        second['other'] = [{'source': 'c', 'points': [[0, .5], [40, .5]]}]
        third = copy.deepcopy(second)
        third['vocals'] = [{'source': 'd', 'points': [[0, .5], [40, .5]]}]
        return [first, second, third]

    def evidence(self):
        return dict(sourceVerified=True, peak=.8, reconstruction=.1, beatErrorMs=20,
                    loopSeamDb=-30, vocalMaxDb=-60, vocalBoundariesClear=True,
                    originalVocalPreserved=True, lowEnergyRatio=1.02, onsetGrowth=1.,
                    simultaneousFourRoleSeconds=2.,
                    pairwise={p: dict(pass_=True, pitchedRisk=.2, incompatiblePitchedSeconds=0.)
                              for p in ['A/B', 'A/C', 'A/D', 'B/C', 'B/D', 'C/D']},
                    exitPeaks=[.8, .8, .8], bpm=98)

    def test_each_step_changes_only_one_role(self):
        self.assertEqual(validate_steps(self.steps()), ['other', 'vocals'])
        self.assertEqual(validate_steps(self.steps()[:2]), ['other'])
        steps = self.steps(); steps[1]['bass'][0]['source'] = 'c'
        with self.assertRaises(ValueError): validate_steps(steps)

    def test_c_replacement_keeps_b_vocal_automation_complete(self):
        from four_role import replace_accompaniment
        layers=[dict(key='a.drums',source='a',role='drums',points=[[0,1],[40,0]]),
                dict(key='b.bass',source='b',role='bass',points=[[0,0],[40,1]]),
                dict(key='b.other',source='b',role='other',points=[[0,0],[10,.25],[20,.5],[40,1]]),
                dict(key='b.vocals',source='b',role='vocals',points=[[0,1],[40,1]])]
        original=copy.deepcopy(layers)
        cross=[[0,0],[8,0],[9,1],[13,1],[14,0],[40,0]]
        extra=dict(key='c.other',source='c',role='other',points=cross)
        replaced=replace_accompaniment(layers,extra,cross)
        self.assertEqual(layers,original)
        for role in ('drums','bass','vocals'):
            self.assertEqual([l for l in replaced if l['role']==role],[l for l in original if l['role']==role])
        self.assertNotEqual([l for l in replaced if l['role']=='other'],[l for l in original if l['role']=='other'])
        self.assertEqual(next(l for l in replaced if l['key']=='b.vocals')['points'],[[0,1],[40,1]])
        roles=('drums','bass','other','vocals')
        self.assertEqual(validate_steps([{r:[l for l in stage if l['role']==r] for r in roles} for stage in (original,replaced)]),['other'])

    def test_d_still_requires_original_vocal_gap_at_its_complete_actual_window(self):
        from four_role import original_vocal_gap
        # C can retain this B phrase; D may not remove it or its guarded tail.
        intervals=[[109,112]]
        self.assertFalse(original_vocal_gap(intervals,100,8,13))
        self.assertFalse(original_vocal_gap([[107.8,108.01]],100,8,13))
        self.assertFalse(original_vocal_gap([[113.02,113.2]],100,8,13))
        self.assertTrue(original_vocal_gap(intervals,100,3,5))
        self.assertTrue(original_vocal_gap([[113.081,114]],100,8,13))
        with self.assertRaises(ValueError):original_vocal_gap(intervals,100,13,8)

    def test_all_six_pairs_and_original_limits_are_required(self):
        self.assertTrue(approve(self.evidence(), 4))
        for field, value in [('peak', .96), ('reconstruction', .26), ('beatErrorMs', 51),
                             ('loopSeamDb', -19), ('vocalMaxDb', -44),
                             ('vocalBoundariesClear', False), ('originalVocalPreserved', False),
                             ('lowEnergyRatio', 1.11), ('onsetGrowth', 1.36)]:
            e = self.evidence(); e[field] = value
            self.assertFalse(approve(e, 4), field)
        e = self.evidence(); del e['pairwise']['C/D']
        self.assertFalse(approve(e, 4))
        e = self.evidence(); e['pairwise']['C/D']['incompatiblePitchedSeconds'] = 1
        self.assertFalse(approve(e, 4))
        e = self.evidence(); e['simultaneousFourRoleSeconds'] = 0.
        self.assertFalse(approve(e, 4))

    def test_nonfinite_evidence_and_late_exit_failure_rejected(self):
        e = self.evidence(); e['exitPeaks'][2] = .96
        self.assertFalse(approve(e, 4))

    def test_louder_coherent_vocal_leakage_is_not_clipped_to_reference_level(self):
        self.assertGreater(projected_rms(40e-6,4e-6,4),10**(-45/20))
        self.assertEqual(projected_rms(0,0,4),0)

    def test_pending_voice_review_never_becomes_strict_approval(self):
        e=self.evidence();e['vocalMaxDb']=-20
        self.assertFalse(approve(e,4));self.assertTrue(reviewable(e,4))
        e['peak']=.96;self.assertFalse(reviewable(e,4))

    def test_vocal_can_finish_after_melody_return_without_losing_its_tail(self):
        beat=60/98;v=vocal_schedule(12*beat,4.629551,2,98,28*beat,64*beat)
        self.assertGreater(v['end'],20*beat)
        self.assertLess(v['end'],28*beat-.15)
        self.assertAlmostEqual(v['end']-v['start'],4.629551)
        self.assertEqual(v['voicePoints'][-1],[64*beat,0])
        self.assertEqual(v['bedPoints'][-1],[64*beat,1])

    def test_coactivity_uses_exact_pcm_frames_at_boundary(self):
        intervals=[dict(start=10+i*.05,end=10+(i+1)*.05)for i in range(20)]
        self.assertEqual(coactivity_seconds(intervals),1.)

    def test_vocal_safety_never_shortens_a_phrase_to_fit(self):
        with self.assertRaises(ValueError):vocal_schedule(12*60/98,10,3,98,28*60/98,64*60/98)
        e = self.evidence(); e['pairwise']['B/C']['pitchedRisk'] = float('nan')
        self.assertFalse(approve(e, 4))


if __name__ == '__main__': unittest.main()
