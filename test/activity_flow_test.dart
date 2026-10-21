import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:harbeat/src/activity_repository.dart';
import 'package:harbeat/src/app.dart';
import 'package:harbeat/src/controller.dart';
import 'package:harbeat/src/audio_service.dart';
import 'package:harbeat/src/local_store.dart';
import 'package:harbeat/src/repository.dart';
import 'metric_player_test.dart' show MetricEngine;

ActivityReservation reservation(
        {bool multiCue = true, bool strategyApproved = true}) =>
    ActivityReservation.fromJson({
      'id': 'a' * 32,
      'packId': 'b' * 32,
      'name': '周末练习',
      'styles': ['Hip-Hop'],
      'startsAt': '2020-01-01T10:00:00Z',
      'durationMinutes': 60,
      'energy': 3,
      'trackLimit': 8,
      'pack': {
        if (multiCue) 'candidateVersion': 'activity-candidate-v2',
        if (multiCue && strategyApproved)
          'strategyVersion': 'jetson-decision-v1',
        'state': 'ready',
        'prepared': 2,
        'total': 2,
        'trackIds': ['track-a', 'track-b']
      }
    });

class FakeActivities extends ActivityRepository {
  FakeActivities() : super(credentials: MemoryActivityCredentials());
  bool fail = false;
  String? reusedId;
  @override
  Future<ActivityReservation> reuse(
      String id, DateTime time, int minutes) async {
    reusedId = id;
    return ActivityReservation.fromJson({
      ...reservation().json,
      'id': 'c' * 32,
      'startsAt': time.toUtc().toIso8601String(),
      'durationMinutes': minutes
    });
  }

  @override
  Future<List<ActivityReservation>> list() async {
    if (fail) throw const ActivityException('连接失败');
    return [reservation()];
  }

  @override
  Future<ActivityReservation> get(String id) async => reservation();
  @override
  Future<Map<String, dynamic>> manifest(String id) async => {
        'schema': 'harbeat.activity-set.v1',
        'packId': id,
        'trackIds': ['track-a', 'track-b'],
        'initialTrackId': 'track-b',
        'state': 'ready',
        'results': []
      };
}

class SwitchingActivities extends FakeActivities {
  final oldLoad = Completer<List<ActivityReservation>>();
  final oldDetail = Completer<ActivityReservation>();
  bool switched = false;
  ActivityReservation get imported => ActivityReservation.fromJson(
      {...reservation().json, 'id': 'd' * 32, 'name': '恢复的预约'});
  @override
  Future<List<ActivityReservation>> list() =>
      switched ? Future.value([imported]) : oldLoad.future;
  @override
  Future<ActivityReservation> get(String id) => oldDetail.future;
  @override
  Future<void> importBackup(String raw) async {
    switched = true;
  }
}

class LegacyActivities extends FakeActivities {
  @override
  Future<ActivityReservation> get(String id) async =>
      reservation(multiCue: false);
}

class SourceOnlyActivities extends FakeActivities {
  @override
  Future<ActivityReservation> get(String id) async =>
      reservation(strategyApproved: false);
}

