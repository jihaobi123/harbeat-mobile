import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/app.dart';

void main() {
  Widget scene(
          {bool playing = true,
          bool reduced = false,
          bool visible = true,
          double progress = 0}) =>
      MaterialApp(
          home: MediaQuery(
              data: MediaQueryData(disableAnimations: reduced),
              child: Scaffold(
                  body: TickerMode(
                      enabled: visible,
                      child: PlaybackTurntable(
                          playing: playing, size: 240, progress: progress)))));
  double rotation(WidgetTester t) => t
      .widget<RotationTransition>(
          find.byKey(const ValueKey('vinyl-rotation'), skipOffstage: false))
      .turns
      .value;
  double arm(WidgetTester t) => t
      .widget<AnimatedRotation>(find.byKey(const ValueKey('playback-tonearm')))
      .turns;
  double renderedArm(WidgetTester t) => t
      .widget<RotationTransition>(find.descendant(
          of: find.byKey(const ValueKey('playback-tonearm')),
          matching: find.byType(RotationTransition)))
      .turns
      .value;

  testWidgets('tonearm moves inward with progress and follows a backward seek',
      (t) async {
    await t.pumpWidget(scene());
    final beginning = renderedArm(t);
    await t.pumpWidget(scene(progress: .6));
    final later = arm(t);
    expect(later, greaterThan(beginning));
    expect(renderedArm(t), beginning);
    await t.pump(const Duration(milliseconds: 180));
    expect(renderedArm(t), allOf(greaterThan(beginning), lessThan(later)));
    await t.pump(const Duration(milliseconds: 220));
    expect(renderedArm(t), closeTo(later, .000001));
    await t.pumpWidget(scene(progress: .1));
    await t.pump(const Duration(milliseconds: 400));
    expect(renderedArm(t), allOf(greaterThan(beginning), lessThan(later)));
    await t.pumpWidget(const SizedBox());
  });

  testWidgets(
      'record holds phase on pause and resumes; tonearm follows playback',
      (t) async {
    await t.pumpWidget(scene(playing: false));
    final parked = arm(t);
    await t.pumpWidget(scene());
    expect(arm(t), isNot(parked));
    await t.pump(const Duration(milliseconds: 500));
    final spinning = rotation(t);
    await t.pump(const Duration(seconds: 1));
    expect(rotation(t), isNot(spinning));
    await t.pumpWidget(scene(playing: false));
    final paused = rotation(t);
    expect(arm(t), parked);
    await t.pump(const Duration(seconds: 1));
    expect(rotation(t), paused);
    await t.pumpWidget(scene());
    expect(rotation(t), paused);
    await t.pump(const Duration(milliseconds: 500));
    expect(rotation(t), isNot(paused));
    await t.pumpWidget(const SizedBox());
  });
  testWidgets('hidden, background and reduced-motion records do not spin',
      (t) async {
    await t.pumpWidget(scene());
    await t.pump(const Duration(seconds: 1));
    await t.pumpWidget(scene(visible: false));
    final hidden = rotation(t);
    await t.pump(const Duration(seconds: 2));
    expect(rotation(t), hidden);
    await t.pumpWidget(scene());
    t.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await t.pump();
    final background = rotation(t);
    await t.pump(const Duration(seconds: 2));
    expect(rotation(t), background);
    t.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await t.pump();
    await t.pump(const Duration(seconds: 1));
    expect(rotation(t), isNot(background));
    await t.pumpWidget(scene(reduced: true));
    final reduced = rotation(t);
    await t.pump(const Duration(seconds: 2));
    expect(rotation(t), reduced);
    expect(
        t
            .widget<AnimatedRotation>(
                find.byKey(const ValueKey('playback-tonearm')))
            .duration,
        Duration.zero);
    await t.pumpWidget(const SizedBox());
  });
  testWidgets('record pauses while scrolled out of view and on a covered route',
      (t) async {
    final scroll = ScrollController();
    await t.pumpWidget(MaterialApp(
        home: Scaffold(
            body: ListView(controller: scroll, children: const [
      PlaybackTurntable(playing: true, size: 240),
      SizedBox(height: 1800),
    ]))));
    await t.pump(const Duration(seconds: 1));
    scroll.jumpTo(500);
    await t.pump();
    await t.pump();
    final hidden = rotation(t);
    await t.pump(const Duration(seconds: 2));
    expect(rotation(t), hidden);
    scroll.jumpTo(0);
    await t.pump();
    await t.pump();
    await t.pump(const Duration(seconds: 1));
    expect(rotation(t), isNot(hidden));
    final context = t.element(find.byType(PlaybackTurntable));
    Navigator.of(context).push(MaterialPageRoute<void>(
        builder: (_) => const Scaffold(body: Text('queue'))));
    await t.pump();
    await t.pump(const Duration(milliseconds: 400));
    final covered = rotation(t);
    await t.pump(const Duration(seconds: 2));
    expect(rotation(t), covered);
    await t.pumpWidget(const SizedBox());
    scroll.dispose();
  });
  testWidgets('tonearm reverses smoothly on rapid play/pause', (t) async {
    double pose() => t
        .widget<RotationTransition>(find.descendant(
            of: find.byKey(const ValueKey('playback-tonearm')),
            matching: find.byType(RotationTransition)))
        .turns
        .value;
    await t.pumpWidget(scene(playing: false));
    final parked = pose();
    await t.pumpWidget(scene());
    await t.pump(const Duration(milliseconds: 120));
    final entering = pose();
    expect(entering, greaterThan(parked));
    expect(entering, lessThan(0));
    await t.pumpWidget(scene(playing: false));
    expect(pose(), closeTo(entering, .000001));
    await t.pump(const Duration(milliseconds: 300));
    expect(pose(), closeTo(parked, .000001));
    await t.pumpWidget(const SizedBox());
  });
  for (final suppress in ['reduced', 'hidden', 'background']) {
    testWidgets('in-flight tonearm snaps when $suppress suppresses motion',
        (t) async {
      double pose() => t
          .widget<RotationTransition>(find.descendant(
              of: find.byKey(const ValueKey('playback-tonearm')),
              matching: find.byType(RotationTransition)))
          .turns
          .value;
      await t.pumpWidget(scene(playing: false));
      await t.pumpWidget(scene());
      await t.pump(const Duration(milliseconds: 100));
      expect(pose(), lessThan(arm(t)));
      if (suppress == 'background') {
        t.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
        await t.pump();
      } else {
        await t.pumpWidget(scene(
            reduced: suppress == 'reduced', visible: suppress != 'hidden'));
      }
      final target = arm(t);
      expect(pose(), target,
          reason:
              'Suppression must stop the rendered pose, not just change duration.');
      await t.pump(const Duration(milliseconds: 100));
      expect(pose(), target);
      t.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await t.pumpWidget(const SizedBox());
    });
  }
}
