import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/app.dart';
import 'package:harbeat/src/controller.dart';
import 'package:harbeat/src/theme.dart';
import 'metric_player_test.dart' show MetricEngine;
import 'realtime_player_test.dart' show ProbeAudio, setup;

class PerformanceEngine extends MetricEngine {
  @override
  Future<Map<String, dynamic>> command(String method,
      [Map<String, dynamic> args = const {}]) async {
    if (method == 'mcMode') {
      state['performance'] = {
        ...state['performance'] as Map,
        'mc': args['enabled']
      };
    }
    if (method == 'scratch') {
      state['performance'] = {
        ...state['performance'] as Map,
        'mc': false,
        'scratching': true,
        'canScratch': false
      };
    }
    return super.command(method, args);
  }
}

void main() {
  // These exercise playback actions; dedicated turntable tests cover motion.
  setUp(() {
    TestWidgetsFlutterBinding.ensureInitialized()
            .platformDispatcher
            .accessibilityFeaturesTestValue =
        const FakeAccessibilityFeatures(disableAnimations: true);
  });
  tearDown(() => TestWidgetsFlutterBinding.ensureInitialized()
      .platformDispatcher
      .clearAccessibilityFeaturesTestValue());
  testWidgets(
      'host and scratch controls forward real engine commands and reflect the reply',
      (tester) async {
    final engine = PerformanceEngine();
    late AppController c;
    await tester.runAsync(() async {
      c = await setup(engine, ProbeAudio());
      await c.enableV3(mode: 'metric');
      await c.setSmartDirection(automatic: false);
      await c.togglePlayback();
    });
    engine.emit({
      'performance': {
        'supported': true,
        'mc': false,
        'scratching': false,
        'canScratch': true
      }
    });
    await tester.pumpWidget(
        MaterialApp(theme: HB.theme, home: Scaffold(body: PhoneMixScreen(c))));
    await tester.scrollUntilVisible(
        find.byKey(const ValueKey('performance-host')), 250);
    await tester.ensureVisible(find.byKey(const ValueKey('performance-host')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('performance-host')));
    await tester.pump();
    expect(engine.arguments.last, {'method': 'mcMode', 'enabled': true});
    await tester.pumpWidget(
        MaterialApp(theme: HB.theme, home: Scaffold(body: PhoneMixScreen(c))));
    expect(find.text('退出主持模式'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('performance-scratch')));
    await tester.pump();
    expect(engine.arguments.last, {'method': 'scratch'});
    expect(c.v3State['performance']['mc'], false);
    await tester.pumpWidget(
        MaterialApp(theme: HB.theme, home: Scaffold(body: PhoneMixScreen(c))));
    expect(find.text('回应中…'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
  testWidgets(
      'unprepared playback never exposes an enabled fake scratch button',
      (tester) async {
    late AppController c;
    await tester.runAsync(() async {
      c = await setup(PerformanceEngine(), ProbeAudio());
    });
    await tester.pumpWidget(
        MaterialApp(theme: HB.theme, home: Scaffold(body: PhoneMixScreen(c))));
    await tester.scrollUntilVisible(
        find.byKey(const ValueKey('performance-scratch')), 250);
    final button = find.descendant(
        of: find.byKey(const ValueKey('performance-scratch')),
        matching: find.byType(FilledButton));
    expect(tester.widget<FilledButton>(button).onPressed, isNull);
    expect(find.text('搓碟回应'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
}
