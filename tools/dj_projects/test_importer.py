import unittest,tempfile,pathlib,hashlib
from importer import import_project,compile_requests
from traktor_pack import import_trak
class ImportTests(unittest.TestCase):
 def test_native_remix_pack_binds_named_audio_but_does_not_invent_launch_order(self):
  import base64,struct
  enc=lambda s:base64.b64encode(s.encode('utf-16le')).decode()
  wave=b'RIFF'+struct.pack('<I',40)+b'WAVEfmt '+struct.pack('<IHHIIHH',16,1,2,44100,176400,4,16)+b'data'+struct.pack('<I',4)+b'\x00'*4
  descriptor=bytearray(2048);descriptor[800:800+len('kick.wav')*2]='kick.wav'.encode('utf-16le')
  raw=b'/\\ NI FC MTD  /\\'+bytes(descriptor)+wave+f'<?xml version="1.0"?><TraktorSet><Title>{enc("Artist Set")}</Title><BPM>88</BPM></TraktorSet><?xml version="1.0"?><TraktorSlot><FxEnable>false</FxEnable></TraktorSlot><?xml version="1.0"?><TraktorCell><RelativeFilename>{enc("kick.wav")}</RelativeFilename><Name>{enc("Kick")}</Name><BPM>88</BPM><Active>true</Active><StartMarker>0</StartMarker></TraktorCell>'.encode()
  with tempfile.TemporaryDirectory()as d:
   v=import_trak(raw,pathlib.Path(d),'https://artist.example/set');self.assertEqual(v['tracks'][0]['audioSha256'],hashlib.sha256(wave).hexdigest());self.assertEqual(v['cells'][0]['name'],'Kick');self.assertFalse(v['executionApproved']);self.assertEqual(v['performanceOrder'],'unknown');self.assertEqual(v['transitions'],[])
   self.assertEqual(v['cells'][0]['raw']['Active'],'true')
   for bad in [raw.replace(b'<BPM>88</BPM>',b'<BPM>nan</BPM>'),raw.replace(b'data\x04\x00\x00\x00',b'data\xe8\x03\x00\x00')]:
    with self.assertRaises(ValueError):import_trak(bad,pathlib.Path(d)/'bad-audio','https://artist.example/set')
   other=pathlib.Path(d)/'symlink';other.mkdir();(other/'kick.wav').symlink_to(pathlib.Path(d)/'outside.wav')
   with self.assertRaises(ValueError):import_trak(raw,other,'https://artist.example/set')
   self.assertFalse((pathlib.Path(d)/'outside.wav').exists())
   with self.assertRaises(ValueError):import_trak(raw.replace(enc('kick.wav').encode(),enc('../kick.wav').encode()),pathlib.Path(d)/'bad','https://artist.example/set')
 def test_explicit_cross_track_rule_binds_audio_and_cues_without_inventing_fx(self):
  xml=b'''<DJ_PLAYLISTS><COLLECTION><TRACK TrackID="1" Name="A" Location="file://localhost/A.wav"><TEMPO Inizio="0" Bpm="98"/><POSITION_MARK Name="Out" Type="0" Start="64" Num="3"/></TRACK><TRACK TrackID="2" Name="B" Location="file://localhost/B.wav"><POSITION_MARK Name="In" Type="0" Start="8" Num="0"/></TRACK></COLLECTION><PLAYLISTS><NODE Type="1" Name="Artist order" KeyType="0"><TRACK Key="1"/><TRACK Key="2"/></NODE></PLAYLISTS></DJ_PLAYLISTS>'''
  with tempfile.TemporaryDirectory()as d:
   root=pathlib.Path(d);(root/'A.wav').write_bytes(b'A');(root/'B.wav').write_bytes(b'B');v=import_project(xml,'rekordbox',root,'https://artist.example/project',{'1':hashlib.sha256(b'A').hexdigest(),'2':hashlib.sha256(b'B').hexdigest()});self.assertEqual(v['tracks'][0]['audioSha256'],hashlib.sha256(b'A').hexdigest());self.assertEqual(v['transitions'],[])
   requests=compile_requests(v,[dict(fromId='1',toId='2',fromCue='3',toCue='0',instructionSource='author-readme',overlapBeats=16)])
   self.assertEqual(requests[0]['sourceWindow'],{'aStart':64.0,'bStart':8.0});self.assertIsNone(requests[0]['automation']);self.assertFalse(requests[0]['executionApproved']);self.assertEqual(requests[0]['authority'],'author-rule-awaiting-jetson')
 def test_unsafe_xml_paths_or_missing_cue_do_not_become_executable(self):
  with tempfile.TemporaryDirectory()as d:
   for xml in ['<?xml version="1.0" encoding="utf-16"?><!DOCTYPE DJ_PLAYLISTS [<!ENTITY x "EXPANDED">]><DJ_PLAYLISTS/>'.encode('utf-16'),b'<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><NML/>',b'<DJ_PLAYLISTS><COLLECTION><TRACK TrackID="1" Location="file://localhost/../../outside.wav"/></COLLECTION></DJ_PLAYLISTS>']:
    with self.assertRaises(ValueError):import_project(xml,'rekordbox',pathlib.Path(d),'https://artist.example')
 def test_same_basename_is_only_a_candidate_without_author_package_fingerprint(self):
  xml=b'<DJ_PLAYLISTS><COLLECTION><TRACK TrackID="1" Location="file://localhost/other-studio/edit.wav"><POSITION_MARK Type="0" Start="1" Num="0"/></TRACK><TRACK TrackID="2" Location="file://localhost/other-studio/B.wav"><POSITION_MARK Type="0" Start="1" Num="0"/></TRACK></COLLECTION></DJ_PLAYLISTS>'
  with tempfile.TemporaryDirectory()as d:
   r=pathlib.Path(d);(r/'edit.wav').write_bytes(b'wrong-edit');(r/'B.wav').write_bytes(b'b');v=import_project(xml,'rekordbox',r,'https://artist.example')
   self.assertEqual(v['tracks'][0]['audioMatch'],'unique-filename-relocation');self.assertFalse(v['tracks'][0]['audioVerified'])
   with self.assertRaises(ValueError):compile_requests(v,[dict(fromId='1',toId='2',fromCue='0',toCue='0',instructionSource='author-readme',overlapBeats=16)])
 def test_nml_loop_is_milliseconds_and_launch_order_remains_unknown(self):
  xml=b'''<NML><COLLECTION><ENTRY TITLE="Kick" AUDIO_ID="x"><LOCATION DIR="/:Samples/:" FILE="kick.wav"/><TEMPO BPM="98"/><CUE_V2 NAME="Loop" TYPE="5" START="1250" LEN="4897.959" HOTCUE="0"/></ENTRY></COLLECTION></NML>'''
  with tempfile.TemporaryDirectory()as d:
   r=pathlib.Path(d);(r/'Samples').mkdir();(r/'Samples/kick.wav').write_bytes(b'audio');v=import_project(xml,'traktor',r,'https://artist.example');self.assertEqual(v['tracks'][0]['cues'][0]['startSeconds'],1.25);self.assertAlmostEqual(v['tracks'][0]['cues'][0]['endSeconds'],6.147959);self.assertEqual(v['transitions'],[]);self.assertEqual(v['performanceOrder'],'unknown')
if __name__=='__main__':unittest.main()
