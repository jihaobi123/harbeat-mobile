"""Finite three-part resume after stopping the prior exporter at an atomic checkpoint."""
import argparse,json,os,pathlib,shutil,subprocess,sys,time
from merge import merge

def main():
 p=argparse.ArgumentParser();p.add_argument('--root',type=pathlib.Path,required=True);p.add_argument('--resume',action='store_true');a=p.parse_args();root=a.root;catalog=json.load(open(root/'catalog.json'));original=root/'publication';frozen=root/'parts'/'completed';frozen.parent.mkdir(exist_ok=True)
 if frozen.exists() and not a.resume:raise RuntimeError('resume partitions already initialized')
 if not frozen.exists():shutil.copytree(original,frozen)
 done=json.load(open(frozen/'index.json'));known={t['trackId'] for t in done['tracks']+done['excluded']};remaining=[t for t in catalog['tracks'] if t['id'] not in known];workers=[];parts=[frozen]
 for i in range(3):
  folder=root/'parts'/('worker-'+str(i));folder.mkdir(exist_ok=a.resume);part_catalog=folder/'catalog.json';
  if not part_catalog.exists():part_catalog.write_text(json.dumps({'tracks':remaining[i::3]},ensure_ascii=False,separators=(',',':')))
  output=folder/'publication';parts.append(output);log=open(folder/'worker.log','ab');env={**os.environ,'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1'}
  proc=subprocess.Popen([sys.executable,str(pathlib.Path(__file__).with_name('export.py')),'--catalog',str(part_catalog),'--output',str(output)],stdout=log,stderr=subprocess.STDOUT,env=env);workers.append(proc)
 (root/'parallel-job.json').write_text(json.dumps({'coordinator':os.getpid(),'workers':[p.pid for p in workers],'remaining':len(remaining),'alreadyCompleted':len(known)}))
 last=-1
 while True:
  value=merge(catalog,parts,original);count=len(value['tracks'])+len(value['excluded'])
  if count!=last:print(json.dumps({'completed':count,'coverage':value['coverage'],'excluded':len(value['excluded'])}),flush=True);last=count
  if all(p.poll() is not None for p in workers):
   value=merge(catalog,parts,original);count=len(value['tracks'])+len(value['excluded'])
   if any(p.returncode for p in workers) or count!=len(catalog['tracks']):raise RuntimeError('preprocessing partitions incomplete')
   print('COMPLETE',flush=True);return
  time.sleep(60)
if __name__=='__main__':main()
