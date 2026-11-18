import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/app.dart';
import 'package:harbeat/src/audio_service.dart';
import 'package:harbeat/src/controller.dart';
import 'package:harbeat/src/local_store.dart';
import 'package:harbeat/src/models.dart';
import 'package:harbeat/src/repository.dart';
import 'package:harbeat/src/theme.dart';

void main() {
  for (final scale in [1.0, 1.5]) {
    testWidgets(
        'vinyl playback keeps controls reachable with long names at $scale',
        (t) async {
      t.view.physicalSize = const Size(393, 873);
      t.view.devicePixelRatio = 1;
      addTearDown(t.view.resetPhysicalSize);
      addTearDown(t.view.resetDevicePixelRatio);
      final c = AppController(MockHarBeatRepository(),
          localStore: MemoryLocalStore(), audio: MemoryAudioService());
      await t.runAsync(c.initialize);
      final track = Track(
          id: 'long',
          title: scale == 1
              ? 'ORIENTRACK 06'
              : '一首名字很长的街舞音乐 Extended Battle Remix Version',
          artist: 'DJ Artist & Guest — Live Session',
          style: 'Hip-Hop',
          bpm: 106,
          energy: 3,
          reason: '',
          color: HB.accent);
      c.tracks = [track];
      c.nowPlaying = track;
      await t.pumpWidget(MaterialApp(
          theme: HB.theme,
          builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                  disableAnimations: true,
                  textScaler: TextScaler.linear(scale)),
              child: child!),
          home: Shell(controller: c)));
      await t.pumpAndSettle();
      expect(find.text('已暂停'), findsOneWidget);
      expect(
          t.getRect(find.byKey(const ValueKey('mix-deck-window-A'))).left, 0);
      expect(t.getRect(find.byKey(const ValueKey('mix-deck-window-B'))).right,
          393);
      final visibleVinyl = t
          .widgetList<PlaybackTurntable>(find.byType(PlaybackTurntable))
          .fold(0.0, (sum, disc) => sum + disc.size / 2);
      expect(393 - visibleVinyl, lessThan(393 * .30));
      final control = find.byType(PlaybackButton);
      if (scale == 1) {
        expect(t.getRect(control).bottom,
            lessThan(t.getRect(find.byType(NavigationBar)).top),
            reason: 'The primary control must fit the first MIX 4 viewport.');
      }
      await Scrollable.ensureVisible(t.element(control), alignment: .5);
      await t.pumpAndSettle();
      expect(control.hitTestable(), findsOneWidget);
      expect(t.getSize(control).shortestSide, greaterThanOrEqualTo(48));
      expect(t.takeException(), isNull);
      await t.pumpWidget(const SizedBox());
      c.dispose();
    });
  }
  testWidgets('missing or failed artwork keeps record size stable', (t) async {
    Widget scene(String? url) => MaterialApp(
        home: Scaffold(body: PlaybackTurntable(playing: false, coverUrl: url)));
    await t.pumpWidget(scene(null));
    final size = t.getSize(find.byType(PlaybackTurntable));
    await t.pumpWidget(scene('https://example.test/missing.jpg'));
    await t.pumpAndSettle();
    expect(t.getSize(find.byType(PlaybackTurntable)), size);
    expect(t.takeException(), isNull);
    await t.pumpWidget(const SizedBox());
  });
}
