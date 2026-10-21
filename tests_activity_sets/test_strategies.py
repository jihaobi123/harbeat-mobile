"""Reservation strategy queues checkpoint without blocking other reservations."""
from dataclasses import replace
import hashlib
import json
import unittest
from tests_activity_sets import test_service as fixtures
from tests_activity_sets import test_execution as execution_fixtures
from activity_sets.worker import Worker


class StrategyTests(unittest.TestCase):
    library=execution_fixtures.ExecutionTests.library
    execution=execution_fixtures.ExecutionTests.execution
    planner=execution_fixtures.ExecutionTests.multi_cue_planner
    tearDown=execution_fixtures.ExecutionTests.tearDown
    def setUp(self):
        execution_fixtures.ExecutionTests.setUp(self)
        self.settings=replace(self.settings,jetson_plans=True)
        self.app.state.store.settings=self.settings
        self.library();self.execution()
        for path in (self.settings.execution_root/'tracks').glob('*.json'):
            value=json.loads(path.read_text());value['manifestSha256']='9'*64;path.write_text(json.dumps(value))
        self.reservation=self.client.post('/reservations',json=fixtures.payload(),headers=self.auth).json()
        self.store=self.app.state.store
        self.jobs={};self.submissions=[]

    def submit(self,edge):
        identity=hashlib.sha256(json.dumps(edge,sort_keys=True).encode()).hexdigest()
        self.jobs[identity]=edge;self.submissions.append(identity)
        return {'id':identity,'status':'queued'}

    def result(self,identity):
        edge=self.jobs[identity]
        sources={p.stem:json.loads(p.read_text()) for p in (self.settings.execution_root/'tracks').glob('*.json')}
        proof={side:{'trackId':tid,'runId':'run','masterSha256':'f'*64,'reportSha256':'e'*64,'vocalSha256':'c'*64,'manifestSha256':'9'*64,'profileSha256':sources[tid]['profile']['sha256'],'stemSha256':{stem:s['sourceSha256'] for stem,s in sources[tid]['stems'].items()}} for side,tid in [('a',edge['from']),('b',edge['to'])]}
        return {'schema':'harbeat.jetson-mix-plan.v1','id':identity,'status':'ready','producer':'jetson','analysisVersion':'jetson-decision-v1','algorithmSha256':'8'*64,'analysisSha256':'7'*64,'plan':{k:edge[k] for k in ('from','to','windowId','start','end','duration','rate','bStart','bEnd')},'sourceProof':proof,'controls':{},'metrics':{},'decision':{'recommended':'original','methods':{'original':{'eligible':True}}},'eq':{},'restore':edge['end'],'requiredStems':[]}

    def worker(self,**kwargs):
        return Worker(self.settings,self.store,planner=self.planner,submit=lambda _:self.fail('render forbidden'),submit_plan=self.submit,poll_plan=self.result,verify_plan=lambda *_:True,**kwargs)

    def tick(self,worker):
        pack=self.store.pack(self.reservation['packId']);pack['executionRetryAt']=0;self.store.save_pack(pack);worker.run_once();return self.store.pack(pack['packId'])

    def test_only_three_inflight_approvals_are_checkpointed_then_next_pack_can_run(self):
        worker=self.worker();worker.run_once()
        pack=self.store.pack(self.reservation['packId'])
        self.assertEqual(pack['state'],'preparing')
        self.assertEqual(len(self.submissions),3)
        self.assertEqual(pack['prepared'],0)
        self.assertEqual(pack['execution']['strategyVersion'],'jetson-decision-v1')
        second=self.client.post('/reservations',json=fixtures.payload(),headers=self.auth).json()
        self.assertEqual(self.store.next_pack()['packId'],second['packId'])
        pack=self.tick(worker)
        self.assertEqual(pack['prepared'],3)
        self.assertEqual(len(pack['execution']['strategies']),3)
        self.assertEqual(len(self.submissions),6)
        self.assertLessEqual(sum(t['state']=='running' for t in pack['tasks']),3)

    def test_restart_reuses_job_ids_and_finishes_only_after_all_approvals(self):
        self.worker().run_once()
        worker=self.worker()
        for _ in range(8):
            pack=self.tick(worker)
            if pack['state']=='ready':break
        self.assertEqual(pack['state'],'ready')
        self.assertEqual(pack['prepared'],16)
        self.assertEqual(len(self.submissions),16)
        self.assertEqual(len(pack['execution']['strategies']),16)
        self.assertEqual(pack['strategyPrepared'],16)

    def test_forged_source_approval_is_failed_and_not_embedded(self):
        worker=self.worker();worker.run_once()
        original=worker.poll_plan
        def bad(identity):
            result=original(identity);result['sourceProof']['a']['profileSha256']='0'*64;return result
        worker.poll_plan=bad
        pack=self.tick(worker)
        self.assertEqual(pack['prepared'],0)
        self.assertEqual(pack['failed'],3)
        self.assertEqual(pack['execution']['strategies'],[])
        self.assertNotEqual(pack['state'],'ready')

    def test_old_ready_v2_is_unchanged_until_explicit_upgrade_and_retains_selection(self):
        old=replace(self.settings,jetson_plans=False)
        Worker(old,self.store,planner=self.planner).run_once()
        pack=self.store.pack(self.reservation['packId']);pack['initialTrackId']='b';self.store.save_pack(pack)
        self.app=fixtures.create_app(self.settings,run_worker=False);self.client=fixtures.TestClient(self.app)
        view=self.client.get('/reservations/'+self.reservation['id'],headers=self.auth).json()
        self.assertEqual(view['pack']['state'],'ready')
        self.assertNotIn('strategyVersion',view['pack'])
        self.assertNotIn('strategies',self.store.pack(pack['packId'])['execution'])
        response=self.client.post('/reservations/'+self.reservation['id']+'/prepare',headers=self.auth)
        self.assertEqual(response.status_code,200,response.text)
        queued=self.store.pack(pack['packId'])
        self.assertEqual(queued['state'],'queued')
        self.assertEqual(queued['replanTrackIds'],['a','b'])
        self.assertEqual(queued['replanInitialTrackId'],'b')

    def test_api_plan_submission_is_bounded_and_uses_the_separate_origin_gated_endpoint(self):
        from unittest.mock import MagicMock
        worker=self.worker();worker.submit_plan=worker.submit_strategy
        response=MagicMock(status_code=429)
        worker.session.post=MagicMock(return_value=response)
        worker.run_once()
        self.assertEqual(worker.session.post.call_count,1)
        call=worker.session.post.call_args
        self.assertEqual(call.args[0],'http://127.0.0.1:8791/plans')
        self.assertEqual(call.kwargs['headers'],{'Origin':'https://8.136.120.255'})
        self.assertEqual(set(call.kwargs['json']),{'from','to','windowId','start'})
        pack=self.store.pack(self.reservation['packId'])
        self.assertEqual(pack['prepared'],0);self.assertEqual(pack['state'],'preparing')

    def test_public_progress_never_counts_a_corrupt_embedded_approval_as_prepared(self):
        worker=self.worker();worker.run_once()
        for _ in range(8):
            pack=self.tick(worker)
            if pack['state']=='ready':break
        pack['execution']['strategies'][0]['controls']={'duration':999}
        self.store.save_pack(pack)
        view=self.client.get('/reservations/'+self.reservation['id'],headers=self.auth).json()['pack']
        self.assertEqual(view['state'],'partial')
        self.assertEqual(view['prepared'],0)
        self.assertEqual(view['strategyPrepared'],0)
