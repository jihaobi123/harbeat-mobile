import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/audio_service.dart';
import 'package:harbeat/src/accessory_ble.dart';
import 'package:harbeat/src/mix_planner.dart';
import 'package:harbeat/src/controller.dart';
import 'package:harbeat/src/local_store.dart';
import 'package:harbeat/src/models.dart';
import 'package:harbeat/src/repository.dart';

class FailingAudio extends MemoryAudioService {
  bool fail = false;
  @override
  Future<void> play(
      {String? filePath,
      String title = 'HarBeat Preview',
      Map<String, String>? headers}) async {
    if (fail) throw StateError('bad audio');
  }
}

class CompletionAudio extends MemoryAudioService {
  final endings = StreamController<void>.broadcast();
  @override
  Stream<void> get completed => endings.stream;
  @override
  Future<void> dispose() => endings.close();
}

Future<AppController> ready(WidgetTester tester,
    {AudioService? audio, LocalStore? store}) async {
  final c = AppController(MockHarBeatRepository(),
      localStore: store ?? MemoryLocalStore(),
      audio: audio ?? MemoryAudioService(),
      ble: FakeBle());
  final loaded = c.initialize();
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
  await loaded;
  addTearDown(c.dispose);
  return c;
}

void main() {
  testWidgets(
      'mixing a missing local file cannot silently use the preview asset',
      (tester) async {
    final audio = FakeNativeMix();
    final c = await ready(tester, audio: audio);
    await c.togglePlayback();
    final original = c.nowPlaying!;
    final missing = Track(
        id: 'local:missing.wav',
        title: 'Missing',
        artist: 'QA',
        style: 'Local',
        bpm: null,
        energy: null,
        reason: '',
        color: original.color);
    c.tracks = [...c.tracks, missing];
    c.setQueue([original.id, missing.id]);
    await c.nextTrack();
    await tester.pump();
    expect(audio.pending, isNull);
    expect(c.nowPlaying, original);
    expect(c.pendingIntent, isNull);
    expect(c.intentFeedback, contains('文件不可访问'));
  });
  testWidgets('native intent commits only when the audio engine completes',
      (tester) async {
    final audio = FakeNativeMix();
    final c = await ready(tester, audio: audio);
    await c.togglePlayback();
    final original = c.nowPlaying;
    await c.requestDirection(targetEnergy: 5, targetStyle: 'Funk');
    await tester.pump();
    expect(c.nowPlaying, original);
    expect(c.pendingIntent, isNotNull);
    audio.finish(true);
    await tester.pump();
    expect(c.nowPlaying!.mixStyle, 'Funk');
    expect(c.energy, 5);
    expect(c.pendingIntent, isNull);
  });
  testWidgets('pause cancels a native mix without applying its stale result',
      (tester) async {
    final audio = FakeNativeMix();
    final c = await ready(tester, audio: audio);
    await c.togglePlayback();
    final original = c.nowPlaying;
    await c.requestDirection(targetEnergy: 5, targetStyle: 'Funk');
    await tester.pump();
    await c.togglePlayback();
    await tester.pump();
    expect(c.nowPlaying, original);
    expect(c.pendingIntent, isNull);
    expect(c.isPlaying, isFalse);
  });
  testWidgets(
      'cancelled queue mix keeps its position and ignores repeated next',
      (tester) async {
    final audio = FakeNativeMix();
    final c = await ready(tester, audio: audio);
    final songs = c.tracks.where((t) => t.canPlay).take(3).toList();
    c.setQueue(songs.map((t) => t.id).toList());
    await c.play(songs.first);
    await c.nextTrack();
    await tester.pump();
    expect(c.queueIndex, 0);
    expect(c.pendingIntent!.direction.trackId, songs[1].id);
    await c.nextTrack();
    expect(c.pendingIntent!.direction.trackId, songs[1].id);
    c.cancelDirection();
    await tester.pump();
    expect(c.queueIndex, 0);
    await c.nextTrack();
    await tester.pump();
    expect(c.pendingIntent!.direction.trackId, songs[1].id);
    c.cancelDirection();
    await tester.pump();
  });
  testWidgets('manual queue mix continues the queue after EOF', (tester) async {
    final audio = FakeNativeMix();
    final c = await ready(tester, audio: audio);
    final songs = c.tracks.where((t) => t.canPlay).take(3).toList();
    c.setQueue(songs.map((t) => t.id).toList());
    await c.play(songs.first);
    await c.nextTrack();
    await tester.pump();
    audio.finish(true);
    await tester.pump();
    expect(c.nowPlaying!.id, songs[1].id);
    expect(c.queueIndex, 1);
    expect(c.previousDirection, isNull);
    audio.endings.add(null);
    await tester.pump();
    expect(c.nowPlaying!.id, songs[2].id);
    expect(c.queueIndex, 2);
  });
  testWidgets(
      'EOF while preloading cancels native intent and starts its requested track',
      (tester) async {
    final audio = FakeNativeMix();
    final c = await ready(tester, audio: audio);
    await c.togglePlayback();
    await c.requestDirection(targetEnergy: 5, targetStyle: 'Funk');
    await tester.pump();
    audio.endings.add(null);
    await tester.pump();
    expect(c.pendingIntent, isNull);
    expect(c.nowPlaying!.mixStyle, 'Funk');
    expect(c.isPlaying, isTrue);
    expect(c.intentFeedback, isNot(contains('继续当前音乐')));
  });
  testWidgets('automatic continuation preserves confirmed energy and recovery',
      (tester) async {
    final audio = CompletionAudio();
    final c = await ready(tester, audio: audio);
    await c.togglePlayback();
    await c.requestDirection(targetEnergy: 1, targetStyle: 'Funk');
    await tester.pump(const Duration(seconds: 4));
    final history = c.previousDirection;
    audio.endings.add(null);
    await tester.pump();
    expect(c.energy, 1);
    expect(c.mixStyle, 'Funk');
    expect(c.nowPlaying!.mixStyle, 'Funk');
    expect(c.previousDirection, history);
  });
  testWidgets(
      'draft is not applied until confirmed; scheduled change can be cancelled',
      (tester) async {
    final c = await ready(tester);
    await c.togglePlayback();
    final initial = c.nowPlaying!.id;
    c.editDirection(energy: 5, style: 'Funk');
    expect(c.energy, 3);
    await c.requestDirection();
    expect(c.pendingIntent, isNotNull);
    expect(c.nowPlaying!.id, initial);
    c.cancelDirection();
    await tester.pump(const Duration(seconds: 5));
    expect(c.nowPlaying!.id, initial);
    expect(c.isPlaying, isTrue);
    expect(c.draftEnergy, c.energy);
  });

  testWidgets('applied direction and restore follow the same scheduler',
      (tester) async {
    final c = await ready(tester);
    await c.togglePlayback();
    final original = c.nowPlaying!.id;
    await c.requestDirection(targetEnergy: 5, targetStyle: 'Funk');
    await tester.pump(const Duration(seconds: 4));
    expect(c.pendingIntent, isNull);
    expect(c.energy, 5);
    expect(c.mixStyle, 'Funk');
    expect(c.previousDirection!.trackId, original);
    await c.restoreDirection();
    expect(c.pendingIntent, isNotNull);
    await tester.pump(const Duration(seconds: 4));
    expect(c.nowPlaying!.id, original);
    expect(c.previousDirection, isNull);
  });

  testWidgets(
      'pause cancels pending actions and no-match leaves current audio alone',
      (tester) async {
    final c = await ready(tester);
    await c.togglePlayback();
    final original = c.nowPlaying;
    await c.requestDirection(targetEnergy: 5, targetStyle: 'House');
    await c.togglePlayback();
    await tester.pump(const Duration(seconds: 5));
    expect(c.pendingIntent, isNull);
    expect(c.nowPlaying, original);
    expect(c.isPlaying, isFalse);
    c.setNoMatchSimulation(true);
    await c.requestDirection(targetEnergy: 5, targetStyle: 'House');
    expect(c.nowPlaying, original);
    expect(c.intentFeedback, contains('没有匹配'));
  });

  testWidgets('metadata/unavailable tracks cannot play or enter audio queue',
      (tester) async {
    final c = await ready(tester);
    await c.togglePlayback();
    final original = c.nowPlaying;
    await c.play(c.tracks.firstWhere((t) => t.id == 'midnight'));
    expect(c.nowPlaying, original);
    c.setQueue(['midnight', 'concrete', 'electric', 'electric']);
    expect(c.queue, ['electric']);
    c.setSearchQuery('104');
    expect(c.searchResults.single.id, 'electric');
  });

  testWidgets('loop blocks direction requests until ended', (tester) async {
    final c = await ready(tester);
    await c.togglePlayback();
    await c.togglePracticeLoop();
    expect(c.loopPreview, isTrue);
    await c.requestDirection(targetEnergy: 4, targetStyle: 'Funk');
    expect(c.pendingIntent, isNull);
    expect(c.intentFeedback, contains('先结束循环'));
    await c.togglePracticeLoop();
    await c.requestDirection(targetEnergy: 4, targetStyle: 'Funk');
    expect(c.pendingIntent, isNotNull);
    c.cancelDirection();
  });

  testWidgets(
      'accessory lock, disconnect and cancelled discovery preserve playback',
      (tester) async {
    final c = await ready(tester);
    await c.togglePlayback();
    c.discoverAccessory();
    c.cancelDiscovery();
    await tester.pump(const Duration(seconds: 2));
    expect(c.accessoryConnected, isFalse);
    c.discoverAccessory();
    await tester.pump(const Duration(seconds: 2));
    expect(c.accessoryStatus, AccessoryStatus.confirming);
    (c.ble as FakeBle).confirm();
    c.setShortcut(AccessoryGesture.single, ShortcutAction.nextStyle);
    c.toggleAccessoryLock();
    await c.handleGesture(AccessoryGesture.single);
    expect(c.pendingIntent, isNull);
    c.toggleAccessoryLock();
    await c.handleGesture(AccessoryGesture.single);
    expect(c.pendingIntent!.source, '戒指');
    c.disconnectAccessory();
    expect(c.isPlaying, isTrue);
    expect(c.pendingIntent, isNull);
    await tester.pump(const Duration(seconds: 5));
    expect(c.energy, 3);
  });

  testWidgets(
      'configuration persists but connection and pending requests do not',
      (tester) async {
    final store = MemoryLocalStore();
    final c = await ready(tester, store: store);
    c.setAccessoryKind(AccessoryKind.band);
    c.setShortcut(AccessoryGesture.hold, ShortcutAction.playback);
    c.toggleAccessoryLock();
    await c.requestDirection(targetEnergy: 4, targetStyle: 'Funk');
    final restored = await ready(tester, store: store);
    expect(restored.energy, 4);
    expect(restored.mixStyle, 'Funk');
    expect(restored.accessoryKind, AccessoryKind.band);
    expect(restored.shortcutMapping[AccessoryGesture.hold],
        ShortcutAction.playback);
    expect(restored.accessoryLocked, isTrue);
    expect(restored.accessoryConnected, isFalse);
    expect(restored.pendingIntent, isNull);
    expect(restored.isPlaying, isFalse);
  });

  testWidgets('failed audio never commits a requested direction',
      (tester) async {
    final audio = FailingAudio();
    final c = await ready(tester, audio: audio);
    await c.togglePlayback();
    final original = c.nowPlaying;
    audio.fail = true;
    await c.requestDirection(targetEnergy: 5, targetStyle: 'House');
    await tester.pump(const Duration(seconds: 4));
    expect(c.energy, 3);
    expect(c.nowPlaying, original);
    expect(c.clientIssue, isNotNull);
    expect(c.pendingIntent, isNull);
  });
}

