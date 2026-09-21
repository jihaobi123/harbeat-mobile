import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/app.dart';
import 'package:harbeat/src/audio_service.dart';
import 'package:harbeat/src/backend.dart';
import 'package:harbeat/src/controller.dart';
import 'package:harbeat/src/local_store.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

Map<String, dynamic> v2Track(String id, {String resource = 'complete'}) => {
      'track_id': id,
      'title': 'Track $id',
      'artist': null,
      'style_labels': ['EDM'],
      'bpm': 127.5,
      'key_name': null,
      'duration_ms': 120000,
      'analysis_status': 'degraded',
      'resource_status': resource,
      'needs_review': true,
      'quality_flags': ['drum_group_proxy'],
      'analysis_run_id': 'run-1',
    };
Map<String, dynamic> oldTrack(String id) => {
      'id': id,
      'title': 'Old $id',
      'artist': 'Artist',
      'file_size': 4096,
      'duration': 12.5,
      'bpm': 100.25,
      'energy': .72,
      'key': 'F minor',
      'analysis_status': 'completed',
      'beat_points': [0.12, .72, 1.32],
      'downbeats': [.12],
      'beat_needs_review': false,
    };
http.Response jsonResponse(Map<String, dynamic> data, {bool legacy = false}) =>
    http.Response(jsonEncode({if (legacy) 'code': 0, 'data': data}), 200,
        headers: {'content-type': 'application/json; charset=utf-8'});

class CapturingAudio extends MemoryAudioService {
  final List<String?> paths = [];
  final List<Map<String, String>?> auth = [];
  @override
  Future<void> play(
      {String? filePath,
      String title = 'HarBeat Preview',
      Map<String, String>? headers}) async {
    paths.add(filePath);
    auth.add(headers);
  }
}

