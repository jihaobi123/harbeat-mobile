import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/activity_repository.dart';
import 'package:harbeat/src/backend.dart';
import 'package:harbeat/src/session_store.dart';
import 'package:http/testing.dart';
import 'backend_test.dart' show oldTrack, jsonResponse, CapturingAudio;
import 'activity_flow_test.dart' show SwitchingActivities;
import 'package:harbeat/src/music_search_repository.dart';
import 'package:harbeat/src/controller.dart';
import 'package:harbeat/src/repository.dart';
import 'package:harbeat/src/local_store.dart';
import 'package:harbeat/src/audio_service.dart';
import 'metric_player_test.dart' show MetricEngine;
import 'realtime_player_test.dart' show ProbeAudio;

class FakeMusic extends MusicSearchRepository {
  FakeMusic()
      : super(ActivityRepository(credentials: MemoryActivityCredentials()));
  final old = Completer<MusicSearchResult>();
  bool fail = false;
  bool ready = false;
  @override
  Future<MusicSearchResult> search(String query, String scope) async {
    if (query == 'old') return old.future;
    if (fail) throw const ActivityException('搜索暂时不可用');
    return MusicSearchResult(
        hits: [MusicHit(id: 'd-$query', title: query)],
        scope: scope,
        semanticStatus: 'text',
        semanticMessage: '语义索引尚未覆盖');
  }

  @override
  Future<Map<String, String>> covers() async => {};
  @override
  Future<List<MusicImportJob>> jobs() async => [
        MusicImportJob(
            id: 'job-1',
            title: '新曲',
            state: ready ? 'ready' : 'analyzing',
            trackId: ready ? 'track-${'c' * 20}' : null)
      ];
}

class WorkspaceMusic extends FakeMusic {
  bool switched = false;
  final oldJobs = Completer<List<MusicImportJob>>();
  final oldCovers = Completer<Map<String, String>>();
  bool delayCovers = false;
  @override
  Future<List<MusicImportJob>> jobs() => switched
      ? Future.value([
          const MusicImportJob(id: 'new-job', title: '新工作区', state: 'analyzing')
        ])
      : (delayCovers ? Future.value([]) : oldJobs.future);
  @override
  Future<Map<String, String>> covers() =>
      switched ? Future.value({}) : oldCovers.future;
}

