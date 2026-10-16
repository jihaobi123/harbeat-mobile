import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/nas_repository.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

Map<String, dynamic> seed() =>
    jsonDecode(File('assets/nas/catalog.json').readAsStringSync())
        as Map<String, dynamic>;
Map<String, dynamic> art(Map<String, dynamic> report, String image,
        {bool hashOnly = false, String? audioSha}) =>
    {
      'schema': 'harbeat.mobile-artwork.v1',
      'tracks': [
        {
          'catalog_track_id':
              hashOnly ? null : report['audio']['catalog_track_id'],
          'audio_sha256': audioSha ?? report['audio']['sha256'],
          'cover_sha256': image,
          'artist': 'Artist from artwork',
          'url': 'https://untrusted.test/ignored.jpg',
        }
      ],
    };

void main() {
  test('live artwork updates pinned and cached reports without changing audio',
      () async {
    final data = seed();
    final pinned = data['featured_reports'][0] as Map<String, dynamic>;
    data['artwork'] = art(pinned, 'a' * 64);
    final newer = jsonDecode(jsonEncode(pinned)) as Map<String, dynamic>;
    newer['id'] = 'f' * 64;
    newer['created_at'] = '2100-01-01';
    final calls = <String>[];
    final repo = NasCatalogRepository(
        baseUri: Uri.parse('http://127.0.0.1:8765'),
        snapshotLoader: () async => jsonEncode(data),
        client: MockClient((r) async {
          expect(r.headers.containsKey('authorization'), isFalse);
          expect(r.followRedirects, isFalse);
          calls.add(r.url.path);
          final Object response = r.url.path.endsWith('/catalog.json')
              ? art(pinned, 'b' * 64)
              : r.url.path.endsWith('/reports')
                  ? [newer, ...data['reports'] as List]
                  : pinned;
          return http.Response.bytes(utf8.encode(jsonEncode(response)), 200);
        }));
    addTearDown(repo.close);
    final id = data['featured_ids'][0];
    final original = (await repo.bootstrap()).singleWhere((t) => t.id == id);
    expect(original.coverUrl, endsWith('/${'a' * 64}.jpg'));
    final refreshed = (await repo.refresh()).singleWhere((t) => t.id == id);
    expect(refreshed.coverUrl,
        'http://127.0.0.1:8765${NasCatalogRepository.artworkPath}/${'b' * 64}.jpg');
    expect(refreshed.previewUrl, original.previewUrl);
    expect(refreshed.analysisRunId, original.analysisRunId);
    expect(refreshed.artist, original.artist);
    expect((await repo.detail(original)).coverUrl, refreshed.coverUrl);
    expect((await repo.detail(original, force: true)).coverUrl,
        refreshed.coverUrl);
    expect(calls.where((p) => p.endsWith('/reports')), hasLength(1));
  });

  test('artwork outage retains covers and never blocks catalog refresh',
      () async {
    final data = seed();
    final report = data['featured_reports'][0] as Map<String, dynamic>;
    data['artwork'] = art(report, 'a' * 64);
    final repo = NasCatalogRepository(
        snapshotLoader: () async => jsonEncode(data),
        client: MockClient((r) async => r.url.path.endsWith('/catalog.json')
            ? http.Response('', 503)
            : http.Response.bytes(
                utf8.encode(jsonEncode(data['reports'])), 200)));
    addTearDown(repo.close);
    await repo.bootstrap();
    final items = await repo.refresh();
    expect(items.singleWhere((t) => t.id == data['featured_ids'][0]).coverUrl,
        endsWith('/${'a' * 64}.jpg'));
  });

  testWidgets('a stalled artwork connection times out before catalog refresh',
      (tester) async {
    final data = seed();
    final pending = Completer<http.Response>();
    final repo = NasCatalogRepository(
        snapshotLoader: () async => jsonEncode(data),
        client: MockClient((r) async => r.url.path.endsWith('/catalog.json')
            ? await pending.future
            : http.Response.bytes(
                utf8.encode(jsonEncode(data['reports'])), 200)));
    addTearDown(repo.close);
    final original = await repo.bootstrap();
    final refreshed = repo.refresh();
    await tester.pump();
    await tester.pump(const Duration(seconds: 11));
    final tracks = await refreshed;
    expect(tracks.length, original.length);
    expect(tracks.where((t) => t.coverUrl != null).length,
        original.where((t) => t.coverUrl != null).length);
    pending.complete(http.Response('', 503));
    await tester.pump();
  });

  test(
      'cover association requires a full matching audio hash and safe image ID',
      () async {
    for (final mutation in ['wrong-audio', 'invalid-image', 'hash-only']) {
      final data = seed();
      final report = data['featured_reports'][0] as Map<String, dynamic>;
      data['artwork'] = art(
          report, mutation == 'invalid-image' ? '../private' : 'a' * 64,
          hashOnly: mutation == 'hash-only',
          audioSha: mutation == 'wrong-audio' ? '0' * 64 : null);
      final repo =
          NasCatalogRepository(snapshotLoader: () async => jsonEncode(data));
      addTearDown(repo.close);
      final track = (await repo.bootstrap())
          .singleWhere((t) => t.id == data['featured_ids'][0]);
      expect(track.coverUrl, mutation == 'hash-only' ? isNotNull : isNull);
    }
  });
}
