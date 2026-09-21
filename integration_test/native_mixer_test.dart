// Native capture is experimental in the pinned SoLoud version and used only by QA.
// ignore_for_file: experimental_member_use
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:flutter_soloud/flutter_soloud.dart';
import 'package:path_provider/path_provider.dart';
import 'package:harbeat/src/native_mix_audio.dart';
import 'package:harbeat/src/mix_planner.dart';

Future<File> tone(Directory folder, String name, double hz) async {
  const rate = 44100, samples = rate * 12;
  final bytes = ByteData(44 + samples * 2);
  void text(int offset, String s) {
    for (var i = 0; i < s.length; i++) {
      bytes.setUint8(offset + i, s.codeUnitAt(i));
    }
  }

  text(0, 'RIFF');
  bytes.setUint32(4, 36 + samples * 2, Endian.little);
  text(8, 'WAVEfmt ');
  bytes.setUint32(16, 16, Endian.little);
  bytes.setUint16(20, 1, Endian.little);
  bytes.setUint16(22, 1, Endian.little);
  bytes.setUint32(24, rate, Endian.little);
  bytes.setUint32(28, rate * 2, Endian.little);
  bytes.setUint16(32, 2, Endian.little);
  bytes.setUint16(34, 16, Endian.little);
  text(36, 'data');
  bytes.setUint32(40, samples * 2, Endian.little);
  for (var i = 0; i < samples; i++) {
    bytes.setInt16(44 + i * 2, (3000 * sin(2 * pi * hz * i / rate)).round(),
        Endian.little);
  }
  return File('${folder.path}/$name.wav')
      .writeAsBytes(bytes.buffer.asUint8List());
}

double amplitude(Float32List samples, double hz, int start, int end) {
  double real = 0, imaginary = 0;
  for (var i = start; i < end; i++) {
    final phase = 2 * pi * hz * i / 44100;
    real += samples[i] * cos(phase);
    imaginary += samples[i] * sin(phase);
  }
  return 2 * sqrt(real * real + imaginary * imaginary) / (end - start);
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
      'real native mixer captures two voices, preserves pitch, cancels and pauses',
      (tester) async {
    final folder = await getTemporaryDirectory();
    final a = await tone(folder, 'qa-mix-a', 440);
    final b = await tone(folder, 'qa-mix-b', 660);
    final player = NativeMixAudio();
    await player.initialize();
    final captured = BytesBuilder(copy: false);
    final captureClock = SoLoud.instance.getEngineTime();
    var mixStartSeconds = 0.0;
    final capture = SoLoud.instance
        .startMixerOutputStream(
            // Capture must match the native stereo mixer; this API does not
            // downmix when a different channel count is requested.
            format: MixerOutputFormat.pcmF32le,
            channels: 2,
            sampleRate: 44100)
        .listen(captured.add);
    try {
      await player.play(filePath: a.path, title: 'QA synthetic A');
      await Future<void>.delayed(const Duration(seconds: 1));
      final mixed = player.mixTo(
          filePath: b.path,
          title: 'QA synthetic B',
          plan: (position, length, nextLength) {
            mixStartSeconds = (SoLoud.instance.getEngineTime() - captureClock)
                        .inMicroseconds /
                    1000000 +
                .8;
            return MixPlan(
                outgoingCueMs: position.inMilliseconds + 800,
                incomingCueMs: 2000,
                overlapMs: 2000,
                incomingRate: 1.05,
                note: 'QA');
          });
      expect(await mixed.timeout(const Duration(seconds: 8)), isTrue);
      await Future<void>.delayed(const Duration(seconds: 1));
      SoLoud.instance.stopMixerOutputStream();
      await capture.cancel();
      final bytes = captured.takeBytes();
      await File('${folder.path}/qa-native-mix.f32').writeAsBytes(bytes);
      final stereo = Float32List.view(
          bytes.buffer, bytes.offsetInBytes, bytes.length ~/ 4);
      final samples = Float32List(stereo.length ~/ 2);
      for (var i = 0; i < samples.length; i++) {
        samples[i] = stereo[2 * i];
      }
      expect(samples.length, greaterThan(44100 * 4));
      final start = ((mixStartSeconds + .8) * 44100).round();
      final end = ((mixStartSeconds + 1.2) * 44100).round();
      final aLevel = amplitude(samples, 440, start, end);
      final bLevel = amplitude(samples, 660, start, end);
      final wrongPitch = amplitude(samples, 693, start, end);
      expect(aLevel, greaterThan(.005));
      expect(bLevel, greaterThan(.003));
      expect(bLevel, greaterThan(wrongPitch * 3));
      expect(samples.every((v) => v.isFinite && v.abs() < .3), isTrue);
      await player.pause();
      final paused = player.currentPosition;
      await Future<void>.delayed(const Duration(milliseconds: 400));
      expect(
          (player.currentPosition - paused).inMilliseconds.abs(), lessThan(50));
      await player.resume();
      final cancelled = player.mixTo(
          filePath: a.path,
          title: 'QA cancel',
          plan: (position, length, nextLength) => MixPlan(
              outgoingCueMs: position.inMilliseconds + 1500,
              incomingCueMs: 0,
              overlapMs: 1000,
              incomingRate: 1,
              note: 'QA cancel'));
      await Future<void>.delayed(const Duration(milliseconds: 300));
      player.cancelMix();
      expect(await cancelled, isFalse);
      await Future<void>.delayed(const Duration(milliseconds: 1800));
      expect(player.currentPosition, greaterThan(paused));
      // ignore: avoid_print
      print(
          'NATIVE_QA samples=${samples.length} A440=$aLevel B660=$bLevel wrong693=$wrongPitch pause_cancel=OK');
    } finally {
      if (SoLoud.instance.isMixerOutputStreamRunning) {
        SoLoud.instance.stopMixerOutputStream();
      }
      await capture.cancel();
      await player.dispose();
    }
  });
}
