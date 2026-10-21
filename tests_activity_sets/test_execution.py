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
