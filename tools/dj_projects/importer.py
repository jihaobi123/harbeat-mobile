"""Read author preparation data; execution remains gated by source-bound Jetson approval."""
from __future__ import annotations
import hashlib,json,math,pathlib,re,urllib.parse,xml.etree.ElementTree as ET,zipfile,stat

def finite(v,minimum=0):
 try:x=float(v)
 except (TypeError,ValueError):raise ValueError('missing numeric cue value')
 if not math.isfinite(x) or x<minimum:raise ValueError('invalid cue number')
 return x

def digest(p):
 h=hashlib.sha256()
 with p.open('rb')as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()

def safe_extract(archive,folder):
 folder=pathlib.Path(folder).resolve();folder.mkdir(parents=True,exist_ok=True);total=0
 with zipfile.ZipFile(archive)as z:
  if len(z.infolist())>2048:raise ValueError('archive entry budget exceeded')
  for info in z.infolist():
   name=info.filename.replace('\\','/');parts=pathlib.PurePosixPath(name)
   if parts.is_absolute() or '..' in parts.parts or '\x00' in name or stat.S_ISLNK(info.external_attr>>16):raise ValueError('unsafe archive path')
   total+=info.file_size
   if total>512*1024*1024 or info.file_size>128*1024*1024:raise ValueError('archive audio budget exceeded')
   target=(folder/parts).resolve()
   if not target.is_relative_to(folder):raise ValueError('archive escaped root')
  for info in z.infolist():
   target=(folder/pathlib.PurePosixPath(info.filename.replace('\\','/'))).resolve()
   if info.is_dir():target.mkdir(parents=True,exist_ok=True);continue
   target.parent.mkdir(parents=True,exist_ok=True)
   with z.open(info)as src,target.open('xb')as dst:
    copied=0
    while True:
     b=src.read(1024*1024)
     if not b:break
     copied+=len(b)
     if copied>info.file_size:raise ValueError('archive entry exceeded declared size')
     dst.write(b)
 return folder

def resolve_audio(location,root):
 raw=urllib.parse.unquote(str(location or '')).replace('\\','/').replace('/:', '/')
 parsed=urllib.parse.urlparse(raw)
 if parsed.scheme and parsed.scheme not in ('file',):raise ValueError('project location is not a local audio reference')
 value=parsed.path if parsed.scheme else raw;parts=pathlib.PurePosixPath(value).parts
 if '..' in parts or '\x00' in value:raise ValueError('project path traversal')
 relative=value.lstrip('/');exact=(root/relative).resolve()
 if exact.is_relative_to(root) and exact.is_file():return exact,'relative-path'
 # Author exports commonly include their own absolute studio path. Relocate
 # only a unique existing filename inside the explicitly supplied pack root.
 name=pathlib.PurePosixPath(value).name
 matches=[p.resolve()for p in root.rglob(name)if p.is_file() and p.resolve().is_relative_to(root)] if name else []
 if len(matches)==1:return matches[0],'unique-filename-relocation'
 return None,'ambiguous' if matches else 'missing'

