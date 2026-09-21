import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/app.dart';
import 'package:harbeat/src/audio_service.dart';
import 'package:harbeat/src/controller.dart';
import 'package:harbeat/src/local_store.dart';
import 'package:harbeat/src/models.dart';
import 'package:harbeat/src/realtime_engine.dart';
import 'package:harbeat/src/repository.dart';

class FakeRealtime extends RealtimeEngine {
  final stream = StreamController<Map<String, dynamic>>.broadcast(sync: true);
  final calls = <String>[];
  final intents = <Map<String, dynamic>>[];
  final catalog = [
    {
      'id': 'track-a',
      'title': 'Big Girls',
      'bpm': 142.9,
      'style': 'Trap',
      'duration': 135
    },
    {
      'id': 'track-b',
      'title': 'Cold',
      'bpm': 137,
      'style': 'Grime',
      'duration': 150
    },
  ];
  Map<String, dynamic> state = {
    'playing': false,
    'position': 0,
    'duration': 0,
    'busy': false,
    'status': '就绪'
  };
  bool failStop = false;
  @override
  bool get supported => true;
  @override
  Stream<Map<String, dynamic>> get states => stream.stream;
  void emit(Map<String, dynamic> next) {
    state = {...state, ...next};
    stream.add(state);
  }

  @override
  Future<Map<String, dynamic>> command(String method,
      [Map<String, dynamic> args = const {}]) async {
    calls.add(method);
    switch (method) {
      case 'start':
        emit({
          'current': catalog.firstWhere((t) => t['id'] == args['trackId']),
          'playing': true,
          'position': 0
        });
      case 'pause':
        emit({'playing': false, 'paused': true});
      case 'resume':
        emit({'playing': true, 'paused': false});
      case 'request':
        intents.add(Map<String, dynamic>.from(args['intent']));
        emit({
          'pending': {'title': 'Cold', 'remaining': 8, 'locked': false}
        });
      case 'cancel':
        emit({'pending': null});
      case 'stop':
        if (failStop) throw StateError('stop failed');
        emit({'playing': false, 'current': null, 'pending': null});
    }
    return {'state': state, if (method == 'prepare') 'tracks': catalog};
  }

  @override
  Future<void> dispose() => stream.close();
}

class ProbeAudio extends MemoryAudioService {
  final positions = StreamController<Duration>.broadcast(sync: true);
  final actions = <String>[];
  @override
  Stream<Duration> get position => positions.stream;
  @override
  Future<void> stop() async {
    actions.add('stop');
  }

  @override
  Future<void> play(
      {String? filePath,
      String title = 'HarBeat Preview',
      Map<String, String>? headers}) async {
    actions.add('play:$title');
  }

  @override
  Future<void> dispose() => positions.close();
}

