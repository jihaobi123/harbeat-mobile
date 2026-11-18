// Build only as the independently signed nativeqa package, then restore the GUI.
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path_provider/path_provider.dart';
import 'package:harbeat/src/realtime_engine.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('real metric host mode and measured scratch lifecycle',
      (tester) async {
    await tester.pumpWidget(
        const MaterialApp(home: Scaffold(body: Text('HarBeat 现场控制实机检查'))));
    final engine = PlatformRealtimeEngine();
    Map<String, dynamic> state = {};
    final steps = <Map<String, dynamic>>[];
    final sub = engine.states.listen((value) {
      state = value;
    });
    Map<String, dynamic> fx() =>
        Map<String, dynamic>.from(state['performance'] as Map? ?? {});
    Future<void> command(String name,
        [Map<String, dynamic> args = const {}]) async {
      final reply = await engine.command(name, args);
      if (reply['state'] is Map) {
        state = Map<String, dynamic>.from(reply['state'] as Map);
      }
    }

    Future<void> until(bool Function() predicate) async {
      final deadline = DateTime.now().add(const Duration(seconds: 30));
      while (!predicate()) {
        if (DateTime.now().isAfter(deadline)) {
          fail('Timeout: ${jsonEncode(state)}');
        }
        await Future<void>.delayed(const Duration(milliseconds: 100));
      }
    }

    try {
      await command('prepare', {'mode': 'metric'});
      await command('direction', {'automatic': false});
      await command('start', {'trackId': 'track-d2d58531421de0eb9690'});
      await until(() => fx()['canScratch'] == true);
      final before = (state['position'] as num).toDouble();
      await command('mcMode', {'enabled': true});
      expect(fx()['mc'], true);
      steps.add({'step': 'host-on', 'position': before, 'performance': fx()});
      await Future<void>.delayed(const Duration(milliseconds: 650));
      await command('scratch');
      expect(fx()['mc'], false);
      expect(fx()['routing']['originalGain'], 0);
      expect(fx()['routing']['scratchGain'], .6);
      expect(fx()['scratching'], true);
      final first = Map<String, dynamic>.from(fx()['lastScratch'] as Map);
      final timing = Map<String, dynamic>.from(fx()['lastScratchTiming'] as Map);
      final diagnosticDir = await getExternalStorageDirectory();
      await File('${diagnosticDir!.path}/scratch-first-timing.json').writeAsString(jsonEncode(fx()));
      expect(first['version'], 'baby-scratch-v2');
      expect(timing['renderMs'], lessThan(200));
      expect(timing['leadMs'], greaterThanOrEqualTo(20));
      steps.add({
        'step': 'scratch',
        'performance': fx(),
        'position': state['position']
      });
      await until(() => fx()['scratching'] == false);
      expect((state['position'] as num).toDouble(), greaterThan(before + 1));
      expect(state['playing'], true);
      expect(state['buffering'], false);
      await command('seek', {'position': 20.3});
      await until(() => fx()['canScratch'] == true);
      await command('scratch');
      expect(fx()['scratching'], true);
      final second = Map<String, dynamic>.from(fx()['lastScratch'] as Map);
      expect(second['version'], 'baby-scratch-v2');
      expect(second['evidence'], 'measured-half-beats');
      expect((second['strokes'] as List).length, 4);
      await command('pause');
      expect(fx()['scratching'], false);
      expect(fx()['canScratch'], false);
      steps.add({
        'step': 'pause-cancels',
        'performance': fx(),
        'position': state['position']
      });
      final paused = (state['position'] as num).toDouble();
      await command('resume');
      await Future<void>.delayed(const Duration(seconds: 3));
      expect(fx()['scratching'], false);
      expect(state['playing'], true);
      expect((state['position'] as num).toDouble(), greaterThan(paused + 2));
      await command('stop');
      await command('start', {'trackId': 'track-4901bfdc3cf959f2899f'});
      await command('seek', {'position': 33.54});
      await until(() => fx()['canScratch'] == true);
      await command('scratch');
      final third = Map<String, dynamic>.from(fx()['lastScratch'] as Map);
      expect((third['strokes'] as List).length, 4);
      expect((third['duration'] as num).toDouble(), lessThan(first['duration'] as num));
      steps.add({'step': 'faster-track', 'performance': fx()});
      await until(() => fx()['scratching'] == false);
      await command('mcMode', {'enabled': true});
      await command('stop');
      expect(fx()['mc'], false);
      final output = {
        'schema': 'harbeat.performance-device-qa.v3',
        'passed': true,
        'firstPlan': first,
        'secondPlan': second,
        'thirdPlan': third,
        'steps': steps,
        'limitations': [
          'Digital timing and state checks do not replace subjective listening.'
        ]
      };
      final dir = await getExternalStorageDirectory();
      await File('${dir!.path}/performance-device-qa-v3.json')
          .writeAsString(jsonEncode(output));
      // ignore: avoid_print
      print(
          'PERFORMANCE_DEVICE_QA PASS first=${first['duration']}s/${(first['strokes'] as List).length} strokes second=${second['duration']}s/${(second['strokes'] as List).length} strokes');
    } finally {
      await engine.dispose();
      await sub.cancel();
    }
  },
      skip: !const bool.fromEnvironment('HARBEAT_LIVE_AUDIO_QA'),
      timeout: const Timeout(Duration(minutes: 8)));
}
