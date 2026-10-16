import 'package:harbeat/src/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/app.dart';
import 'package:harbeat/src/controller.dart';
import 'realtime_player_test.dart' show FakeRealtime, ProbeAudio, setup;

class ContinuousEngine extends FakeRealtime {
  @override
  Future<Map<String, dynamic>> command(String method,
      [Map<String, dynamic> args = const {}]) async {
    if (method == 'prepare') {
      for (final t in catalog) {
        t['styleLabels'] = [t['style']];
        t['playStatus'] = 'ready';
      }
      state['continuous'] = args['mode'] == 'legacy'
          ? null
          : {
              'preview': true,
              'automatic': true,
              'volume': .85,
              'label': '',
              'selection': {'id': null, 'status': 'idle'},
            };
    }
    return super.command(method, args);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('continuous selection prepares next without restarting current playback',
      () async {
    final engine = ContinuousEngine(), audio = ProbeAudio();
    final c = await setup(engine, audio);
    addTearDown(c.dispose);
    await c.enableV3();
    expect(c.v3Continuous, true);
    await c.togglePlayback();
    final current = c.nowPlaying?.id;
    await c.v3Select(c.v3Tracks.last);
    expect(engine.calls.last, 'select');
    expect(c.nowPlaying?.id, current);
    expect(engine.calls.where((m) => m == 'start').length, 1);
    expect(c.isPlaying, true);
    await c.continuousVolume(.4);
    expect(engine.calls.last, 'volume');
    await c.continuousAutomatic(false);
    expect(engine.calls.last, 'automatic');
  });
  test('unavailable continuous tracks do not start and mode switch stops first',
      () async {
    final engine = ContinuousEngine(), audio = ProbeAudio();
    final c = await setup(engine, audio);
    addTearDown(c.dispose);
    await c.enableV3();
    c.v3Catalog.last['playStatus'] = 'unavailable';
    final count = engine.calls.length;
    await c.v3Select(c.v3Tracks.last);
    expect(engine.calls.length, count);
    expect(c.v3Error, contains('尚未就绪'));
    await c.switchV3Mode(false);
    expect(engine.calls.sublist(engine.calls.length - 2), ['stop', 'prepare']);
    expect(c.v3Continuous, false);
  });
  test('user can explicitly pause while the continuous clock is buffering',
      () async {
    final engine = ContinuousEngine(), audio = ProbeAudio();
    final c = await setup(engine, audio);
    addTearDown(c.dispose);
    await c.enableV3();
    engine.emit({
      'playing': false,
      'buffering': true,
      'paused': false,
      'current': engine.catalog.first
    });
    await c.togglePlayback();
    expect(engine.calls.last, 'pause');
  });
  testWidgets(
      'narrow original playback page exposes continuous controls and readiness',
      (tester) async {
    tester.view.physicalSize = const Size(360, 820);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    late AppController c;
    await tester.runAsync(() async {
      c = await setup(ContinuousEngine(), ProbeAudio());
      await c.enableV3();
    });
    await tester.pumpWidget(MaterialApp(
        theme: HB.theme,
        home: AnimatedBuilder(
            animation: c, builder: (_, __) => Shell(controller: c))));
    await tester.scrollUntilVisible(find.text('自动接歌'), 300);
    expect(find.text('新版连续混音'), findsOneWidget);
    expect(find.textContaining('完整曲库素材尚未上线'), findsOneWidget);
    expect(find.text('自动接歌'), findsOneWidget);
    expect(find.text('提高能量 ↑'), findsNothing);
    await tester.scrollUntilVisible(find.text('边听边选下一首'), 350);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
}
