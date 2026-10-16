import 'package:harbeat/src/theme.dart';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:harbeat/src/app.dart';
import 'package:harbeat/src/audio_service.dart';
import 'package:harbeat/src/backend.dart';
import 'package:harbeat/src/controller.dart';
import 'package:harbeat/src/local_store.dart';
import 'package:harbeat/src/nas_repository.dart';
import 'package:harbeat/src/repository.dart';

final snapshot = File('assets/nas/catalog.json').readAsStringSync();
Map<String, dynamic> fixture() => jsonDecode(snapshot) as Map<String, dynamic>;
Map<String, dynamic> legacy() =>
    jsonDecode(File('test/fixtures/nas_legacy.json').readAsStringSync())
        as Map<String, dynamic>;
NasCatalogRepository repo(
        {String? seed,
        Future<http.Response> Function(http.Request)? handler}) =>
    NasCatalogRepository(
        snapshotLoader: () async => seed ?? snapshot,
        client: MockClient(handler ??
            (r) async => http.Response.bytes(
                utf8.encode(jsonEncode(fixture()['reports'])), 200)));

class CaptureAudio extends MemoryAudioService {
  String? path;
  Map<String, String>? headers;
  @override
  Future<void> play(
      {String? filePath,
      String title = 'HarBeat Preview',
      Map<String, String>? headers}) async {
    path = filePath;
    this.headers = headers;
  }
}

