"""Extract source-hash verified, lossless excerpts for an approved listening corpus."""
import argparse,hashlib,json,pathlib,subprocess
import soundfile as sf

def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for chunk in iter(lambda:f.read(8*1024*1024),b''):h.update(chunk)
 return h.hexdigest()

def main():
 p=argparse.ArgumentParser();p.add_argument('--root',type=pathlib.Path,required=True);p.add_argument('--nas',type=pathlib.Path,default=pathlib.Path('/mnt/nas/harbeat/preprocess'));a=p.parse_args();r=a.root
 corpus=json.load(open(r/'corpus.json'));out=r/'audio-src';out.mkdir(exist_ok=True);sources={};extracts={}
 def master(t):
  if t['id'] in sources:return sources[t['id']]
  prov=t['provenance'];folder=a.nas/'published/tracks'/t['id']/'runs'/prov['runId'];mf=folder/'manifest.json';m=json.load(open(mf));success=json.load(open(folder/'_SUCCESS.json'))
  assert sha(mf)==success['manifest_sha256'] and m['track_id']==t['id'] and m['analysis_run_id']==prov['runId']
  source=(a.nas/m['assets']['master']['storage_key']).resolve();assert a.nas.resolve() in source.parents and m['assets']['master']['sha256']==prov['masterSha256'] and sha(source)==prov['masterSha256']
  info=sf.info(source);assert info.channels==2 and info.samplerate==44100
  sources[t['id']]=source;return source
 def extract(t,start,end):
  start_frame=round(start*44100);frames=round(end*44100)-start_frame;key=hashlib.sha256((t['provenance']['masterSha256']+':'+str(start_frame)+':'+str(frames)).encode()).hexdigest()[:24]
  if key not in extracts:
   dest=out/(key+'.flac');source=master(t)
   with sf.SoundFile(source) as f:f.seek(start_frame);audio=f.read(frames,dtype='float32',always_2d=True)
   assert len(audio)==frames;sf.write(dest,audio,44100,format='FLAC',subtype='PCM_24')
   extracts[key]=dict(url='audio-src/'+dest.name,sourceStart=start_frame/44100,frames=frames,sampleRate=44100,sha256=sha(dest),masterSha256=t['provenance']['masterSha256'],quantization='lossless FLAC PCM24 excerpt; source samples rounded to 24-bit')
  return extracts[key]
 for pair in corpus['pairs']:
  inputs={}
  for family in ['structural','echo']:
   plan=pair[family]
   if not plan:continue
   inputs[family]=dict(a=extract(pair['a'],max(0,plan['exit']-6),plan['exit']),b=extract(pair['b'],plan['entry'],plan['entry']+8))
  plan=pair['legacy']['plan']
  if plan:
   aa=extract(pair['a'],max(0,plan['start']-4),plan['end']);bb=extract(pair['b'],plan['window']['end'],plan['window']['end']+8);head=extract(pair['b'],plan['window']['start'],plan['window']['end']);dest=out/(pair['id']+'-legacy-entry.flac');frames=round(plan['duration']*44100)
   subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(r/head['url']),'-af',f"atempo={plan['rate']:.9f},apad=whole_len={frames},atrim=end_sample={frames}",'-c:a','flac','-y',str(dest)],check=True)
   inputs['legacy']=dict(a=aa,b=bb,head=dict(url='audio-src/'+dest.name,sha256=sha(dest),frames=frames,sampleRate=44100,basis='native FFmpeg atempo, same filter/length as device worker; FFmpeg build differs'))
  pair['inputs']=inputs;print(pair['id'],len(extracts),flush=True)
 (r/'corpus-audio.json').write_text(json.dumps(corpus,ensure_ascii=False,separators=(',',':')))
 print(json.dumps(dict(pairs=len(corpus['pairs']),uniqueExcerpts=len(extracts),sourceTracks=len(sources),bytes=sum(f.stat().st_size for f in out.glob('*')))),flush=True)
if __name__=='__main__':main()
