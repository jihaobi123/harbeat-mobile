"""Strict native-rate PCM decode fallback; acoustic frame algorithm stays unchanged."""
import hashlib,subprocess,tempfile
from pathlib import Path
from preprocess import measure_file
DECODER_POLICY='crossgenre-native-decoder-v1'
def decoder_sha():return hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
def decoder_matches(value):
 return value is None or (isinstance(value,dict) and value.get('policy')==DECODER_POLICY and value.get('moduleSha256')==decoder_sha() and all(value.get(k) in ['libsndfile','ffmpeg'] for k in ['master','vocals']))
class NativeDecoder:
 def __init__(self):self.temp=tempfile.TemporaryDirectory(prefix='harbeat-crossgenre-');self.decoded={}
 def __enter__(self):return self
 def __exit__(self,*_):self.temp.cleanup()
 def decode(self,path):
  path=Path(path)
  if path in self.decoded:return self.decoded[path]
  out=Path(self.temp.name)/(str(len(self.decoded))+'.wav')
  try:
   subprocess.run(['ffmpeg','-nostdin','-v','error','-xerror','-threads','1','-i',str(path),'-map','0:a:0','-vn','-c:a','pcm_f32le','-y',str(out)],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,check=True,timeout=300)
  except (subprocess.CalledProcessError,subprocess.TimeoutExpired) as exc:raise ValueError('strict native PCM decode failed') from exc
  self.decoded[path]=out;return out
 def info(self,path):
  import soundfile as sf
  path=Path(path)
  try:return sf.info(self.decoded.get(path,path))
  except RuntimeError:return sf.info(self.decode(path))
 def measure(self,path):
  path=Path(path)
  try:return measure_file(self.decoded.get(path,path))
  except RuntimeError:return measure_file(self.decode(path))
 def evidence(self,paths):
  return dict(policy=DECODER_POLICY,moduleSha256=decoder_sha(),**{role:'ffmpeg' if Path(path) in self.decoded else 'libsndfile' for role,path in paths.items()})
