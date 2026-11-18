import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/app.dart';
import 'package:harbeat/src/controller.dart';
import 'package:harbeat/src/theme.dart';
import 'package:harbeat/src/models.dart';
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
    if (method == 'direction') {
      state['metric'] = {
        ...state['metric'] as Map,
        if (args['energy'] != null) 'energyLevel': args['energy'],
        if (args['style'] != null) 'targetStyle': args['style'],
        if (args['automatic'] != null) 'automatic': args['automatic'],
      };
    }
    return super.command(method, args);
  }
}

Future<void> openMixDiagnostics(WidgetTester tester) async {
  for (final label in ['更多播放工具', '混音诊断']) {
    final tile = find.text(label);
    await tester.scrollUntilVisible(tile, 250);
    await tester.tap(tile);
    await tester.pumpAndSettle();
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
  TestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('decks stay on their sides across A to B to A', (tester) async {
    tester.view.physicalSize = const Size(393, 873);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final engine = MetricEngine();
    late AppController c;
    await tester.runAsync(() async {
      c = await setup(engine, ProbeAudio());
    });
    final a = engine.catalog[0], b = engine.catalog[1];
    final firstCover = '/analysis-lab-static/mobile-artwork-v1/${'a' * 64}.jpg';
    final secondCover = '/analysis-lab-static/mobile-artwork-v1/${'b' * 64}.jpg';
    a['coverPath'] = firstCover;
    b['coverPath'] = secondCover;
    const third = {'id': 'track-c', 'title': 'Third'};
    final left = find.byKey(const ValueKey('mix-deck-A'));
    final right = find.byKey(const ValueKey('mix-deck-B'));
    Finder on(Finder deck, String title) =>
        find.descendant(of: deck, matching: find.text(title));
    PlaybackTurntable disc(Finder deck) => tester.widget(find.descendant(
        of: deck, matching: find.byType(PlaybackTurntable)));
    Finder record(Finder deck) => find.descendant(
        of: deck, matching: find.byType(PlaybackTurntable));
    void send(Map<String, dynamic> current, Map<String, dynamic>? incoming,
        {bool playing = true, bool overlap = false,
        double position = 0, double incomingPosition = 0}) {
      engine.emit({
        'current': current,
        'position': position,
        'playing': playing,
        'decks': {
          'primaryPlaying': playing,
          'incoming': incoming == null
              ? null
              : {'track': incoming, 'playing': playing && overlap,
                  'position': incomingPosition},
        },
      });
    }

    c.nowPlaying = const Track(
        id: 'nas:track-a', title: 'Big Girls', artist: '', style: 'Trap',
        bpm: 142.9, energy: null, reason: '', color: HB.ink);
    c.isPlaying = true;
    Widget player() => MaterialApp(
        theme: HB.theme,
        home: AnimatedBuilder(
            animation: c, builder: (_, __) => Shell(controller: c)));
    await tester.pumpWidget(player());
    await tester.pumpWidget(player());
    await tester.runAsync(() async {
      await c.enableV3(mode: 'metric');
      await c.togglePlayback();
    });
    send(a, b);
    await tester.pump();
    expect(on(left, 'Big Girls'), findsOneWidget);
    expect(on(right, 'Cold'), findsOneWidget);
    expect(disc(left).playing, isTrue);
    expect(disc(right).playing, isFalse);
    expect(find.text('播放中'), findsNothing);
    expect(find.text('待播'), findsNothing);
    expect(find.byKey(const ValueKey('playback-tonearm')), findsNWidgets(2));
    expect(disc(left).coverUrl, endsWith(firstCover));
    expect(disc(right).coverUrl, endsWith(secondCover));
    final leftWindow = tester.getRect(find.byKey(const ValueKey('mix-deck-window-A')));
    final rightWindow = tester.getRect(find.byKey(const ValueKey('mix-deck-window-B')));
    expect(tester.getRect(record(left)).center.dx, closeTo(leftWindow.left, .5));
    expect(tester.getRect(record(right)).center.dx, closeTo(rightWindow.right, .5));
    expect(find.text('网页同款 · 手机混音'), findsNothing);

    send(a, b, overlap: true, position: 67.5, incomingPosition: 45);
    await tester.pump();
    expect(disc(left).playing, isTrue);
    expect(disc(right).playing, isTrue);
    expect(disc(left).progress, .5);
    expect(disc(right).progress, .3);
    send(a, b, overlap: true, playing: false);
    await tester.pump();
    expect(disc(left).playing, isFalse);
    expect(disc(right).playing, isFalse);

    send(b, third);
    await tester.pump();
    expect(on(left, 'Third'), findsOneWidget);
    expect(on(right, 'Cold'), findsOneWidget);
    expect(disc(left).playing, isFalse);
    expect(disc(right).playing, isTrue);
    expect(disc(right).coverUrl, endsWith(secondCover));

    send(third, a);
    await tester.pump();
    expect(on(left, 'Third'), findsOneWidget);
    expect(on(right, 'Big Girls'), findsOneWidget);
    expect(disc(left).playing, isTrue);
    expect(disc(right).playing, isFalse);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
  testWidgets(
      'nearby cue readiness follows current playback rather than cloud preparation',
      (tester) async {
    final engine = MetricEngine();
    late AppController c;
    await tester.runAsync(() async {
      c = await setup(engine, ProbeAudio());
      await c.enableV3(mode: 'metric');
      await c.togglePlayback();
    });
    c.v3State['metric'] = {
      ...c.metricState,
      'warm': {
        'sourcePosition': 10,
        'limit': 3,
        'preparing': 1,
        'ready': [
          {'from': c.v3State['current']['id'], 'start': 20},
          {'from': c.v3State['current']['id'], 'start': 5},
        ]
      }
    };
    await tester.pumpWidget(
        MaterialApp(theme: HB.theme, home: Scaffold(body: PhoneMixScreen(c))));
    await openMixDiagnostics(tester);
    await tester.scrollUntilVisible(find.text('附近接点已就绪 1 个'), 300);
    expect(find.text('附近接点已就绪 1 个'), findsOneWidget);
    expect(find.textContaining('点击切歌后，会按附近'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
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
  testWidgets(
      'Next directly requests a handoff while the left indicator stays automatic',
      (tester) async {
    tester.view.physicalSize = const Size(390, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final engine = MetricEngine();
    late AppController c;
    await tester.runAsync(() async {
      c = await setup(engine, ProbeAudio());
      await c.enableV3(mode: 'metric');
      await c.togglePlayback();
      await c.metricSelectNext('track-b');
      await c.setSmartDirection(automatic: false);
    });
    await tester.pumpWidget(MaterialApp(
        theme: HB.theme,
        home: AnimatedBuilder(
            animation: c, builder: (_, __) => Shell(controller: c))));
    expect(find.text('最近接点切歌'), findsNothing);
    await tester.tap(find.text('下一首'));
    await tester.pumpAndSettle();
    expect(engine.calls.last, 'recommend');
    expect(c.smartAutomatic, false);
    expect(engine.calls.where((m) => m == 'start'), hasLength(1));
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
  testWidgets('the main playback slider seeks once when a drag ends',
      (tester) async {
    tester.view.physicalSize = const Size(390, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final engine = MetricEngine();
    late AppController c;
    await tester.runAsync(() async {
      c = await setup(engine, ProbeAudio());
      await c.enableV3(mode: 'metric');
      await c.togglePlayback();
      engine.emit({'duration': 135, 'position': 22});
    });
    await tester.pumpWidget(MaterialApp(
        theme: HB.theme,
        home: AnimatedBuilder(
            animation: c, builder: (_, __) => Shell(controller: c))));
    final slider = find.byKey(const Key('playback-position'));
    expect(slider, findsOneWidget);
    final gesture = await tester.startGesture(tester.getCenter(slider));
    await gesture.moveBy(const Offset(35, 0));
    await tester.pump();
    await gesture.moveBy(const Offset(20, 0));
    await tester.pump();
    expect(engine.calls.where((method) => method == 'seek'), isEmpty);
    await gesture.up();
    await tester.pump();
    final seeks = engine.arguments.where((args) => args['method'] == 'seek');
    expect(seeks, hasLength(1));
    expect(seeks.single['position'], greaterThan(65));

    engine.emit({
      'pending': {'title': 'Cold', 'locked': true}
    });
    await tester.pump();
    expect(tester.widget<Slider>(slider).onChanged, isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
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
      await tester.scrollUntilVisible(find.text('接下来听'), 250);
      expect(find.text('自动接歌'), findsWidgets);
      expect(find.text('标准播放'), findsNothing);
      expect(find.text('V3 实时混音'), findsNothing);
      expect(find.text('降低能量 ↓'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      c.dispose();
    });
  }
  test(
      'selecting a published song starts the unified engine without a mode switch',
      () async {
    final engine = MetricEngine(), audio = ProbeAudio();
    final c = await setup(engine, audio);
    addTearDown(c.dispose);
    const song = Track(
        id: 'nas:track-a',
        title: 'Big Girls',
        artist: 'NAS',
        style: 'Trap',
        bpm: 142.9,
        energy: null,
        reason: 'NAS',
        color: Colors.teal);
    await c.play(song);
    expect(c.v3Metric, true);
    expect(c.isPlaying, true);
    expect(c.nowPlaying?.id, song.id);
    expect(engine.calls.where((m) => m == 'start'), hasLength(1));
    expect(audio.actions.where((m) => m.startsWith('play:')), isEmpty);
    await c.setSmartDirection(level: 5, style: 'Grime');
    expect(engine.arguments.lastWhere((a) => a['method'] == 'direction'), {
      'method': 'direction',
      'style': 'Grime',
      'energy': 5,
      'automatic': true
    });
    expect(engine.arguments.lastWhere((a) => a['method'] == 'autoPreparation'),
        {'method': 'autoPreparation', 'pending': true});
    expect(engine.calls.where((m) => m == 'start'), hasLength(1));
    await c.setSmartDirection(automatic: false);
    expect(c.smartAutomatic, false);
    expect(engine.calls.last, 'direction');
    expect(c.isPlaying, true);
    await c.togglePlayback();
    await c.play(c.v3Tracks.last);
    expect(c.nowPlaying?.id, 'nas:track-b');
    expect(c.isPlaying, true);
    expect(engine.calls.where((m) => m == 'start'), hasLength(2));
  });
  test(
      'a removed saved style disables auto instead of silently broadening selection',
      () async {
    final engine = MetricEngine(), c = await setup(engine, ProbeAudio());
    addTearDown(c.dispose);
    c.smartStyle = 'removed-style';
    await c.prepareSmartPlayer();
    expect(c.smartAutomatic, false);
    expect(
        engine.arguments
            .where((a) => a['method'] == 'direction')
            .single['automatic'],
        false);
    expect(c.v3Error, contains('重新选择'));
  });
  testWidgets(
      'shows live six-method analysis without a legacy rendered result',
      (tester) async {
    tester.view.physicalSize = const Size(390, 2000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final engine = MetricEngine();
    late AppController c;
    await tester.runAsync(() async {
      c = await setup(engine, ProbeAudio());
      await c.enableV3(mode: 'metric');
      engine.emit({'metric': {
        'selected': 'track-b', 'method': 'filter',
        'strategyComparison': {
          'state': 'ready', 'recommended': 'filter', 'reason': '旋律重叠较强，选择末小节滤波',
          'methods': {
            'original': {'name': '原渐混', 'eligible': true, 'score': 50, 'reason': '参照方案'},
            'filter': {'name': '旋律滤波', 'eligible': true, 'score': 63, 'reason': '旋律重叠达到门槛'},
            'vocal': {'name': '人声唱完再退出', 'eligible': false, 'score': null, 'reason': '缺少安全人声空隙'}
          }
        }
      }});
      await Future<void>.delayed(Duration.zero);
    });
    await tester.pumpWidget(MaterialApp(theme: HB.theme, home: AnimatedBuilder(
      animation: c, builder: (_, __) => Shell(controller: c))));
    await openMixDiagnostics(tester);
    await tester.scrollUntilVisible(find.text('接歌方案比较'), 250);
    expect(find.text('交接方式 · 旋律滤波'), findsOneWidget);
    await tester.tap(find.text('接歌方案比较'));
    await tester.pumpAndSettle();
    expect(find.textContaining('63.0'), findsOneWidget);
    expect(find.textContaining('缺少安全人声空隙'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
  testWidgets('publication coverage and evaluating method are distinct from an executed fallback', (tester) async {
    tester.view.physicalSize = const Size(390, 2000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    late AppController c;
    final engine = MetricEngine();
    await tester.runAsync(() async {
      c = await setup(engine, ProbeAudio());
      await c.enableV3(mode: 'metric');
      engine.emit({'metric': {
        'catalog': {'playable': 160, 'mixable': 150, 'stemPublished': 28},
        'selected': 'track-b', 'method': 'original', 'methodStatus': 'evaluating',
        'strategyComparison': {'state': 'preparing', 'methods': {
          'original': {'name': '原渐混后备', 'eligible': false}
        }}
      }});
    });
    await tester.pumpWidget(MaterialApp(theme: HB.theme, home: AnimatedBuilder(
        animation: c, builder: (_, __) => Shell(controller: c))));
    expect(find.textContaining('28 首分轨音频已发布'), findsNothing);
    await openMixDiagnostics(tester);
    await tester.scrollUntilVisible(find.text('正在评估混音手法'), 250);
    expect(find.textContaining('150 首基础混音可用'), findsOneWidget);
    expect(find.textContaining('28 首分轨音频已发布'), findsOneWidget);
    expect(find.text('交接方式 · 原渐混后备'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
  testWidgets(
      'recommendation shows the selected handoff method and history recovery',
      (tester) async {
    tester.view.physicalSize = const Size(390, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final engine = MetricEngine();
    late AppController c;
    await tester.runAsync(() async {
      c = await setup(engine, ProbeAudio());
      await c.enableV3(mode: 'metric');
      engine.emit({
        'metric': {
          'working': false,
          'selected': 'track-b',
          'method': 'filter',
          'selection': {'checked': 9, 'qualified': 1, 'usedRecent': true},
          'result': {
            'decision': {
              'recommended': 'bass',
              'explanation': '原先推荐贝斯',
              'methods': {
                'bass': {'name': '独立贝斯交接'},
                'filter': {'name': '旋律滤波', 'reason': '实际选择旋律滤波'}
              }
            }
          }
        }
      });
      await Future<void>.delayed(Duration.zero);
    });
    await tester.pumpWidget(MaterialApp(
        theme: HB.theme,
        home: AnimatedBuilder(
            animation: c, builder: (_, __) => Shell(controller: c))));
    await openMixDiagnostics(tester);
    await tester.scrollUntilVisible(find.text('交接方式 · 旋律滤波'), 250);
    expect(find.text('交接方式 · 旋律滤波'), findsOneWidget);
    expect(find.text('实际选择旋律滤波'), findsOneWidget);
    expect(find.textContaining('回查已播歌曲'), findsOneWidget);
    expect(find.text('交接方式 · 独立贝斯交接'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
}