void main() {
  test(
      'legacy vocal seconds become explicit ms without inventing empty reports',
      () async {
    final repo = RemoteHarBeatRepository(BackendConfig('https://music.test'),
        client: MockClient((_) async => jsonResponse({
              'songs': [
                {
                  ...oldTrack('a'),
                  'vocal_events': [
                    {'start': 1.25, 'end': 2.5},
                    {'start': 5, 'end': 4},
                    {'time': 3}
                  ]
                },
                oldTrack('b'),
              ]
            })));
    addTearDown(repo.close);
    final tracks = (await repo.catalog()).items;
    expect(tracks.first.analysis['vocal_activity']['intervals'], [
      {'start_ms': 1250, 'end_ms': 2500}
    ]);
    expect(tracks.last.analysis.containsKey('vocal_activity'), isFalse);
  });
  testWidgets('typing a query survives remote search rebuilds', (tester) async {
    final queries = <String>[];
    final repo = RemoteHarBeatRepository(BackendConfig('https://music.test'),
        client: MockClient((r) async {
      queries.add(r.url.queryParameters['q'] ?? '');
      return jsonResponse({
        'songs': [oldTrack('b')]
      });
    }));
    await tester.pumpWidget(HarBeatApp(
        repository: repo,
        audio: MemoryAudioService(),
        localStore: MemoryLocalStore()));
    await tester.pumpAndSettle();
    await tester.tap(find.text('音乐'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('搜索'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'TEST B');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    expect(queries, contains('TEST B'));
    expect(tester.widget<TextField>(find.byType(TextField)).controller!.text,
        'TEST B');
  });
  test(
      'v2 degraded audio remains playable; nullable metadata and EDM preserved',
      () async {
    final repo = RemoteHarBeatRepository(
        BackendConfig('https://music.test',
            api: BackendApi.v2,
            token: 'secret'), client: MockClient((request) async {
      expect(request.url.path, '/api/v2/tracks');
      expect(request.headers['Authorization'], 'Bearer secret');
      return jsonResponse({
        'items': [v2Track('a')],
        'next_cursor': 'page 2'
      });
    }));
    addTearDown(repo.close);
    final page = await repo.catalog();
    final track = page.items.single;
    expect(track.canPlay, isTrue);
    expect(track.bpm, 127.5);
    expect(track.bpmLabel, '127.5');
    expect(track.energy, isNull);
    expect(track.musicalKey, isNull);
    expect(track.needsReview, isTrue);
    expect(track.mixStyle, 'Local'); // Do not invent House from EDM.
    expect(page.nextCursor, 'page 2');
    expect(track.analysisLabel, '分析部分降级');
  });

  test('v2 search and cursor are encoded, missing audio is not playable',
      () async {
    final repo = RemoteHarBeatRepository(
        BackendConfig('https://music.test/api/v2', api: BackendApi.v2),
        client: MockClient((request) async {
      expect(request.url.path, '/api/v2/tracks');
      expect(request.url.queryParameters['q'], 'Funk & 中文');
      expect(request.url.queryParameters['cursor'], 'a+b/==');
      return jsonResponse({
        'items': [v2Track('a', resource: 'missing')],
        'next_cursor': null
      });
    }));
    addTearDown(repo.close);
    final page = await repo.catalog(query: 'Funk & 中文', cursor: 'a+b/==');
    expect(page.items.single.canPlay, isFalse);
  });

  test('legacy seconds and normalized energy become ms and percent', () async {
    final repo =
        RemoteHarBeatRepository(BackendConfig('https://music.test/api'),
            client: MockClient((r) async => jsonResponse({
                  'songs': [oldTrack('a')]
                }, legacy: true)));
    addTearDown(repo.close);
    final track = (await repo.catalog()).items.single;
    expect(track.durationMs, 12500);
    expect(track.energy, 72);
    expect(track.analysis['beat_grid']['beats_ms'], [120, 720, 1320]);
    expect(track.canPlay, isTrue);
  });

  test('v2 analysis detail retains beat data and uses its own audio', () async {
    final repo = RemoteHarBeatRepository(
        BackendConfig('https://music.test',
            api: BackendApi.v2, token: 'secret'),
        client: MockClient((r) async => r.url.path.endsWith('/a')
            ? jsonResponse({
                ...v2Track('a'),
                'analysis': {
                  'energy': {'overall': .81, 'curve': []},
                  'beat_grid': {
                    'beats_ms': [150, 650]
                  }
                }
              })
            : jsonResponse({
                'items': [v2Track('a')]
              })));
    addTearDown(repo.close);
    final track = await repo.detail((await repo.catalog()).items.single);
    expect(track.energy, 81);
    expect(track.analysis['beat_grid']['beats_ms'], [150, 650]);
    final source = repo.audio(track, web: false);
    expect(source.uri.path, '/api/v2/tracks/a/preview');
    expect(source.headers['Authorization'], 'Bearer secret');
    expect(
        () => repo.audio(track, web: true), throwsA(isA<BackendException>()));
  });

  test('signed CDN audio does not receive a user bearer token', () async {
    final repo = RemoteHarBeatRepository(
        BackendConfig('https://music.test',
            api: BackendApi.v2, token: 'secret'),
        client: MockClient((r) async => jsonResponse({
              'items': [
                {
                  ...v2Track('a'),
                  'preview_url': 'https://cdn.test/a?ticket=short'
                }
              ]
            })));
    addTearDown(repo.close);
    final source = repo.audio((await repo.catalog()).items.single, web: true);
    expect(source.uri.host, 'cdn.test');
    expect(source.headers, isEmpty);
  });

  test('legacy browser uses supported stream token; config never serializes it',
      () async {
    final config = BackendConfig('https://music.test', token: 'secret');
    final repo = RemoteHarBeatRepository(config,
        client: MockClient((r) async => jsonResponse({
              'songs': [oldTrack('a')]
            })));
    addTearDown(repo.close);
    final source = repo.audio((await repo.catalog()).items.single, web: true);
    expect(source.uri.queryParameters['token'], 'secret');
    expect(jsonEncode(config.toJson()), isNot(contains('secret')));
  });

  test('401 and malformed responses fail explicitly, with no mock fallback',
      () async {
    for (final response in [
      http.Response('', 401),
      http.Response('<html>gateway</html>', 200),
      jsonResponse({'items': 'bad'})
    ]) {
      final repo = RemoteHarBeatRepository(
          BackendConfig('https://music.test', api: BackendApi.v2),
          client: MockClient((r) async => response));
      await expectLater(repo.catalog(), throwsA(isA<BackendException>()));
      repo.close();
    }
  });

  test('source IDs are scoped to server and protocol', () async {
    Future<String> id(String host, BackendApi api) async {
      final repo = RemoteHarBeatRepository(BackendConfig(host, api: api),
          client: MockClient((r) async => jsonResponse(api == BackendApi.v2
              ? {
                  'items': [v2Track('a')]
                }
              : {
                  'songs': [oldTrack('a')]
                })));
      final result = (await repo.catalog()).items.single.id;
      repo.close();
      return result;
    }

    final a = await id('https://one.test', BackendApi.v2);
    expect(await id('https://two.test', BackendApi.v2), isNot(a));
    expect(await id('https://one.test', BackendApi.legacy), isNot(a));
  });

  test('controller recovers from server errors and plays distinct remote audio',
      () async {
    var fail = true;
    final repo = RemoteHarBeatRepository(
        BackendConfig('https://music.test', token: 'secret'),
        client: MockClient((r) async {
      if (fail) return http.Response('', 503);
      if (r.url.path.endsWith('/songs')) {
        return jsonResponse({
          'songs': [oldTrack('a'), oldTrack('b')]
        });
      }
      return jsonResponse(oldTrack(r.url.pathSegments.last));
    }));
    final audio = CapturingAudio();
    final store = MemoryLocalStore();
    final c = AppController(repo, audio: audio, localStore: store);
    addTearDown(c.dispose);
    await c.initialize();
    expect(c.loading, isFalse);
    expect(c.catalogError, isNotNull);
    expect(c.tracks, isEmpty);
    fail = false;
    await c.refreshCatalog();
    expect(c.catalogError, isNull);
    await c.play(c.tracks[0]);
    await c.play(c.tracks[1]);
    expect(audio.paths,
        ['https://music.test/api/stream/a', 'https://music.test/api/stream/b']);
    expect(audio.auth.first?['Authorization'], 'Bearer secret');
    expect(jsonEncode(store.value), isNot(contains('secret')));
    await c.requestDirection(targetEnergy: 5);
    expect(
        c.pendingIntent, isNull); // No fake four-second mixing for real audio.
  });

  test('out of order search responses cannot overwrite the latest query',
      () async {
    final slow = Completer<http.Response>();
    final repo = RemoteHarBeatRepository(
        BackendConfig('https://music.test', api: BackendApi.v2),
        client: MockClient((r) async {
      if (r.url.queryParameters['q'] == 'slow') return slow.future;
      return jsonResponse({
        'items': [v2Track(r.url.queryParameters['q'] ?? 'initial')]
      });
    }));
    final c = AppController(repo,
        audio: MemoryAudioService(), localStore: MemoryLocalStore());
    addTearDown(c.dispose);
    await c.initialize();
    c.searchQuery = 'slow';
    final old = c.searchRemote();
    c.searchQuery = 'fast';
    await c.searchRemote();
    slow.complete(jsonResponse({
      'items': [v2Track('slow')]
    }));
    await old;
    expect(c.searchResults.single.backendId, 'fast');
  });

  test('detail mismatch never reaches the audio player', () async {
    final repo = RemoteHarBeatRepository(BackendConfig('https://music.test'),
        client:
            MockClient((r) async => jsonResponse(r.url.path.endsWith('/songs')
                ? {
                    'songs': [oldTrack('a')]
                  }
                : oldTrack('wrong'))));
    final audio = CapturingAudio();
    final c = AppController(repo, audio: audio, localStore: MemoryLocalStore());
    addTearDown(c.dispose);
    await c.initialize();
    await c.play(c.tracks.single);
    expect(audio.paths, isEmpty);
    expect(c.clientIssue, isNotNull);
  });

  testWidgets('remote error and connection setup fit a phone viewport',
      (tester) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final repo = RemoteHarBeatRepository(BackendConfig('https://music.test'),
        client: MockClient((r) async => http.Response('', 401)));
    await tester.pumpWidget(HarBeatApp(
        repository: repo,
        audio: MemoryAudioService(),
        localStore: MemoryLocalStore()));
    await tester.pumpAndSettle();
    await tester.tap(find.text('我的'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('音乐服务'));
    await tester.tap(find.text('音乐服务'));
    await tester.pumpAndSettle();
    expect(find.text('账号'), findsOneWidget);
    await tester.ensureVisible(find.text('连接设置'));
    await tester.tap(find.text('连接设置'));
    await tester.pumpAndSettle();
    expect(find.text('服务地址'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
