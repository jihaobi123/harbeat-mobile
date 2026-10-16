import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/app.dart';
import 'package:harbeat/src/controller.dart';
import 'package:harbeat/src/theme.dart';
import 'vinyl_playlist_test.dart' show fixture;

final _png = base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSnc'
    'AAAAFElEQVR4nGOUW7CFARtgwio6aCUAJK0BgthlzKYAAAAASUVORK5CYII=');

class _Client extends Fake implements HttpClient {
  final urls = <Uri>[];
  @override
  Future<HttpClientRequest> getUrl(Uri url) async {
    urls.add(url);
    return _Request(url.path.endsWith('missing.png') ? 404 : 200);
  }
}

class _Request extends Fake implements HttpClientRequest {
  _Request(this.status);
  final int status;
  @override
  Future<HttpClientResponse> close() async => _Response(status);
}

class _Response extends Stream<List<int>> implements HttpClientResponse {
  _Response(this.statusCode);
  @override
  final int statusCode;
  @override
  int get contentLength => _png.length;
  @override
  HttpClientResponseCompressionState get compressionState =>
      HttpClientResponseCompressionState.notCompressed;
  @override
  StreamSubscription<List<int>> listen(void Function(List<int>)? onData,
          {Function? onError, void Function()? onDone, bool? cancelOnError}) =>
      Stream<List<int>>.value(_png).listen(onData,
          onError: onError, onDone: onDone, cancelOnError: cancelOnError);
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  late _Client client;
  setUp(() {
    client = _Client();
    PaintingBinding.instance.imageCache.clear();
    PaintingBinding.instance.imageCache.clearLiveImages();
  });
  Future<void> withImages(Future<void> Function() body) async {
    debugNetworkImageHttpClientProvider = () => client;
    try {
      await body();
    } finally {
      debugNetworkImageHttpClientProvider = null;
    }
  }

  Widget artwork(String? url) => MaterialApp(
      home: Center(
          child: SizedBox(
              width: 160,
              height: 160,
              child: TrackArtwork(url: url, fallback: const Text('原有唱片图案')))));

  testWidgets(
      'absent or non-web covers retain the graphic without a request',
      (tester) => withImages(() async {
            for (final url in [
              null,
              '',
              '/mnt/nas/cover.jpg',
              'file:///cover.jpg'
            ]) {
              await tester.pumpWidget(artwork(url));
              expect(find.text('原有唱片图案'), findsOneWidget);
              expect(client.urls, isEmpty);
            }
          }));

  testWidgets(
      'a new failed cover cannot retain the previous song image',
      (tester) => withImages(() async {
            await tester.pumpWidget(artwork('https://covers.test/one.png'));
            await tester.runAsync(() async =>
                Future<void>.delayed(const Duration(milliseconds: 80)));
            await tester.pumpAndSettle();
            expect(tester.widget<RawImage>(find.byType(RawImage)).image,
                isNotNull);
            expect(find.text('原有唱片图案'), findsNothing);
            await tester.pumpWidget(artwork('https://covers.test/missing.png'));
            await tester.pumpAndSettle();
            expect(find.text('原有唱片图案'), findsOneWidget);
            expect(find.byType(RawImage), findsNothing);
            expect(tester.takeException(), isNull);
          }));

  testWidgets(
      'vinyl label follows selection while playback and rotation work',
      (tester) => withImages(() async {
            final c = await fixture(tester);
            c.tracks = c.tracks
                .map((t) => t.withCoverUrl('https://covers.test/${t.id}.png'))
                .toList();
            final first = c.tracks.firstWhere((t) => t.id == 'electric');
            final second = c.tracks.firstWhere((t) => t.id == 'lock');
            await tester.pumpWidget(MaterialApp(
                theme: HB.theme, home: PlaylistDetail(c: c, playlistIndex: 0)));
            await tester.runAsync(() async =>
                Future<void>.delayed(const Duration(milliseconds: 80)));
            await tester.pumpAndSettle();
            Finder disc() => find.byKey(const ValueKey('vinyl-rotation'));
            String? label() => tester
                .widget<TrackArtwork>(find.descendant(
                    of: disc(), matching: find.byType(TrackArtwork)))
                .url;
            expect(label(), first.coverUrl);
            await tester.tap(find.byTooltip('播放 · ${second.title}'));
            await tester.pump(const Duration(milliseconds: 400));
            expect(c.nowPlaying?.id, second.id);
            expect(label(), second.coverUrl);
            final angle = tester.widget<RotationTransition>(disc()).turns.value;
            await tester.pump(const Duration(milliseconds: 500));
            expect(tester.widget<RotationTransition>(disc()).turns.value,
                isNot(angle));
            await tester.tap(find.byTooltip('暂停 · ${second.title}'));
            await tester.pumpAndSettle();
            expect(c.isPlaying, isFalse);
            expect(tester.takeException(), isNull);
            await tester.pumpWidget(const SizedBox());
            c.dispose();
          }));

  testWidgets(
      'cover updates refresh the player without replacing its audio',
      (tester) => withImages(() async {
            final c = await fixture(tester);
            final original = c.tracks.first;
            c.nowPlaying = original;
            final changed =
                original.withCoverUrl('https://covers.test/new.png');
            c.tracks = [changed, ...c.tracks.skip(1)];
            expect(c.displayTrack?.coverUrl, changed.coverUrl);
            expect(identical(c.nowPlaying, original), isTrue);
            expect(changed.previewUrl, original.previewUrl);
            expect(changed.analysisRunId, original.analysisRunId);
            expect(identical(changed.analysis, original.analysis), isTrue);
            expect(changed.durationMs, original.durationMs);
            c.dispose();
          }));
}