class ReplacementActivities extends FakeActivities {
  ReplacementActivities({required this.replaced});
  final bool replaced;
  ActivityReservation get value => ActivityReservation.fromJson({
        ...reservation().json,
        'pack': {
          ...reservation().pack,
          'warnings': [
            'retained_track_unavailable:original-song',
            if (replaced) 'retained_track_replacement:new-song'
          ]
        }
      });
  @override
  Future<ActivityReservation> get(String id) async => value;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  for (final replaced in [true, false]) {
    testWidgets(
        'saved set replan clearly reports unavailable and replacement songs ($replaced)',
        (tester) async {
      final repo = ReplacementActivities(replaced: replaced);
      final c = AppController(MockHarBeatRepository(),
          activityRepository: repo,
          localStore: MemoryLocalStore(),
          audio: MemoryAudioService());
      addTearDown(c.dispose);
      c.activities = [repo.value];
      await tester.pumpWidget(
          MaterialApp(home: ActivityDetailScreen(c, repo.value.id)));
      expect(find.textContaining('1 首原曲暂不可用'), findsOneWidget);
      expect(find.textContaining(replaced ? '已补入 1 首替代曲' : '尚未找到替代曲'),
          findsOneWidget);
      expect(find.textContaining('retained_track_'), findsNothing);
      await tester.pumpWidget(const SizedBox());
    });
  }
  testWidgets(
      'an old ready reservation offers explicit preparation of more cues',
      (tester) async {
    final c = AppController(MockHarBeatRepository(),
        activityRepository: LegacyActivities(),
        localStore: MemoryLocalStore(),
        audio: MemoryAudioService());
    addTearDown(c.dispose);
    c.activities = [reservation(multiCue: false)];
    await tester.pumpWidget(
        MaterialApp(home: ActivityDetailScreen(c, reservation().id)));
    expect(find.textContaining('云端旧版已就绪'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('准备更多接点'), 200);
    final upgrade =
        tester.widget<TextButton>(find.widgetWithText(TextButton, '准备更多接点'));
    expect(upgrade.onPressed, isNotNull);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets(
      'downloaded set assets do not claim decoded nearby cues are ready',
      (tester) async {
    final c = AppController(MockHarBeatRepository(),
        activityRepository: FakeActivities(),
        localStore: MemoryLocalStore(),
        audio: MemoryAudioService());
    addTearDown(c.dispose);
    c.activities = [reservation()];
    c.activityCaches[reservation().packId] = {
      'state': 'ready',
      'completed': 4,
      'total': 4
    };
    await tester.pumpWidget(
        MaterialApp(home: ActivityDetailScreen(c, reservation().id)));
    expect(find.textContaining('云端已备齐'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('素材已下载 · 4 / 4 个片段'), 200);
    expect(find.text('素材已下载 · 4 / 4 个片段'), findsOneWidget);
    expect(find.textContaining('附近接点已就绪'), findsNothing);
    expect(find.textContaining('解码和变速'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('a source-only v2 set offers an explicit Jetson strategy upgrade',
      (tester) async {
    final c = AppController(MockHarBeatRepository(),
        activityRepository: SourceOnlyActivities(),
        localStore: MemoryLocalStore(),
        audio: MemoryAudioService());
    addTearDown(c.dispose);
    c.activities = [reservation(strategyApproved: false)];
    await tester.pumpWidget(
        MaterialApp(home: ActivityDetailScreen(c, reservation().id)));
    expect(find.textContaining('待准备 Jetson 编排'), findsOneWidget);
    expect(find.textContaining('云端已备齐'), findsNothing);
    await tester.scrollUntilVisible(find.text('准备 Jetson 混音编排'), 200);
    expect(
        tester
            .widget<TextButton>(
                find.widgetWithText(TextButton, '准备 Jetson 混音编排'))
            .onPressed,
        isNotNull);
    await tester.pumpWidget(const SizedBox());
  });
  test(
      'reservation playback binds its prepared set before starting the selected first song',
      () async {
    final repo = FakeActivities(), engine = MetricEngine();
    final c = AppController(MockHarBeatRepository(),
        activityRepository: repo,
        localStore: MemoryLocalStore(),
        audio: MemoryAudioService(),
        realtimeEngine: engine);
    addTearDown(c.dispose);
    await c.initialize();
    expect(await c.openActivity(reservation()), true);
    expect(engine.calls.indexOf('setSession'),
        lessThan(engine.calls.indexOf('start')));
    expect(engine.arguments.lastWhere((e) => e['method'] == 'start')['trackId'],
        'track-b');
    expect(c.activeActivityName, '周末练习');
    expect(c.tab, 0);
    await c.exitActivity();
    expect(engine.calls.last, 'clearSet');
    expect(c.activeActivityName, isNull);
  });
  test(
      'list errors retain ended reservations and saved summaries contain no credential',
      () async {
    final repo = FakeActivities(), store = MemoryLocalStore();
    final c = AppController(MockHarBeatRepository(),
        activityRepository: repo,
        localStore: store,
        audio: MemoryAudioService());
    addTearDown(c.dispose);
    await c.initialize();
    await c.loadActivities();
    expect(c.activities.single.ended, true);
    repo.fail = true;
    await c.loadActivities();
    expect(c.activities.single.name, '周末练习');
    expect(c.activityError, isNotNull);
    final saved = await store.read();
    expect(saved['activities'], isNotEmpty);
    expect(saved.toString(), isNot(contains('Bearer')));
  });
  test('rebooking retains original prepared pack and old reservation',
      () async {
    final repo = FakeActivities();
    final c = AppController(MockHarBeatRepository(),
        activityRepository: repo,
        localStore: MemoryLocalStore(),
        audio: MemoryAudioService());
    addTearDown(c.dispose);
    await c.initialize();
    await c.loadActivities();
    final old = c.activities.single;
    final result = await c.saveActivity(
        name: old.name,
        styles: old.styles,
        startsAt: DateTime.now().add(const Duration(days: 1)),
        durationMinutes: 90,
        energy: old.energy,
        trackLimit: old.trackLimit,
        reuse: old);
    expect(repo.reusedId, old.id);
    expect(result!.packId, old.packId);
    expect(c.activities.map((a) => a.id), containsAll([old.id, result.id]));
  });
  testWidgets('reservation form fits phone width and validates its name',
      (tester) async {
    tester.view.physicalSize = const Size(360, 820);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final c = AppController(MockHarBeatRepository(),
        activityRepository: FakeActivities(),
        localStore: MemoryLocalStore(),
        audio: MemoryAudioService());
    addTearDown(c.dispose);
    await tester.pumpWidget(MaterialApp(
        builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: const TextScaler.linear(1.5)),
            child: child!),
        home: ActivityFormScreen(c)));
    await tester.scrollUntilVisible(find.text('预约并开始准备'), 300,
        scrollable: find.byType(Scrollable).first);
    await tester.ensureVisible(find.text('预约并开始准备'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('预约并开始准备'));
    await tester.pump();
    expect(find.text('写一个预约名称'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
  test(
      'backup import replaces workspace while old list and detail responses are ignored',
      () async {
    final repo = SwitchingActivities(), store = MemoryLocalStore();
    final c = AppController(MockHarBeatRepository(),
        activityRepository: repo,
        localStore: store,
        audio: MemoryAudioService());
    addTearDown(c.dispose);
    await c.initialize();
    final oldLoad = c.loadActivities();
    final oldDetail = c.refreshActivity(reservation().id);
    expect(c.activitiesLoading, true);
    await c.restoreActivityBackup('private backup');
    expect(c.activities.single.name, '恢复的预约');
    expect(c.activitiesLoading, false);
    repo.oldLoad.complete([reservation()]);
    repo.oldDetail.complete(reservation());
    await Future.wait([oldLoad, oldDetail]);
    expect(c.activities.single.name, '恢复的预约');
    expect((await store.read())['activities'], [repo.imported.json]);
  });
  testWidgets('My reservations keeps completed set visible and offers reuse',
      (tester) async {
    final c = AppController(MockHarBeatRepository(),
        activityRepository: FakeActivities(),
        localStore: MemoryLocalStore(),
        audio: MemoryAudioService());
    addTearDown(c.dispose);
    await tester.runAsync(() async {
      await c.initialize();
      await c.loadActivities();
    });
    await tester.pumpWidget(MaterialApp(home: ActivityListScreen(c)));
    await tester.pump();
    expect(find.text('周末练习'), findsOneWidget);
    expect(find.textContaining('已结束'), findsOneWidget);
    await tester.tap(find.text('周末练习'));
    await tester.pumpAndSettle();
    expect(find.text('进入播放'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('再次预约这个 set'), 250);
    expect(find.text('再次预约这个 set'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
  });
}