// Explicit test double. The application always uses the real BLE implementation.
class FakeBle extends AccessoryBle {
  Timer? timer;
  @override
  Future<void> scan() async {
    status = AccessoryStatus.discovering;
    changed();
    timer = Timer(const Duration(milliseconds: 1200), () {
      status = AccessoryStatus.confirming;
      changed();
    });
  }

  void confirm() {
    status = AccessoryStatus.connected;
    changed();
  }

  @override
  void stopScan() {
    timer?.cancel();
    status = AccessoryStatus.disconnected;
    changed();
  }

  @override
  Future<void> disconnect({bool announce = true}) async {
    stopScan();
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }
}

class FakeNativeMix extends MemoryAudioService implements MixingAudioService {
  final endings = StreamController<void>.broadcast();
  Completer<bool>? pending;
  @override
  Stream<void> get completed => endings.stream;
  @override
  Future<bool> mixTo(
      {String? filePath,
      required String title,
      Map<String, String>? headers,
      required MixPlan Function(Duration, Duration, Duration) plan}) {
    pending = Completer<bool>();
    return pending!.future;
  }

  void finish(bool result) {
    pending?.complete(result);
    pending = null;
  }

  @override
  void cancelMix() {
    finish(false);
  }

  @override
  Future<void> dispose() async {
    cancelMix();
    await endings.close();
  }
}
