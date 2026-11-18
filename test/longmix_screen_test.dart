import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/app.dart';
import 'package:harbeat/src/controller.dart';
import 'package:harbeat/src/models.dart';

import 'realtime_player_test.dart' show FakeRealtime, ProbeAudio, setup;

const labEnabled = bool.fromEnvironment('HARBEAT_LONGMIX_LAB');

class LongmixEngine extends FakeRealtime {
  final requests = <Map<String, dynamic>>[];
  bool failPrepare = false, failLoad = false;
  int disposals = 0;
  Completer<void>? pendingPrepare, pendingStop;
  @override
  Future<Map<String, dynamic>> command(String method,
      [Map<String, dynamic> args = const {}]) async {
    requests.add({'method': method, ...args});
    if (args['mode'] != 'longmix' && method == 'prepare') {
      return super.command(method, args);
    }
    if (method == 'prepare') {
      if (pendingPrepare != null) await pendingPrepare!.future;
      if (failPrepare) throw StateError('准备失败');
      return {
        'ok': true,
        'scenes': [
          {
            'id': 'scene-1',
            'title': 'A 接 B',
            'duration': 48,
            'fromTitle': 'A',
            'toTitle': 'B'
          }
        ],
        'state': {'ready': true, 'playing': false, 'status': '选择试听方式'}
      };
    }
    if (method == 'stop' && failStop) throw StateError('普通停止失败');
    if (method == 'stop' && pendingStop != null) await pendingStop!.future;
    if (method == 'loadScene' && failLoad) throw StateError('素材校验失败');
    final next = <String, dynamic>{
      if (method == 'loadScene')
        'scene': {
          'id': args['sceneId'],
          'title': 'A 接 B',
          'variant': args['variant'],
          'phase': 'prepared'
        },
      if (method == 'start' || method == 'resume') ...{
        'playing': true,
        'paused': false
      },
      if (method == 'pause') ...{'playing': false, 'paused': true},
      if (method == 'stop') ...{'playing': false, 'paused': false},
    };
    emit(next);
    return {'ok': true, 'state': state};
  }

  // The platform wrapper can be reused after its underlying native engine closes.
  @override
  Future<void> dispose() async {
    disposals++;
  }
}

class PendingStopAudio extends ProbeAudio {
  final stopped = Completer<void>();
  @override
  Future<void> stop() async {
    await super.stop();
    await stopped.future;
  }
}

