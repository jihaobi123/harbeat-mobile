"""Synthetic, temporary fixtures exercise export mechanics, never real approval."""
import copy
import hashlib
import json
import math
import os
import pathlib
import struct
import subprocess
import tempfile
import unittest

import four_role_export as export

ROOT=pathlib.Path(__file__).resolve().parents[1]
SR=44100
H='a'*64

def original_id(value):
    body={k:v for k,v in value.items() if k!='id'}
    return hashlib.sha256(json.dumps(body,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()

def save_scene(case,value):
    value['id']=original_id(value)
    (case/'scene.json').write_text(json.dumps(value,ensure_ascii=False,allow_nan=False))

def proof(letter):
    return dict(trackId='track-'+letter*20,runId='synthetic-only-'+letter,masterSha256=letter*64,reportSha256=H,vocalSha256='4'*64,manifestSha256=H,profileSha256=H,stemSha256=dict(drums='1'*64,bass='2'*64,other='3'*64,vocals='4'*64))

def fixture(root):
    sources={s:proof(s) for s in 'abcd'}
    scene=dict(schema='harbeat.two-source-scene.v1',scope='audition-only',producer='jetson',approved=True,id=H,implementationSha256=H,title='合成测试，不是真实批准',fromTitle='A',toTitle='B',sampleRate=SR,bpm=96,rate=1,duration=40,lead=8,tail=16,outputGain=.5,sourceGains=dict(a=1,b=1),sources={s:sources[s] for s in 'ab'},clips=dict(aStart=40,aEnd=45,bStart=20,bEnd=60),layers=[dict(side=s,role=r,loop=s=='a',points=[[0,1],[40,0]] if s=='a' else [[0,1],[40,1]] if r=='vocals' else [[0,0],[40,1]]) for s in 'ab' for r in ('drums','bass','other','vocals') if not(s=='a' and r=='vocals')],exits=[dict(at=t,fadeStart=t-2.5,bPosition=20+t,peak=.8) for t in (20,30,40)],evidence=dict(aVocalSilent=True,bEntryComplete=True,reconstruction=dict(a=.1,b=.1),pitchedRisk=.2,peak=.8,loopSeamDb=-30,beatErrorMs=20,runtime='master-guided-wsola-v1',limitations=[]))
    sha=hashlib.sha256(json.dumps(scene,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
    base=dict(schema='harbeat.live-layering.v1',scope='normal-playback-lab',producer='jetson',approved=True,id='b'*64,implementationSha256='c'*64,sceneSha256=sha,scene=scene,nativeGain=.76,entry=dict(sourcePosition=40,fadeSeconds=.008,peak=.8),evidence=dict(runtime='live-layering-linear-8ms-v1',sourceVerified=True,producerHost='synthetic-test-only',entryPeak=.8,exitPeaks=[dict(at=e['at'],bPosition=e['bPosition'],peak=.8) for e in scene['exits']],limitations=[]))
    originals=[dict(key=l['side']+'.'+l['role'],source=l['side'],role=l['role'],loop=l['loop'],outputStart=0,sourceStart=scene['clips'][l['side']+'Start'],rate=1,gain=.5,points=copy.deepcopy(l['points'])) for l in scene['layers']]
    cross=[[0,0],[5,0],[5.625,1],[14.375,1],[15,0],[40,0]]
    c=dict(key='c.other',source='c',role='other',loop=False,outputStart=5,sourceStart=10,rate=1,gain=.5,points=cross)
    stage1=copy.deepcopy(originals);other=next(l for l in stage1 if l['key']=='b.other');other['points']=[[t,t/40*(1-v)] for t,v in cross];stage1.append(c)
    d=dict(key='d.vocals',source='d',role='vocals',loop=False,outputStart=6.25,sourceStart=20,rate=1,gain=.5,points=[[0,0],[6.25,0],[6.33,1],[10.1,1],[10.25,0],[40,0]])
    stage2=copy.deepcopy(stage1);next(l for l in stage2 if l['key']=='b.vocals')['points']=[[0,1],[6.17,1],[6.25,0],[10.25,0],[10.33,1],[40,1]];stage2.append(d)
    def evidence(count):
        names=['A/B','A/C','B/C']+(['A/D','B/D','C/D'] if count==4 else [])
        pairs={n:dict(pass_=True,pitchedRisk=.2,incompatiblePitchedSeconds=0) for n in names}
        return dict(bpm=96,sourceVerified=True,peak=.8,reconstruction=.1,beatErrorMs=20,loopSeamDb=-30,vocalMaxDb=-60,vocalBoundariesClear=True,originalVocalPreserved=True,lowEnergyRatio=1,onsetGrowth=1,pairwise=pairs,exitPeaks=[.8]*3,exitChecks=[dict(at=t,pairwise=copy.deepcopy(pairs),peak=.8,lowEnergyRatio=1,onsetGrowth=1) for t in (20,30,40)],**(dict(simultaneousFourRoleSeconds=2) if count==4 else {}))
    asset_dir=root/'audition-synthetic';asset_dir.mkdir()
    assets={}
    for key in [l['key'] for l in stage2]:
        frames=5*SR if key.startswith('a.') else math.ceil((40+.008)*SR) if key.startswith('b.') else 10*SR if key.startswith('c.') else 4*SR
        payload=bytearray(frames*8)
        if key=='d.vocals':payload[SR//2*8:int(3.5*SR)*8]=struct.pack('<ff',.1,.1)*(3*SR)
        fmt=struct.pack('<HHIIHH',3,2,SR,SR*8,8,32);chunks=b'fmt '+struct.pack('<I',len(fmt))+fmt+b'data'+struct.pack('<I',len(payload))+payload
        path=asset_dir/(key+'.wav');path.write_bytes(b'RIFF'+struct.pack('<I',len(chunks)+4)+b'WAVE'+chunks)
        assets[key]=dict(url=path.name,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),frames=frames)
    value=dict(schema='harbeat.four-role-audition.v1',scope='audition-only',producer='jetson',producerHost='SYNTHETIC-TEST-ONLY',implementations=dict(scan=H,rules=H),approved=True,qualityStatus='approved-for-audition',requiresReview=[],sampleRate=SR,duration=40,bpm=96,base=base,window=[5,15],sources={s:dict(title=s.upper(),proof=sources[s]) for s in 'abcd'},assets=assets,stages=[dict(id=0,layers=originals,evidence=base['evidence']),dict(id=1,layers=stage1,evidence=evidence(3)),dict(id=2,layers=stage2,evidence=evidence(4))],limitations=['SYNTHETIC TEST FIXTURE, NOT A REAL APPROVAL'])
    save_scene(asset_dir,value)
    ccase=root/'abc-synthetic';ccase.mkdir();cv=copy.deepcopy(value);cv['stages']=cv['stages'][:2];cv['sources'].pop('d');cv['assets'].pop('d.vocals')
    for item in cv['assets'].values():os.link(asset_dir/item['url'],ccase/item['url'])
    save_scene(ccase,cv)
    tracks={p['trackId']:dict(id=p['trackId'],title=s.upper(),bpm=96,duration=100,vocals=[[20.5,23.5]] if s=='d' else [],provenance={k:p[k] for k in ('masterSha256','reportSha256','vocalSha256','runId')}) for s,p in sources.items()}
    return asset_dir,value,ccase,cv,tracks

class ExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(prefix='SYNTHETIC-four-role-export-');cls.root=pathlib.Path(cls.temp.name)
        cls.case,cls.audition,cls.ccase,cls.cvalue,cls.tracks=fixture(cls.root)
    @classmethod
    def tearDownClass(cls):cls.temp.cleanup()
    def setUp(self):save_scene(self.case,copy.deepcopy(self.audition));save_scene(self.ccase,copy.deepcopy(self.cvalue))
    def test_unapproved_and_review_cases_cannot_be_promoted(self):
        for change in [lambda v:v.update(approved=False),lambda v:v.update(qualityStatus='needs-vocal-review'),lambda v:v.update(requiresReview=['vocal-identity']),lambda v:v['stages'][1]['evidence'].update(vocalMaxDb=-40)]:
            v=copy.deepcopy(self.audition);change(v);save_scene(self.case,v)
            with self.assertRaisesRegex(ValueError,'approve|review|批准|vocal'):export.validate_audition(self.case,self.tracks,2)
    def test_original_python_id_and_all_wav_asset_hashes_and_frames_are_verified(self):
        v=copy.deepcopy(self.audition);v['stages'][2]['layers'][-1]['gain']=.6;(self.case/'scene.json').write_text(json.dumps(v))
        with self.assertRaisesRegex(ValueError,'id|fingerprint|指纹'):export.validate_audition(self.case,self.tracks,2)
        for key,field,value in [('a.drums','sha256','f'*64),('c.other','frames',1),('d.vocals','url','../outside.wav')]:
            v=copy.deepcopy(self.audition);v['assets'][key][field]=value;save_scene(self.case,v)
            with self.assertRaises(ValueError):export.validate_audition(self.case,self.tracks,2)
    def test_changed_source_and_role_curves_are_rejected_even_with_a_new_audition_id(self):
        for change in [lambda v:v['stages'][1]['layers'][0].update(sourceStart=41),lambda v:v['stages'][1]['layers'][-1]['points'][2].__setitem__(1,.5),lambda v:v['stages'][2]['layers'][-1].update(loop=True),lambda v:v['stages'][2]['layers'][-1]['points'][2].__setitem__(0,6.4)]:
            v=copy.deepcopy(self.audition);change(v);save_scene(self.case,v)
            with self.assertRaises(ValueError):export.validate_audition(self.case,self.tracks,2)
        for change in [lambda t:t[next(iter(t))]['provenance'].update(reportSha256='f'*64),lambda t:t['track-'+'a'*20].update(bpm=90),lambda t:t['track-'+'c'*20].update(bpm=90),lambda t:t['track-'+'d'*20].update(vocals=[[19.9,23.5]]),lambda t:t['track-'+'b'*20].update(vocals=[[26,31]])]:
            save_scene(self.case,copy.deepcopy(self.audition));tracks=copy.deepcopy(self.tracks);change(tracks)
            with self.assertRaises(ValueError):export.validate_audition(self.case,tracks,2)
    def test_direct_d_wav_head_tail_and_native_vad_are_rechecked_without_proposals(self):
        path=self.case/'d.vocals.wav';original=path.read_bytes()
        try:
            for offset in (44,len(original)-100*8):
                changed=bytearray(original);changed[offset:offset+100*8]=struct.pack('<ff',.1,.1)*100;path.write_bytes(changed);v=copy.deepcopy(self.audition);v['assets']['d.vocals']['sha256']=hashlib.sha256(changed).hexdigest();save_scene(self.case,v)
                with self.assertRaisesRegex(ValueError,'boundary|quiet'):export.validate_audition(self.case,self.tracks,2)
        finally:path.write_bytes(original)
        save_scene(self.case,copy.deepcopy(self.audition))
        for vocals in ([],None,[[20.5,23.9]],[[20.5,23.5],[24.05,26]]):
            tracks=copy.deepcopy(self.tracks);tracks['track-'+'d'*20]['vocals']=vocals
            with self.assertRaises(ValueError):export.validate_audition(self.case,tracks,2)
        tracks=copy.deepcopy(self.tracks);tracks['track-'+'b'*20]['vocals']=[[25,35]]
        self.assertEqual(export.validate_audition(self.ccase,tracks,1)['stage']['id'],1)
    def test_c_only_requires_its_own_strict_original_case_and_the_pinned_original_file(self):
        with self.assertRaises(ValueError):export.validate_audition(self.case,self.tracks,1)
        with self.assertRaises(ValueError):export.validate_audition(self.ccase,self.tracks,1,expected_audition_sha256='f'*64)
        checked=export.validate_audition(self.ccase,self.tracks,1);self.assertEqual(checked['stage']['id'],1)
    def test_synthetic_positive_export_passes_actual_phone_contract_and_binds_measurement_origin(self):
        helper=export.build_contract_helper(ROOT,self.root/'contract-check.cjs')
        for stage,case,mode in [(1,self.ccase,'roles-c'),(2,self.case,'roles-cd')]:
            output=self.root/('SYNTHETIC-OUTPUT-'+mode);pin=hashlib.sha256((case/'scene.json').read_bytes()).hexdigest()
            result=export.export_case(case,self.tracks,output,stage,helper=helper,expected_audition_sha256=pin)
            role=json.loads(pathlib.Path(result['path']).read_text());measurement_path=pathlib.Path(result['measurements']);record=json.loads(measurement_path.read_text())
            self.assertEqual(role['mode'],mode);self.assertEqual(role['base'],self.audition['base']);self.assertEqual(record['arrangementSha256'],role['evidence']['arrangementSha256']);self.assertEqual(record['sourceMeasurement']['auditionSha256'],pin);self.assertEqual(record['sourceMeasurement']['stage']['layers'],self.audition['stages'][stage]['layers']);self.assertEqual(hashlib.sha256(measurement_path.read_bytes()).hexdigest(),role['evidence']['measurementsSha256'])
            verified=export.run_contract_helper(helper,dict(action='check',value=role));self.assertTrue(verified['valid'])
            index=json.loads((output/'index.json').read_text());self.assertEqual(index['schema'],'harbeat.role-replacement-index.v1');self.assertEqual(index['scenes'][0]['sources'],stage)
            if stage==2:self.assertEqual(role['layers'][1]['vocalBoundary']['headMaxDb'],-240.)
            self.assertEqual(export.export_case(case,self.tracks,output,stage,helper=helper,expected_audition_sha256=pin)['sha256'],result['sha256'])
    def test_existing_isolated_index_must_remain_valid_before_writing_any_new_contract(self):
        output=self.root/'SYNTHETIC-BAD-INDEX';output.mkdir();(output/'index.json').write_text(json.dumps(dict(schema='harbeat.role-replacement-index.v1',scenes=[dict(baseId=H,sha256=H,url='https://outside.test/changed.json',sources=1)])))
        helper=export.build_contract_helper(ROOT,self.root/'index-check.cjs')
        with self.assertRaisesRegex(ValueError,'index'):export.export_case(self.ccase,self.tracks,output,1,helper=helper)
        self.assertEqual(list(output.glob('[0-9a-f]*.json')),[])
    def test_nonunit_role_keeps_measured_output_frames_and_derives_source_input_frames(self):
        v=copy.deepcopy(self.cvalue);v['stages'][1]['layers'][-1]['rate']=1.01;v['stages'][1]['layers'][-1]['sourceStart']=10.25;save_scene(self.ccase,v)
        tracks=copy.deepcopy(self.tracks);tracks['track-'+'c'*20]['bpm']=96/1.01;helper=export.build_contract_helper(ROOT,self.root/'rate-check.cjs')
        result=export.export_case(self.ccase,tracks,self.root/'SYNTHETIC-NONUNIT',1,helper=helper);value=json.loads(pathlib.Path(result['path']).read_text());layer=value['layers'][0]
        self.assertEqual(layer['sourceStartFrame'],round(10.25*SR));self.assertEqual(layer['lengthFrames'],round(10*SR*1.01));self.assertEqual(round(layer['lengthFrames']/layer['rate']),10*SR);self.assertAlmostEqual(layer['sourceBpm'],96/1.01)
    def test_unknown_measured_processing_arguments_are_not_silently_removed(self):
        value=copy.deepcopy(self.cvalue);value['stages'][1]['layers'][-1]['filter']=dict(kind='lowpass',frequency=1000);save_scene(self.ccase,value)
        with self.assertRaisesRegex(ValueError,'argument|layer|processing'):export.validate_audition(self.ccase,self.tracks,1)
    def test_original_calibration_floor_is_bound_to_base_gain_and_hints_remain_valid(self):
        def measured_case(gain):
            v=copy.deepcopy(self.audition);v['base']['scene']['outputGain']=.475
            v['base']['sceneSha256']=hashlib.sha256(json.dumps(v['base']['scene'],sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
            for stage in v['stages']:
                for layer in stage['layers']:layer['gain']=.475 if layer['source'] in 'ab' else gain
            return v
        floor=.475*.5;v=measured_case(floor);save_scene(self.case,v)
        helper=export.build_contract_helper(ROOT,self.root/'calibration-check.cjs')
        result=export.export_case(self.case,self.tracks,self.root/'SYNTHETIC-CALIBRATION',2,helper=helper);role=json.loads(pathlib.Path(result['path']).read_text());self.assertEqual([l['gain'] for l in role['layers']],[floor,floor])
        for source in 'cd':
            bad=measured_case(floor);next(l for l in bad['stages'][2]['layers'] if l['source']==source)['gain']=floor-.000001
            if source=='c':next(l for l in bad['stages'][1]['layers'] if l['source']=='c')['gain']=floor-.000001
            save_scene(self.case,bad)
            with self.assertRaises(ValueError):export.validate_audition(self.case,self.tracks,2)
        save_scene(self.case,measured_case(.25));self.assertEqual(export.validate_audition(self.case,self.tracks,2)['stage']['id'],2)

if __name__=='__main__':unittest.main()
