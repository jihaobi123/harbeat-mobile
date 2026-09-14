import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/controller.dart';
import 'package:harbeat/src/audio_service.dart';
import 'package:harbeat/src/models.dart';
import 'package:harbeat/src/repository.dart';
import 'package:harbeat/src/local_store.dart';
import 'package:harbeat/src/media_storage.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('search, prepare, pairing and live command form a mock P0 flow',
      () async {
    final controller = AppController(MockHarBeatRepository(),
        localStore: MemoryLocalStore(), audio: MemoryAudioService());
    await controller.initialize();

    controller.setSearchQuery('electric');
    expect(controller.searchResults.single.id, 'electric');

    controller.togglePrepareTrack('electric');
    expect(controller.prepareTracks, contains('electric'));

    expect(await controller.pairDevice('123456'), isTrue);
    expect(controller.device, DeviceConnection.online);

    controller.nextPrepareStep();
    controller.nextPrepareStep();
    controller.nextPrepareStep();
    expect(controller.resourceCheckPassed, isTrue);

    await controller.sendLiveCommand('下一首');
    expect(controller.commandState, LiveCommandState.completed);
  });

  test('invalid pairing code is rejected without changing to online', () async {
    final controller = AppController(MockHarBeatRepository(),
        localStore: MemoryLocalStore(), audio: MemoryAudioService());
    controller.device = DeviceConnection.disconnected;
    expect(await controller.pairDevice('123'), isFalse);
    expect(controller.device, DeviceConnection.disconnected);
  });

  test('local state survives controller recreation', () async {
    final store = MemoryLocalStore();
    final first = AppController(MockHarBeatRepository(),
        localStore: store, audio: MemoryAudioService());
    await first.initialize();
    await first.save(first.tracks.first);
    first.createPlaylist('Friday session');
    first.togglePrepareTrack(first.tracks.first.id);
    first.updateSelectedPad(playMode: 'loop', volume: .5, guardMs: 700);
    await Future<void>.delayed(Duration.zero);

    final restored = AppController(MockHarBeatRepository(),
        localStore: store, audio: MemoryAudioService());
    await restored.initialize();
    expect(restored.library, contains('electric'));
    expect(restored.playlists.last.name, 'FRIDAY SESSION');
    expect(restored.prepareTracks, contains('electric'));
    expect(restored.pads.first.playMode, 'loop');
    expect(restored.pads.first.volume, .5);
    expect(restored.pads.first.retriggerGuardMs, 700);
  });

  test('queue, playlist management, pad copy and history work locally',
      () async {
    final store = MemoryLocalStore();
    final controller = AppController(MockHarBeatRepository(),
        localStore: store, audio: MemoryAudioService());
    await controller.initialize();

    controller.setQueue(['electric', 'lock']);
    await controller.play(controller.tracks.first);
    await controller.nextTrack();
    expect(controller.nowPlaying?.id, 'lock');
    await controller.previousTrack();
    expect(controller.nowPlaying?.id, 'electric');

    controller.createPlaylist('manage me');
    final index = controller.playlists.length - 1;
    controller.addToPlaylist(index, 'electric');
    controller.addToPlaylist(index, 'lock');
    controller.movePlaylistTrack(index, 0, 1);
    expect(controller.playlists[index].trackIds, ['lock', 'electric']);
    controller.removeFromPlaylist(index, 'lock');
    expect(controller.playlists[index].trackIds, ['electric']);

    controller.assignSound('AIR HORN');
    controller.updateSelectedPad(playMode: 'loop', volume: .4, guardMs: 600);
    controller.copySelectedPadTo(4);
    expect(controller.pads[4].sound, 'AIR HORN');
    expect(controller.pads[4].playMode, 'loop');

    controller.togglePrepareTrack('electric');
    controller.endLive();
    expect(controller.usageHistory.single.trackCount, 1);

    controller.deletePlaylist(index);
    expect(controller.playlists.any((p) => p.name == 'MANAGE ME'), isFalse);
  });

  test('queue reorder, removal, playback modes and live screen lock work',
      () async {
    final controller = AppController(MockHarBeatRepository(),
        localStore: MemoryLocalStore(), audio: MemoryAudioService());
    await controller.initialize();
    controller.setQueue(['electric', 'lock']);
    controller.moveQueueItem(0, 1);
    expect(controller.queue, ['lock', 'electric']);
    controller.removeQueueItem('electric');
    expect(controller.queue, ['lock']);
    controller.setPlaybackMode(PlaybackMode.repeatOne);
    expect(controller.playbackMode, PlaybackMode.repeatOne);
    controller.toggleScreenLock();
    expect(controller.screenLocked, isTrue);
  });

  test('private imported file metadata survives restart and is playable',
      () async {
    final store = MemoryLocalStore();
    await store.write({
      'importedFiles': ['set.wav'],
      'importedPaths': {'set.wav': '/private/set.wav'},
      'playbackMode': 'shuffle',
    });
    final media = MemoryMediaStorage()..paths.add('/private/set.wav');
    final controller = AppController(MockHarBeatRepository(),
        localStore: store, audio: MemoryAudioService(), mediaStorage: media);
    await controller.initialize();
    final imported =
        controller.tracks.singleWhere((t) => t.id.startsWith('local:'));
    await controller.play(imported);
    expect(controller.nowPlaying?.title, 'set.wav');
    expect(controller.clientIssue, isNull);
    expect(controller.playbackMode, PlaybackMode.shuffle);
  });
}