void main() {
  test(
      'NAS versions collapse into 208 songs; six are pinned to their render reports',
      () async {
    final r = repo();
    addTearDown(r.close);
    final tracks = await r.bootstrap();
    expect(tracks.length, 208);
    expect(tracks.map((t) => t.id).toSet().length, 208);
    expect(r.featuredIds.length, 6);
    for (final id in r.featuredIds) {
      final t = tracks.singleWhere((t) => t.id == id);
      expect(t.canPlay, true);
      expect(t.style, 'Hip-Hop');
      expect(t.previewUrl,
          startsWith('https://8.136.120.255/api/analysis-lab/media/'));
      expect(t.analysis['vocal_activity']['status'], 'ready');
    }
    final refreshed = await r.refresh();
    expect(refreshed.length, 208);
    expect(
        refreshed.singleWhere((t) => t.id == r.featuredIds.first).analysisRunId,
        tracks.singleWhere((t) => t.id == r.featuredIds.first).analysisRunId);
  });

  test(
      'public report fetch never sends account credentials or follows redirects',
      () async {
    var calls = 0;
    final doc = fixture()['featured_reports'][0];
    final r = repo(handler: (request) async {
      calls++;
      expect(request.headers.containsKey('authorization'), false);
      expect(request.followRedirects, false);
      expect(request.url.path, '/api/analysis-lab/reports/${doc['id']}');
      return http.Response(jsonEncode(doc), 200,
          headers: {'content-type': 'application/json; charset=utf-8'});
    });
    addTearDown(r.close);
    final tracks = await r.bootstrap();
    final track = tracks.singleWhere((t) => t.id == r.featuredIds.first);
    expect((await r.detail(track, force: true)).title, 'FREE BRO');
    expect(calls, 1);
  });

  test(
      'mismatched report fails closed; missing or mismatched master is not playable',
      () async {
    for (final mutation in ['identity', 'missing', 'hash', 'vocal']) {
      final doc = fixture()['featured_reports'][0];
      if (mutation == 'identity') {
        doc['audio']['catalog_track_id'] = 'track-00000000000000000000';
      }
      if (mutation == 'missing') {
        doc['audio']['assets']['master']['status'] = 'missing';
      }
      if (mutation == 'hash') {
        doc['audio']['assets']['master']['declared_sha256'] = '0' * 64;
      }
      if (mutation == 'vocal') {
        doc['documents']['vocal_activity']['source']['analysis_run_id'] =
            'wrong-run';
      }
      final r = repo(
          handler: (_) async =>
              http.Response.bytes(utf8.encode(jsonEncode(doc)), 200));
      addTearDown(r.close);
      final tracks = await r.bootstrap();
      final t = tracks.singleWhere((t) => t.id == r.featuredIds.first);
      if (mutation == 'identity') {
        await expectLater(
            r.detail(t, force: true), throwsA(isA<BackendException>()));
      } else {
        final changed = await r.detail(t, force: true);
        if (mutation == 'vocal') {
          expect(changed.analysis.containsKey('vocal_activity'), false);
        } else {
          expect(changed.canPlay, false);
          expect(changed.previewUrl, isNull);
        }
      }
    }
  });

  test('legacy NAS music is playable without inventing unbound timing',
      () async {
    final doc = legacy();
    final r = repo(
        handler: (_) async =>
            http.Response.bytes(utf8.encode(jsonEncode(doc)), 200));
    addTearDown(r.close);
    final tracks = await r.bootstrap();
    final t = tracks
        .singleWhere((t) => t.id == 'nas:${doc['audio']['catalog_track_id']}');
    final full = await r.detail(t, force: true);
    expect(full.canPlay, true);
    expect(full.artist, contains('Bboy beats'));
    expect(full.analysis, isEmpty);
    expect(full.needsReview, true);
  });

  testWidgets(
      'phone creates the six-song playlist, plays NAS/asset sources, and keeps edits',
      (tester) async {
    final store = MemoryLocalStore();
    final audio = CaptureAudio();
    Future<AppController> create() async {
      final c = AppController(MockHarBeatRepository(),
          localStore: store, audio: audio, nasRepository: repo());
      final pending = c.initialize();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      await pending;
      await tester.pump();
      return c;
    }

    final c = await create();
    expect(c.featuredNasTracks.length, 6);
    final playlist =
        c.playlists.singleWhere((p) => p.id == NasCatalogRepository.playlistId);
    expect(playlist.trackIds.length, 6);
    await c.playNasSet(mixed: false);
    expect(audio.path,
        startsWith('https://8.136.120.255/api/analysis-lab/media/'));
    expect(audio.headers, isNull);
    expect(c.queue.length, 6);
    await c.playNasSet(mixed: true);
    expect(audio.path, 'asset:assets/audio/hiphop-six-v3.mp3');
    expect(c.queue.length, 1);
    Uri? opened;
    await c.openRealtimeLab(launcher: (uri) async {
      expect(c.isPlaying, false);
      opened = uri;
      return true;
    });
    expect(opened, NasFlow.realtimeLabUrl);
    expect(c.realtimeLabError, isNull);
    await c.openRealtimeLab(launcher: (_) async => false);
    expect(c.realtimeLabError, contains('未能打开实时混音'));
    await tester.pumpWidget(
        MaterialApp(theme: HB.theme, home: Scaffold(body: MusicScreen(c))));
    await tester.pump();
    await tester.scrollUntilVisible(find.text('HIP-HOP SIX'), 300);
    await tester.tap(find.text('HIP-HOP SIX'));
    await tester.pumpAndSettle();
    expect(find.text('播放 V3 混音'), findsOneWidget);
    expect(find.text('播放六首原曲'), findsOneWidget);
    expect(c.nasTracks.length, 208);
    await tester.scrollUntilVisible(find.text('NAS 推荐曲库'), 250);
    expect(c.nasTracks.length, 208);
    expect(tester.takeException(), isNull);
    c.renamePlaylist(c.playlists.indexOf(playlist), 'MY SIX');
    await tester.pump();
    await tester.pumpWidget(const SizedBox());
    c.dispose();
    final restored = await create();
    addTearDown(restored.dispose);
    expect(restored.playlists.where((p) => p.id == playlist.id).length, 1);
    expect(restored.playlists.singleWhere((p) => p.id == playlist.id).name,
        'MY SIX');
    expect(restored.nowPlaying?.id, NasCatalogRepository.mix.id);
  });
}
