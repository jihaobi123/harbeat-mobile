"""Bind author cue requests to exact analyzed masters for Jetson planning."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
from urllib.parse import urlsplit

_SHA = re.compile(r'^[0-9a-f]{64}$')


class BindingError(ValueError):
    def __init__(self, code, side=None):
        self.code = code
        self.side = side
        super().__init__(code + (f' ({side})' if side else ''))


def _sha(value):
    return isinstance(value, str) and _SHA.fullmatch(value) is not None


def _number(value):
    return type(value) in (float, int) and math.isfinite(value)


def _hash(value):
    encoded = json.dumps(value, sort_keys=True, separators=(',', ':'),
                         ensure_ascii=True, allow_nan=False).encode()
    return hashlib.sha256(encoded).hexdigest()


def _reference_url(value):
    if not isinstance(value, str) or len(value) > 2048:
        return False
    try:
        url = urlsplit(value)
        return url.scheme == 'https' and bool(url.hostname) and not (url.username or url.password)
    except ValueError:
        return False


def bind_request(request, tracks):
    """Title similarity cannot transfer a cue; only identical master bytes can."""
    if (not isinstance(request, dict) or request.get('schema') != 'harbeat.authored-cue-request.v1'
            or request.get('authority') != 'author-rule-awaiting-jetson'
            or request.get('executionApproved') is not False
            or 'automation' not in request or request['automation'] is not None
            or not _sha(request.get('projectSha256'))
            or not _reference_url(request.get('sourceUrl'))
            or not isinstance(request.get('instructionSource'), str) or not request['instructionSource'].strip()):
        raise BindingError('invalid-request')
    sources, window, beats = request.get('sources'), request.get('sourceWindow'), request.get('overlapBeats')
    if (not isinstance(sources, dict) or set(sources) != {'a','b'}
            or not isinstance(window, dict) or set(window) != {'aStart','bStart'}
            or any(not _number(t) or t < 0 for t in window.values())
            or not _number(beats) or not 1 <= beats <= 128):
        raise BindingError('invalid-request')
    tracks = list(tracks)
    bound, ids, masters = {}, set(), set()
    for side in 'ab':
        ref = sources[side]
        if (not isinstance(ref, dict) or not isinstance(ref.get('id'), str) or not ref['id']
                or not _sha(ref.get('masterSha256'))):
            raise BindingError('invalid-request', side)
        master = ref['masterSha256']
        if master in masters:
            raise BindingError('duplicate-source', side)
        matches = [t for t in tracks if (t.get('provenance') or {}).get('masterSha256') == master]
        if len(matches) != 1:
            raise BindingError('exact-master-ambiguous' if matches else 'exact-master-unavailable', side)
        local = matches[0]
        prov, tid = local['provenance'], local.get('id')
        if not isinstance(tid,str) or not tid or tid in ids:
            raise BindingError('duplicate-source', side)
        if (local.get('mixStatus') != 'ready' or local.get('playStatus') != 'ready'
                or not all(_sha(prov.get(k)) for k in ('reportSha256','vocalSha256'))
                or not isinstance(prov.get('runId'),str) or not prov['runId']):
            raise BindingError('source-analysis-unavailable', side)
        duration = local.get('duration')
        if not _number(duration) or window[side+'Start'] >= duration:
            raise BindingError('cue-out-of-range', side)
        masters.add(master)
        ids.add(tid)
        bound[side] = dict(trackId=tid, referenceId=ref['id'], masterSha256=master,
                           reportSha256=prov['reportSha256'], vocalSha256=prov['vocalSha256'],
                           runId=prov['runId'], duration=float(duration))
    output = dict(schema='harbeat.dj-reference-planner-input.v1', authority='reference-only-awaiting-jetson',
                  reference=dict(kind='author-explicit-cue', sourceUrl=request['sourceUrl'],
                                 instructionSource=request['instructionSource'],
                                 projectSha256=request['projectSha256'], requestSha256=_hash(request)),
                  sources=bound, cueHints={**{k:float(v) for k,v in window.items()}, 'overlapBeats':float(beats)},
                  roleTimeline=None, executionApproved=False)
    return {**output, 'id':_hash(output)}


def assert_current(bound, request, tracks):
    try:
        expected = bind_request(request, tracks)
    except BindingError as exc:
        raise BindingError('stale-reference-binding', exc.side) from exc
    if expected != bound:
        raise BindingError('stale-reference-binding')
    return expected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('requests','metadata','output'):
        parser.add_argument('--'+key, type=Path, required=True)
    args = parser.parse_args()
    requests = json.loads(args.requests.read_text())
    if not isinstance(requests,list) or len(requests) > 512:
        raise SystemExit('expected up to 512 author requests')
    tracks = []
    for file in sorted(args.metadata.glob('*-detail.json')):
        if not file.name.startswith('._'):
            data = json.loads(file.read_text())
            tracks.append(data.get('track',data))
    if not tracks:
        raise SystemExit('no analyzed track detail files')
    bound, rejected = [], []
    for i, request in enumerate(requests):
        try:
            bound.append(bind_request(request,tracks))
        except BindingError as exc:
            rejected.append(dict(requestIndex=i,reason=exc.code,side=exc.side))
    output = dict(schema='harbeat.dj-reference-binding-run.v1', requests=len(requests),
                  analyzedTracks=len(tracks), bound=bound, rejected=rejected, executionApproved=False)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(output,ensure_ascii=False,indent=2,allow_nan=False)+'\n')
    print(json.dumps(dict(requests=len(requests), bound=len(bound), rejected=len(rejected))))


if __name__ == '__main__':
    main()
