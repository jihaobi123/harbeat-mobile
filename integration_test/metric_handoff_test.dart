// Build with harbeatQa=true and HARBEAT_LIVE_AUDIO_QA=true, verify .nativeqa,
// then flutter drive --use-application-binary with metric_handoff_driver.dart.
// Keep the app running until its external QA report has been collected.
import 'dart:convert';
import 'dart:collection';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path_provider/path_provider.dart';
import 'package:harbeat/src/realtime_engine.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
      'real Android metric engine prepares and executes a Jetson handoff',
      (tester) async {
    const a = 'track-d2d58531421de0eb9690'; // HIPHOP
    const b = 'track-831997216a86a4914ef9'; // Make It Right
    await tester.pumpWidget(const MaterialApp(
        home: Scaffold(body: Text('HarBeat real-device metric handoff QA'))));
    final engine = PlatformRealtimeEngine();
    final snapshots = Queue<Map<String, dynamic>>();
    var executing = false, executionBuffered = false;
    Map<String, dynamic> state = {};
    final subscription = engine.states.listen((value) {
      state = value;
      if (executing && value['buffering'] == true) executionBuffered = true;
      snapshots.add(value);
      if (snapshots.length > 1600) snapshots.removeFirst();
    });
    Map<String, dynamic> object(dynamic value) =>
        Map<String, dynamic>.from(value as Map);
    Future<Map<String, dynamic>> command(String name,
        [Map<String, dynamic> args = const {}]) async {
      final reply = await engine.command(name, args);
      if (reply['state'] is Map) state = object(reply['state']);
      return reply;
    }

    try {
      final prepared = await command('prepare', {'mode': 'metric'});
      final tracks = prepared['tracks'] as List;
      expect(tracks.any((t) => t['id'] == a), isTrue);
      expect(tracks.any((t) => t['id'] == b), isTrue);
      await command('direction', {'automatic': false});
      await command('start', {'trackId': a});
      await command('pause');
      await command('seek', {'position': 25.0});
      await command('select', {'trackId': b});
      await command('metricPrepare');
      final metric = object(state['metric']);
      final result = object(metric['result']);
      expect(result['policyVersion'], 'jetson-decision-v1');
      final plan = object(result['plan']);
      final method = metric['method'];
      expect(method, isNot('original'),
          reason:
              'This known-benefit pair must exercise an approved stem method.');
      expect(plan['from'], a);
      expect(plan['to'], b);
      expect((plan['duration'] as num).toDouble(), greaterThan(1));
      expect((plan['rate'] as num).toDouble(), inInclusiveRange(.95, 1.05));
      expect(object(object(result['decision'])['methods'])[method]['eligible'],
          isTrue);
      snapshots.clear();
      executing = true;
      await command('metricApply');
      await command('resume');
      final timeout = DateTime.now().add(const Duration(minutes: 3));
      while (object(state['current'])['id'] != b) {
        if (DateTime.now().isAfter(timeout)) {
          fail('Handoff did not finish: ${jsonEncode(state)}');
        }
        expect(state['buffering'], isFalse);
        await Future<void>.delayed(const Duration(milliseconds: 250));
      }
      final bodyPosition = (state['position'] as num).toDouble();
      final previousHealthFrame = object(state['audioHealth'])['frame'] as num;
      await Future<void>.delayed(const Duration(seconds: 8));
      await command('pause');
      expect(object(state['current'])['id'], b);
      expect(state['buffering'], isFalse);
      expect(executionBuffered, isFalse);
      expect(
          (state['position'] as num).toDouble() - bodyPosition, greaterThan(7));
      expect(object(state['audioHealth'])['frame'] as num,
          greaterThan(previousHealthFrame));
      final observations = state['observations'] as List;
      expect(observations.length, greaterThanOrEqualTo(2));
      expect(observations.any((o) => o['name'] == '本机声部交接开始'), isTrue);
      expect(observations.every((o) => o['late'] == 0), isTrue);
      expect((object(state['audioHealth'])['rms'] as num).toDouble(),
          greaterThan(0));
      // Full source-bound session is saved by the normal pause command, too.
      final folder = await getExternalStorageDirectory();
      await File('${folder!.path}/metric-handoff-probe.json')
          .writeAsString(jsonEncode({
        'schema': 'harbeat.android-metric-probe.v1',
        'from': a,
        'to': b,
        'plan': plan,
        'method': method,
        'snapshots': snapshots.toList(),
        'limitations': [
          'Digital output health is not subjective sound quality.'
        ]
      }));
      // ignore: avoid_print
      print('METRIC_DEVICE_QA method=$method duration=${plan['duration']} '
          'observations=${observations.length} no_buffering=true');
    } finally {
      await engine.dispose();
      await subscription.cancel();
    }
  },
      skip: !const bool.fromEnvironment('HARBEAT_LIVE_AUDIO_QA'),
      timeout: const Timeout(Duration(minutes: 12)));
}
