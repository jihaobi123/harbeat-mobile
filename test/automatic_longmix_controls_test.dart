import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/app.dart';
import 'package:harbeat/src/controller.dart';

import 'realtime_player_test.dart' show FakeRealtime, ProbeAudio, setup;

const labEnabled = bool.fromEnvironment('HARBEAT_LONGMIX_LAB');

class LiveLayeringEngine extends FakeRealtime {
  final requests = <Map<String, dynamic>>[];
  bool failLayering = false;
  LiveLayeringEngine() {
    for (final row in catalog) {
      row['playStatus'] = 'ready';
      row['mixStatus'] = 'ready';
      row['styleLabels'] = ['Hip-Hop', 'Funk'];
    }
  }

  @override
  Future<Map<String, dynamic>> command(String method,
      [Map<String, dynamic> args = const {}]) async {
    requests.add({'method': method, ...args});
    if (method == 'prepare') {
      final result = await super.command(method, args);
      if (args['mode'] == 'metric') {
        emit({
          'metric': {
            'liveLayering': {
              'enabled': false,
              'state': 'idle',
              'reason': '当前使用普通混音',
            }
          }
        });
        return {...result, 'state': state};
      }
      return result;
    }
    if (method == 'loopExtension') {
      if (failLayering) throw StateError('循环未就绪');
      emit({
        'metric': {
          'loopExtension': {
            'enabled': args['enabled'],
            'cycles': args['cycles'],
            'state': 'idle',
            'reason': '已准备'
          }
        }
      });
      return {'state': state};
    }
    if (method == 'liveLayering') {
      if (failLayering) throw StateError('自动长混未就绪');
      calls.add(method);
      emit({
        'metric': {
          'liveLayering': {
            'enabled': args['enabled'] == true,
            'state': state['pending'] == null ? 'idle' : 'exit-requested',
            'reason':
                state['pending'] == null ? '按当前片段准备适合长混的音乐' : '将在合适出口恢复普通播放',
          }
        }
      });
      return {'state': state};
    }
    return super.command(method, args);
  }
}

