#!/usr/bin/env python3
"""Export an unchanged, strictly approved Jetson audition to the phone contract.

This local tool never publishes metadata or creates acoustic approval. Source
curves, gains and coordinates come exclusively from the hash-verified audition.
The companion TypeScript adapter verifies the actual phone admission rules.
Role gain keeps the original calibration floor (.5 * base outputGain), up to 1;
this does not change acoustic thresholds or four-role audibility admission.
"""
import argparse
import array
import copy
import hashlib
import json
import math
import os
import pathlib
import re
import shutil
import struct
import subprocess
import sys
import tempfile

from four_role import approve,validate_steps,vocal_schedule,original_vocal_gap,target_rate

SR=44100
HASH=re.compile(r'^[a-f0-9]{64}$')
ROLES=('drums','bass','other','vocals')

def sha(data):return hashlib.sha256(data).hexdigest()
def numeric(value):return type(value) in (int,float) and math.isfinite(value)
def near(a,b,tolerance=1e-8):return numeric(a) and numeric(b) and abs(a-b)<=tolerance
def python_json(value):return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()

def load_json(path,limit=8*1024*1024):
    path=pathlib.Path(path)
    if path.stat().st_size>limit:raise ValueError('JSON metadata exceeds budget')
    def pairs(rows):
        result={}
        for key,value in rows:
            if key in result:raise ValueError('duplicate JSON key: '+key)
            result[key]=value
        return result
    def invalid(value):raise ValueError('nonfinite JSON value: '+value)
    raw=path.read_bytes()
    return json.loads(raw,parse_constant=invalid,object_pairs_hook=pairs),raw

def wav_asset(case,key,asset):
    if not re.fullmatch(r'[abcd]\.(drums|bass|other|vocals)',key) or not isinstance(asset,dict) or asset.get('url')!=key+'.wav' or not HASH.fullmatch(str(asset.get('sha256',''))) or type(asset.get('frames')) is not int or asset['frames']<1:raise ValueError('invalid WAV asset identity or path')
    path=(case/asset['url']).resolve()
    if path.parent!=case.resolve() or path.stat().st_size>64*1024*1024:raise ValueError('WAV asset outside case or budget')
    raw=path.read_bytes()
    if sha(raw)!=asset['sha256']:raise ValueError('WAV asset SHA mismatch: '+key)
    if len(raw)<12 or raw[:4]!=b'RIFF' or raw[8:12]!=b'WAVE' or struct.unpack_from('<I',raw,4)[0]+8!=len(raw):raise ValueError('invalid RIFF/WAVE coverage')
    at=12;fmt=None;data=None;fact=None
    while at<len(raw):
        if at+8>len(raw):raise ValueError('truncated WAV chunk header')
        name=raw[at:at+4];size=struct.unpack_from('<I',raw,at+4)[0];start=at+8;end=start+size
        if end>len(raw):raise ValueError('truncated WAV chunk data')
        if name==b'fmt ':
            if fmt is not None or size<16:raise ValueError('invalid WAV format chunk')
            fmt=struct.unpack_from('<HHIIHH',raw,start)
        elif name==b'data':
            if data is not None:raise ValueError('multiple WAV data chunks')
            data=raw[start:end]
        elif name==b'fact':
            if size<4:raise ValueError('invalid WAV fact chunk')
            fact=struct.unpack_from('<I',raw,start)[0]
        at=end+(size%2)
    if at!=len(raw) or fmt!=(3,2,SR,SR*8,8,32) or data is None or len(data)%8:raise ValueError('requires complete float32 stereo 44100-Hz WAV')
    frames=len(data)//8
    if frames!=asset['frames'] or fact is not None and fact!=frames:raise ValueError('WAV frame count mismatch: '+key)
    samples=array.array('f');samples.frombytes(data)
    if sys.byteorder!='little':samples.byteswap()
    if not all(math.isfinite(x) for x in samples):raise ValueError('nonfinite WAV samples')
    return dict(sha256=asset['sha256'],pcmSha256=sha(data),frames=frames,sampleRate=SR,channels=2),samples if key=='d.vocals' else None

def value_at(points,time):
    for (left,a),(right,b) in zip(points,points[1:]):
        if time<=right:return a+(b-a)*(time-left)/(right-left)
    return points[-1][1]

