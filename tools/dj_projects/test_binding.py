import copy
import unittest
from tools.dj_projects.bind import bind_request, BindingError, assert_current


def track(id, sha, duration=180):
    return {'id':id,'duration':duration,'mixStatus':'ready','playStatus':'ready',
            'provenance':{'masterSha256':sha*64,'reportSha256':'9'*64,
                          'vocalSha256':'8'*64,'runId':'run-'+id}}


def request():
    return {'schema':'harbeat.authored-cue-request.v1','authority':'author-rule-awaiting-jetson',
            'projectSha256':'e'*64,'sourceUrl':'https://artist.example/set','instructionSource':'Author PDF',
            'sources':{'a':{'id':'1','masterSha256':'a'*64},'b':{'id':'2','masterSha256':'b'*64}},
            'sourceWindow':{'aStart':64,'bStart':8},'overlapBeats':16,
            'automation':None,'executionApproved':False}


class BindingTests(unittest.TestCase):
    def test_exact_master_identity_preserves_cues_and_remains_only_a_proposal(self):
        data=request(); library=[track('nas-A','a'),track('nas-B','b')]
        plan=bind_request(data,library)
        self.assertEqual(plan['sources']['a']['trackId'],'nas-A')
        self.assertEqual(plan['sources']['b']['runId'],'run-nas-B')
        self.assertEqual(plan['cueHints'],{'aStart':64.,'bStart':8.,'overlapBeats':16.})
        self.assertFalse(plan['executionApproved'])
        self.assertIsNone(plan['roleTimeline'])
        self.assertEqual(plan['id'],bind_request(data,library[::-1])['id'])
        self.assertEqual(assert_current(plan,data,library),plan)

    def test_same_name_wrong_bytes_and_ambiguous_local_master_fail_closed(self):
        for lib,code in [([track('same-name-wrong-edit','c'),track('B','b')],'exact-master-unavailable'),
                         ([track('A','a'),track('A-copy','a'),track('B','b')],'exact-master-ambiguous')]:
            with self.subTest(code=code),self.assertRaises(BindingError) as err:
                bind_request(request(),lib)
            self.assertEqual(err.exception.code,code)

    def test_out_of_range_cue_unanalyzed_track_and_forged_approval_rejected(self):
        for override,lib,code in [({},[track('A','a',64),track('B','b')],'cue-out-of-range'),
                                 ({},[{**track('A','a'),'mixStatus':'unavailable'},track('B','b')],'source-analysis-unavailable'),
                                 ({'executionApproved':True},[track('A','a'),track('B','b')],'invalid-request'),
                                 ({'automation':{'bass':'mute-a'}},[track('A','a'),track('B','b')],'invalid-request')]:
            with self.subTest(code=code),self.assertRaises(BindingError) as err:
                bind_request({**request(),**override},lib)
            self.assertEqual(err.exception.code,code)

    def test_report_change_or_cue_tamper_invalidates_bound_input(self):
        data=request();library=[track('A','a'),track('B','b')];plan=bind_request(data,library)
        updated=copy.deepcopy(library);updated[1]['provenance']['reportSha256']='7'*64
        altered=copy.deepcopy(plan);altered['cueHints']['bStart']=24
        for value,lib in [(plan,updated),(altered,library)]:
            with self.assertRaisesRegex(BindingError,'stale'):
                assert_current(value,data,lib)

if __name__=='__main__':unittest.main()
