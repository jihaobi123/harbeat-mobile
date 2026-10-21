import json
import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from activity_sets.service import Settings, create_app
try:
    from activity_sets.music import MusicBridge
except ImportError:
    MusicBridge = None

class Queue:
    def __init__(self): self.rows={};self.calls=0;self.lose_ack=False
    def submit(self,key,payload):
        self.calls+=1
        row=self.rows.setdefault(key,dict(id=str(len(self.rows)+1).zfill(32),status='queued',title=payload['title'],payload=json.dumps(payload),created=1,updated=1,message='',track_id=None))
        if self.lose_ack: self.lose_ack=False;raise OSError('lost acknowledgment')
        return row
    def public(self,identifier):return {k:v for k,v in self.get(identifier).items() if k!='payload'}
    def get(self,identifier):return next(r for r in self.rows.values() if r['id']==identifier)
    def retry(self,identifier):self.get(identifier)['status']='queued'
    def resolve_candidate(self,identifier): return {'source':'netease','id':identifier,'title':'Music','artist':'Artist','duration':120}

class MusicTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(MusicBridge,'music bridge must exist')
        self.tmp=tempfile.TemporaryDirectory();self.settings=Settings(root=Path(self.tmp.name)/'sets',site=Path(self.tmp.name)/'site')
        self.q=Queue()
        def upstream(kind,body):
            if kind=='discover':return {'query':body['q'],'results':[{'provider':'netease','source_id':str(i),'title':'Music','artist':'Artist','duration':120} for i in range(1,12)],'providers':[],'links':[]}
            if kind=='library':return {'query':body['q'],'mode':'text','results':[],'coverage':{'indexed':0,'total':3},'message':'fallback'}
            if kind=='matches':return {'candidates':[{'candidate_id':body['source_id'],'source':'netease','id':body['source_id'],'title':'Music','artist':'Artist','duration':120}],'notes':[]}
        self.settings.site.mkdir();(self.settings.site/'library.json').write_text(json.dumps({'tracks':[]}))
        self.app=create_app(self.settings,run_worker=False,music_queue=self.q,music_upstream=upstream)
        self.c=TestClient(self.app);self.auth={'Authorization':'Bearer '+self.c.post('/workspaces').json()['token']}
    def tearDown(self):
        if hasattr(self,'tmp'):self.tmp.cleanup()
    def candidates(self):
        rows=self.c.get('/music/search?scope=discover&q=music',headers=self.auth).json()['results']
        return [self.c.post('/music/matches',json={'discoveryId':r['discoveryId']},headers=self.auth).json()['candidates'][0]['candidateId'] for r in rows]
    def submit(self,candidate):return self.c.post('/music/download',json={'candidateId':candidate,'style':'Hip-Hop'},headers=self.auth)
    def test_anonymous_and_private_candidates_jobs(self):
        self.assertEqual(self.c.get('/music/search?scope=discover&q=x').status_code,401)
        cid=self.candidates()[0];other={'Authorization':'Bearer '+self.c.post('/workspaces').json()['token']}
        self.assertEqual(self.c.post('/music/download',json={'candidateId':cid},headers=other).status_code,404)
        job=self.submit(cid).json();self.assertEqual(job['status'],'queued');self.assertNotIn('payload',job)
        self.assertEqual(self.c.get('/music/jobs',headers=other).json()['jobs'],[])
        self.assertEqual(self.c.post('/music/jobs/'+job['id']+'/retry',headers=other).status_code,404)
    def test_active_and_daily_limits(self):
        ids=self.candidates()
        for i,cid in enumerate(ids[:8]):
            result=self.submit(cid);self.assertEqual(result.status_code,200,result.text)
            if i==1:self.assertEqual(self.submit(ids[2]).status_code,429)
            if i>=1:
                for row in self.q.rows.values():row['status']='ready'
        self.assertEqual(self.submit(ids[8]).status_code,429)
    def test_expiry_and_recovery_after_lost_ack(self):
        cid=self.candidates()[0];self.q.lose_ack=True
        result=self.submit(cid);self.assertEqual(result.status_code,200,result.text)
        self.app.state.music.tick();self.assertEqual(len(self.q.rows),1)
        self.assertEqual(self.c.get('/music/jobs',headers=self.auth).json()['jobs'][0]['status'],'queued')
        with self.app.state.store.connection() as db:db.execute('UPDATE music_candidates SET created=0')
        self.assertEqual(self.submit(cid).status_code,410)
    def test_queue_capacity_failure_needs_explicit_owned_retry(self):
        cid=self.candidates()[0];submit=self.q.submit
        self.q.submit=lambda *args: (_ for _ in ()).throw(ValueError('queue full'))
        failed=self.submit(cid).json();self.assertEqual(failed['status'],'failed')
        self.q.submit=submit;self.app.state.music.tick()
        self.assertEqual(len(self.q.rows),0,'a failed outbox must not silently retry')
        retried=self.c.post('/music/jobs/'+failed['id']+'/retry',headers=self.auth)
        self.assertEqual(retried.status_code,200,retried.text)
        self.app.state.music.tick();self.assertEqual(len(self.q.rows),1)

    def test_upload_requires_auth_valid_audio_and_deduplicates(self):
        import io,wave
        self.app.state.music.import_root=self.settings.root/'imports'
        raw=io.BytesIO()
        with wave.open(raw,'wb') as output:
            output.setnchannels(1);output.setsampwidth(2);output.setframerate(8000);output.writeframes(b'\x00\x00'*8000*20)
        self.assertEqual(self.c.post('/music/upload',files={'audio':('sample.wav',raw.getvalue())}).status_code,401)
        bad=self.c.post('/music/upload',files={'audio':('sample.wav',b'bad')},headers=self.auth)
        self.assertEqual(bad.status_code,422,bad.text)
        good=self.c.post('/music/upload',files={'audio':('sample.wav',raw.getvalue())},data={'title':'Example','style':'Hip-Hop'},headers=self.auth)
        self.assertEqual(good.status_code,200,good.text)
        again=self.c.post('/music/upload',files={'audio':('sample.wav',raw.getvalue())},headers=self.auth)
        self.assertEqual(again.json()['id'],good.json()['id'])
        self.assertEqual(len(self.q.rows),1)

    def test_duplicate_submission_with_cover_does_not_write_schema_under_transaction(self):
        cid=self.candidates()[0];job=self.submit(cid).json()
        for row in self.q.rows.values():row['status']='ready'
        with self.app.state.store.connection() as db:
            row=db.execute('SELECT data FROM music_jobs WHERE id=?',(job['id'],)).fetchone()
            data=json.loads(row['data']);data['coverUrl']='/listen/music-covers/'+'e'*64+'.jpg'
            db.execute('UPDATE music_jobs SET data=? WHERE id=?',(json.dumps(data),job['id']))
        duplicate=self.submit(cid)
        self.assertEqual(duplicate.status_code,200,duplicate.text)
        self.assertEqual(duplicate.json()['id'],job['id'])
        self.assertNotIn('coverUrl',duplicate.json())

    def test_search_joins_only_current_published_ids_and_preserves_single_playback(self):
        rows=[{'id':'track-123','title':'Published','playStatus':'ready','mixStatus':'blocked','bpm':95}]
        (self.settings.site/'library.json').write_text(json.dumps({'tracks':rows}))
        self.app.state.music.upstream=lambda *args:{'mode':'semantic','results':[{'id':'track-123','score':.8},{'id':'removed','score':.99}],'coverage':{'indexed':1,'total':1}}
        result=self.c.get('/music/search?q=night',headers=self.auth).json()
        self.assertEqual(len(result['results']),1)
        self.assertEqual(result['results'][0]['title'],'Published')
        self.assertEqual(result['results'][0]['mixStatus'],'blocked')
        self.assertEqual(result['results'][0]['score'],.8)

    def test_text_search_reports_degradation_without_inventing_hits(self):
        data=self.c.get('/music/search?scope=library&q=relaxed',headers=self.auth).json()
        self.assertEqual(data['mode'],'text');self.assertEqual(data['coverage']['total'],3);self.assertEqual(data['results'],[])

if __name__=='__main__':unittest.main()
