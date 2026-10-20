import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/app.dart';
import 'package:harbeat/src/controller.dart';
import 'package:harbeat/src/theme.dart';
import 'realtime_player_test.dart' show FakeRealtime, ProbeAudio, setup;

class MetricEngine extends FakeRealtime {
  final arguments = <Map<String, dynamic>>[];
  @override
  Future<Map<String, dynamic>> command(String method,
      [Map<String, dynamic> args = const {}]) async {
    arguments.add({'method': method, ...args});
    if (method == 'prepare') {
      for (final t in catalog) {
        t['styleLabels'] = [t['style']];
        t['playStatus'] = 'ready';
        t['mixStatus'] = 'ready';
      }
      state['metric'] = args['mode'] == 'metric'
          ? {'working': false, 'notice': '选择下一首后准备', 'selected': null}
          : null;
    }
    if (method == 'select') {
      state['metric'] = {
        ...state['metric'] as Map,
        'selected': args['trackId']
      };
    }
    return super.command(method, args);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
      'metric mode owns playback, selection does not restart it, current changes stop first',
      () async {
    final engine = MetricEngine(), audio = ProbeAudio();
    final c = await setup(engine, audio);
    addTearDown(c.dispose);
    await c.enableV3(mode: 'metric');
    expect(c.v3Metric, true);
    expect(engine.arguments.first['mode'], 'metric');
    await c.togglePlayback();
    final current = c.nowPlaying!.id;
    await c.metricSelectNext('track-b');
    expect(c.nowPlaying!.id, current);
    expect(engine.calls.where((m) => m == 'start'), hasLength(1));
    await c.metricPrepare();
    await c.metricMethod('filter');
    await c.metricApply(audition: true);
    expect(engine.arguments.last, {'method': 'metricApply', 'audition': true});
    await c.metricCurrent(c.v3Tracks.last);
    expect(engine.calls.last, 'stop');
    expect(c.nowPlaying!.id, 'nas:track-b');
    expect(audio.actions.where((m) => m.startsWith('play:')), isEmpty);
  });
  for (final scale in [1.0, 1.5]) {
    testWidgets('metric controls fit 360px at text scale $scale',
        (tester) async {
      tester.view.physicalSize = const Size(360, 820);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      late AppController c;
      await tester.runAsync(() async {
        c = await setup(MetricEngine(), ProbeAudio());
        await c.enableV3(mode: 'metric');
      });
      await tester.pumpWidget(MaterialApp(
          theme: HB.theme,
          builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context)
                  .copyWith(textScaler: TextScaler.linear(scale)),
              child: child!),
          home: AnimatedBuilder(
              animation: c, builder: (_, __) => Shell(controller: c))));
      await tester.scrollUntilVisible(find.text('准备智能交接'), 250);
      expect(find.text('下一首音乐'), findsOneWidget);
      expect(find.text('降低能量 ↓'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      c.dispose();
    });
  }
}
