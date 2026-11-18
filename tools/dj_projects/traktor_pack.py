"""Conservative reader for the observed NI FC / RIFF / TraktorCell pack variant.

Unknown container variants are rejected. Raw controls are evidence, not inferred
performance automation. No Traktor enum or marker unit is guessed here.
"""
import base64,hashlib,io,pathlib,re,struct,wave,xml.etree.ElementTree as ET,math

def text(value):
 try:return base64.b64decode(value or '',validate=True).decode('utf-16le')
 except Exception as e:raise ValueError('invalid pack text encoding')from e

def import_trak(raw,folder,source_url):
 if not isinstance(raw,bytes)or len(raw)>128*1024*1024 or not raw.startswith(b'/\\ NI FC MTD  /\\'):raise ValueError('unsupported or oversized NI container')
 folder=pathlib.Path(folder).resolve();roots=[]
 for m in re.finditer(br'<\?xml',raw):
  header=raw.find(b'>',m.start());tag=re.match(br'\s*<(TraktorSet|TraktorSlot|TraktorCell)>',raw[header+1:])
  if not tag:raise ValueError('unknown native pack XML root')
  end=raw.find(b'</'+tag[1]+b'>',header)
  if end<0:raise ValueError('unterminated pack XML')
  fragment=raw[m.start():end+len(tag[1])+3]
  if len(fragment)>2*1024*1024 or re.search(br'<!\s*(DOCTYPE|ENTITY)',fragment,re.I):raise ValueError('unsafe pack XML')
  root=ET.fromstring(fragment)
  if len(root)>128 or any(len(c)for c in root):raise ValueError('unknown native XML structure')
  roots.append(root)
  if len(roots)>69:raise ValueError('native cell budget exceeded')
 sets=[r for r in roots if r.tag=='TraktorSet']
 if len(sets)!=1:raise ValueError('pack must identify exactly one set')
 cells=[];slot=-1;row=0;names=set()
 for r in roots:
  if r.tag=='TraktorSlot':slot+=1;row=0
  if r.tag!='TraktorCell':continue
  name=text(r.findtext('RelativeFilename'));label=text(r.findtext('Name'));row+=1
  if not name:continue
  if slot<0 or slot>3 or row>16 or '/'in name or '\\'in name or name in ('.','..')or '\x00'in name or not name.lower().endswith('.wav'):raise ValueError('unsafe or unbound native cell filename')
  names.add(name);cells.append(dict(slot=slot,row=row-1,filename=name,name=label,raw={c.tag:c.text for c in r if c.tag not in ('RelativeFilename','Name')}))
 # Every accepted RIFF is a complete, validated WAVE and its preceding entry
 # descriptor must contain exactly one declared cell filename. Never associate
 # audio with cells by order, approximate title, or decoded duration.
 audio={};cursor=0
 while True:
  p=raw.find(b'RIFF',cursor)
  if p<0:break
  if p+12>len(raw)or raw[p+8:p+12]!=b'WAVE':cursor=p+4;continue
  n=struct.unpack_from('<I',raw,p+4)[0]+8
  if n<44 or p+n>len(raw):raise ValueError('truncated embedded WAVE')
  descriptor=raw[max(cursor,p-2048):p];matches=[name for name in names if name.encode('utf-16le')+b'\x00\x00'in descriptor]
  if len(matches)!=1 or matches[0]in audio:raise ValueError('ambiguous embedded audio binding')
  clip=raw[p:p+n]
  with wave.open(io.BytesIO(clip),'rb')as w:
   if w.getnchannels()!=2 or w.getframerate()!=44100 or w.getsampwidth()!=2 or not w.getnframes():raise ValueError('unsupported native sample format')
   frames=w.getnframes()
   if len(w.readframes(frames))!=frames*4:raise ValueError('embedded PCM coverage missing')
  audio[matches[0]]=dict(bytes=clip,sha=hashlib.sha256(clip).hexdigest(),frames=frames);cursor=p+n
 if set(audio)!=names or not names:raise ValueError('pack has missing audio')
 bpm=float(sets[0].findtext('BPM'))
 if not math.isfinite(bpm)or not 1<=bpm<=400:raise ValueError('invalid native pack BPM')
 # Validate everything before exposing any files to later analysis.
 folder.mkdir(parents=True,exist_ok=True);tracks=[]
 for name,item in sorted(audio.items()):
  file=folder/name
  if file.is_symlink()or(file.exists()and hashlib.sha256(file.read_bytes()).hexdigest()!=item['sha']):raise ValueError('output collides with existing audio')
  if not file.exists():
   with file.open('xb')as f:f.write(item['bytes'])
  tracks.append(dict(id=name,title=name[:-4],location=name,audioSha256=item['sha'],audioVerified=True,audioPath=str(file),sampleRate=44100,frames=item['frames'],cues=[]))
 return dict(schema='harbeat.authored-dj-project.v1',format='ni-trak-observed-v1',evidenceType='author-preparation',projectSha256=hashlib.sha256(raw).hexdigest(),sourceUrl=source_url,title=text(sets[0].findtext('Title')),bpm=bpm,tracks=tracks,cells=cells,transitions=[],performanceOrder='unknown',executionApproved=False,unknown=['performed launch order','marker units and enum semantics','performance faders and EQ','source compatibility with our library'])
