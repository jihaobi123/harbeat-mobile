import 'dart:convert';
import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:harbeat/src/activity_repository.dart';
import 'package:harbeat/src/music_search_repository.dart';

void main() {
  testWidgets(
      'music matching can outlast reservation timeout while its response is pending',
      (tester) async {
    final reply = Completer<http.Response>();
    final activity = ActivityRepository(
        credentials: MemoryActivityCredentials()..value = 't' * 48,
        baseUri: Uri.parse('https://example.test'),
        client: MockClient((r) => reply.future));
    addTearDown(activity.dispose);
    Object? error, reservationError;
    bool completed = false;
    activity.list().then<void>((_) {}, onError: (Object e) {
      reservationError = e;
    });
    activity.musicRequest('POST', '/music/matches',
        body: {'discoveryId': 'a' * 32}).then<void>((_) {
      completed = true;
    }, onError: (Object e) {
      error = e;
    });
    await tester.pump();
    await tester.pump(const Duration(seconds: 40));
    expect(error, isNull);
    expect(completed, false);
    expect(reservationError, isA<ActivityException>());
    reply.complete(http.Response('{"candidates":[]}', 200));
    await tester.pump();
    expect(completed, true);
    expect(error, isNull);
  });

  test(
      'semantic library search reuses reservation workspace and keeps coverage',
      () async {
    final credentials = MemoryActivityCredentials()..value = 't' * 48;
    final activity = ActivityRepository(
        credentials: credentials,
        baseUri: Uri.parse('https://example.test'),
        client: MockClient((r) async {
          expect(r.url.path, '/listen/set-api/music/search');
          expect(r.url.queryParameters['q'], '低沉鼓点');
          expect(r.headers['authorization'], 'Bearer ${'t' * 48}');
          return http.Response(
              jsonEncode({
                'mode': 'semantic',
                'results': [
                  {
                    'id': 'track-${'a' * 20}',
                    'title': '真实曲目',
                    'playStatus': 'ready',
                    'mixStatus': 'ready',
                    'coverUrl': '/listen/music-covers/${'b' * 64}.jpg'
                  }
                ],
                'coverage': {'indexed': 18, 'total': 42}
              }),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'});
        }));
    final repo = MusicSearchRepository(activity);
    final result = await repo.search('低沉鼓点', 'library');
    expect(result.semanticStatus, 'semantic');
    expect(result.covered, 18);
    expect(result.total, 42);
    expect(result.hits.single.isLibrary, true);
    expect(result.hits.single.playable, true);
    expect(result.hits.single.coverUrl,
        startsWith('https://example.test/listen/music-covers/'));
  });
  test('discovery cannot be played and rejects arbitrary cover locations',
      () async {
    final repo = MusicSearchRepository(ActivityRepository(
        credentials: MemoryActivityCredentials()..value = 't' * 48,
        baseUri: Uri.parse('https://example.test'),
        client: MockClient((r) async => http.Response(
            jsonEncode({
              'results': [
                {
                  'discoveryId': 'opaque-1',
                  'title': '外部发现',
                  'coverUrl': 'https://other.test/a.jpg',
                  'playStatus': 'ready'
                }
              ]
            }),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'}))));
    final hit = (await repo.search('hiphop', 'discover')).hits.single;
    expect(hit.playable, false);
    expect(hit.trackId, isNull);
    expect(hit.coverUrl, isNull);
  });
  test(
      'ready playback remains separate from mix-ready and download uses opaque candidate',
      () async {
    final repo = MusicSearchRepository(ActivityRepository(
        credentials: MemoryActivityCredentials()..value = 't' * 48,
        baseUri: Uri.parse('https://example.test'),
        client: MockClient((r) async {
          expect(jsonDecode(r.body),
              {'candidateId': 'candidate-private', 'style': 'Hip-Hop'});
          return http.Response(
              jsonEncode({
                'id': 'job1',
                'title': '真实导入',
                'status': 'ready_playback',
                'trackId': 'track-${'a' * 20}'
              }),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'});
        })));
    final job = await repo.download(
        const MusicDownloadCandidate(
            candidateId: 'candidate-private', title: '真实导入'),
        'Hip-Hop');
    expect(job.playable, true);
    expect(job.mixReady, false);
    expect(job.terminal, true);
  });
}
