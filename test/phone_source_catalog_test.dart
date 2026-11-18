import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:harbeat/src/audio_service.dart';
import 'package:harbeat/src/controller.dart';
import 'package:harbeat/src/local_store.dart';
import 'package:harbeat/src/nas_repository.dart';
import 'package:harbeat/src/realtime_engine.dart';
import 'package:harbeat/src/repository.dart';
import 'metric_player_test.dart' show MetricEngine;

Map<String, dynamic> source(String letter, {bool mix = true}) => {
      'id': 'track-${letter * 20}',
      'title': 'New beat $letter',
      'collection': '街舞 DJ / Stereophonk',
      'bpm': 100,
      'duration': 180,
      'style': 'Breakbeat',
      'styleLabels': ['Breaking'],
      'playStatus': 'ready',
      'mixStatus': mix ? 'ready' : 'unavailable',
      'reason': mix ? null : 'beat grid and tempo disagree',
      'detailUrl':
          '/analysis-lab-static/mobile-library-v1/catalog/sources-123/details/track-${letter * 20}.json',
      'coverPath': '/analysis-lab-static/mobile-artwork-v1/${letter * 64}.jpg',
    };

class CatalogEngine extends RealtimeEngine {
  @override
  bool get supported => true;
  @override
  Stream<Map<String, dynamic>> get states => const Stream.empty();
  @override
  Future<Map<String, dynamic>> command(String method,
          [Map<String, dynamic> args = const {}]) async =>
      {};
  @override
  Future<void> dispose() async {}
}

class SourceRepo extends NasCatalogRepository {
  List<Map<String, dynamic>> rows = [source('a'), source('b', mix: false)];
  @override
  Future<List<Map<String, dynamic>>> phoneSourceDirectory() async => rows;
}

class LiveSourceEngine extends MetricEngine {
  bool failRefresh = false;
  @override
  Future<Map<String, dynamic>> command(String method,
      [Map<String, dynamic> args = const {}]) async {
    if (method == 'refreshLibrary') {
      calls.add(method);
      if (failRefresh) throw StateError('network unavailable');
      return {
        'tracks': [...catalog, source('a'), source('b', mix: false)],
        'state': state
      };
    }
    return super.command(method, args);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  for (final fail in [false, true]) {
    test(
        'live source expansion preserves current playback (refresh fails: $fail)',
        () async {
      final r = SourceRepo(), engine = LiveSourceEngine()..failRefresh = fail;
      final c = AppController(MockHarBeatRepository(),
          audio: MemoryAudioService(),
          localStore: MemoryLocalStore(),
          nasRepository: r,
          realtimeEngine: engine);
      addTearDown(c.dispose);
      addTearDown(r.close);
      await c.enableV3(mode: 'metric');
      await c.togglePlayback();
      final current = c.nowPlaying!.id;
      engine.calls.clear();
      await c.loadPhoneSourceCatalog();
      expect(c.isPlaying, true);
      expect(c.nowPlaying!.id, current);
      expect(engine.calls, contains('refreshLibrary'));
      expect(engine.calls, isNot(contains('stop')));
      if (!fail) {
        await c
            .play(c.tracks.singleWhere((t) => t.id == 'nas:track-${'a' * 20}'));
        expect(engine.calls.last, 'select');
        expect(c.v3Active, true);
        expect(c.isPlaying, true);
        expect(c.nowPlaying!.id, current);
      } else {
        expect(
            c.playlists.where(
                (p) => p.id == NasCatalogRepository.phoneSourcePlaylistId),
            isEmpty);
      }
    });
  }

  test('only explicit device source publications enter the phone catalog',
      () async {
    var policy = 'device-native-windows-v1';
    final r = NasCatalogRepository(client: MockClient((request) async {
      expect(request.url.path,
          '/analysis-lab-static/mobile-library-v1/library.json');
      expect(request.followRedirects, false);
      expect(request.headers.containsKey('authorization'), false);
      return http.Response.bytes(
          utf8.encode(jsonEncode({
            'schema': 'harbeat.continuous-library.v1',
            'executionPolicy': policy,
            'tracks': [
              source('a'),
              source('b', mix: false),
              {...source('c'), 'detailUrl': 'https://other.invalid/private'},
              {...source('d'), 'id': '../other'}
            ]
          })),
          200);
    }));
    addTearDown(r.close);
    expect((await r.phoneSourceDirectory()).map((r) => r['id']),
        ['track-${'a' * 20}', 'track-${'b' * 20}']);
    policy = 'unknown';
    expect(await r.phoneSourceDirectory(), isEmpty);
  });
  test('source outage leaves the existing phone library available', () async {
    final r = NasCatalogRepository(
        client: MockClient((r) async => http.Response('', 503)));
    addTearDown(r.close);
    expect(await r.phoneSourceDirectory(), isEmpty);
  });
  test(
      'new source music has a visible playlist and covers without changing favorites',
      () async {
    final r = SourceRepo();
    addTearDown(r.close);
    final c = AppController(MockHarBeatRepository(),
        audio: MemoryAudioService(),
        localStore: MemoryLocalStore(),
        nasRepository: r,
        realtimeEngine: CatalogEngine());
    addTearDown(c.dispose);
    c.library.add('existing-favorite');
    await c.loadPhoneSourceCatalog();
    var p = c.playlists
        .singleWhere((p) => p.id == NasCatalogRepository.phoneSourcePlaylistId);
    expect(p.name, '街舞 DJ · 新增音乐');
    expect(p.trackIds, hasLength(2));
    expect(c.library, {'existing-favorite'});
    final t = c.tracks.singleWhere((t) => t.id == 'nas:track-${'a' * 20}');
    expect(t.coverUrl,
        'https://47.108.118.177/analysis-lab-static/mobile-artwork-v1/${'a' * 64}.jpg');
    expect(c.tracks.singleWhere((t) => t.id == 'nas:track-${'b' * 20}').reason,
        contains('原曲可试听'));
    c.playlists = [
      ...c.playlists.where((x) => x.id != p.id),
      p.copyWith(name: '我的街舞歌单', trackIds: p.trackIds.reversed.toList())
    ];
    r.rows.add(source('c'));
    await c.loadPhoneSourceCatalog();
    p = c.playlists
        .singleWhere((p) => p.id == NasCatalogRepository.phoneSourcePlaylistId);
    expect(p.name, '我的街舞歌单');
    expect(p.trackIds, [
      'nas:track-${'b' * 20}',
      'nas:track-${'a' * 20}',
      'nas:track-${'c' * 20}'
    ]);
    r.rows = [];
    await c.loadPhoneSourceCatalog();
    expect(
        c.playlists
            .singleWhere(
                (p) => p.id == NasCatalogRepository.phoneSourcePlaylistId)
            .trackIds,
        hasLength(3));
  });
}
