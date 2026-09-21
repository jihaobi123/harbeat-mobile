import 'native_mix_audio.dart';
import 'audio_service.dart';

AudioService createAudioService() => NativeMixAudio();
Future<void> initializeAudioPlatform() async {}
