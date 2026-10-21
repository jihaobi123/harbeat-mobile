import 'dart:convert';
import 'dart:async';
import 'package:harbeat/src/backend.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:harbeat/src/activity_repository.dart';

void main() {
  test('backup restoration waits for an in-flight first workspace creation',
      () async {
    final gate = Completer<http.Response>(),
        seen = <String?>[],
        store = MemoryActivityCredentials();
    final repo = ActivityRepository(
        credentials: store,
        baseUri: Uri.parse('https://example.test'),
        client: MockClient((r) async {
          if (r.url.path.endsWith('/workspaces')) return gate.future;
          seen.add(r.headers['authorization']);
          return http.Response('{"reservations":[]}', 200);
        }));
    final original = repo.list();
    await Future<void>.delayed(Duration.zero);
    final imported = repo.importBackup(jsonEncode({
      'schema': 'harbeat.activity-workspace-backup.v1',
      'server': BackendConfig.defaultAddress,
      'token': 'b' * 43
    }));
    gate.complete(http.Response(jsonEncode({'token': 'a' * 43}), 201));
    await original;
    await imported;
    await repo.list();
    expect(seen.last, 'Bearer ${'b' * 43}');
    expect(store.value, 'b' * 43);
  });

  test(
      'workspace credential persists separately and authenticates reservation requests',
      () async {
    final store = MemoryActivityCredentials();
    var created = 0;
    final client = MockClient((r) async {
      if (r.url.path.endsWith('/workspaces')) {
        created++;
        return http.Response(jsonEncode({'token': 't' * 48}), 201);
      }
      expect(r.headers['authorization'], 'Bearer ${'t' * 48}');
      return http.Response('{"reservations":[]}', 200);
    });
    final repo = ActivityRepository(
        client: client,
        credentials: store,
        baseUri: Uri.parse('https://example.test'));
    await repo.list();
    await ActivityRepository(
            client: client,
            credentials: store,
            baseUri: Uri.parse('https://example.test'))
        .list();
    expect(created, 1);
  });
  test('rebooking keeps the original set identity and sends the new time',
      () async {
    final store = MemoryActivityCredentials()..value = 't' * 48;
    final client = MockClient((r) async {
      expect(r.url.path, '/listen/set-api/reservations/${'a' * 32}/reuse');
      expect(jsonDecode(r.body)['startsAt'], startsWith('2026-11-01'));
      return http.Response(
          jsonEncode({
            'id': 'b' * 32,
            'packId': 'c' * 32,
            'name': '再次使用',
            'styles': ['Hip-Hop'],
            'startsAt': '2026-11-01T10:00:00Z',
            'durationMinutes': 60,
            'energy': 3,
            'pack': {'state': 'ready', 'prepared': 8, 'total': 8}
          }),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'});
    });
    final repo = ActivityRepository(
        client: client,
        credentials: store,
        baseUri: Uri.parse('https://example.test'));
    final reservation =
        await repo.reuse('a' * 32, DateTime.utc(2026, 11, 1, 10), 60);
    expect(reservation.packId, 'c' * 32);
  });
  test('expired activities keep their prepared set available', () {
    final r = ActivityReservation.fromJson({
      'id': 'a' * 32,
      'packId': 'b' * 32,
      'name': '旧活动',
      'styles': ['Hip-Hop'],
      'startsAt': '2025-01-01T10:00:00Z',
      'durationMinutes': 60,
      'energy': 3,
      'pack': {'state': 'ready', 'prepared': 4, 'total': 4}
    });
    expect(r.ended, true);
    expect(r.preparationLabel, contains('已准备'));
    expect(r.packId, 'b' * 32);
  });
  test('authentication failure never silently replaces the saved workspace',
      () async {
    final store = MemoryActivityCredentials()..value = 't' * 48;
    var requests = 0;
    final repo = ActivityRepository(
        credentials: store,
        client: MockClient((r) async {
          requests++;
          return http.Response('{"detail":"unauthorized"}', 401);
        }),
        baseUri: Uri.parse('https://example.test'));
    await expectLater(repo.list(), throwsA(isA<ActivityException>()));
    expect(requests, 1);
    expect(store.value, 't' * 48);
  });
}
