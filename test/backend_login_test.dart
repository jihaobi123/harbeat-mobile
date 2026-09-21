import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/app.dart';
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
  test(
      'login posts JSON, preserves password whitespace and keeps token in memory',
      () async {
    final repo = RemoteHarBeatRepository(
        BackendConfig('https://music.test/api', token: 'previous-token'),
        client: MockClient((request) async {
      expect(request.method, 'POST');
      expect(request.url.toString(), 'https://music.test/api/auth/login');
      expect(request.followRedirects, isFalse);
      expect(request.headers['Authorization'], isNull);
      expect(
          jsonDecode(request.body), {'username': 'dancer', 'password': ' 密码 '});
      return reply({'access_token': 'session-token', 'token_type': 'bearer'});
    }));
    addTearDown(repo.close);
    final session = await repo.login(' dancer ', ' 密码 ');
    expect(session.token, 'session-token');
    expect(session.scope, repo.config.scope);
    expect(session.toJson(), {'url': 'https://music.test', 'api': 'legacy'});
  });

  test('empty fields and v2 never send a guessed login request', () async {
    var calls = 0;
    for (final api in BackendApi.values) {
      final repo =
          RemoteHarBeatRepository(BackendConfig('https://music.test', api: api),
              client: MockClient((r) async {
        calls++;
        return reply({});
      }));
      await expectLater(
          repo.login('', 'password'), throwsA(isA<BackendException>()));
      await expectLater(
          repo.login('user', ''), throwsA(isA<BackendException>()));
      if (api == BackendApi.v2) {
        await expectLater(
            repo.login('user', 'password'), throwsA(isA<BackendException>()));
      }
      repo.close();
    }
    expect(calls, 0);
  });

  test('rejected, redirected, or malformed logins never produce a session',
      () async {
    for (final response in [
      http.Response('private server details', 401),
      http.Response('private server details', 500),
      http.Response('', 307, headers: {'location': 'https://other.test/login'}),
      reply({'access_token': ''}),
      reply({'access_token': 123}),
      reply({'access_token': 'secret', 'token_type': 'basic'}),
    ]) {
      final repo = RemoteHarBeatRepository(BackendConfig('https://music.test'),
          client: MockClient((request) async {
        expect(request.followRedirects, isFalse);
        return response;
      }));
      await expectLater(
          repo.login('dancer', 'password'),
          throwsA(isA<BackendException>().having((e) => e.message,
              'safe message', isNot(contains('private server details')))));
      repo.close();
    }
  });

  test(
      'failed login preserves catalog; session restores separately from preferences',
      () async {
    var accept = false;
    final store = MemoryLocalStore();
    final sessions = MemorySessionStore();
    RemoteHarBeatRepository factory(BackendConfig config) =>
        RemoteHarBeatRepository(config, client: MockClient((request) async {
          if (request.url.path == '/api/auth/login') {
            return accept
                ? reply({'access_token': 'session-secret'})
                : http.Response('', 401);
          }
          if (request.headers['Authorization'] != 'Bearer session-secret') {
            return http.Response('', 401);
          }
          if (request.url.path == '/api/auth/me') {
            return reply({'id': 10, 'username': 'dancer'});
          }
          return reply({
            'songs': [
              {'id': 'song-a', 'title': 'Real fixture', 'file_size': 4096}
            ]
          });
        }));
    final c = AppController(MockHarBeatRepository(),
        audio: MemoryAudioService(),
        localStore: store,
        sessionStore: sessions,
        backendFactory: factory);
    addTearDown(c.dispose);
    await c.initialize();
    final previous = c.tracks.map((t) => t.id).toList();
    await expectLater(
        c.loginBackend(BackendConfig('https://music.test'),
            username: 'dancer', password: 'private-password'),
        throwsA(isA<BackendException>()));
    expect(c.isRemoteMode, isFalse);
    expect(c.tracks.map((t) => t.id), previous);
    accept = true;
    await c.loginBackend(BackendConfig('https://music.test'),
        username: 'dancer', password: 'private-password');
    expect(c.catalogError, isNull);
    expect(c.catalogTracks.single.backendId, 'song-a');
    expect(jsonEncode(store.value), isNot(contains('private-password')));
    expect(jsonEncode(store.value), isNot(contains('session-secret')));
    final restored = AppController(MockHarBeatRepository(),
        audio: MemoryAudioService(),
        localStore: store,
        sessionStore: sessions,
        backendFactory: factory);
    addTearDown(restored.dispose);
    await restored.initialize();
    expect(restored.isRemoteMode, isTrue);
    expect(restored.remoteRepository!.config.token, 'session-secret');
    expect(restored.cloudTracks.single.backendId, 'song-a');
    expect(restored.accountName, 'dancer');
    await restored.logoutBackend();
    expect(sessions.value, isNull);
    expect(restored.hasBackendSession, isFalse);
    expect(restored.cloudTracks, isEmpty);
  });

  testWidgets(
      'phone login uses default gateway and clears the password after success',
      (tester) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final c = AppController(MockHarBeatRepository(),
        audio: MemoryAudioService(),
        localStore: MemoryLocalStore(),
        sessionStore: MemorySessionStore(),
        backendFactory: (config) =>
            RemoteHarBeatRepository(config, client: MockClient((request) async {
              expect(request.url.host,
                  Uri.parse(BackendConfig.defaultAddress).host);
              if (request.method == 'POST') {
                expect(jsonDecode(request.body),
                    {'username': 'fixture', 'password': 'test-password'});
                return reply({'access_token': 'fixture-session'});
              }
              expect(
                  request.headers['Authorization'], 'Bearer fixture-session');
              return reply({'songs': []});
            })));
    addTearDown(c.dispose);
    await tester.runAsync(c.initialize);
    await tester.pumpWidget(MaterialApp(home: BackendScreen(c)));
    await tester.enterText(
        find.byKey(const ValueKey('backend-username')), 'fixture');
    await tester.enterText(
        find.byKey(const ValueKey('backend-password')), 'test-password');
    await tester.ensureVisible(find.text('登录并加载曲库'));
    await tester.tap(find.text('登录并加载曲库'));
    await tester.pumpAndSettle();
    expect(find.text('已连接 · 加载 0 首歌曲'), findsOneWidget);
    expect(
        tester
            .widget<TextField>(find.byKey(const ValueKey('backend-password')))
            .controller!
            .text,
        isEmpty);
    expect(find.text('打开在线曲库'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
