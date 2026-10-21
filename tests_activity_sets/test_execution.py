"""Reservation assets must be reusable and must never submit a pair render."""
from dataclasses import replace
import hashlib
import json
import unittest
import time

from tests_activity_sets import test_service as fixtures
from activity_sets.worker import Worker


class ExecutionTests(unittest.TestCase):
    library=fixtures.WorkerTests.library
    planner=fixtures.WorkerTests.planner
    tearDown=fixtures.WorkerTests.tearDown
    def setUp(self):
        fixtures.WorkerTests.setUp(self)
        self.settings=replace(self.settings,execution_root=self.root/'execution')
        self.app.state.store.settings=self.settings

    def execution(self):
        root=self.settings.execution_root
        (root/'tracks').mkdir(parents=True)
        (root/'objects').mkdir()
        (root/'profiles').mkdir()
        content=b'source asset integrity fixture'
        sha=hashlib.sha256(content).hexdigest()
        (root/'objects'/f'{sha}.flac').write_bytes(content)
        asset={'url':f'/listen/execution-media/{sha}.flac','sha256':sha,'bytes':len(content),'duration':120,'sampleRate':44100,'channels':2,'frames':5292000}
        for tid in ('a','b'):
            data={'schema':'harbeat.execution-track.v1','trackId':tid,'runId':'run','sourceSha256':'f'*64,'reportSha256':'e'*64,'sampleRate':44100,'channels':2,'duration':120,'frames':5292000,
                  'stems':{stem:{'sourceSha256':('c' if stem=='vocals' else 'd')*64,'segments':[{'start':0,'end':120,'startFrame':0,'endFrame':5292000,'asset':asset}]} for stem in ('drums','bass','other','vocals')}}
            profile={**{k:data[k] for k in ('trackId','runId','sourceSha256','reportSha256')},'schema':'harbeat.execution-profile.v1','stems':{s:{'sourceSha256':data['stems'][s]['sourceSha256']} for s in data['stems']}}
            raw=json.dumps(profile).encode();psha=hashlib.sha256(raw).hexdigest()
            (root/'profiles'/f'{psha}.json').write_bytes(raw)
            data['profile']={'sha256':psha,'bytes':len(raw),'url':f'/listen/execution/profiles/{psha}.json'}
            (root/'tracks'/f'{tid}.json').write_text(json.dumps(data))

    def test_new_reservation_prepares_sources_without_pair_render(self):
        self.library();self.execution()
        reservation=self.client.post('/reservations',json=fixtures.payload(),headers=self.auth).json()
        def forbidden(*_):raise AssertionError('pair render must not be submitted')
        worker=Worker(self.settings,self.app.state.store,planner=self.planner,submit=forbidden,poll=forbidden)
        self.assertTrue(worker.run_once())
        manifest=self.app.state.store.public_manifest(self.app.state.store.authenticate(self.token),reservation['packId'])
        self.assertEqual(manifest['state'],'ready',manifest)
        self.assertEqual(manifest['results'],[])
        self.assertEqual(manifest['execution']['schema'],'harbeat.activity-execution.v1')
        self.assertEqual(len(manifest['execution']['tracks']),2)
        self.assertEqual(len(manifest['execution']['edges']),1)

    def test_corrupt_source_assets_cannot_be_reported_ready(self):
        self.library();self.execution()
        for path in (self.settings.execution_root/'objects').iterdir():path.write_bytes(b'bad')
        reservation=self.client.post('/reservations',json=fixtures.payload(),headers=self.auth).json()
        Worker(self.settings,self.app.state.store,planner=self.planner,submit=lambda _:self.fail('remote render')).run_once()
        pack=self.app.state.store.pack(reservation['packId'])
        self.assertEqual(pack['state'],'failed')

    def test_changed_execution_manifest_invalidates_saved_pack(self):
        self.library();self.execution()
        reservation=self.client.post('/reservations',json=fixtures.payload(),headers=self.auth).json()
        Worker(self.settings,self.app.state.store,planner=self.planner).run_once()
        path=self.settings.execution_root/'tracks'/'a.json'
        data=json.loads(path.read_text());data['reportSha256']='1'*64;path.write_text(json.dumps(data))
        manifest=self.app.state.store.public_manifest(self.app.state.store.authenticate(self.token),reservation['packId'])
        self.assertNotEqual(manifest['state'],'ready')

    def test_wrong_run_missing_profile_and_shifted_stem_are_rejected(self):
        from activity_sets.execution import read_execution_track
        from activity_sets.worker import read_library,PreparationError
        self.library();self.execution()
        _,sources,_=read_library(self.settings,['Hip-Hop'])
        path=self.settings.execution_root/'tracks'/'a.json'
        original=json.loads(path.read_text())
        mutations=[lambda x:x.update(runId='new-run'),
                   lambda x:x['profile'].update(sha256='0'*64,url='/listen/execution/profiles/'+('0'*64)+'.json'),
                   lambda x:x['stems']['bass']['segments'][0].update(startFrame=1)]
        for mutate in mutations:
            data=json.loads(json.dumps(original));mutate(data);path.write_text(json.dumps(data))
            with self.assertRaises(PreparationError):read_execution_track(self.settings,sources[0])

    def test_missing_reservation_assets_enqueue_cpu_preprocessing(self):
        self.library()
        settings=replace(self.settings,execution_requests=self.root/'execution-state'/'requests.json')
        self.app.state.store.settings=settings
        reservation=self.client.post('/reservations',json=fixtures.payload(),headers=self.auth).json()
        worker=Worker(settings,self.app.state.store,planner=self.planner,submit=lambda _:self.fail('pair render forbidden'))
        worker.stop.wait=lambda _:False
        worker.run_once()
        self.assertEqual(self.app.state.store.pack(reservation['packId'])['state'],'preparing')
        self.assertEqual(json.loads(settings.execution_requests.read_text())['trackIds'],['a','b'])

    def test_waiting_source_pack_does_not_starve_later_reservation(self):
        first=self.client.post('/reservations',json=fixtures.payload(),headers=self.auth).json()
        second=self.client.post('/reservations',json=fixtures.payload(),headers=self.auth).json()
        store=self.app.state.store
        pack=store.pack(first['packId']);pack.update(state='preparing',executionRetryAt=time.time()+30);store.save_pack(pack)
        self.assertEqual(store.next_pack()['packId'],second['packId'])

    def multi_cue_planner(self,data):
        from activity_sets.execution import source_identity
        by_id={track['id']:track for track in data['tracks']}
        for track in data['tracks']:
            track['windows']=[{'id':'w','start':2,'end':6,'bars':2,'variants':{tid:{'rate':1,'duration':4} for tid in by_id}}]
        edges=[]
        for a,b in [('a','b'),('b','a')]:
            for region in range(8):
                start=region*15+1
                edges.append({'id':f'{a}:{b}:w:{start+4:.3f}','version':'activity-candidate-v2','from':a,'to':b,'windowId':'w','start':start,'end':start+4,'duration':4,'rate':1,'bStart':2,'bEnd':6,'score':1,'kind':'automatic' if region==7 else 'nearby','region':region,'source':{'a':source_identity(by_id[a]),'b':source_identity(by_id[b])}})
        coverage={'schema':'harbeat.activity-coverage.v1','maxEdgesPerTrack':24,'maxTargetsPerRegion':3,'regionsPerTrack':8,'tracks':[{'trackId':tid,'complete':True,'regions':[{'index':i,'start':i*15,'end':(i+1)*15,'candidates':1} for i in range(8)]} for tid in by_id]}
        return {'schema':'harbeat.activity-candidates.v2','trackIds':['a','b'],'initialTrackId':'a','edges':edges,'coverage':coverage,'tracks':[{'id':tid,'title':tid} for tid in by_id]}

    def test_v2_prepares_many_cues_once_per_source_without_render(self):
        from unittest.mock import patch
        from activity_sets.execution import read_execution_track
        self.library();self.execution()
        reservation=self.client.post('/reservations',json=fixtures.payload(),headers=self.auth).json()
        with patch('activity_sets.execution.read_execution_track',wraps=read_execution_track) as read:
            Worker(self.settings,self.app.state.store,planner=self.multi_cue_planner,submit=lambda _:self.fail('pair render forbidden')).run_once()
            self.assertEqual(read.call_count,2,'16 candidate records reuse two source preparations')
        manifest=self.app.state.store.public_manifest(self.app.state.store.authenticate(self.token),reservation['packId'])
        self.assertEqual(manifest['state'],'ready',manifest)
        self.assertEqual(manifest['total'],16)
        self.assertEqual(manifest['execution']['schema'],'harbeat.activity-execution.v2')
        self.assertEqual(manifest['execution']['energy'],3)
        self.assertEqual(len(manifest['execution']['edges']),16)
        self.assertEqual(manifest['results'],[])

    def test_v2_tampered_source_and_overstated_coverage_are_rejected(self):
        self.library();self.execution()
        for change in ('source','geometry','coverage','region'):
            reservation=self.client.post('/reservations',json=fixtures.payload(),headers=self.auth).json()
            def planner(data):
                plan=self.multi_cue_planner(data)
                if change=='source':plan['edges'][0]['source']['a']['reportSha256']='0'*64
                if change=='geometry':plan['edges'][0]['duration']=33
                if change=='coverage':plan['coverage']['tracks'][0]['regions'][0]['candidates']=3
                if change=='region':plan['edges'][0]['region']=7
                return plan
            Worker(self.settings,self.app.state.store,planner=planner,submit=lambda _:self.fail('pair render forbidden')).run_once()
            self.assertEqual(self.app.state.store.pack(reservation['packId'])['state'],'failed',change)

    def test_v2_saved_candidate_corruption_invalidates_manifest(self):
        self.library();self.execution()
        reservation=self.client.post('/reservations',json=fixtures.payload(),headers=self.auth).json()
        store=self.app.state.store
        Worker(self.settings,store,planner=self.multi_cue_planner).run_once()
        pack=store.pack(reservation['packId'])
        pack['execution']['edges'][0]['source']['a']['masterSha256']='0'*64
        store.save_pack(pack)
        manifest=store.public_manifest(store.authenticate(self.token),reservation['packId'])
        self.assertEqual(manifest['state'],'partial')
        self.assertIn('execution_assets_invalid',manifest['warnings'])

    def test_v2_global_capacity_and_legacy_execution_schema(self):
        from activity_sets.execution import validate_candidate_edges,validate_execution_pack
        from activity_sets.worker import PreparationError,read_library
        self.library();self.execution()
        tracks,sources,_=read_library(self.settings,['Hip-Hop'])
        planned=self.multi_cue_planner({'tracks':tracks})
        with self.assertRaisesRegex(PreparationError,'invalid_candidate_edges'):
            validate_candidate_edges(planned['edges']*19,sources,planned['coverage'])
        reservation=self.client.post('/reservations',json=fixtures.payload(),headers=self.auth).json()
        Worker(self.settings,self.app.state.store,planner=self.planner).run_once()
        pack=self.app.state.store.pack(reservation['packId'])
        self.assertEqual(pack['execution']['schema'],'harbeat.activity-execution.v1')
        self.assertTrue(validate_execution_pack(self.settings,pack))
        pack['execution']['schema']='harbeat.activity-execution.v999'
        self.assertFalse(validate_execution_pack(self.settings,pack))

    def test_explicit_prepare_upgrades_legacy_pack_but_reads_preserve_it(self):
        self.library();self.execution()
        self.app=fixtures.create_app(self.settings,run_worker=False)
        self.client=fixtures.TestClient(self.app)
        reservation=self.client.post('/reservations',json=fixtures.payload(),headers=self.auth).json()
        Worker(self.settings,self.app.state.store,planner=self.planner).run_once()
        for _ in range(2):
            view=self.client.get('/reservations/'+reservation['id'],headers=self.auth).json()
            self.assertEqual(view['pack']['state'],'ready')
            self.assertEqual(self.app.state.store.pack(reservation['packId'])['execution']['schema'],'harbeat.activity-execution.v1')
        response=self.client.post('/reservations/'+reservation['id']+'/prepare',headers=self.auth)
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['pack']['state'],'queued')
        queued=self.app.state.store.pack(reservation['packId'])
        self.assertFalse(queued['planned'])
        self.assertNotIn('execution',queued)
        Worker(self.settings,self.app.state.store,planner=self.multi_cue_planner).run_once()
        view=self.client.get('/reservations/'+reservation['id'],headers=self.auth).json()
        self.assertEqual(view['pack']['state'],'ready')
        self.assertEqual(view['pack']['candidateVersion'],'activity-candidate-v2')
        self.assertEqual(view['pack']['total'],16)
        self.client.post('/reservations/'+reservation['id']+'/prepare',headers=self.auth)
        self.assertEqual(self.app.state.store.pack(reservation['packId'])['state'],'ready','v2 re-prepare must reuse valid candidates')

    def test_candidate_pool_excludes_only_explicit_unavailable_sources(self):
        from activity_sets.worker import read_library
        self.library()
        self.settings.execution_root.mkdir()
        (self.settings.execution_root/'index.json').write_text(json.dumps({'schema':'harbeat.execution-library.v1','tracks':[{'trackId':'b','assetsReady':False}],'excluded':[{'trackId':'a','reason':'source binding or audio evidence unavailable'}]}))
        tracks,sources,_=read_library(self.settings,['Hip-Hop'])
        self.assertEqual([track['id'] for track in tracks],['b'],'an explicitly excluded source must not win the connected subset')
        self.assertEqual([source['id'] for source in sources],['b'])
        self.assertFalse((self.settings.execution_root/'tracks/b.json').exists(),'pending sources remain eligible for CPU preparation')

    def test_missing_execution_index_does_not_drop_pending_catalog(self):
        from activity_sets.worker import read_library
        self.library()
        tracks,_,_=read_library(self.settings,['Hip-Hop'])
        self.assertEqual([track['id'] for track in tracks],['a','b'])

    def test_repaired_manifest_overrides_stale_excluded_entry(self):
        from activity_sets.worker import read_library
        self.library();self.execution()
        (self.settings.execution_root/'index.json').write_text(json.dumps({'schema':'harbeat.execution-library.v1','tracks':[],'excluded':[{'trackId':'a','reason':'previous publication attempt failed'}]}))
        tracks,_,_=read_library(self.settings,['Hip-Hop'])
        self.assertEqual([track['id'] for track in tracks],['a','b'],'current manifests must be validated instead of hidden by stale index exclusions')

    def test_pending_pack_replans_if_publisher_later_excludes_a_source(self):
        self.library()
        settings=replace(self.settings,execution_requests=self.root/'execution-state/requests.json')
        self.app.state.store.settings=settings
        reservation=self.client.post('/reservations',json=fixtures.payload(),headers=self.auth).json()
        seen=[]
        def planner(data):
            ids=[track['id'] for track in data['tracks']];seen.append(ids)
            return self.planner(data) if len(ids)==2 else {'trackIds':['b'],'initialTrackId':'b','edges':[],'tracks':[{'id':'b','title':'b'}]}
        worker=Worker(settings,self.app.state.store,planner=planner,submit=lambda _:self.fail('pair render forbidden'))
        worker.stop.wait=lambda _:False
        worker.run_once()
        self.assertEqual(seen,[['a','b']])
        self.assertEqual(self.app.state.store.pack(reservation['packId'])['state'],'preparing')
        settings.execution_root.mkdir()
        (settings.execution_root/'index.json').write_text(json.dumps({'schema':'harbeat.execution-library.v1','excluded':[{'trackId':'a','reason':'source binding unavailable'}]}))
        pack=self.app.state.store.pack(reservation['packId']);pack['executionRetryAt']=0;self.app.state.store.save_pack(pack)
        worker.run_once()
        self.assertEqual(seen,[['a','b'],['b']])
        pack=self.app.state.store.pack(reservation['packId'])
        self.assertEqual(pack['trackIds'],['b'])
        self.assertEqual(pack['state'],'preparing','remaining pending sources must still be prepared')

    def add_library_track(self,tid):
        path=self.settings.site/'details'/f'{tid}.json'
        detail=json.loads((self.settings.site/'details/a.json').read_text())
        detail['track'].update(id=tid,title=tid,reportId='r-'+tid)
        detail['track']['native']['url']='media/'+tid+'.wav'
        path.write_text(json.dumps(detail))
        index_path=self.settings.site/'library.json';index=json.loads(index_path.read_text())
        index['tracks'].append({'id':tid,'title':tid,'duration':120,'playStatus':'ready','mixStatus':'ready','styleLabels':['Hip-Hop'],'detailUrl':f'details/{tid}.json'})
        index_path.write_text(json.dumps(index))

    def test_upgrade_preserves_saved_membership_and_one_time_hint(self):
        self.library();self.execution()
        self.app=fixtures.create_app(self.settings,run_worker=False);self.client=fixtures.TestClient(self.app)
        reservation=self.client.post('/reservations',json=fixtures.payload(),headers=self.auth).json()
        Worker(self.settings,self.app.state.store,planner=self.planner).run_once()
        self.add_library_track('c');self.add_library_track('d')
        self.client.post('/reservations/'+reservation['id']+'/prepare',headers=self.auth)
        queued=self.app.state.store.pack(reservation['packId'])
        self.assertEqual(queued['replanTrackIds'],['a','b'])
        seen=[]
        def planner(data):
            seen.append(data)
            return self.multi_cue_planner({**data,'tracks':[t for t in data['tracks'] if t['id'] in data['retainedTrackIds']]})
        Worker(self.settings,self.app.state.store,planner=planner).run_once()
        pack=self.app.state.store.pack(reservation['packId'])
        self.assertEqual(pack['state'],'ready')
        self.assertEqual(pack['trackIds'],['a','b'])
        self.assertEqual(seen[0]['retainedTrackIds'],['a','b'])
        self.assertEqual({t['id'] for t in seen[0]['tracks']},{'a','b','c','d'},'replacement pool remains available')
        self.assertNotIn('replanTrackIds',pack,'retention is consumed by this replan only')

    def test_replan_rejects_silently_dropping_an_available_saved_track(self):
        self.library();self.execution();self.add_library_track('c')
        reservation=self.client.post('/reservations',json=fixtures.payload(),headers=self.auth).json()
        pack=self.app.state.store.pack(reservation['packId']);pack['replanTrackIds']=['b','c'];self.app.state.store.save_pack(pack)
        Worker(self.settings,self.app.state.store,planner=self.planner).run_once()
        pack=self.app.state.store.pack(reservation['packId'])
        self.assertEqual(pack['error'],'retained_tracks_changed')

    def test_source_revision_refreshes_evidence_without_replacing_saved_ids(self):
        self.library();self.execution()
        self.app=fixtures.create_app(self.settings,run_worker=False);self.client=fixtures.TestClient(self.app)
        reservation=self.client.post('/reservations',json=fixtures.payload(),headers=self.auth).json()
        Worker(self.settings,self.app.state.store,planner=self.multi_cue_planner).run_once()
        self.add_library_track('c')
        path=self.settings.site/'details/a.json';detail=json.loads(path.read_text());detail['track']['reportId']='r-a-new';path.write_text(json.dumps(detail))
        self.client.post('/reservations/'+reservation['id']+'/prepare',headers=self.auth)
        def planner(data):
            self.assertEqual(data['retainedTrackIds'],['a','b'])
            return self.multi_cue_planner({**data,'tracks':[t for t in data['tracks'] if t['id'] in data['retainedTrackIds']]})
        Worker(self.settings,self.app.state.store,planner=planner).run_once()
        pack=self.app.state.store.pack(reservation['packId'])
        self.assertEqual(pack['state'],'ready')
        self.assertEqual(pack['trackIds'],['a','b'])
        self.assertEqual(next(t for t in pack['sourceFingerprints'] if t['id']=='a')['reportId'],'r-a-new')

    def test_retained_ids_precede_fresh_pool_limit(self):
        from activity_sets.worker import read_library
        self.library()
        for index in range(65):self.add_library_track('c'+str(index).zfill(2))
        tracks,_,truncated=read_library(self.settings,['Hip-Hop'],['c64','b'])
        self.assertEqual([t['id'] for t in tracks[:2]],['c64','b'])
        self.assertEqual(len(tracks),64)
        self.assertTrue(truncated)

    def test_unavailable_saved_id_is_replaced_with_explicit_warnings(self):
        self.library();self.execution();self.add_library_track('c')
        (self.settings.execution_root/'tracks/a.json').unlink()
        (self.settings.execution_root/'index.json').write_text(json.dumps({'schema':'harbeat.execution-library.v1','excluded':[{'trackId':'a','reason':'source binding unavailable'}]}))
        reservation=self.client.post('/reservations',json=fixtures.payload(),headers=self.auth).json()
        pack=self.app.state.store.pack(reservation['packId']);pack['replanTrackIds']=['a','b']
        def planner(data):
            self.assertEqual(data['retainedTrackIds'],['a','b'])
            return {'trackIds':['b','c'],'initialTrackId':'b','edges':[{'from':'b','to':'c','windowId':'w','start':30}],'tracks':[{'id':tid,'title':tid} for tid in ('b','c')]}
        Worker(self.settings,self.app.state.store,planner=planner).plan_pack(pack)
        self.assertEqual(pack['trackIds'],['b','c'])
        self.assertIn('retained_track_unavailable:a',pack['warnings'])
        self.assertIn('retained_track_replacement:c',pack['warnings'])

    def test_retained_id_survives_style_relabeling_but_fresh_pool_stays_filtered(self):
        from activity_sets.worker import read_library
        self.library();self.add_library_track('c')
        path=self.settings.site/'library.json';index=json.loads(path.read_text())
        for row in index['tracks']:
            if row['id'] in ('a','c'):row['styleLabels']=['House']
        path.write_text(json.dumps(index))
        tracks,_,_=read_library(self.settings,['Hip-Hop'],['a','b'])
        self.assertEqual([track['id'] for track in tracks],['a','b'])
        fresh,_,_=read_library(self.settings,['Hip-Hop'])
        self.assertEqual([track['id'] for track in fresh],['b'])
        index['tracks'][0]['mixStatus']='unavailable';path.write_text(json.dumps(index))
        retained,_,_=read_library(self.settings,['Hip-Hop'],['a','b'])
        self.assertEqual([track['id'] for track in retained],['b'],'style exemption must never override playback/mix readiness')