def import_project(raw,kind,audio_root,source_url,expected_hashes=None):
 if not isinstance(raw,bytes) or len(raw)>8*1024*1024 or b'\x00'in raw:raise ValueError('unsupported or oversized XML encoding')
 decoded=raw.decode('utf-8-sig')
 if re.search(r'<!\s*(DOCTYPE|ENTITY)',decoded,re.I):raise ValueError('unsafe XML')
 root=pathlib.Path(audio_root).resolve();doc=ET.fromstring(raw)
 if sum(1 for _ in doc.iter())>20000:raise ValueError('project node budget exceeded')
 tracks=[];playlists=[]
 if kind=='rekordbox':
  if doc.tag!='DJ_PLAYLISTS':raise ValueError('not a rekordbox project')
  for e in doc.findall('./COLLECTION/TRACK'):
   cues=[]
   for c in e.findall('POSITION_MARK'):
    start=finite(c.get('Start'));end=finite(c.get('End'))if c.get('End')is not None else None;loop=c.get('Type')=='4'
    if loop and (end is None or end<=start):raise ValueError('invalid loop range')
    cues.append(dict(id=c.get('Num','-1'),name=c.get('Name',''),kind='loop'if loop else'cue',startSeconds=start,endSeconds=end,performed=None))
   tracks.append(dict(id=e.get('TrackID'),title=e.get('Name',''),artist=e.get('Artist',''),location=e.get('Location'),tempos=[dict(startSeconds=finite(t.get('Inizio')),bpm=finite(t.get('Bpm'),1))for t in e.findall('TEMPO')],cues=cues))
  for n in doc.findall('.//PLAYLISTS//NODE'):
   if n.get('Type')=='1':
    if n.get('KeyType')!='0':raise ValueError('playlist must refer to exact track IDs')
    playlists.append(dict(name=n.get('Name',''),trackIds=[t.get('Key')for t in n.findall('TRACK')]))
 elif kind=='traktor':
  if doc.tag!='NML':raise ValueError('not a Traktor project')
  for i,e in enumerate(doc.findall('./COLLECTION/ENTRY')):
   loc=e.find('LOCATION');location=(loc.get('DIR','')+loc.get('FILE','')) if loc is not None else '';cues=[]
   for c in e.findall('CUE_V2'):
    start=finite(c.get('START'))/1000;length=finite(c.get('LEN','0'))/1000;loop=c.get('TYPE')=='5'
    if loop and length<=0:raise ValueError('invalid NML loop')
    cues.append(dict(id=c.get('HOTCUE',str(len(cues))),name=c.get('NAME',''),kind='loop'if loop else'cue',startSeconds=start,endSeconds=start+length if loop else None,performed=None))
   tempo=e.find('TEMPO');tracks.append(dict(id=e.get('AUDIO_ID')or e.get('UUID')or str(i),title=e.get('TITLE',''),artist=e.get('ARTIST',''),location=location,tempos=[dict(startSeconds=0,bpm=finite(tempo.get('BPM'),1))]if tempo is not None else [],cues=cues))
  # NML playlists use location-based primary keys, not a reliable performance
  # trace. Preserve keys; binding can be audited without inventing launch order.
  for n in doc.findall('.//PLAYLISTS//NODE'):
   keys=[x.get('KEY')for x in n.findall('./PLAYLIST/ENTRY/PRIMARYKEY')]
   if keys:playlists.append(dict(name=n.get('NAME',''),locationKeys=keys))
 else:raise ValueError('unsupported project format')
 ids=[t['id']for t in tracks]
 if any(not isinstance(k,str)or not k for k in ids)or len(set(ids))!=len(ids):raise ValueError('ambiguous project track IDs')
 for t in tracks:
  file,how=resolve_audio(t['location'],root);actual=digest(file)if file else None
  expected=(expected_hashes or {}).get(t['id'])
  if expected is not None and expected!=actual:raise ValueError('author package audio fingerprint mismatch')
  t.update(audioSha256=actual,audioPath=str(file)if file else None,audioMatch=how,audioVerified=bool(actual and expected==actual))
 return dict(schema='harbeat.authored-dj-project.v1',evidenceType='author-preparation',sourceUrl=source_url,projectSha256=hashlib.sha256(raw).hexdigest(),format=kind,tracks=tracks,playlists=playlists,transitions=[],performanceOrder='unknown',executionApproved=False,unknown=['actual launch order','fader and EQ automation','stem selections','actual cue usage'])

def compile_requests(project,rules):
 tracks={t['id']:t for t in project['tracks']};requests=[]
 if not isinstance(rules,list)or len(rules)>512:raise ValueError('rule count exceeded')
 for rule in rules:
  a,b=tracks.get(rule.get('fromId')),tracks.get(rule.get('toId'))
  if not a or not b or a is b or not a.get('audioVerified')or not b.get('audioVerified')or not rule.get('instructionSource'):raise ValueError('rule lacks verified author-package audio or origin')
  def cue(t,key):
   found=[c for c in t['cues']if c['id']==str(key)]
   if len(found)!=1:raise ValueError('cue must be explicitly identified and unique')
   return found[0]
  ca,cb=cue(a,rule['fromCue']),cue(b,rule['toCue']);beats=finite(rule['overlapBeats'],1)
  if beats>128:raise ValueError('overlap exceeds supported preparation request')
  requests.append(dict(schema='harbeat.authored-cue-request.v1',authority='author-rule-awaiting-jetson',instructionSource=rule['instructionSource'],projectSha256=project['projectSha256'],sourceUrl=project['sourceUrl'],sources={'a':{'id':a['id'],'masterSha256':a['audioSha256']},'b':{'id':b['id'],'masterSha256':b['audioSha256']}},sourceWindow={'aStart':ca['startSeconds'],'bStart':cb['startSeconds']},overlapBeats=beats,automation=None,executionApproved=False))
 return requests
