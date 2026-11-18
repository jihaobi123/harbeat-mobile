"""Read-only catalog/drum evidence snapshot for a stratified listening corpus."""
import argparse,gzip,hashlib,json,pathlib,bisect

def signature(track,events,cue,outgoing):
    beats=sorted(set(t for b in track['alignment']['bars'] if b.get('valid') for t in b['beats']))
    if not beats:return None
    at=min(range(len(beats)),key=lambda i:abs(beats[i]-cue))
    if abs(beats[at]-cue)>.065:return None
    start=at-8 if outgoing else at
    if start<0 or start+8>=len(beats):return None
    histogram=[0.]*96
    for e in events:
        i=bisect.bisect_right(beats,e['time'])-1
        if not start<=i<start+8 or e['band'] not in ['low','mid','high']:continue
        phase=(e['time']-beats[i])/(beats[i+1]-beats[i]);slot=round((i-start+phase)*4)
        if 0<=slot<32:histogram[['low','mid','high'].index(e['band'])*32+slot]+=min(8,e['strength'])
    total=sum(histogram)
    return [round(x/total,7) for x in histogram] if total>0 else None

def main():
    p=argparse.ArgumentParser();p.add_argument('--library',type=pathlib.Path,required=True);p.add_argument('--execution',type=pathlib.Path,required=True);p.add_argument('--cross',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args()
    index=json.load(open(a.library/'library.json'));tracks=[]
    for row in index['tracks']:
        if row['playStatus']!='ready' or row['mixStatus']!='ready':continue
        name=row['detailUrl'].removeprefix('/listen/');file=(a.library/name).resolve()
        if a.library.resolve() not in file.parents:raise ValueError('detail path escaped library')
        t=json.load(open(file))['track'];assert t['id']==row['id'];tracks.append(t)
    cross=json.load(open(a.cross/'index.json'));by={t['trackId']:t for t in cross['tracks']};rows={t['trackId']:t for t in json.load(open(a.execution/'index.json'))['tracks']};evidence={}
    for t in tracks:
        row=rows.get(t['id']);c=by.get(t['id']);prov=t['provenance']
        if not row or not c or row['sourceSha256']!=prov['masterSha256'] or row['reportSha256']!=prov['reportSha256']:continue
        d=row['profile'];raw=(a.execution/'profiles'/(d['sha256']+'.json')).read_bytes()
        if len(raw)!=d['bytes'] or hashlib.sha256(raw).hexdigest()!=d['sha256']:raise ValueError('profile fingerprint changed')
        profile=json.loads(raw)
        assert all(profile[k]==row[k] for k in ['trackId','sourceSha256','reportSha256','runId','manifestSha256'])
        assert profile['stems']['drums']['sourceSha256']==row['stemSha256']['drums']
        raw=(a.cross/'objects'/(c['profile']['sha256']+'.json')).read_bytes();assert hashlib.sha256(raw).hexdigest()==c['profile']['sha256'];cp=json.loads(raw)
        events=profile.get('groove',{}).get('events',[]);signatures={}
        for kind in ['entries','exits']:
            for cue in cp[kind]:signatures[cue['id']]=signature(t,events,cue['time'],kind=='exits')
        evidence[t['id']]={'profile':d,'drumsSha256':row['stemSha256']['drums'],'source':cp['source'],'signatures':signatures,'basis':'two observed 4/4 bars, 32 sixteenth-note slots x three onset bands; L1 distribution difference is a proxy, not a perceptual score'}
    raw=json.dumps({'tracks':tracks,'drumEvidence':evidence},ensure_ascii=False,separators=(',',':')).encode()
    with gzip.open(a.output,'wb') as f:f.write(raw)
    print(json.dumps({'tracks':len(tracks),'drumEvidence':len(evidence),'bytes':a.output.stat().st_size}))
if __name__=='__main__':main()