def curve_equal(a,b):
    if not isinstance(a,list) or len(a)<2:return False
    for i,p in enumerate(a):
        if not isinstance(p,list) or len(p)!=2 or not all(numeric(v) for v in p) or i and p[0]<=a[i-1][0]:return False
    return all(near(value_at(a,t),value_at(b,t),1e-7) for t in {p[0] for p in a+b})

def layer_map(layers):
    if not isinstance(layers,list):raise ValueError('missing measured role layers')
    result={}
    for layer in layers:
        if not isinstance(layer,dict) or layer.get('key') in result:raise ValueError('duplicate measured role layer')
        result[layer.get('key')]=layer
    return result

def layers_equal(actual,expected):
    a,b=layer_map(actual),layer_map(expected)
    if set(a)!=set(b):return False
    for key in a:
        one,two=dict(a[key]),dict(b[key]);ap=one.pop('points',None);bp=two.pop('points',None)
        if one!=two or not curve_equal(ap,bp):return False
    return True

def intervals(track):
    rows=track.get('vocals')
    if not isinstance(rows,list):raise ValueError('source vocal intervals unknown')
    previous=-1
    for row in rows:
        if not isinstance(row,list) or len(row)!=2 or not all(numeric(x) for x in row) or row[0]<0 or row[1]<=row[0] or row[0]<previous:raise ValueError('invalid source vocal intervals')
        previous=row[0]
    return rows

def vocal_boundary(samples,layer,track,b_track,b_start):
    frames=len(samples)//2;start=layer['sourceStart'];rate=layer['rate'];end=start+frames/SR*rate
    merged=[]
    for lo,hi in intervals(track):
        if merged and lo-merged[-1][1]<.35:merged[-1][1]=max(merged[-1][1],hi)
        else:merged.append([lo,hi])
    if any(lo<start+.1 and hi>start-.1 for lo,hi in merged):raise ValueError('D source entry cuts an active phrase')
    phrases=[(lo,hi) for lo,hi in merged if lo<end and hi>start]
    if len(phrases)!=1:raise ValueError('D source must contain one complete vocal phrase')
    lo,hi=phrases[0]
    if lo<=start or lo-start>1.5 or hi-lo<2 or end-hi<.22-1/SR or end+1>=track['duration']:raise ValueError('D phrase or natural tail coverage incomplete')
    if any(next_start<end+.12-1/SR for next_start,_ in merged if next_start>hi):raise ValueError('D native tail reaches the next phrase')
    output_end=layer['outputStart']+frames/SR
    if not original_vocal_gap(intervals(b_track),b_start,layer['outputStart'],output_end):raise ValueError('original B vocal phrase would be cut')
    def db(data):return 20*math.log10(max(1e-12,math.sqrt(sum(float(x)*x for x in data)/len(data))))
    head=db(samples[:round(.08*SR)*2]);tail=db(samples[-round(.15*SR)*2:])
    if head> -45 or tail> -45:raise ValueError('D WAV vocal boundary is not quiet')
    return dict(entryClear=True,tailComplete=True,headMaxDb=head,tailMaxDb=tail),dict(sourceStart=start,sourceEnd=end,phrase=[lo,hi],originalBGap=[b_start+layer['outputStart']-.08,b_start+output_end+.08],headSeconds=.08,tailSeconds=.15,headMaxDb=head,tailMaxDb=tail)

def validate_stage_evidence(e,count,base):
    if not isinstance(e,dict) or not approve(e,count):raise ValueError('stage is not strictly approved; vocal review cannot be promoted')
    exits=base['scene']['exits'];checks=e.get('exitChecks')
    if not near(e.get('bpm'),base['scene']['bpm']) or not isinstance(checks,list) or len(checks)!=3:raise ValueError('three measured original exits required')
    for i,(row,exit) in enumerate(zip(checks,exits)):
        if not isinstance(row,dict) or not near(row.get('at'),exit['at']) or not near(row.get('peak'),e['exitPeaks'][i]):raise ValueError('measured exit identity changed')
        current={**e,**{k:row.get(k) for k in ('peak','pairwise','lowEnergyRatio','onsetGrowth')},'exitPeaks':[row.get('peak')]*3}
        if not approve(current,count):raise ValueError('individual exit is not strictly approved')
        if any(e[k]<row[k]-1e-8 for k in ('peak','lowEnergyRatio','onsetGrowth')):raise ValueError('aggregate evidence understates an exit')
        for name,pair in row['pairwise'].items():
            if any(e['pairwise'][name][k]<pair[k]-1e-8 for k in ('pitchedRisk','incompatiblePitchedSeconds')):raise ValueError('pairwise aggregate understates an exit')

