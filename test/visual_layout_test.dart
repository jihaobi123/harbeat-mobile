import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/app.dart';
import 'package:harbeat/src/audio_service.dart';
import 'package:harbeat/src/controller.dart';
import 'package:harbeat/src/local_store.dart';
import 'package:harbeat/src/models.dart';
import 'package:harbeat/src/repository.dart';
import 'package:harbeat/src/theme.dart';
import 'continuous_player_test.dart' show ContinuousEngine;
import 'realtime_player_test.dart' show setup, ProbeAudio;

void main() {
  testWidgets(
      'unloaded playlist entries keep their IDs and visible reorder works',
      (tester) async {
    final c = AppController(MockHarBeatRepository(),
        localStore: MemoryLocalStore(), audio: MemoryAudioService());
    await tester.runAsync(c.initialize);
    c.playlists = [
      const Playlist(
          id: 'partial',
          name: '部分可用',
          trackIds: ['missing', 'electric', 'lock'])
    ];
    c.setMusicSection(3);
    await tester.pumpWidget(MaterialApp(theme: HB.theme, home: MusicScreen(c)));
    await tester.pumpAndSettle();
    expect(find.text('2 / 3 首可用'), findsOneWidget);
    await tester.pumpWidget(MaterialApp(
        theme: HB.theme, home: PlaylistDetail(c: c, playlistIndex: 0)));
    await tester.pumpAndSettle();
    tester
        .widget<ReorderableListView>(find.byType(ReorderableListView))
        .onReorder(0, 2);
    expect(c.playlists.single.trackIds, ['missing', 'lock', 'electric']);
    c.tracks = [];
    await tester.pumpWidget(MaterialApp(
        theme: HB.theme,
        home: PlaylistDetail(
            key: const ValueKey('empty'), c: c, playlistIndex: 0)));
    await tester.pumpAndSettle();
    expect(find.text('歌曲暂不可用'), findsOneWidget);
    expect(find.text('空歌单'), findsNothing);
    expect(c.playlists.single.trackIds, hasLength(3));
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
  for (final width in [360.0, 390.0, 430.0]) {
    for (final scale in [1.0, 1.5]) {
      testWidgets('main pages fit ${width.toInt()}px at text scale $scale',
          (tester) async {
        tester.view.physicalSize = Size(width, 900);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final c = AppController(MockHarBeatRepository(),
            localStore: MemoryLocalStore(), audio: MemoryAudioService());
        await tester.runAsync(c.initialize);
        await tester.pumpWidget(MaterialApp(
            theme: HB.theme,
            builder: (_, child) => MediaQuery(
                data: MediaQueryData(
                    size: Size(width, 900),
                    textScaler: TextScaler.linear(scale)),
                child: child!),
            home: AnimatedBuilder(
                animation: c, builder: (_, __) => Shell(controller: c))));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        for (final tab in [0, 1, 2]) {
          c.setTab(tab);
          await tester.pumpAndSettle();
          for (var i = 0; i < 5; i++) {
            await tester.drag(
                find.byType(ListView).last, const Offset(0, -450));
            await tester.pumpAndSettle();
            expect(tester.takeException(), isNull,
                reason: 'tab $tab scroll $i');
          }
        }
        c.setMusicSection(3);
        c.setTab(1);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        c.dispose();
      });
    }
  }
  testWidgets('continuous mixing controls fit large text at 360px',
      (tester) async {
    tester.view.physicalSize = const Size(360, 900);
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
        builder: (_, child) => MediaQuery(
            data: const MediaQueryData(
                size: Size(360, 900), textScaler: TextScaler.linear(1.5)),
            child: child!),
        home: AnimatedBuilder(
            animation: c, builder: (_, __) => Shell(controller: c))));
    for (var i = 0; i < 8; i++) {
      await tester.drag(find.byType(ListView).last, const Offset(0, -400));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'continuous scroll $i');
    }
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
}
