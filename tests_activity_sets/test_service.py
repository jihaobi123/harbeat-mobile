import hashlib
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from fastapi.testclient import TestClient

try:
    from activity_sets.service import create_app, Settings
    from activity_sets.worker import Worker, pin_result
except ImportError:
    create_app = Settings = Worker = pin_result = None


def payload(**changes):
    return dict(name='Test activity', styles=['Hip-Hop'], startsAt=(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat(), durationMinutes=60, energy=3, **changes)


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(create_app, 'persistent activity set service must exist')
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.settings = Settings(root=self.root/'sets', site=self.root/'site', gateway_media=self.root/'gateway', planner=self.root/'set-plan.cjs')
        self.app = create_app(self.settings, run_worker=False)
        self.client = TestClient(self.app)
        self.token = self.client.post('/workspaces').json()['token']
        self.auth = {'Authorization': 'Bearer '+self.token}

    def tearDown(self):
        if hasattr(self, 'tmp'): self.tmp.cleanup()

    def test_auth_isolation_and_hashed_credentials(self):
        self.assertEqual(self.client.get('/reservations').status_code, 401)
        self.assertEqual(self.client.get('/reservations', headers={'Authorization':'Bearer invalid'}).status_code, 401)
        r = self.client.post('/reservations', json=payload(), headers=self.auth)
        self.assertEqual(r.status_code, 201, r.text)
        other = self.client.post('/workspaces').json()['token']
        other_auth = {'Authorization':'Bearer '+other}
        self.assertEqual(self.client.get('/reservations', headers=other_auth).json(), {'reservations':[]})
        self.assertEqual(self.client.get('/reservations/'+r.json()['id'], headers=other_auth).status_code, 404)
        self.assertEqual(self.client.get('/packs/'+r.json()['packId']+'/manifest', headers=other_auth).status_code, 404)
        self.assertNotIn(self.token.encode(), (self.settings.root/'activity-sets.sqlite3').read_bytes())

    def test_reuse_and_expiration_never_delete_pack(self):
        original = self.client.post('/reservations', json=payload(), headers=self.auth).json()
        reused = self.client.post('/reservations/'+original['id']+'/reuse', json={k:v for k,v in payload().items() if k in ('name','startsAt','durationMinutes')}, headers=self.auth)
        self.assertEqual(reused.status_code,201,reused.text)
        self.assertNotEqual(reused.json()['id'],original['id'])
        self.assertEqual(reused.json()['packId'],original['packId'])
        app2 = create_app(self.settings, run_worker=False)
        reread = TestClient(app2).get('/reservations',headers=self.auth).json()['reservations']
        self.assertEqual(len(reread),2)
        self.assertEqual(self.client.get('/packs/'+original['packId']+'/manifest',headers=self.auth).json()['state'],'queued')

    def test_reject_invalid_schedule_and_bounds(self):
        for change in ({'startsAt':'2026-10-21T10:00:00'},{'startsAt':'2000-01-01T00:00:00Z'}, {'durationMinutes':14},{'durationMinutes':481},{'durationMinutes':True},{'energy':0},{'energy':6},{'styles':[]},{'styles':['x']*13},{'name':'  '}):
            data=payload();data.update(change)
            self.assertEqual(self.client.post('/reservations',json=data,headers=self.auth).status_code,422,change)

    def test_creation_and_reservation_limits(self):
        for _ in range(3): self.client.post('/reservations',json=payload(),headers=self.auth)
        self.assertEqual(self.client.post('/reservations',json=payload(),headers=self.auth).status_code,429)
        for _ in range(4): self.client.post('/workspaces')
        self.assertEqual(self.client.post('/workspaces').status_code,429)


class WorkerTests(ServiceTests):
    def library(self):
        self.settings.site.mkdir()
        (self.settings.site/'details').mkdir()
        tracks=[]
        for tid in ('a','b'):
            t={'id':tid,'title':tid,'duration':120,'native':{'url':'media/'+tid+'.wav','sha256':'f'*64,'bytes':12,'duration':120},'audioSegments':[],'reportId':'r-'+tid,'provenance':{'runId':'run','masterSha256':'f'*64,'reportSha256':'e'*64,'vocalSha256':'c'*64},'windows':[],'bars':[0,2,4]}
            (self.settings.site/'details'/f'{tid}.json').write_text(json.dumps({'track':t}))
            tracks.append({'id':tid,'title':tid,'duration':120,'playStatus':'ready','mixStatus':'ready','styleLabels':['Hip-Hop'],'detailUrl':f'details/{tid}.json'})
        (self.settings.site/'library.json').write_text(json.dumps({'schema':'harbeat.continuous-library.v1','tracks':tracks}))

    def result(self, job='a'*64):
        folder=self.settings.gateway_media/job;folder.mkdir(parents=True,exist_ok=True)
        data=b'fake wav identity used only for pin integrity test'
        (folder/'original.wav').write_bytes(data)
        return {'schema':'harbeat.metric-mix-result.v1','id':job,'status':'ready','policyVersion':'metric-mix-v1.0','codeVersion':'d'*64,'plan':{'from':'a','to':'b','windowId':'w','start':30,'end':34,'duration':4,'rate':1,'bStart':2,'bEnd':6,'beatErrorMs':12},'sourceProof':{side:{'trackId':tid,'runId':'run','reportSha256':'e'*64,'assets':{'master':{'sha256':'f'*64},'vocals':{'sha256':'c'*64}}} for side,tid in [('a','a'),('b','b')]},'decision':{'recommended':'original','methods':{'original':{'eligible':True}}},'assets':{'original':{'url':f'/listen/smart-media/{job}/original.wav','sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'duration':4}}}

    def planner(self, data):
        return {'trackIds':['a','b'],'initialTrackId':'a','edges':[{'from':'a','to':'b','windowId':'w','start':30,'score':1}], 'tracks':[{'id':'a','title':'a'},{'id':'b','title':'b'}]}

    def test_worker_checkpoints_and_reuse_no_render(self):
        self.library()
        reservation=self.client.post('/reservations',json=payload(),headers=self.auth).json()
        calls=[]
        def submit(edge):calls.append(edge);return {'id':'a'*64,'status':'queued'}
        worker=Worker(self.settings,self.app.state.store,planner=self.planner,submit=submit,poll=lambda _: self.result())
        self.assertTrue(worker.run_once())
        manifest=self.client.get('/packs/'+reservation['packId']+'/manifest',headers=self.auth).json()
        self.assertEqual((manifest['state'],manifest['prepared'],manifest['total']),('ready',1,1))
        self.assertEqual(manifest['results'][0]['assets']['original']['url'],f"/listen/set-media/{reservation['packId']}/{'a'*64}/original.wav")
        source=self.settings.gateway_media/('a'*64)/'original.wav';source.unlink()
        self.assertEqual(self.client.get('/packs/'+reservation['packId']+'/manifest',headers=self.auth).json()['state'],'ready')
        self.client.post('/reservations/'+reservation['id']+'/reuse',json={'startsAt':payload()['startsAt'],'durationMinutes':60},headers=self.auth)
        self.assertFalse(Worker(self.settings,self.app.state.store,planner=self.planner,submit=submit,poll=lambda _: self.result()).run_once())
        self.assertEqual(len(calls),1)

    def test_restart_resumes_inflight_job_without_resubmit(self):
        self.library()
        r=self.client.post('/reservations',json=payload(),headers=self.auth).json()
        def stop(_):raise KeyboardInterrupt('crash')
        worker=Worker(self.settings,self.app.state.store,planner=self.planner,submit=lambda _: {'id':'a'*64},poll=stop)
        with self.assertRaises(KeyboardInterrupt):worker.run_once()
        restarted=create_app(self.settings,run_worker=False)
        def duplicate(_):self.fail('persisted job must not submit again')
        self.assertTrue(Worker(self.settings,restarted.state.store,planner=self.planner,submit=duplicate,poll=lambda _:self.result()).run_once())
        manifest=TestClient(restarted).get('/packs/'+r['packId']+'/manifest',headers=self.auth).json()
        self.assertEqual(manifest['state'],'ready')

    def test_pin_rejects_wrong_path_and_hash_and_detects_later_corruption(self):
        result=self.result()
        result['assets']['original']['url']='http://evil/original.wav'
        with self.assertRaises(ValueError):pin_result(self.settings,'b'*32,result)
        result=self.result();result['assets']['original']['sha256']='0'*64
        with self.assertRaises(ValueError):pin_result(self.settings,'b'*32,result)
        self.library()
        r=self.client.post('/reservations',json=payload(),headers=self.auth).json()
        Worker(self.settings,self.app.state.store,planner=self.planner,submit=lambda _: {'id':'a'*64},poll=lambda _:self.result()).run_once()
        (self.settings.root/'media'/r['packId']/('a'*64)/'original.wav').write_bytes(b'corrupt')
        manifest=self.client.get('/packs/'+r['packId']+'/manifest',headers=self.auth).json()
        self.assertEqual(manifest['state'],'partial')
        self.assertEqual(manifest['results'],[])
        self.assertIn('pinned_media_invalid',manifest['warnings'])

    def test_failed_edge_is_partial_and_rejects_external_detail(self):
        self.library()
        r=self.client.post('/reservations',json=payload(),headers=self.auth).json()
        def failed(_):return {'status':'failed'}
        Worker(self.settings,self.app.state.store,planner=self.planner,submit=lambda _: {'id':'a'*64},poll=failed).run_once()
        manifest=self.client.get('/packs/'+r['packId']+'/manifest',headers=self.auth).json()
        self.assertEqual((manifest['state'],manifest['prepared'],manifest['failed']),('failed',0,1))
        library=json.loads((self.settings.site/'library.json').read_text());library['tracks'][0]['detailUrl']='https://evil/track.json';(self.settings.site/'library.json').write_text(json.dumps(library))
        r=self.client.post('/reservations',json=payload(),headers=self.auth).json()
        Worker(self.settings,self.app.state.store,planner=self.planner,submit=lambda _: self.fail('untrusted library submitted')).run_once()
        self.assertEqual(self.client.get('/packs/'+r['packId']+'/manifest',headers=self.auth).json()['state'],'failed')

    def test_prepare_retries_failed_job_and_corrupted_ready_assets(self):
        self.library()
        r=self.client.post('/reservations',json=payload(),headers=self.auth).json()
        calls=[]
        def submit(edge):calls.append(edge);return {'id':'a'*64}
        Worker(self.settings,self.app.state.store,planner=self.planner,submit=submit,poll=lambda _: {'status':'failed'}).run_once()
        self.assertEqual(self.client.post('/reservations/'+r['id']+'/prepare',headers=self.auth).status_code,200)
        Worker(self.settings,self.app.state.store,planner=self.planner,submit=submit,poll=lambda _:self.result()).run_once()
        self.assertEqual(len(calls),2,'retry must resubmit deterministic gateway request, not poll failed checkpoint')
        (self.settings.root/'media'/r['packId']/('a'*64)/'original.wav').write_bytes(b'corrupt')
        self.assertEqual(self.client.post('/reservations/'+r['id']+'/prepare',headers=self.auth).json()['pack']['state'],'queued')
        Worker(self.settings,self.app.state.store,planner=self.planner,submit=submit,poll=lambda _:self.result()).run_once()
        self.assertEqual(self.client.get('/packs/'+r['packId']+'/manifest',headers=self.auth).json()['state'],'ready')

    def test_source_revision_is_stale_and_preserves_old_pack(self):
        self.library()
        r=self.client.post('/reservations',json=payload(),headers=self.auth).json()
        Worker(self.settings,self.app.state.store,planner=self.planner,submit=lambda _: {'id':'a'*64},poll=lambda _:self.result()).run_once()
        path=self.settings.site/'details/a.json'
        detail=json.loads(path.read_text());detail['track']['reportId']='new-report';path.write_text(json.dumps(detail))
        manifest=self.client.get('/packs/'+r['packId']+'/manifest',headers=self.auth).json()
        self.assertEqual(manifest['state'],'stale')
        self.assertIn('source_revision_changed',manifest['warnings'])
        self.assertEqual(len(manifest['results']),1,'retained media must not be deleted when current report changes')

    def test_cosmetic_detail_and_new_variants_do_not_stale_retained_sources(self):
        self.library()
        r=self.client.post('/reservations',json=payload(),headers=self.auth).json()
        Worker(self.settings,self.app.state.store,planner=self.planner,submit=lambda _: {'id':'a'*64},poll=lambda _:self.result()).run_once()
        path=self.settings.site/'details/a.json'
        detail=json.loads(path.read_text());detail['track']['title']='New title';detail['track']['windows']=[{'variants':{'new-published-track':{'url':'other.wav'}}}];path.write_text(json.dumps(detail))
        self.assertEqual(self.client.get('/packs/'+r['packId']+'/manifest',headers=self.auth).json()['state'],'ready')

    def test_style_family_pool_passes_same_hiphop_labels_to_cli(self):
        self.library()
        path=self.settings.site/'library.json';data=json.loads(path.read_text())
        data['tracks'][0]['styleLabels']=['Boom Bap'];data['tracks'][1]['styleLabels']=['Jazz Hip-Hop'];path.write_text(json.dumps(data))
        r=self.client.post('/reservations',json=payload(),headers=self.auth).json()
        seen=[]
        def planner(data):seen.extend(t['id'] for t in data['tracks']);return self.planner(data)
        Worker(self.settings,self.app.state.store,planner=planner,submit=lambda _: {'id':'a'*64},poll=lambda _:self.result()).run_once()
        self.assertEqual(seen,['a','b'])
        self.assertEqual(self.client.get('/packs/'+r['packId']+'/manifest',headers=self.auth).json()['state'],'ready')

    def test_worker_rejects_result_past_source_end(self):
        self.library()
        self.client.post('/reservations',json=payload(),headers=self.auth)
        def planner(data):
            p=self.planner(data);p['edges'][0]['start']=119;return p
        def wrong(_):
            r=self.result();r['plan'].update(start=119,end=123);return r
        Worker(self.settings,self.app.state.store,planner=planner,submit=lambda _: {'id':'a'*64},poll=wrong).run_once()
        r=self.client.get('/reservations',headers=self.auth).json()['reservations'][0]
        self.assertEqual(r['pack']['state'],'failed')
        self.assertEqual(r['pack']['error'],'metric_plan_mismatch')

    def test_current_index_redirect_to_new_report_is_stale_even_if_old_file_exists(self):
        self.library()
        r=self.client.post('/reservations',json=payload(),headers=self.auth).json()
        Worker(self.settings,self.app.state.store,planner=self.planner,submit=lambda _: {'id':'a'*64},poll=lambda _:self.result()).run_once()
        new=self.settings.site/'catalog/new/details';new.mkdir(parents=True)
        detail=json.loads((self.settings.site/'details/a.json').read_text());detail['track']['reportId']='new-report'
        (new/'a.json').write_text(json.dumps(detail))
        index=self.settings.site/'library.json';data=json.loads(index.read_text());data['tracks'][0]['detailUrl']='catalog/new/details/a.json';index.write_text(json.dumps(data))
        self.assertEqual(self.client.get('/packs/'+r['packId']+'/manifest',headers=self.auth).json()['state'],'stale')

    def test_native_segment_duration_is_not_total_track_duration(self):
        self.library()
        for tid in ('a','b'):
            path=self.settings.site/'details'/f'{tid}.json';data=json.loads(path.read_text());data['track']['native']['duration']=30;path.write_text(json.dumps(data))
        r=self.client.post('/reservations',json=payload(),headers=self.auth).json()
        Worker(self.settings,self.app.state.store,planner=self.planner,submit=lambda _: {'id':'a'*64},poll=lambda _:self.result()).run_once()
        self.assertEqual(self.client.get('/packs/'+r['packId']+'/manifest',headers=self.auth).json()['state'],'ready')

    def test_unchanged_manifest_avoids_rehashing_wav(self):
        from unittest.mock import patch
        self.library()
        r=self.client.post('/reservations',json=payload(),headers=self.auth).json()
        Worker(self.settings,self.app.state.store,planner=self.planner,submit=lambda _: {'id':'a'*64},poll=lambda _:self.result()).run_once()
        url='/packs/'+r['packId']+'/manifest'
        self.client.get(url,headers=self.auth)
        opened=[];real_open=Path.open
        def recording(path,*args,**kwargs):
            if path.suffix=='.wav':opened.append(path)
            return real_open(path,*args,**kwargs)
        with patch.object(Path,'open',recording):
            self.client.get(url,headers=self.auth)
            self.client.get('/reservations',headers=self.auth)
        self.assertEqual(opened,[],'unchanged WAV hashes should be cached by inode/size/mtime/ctime')

    def test_compact_input_preserves_exact_existing_planner_output(self):
        import subprocess
        import activity_sets.worker as module
        self.assertTrue(hasattr(module,'compact_track'),'planner input should omit unused preprocessing fields')
        repo=Path(__file__).resolve().parents[1]
        bundle=self.root/'fixture.cjs'
        subprocess.run([str(repo/'vendor/realtime-v3/node_modules/.bin/esbuild'),str(repo/'tests_activity_sets/planner_fixture.ts'),'--bundle','--platform=node','--format=cjs','--outfile='+str(bundle)],check=True,capture_output=True)
        full=json.loads(subprocess.check_output(['node',str(bundle)]))
        compact={**full,'tracks':[module.compact_track(t) for t in full['tracks']]}
        cli=['node',str(repo/'tools/activity_set_plan.cjs')]
        expected=json.loads(subprocess.check_output(cli,input=json.dumps(full).encode()))
        actual=json.loads(subprocess.check_output(cli,input=json.dumps(compact).encode()))
        self.assertGreater(len(expected['edges']),0)
        self.assertEqual(actual,expected)
        self.assertLess(len(json.dumps(compact)),len(json.dumps(full)))

    def test_concurrent_creates_obey_atomic_active_limit(self):
        from concurrent.futures import ThreadPoolExecutor
        def create(_):
            return self.client.post('/reservations',json=payload(),headers=self.auth).status_code
        with ThreadPoolExecutor(max_workers=8) as pool:
            codes=list(pool.map(create,range(8)))
        self.assertEqual(codes.count(201),3)
        self.assertEqual(codes.count(429),5)

    def test_planner_rejects_too_many_edges_and_wrong_result_source(self):
        self.library()
        r=self.client.post('/reservations',json=payload(),headers=self.auth).json()
        def invalid(data):
            p=self.planner(data);p['edges']*=25;return p
        Worker(self.settings,self.app.state.store,planner=invalid,submit=lambda _:self.fail('unbounded edges submitted')).run_once()
        manifest=self.client.get('/packs/'+r['packId']+'/manifest',headers=self.auth).json()
        self.assertEqual(manifest['state'],'failed')
        r=self.client.post('/reservations',json=payload(),headers=self.auth).json()
        def wrong(_):
            result=self.result();result['sourceProof']['a']['reportSha256']='0'*64;return result
        Worker(self.settings,self.app.state.store,planner=self.planner,submit=lambda _: {'id':'a'*64},poll=wrong).run_once()
        self.assertEqual(self.client.get('/packs/'+r['packId']+'/manifest',headers=self.auth).json()['error'],'source_revision_changed')


if __name__=='__main__':unittest.main()