def validate_audition(case_dir,tracks,stage,expected_audition_sha256=None):
    case=pathlib.Path(case_dir);v,raw=load_json(case/'scene.json');file_sha=sha(raw)
    if expected_audition_sha256 is not None and (not HASH.fullmatch(expected_audition_sha256) or file_sha!=expected_audition_sha256):raise ValueError('pinned original audition file fingerprint mismatch')
    if not isinstance(v,dict) or v.get('schema')!='harbeat.four-role-audition.v1' or v.get('scope')!='audition-only' or v.get('producer')!='jetson' or v.get('approved') is not True or v.get('qualityStatus')!='approved-for-audition' or v.get('requiresReview')!=[]:raise ValueError('unapproved or needs-review audition cannot be promoted')
    if not HASH.fullmatch(str(v.get('id',''))) or sha(python_json({k:x for k,x in v.items() if k!='id'}))!=v['id']:raise ValueError('original audition id fingerprint mismatch')
    stages=v.get('stages');base=v.get('base');scene=base.get('scene') if isinstance(base,dict) else None
    if type(stage) is not int or stage not in (1,2) or not isinstance(stages,list) or len(stages)!=stage+1:raise ValueError('C-only requires its own strict original abc case; invalid export stage')
    if not isinstance(scene,dict) or base.get('approved') is not True or base.get('schema')!='harbeat.live-layering.v1' or v.get('sampleRate')!=SR or not near(v.get('duration'),scene.get('duration')) or not near(v.get('bpm'),scene.get('bpm')) or len(scene.get('exits',[]))!=3:raise ValueError('immutable base identity or clock changed')
    for i,item in enumerate(stages):
        if not isinstance(item,dict) or item.get('id')!=i:raise ValueError('invalid measured stage order')
        if i:validate_stage_evidence(item.get('evidence'),i+2,base)
    if stages[0].get('evidence')!=base['evidence']:raise ValueError('original AB evidence changed')
    sources=v.get('sources',{});expected=set('abc'+('d' if stage==2 else ''))
    if set(sources)!=expected:raise ValueError('audition source set changed')
    selected={};ids=set()
    for side in sorted(sources):
        record=sources[side];p=record.get('proof',{});tid=p.get('trackId');track=tracks.get(tid)
        if not isinstance(track,dict) or tid in ids or track.get('id')!=tid or record.get('title')!=track.get('title') or not numeric(track.get('duration')) or track['duration']<=0 or not numeric(track.get('bpm')):raise ValueError('current source identity or tempo unavailable')
        if any(track.get('provenance',{}).get(k)!=p.get(k) for k in ('masterSha256','reportSha256','vocalSha256','runId')):raise ValueError('current source proof changed')
        if side in 'ab' and p!=scene['sources'][side]:raise ValueError('immutable A/B source changed')
        if side in 'ab' and not near(track['bpm'],scene['bpm']):raise ValueError('immutable A/B source tempo changed')
        if side=='a' and track['duration']<=base['entry']['sourcePosition']+scene['duration']+.1 or side=='b' and track['duration']<scene['exits'][-1]['bPosition']+16:raise ValueError('immutable native continuation coverage missing')
        ids.add(tid);selected[side]=track
    original=[dict(key=l['side']+'.'+l['role'],source=l['side'],role=l['role'],loop=l['loop'],outputStart=0,sourceStart=scene['clips'][l['side']+'Start'],rate=1,gain=scene['sourceGains'][l['side']]*scene['outputGain'],points=copy.deepcopy(l['points'])) for l in scene['layers']]
    if not layers_equal(stages[0].get('layers'),original):raise ValueError('original AB coordinates, roles or gains changed')
    all_layers=[l for item in stages for l in item['layers']]
    measured_arguments={'key','source','role','loop','outputStart','sourceStart','rate','gain','points'}
    for layer in all_layers:
        if not isinstance(layer,dict) or set(layer)!=measured_arguments or layer.get('source') not in ('a','b','c','d') or layer.get('role') not in ROLES or layer.get('key')!=layer['source']+'.'+layer['role'] or type(layer.get('loop')) is not bool or not all(numeric(layer.get(k)) for k in ('outputStart','sourceStart','rate','gain')) or layer['outputStart']<0 or layer['sourceStart']<0 or layer['rate']<=0 or layer['gain']<0 or not curve_equal(layer.get('points'),layer.get('points')):raise ValueError('unknown or invalid measured layer processing arguments')
    validate_steps([{r:[l for l in item['layers'] if l['role']==r] for r in ROLES} for item in stages])
    keys={l['key'] for l in all_layers};assets=v.get('assets',{})
    if set(assets)!=keys:raise ValueError('asset set does not match measured roles')
    verified={};voice=None
    for key,asset in assets.items():
        verified[key],samples=wav_asset(case,key,asset)
        if samples is not None:voice=samples
        if key[0] in 'ab':
            count=round((scene['clips']['aEnd']-scene['clips']['aStart'])*SR) if key[0]=='a' else math.ceil((scene['duration']+.008)*SR)
            if verified[key]['frames']!=count:raise ValueError('immutable AB PCM coverage changed')
    input_windows={}
    for side in 'c'+('d' if stage==2 else ''):
        l=layer_map(stages[stage]['layers']).get(side+'.'+('other' if side=='c' else 'vocals'));track=selected[side];rate=target_rate(scene['bpm'],track['bpm'])
        if not l or not numeric(l.get('rate')) or not near(l['rate'],rate,1e-9) or not .95<=rate<=1.05 or not numeric(l.get('sourceStart')) or l['sourceStart']<0 or not numeric(l.get('gain')) or not scene['outputGain']*.5<=l['gain']<=1:raise ValueError('source cue, rate or actual role gain changed')
        frames=verified[l['key']]['frames'];length=round(frames*rate);start=round(l['sourceStart']*SR)
        if math.floor(length/rate+.5)!=frames or start/SR+length/SR+(0 if rate==1 else .5)>track['duration']:raise ValueError('source input/output frame coverage mismatch')
        input_windows[side]=dict(sourceBpm=track['bpm'],sourceStartFrame=start,lengthFrames=length,outputFrames=frames,rate=rate)
    window=v.get('window');duration=scene['duration'];beat=60/scene['bpm']
    if not isinstance(window,list) or len(window)!=2 or not all(numeric(x) for x in window) or not .08<=window[0]<window[1]<=scene['exits'][0]['fadeStart'] or window[1]-window[0]<=2*beat:raise ValueError('measured role window changed')
    left,right=window;cross=[[0,0],[left,0],[left+beat,1],[right-beat,1],[right,0],[duration,0]]
    c=layer_map(stages[1]['layers']).get('c.other')
    if not c or c.get('source')!='c' or c.get('role')!='other' or c.get('loop') is not False or not near(c.get('outputStart'),left) or not curve_equal(c.get('points'),cross) or verified['c.other']['frames']!=round((right-left)*SR):raise ValueError('measured C role window or curve changed')
    expected_c=copy.deepcopy(original);other=next(l for l in expected_c if l['key']=='b.other');points=other['points'];knots=sorted({p[0] for p in points+cross});other['points']=[[t,value_at(points,t)*(1-value_at(cross,t))] for t in knots];expected_c.append(c)
    if not layers_equal(stages[1]['layers'],expected_c):raise ValueError('C changed another original role or accompaniment complement')
    boundary=None;boundary_checks=None
    if stage==2:
        d=layer_map(stages[2]['layers']).get('d.vocals')
        if not d or d.get('source')!='d' or d.get('role')!='vocals' or d.get('loop') is not False or not numeric(d.get('outputStart')):raise ValueError('measured D role or complete phrase changed')
        delay=(d['outputStart']-left)/beat
        if not near(delay,round(delay)) or not 0<=delay<=8:raise ValueError('D output clock changed')
        schedule=vocal_schedule(left,verified['d.vocals']['frames']/SR,round(delay),scene['bpm'],scene['exits'][0]['fadeStart'],duration)
        if not curve_equal(d.get('points'),schedule['voicePoints']):raise ValueError('D complete vocal curve changed')
        expected_d=copy.deepcopy(stages[1]['layers']);next(l for l in expected_d if l['key']=='b.vocals')['points']=schedule['bedPoints'];expected_d.append(d)
        if not layers_equal(stages[2]['layers'],expected_d):raise ValueError('D changed another role or original vocal schedule')
        boundary,boundary_checks=vocal_boundary(voice,d,selected['d'],selected['b'],scene['clips']['bStart'])
    return dict(audition=v,auditionSha256=file_sha,stage=stages[stage],assets=verified,tracks=selected,inputWindows=input_windows,vocalBoundary=boundary,vocalBoundaryChecks=boundary_checks)