Future<AppController> setup(FakeRealtime engine, ProbeAudio audio) async {
  final c = AppController(MockHarBeatRepository(),
      audio: audio, localStore: MemoryLocalStore(), realtimeEngine: engine);
  await c.initialize();
  return c;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('V3 owns playback, queue handoff, progress, pause and navigation',
      () async {
    final engine = FakeRealtime(), audio = ProbeAudio();
    final c = await setup(engine, audio);
    addTearDown(c.dispose);
    await c.openRealtimeLab();
    expect(c.tab, 0);
    expect(c.v3Active, true);
    expect(audio.actions, ['stop']);
    expect(c.queue, ['nas:track-a', 'nas:track-b']);
    await c.togglePlayback();
    expect(engine.calls.last, 'start');
    expect(c.isPlaying, true);
    engine.emit({'busy': true});
    await c.togglePlayback();
    expect(engine.calls.last, 'pause');
    engine.emit({'busy': false});
    await c.togglePlayback();
    expect(c.isPlaying, true);
    engine.emit({'position': 12.5});
    expect(c.position.inMilliseconds, 12500);
    audio.positions.add(const Duration(seconds: 77));
    expect(c.position.inMilliseconds, 12500);
    await c.nextTrack();
    expect(engine.intents.last, {'kind': 'next'});
    expect(c.v3Pending?['title'], 'Cold');
    engine.emit({
      'current': engine.catalog[1],
      'position': 21,
      'pending': null,
      'status': '交接完成'
    });
    expect(c.nowPlaying?.title, 'Cold');
    expect(c.queueIndex, 1);
    expect(c.duration.inSeconds, 150);
    await c.togglePlayback();
    expect(engine.calls.last, 'pause');
    expect(c.isPlaying, false);
    c.setTab(1);
    await c.openRealtimeLab();
    expect(c.tab, 0);
    expect(c.nowPlaying?.title, 'Cold');
    expect(engine.calls.where((x) => x == 'prepare').length, 1);
    await c.togglePlayback();
    expect(engine.calls.last, 'resume');
    await c.play(c.v3Tracks.first);
    expect(engine.intents.last, {'kind': 'next', 'targetId': 'track-a'});
  });
  test(
      'changing engine stops V3 before standard playback; failed stop keeps ownership',
      () async {
    final engine = FakeRealtime(), audio = ProbeAudio();
    final c = await setup(engine, audio);
    addTearDown(c.dispose);
    final standard = c.tracks.first;
    await c.enableV3();
    await c.togglePlayback();
    engine.failStop = true;
    await c.play(standard);
    expect(c.v3Active, true);
    expect(audio.actions.where((x) => x.startsWith('play:')), isEmpty);
    engine.failStop = false;
    await c.play(standard);
    expect(engine.calls.last, 'stop');
    expect(c.v3Active, false);
    expect(audio.actions.last, 'play:${standard.title}');
    engine
        .emit({'playing': true, 'current': engine.catalog[1], 'position': 99});
    expect(c.nowPlaying?.id, standard.id);
    expect(c.position.inSeconds, 0);
  });
  test('mode and loop controls cannot change the inactive standard engine',
      () async {
    final engine = FakeRealtime(), audio = ProbeAudio();
    final c = await setup(engine, audio);
    addTearDown(c.dispose);
    await c.enableV3();
    c.setPlaybackMode(PlaybackMode.repeatOne);
    await c.togglePracticeLoop();
    expect(c.playbackMode, PlaybackMode.sequential);
    expect(c.loopPreview, false);
    expect(audio.actions, ['stop']);
    final candidates = List.of(c.queue);
    c.removeQueueItem(c.queue.first);
    c.moveQueueItem(0, 1);
    expect(c.queue, candidates);
    await c.v3Cancel();
    expect(engine.calls.last, 'cancel');
    await c.v3Export('json');
    expect(engine.calls.last, 'export');
  });
  testWidgets(
      'existing Flutter play page displays V3 controls without a second page',
      (tester) async {
    final engine = FakeRealtime(), audio = ProbeAudio();
    late AppController c;
    await tester.runAsync(() async {
      c = await setup(engine, audio);
      await c.enableV3();
      await c.togglePlayback();
    });
    await tester.pumpWidget(MaterialApp(
        home: AnimatedBuilder(
            animation: c, builder: (_, __) => Shell(controller: c))));
    expect(find.text('PLAY / V3 REALTIME'), findsOneWidget);
    expect(find.text('MAKE THE\nFLOOR MOVE.'), findsOneWidget);
    expect(find.text('播放'), findsOneWidget);
    expect(find.text('音乐'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('提高能量 ↑'), 400);
    await tester.tap(find.text('提高能量 ↑'));
    await tester.pump();
    expect(engine.intents.last, {'kind': 'up'});
    await tester.scrollUntilVisible(find.text('Grime'), 200);
    await tester.tap(find.text('Grime'));
    await tester.pump();
    expect(engine.intents.last, {'kind': 'style', 'style': 'Grime'});
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
}
