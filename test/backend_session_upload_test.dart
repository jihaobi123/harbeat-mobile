import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/audio_service.dart';
import 'package:harbeat/src/backend.dart';
import 'package:harbeat/src/controller.dart';
import 'package:harbeat/src/local_store.dart';
import 'package:harbeat/src/repository.dart';
import 'package:harbeat/src/session_store.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

http.Response reply(Map<String, dynamic> data) =>
    http.Response(jsonEncode({'code': 0, 'data': data}), 200,
        headers: {'content-type': 'application/json; charset=utf-8'});

void main() {
  test('concurrent 401 requests share one refresh and persist rotated tokens',
      () async {
    var refreshes = 0;
    var protectedCalls = 0;
    final gate = Completer<void>();
    BackendConfig? saved;
    final repo = RemoteHarBeatRepository(
        BackendConfig('https://music.test',
            token: 'old',
            refreshToken: 'renew',
            username: 'qa',
            userId: 10), client: MockClient((r) async {
      if (r.url.path == '/api/auth/refresh') {
        refreshes++;
        expect(r.headers['Authorization'], isNull);
        expect(r.followRedirects, isFalse);
        expect(jsonDecode(r.body), {'refresh_token': 'renew'});
        await gate.future;
        return reply({
          'access_token': 'new',
          'refresh_token': 'rotated',
          'token_type': 'bearer'
        });
      }
      protectedCalls++;
      if (r.headers['Authorization'] == 'Bearer old') {
        return http.Response('', 401);
      }
      expect(r.headers['Authorization'], 'Bearer new');
      return reply({'id': 10, 'username': 'qa'});
    }))
      ..onSessionChanged = (config) async {
        saved = config;
      };
    addTearDown(repo.close);
    final requests = Future.wait([repo.profile(), repo.profile()]);
    await Future<void>.delayed(Duration.zero);
    expect(refreshes, 1);
    gate.complete();
    await requests;
    expect(protectedCalls, 4);
    expect(saved!.refreshToken, 'rotated');
    expect(saved!.username, 'qa');
  });

  test('a second 401 is not retried forever', () async {
    var renewals = 0;
    var reads = 0;
    final repo = RemoteHarBeatRepository(
        BackendConfig('https://music.test', token: 'old', refreshToken: 'r'),
        client: MockClient((r) async {
      if (r.url.path.endsWith('/refresh')) {
        renewals++;
        return reply({'access_token': 'new'});
      }
      reads++;
      return http.Response('', 401);
    }));
    addTearDown(repo.close);
    await expectLater(repo.profile(), throwsA(isA<BackendException>()));
    expect(renewals, 1);
    expect(reads, 2);
  });

  test('expired JWT refreshes before the protected request', () async {
    final expired =
        'header.${base64Url.encode(utf8.encode('{"exp":1}')).replaceAll('=', '')}.signature';
    final paths = <String>[];
    final repo = RemoteHarBeatRepository(
        BackendConfig('https://music.test', token: expired, refreshToken: 'r'),
        client: MockClient((r) async {
      paths.add(r.url.path);
      return reply(r.url.path.endsWith('/refresh')
          ? {'access_token': 'fresh'}
          : {'id': 10, 'username': 'qa'});
    }));
    addTearDown(repo.close);
    await repo.profile();
    expect(paths, ['/api/auth/refresh', '/api/auth/me']);
  });

  test('invalid restored credentials are removed without deleting local state',
      () async {
    final sessions = MemorySessionStore()
      ..value = BackendConfig('https://music.test',
          token: 'expired', username: 'stale');
    final store = MemoryLocalStore();
    await store.write({'backend': sessions.value!.toJson()});
    final c = AppController(MockHarBeatRepository(),
        audio: MemoryAudioService(),
        localStore: store,
        sessionStore: sessions,
        backendFactory: (config) => RemoteHarBeatRepository(config,
            client: MockClient((_) async => http.Response('', 401))));
    addTearDown(c.dispose);
    await c.initialize();
    expect(c.accountName, isNull);
    expect(c.hasBackendSession, isFalse);
    expect(sessions.value, isNull);
  });

  test('saved credentials cannot cross server scope', () async {
    final sessions = MemorySessionStore()
      ..value = BackendConfig('https://a.test', token: 'private');
    expect(await sessions.read(BackendConfig('https://b.test')), isNull);
    expect(
        await sessions
            .read(BackendConfig('https://a.test', api: BackendApi.v2)),
        isNull);
  });

  test('upload checks identity then sends one multipart with progress',
      () async {
    final paths = <String>[];
    var progress = 0;
    final repo = RemoteHarBeatRepository(
        BackendConfig('https://music.test', token: 'access'),
        client: MockClient((r) async {
      paths.add(r.url.path);
      expect(r.headers['Authorization'], 'Bearer access');
      expect(r.followRedirects, isFalse);
      if (r.url.path.endsWith('/me')) {
        return reply({'id': 10, 'username': 'qa'});
      }
      expect(r.method, 'POST');
      expect(r.headers['content-type'],
          startsWith('multipart/form-data; boundary='));
      expect(r.body, contains('filename="qa.wav"'));
      expect(r.body, contains('name="title"\r\n\r\nQA sample'));
      return reply({
        'id': 'uploaded',
        'title': 'QA sample',
        'file_size': 64,
        'analysis_status': 'pending'
      });
    }));
    addTearDown(repo.close);
    final track = await repo.uploadAudio(
        filename: 'qa.wav',
        length: 64,
        bytes: Stream.value(List.filled(64, 65)),
        title: 'QA sample',
        artist: 'QA',
        onProgress: (sent, total) {
          progress = sent;
          expect(total, 64);
        });
    expect(paths, ['/api/auth/me', '/api/library/upload']);
    expect(progress, 64);
    expect(track.backendId, 'uploaded');
    expect(track.analysisLabel, '分析中');
  });

  for (final status in [401, 500, 307]) {
    test('upload $status is never replayed or exposed as raw server error',
        () async {
      var uploads = 0;
      final repo = RemoteHarBeatRepository(
          BackendConfig('https://music.test',
              token: 'access',
              refreshToken: 'refresh'), client: MockClient((r) async {
        if (r.url.path.endsWith('/me')) {
          return reply({'id': 10, 'username': 'qa'});
        }
        expect(r.url.path, '/api/library/upload');
        uploads++;
        return http.Response('private SQL diagnostic', status);
      }));
      addTearDown(repo.close);
      await expectLater(
          repo.uploadAudio(
              filename: 'qa.wav',
              length: 64,
              bytes: Stream.value(List.filled(64, 0)),
              title: 'QA',
              artist: 'QA'),
          throwsA(isA<BackendException>().having(
              (e) => e.message, 'safe message', isNot(contains('SQL')))));
      expect(uploads, 1);
    });
  }
}
