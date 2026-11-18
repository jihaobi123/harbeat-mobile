import contextlib,hashlib,io,json,pathlib,tempfile,types,unittest
from unittest.mock import patch


class ScanAuditTests(unittest.TestCase):
    def test_no_c_blocks_d_without_claiming_d_failure_and_records_verified_sources(self):
        import numpy as np
        import four_role_scan as scan
        for bpm in (90,110):
            with tempfile.TemporaryDirectory(prefix='four-role-scan-audit-') as d:
                root=pathlib.Path(d);audio=root/'source';audio.write_bytes(b'verified synthetic input')
                sha=hashlib.sha256(audio.read_bytes()).hexdigest();duration=64*60/bpm
                proofs={side:dict(trackId=side,masterSha256=sha,stemSha256={r:sha for r in scan.s.ROLES}) for side in 'ab'}
                tracks={side:dict(id=side,title=side,bpm=bpm,duration=200,vocals=[]) for side in 'ab'}
                # A retained B vocal in C's window must not abort the C stage.
                tracks['b']['vocals']=[[10+18*60/bpm,10+20*60/bpm]]
                layers=[dict(side=side,role=r,points=[[0,1],[duration,int(side=='b')]]) for side in 'ab' for r in scan.s.ROLES if side!='a' or r!='vocals']
                scene=dict(duration=duration,bpm=bpm,sources=proofs,clips={'aStart':8,'aEnd':8+duration/8,'bStart':10,'bEnd':10+duration},layers=layers,sourceGains={'a':1,'b':1},outputGain=.5,exits=[{'fadeStart':duration-4*60/bpm,'at':duration}],evidence={'reconstruction':{'a':0,'b':0}})
                base=root/'base.json';base.write_text(json.dumps({'id':'base-'+str(bpm),'scene':scene}));execution=root/'execution';execution.mkdir();(execution/'index.json').write_text('{"tracks":[]}')
                args=types.SimpleNamespace(metadata=root,base=base,output=root/'result',stretch=base,measure=base,execution=execution,nas=root,reports=root,extra_start_beat=16,extra_end_beat=28,c_proposals=None,d_proposals=None,c_track=None,d_track=None,voice_review=False)
                paths={role:audio for role in ['master',*scan.s.ROLES]}
                with patch.object(scan.s,'audio_dependencies'),patch.object(scan.s,'load_tracks',return_value=tracks),patch.object(scan.s,'source_assets',side_effect=lambda t,*_: (paths,proofs[t['id']]),create=True),patch.object(scan.s,'profile_proof',side_effect=lambda t,p,*_:p,create=True),patch.object(scan.s,'read_segment',side_effect=lambda p,start,length:np.zeros((round(length*44100),2),dtype=np.float32),create=True),patch.object(scan.s,'np',np,create=True),patch.object(scan.s,'sha',side_effect=lambda p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest(),create=True),patch.object(scan.signal,'signal'),contextlib.redirect_stdout(io.StringIO()):
                    scan.run(args)
                snapshot=json.loads((args.output/'source-snapshot.json').read_text())
                self.assertEqual(snapshot['targetBpm'],bpm);self.assertEqual(snapshot['baseId'],'base-'+str(bpm))
                self.assertEqual(set(snapshot['tracks']),set('ab'))
                for side in 'ab':
                    source=snapshot['tracks'][side]
                    self.assertEqual(source['proof'],proofs[side]);self.assertEqual(source['files']['master'],dict(path=str(audio),size=audio.stat().st_size,mtime_ns=audio.stat().st_mtime_ns))
                budget=json.loads((args.output/'budget.json').read_text());self.assertEqual(budget['consumed']['dTracks'],0);self.assertEqual(budget['consumed']['dWindows'],0);self.assertEqual(budget['consumed']['dChecks'],0)
                rows=json.loads((args.output/'scan-results.json').read_text());self.assertEqual([r['kind'] for r in rows],['D-blocked-no-C'])


if __name__=='__main__':unittest.main()
