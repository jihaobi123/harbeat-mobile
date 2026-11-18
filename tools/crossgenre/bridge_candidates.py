"""Extract two source-bound drum-loop candidates; human review stays pending."""
import argparse,hashlib,json,pathlib
import numpy as np
import soundfile as sf

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()

def main():
    p=argparse.ArgumentParser();p.add_argument('--context',type=pathlib.Path,required=True);p.add_argument('--index',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args()
    t=json.load(open(a.context))['a'];prov=t['provenance'];root=pathlib.Path('/mnt/nas/harbeat/preprocess');folder=root/'published/tracks'/t['id']/'runs'/prov['runId']
    mf=folder/'manifest.json';m=json.load(open(mf));assert sha(mf)==json.load(open(folder/'_SUCCESS.json'))['manifest_sha256'];assert m['assets']['master']['sha256']==prov['masterSha256']
    stem=m['assets']['stems']['drums'];source=root/stem['storage_key'];assert sha(source)==stem['sha256']
    row=next(r for r in json.load(open(a.index))['tracks'] if r['trackId']==t['id']);assert row['sourceSha256']==prov['masterSha256'] and row['reportSha256']==prov['reportSha256'] and row['stemSha256']['drums']==stem['sha256']
    bars=[b for b in t['alignment']['bars'] if b.get('valid')];a.output.mkdir(parents=True,exist_ok=True);materials=[]
    for n,bar_index in enumerate([7,20]):
        chosen=bars[bar_index:bar_index+2];start,end=round(chosen[0]['start']*44100),round(chosen[-1]['end']*44100)
        with sf.SoundFile(source) as f:f.seek(start);x=f.read(end-start,dtype='float32',always_2d=True)
        assert len(x)==end-start and x.shape[1]==2 and np.isfinite(x).all()
        beats=[round(v*44100)-start for b in chosen for v in b['beats']]+[end-start]
        power=[float(np.sqrt(np.mean(x[l:r].astype(np.float64)**2))) for l,r in zip(beats,beats[1:])];mx=max(power);accents=[round(v/mx,6) for v in power]
        edge=round(.005*44100);x[:edge]*=np.linspace(0,1,edge)[:,None];x[-edge:]*=np.linspace(1,0,edge)[:,None]
        file=a.output/f'bridge-drum-{n+1}.wav';sf.write(file,x,44100,subtype='PCM_24')
        materials.append(dict(schema='harbeat.transition-material.v1',id=f'drum-hiphop-{n+1}',trackId=t['id'],runId=prov['runId'],masterSha256=prov['masterSha256'],reportSha256=prov['reportSha256'],stemSha256=stem['sha256'],profileSha256=row['profile']['sha256'],asset=dict(sha256=sha(file),url=file.name,frames=len(x),sampleRate=44100,channels=2),startFrame=start,endFrame=end,bpm=8*60/(len(x)/44100),meter=[4,4],beats=8,accents=accents,rateRange=[.8,1.2],edgeMs=5,peak=float(np.max(np.abs(x))),review=dict(status='pending'),notes='Observed two-bar drum source; 5 ms loop-edge fade. No human seam/accent/genre review yet.'))
    (a.output/'bridge-materials.json').write_text(json.dumps(dict(schema='harbeat.transition-library.v1',scope='audition-only',materials=materials),indent=2))
    print(json.dumps(dict(materials=len(materials),humanApproved=0)))
if __name__=='__main__':main()
