import tempfile,unittest,wave
from pathlib import Path
import numpy as np
from decode import NativeDecoder
from preprocess import measure_file
class DecoderTest(unittest.TestCase):
 def test_native_ffmpeg_pcm_preserves_stereo_rate_and_measured_frames(self):
  with tempfile.TemporaryDirectory() as temp:
   path=Path(temp)/'source.wav';sr=8000;x=np.column_stack([.2*np.sin(np.arange(sr)*2*np.pi*220/sr),.1*np.sin(np.arange(sr)*2*np.pi*440/sr)])
   with wave.open(str(path),'wb') as f:f.setnchannels(2);f.setsampwidth(2);f.setframerate(sr);f.writeframes((x*32767).astype('<i2').tobytes())
   with NativeDecoder() as decoder:
    decoded=decoder.decode(path);meta=decoder.info(path);self.assertEqual(meta.samplerate,sr);self.assertEqual(meta.channels,2)
    original=measure_file(path);output=measure_file(decoded);self.assertEqual(len(original),len(output))
    for a,b in zip(original,output):
     self.assertEqual(a['start'],b['start']);self.assertEqual(a['end'],b['end']);self.assertAlmostEqual(a['rms'],b['rms'],places=8);self.assertEqual(a['peak'],b['peak'])
    self.assertEqual(decoder.evidence({'master':path,'vocals':path})['master'],'ffmpeg')
   self.assertFalse(decoded.exists())
 def test_strict_decode_rejects_invalid_audio(self):
  with tempfile.TemporaryDirectory() as temp,NativeDecoder() as decoder:
   path=Path(temp)/'bad.mp3';path.write_bytes(b'not audio')
   with self.assertRaisesRegex(ValueError,'decode'):decoder.decode(path)
