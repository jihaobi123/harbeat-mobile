"""Validate and checkpoint data-only Jetson approvals for reservation edges."""
import hashlib
import json
from .worker import HASH,METHODS,PreparationError,finite

VERSION='jetson-decision-v1'

def checksum(value):
    # A private persistence checksum detects later corruption. The shared Node
    # validator separately verifies the canonical JS analysisSha256 on receipt.
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()).hexdigest()

def signature(value):
    return tuple(value.get(key) for key in ('from','to','windowId','start'))

def validate_strategy(result,edge,pack,execution_tracks):
    if (not isinstance(result,dict) or result.get('schema')!='harbeat.jetson-mix-plan.v1'
        or result.get('status')!='ready' or result.get('producer')!='jetson' or result.get('analysisVersion')!=VERSION
        or any(not HASH.fullmatch(str(result.get(k,''))) for k in ('id','algorithmSha256','analysisSha256'))):raise PreparationError('invalid_jetson_strategy')
    plan=result.get('plan',{})
    if not isinstance(plan,dict) or any(plan.get(k)!=edge.get(k) for k in ('from','to','windowId')):raise PreparationError('jetson_plan_mismatch')
    for key in ('start','end','duration','rate','bStart','bEnd'):
        if not finite(plan.get(key)) or not finite(edge.get(key)) or abs(plan[key]-edge[key])>.002:raise PreparationError('jetson_plan_mismatch')
    sources={s['id']:s for s in pack['sourceFingerprints']};manifests={t['trackId']:t for t in execution_tracks}
    for side in ('a','b'):
        tid=plan['from' if side=='a' else 'to'];source=sources.get(tid);manifest=manifests.get(tid);proof=result.get('sourceProof',{}).get(side,{})
        if not source or not manifest or not isinstance(proof,dict) or proof.get('trackId')!=tid:raise PreparationError('jetson_source_mismatch')
        if any(proof.get(k)!=source.get('provenance',{}).get(k) for k in ('runId','masterSha256','reportSha256','vocalSha256')):raise PreparationError('jetson_source_mismatch')
        if (proof.get('manifestSha256')!=manifest.get('manifestSha256') or proof.get('profileSha256')!=manifest.get('profile',{}).get('sha256')
            or not HASH.fullmatch(str(proof.get('manifestSha256',''))) or not isinstance(proof.get('stemSha256'),dict)
            or any(proof['stemSha256'].get(stem)!=manifest.get('stems',{}).get(stem,{}).get('sourceSha256') for stem in ('drums','bass','other','vocals'))):raise PreparationError('jetson_source_mismatch')
    decision=result.get('decision',{});methods=decision.get('methods',{}) if isinstance(decision,dict) else {}
    if decision.get('recommended') not in METHODS or methods.get('original',{}).get('eligible') is not True or methods.get(decision['recommended'],{}).get('eligible') is not True:raise PreparationError('jetson_strategy_not_approved')
    return result

def embedded_valid(pack):
    execution=pack['execution']
    if 'strategyVersion' not in execution:return True
    if execution['strategyVersion']!=VERSION or not isinstance(execution.get('strategies'),list) or len(execution['strategies'])>len(execution['edges']):return False
    edges={signature(e):e for e in execution['edges']};ids=set()
    for result in execution['strategies']:
        edge=edges.get(signature(result.get('plan',{})))
        if edge is None or result.get('id') in ids:return False
        validate_strategy(result,edge,pack,execution['tracks'])
        if pack.get('strategyChecksums',{}).get(result['id'])!=checksum(result):return False
        ids.add(result['id'])
    return pack.get('strategyPrepared')==len(ids) and pack.get('prepared')==len(ids)