def build_contract_helper(repository,output):
    repository=pathlib.Path(repository).resolve();output=pathlib.Path(output).resolve();exe=repository/'vendor/realtime-v3/node_modules/.bin/esbuild'
    result=subprocess.run([str(exe),str(repository/'tools/four_role_contract_check.ts'),'--bundle','--platform=node','--format=cjs','--outfile='+str(output)],capture_output=True,text=True)
    if result.returncode:raise ValueError('phone contract helper build failed: '+result.stderr[-2000:])
    return output

def run_contract_helper(helper,request):
    node=shutil.which('node') or '/usr/local/bin/node';result=subprocess.run([node,str(helper)],input=json.dumps(request,ensure_ascii=False,allow_nan=False),capture_output=True,text=True,timeout=30)
    if result.returncode:raise ValueError('actual phone contract refused export: '+result.stderr[-2000:].strip())
    return json.loads(result.stdout)

def load_metadata(path):
    tracks={}
    for file in sorted(pathlib.Path(path).glob('*-detail.json')):
        if file.name.startswith('._'):continue
        value,_=load_json(file,32*1024*1024);track=value.get('track',value);tid=track.get('id')
        if not tid or tid in tracks:raise ValueError('duplicate or missing metadata source id')
        tracks[tid]=track
    if not tracks:raise ValueError('source metadata directory is empty')
    return tracks

