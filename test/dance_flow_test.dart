import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:harbeat/src/app.dart';
import 'package:harbeat/src/backend.dart';
import 'package:harbeat/src/controller.dart';
import 'package:harbeat/src/dance_repository.dart';
import 'package:harbeat/src/local_store.dart';
import 'package:harbeat/src/repository.dart';
import 'realtime_player_test.dart' show FakeRealtime, ProbeAudio;

class DanceFixture extends DanceRepository {
  Completer<Map<String, dynamic>>? delayed;
  final requested = <String>[];
  @override
  Future<Map<String, dynamic>> catalog() async => {
        'eligible': 22,
        'styles': [
          {
            'style': 'Hip-Hop',
            'count': 17,
            'durations': [5, 10]
          },
          {
            'style': 'House',
            'count': 5,
            'durations': [5]
          },
          {'style': 'Funk', 'count': 0, 'durations': <int>[]}
        ]
      };
  @override
  Future<Map<String, dynamic>> prepare(
      String style, int minutes, int variation) async {
    requested.add('$style:$minutes:$variation');
    if (delayed != null) return delayed!.future;
    return {
      'status': 'ready',
      'result': {
        'schema': 'harbeat.dance_set.v1',
        'id': 'dance',
        'style': style,
        'seconds': minutes * 60,
        'tracks': [
          {
            'id': 'track-a',
            'title': 'NAS A',
            'artist': 'Artist A',
            'style': style,
            'bpm': 120,
            'duration': 150
          },
          {
            'id': 'track-b',
            'title': 'NAS B',
            'artist': 'Artist B',
            'style': style,
            'bpm': 122,
            'duration': 150
          }
        ]
      }
    };
  }
}

class DanceEngine extends FakeRealtime {
  Map<String, dynamic>? configured;
  @override
  Future<Map<String, dynamic>> command(String method,
      [Map<String, dynamic> args = const {}]) async {
    if (method == 'configure') {
      calls.add(method);
      configured = args['set'];
      emit({
        'current': null,
        'dance': {
          'style': configured!['style'],
          'total': configured!['seconds'],
          'elapsed': 0,
          'message': '已就绪'
        }
      });
      return {'state': state, 'tracks': configured!['tracks']};
    }
    return super.command(method, args);
  }
}

Future<AppController> setup(DanceFixture repository, DanceEngine engine) async {
  final c = AppController(MockHarBeatRepository(),
      audio: ProbeAudio(),
      localStore: MemoryLocalStore(),
      danceRepository: repository,
      realtimeEngine: engine);
  await c.initialize();
  await c.enableV3();
  await c.loadDanceStyles();
  return c;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
      'style and duration generate a plan without autoplay; start configures actual V3',
      () async {
    final repository = DanceFixture(), engine = DanceEngine();
    final c = await setup(repository, engine);
    addTearDown(c.dispose);
    c.setDanceOptions(minutes: 10);
    await c.prepareDance();
    expect(repository.requested.last, 'Hip-Hop:10:0');
    expect(c.isPlaying, false);
    await c.startDance();
    expect(engine.configured!['seconds'], 600);
    expect(engine.calls.takeLast(2), ['configure', 'start']);
    expect(c.danceRunning, true);
    await c.togglePlayback();
    expect(c.isPlaying, false);
    c.setDanceOptions(style: 'House');
    expect(c.dancePlan, null);
    expect(c.danceMinutes, 5);
    c.setDanceOptions(style: 'Funk');
    await c.prepareDance();
    expect(repository.requested.length, 1);
  });
  test('cancelling preparation ignores a late server response', () async {
    final repo = DanceFixture(), engine = DanceEngine();
    final c = await setup(repo, engine);
    addTearDown(c.dispose);
    repo.delayed = Completer();
    final pending = c.prepareDance();
    c.cancelDancePreparation();
    repo.delayed!.complete({
      'status': 'ready',
      'result': {'tracks': []}
    });
    await pending;
    expect(c.dancePlan, null);
    expect(c.dancePreparing, false);
    expect(engine.configured, null);
  });
  test(
      'dance API is read-only, encodes style and never sends account credentials',
      () async {
    final repo = DanceRepository(client: MockClient((request) async {
      expect(request.method, 'GET');
      expect(request.headers['authorization'], null);
      expect(request.url.path, '/api/analysis-lab/dance/set');
      expect(request.url.queryParameters['style'], 'R&B');
      return http.Response(jsonEncode({'detail': '素材不足'}), 422,
          headers: {'content-type': 'application/json; charset=utf-8'});
    }));
    addTearDown(repo.close);
    await expectLater(
        repo.prepare('R&B', 10, 0),
        throwsA(isA<BackendException>()
            .having((e) => e.message, 'message', '素材不足')));
    await expectLater(Future.sync(() => repo.status('../secret')),
        throwsA(isA<BackendException>()));
  });
  testWidgets(
      'original playback page shows style duration and generated playlist',
      (tester) async {
    late AppController c;
    final repo = DanceFixture(), engine = DanceEngine();
    await tester.runAsync(() async {
      c = await setup(repo, engine);
      await c.prepareDance();
    });
    await tester.pumpWidget(MaterialApp(
        home: AnimatedBuilder(
            animation: c, builder: (_, __) => Shell(controller: c))));
    expect(find.text('本次舞程'), findsOneWidget);
    expect(find.text('音乐风格'), findsOneWidget);
    expect(find.text('大概跳多久'), findsOneWidget);
    await Scrollable.ensureVisible(tester.element(find.text('开始这场舞程')), alignment: .25);
    await tester.pumpAndSettle();
    expect(find.text('1. NAS A'), findsOneWidget);
    await tester.tap(find.text('开始这场舞程'));
    await tester.pump();
    expect(engine.configured, isNotNull);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
}

extension LastItems<T> on List<T> {
  Iterable<T> takeLast(int n) => skip(length - n);
}
