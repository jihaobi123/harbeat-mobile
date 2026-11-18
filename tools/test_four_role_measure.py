import array,json,math,pathlib,subprocess,tempfile,unittest


class RawDrumEvidenceTests(unittest.TestCase):
    def test_cross_role_third_and_semitone_remain_distinguishable(self):
        root=pathlib.Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix='four-role-tones-') as d:
            p=pathlib.Path(d);helper=p/'measure.cjs';subprocess.run([str(root/'vendor/realtime-v3/node_modules/.bin/esbuild'),str(root/'tools/four_role_measure.ts'),'--bundle','--platform=node','--format=cjs','--outfile='+str(helper)],check=True,capture_output=True)
            sr=44100;n=4*sr
            def tone(name,hz):
                x=array.array('f')
                for i in range(n):v=.15*math.sin(i*2*math.pi*hz/sr);x.extend((v,v))
                out=p/name;out.write_bytes(x.tobytes());return str(out)
            bass=tone('bass.f32le',261.625565)
            for name,hz,consonant in [('third',329.627557,True),('semitone',277.182631,False)]:
                other=tone(name+'.f32le',hz);job=dict(files={'b':{'bass':bass},'c':{'other':other}},frames=n,bpm=98,curves={'b':{'bass':[[0,1],[4,1]]},'c':{'other':[[0,1],[4,1]]}},result=str(p/'result.json'));(p/'job.json').write_text(json.dumps(job));subprocess.run(['node',str(helper),str(p/'job.json')],check=True,capture_output=True)
                result=json.loads((p/'result.json').read_text())['B/C'];self.assertIn('harmonicIntervals',result)
                self.assertEqual(result['harmonicIntervals']['pass'],consonant)

    def test_muted_deck_retains_raw_onset_evidence_but_not_audible_overlap(self):
        root=pathlib.Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix='four-role-test-') as d:
            p=pathlib.Path(d);helper=p/'measure.cjs'
            subprocess.run([str(root/'vendor/realtime-v3/node_modules/.bin/esbuild'),str(root/'tools/four_role_measure.ts'),'--bundle','--platform=node','--format=cjs','--outfile='+str(helper)],check=True,capture_output=True)
            sr=44100;n=8*sr;audio=array.array('f')
            for i in range(n):
                value=(.08+(.5 if i%(sr//2)<sr*.12 else 0))*math.sin(i*2*math.pi*120/sr)
                audio.extend((value,value))
            path=p/'drums.f32le';path.write_bytes(audio.tobytes())
            job=dict(files={s:{'drums':str(path)} for s in ['a','b']},frames=n,bpm=120,
                     curves={'a':{'drums':[[0,1],[6,1],[8,0]]},'b':{'drums':[[0,0],[6,0],[8,1]]}},result=str(p/'result.json'))
            (p/'job.json').write_text(json.dumps(job));subprocess.run(['node',str(helper),str(p/'job.json')],check=True,capture_output=True)
            result=json.loads((p/'result.json').read_text())['A/B']
            self.assertTrue(result['pass_'])
            self.assertLess(result['drumOverlapSeconds'],3)
            self.assertGreater(result['drumOverlapSeconds'],1)
            self.assertEqual(result['drumDensityRatio'],1)
            self.assertEqual(result['drumOnsetAgreement'],1)


if __name__=='__main__':unittest.main()