Future<void> showControls(WidgetTester tester, AppController c) async {
  tester.view.physicalSize = const Size(390, 1400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(MaterialApp(
      home: Scaffold(
          body: AnimatedBuilder(
              animation: c, builder: (_, __) => PhoneMixScreen(c)))));
  await tester.pumpAndSettle();
}

void main() {
  test(
      'multi-source choice is lab-only and retained only after successful command',
      () async {
    final engine = LiveLayeringEngine();
    final c = await setup(engine, ProbeAudio());
    addTearDown(c.dispose);
    await c.enableV3(mode: 'metric');
    await c.setMultiLayering('c');
    expect(c.multiLayeringMode, labEnabled ? 'c' : 'off');
    if (labEnabled) {
      expect(engine.requests.last, {'method': 'multiLayering', 'mode': 'c'});
    }
    await c.setMultiLayering('unknown');
    expect(c.multiLayeringMode, labEnabled ? 'c' : 'off');
  });
  test(
      'role replacement modes remain lab only and reject unsupported role modes',
      () async {
    final engine = LiveLayeringEngine();
    final c = await setup(engine, ProbeAudio());
    addTearDown(c.dispose);
    await c.enableV3(mode: 'metric');
    for (final mode in ['roles-c', 'roles-cd']) {
      await c.setMultiLayering(mode);
      expect(c.multiLayeringMode, labEnabled ? mode : 'off');
      if (labEnabled) {
        expect(engine.requests.last, {'method': 'multiLayering', 'mode': mode});
      }
    }
    await c.setMultiLayering('roles-master');
    expect(c.multiLayeringMode, labEnabled ? 'roles-cd' : 'off');
  });
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => TestWidgetsFlutterBinding.ensureInitialized()
          .platformDispatcher
          .accessibilityFeaturesTestValue =
      const FakeAccessibilityFeatures(disableAnimations: true));
  tearDown(() => TestWidgetsFlutterBinding.ensureInitialized()
      .platformDispatcher
      .clearAccessibilityFeaturesTestValue());

  test('automatic A/B layering defaults on in the ordinary metric player',
      () async {
    final engine = LiveLayeringEngine();
    final c = await setup(engine, ProbeAudio());
    addTearDown(c.dispose);
    await c.enableV3(mode: 'metric');
    expect(engine.requests.where((r) => r['method'] == 'liveLayering'), [
      {'method': 'liveLayering', 'enabled': true}
    ]);
    expect(engine.requests.first, {'method': 'prepare', 'mode': 'metric'});
    expect(engine.requests.any((r) => r['method'] == 'continuousSet'), labEnabled);
  });

  test('the automatic longmix switch persists after a successful command',
      () async {
    final engine = LiveLayeringEngine();
    final c = await setup(engine, ProbeAudio());
    addTearDown(c.dispose);
    await c.enableV3(mode: 'metric');
    await c.setLiveLayering(false);
    expect(c.liveLayeringEnabled, isFalse);
    expect((await c.localStore.read())['liveLayeringEnabled'], isFalse);
    expect(engine.requests.last, {'method': 'liveLayering', 'enabled': false});
  });

  test('legacy preparation never enables automatic layering', () async {
    final engine = LiveLayeringEngine();
    final c = await setup(engine, ProbeAudio());
    addTearDown(c.dispose);
    await c.enableV3();
    expect(
        engine.requests.where((r) => r['method'] == 'liveLayering'), isEmpty);
  });

  testWidgets('ordinary playback exposes the A/B switch and lab-only controls stay scoped',
      (tester) async {
    final engine = LiveLayeringEngine();
    final c = (await tester.runAsync(() => setup(engine, ProbeAudio())))!;
    await tester.runAsync(() => c.enableV3(mode: 'metric'));
    await showControls(tester, c);
    expect(find.text('自动长混'), findsOneWidget);
    expect(find.byKey(const ValueKey('live-role-mode')),
        labEnabled ? findsOneWidget : findsNothing);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });

  if (!labEnabled) return;

  testWidgets(
      'role chooser can display replacement without losing percussion options',
      (tester) async {
    final engine = LiveLayeringEngine();
    final c = (await tester.runAsync(() => setup(engine, ProbeAudio())))!;
    await tester.runAsync(() => c.enableV3(mode: 'metric'));
    await tester.runAsync(() => c.setMultiLayering('roles-cd'));
    await showControls(tester, c);
    expect(tester.takeException(), isNull);
    expect(find.text('C 伴奏替换 + D 人声'), findsOneWidget);
    expect(find.byKey(const ValueKey('live-role-mode')), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });

  testWidgets(
      'replacement selection reports plain AB when no role approval is prepared',
      (tester) async {
    final engine = LiveLayeringEngine();
    final c = (await tester.runAsync(() => setup(engine, ProbeAudio())))!;
    await tester.runAsync(() => c.enableV3(mode: 'metric'));
    await tester.runAsync(() => c.setMultiLayering('roles-cd'));
    engine.emit({
      'metric': {
        'liveLayering': {
          'enabled': true,
          'prepared': true,
          'sourceCount': 2,
          'state': 'ready'
        }
      }
    });
    await showControls(tester, c);
    expect(find.text('本次沿用原 A/B，角色替换尚未就绪。'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });

  test('finite loop is isolated from layering and survives engine recreation',
      () async {
    final engine = LiveLayeringEngine();
    final c = await setup(engine, ProbeAudio());
    addTearDown(c.dispose);
    await c.enableV3(mode: 'metric');
    await c.setLoopExtension(true, cycles: 16);
    expect(c.loopExtensionRequested, true);
    expect(c.liveLayeringEnabled, false);
    expect(engine.requests.last,
        {'method': 'loopExtension', 'enabled': true, 'cycles': 16});
    await c.disableV3();
    await c.enableV3(mode: 'metric');
    expect(engine.requests.last,
        {'method': 'loopExtension', 'enabled': true, 'cycles': 16});
    engine.failLayering = true;
    await c.setLiveLayering(true);
    expect(c.loopExtensionRequested, true);
    expect(c.liveLayeringEnabled, false);
  });

  test(
      'temporary return outcome survives engine recreation and freezes during a scene',
      () async {
    final engine = LiveLayeringEngine();
    final c = await setup(engine, ProbeAudio());
    addTearDown(c.dispose);
    await c.enableV3(mode: 'metric');
    await c.setLiveLayeringOutcome('return-a');
    expect(c.liveLayeringOutcome, 'return-a');
    expect(engine.requests.last,
        {'method': 'liveLayering', 'enabled': true, 'outcome': 'return-a'});
    engine.emit({
      'pending': {'title': 'attached B', 'remaining': 20, 'locked': true}
    });
    engine.requests.clear();
    await c.setLiveLayeringOutcome('takeover-b');
    expect(engine.requests, isEmpty);
    expect(c.liveLayeringOutcome, 'return-a');
    engine.emit({'pending': null});
    await c.disableV3();
    await c.enableV3(mode: 'metric');
    expect(engine.requests.last,
        {'method': 'liveLayering', 'enabled': true, 'outcome': 'return-a'});
  });

  test('switching back from return explicitly restores B takeover', () async {
    final engine = LiveLayeringEngine();
    final c = await setup(engine, ProbeAudio());
    addTearDown(c.dispose);
    await c.enableV3(mode: 'metric');
    await c.setLiveLayeringOutcome('return-a');
    await c.setLiveLayeringOutcome('takeover-b');
    expect(engine.requests.last,
        {'method': 'liveLayering', 'enabled': true, 'outcome': 'takeover-b'});
    expect(c.liveLayeringOutcome, 'takeover-b');
  });

  testWidgets(
      'armed scenes keep next wording until the live entrance is locked',
      (tester) async {
    final engine = LiveLayeringEngine();
    final c = (await tester.runAsync(() => setup(engine, ProbeAudio())))!;
    await tester.runAsync(() => c.enableV3(mode: 'metric'));
    engine.emit({
      'current': engine.catalog[0],
      'playing': true,
      'pending': {'title': 'Cold', 'remaining': 30, 'locked': false},
      'metric': {
        'liveLayering': {
          'enabled': true,
          'state': 'armed',
          'reason': '等待长混入口',
        }
      }
    });
    await showControls(tester, c);
    expect(find.text('合适点退出长混'), findsNothing);
    final next = find.widgetWithText(TextButton, '下一首');
    expect(tester.widget<TextButton>(next).onPressed, isNotNull);
    engine.requests.clear();
    await tester.ensureVisible(next);
    await tester.tap(next);
    await tester.pumpAndSettle();
    expect(engine.requests, [
      {'method': 'recommend'}
    ]);
    engine.emit({
      'pending': {'title': 'Cold', 'remaining': 20, 'locked': true},
    });
    await tester.pumpAndSettle();
    expect(find.text('合适点退出长混'), findsNWidgets(2));
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });

  testWidgets('ordinary pending transitions keep their next button locked',
      (tester) async {
    final engine = LiveLayeringEngine();
    final c = (await tester.runAsync(() => setup(engine, ProbeAudio())))!;
    await tester.runAsync(() => c.enableV3(mode: 'metric'));
    engine.emit({
      'current': engine.catalog[0],
      'playing': true,
      'pending': {'title': 'Cold', 'remaining': 8, 'locked': true},
    });
    await showControls(tester, c);
    final next =
        tester.widget<TextButton>(find.widgetWithText(TextButton, '下一首'));
    expect(next.onPressed, isNull);
    expect(find.text('合适点退出长混'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });

  testWidgets('music direction stays editable while a live scene is playing',
      (tester) async {
    final engine = LiveLayeringEngine();
    final c = (await tester.runAsync(() => setup(engine, ProbeAudio())))!;
    await tester.runAsync(() => c.enableV3(mode: 'metric'));
    engine.emit({
      'current': engine.catalog[0],
      'playing': true,
      'pending': {'title': 'Cold', 'remaining': 30, 'locked': true},
      'metric': {
        'release': {'executionPolicy': 'listen-live-v1'},
        'liveLayering': {
          'enabled': true,
          'state': 'playing',
          'reason': '两首音乐正在共同播放',
        }
      }
    });
    await showControls(tester, c);
    engine.requests.clear();
    await tester.scrollUntilVisible(find.text('高能'), 240);
    await tester.ensureVisible(find.text('高能'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('高能'));
    await tester.pumpAndSettle();
    final style = find.byKey(ValueKey('listening-style-${c.smartStyle}'));
    await tester.ensureVisible(style);
    await tester.tap(style);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Funk').last);
    await tester.pumpAndSettle();
    expect(engine.requests.map((r) => r['method']), ['direction', 'direction']);
    expect(engine.requests.last, {
      'method': 'direction',
      'energy': 4,
      'style': 'Funk',
      'automatic': true
    });
    expect(c.isPlaying, isTrue);
    expect(c.v3Pending, isNotNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });

  testWidgets(
      'next remains an available safe-exit request during live layering',
      (tester) async {
    final engine = LiveLayeringEngine();
    final c = (await tester.runAsync(() => setup(engine, ProbeAudio())))!;
    await tester.runAsync(() => c.enableV3(mode: 'metric'));
    engine.emit({
      'current': engine.catalog[0],
      'playing': true,
      'pending': {'title': 'Cold', 'remaining': 30, 'locked': true},
      'metric': {
        'liveLayering': {
          'enabled': true,
          'state': 'playing',
          'reason': '两首音乐正在共同播放',
        }
      }
    });
    await showControls(tester, c);
    engine.requests.clear();
    final exit = find.text('合适点退出长混').first;
    await tester.ensureVisible(exit);
    await tester.tap(exit);
    await tester.pumpAndSettle();
    expect(engine.requests, [
      {'method': 'recommend'}
    ]);
    expect(c.isPlaying, isTrue);
    expect(c.v3Pending, isNotNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });

  test('failed layering configuration leaves the ordinary player available',
      () async {
    final engine = LiveLayeringEngine()..failLayering = true;
    final c = await setup(engine, ProbeAudio());
    addTearDown(c.dispose);
    await c.enableV3(mode: 'metric');
    expect(c.v3Active, isTrue);
    expect(c.v3Metric, isTrue);
    expect(c.v3Error, contains('普通混音仍可使用'));
  });

  testWidgets(
      'disabling a playing scene requests its safe exit without stopping',
      (tester) async {
    final engine = LiveLayeringEngine();
    final c = (await tester.runAsync(() => setup(engine, ProbeAudio())))!;
    await tester.runAsync(() => c.enableV3(mode: 'metric'));
    engine.emit({
      'current': engine.catalog[0],
      'playing': true,
      'pending': {'title': 'Cold', 'remaining': 30, 'locked': true},
      'metric': {
        'liveLayering': {
          'enabled': true,
          'state': 'playing',
          'reason': '两首音乐正在共同播放',
        }
      }
    });
    await showControls(tester, c);
    engine.requests.clear();
    await tester.ensureVisible(find.text('自动长混'));
    await tester.tap(find.text('自动长混'));
    await tester.pumpAndSettle();
    expect(engine.requests, [
      {'method': 'liveLayering', 'enabled': false}
    ]);
    expect(c.isPlaying, isTrue);
    expect(find.text('将在合适出口恢复普通播放'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });

  testWidgets('chosen layering setting survives ordinary engine recreation',
      (tester) async {
    final engine = LiveLayeringEngine();
    final c = (await tester.runAsync(() => setup(engine, ProbeAudio())))!;
    await tester.runAsync(() => c.enableV3(mode: 'metric'));
    await showControls(tester, c);
    await tester.ensureVisible(find.text('自动长混'));
    await tester.tap(find.text('自动长混'));
    await tester.pumpAndSettle();
    await tester.runAsync(() => c.disableV3());
    await tester.runAsync(() => c.enableV3(mode: 'metric'));
    expect(engine.requests.last, {'method': 'liveLayering', 'enabled': false});
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
}