class RefreshEngine extends MetricEngine {
  RefreshEngine() {
    catalog[0]['id'] = 'track-${'a' * 20}';
    catalog[1]['id'] = 'track-${'b' * 20}';
  }
  @override
  Future<Map<String, dynamic>> command(String method,
      [Map<String, dynamic> args = const {}]) async {
    if (method == 'refreshLibrary') {
      calls.add(method);
      return {
        'tracks': [
          ...catalog,
          {
            'id': 'track-${'c' * 20}',
            'title': '新曲',
            'style': 'Hip-Hop',
            'duration': 180,
            'bpm': 110,
            'playStatus': 'ready',
            'mixStatus': 'ready'
          }
        ],
        'state': state
      };
    }
    return super.command(method, args);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  AppController controller(FakeMusic repo) =>
      AppController(MockHarBeatRepository(),
          musicSearchRepository: repo,
          localStore: MemoryLocalStore(),
          audio: MemoryAudioService());
  test(
      'late responses cannot replace a newer query or scope and original search remains unchanged',
      () async {
    final repo = FakeMusic();
    final actual = controller(repo);
    addTearDown(actual.dispose);
    actual.setSearchQuery('legacy');
    actual.setMusicSearchQuery('old');
    final old = actual.runMusicSearch();
    actual.setMusicSearchQuery('new');
    await actual.runMusicSearch();
    repo.old.complete(const MusicSearchResult(
        hits: [MusicHit(id: 'old', title: 'old')], scope: 'library'));
    await old;
    expect(actual.musicSearchQuery, 'new');
    expect(actual.musicSearchResult!.hits.single.title, 'new');
    expect(actual.searchQuery, 'legacy');
    await actual.changeMusicSearchScope('discover');
    expect(actual.musicSearchResult!.scope, 'discover');
  });
  test(
      'semantic degradation and network errors retain real results and own task state',
      () async {
    final repo = FakeMusic(), c = controller(repo);
    addTearDown(c.dispose);
    c.setMusicSearchQuery('new');
    await c.runMusicSearch();
    expect(c.musicSearchResult!.semanticMessage, contains('尚未覆盖'));
    repo.fail = true;
    await c.runMusicSearch();
    expect(c.musicSearchResult!.hits.single.title, 'new');
    expect(c.musicSearchError, isNotNull);
    await c.refreshMusicJobs();
    expect(c.musicImportJobs.single.state, 'analyzing');
    expect(c.nowPlaying, isNull);
  });
  test(
      'ready job appends published engine row without restarting current playback or changing its point',
      () async {
    final repo = FakeMusic(), engine = RefreshEngine(), audio = ProbeAudio();
    final c = AppController(MockHarBeatRepository(),
        musicSearchRepository: repo,
        realtimeEngine: engine,
        audio: audio,
        localStore: MemoryLocalStore());
    addTearDown(c.dispose);
    await c.initialize();
    await c.enableV3(mode: 'metric');
    await c.togglePlayback();
    engine.emit({'position': 42});
    final current = c.nowPlaying!.id,
        starts = engine.calls.where((m) => m == 'start').length,
        stops = engine.calls.where((m) => m == 'stop').length;
    repo.ready = true;
    await c.refreshMusicJobs();
    expect(c.v3Catalog.any((r) => r['id'] == 'track-${'c' * 20}'), true);
    expect(c.nowPlaying!.id, current);
    expect(c.isPlaying, true);
    expect(c.position.inSeconds, 42);
    expect(engine.calls.where((m) => m == 'start').length, starts);
    expect(engine.calls.where((m) => m == 'stop').length, stops);
    await c.refreshMusicJobs();
    expect(engine.calls.where((m) => m == 'refreshLibrary'), hasLength(1));
    expect((await c.musicJobTrack(c.musicImportJobs.single))!.id,
        'nas:track-${'c' * 20}');
  });

  test(
      'private backend library search preserves its Track identity and remote audio rather than using shared NAS search',
      () async {
    final queries = <String>[], source = FakeMusic(), audio = CapturingAudio();
    final remote = RemoteHarBeatRepository(BackendConfig('https://music.test'),
        client: MockClient((r) async {
      queries.add(r.url.queryParameters['q'] ?? '');
      if (r.url.path.endsWith('/b')) return jsonResponse(oldTrack('b'));
      return jsonResponse({
        'songs': [oldTrack('b')]
      });
    }));
    final c = AppController(remote,
        musicSearchRepository: source,
        localStore: MemoryLocalStore(),
        audio: audio);
    addTearDown(c.dispose);
    await c.initialize();
    c.setMusicSearchQuery('TEST B');
    await c.runMusicSearch();
    final hit = c.musicSearchResult!.hits.single;
    expect(queries, contains('TEST B'));
    expect(hit.id, startsWith('remote:'));
    expect(hit.id, endsWith(':b'));
    expect(hit.remoteTrack!.backendId, 'b');
    expect(c.musicSearchResult!.semanticStatus, isNull);
    expect(c.musicSearchResult!.semanticMessage, isNull);
    await c.playMusicHit(hit);
    expect(c.nowPlaying!.id, hit.id);
    expect(audio.paths.last, 'https://music.test/api/stream/b');
    expect(c.tracks.any((t) => t.id == 'nas:b'), false);
  });

  test(
      'workspace restore invalidates late jobs and query replies without hiding new workspace results',
      () async {
    final music = WorkspaceMusic(), activities = SwitchingActivities();
    final c = AppController(MockHarBeatRepository(),
        musicSearchRepository: music,
        activityRepository: activities,
        localStore: MemoryLocalStore(),
        audio: MemoryAudioService());
    addTearDown(c.dispose);
    c.setMusicSearchQuery('old');
    final query = c.runMusicSearch();
    final pending = c.refreshMusicJobs();
    await c.restoreActivityBackup('backup');
    music.switched = true;
    await c.refreshMusicJobs();
    music.oldJobs.complete([
      const MusicImportJob(id: 'old-job', title: '旧工作区', state: 'analyzing')
    ]);
    music.old.complete(const MusicSearchResult(
        hits: [MusicHit(id: 'old', title: '旧搜索结果')], scope: 'library'));
    await pending;
    await query;
    expect(c.musicImportJobs.single.id, 'new-job');
    expect(c.musicSearchResult, isNull);
    expect(c.musicJobsLoading, false);
  });

  test(
      'workspace restore prevents a late cover response from updating new workspace metadata',
      () async {
    final music = WorkspaceMusic()..delayCovers = true,
        activities = SwitchingActivities();
    final c = AppController(MockHarBeatRepository(),
        musicSearchRepository: music,
        activityRepository: activities,
        realtimeEngine: RefreshEngine(),
        localStore: MemoryLocalStore(),
        audio: MemoryAudioService());
    addTearDown(c.dispose);
    await c.initialize();
    await c.enableV3(mode: 'metric');
    final original = c.nowPlaying!;
    final pending = c.refreshMusicJobs();
    await Future<void>.delayed(Duration.zero);
    await c.restoreActivityBackup('backup');
    music.switched = true;
    await c.refreshMusicJobs();
    music.oldCovers.complete({
      'track-${'a' * 20}':
          'https://example.test/listen/music-covers/${'a' * 64}.jpg'
    });
    await pending;
    expect(c.musicImportJobs.single.id, 'new-job');
    expect(c.musicJobsLoading, false);
    expect(c.tracks.firstWhere((t) => t.id == original.id).coverUrl,
        original.coverUrl);
    expect(c.nowPlaying!.coverUrl, original.coverUrl);
  });

  for (final demo in [false, true]) {
    test(
        'switching ${demo ? 'to demo' : 'backend'} invalidates old music cards and pending responses while retaining workspace credential',
        () async {
      final music = WorkspaceMusic(),
          credentials = MemoryActivityCredentials()..value = 't' * 48;
      RemoteHarBeatRepository remote(BackendConfig config) =>
          RemoteHarBeatRepository(config,
              client: MockClient((r) async => jsonResponse({
                    'songs': [oldTrack('b')]
                  })));
      final c = AppController(remote(BackendConfig('https://old.test')),
          musicSearchRepository: music,
          activityRepository: ActivityRepository(credentials: credentials),
          backendFactory: remote,
          sessionStore: MemorySessionStore(),
          localStore: MemoryLocalStore(),
          audio: MemoryAudioService());
      addTearDown(c.dispose);
      await c.initialize();
      c.musicSearchScope = 'discover';
      c.musicSearchResult = const MusicSearchResult(
          scope: 'discover', hits: [MusicHit(id: 'old-card', title: '旧卡片')]);
      c.musicImportJobs = [
        const MusicImportJob(id: 'old-job', title: '旧任务', state: 'analyzing')
      ];
      c.setMusicSearchQuery('old');
      final oldQuery = c.runMusicSearch(), oldJobs = c.refreshMusicJobs();
      if (demo) {
        await c.useDemoCatalog();
      } else {
        await c.configureBackend(BackendConfig('https://new.test'));
      }
      expect(c.musicSearchResult, isNull);
      expect(c.musicImportJobs, isEmpty);
      music.old.complete(const MusicSearchResult(
          scope: 'discover', hits: [MusicHit(id: 'late-old', title: '迟到旧结果')]));
      music.oldJobs.complete([
        const MusicImportJob(
            id: 'late-old-job', title: '迟到旧任务', state: 'analyzing')
      ]);
      await oldQuery;
      await oldJobs;
      expect(c.musicSearchResult, isNull);
      expect(c.musicImportJobs, isEmpty);
      expect(c.musicJobsLoading, false);
      expect(credentials.value, 't' * 48);
    });
  }

  test('external discovery cannot be played or made into a published NAS row',
      () async {
    final c = controller(FakeMusic());
    addTearDown(c.dispose);
    await c.playMusicHit(const MusicHit(
        id: 'external', title: '外部曲目', discoveryId: 'opaque', playable: true));
    expect(c.nowPlaying, isNull);
    expect(c.musicSearchError, isNotNull);
    expect(c.tracks, isEmpty);
  });
}
