import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/app.dart';
import 'package:harbeat/src/audio_service.dart';
import 'package:harbeat/src/controller.dart';
import 'package:harbeat/src/local_store.dart';
import 'package:harbeat/src/models.dart';
import 'package:harbeat/src/repository.dart';
import 'package:harbeat/src/theme.dart';

Future<AppController> fixture(WidgetTester tester) async {
  final c = AppController(MockHarBeatRepository(),
      localStore: MemoryLocalStore(), audio: MemoryAudioService());
  await tester.runAsync(c.initialize);
  c.playlists = [
    const Playlist(
        id: 'vinyl', name: '黑胶练习歌单', trackIds: ['electric', 'lock', 'sidewalk'])
  ];
  return c;
}

void main() {
  for (final width in [360.0, 390.0, 430.0]) {
    for (final scale in [1.0, 1.5]) {
      testWidgets('vinyl playlist fits $width at $scale text scale',
          (tester) async {
        tester.view.physicalSize = Size(width, 800);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final c = await fixture(tester);
        await tester.pumpWidget(MaterialApp(
            theme: HB.theme,
            builder: (_, child) => MediaQuery(
                data: MediaQueryData(
                    size: Size(width, 800),
                    textScaler: TextScaler.linear(scale)),
                child: child!),
            home: PlaylistDetail(c: c, playlistIndex: 0)));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await tester.drag(find.byKey(const ValueKey('record-track-list')),
            const Offset(0, -400));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        c.dispose();
      });
    }
  }
  testWidgets(
      'record rotation follows play and pause; management retains ordering',
      (tester) async {
    final c = await fixture(tester);
    await tester.pumpWidget(MaterialApp(
        theme: HB.theme, home: PlaylistDetail(c: c, playlistIndex: 0)));
    await tester.pumpAndSettle();
    final first = c.tracks.firstWhere((t) => t.id == 'electric');
    await tester.tap(find.byTooltip('播放 · ${first.title}'));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump(const Duration(milliseconds: 300));
    expect(c.isPlaying, isTrue);
    expect(c.queue, ['electric', 'lock', 'sidewalk']);
    Animation<double> rotation() => tester
        .widget<RotationTransition>(
            find.byKey(const ValueKey('vinyl-rotation')))
        .turns;
    final angle = rotation().value;
    await tester.pump(const Duration(milliseconds: 500));
    expect(rotation().value, isNot(angle));
    await tester.tap(find.byTooltip('暂停 · ${first.title}'));
    await tester.pumpAndSettle();
    expect(c.isPlaying, isFalse);
    final pausedAngle = rotation().value;
    await tester.pump(const Duration(seconds: 1));
    expect(rotation().value, pausedAngle);
    await tester.tap(find.byTooltip('管理歌单'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('${first.title} 的更多操作'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('下移'));
    await tester.pumpAndSettle();
    expect(c.playlists.single.trackIds, ['lock', 'electric', 'sidewalk']);
    await tester.tap(find.byTooltip('${first.title} 的更多操作'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('从歌单移除'));
    await tester.pumpAndSettle();
    expect(c.playlists.single.trackIds, ['lock', 'sidewalk']);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
  testWidgets('reduced motion opens immediately and keeps the record still',
      (tester) async {
    final c = await fixture(tester);
    await tester.pumpWidget(MaterialApp(
        theme: HB.theme,
        builder: (_, child) => MediaQuery(
            data: const MediaQueryData(disableAnimations: true), child: child!),
        home: PlaylistDetail(c: c, playlistIndex: 0)));
    await tester.pumpAndSettle();
    await tester.tap(find.text('播放唱片'));
    await tester.pumpAndSettle();
    expect(c.isPlaying, isTrue);
    final rotation = tester
        .widget<RotationTransition>(
            find.byKey(const ValueKey('vinyl-rotation')))
        .turns;
    expect(rotation.value, 0);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
  testWidgets(
      'a saved record opens its selected song and closes without navigation loss',
      (tester) async {
    final c = await fixture(tester);
    c.library
      ..clear()
      ..addAll(['electric', 'lock']);
    c.setTab(1);
    c.setMusicSection(2);
    final chosen = c.tracks.firstWhere((t) => t.id == 'lock');
    await tester.pumpWidget(MaterialApp(
        theme: HB.theme,
        home: AnimatedBuilder(
            animation: c, builder: (_, __) => Shell(controller: c))));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text(chosen.title));
    await tester.pumpAndSettle();
    await tester.tap(find.text(chosen.title));
    await tester.pumpAndSettle();
    expect(find.text('我的收藏'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('播放唱片'));
    await tester.pump(const Duration(milliseconds: 400));
    expect(c.nowPlaying?.id, chosen.id);
    await tester.tap(find.byTooltip('收起唱片'));
    await tester.pumpAndSettle();
    expect(find.text('我的唱片架'), findsOneWidget);
    expect(c.musicSection, 2);
    expect(c.isPlaying, isTrue);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
}
