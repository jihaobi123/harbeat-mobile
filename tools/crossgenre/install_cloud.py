"""Install an already transferred metadata publication on the existing cloud host."""
import argparse,hashlib,json,os,pathlib,shutil,subprocess,time

def configure(text):
 include='    include /etc/nginx/snippets/harbeat-crossgenre.conf;'
 if include in text:return text
 anchor='    include /etc/nginx/snippets/harbeat-listen.conf;'
 if text.count(anchor)!=1:raise ValueError('nginx include anchor missing or ambiguous')
 return text.replace(anchor,include+'\n'+anchor)

def main():
 p=argparse.ArgumentParser();p.add_argument('--publication',type=pathlib.Path,required=True);p.add_argument('--nginx',type=pathlib.Path);a=p.parse_args();folder=a.publication.resolve();index=json.load(open(folder/'index.json'))
 for row in index['tracks']:
  d=row['profile'];raw=(folder/'objects'/(d['sha256']+'.json')).read_bytes();assert len(raw)==d['bytes'] and hashlib.sha256(raw).hexdigest()==d['sha256']
 for f in folder.rglob('*'):
  if f.is_file():f.chmod(0o644)
 folder.chmod(0o755);(folder/'objects').chmod(0o755)
 link=pathlib.Path('/srv/harbeat-listen/crossgenre-current');old=os.readlink(link) if link.is_symlink() else None
 config=pathlib.Path('/etc/nginx/conf.d/harbeat-ssl.conf');snippet=pathlib.Path('/etc/nginx/snippets/harbeat-crossgenre.conf');stamp=str(time.time_ns());backup=pathlib.Path('/srv/harbeat-listen/backups')/('crossgenre-'+stamp);backup.mkdir(parents=True)
 shutil.copy2(config,backup/'harbeat-ssl.conf');(backup/'previous-target.txt').write_text(old or '')
 if snippet.exists():shutil.copy2(snippet,backup/'harbeat-crossgenre.conf')
 try:
  if a.nginx:
   text=configure(config.read_text());snippet.write_bytes(a.nginx.read_bytes());config.write_text(text)
  temp=link.with_name(link.name+'.'+stamp);temp.symlink_to(folder);os.replace(temp,link)
  subprocess.run(['nginx','-t'],check=True);subprocess.run(['systemctl','reload','nginx'],check=True)
 except Exception:
  shutil.copy2(backup/'harbeat-ssl.conf',config)
  if old:
   temp=link.with_name(link.name+'.rollback-'+stamp);temp.symlink_to(old);os.replace(temp,link)
  elif link.is_symlink():link.unlink()
  if (backup/'harbeat-crossgenre.conf').exists():shutil.copy2(backup/'harbeat-crossgenre.conf',snippet)
  raise
 print(json.dumps(dict(published=len(index['tracks']),target=str(folder),backup=str(backup))))
if __name__=='__main__':main()