Future<void> showPhone(WidgetTester tester, AppController c) async {
  tester.view.physicalSize = const Size(390, 1400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(MaterialApp(home: Scaffold(body: PhoneMixScreen(c))));
  await tester.pumpAndSettle();
}

Future<void> enterLab(WidgetTester tester) async {
  await tester.scrollUntilVisible(find.text('两来源长混试听'), 240);
  await tester.ensureVisible(find.text('两来源长混试听'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('两来源长混试听'));
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => TestWidgetsFlutterBinding.ensureInitialized()
          .platformDispatcher
          .accessibilityFeaturesTestValue =
      const FakeAccessibilityFeatures(disableAnimations: true));
  tearDown(() => TestWidgetsFlutterBinding.ensureInitialized()
      .platformDispatcher
      .clearAccessibilityFeaturesTestValue());
  testWidgets('longmix entry follows the compile-time flag', (tester) async {
    final c =
        (await tester.runAsync(() => setup(LongmixEngine(), ProbeAudio())))!;
    await showPhone(tester, c);
    expect(find.text('两来源长混试听'), labEnabled ? findsOneWidget : findsNothing);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
  if (!labEnabled) return;

  testWidgets(
      'failed ordinary stop still returns to a usable inactive normal player',
      (tester) async {
    final engine = LongmixEngine();
    final c = (await tester.runAsync(() => setup(engine, ProbeAudio())))!;
    await tester.runAsync(() => c.enableV3());
    expect(c.v3Active, true);
    engine.failStop = true;
    await showPhone(tester, c);
    await enterLab(tester);
    await tester.tap(find.text('返回普通混音'));
    await tester.pumpAndSettle();
    expect(c.v3Active, false);
    expect(c.isPlaying, false);
    engine.failStop = false;
    await tester.runAsync(() => c.enableV3());
    expect(c.v3Active, true);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });

  testWidgets('accessory playback cannot race the ordinary audio stop',
      (tester) async {
    final engine = LongmixEngine(), audio = PendingStopAudio();
    final c = (await tester.runAsync(() => setup(engine, audio)))!;
    c.accessoryStatus = AccessoryStatus.connected;
    c.shortcutMapping[AccessoryGesture.single] = ShortcutAction.playback;
    await showPhone(tester, c);
    await enterLab(tester);
    await tester.runAsync(() => c.handleGesture(AccessoryGesture.single));
    expect(audio.actions.where((a) => a.startsWith('play:')), isEmpty);
    audio.stopped.complete();
    await tester.pumpAndSettle();
    await tester.tap(find.text('返回普通混音'));
    await tester.pumpAndSettle();
    expect(c.accessoryLocked, false);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });

  testWidgets(
      'accessory playback cannot start ordinary audio underneath the lab',
      (tester) async {
    final engine = LongmixEngine(), audio = ProbeAudio();
    final c = (await tester.runAsync(() => setup(engine, audio)))!;
    c.accessoryStatus = AccessoryStatus.connected;
    c.shortcutMapping[AccessoryGesture.single] = ShortcutAction.playback;
    await showPhone(tester, c);
    await enterLab(tester);
    await tester.runAsync(() => c.handleGesture(AccessoryGesture.single));
    expect(audio.actions.where((a) => a.startsWith('play:')), isEmpty);
    expect(c.isPlaying, false);
    await tester.tap(find.text('返回普通混音'));
    await tester.pumpAndSettle();
    expect(c.accessoryLocked, false);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });

  testWidgets('repeated back waits for isolated stop before removing the page',
      (tester) async {
    final stop = Completer<void>();
    final engine = LongmixEngine()..pendingStop = stop;
    final c = (await tester.runAsync(() => setup(engine, ProbeAudio())))!;
    await showPhone(tester, c);
    await enterLab(tester);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('两来源长混试验'), findsOneWidget);
    stop.complete();
    await tester.pumpAndSettle();
    expect(find.text('两来源长混试验'), findsNothing);
    expect(engine.disposals, 1);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });

  testWidgets('return to normal reloads a source stopped on entering the lab',
      (tester) async {
    final engine = LongmixEngine(), audio = ProbeAudio();
    final c = (await tester.runAsync(() => setup(engine, audio)))!;
    await tester.runAsync(() => c.play(c.tracks.first));
    expect(audio.actions.where((a) => a.startsWith('play:')), hasLength(1));
    await c.requestDirection(targetEnergy: 5, targetStyle: 'Funk');
    expect(c.pendingIntent, isNotNull);
    await showPhone(tester, c);
    await enterLab(tester);
    expect(c.isPlaying, false);
    expect(c.pendingIntent, isNull);
    await tester.tap(find.text('返回普通混音'));
    await tester.pumpAndSettle();
    await tester.runAsync(c.togglePlayback);
    expect(audio.actions.where((a) => a.startsWith('play:')), hasLength(2));
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });

  testWidgets(
      'lab takes audio ownership and loads a variant before explicit play',
      (tester) async {
    final engine = LongmixEngine(), audio = ProbeAudio();
    final c = (await tester.runAsync(() => setup(engine, audio)))!;
    await tester.runAsync(() => c.enableV3(mode: 'metric'));
    await showPhone(tester, c);
    await enterLab(tester);
    expect(c.v3Active, false);
    expect(audio.actions.last, 'stop');
    expect(engine.requests.last['mode'], 'longmix');
    expect(engine.requests.where((r) => r['method'] == 'start'), isEmpty);
    await tester.tap(find.text('准备普通交接'));
    await tester.pumpAndSettle();
    expect(engine.requests.last,
        {'method': 'loadScene', 'sceneId': 'scene-1', 'variant': 'reference'});
    expect(engine.requests.where((r) => r['method'] == 'start'), isEmpty);
    await tester.tap(find.text('准备长混'));
    await tester.pumpAndSettle();
    expect(engine.requests.last['variant'], 'long');
    await tester.tap(find.text('播放'));
    await tester.pumpAndSettle();
    expect(engine.requests.last['method'], 'start');
    await tester.tap(find.text('暂停'));
    await tester.pumpAndSettle();
    expect(engine.requests.last['method'], 'pause');
    await tester.tap(find.text('继续'));
    await tester.pumpAndSettle();
    expect(engine.requests.last['method'], 'resume');
    await tester.tap(find.text('合适点退出'));
    await tester.pumpAndSettle();
    expect(engine.requests.last['method'], 'exit');
    await tester.tap(find.text('返回普通混音'));
    await tester.pumpAndSettle();
    expect(engine.requests.last['method'], 'stop');
    expect(engine.disposals, 1);
    expect(c.v3Active, false);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });

  testWidgets(
      'prepare failure leaves normal and installed stable fallback usable',
      (tester) async {
    final engine = LongmixEngine()..failPrepare = true;
    final c = (await tester.runAsync(() => setup(engine, ProbeAudio())))!;
    final platformCalls = <String>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(const MethodChannel('harbeat/platform'),
            (call) async {
      platformCalls.add(call.method);
      return null;
    });
    addTearDown(() => TestDefaultBinaryMessengerBinding
        .instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
            const MethodChannel('harbeat/platform'), null));
    await showPhone(tester, c);
    await enterLab(tester);
    expect(find.textContaining('准备失败'), findsOneWidget);
    await tester.tap(find.text('打开已安装稳定版'));
    await tester.pumpAndSettle();
    expect(platformCalls, ['openStableMix']);
    await tester.tap(find.text('返回普通混音'));
    await tester.pumpAndSettle();
    expect(find.text('两来源长混试听'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });

  testWidgets(
      'back during pending prepare stops and closes without late playback',
      (tester) async {
    final pending = Completer<void>();
    final engine = LongmixEngine()..pendingPrepare = pending;
    final c = (await tester.runAsync(() => setup(engine, ProbeAudio())))!;
    await showPhone(tester, c);
    await enterLab(tester);
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(engine.requests.last['method'], 'stop');
    expect(engine.disposals, 1);
    pending.complete();
    await tester.pumpAndSettle();
    expect(engine.requests.where((r) => r['method'] == 'start'), isEmpty);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });

  testWidgets(
      'failed variant preparation cannot play and longmix remains retryable',
      (tester) async {
    final engine = LongmixEngine()..failLoad = true;
    final c = (await tester.runAsync(() => setup(engine, ProbeAudio())))!;
    await showPhone(tester, c);
    await enterLab(tester);
    await tester.tap(find.text('准备长混'));
    await tester.pumpAndSettle();
    expect(engine.requests.last['variant'], 'long');
    expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, '播放'))
            .onPressed,
        isNull);
    expect(find.textContaining('素材校验失败'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
}
