import 'dart:async';
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
    http.Response(jsonEncode({'code': 0, 'data': data}), 200);

void main() {
  test('registration follows the legacy contract without forwarding a session',
      () async {
    final repo = RemoteHarBeatRepository(
        BackendConfig('https://music.test', token: 'old-session'),
        client: MockClient((request) async {
      expect(request.method, 'POST');
      expect(request.url.path, '/api/auth/register');
      expect(request.followRedirects, isFalse);
      expect(request.headers['Authorization'], isNull);
      expect(jsonDecode(request.body), {
        'username': '新用户',
        'password': ' 新密码 ',
        'dance_style': 'hiphop',
        'level': 'beginner',
        'favorite_style': 'hiphop',
      });
      return reply({'access_token': 'new-session', 'token_type': 'bearer'});
    }));
    addTearDown(repo.close);
    final session = await repo.register(' 新用户 ', ' 新密码 ');
    expect(session.token, 'new-session');
    expect(session.toJson(), {'url': 'https://music.test', 'api': 'legacy'});
  });

  test(
      'duplicate, validation and uncertain registration failures are actionable',
      () async {
    for (final entry in [
      (http.Response('private detail', 409), '已被注册'),
      (http.Response('private detail', 422), '注册信息'),
      (http.Response('', 404), '注册接口'),
      (http.Response('', 500), '先尝试登录'),
      (http.Response('invalid json', 200), '先尝试登录'),
      (reply({'access_token': ''}), '账号可能已创建'),
    ]) {
      final repo = RemoteHarBeatRepository(BackendConfig('https://music.test'),
          client: MockClient((_) async => entry.$1));
      await expectLater(
          repo.register('new-user', 'password'),
          throwsA(isA<BackendException>()
              .having((e) => e.message, 'message', contains(entry.$2))));
      repo.close();
    }
    final repo = RemoteHarBeatRepository(BackendConfig('https://music.test'),
        client:
            MockClient((_) async => throw TimeoutException('private detail')));
    addTearDown(repo.close);
    await expectLater(
        repo.register('new-user', 'password'),
        throwsA(isA<BackendException>()
            .having((e) => e.message, 'uncertain', contains('先尝试登录'))));
  });

  test(
      'empty or v2 registration never sends a request; rejection preserves catalog',
      () async {
    var calls = 0;
    for (final api in BackendApi.values) {
      final repo =
          RemoteHarBeatRepository(BackendConfig('https://music.test', api: api),
              client: MockClient((_) async {
        calls++;
        return reply({});
      }));
      await expectLater(
          repo.register(' ', 'password'), throwsA(isA<BackendException>()));
      await expectLater(
          repo.register('user', ''), throwsA(isA<BackendException>()));
      if (api == BackendApi.v2) {
        await expectLater(repo.register('user', 'password'),
            throwsA(isA<BackendException>()));
      }
      repo.close();
    }
    expect(calls, 0);
    final c = AppController(MockHarBeatRepository(),
        audio: MemoryAudioService(),
        localStore: MemoryLocalStore(),
        backendFactory: (config) => RemoteHarBeatRepository(config,
            client: MockClient((_) async => http.Response('', 409))));
    addTearDown(c.dispose);
    await c.initialize();
    final previous = c.tracks.map((t) => t.id).toList();
    await expectLater(
        c.createBackendAccount(BackendConfig('https://music.test'),
            username: 'new-user', password: 'password'),
        throwsA(isA<BackendException>()));
    expect(c.isRemoteMode, isFalse);
    expect(c.tracks.map((t) => t.id), previous);
  });

  for (final catalogFails in [false, true]) {
    testWidgets(
        'phone registers once, validates confirmation and handles catalog failure=$catalogFails',
        (tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final store = MemoryLocalStore();
      final registration = Completer<http.Response>();
      var posts = 0;
      final c = AppController(MockHarBeatRepository(),
          audio: MemoryAudioService(),
          localStore: store,
          sessionStore: MemorySessionStore(),
          backendFactory: (config) => RemoteHarBeatRepository(config,
                  client: MockClient((request) async {
                if (request.method == 'POST') {
                  expect(request.url.path, '/api/auth/register');
                  posts++;
                  return registration.future;
                }
                expect(request.headers['Authorization'],
                    'Bearer registered-session');
                return catalogFails
                    ? http.Response('', 503)
                    : reply({'songs': []});
              })));
      addTearDown(c.dispose);
      await tester.runAsync(c.initialize);
      await tester.pumpWidget(MaterialApp(home: BackendScreen(c)));
      await tester.tap(find.byKey(const ValueKey('backend-auth-mode')));
      await tester.pumpAndSettle();
      expect(find.text('注册账号'), findsOneWidget);
      await tester.enterText(
          find.byKey(const ValueKey('backend-username')), 'new-user');
      await tester.enterText(
          find.byKey(const ValueKey('backend-password')), 'private-password');
      await tester.enterText(
          find.byKey(const ValueKey('backend-confirm-password')), 'different');
      await tester.scrollUntilVisible(find.text('注册并进入曲库'), 180,
          scrollable: find.byType(Scrollable).first);
      await tester.tap(find.text('注册并进入曲库'));
      await tester.pumpAndSettle();
      expect(find.text('两次输入的密码不一致，请检查。'), findsOneWidget);
      expect(posts, 0);
      await tester.enterText(
          find.byKey(const ValueKey('backend-confirm-password')),
          'private-password');
      await tester.ensureVisible(find.text('注册并进入曲库'));
      await tester.tap(find.text('注册并进入曲库'));
      await tester
          .tap(find.text('注册并进入曲库')); // Guard repeated taps before rebuild.
      await tester.pump();
      expect(posts, 1);
      registration.complete(reply({'access_token': 'registered-session'}));
      await tester.pumpAndSettle();
      expect(find.text('登录并加载曲库'), findsOneWidget);
      expect(
          find.byKey(const ValueKey('backend-confirm-password')), findsNothing);
      expect(
          tester
              .widget<TextField>(find.byKey(const ValueKey('backend-password')))
              .controller!
              .text,
          isEmpty);
      expect(
          find.text(catalogFails
              ? '注册成功。曲库暂时加载失败，可打开在线曲库重试。'
              : '注册成功 · 已自动登录。当前账号的云端曲库暂无歌曲。'),
          findsOneWidget);
      expect(c.remoteRepository!.config.token, 'registered-session');
      expect(c.catalogTracks, isEmpty);
      expect(jsonEncode(store.value), isNot(contains('registered-session')));
      expect(jsonEncode(store.value), isNot(contains('private-password')));
      expect(tester.takeException(), isNull);
    });
  }
}