def atomic_bytes(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    if path.exists() and path.read_bytes()==data:return
    handle=tempfile.NamedTemporaryFile(dir=str(path.parent),prefix='.'+path.name+'.',delete=False)
    try:
        with handle:handle.write(data);handle.flush();os.fsync(handle.fileno())
        os.replace(handle.name,path)
    finally:
        if os.path.exists(handle.name):os.unlink(handle.name)

def _export(case,tracks,output,stage,helper,pin):
    checked=validate_audition(case,tracks,stage,pin);v=checked['audition'];measured=checked['stage'];e=measured['evidence'];cd=stage==2
    layers=[]
    for side in 'c'+('d' if cd else ''):
        original=layer_map(measured['layers'])[side+'.'+('other' if side=='c' else 'vocals')];window=checked['inputWindows'][side]
        layer={k:copy.deepcopy(original[k]) for k in ('source','role','outputStart','rate','loop','gain','points')};layer.update({k:window[k] for k in ('sourceBpm','sourceStartFrame','lengthFrames')})
        if side=='d':layer['vocalBoundary']=checked['vocalBoundary']
        layers.append(layer)
    origin=dict(schema='harbeat.role-measurement-origin.v1',auditionSha256=checked['auditionSha256'],auditionId=v['id'],producerHost=v.get('producerHost'),stage=copy.deepcopy(measured),previousStages=copy.deepcopy(v['stages'][:stage]),parameters={k:copy.deepcopy(v[k]) for k in ('sampleRate','bpm','duration','window')},sources=copy.deepcopy(v['sources']),implementations=copy.deepcopy(v.get('implementations',{})),verifiedAssets=checked['assets'],inputWindows=checked['inputWindows'],vocalBoundaryChecks=checked['vocalBoundaryChecks'],exporterSha256=sha(pathlib.Path(__file__).read_bytes()),verifierSha256=sha(pathlib.Path(helper).read_bytes()))
    evidence=dict(sourceVerified=True,pairwisePass=True,aggregatePass=True,arrangementSha256='0'*64,measurementsSha256='0'*64,peak=e['peak'],lowEnergyRatio=e['lowEnergyRatio'],checks=dict(reconstruction=e['reconstruction'],vocalClear=True,vocalMaxDb=e['vocalMaxDb'],beatErrorMs=e['beatErrorMs'],loopSeamDb=e['loopSeamDb'],melodyClash=max(p['pitchedRisk'] for p in e['pairwise'].values()),onsetGrowth=e['onsetGrowth'],originalVocalPreserved=True,vocalBoundariesClear=True,simultaneousFourRoleSeconds=e.get('simultaneousFourRoleSeconds',0)),pairwise=copy.deepcopy(e['pairwise']),exitPeaks=[dict(at=x['at'],peak=peak) for x,peak in zip(v['base']['scene']['exits'],e['exitPeaks'])],sourceMeasurement=origin)
    role=dict(schema='harbeat.role-replacement.v1',scope='normal-playback-lab',producer='jetson',approved=True,id='0'*64,implementationSha256=origin['exporterSha256'],mode='roles-cd' if cd else 'roles-c',base=copy.deepcopy(v['base']),sources={s:copy.deepcopy(v['sources'][s]['proof']) for s in 'c'+('d' if cd else '')},window=copy.deepcopy(v['window']),layers=layers,bOther=copy.deepcopy(layer_map(measured['layers'])['b.other']['points']),evidence=evidence)
    if cd:role['bVocals']=copy.deepcopy(layer_map(measured['layers'])['b.vocals']['points'])
    sealed=run_contract_helper(helper,dict(action='seal',value=role));result=sealed['value'];payload=sealed['canonical'].encode();fingerprint=sha(payload);measurement=sealed['measurementCanonical'].encode()
    if len(payload)>2*1024*1024 or fingerprint!=sealed['sha256'] or sha(measurement)!=result['evidence']['measurementsSha256'] or result['base']!=v['base']:raise ValueError('export metadata budget or immutable measurement binding failed')
    row=dict(baseId=result['base']['id'],sha256=fingerprint,url='/listen/role-replacement/v1/'+fingerprint+'.json',sources=stage);index_path=output/'index.json'
    index=load_json(index_path,2*1024*1024)[0] if index_path.exists() else dict(schema='harbeat.role-replacement-index.v1',scenes=[])
    if index.get('schema')!='harbeat.role-replacement-index.v1' or not isinstance(index.get('scenes'),list):raise ValueError('existing isolated role index invalid')
    for item in index['scenes']:
        if not isinstance(item,dict) or not HASH.fullmatch(str(item.get('baseId',''))) or not HASH.fullmatch(str(item.get('sha256',''))) or type(item.get('sources')) is not int or item['sources'] not in (1,2) or item.get('url')!='/listen/role-replacement/v1/'+item['sha256']+'.json':raise ValueError('existing isolated role index row invalid')
    if row not in index['scenes']:index['scenes'].append(row)
    if len(index['scenes'])>256:raise ValueError('isolated role index budget exceeded')
    index_bytes=json.dumps(index,ensure_ascii=False,indent=2,allow_nan=False).encode()
    if len(index_bytes)>2*1024*1024:raise ValueError('isolated role index metadata budget exceeded')
    role_path=output/(fingerprint+'.json');measurement_path=output/'measurements'/(sha(measurement)+'.json')
    for path,data in [(role_path,payload),(measurement_path,measurement)]:
        if path.exists() and path.read_bytes()!=data:raise ValueError('content-addressed output already contains different bytes')
    atomic_bytes(role_path,payload);atomic_bytes(measurement_path,measurement);atomic_bytes(index_path,index_bytes)
    return dict(path=str(role_path),sha256=fingerprint,measurements=str(measurement_path),index=str(index_path),mode=result['mode'],auditionSha256=checked['auditionSha256'])

def export_case(case_dir,metadata,output,stage,helper=None,expected_audition_sha256=None):
    tracks=metadata if isinstance(metadata,dict) else load_metadata(metadata);output=pathlib.Path(output)
    if helper is not None:return _export(pathlib.Path(case_dir),tracks,output,stage,pathlib.Path(helper),expected_audition_sha256)
    with tempfile.TemporaryDirectory(prefix='role-contract-verifier-') as folder:
        helper=build_contract_helper(pathlib.Path(__file__).resolve().parents[1],pathlib.Path(folder)/'contract.cjs')
        return _export(pathlib.Path(case_dir),tracks,output,stage,helper,expected_audition_sha256)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--case',type=pathlib.Path,required=True);p.add_argument('--metadata',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,required=True);p.add_argument('--stage',type=int,choices=(1,2),required=True);p.add_argument('--helper',type=pathlib.Path);p.add_argument('--expected-audition-sha256')
    args=p.parse_args();print(json.dumps(export_case(args.case,args.metadata,args.output,args.stage,args.helper,args.expected_audition_sha256),ensure_ascii=False))

if __name__=='__main__':main()
