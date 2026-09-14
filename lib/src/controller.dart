import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart' show Color;

import 'audio_service.dart';
import 'local_store.dart';
import 'media_storage.dart';
import 'models.dart';
import 'repository.dart';

class AppController extends ChangeNotifier {
  AppController(this.repository,
      {LocalStore? localStore, AudioService? audio, MediaStorage? mediaStorage})
      : localStore = localStore ?? SharedPreferencesLocalStore(),
        audio = audio ?? PreviewAudioService(),
        mediaStorage = mediaStorage ?? createMediaStorage();

  final HarBeatRepository repository;
  final LocalStore localStore;
  final AudioService audio;
  final MediaStorage mediaStorage;
  int tab = 0;
  int musicSection = 0;
  String searchQuery = '';
  bool loading = true;
  List<Track> tracks = const [];
  final Set<String> library = {};
  List<Playlist> playlists = const [
    Playlist(id: 'practice', name: '本周练习', trackIds: []),
    Playlist(id: 'battle', name: 'BATTLE WARM-UP', trackIds: ['lock']),
  ];
  Track? nowPlaying;
  bool isPlaying = false;
  Duration position = Duration.zero;
  Duration duration = const Duration(seconds: 12);
  List<String> queue = [];
  int queueIndex = -1;
  PlaybackMode playbackMode = PlaybackMode.sequential;
  final List<String> importedFiles = [];
  final Map<String, String> importedPaths = {};
  ClientIssue? clientIssue;
  String? audioEvent;
  bool screenLocked = false;
  List<UsageRecord> usageHistory = [];
  DeviceConnection device = DeviceConnection.resolving;
  List<PadSlot> pads = List.generate(8,
      (i) => PadSlot(i + 1, i < 3 ? ['AIR HORN', 'CROWD UP', 'HIT'][i] : null));
  int selectedPad = 0;
  int appPresetVersion = 3;
  int devicePresetVersion = 2;
  bool savingPreset = false;
  bool syncingPreset = false;
  bool pairing = false;
  String? pairedCode;
  int prepareStep = 0;
  final Set<String> prepareTracks = {};
  bool resourceCheckPassed = false;
  bool live = false;
  LiveCommandState commandState = LiveCommandState.idle;
  String? lastCommand;

  bool get presetDirty => appPresetVersion != devicePresetVersion;

  Future<void> initialize() async {
    await audio.initialize();
    final results = await Future.wait([
      repository.recommendations(),
      repository.deviceSnapshot(),
      localStore.read()
    ]);
    tracks = results[0] as List<Track>;
    device = results[1] as DeviceConnection;
    _restore(results[2] as Map<String, dynamic>);
    audio.position.listen((value) {
      position = value;
      notifyListeners();
    });
    audio.duration.listen((value) {
      duration = value;
      notifyListeners();
    });
    audio.completed.listen((_) {
      if (playbackMode == PlaybackMode.repeatOne && nowPlaying != null) {
        play(nowPlaying!);
      } else {
        nextTrack(autoPlay: true);
      }
    });
    audio.events.listen((event) {
      audioEvent = event;
      if (event == 'interrupted' || event == 'headphones_disconnected') {
        isPlaying = false;
      } else if (event == 'resumed_after_interruption') {
        isPlaying = true;
      }
      notifyListeners();
    });
    loading = false;
    notifyListeners();
  }

  void setTab(int value) {
    tab = value;
    notifyListeners();
  }

  void setMusicSection(int value) {
    musicSection = value;
    notifyListeners();
  }

  void setSearchQuery(String value) {
    searchQuery = value;
    notifyListeners();
  }

  Future<void> play(Track track) async {
    nowPlaying = track;
    if (!queue.contains(track.id)) queue = [...queue, track.id];
    queueIndex = queue.indexOf(track.id);
    isPlaying = true;
    notifyListeners();
    final path = importedPaths[_importName(track.id)];
    if (path != null && !await mediaStorage.exists(path)) {
      clientIssue = const ClientIssue(
          ClientIssueKind.cache, '音频文件已丢失', 'App 私有目录中的文件不可访问，请重新导入。');
      isPlaying = false;
      notifyListeners();
      return;
    }
    clientIssue = null;
    await audio.play(filePath: path, title: track.title);
    await _persist();
  }

  Future<void> togglePlayback() async {
    if (nowPlaying == null) return;
    isPlaying = !isPlaying;
    notifyListeners();
    isPlaying ? await audio.resume() : await audio.pause();
  }

  Future<void> seek(Duration value) async {
    position = value;
    notifyListeners();
    await audio.seek(value);
  }

  Future<void> nextTrack({bool autoPlay = false}) async {
    if (tracks.isEmpty) return;
    if (queue.isEmpty) queue = tracks.map((track) => track.id).toList();
    if (playbackMode == PlaybackMode.shuffle && queue.length > 1) {
      queueIndex = (queueIndex +
              1 +
              DateTime.now().millisecondsSinceEpoch % (queue.length - 1)) %
          queue.length;
    } else {
      queueIndex = (queueIndex + 1) % queue.length;
    }
    final next =
        tracks.where((track) => track.id == queue[queueIndex]).firstOrNull;
    if (next == null) return;
    nowPlaying = next;
    position = Duration.zero;
    isPlaying = autoPlay || isPlaying;
    notifyListeners();
    if (isPlaying) {
      await audio.play(
          filePath: importedPaths[_importName(next.id)], title: next.title);
    }
    await _persist();
  }

  Future<void> previousTrack() async {
    if (queue.isEmpty) return;
    queueIndex = queueIndex <= 0 ? queue.length - 1 : queueIndex - 1;
    final previous =
        tracks.where((track) => track.id == queue[queueIndex]).firstOrNull;
    if (previous == null) return;
    nowPlaying = previous;
    position = Duration.zero;
    notifyListeners();
    if (isPlaying) {
      await audio.play(
          filePath: importedPaths[_importName(previous.id)],
          title: previous.title);
    }
    await _persist();
  }

  void setQueue(List<String> trackIds) {
    queue =
        trackIds.where((id) => tracks.any((track) => track.id == id)).toList();
    queueIndex = nowPlaying == null ? -1 : queue.indexOf(nowPlaying!.id);
    notifyListeners();
    _persist();
  }

  void removeQueueItem(String id) {
    queue = [...queue]..remove(id);
    queueIndex = nowPlaying == null ? -1 : queue.indexOf(nowPlaying!.id);
    notifyListeners();
    _persist();
  }

  void moveQueueItem(int oldIndex, int newIndex) {
    final next = [...queue];
    final item = next.removeAt(oldIndex);
    next.insert(newIndex, item);
    queue = next;
    queueIndex = nowPlaying == null ? -1 : queue.indexOf(nowPlaying!.id);
    notifyListeners();
    _persist();
  }

  void setPlaybackMode(PlaybackMode mode) {
    playbackMode = mode;
    audio.setLoop(mode == PlaybackMode.repeatOne);
    audio.setShuffle(mode == PlaybackMode.shuffle);
    notifyListeners();
    _persist();
  }

  List<Track> get searchResults {
    final q = searchQuery.trim().toLowerCase();
    if (q.isEmpty) return tracks;
    return tracks
        .where((track) => '${track.title} ${track.artist} ${track.style}'
            .toLowerCase()
            .contains(q))
        .toList();
  }

  Future<void> save(Track track) async {
    await repository.saveTrack(track.id);
    library.add(track.id);
    await _persist();
    notifyListeners();
  }

  void addToPlaylist(int index, String trackId) {
    playlists = [...playlists]..[index] = playlists[index].add(trackId);
    notifyListeners();
    _persist();
  }

  void createPlaylist(String name) {
    final clean = name.trim();
    if (clean.isEmpty) return;
    playlists = [
      ...playlists,
      Playlist(
          id: 'local-${DateTime.now().millisecondsSinceEpoch}',
          name: clean.toUpperCase(),
          trackIds: const [])
    ];
    notifyListeners();
    _persist();
  }

  void renamePlaylist(int index, String name) {
    if (name.trim().isEmpty) return;
    playlists = [...playlists]..[index] =
        playlists[index].copyWith(name: name.trim().toUpperCase());
    notifyListeners();
    _persist();
  }

  void deletePlaylist(int index) {
    playlists = [...playlists]..removeAt(index);
    notifyListeners();
    _persist();
  }

  void removeFromPlaylist(int playlistIndex, String trackId) {
    playlists = [...playlists]..[playlistIndex] = playlists[playlistIndex]
        .copyWith(
            trackIds: playlists[playlistIndex]
                .trackIds
                .where((id) => id != trackId)
                .toList());
    notifyListeners();
    _persist();
  }

  void movePlaylistTrack(int playlistIndex, int oldIndex, int newIndex) {
    final ids = [...playlists[playlistIndex].trackIds];
    final item = ids.removeAt(oldIndex);
    ids.insert(newIndex, item);
    playlists = [...playlists]..[playlistIndex] =
        playlists[playlistIndex].copyWith(trackIds: ids);
    notifyListeners();
    _persist();
  }

  void selectPlaylistForPrepare(Playlist playlist) {
    prepareTracks.addAll(playlist.trackIds);
    notifyListeners();
    _persist();
  }

  Future<void> importLocalAudio() async {
    clientIssue = null;
    try {
      final files = await FilePicker.pickFiles(type: FileType.audio);
      if (files.isEmpty) return;
      for (final file in files) {
        final imported = await mediaStorage.import(file);
        if (!importedFiles.contains(imported.name)) {
          importedFiles.add(imported.name);
        }
        importedPaths[imported.name] = imported.path;
        _addImportedTrack(imported.name);
      }
    } on AudioImportException catch (error) {
      clientIssue = _issueForImport(error.failure);
    } catch (_) {
      clientIssue = const ClientIssue(
          ClientIssueKind.permission, '无法读取所选文件', '请允许文件访问权限后重试。');
    }
    notifyListeners();
    await _persist();
  }

  void clearClientIssue() {
    clientIssue = null;
    notifyListeners();
  }

  void toggleScreenLock() {
    screenLocked = !screenLocked;
    notifyListeners();
  }

  Future<bool> pairDevice(String code) async {
    if (code.length != 6) return false;
    pairing = true;
    device = DeviceConnection.pairing;
    notifyListeners();
    await Future<void>.delayed(const Duration(milliseconds: 650));
    pairedCode = code;
    pairing = false;
    device = DeviceConnection.online;
    notifyListeners();
    return true;
  }

  void togglePrepareTrack(String id) {
    prepareTracks.contains(id)
        ? prepareTracks.remove(id)
        : prepareTracks.add(id);
    notifyListeners();
    _persist();
  }

  void nextPrepareStep() {
    if (prepareStep == 2) {
      resourceCheckPassed =
          device == DeviceConnection.online && prepareTracks.isNotEmpty;
    }
    if (prepareStep < 3) prepareStep += 1;
    notifyListeners();
    _persist();
  }

  void previousPrepareStep() {
    if (prepareStep > 0) prepareStep -= 1;
    notifyListeners();
    _persist();
  }

  void resetPrepare() {
    prepareStep = 0;
    notifyListeners();
    _persist();
  }

  void startLive() {
    live = true;
    notifyListeners();
  }

  void endLive() {
    usageHistory = [
      UsageRecord(
          title: 'CYPHER SESSION',
          endedAt: DateTime.now(),
          trackCount: prepareTracks.length),
      ...usageHistory,
    ];
    live = false;
    commandState = LiveCommandState.idle;
    notifyListeners();
    _persist();
  }

  Future<void> sendLiveCommand(String command) async {
    if (commandState != LiveCommandState.idle &&
        commandState != LiveCommandState.completed) {
      return;
    }
    lastCommand = command;
    commandState = LiveCommandState.sent;
    notifyListeners();
    await Future<void>.delayed(const Duration(milliseconds: 250));
    commandState = LiveCommandState.queued;
    notifyListeners();
    await Future<void>.delayed(const Duration(milliseconds: 300));
    commandState = LiveCommandState.executing;
    notifyListeners();
    await Future<void>.delayed(const Duration(milliseconds: 350));
    commandState = LiveCommandState.completed;
    notifyListeners();
  }

  void selectPad(int index) {
    selectedPad = index;
    notifyListeners();
  }

  void assignSound(String? sound) {
    pads = [...pads]..[selectedPad] =
        pads[selectedPad].copyWith(sound: sound, clear: sound == null);
    appPresetVersion += 1;
    notifyListeners();
    _persist();
  }

  void updateSelectedPad({String? playMode, double? volume, int? guardMs}) {
    pads = [...pads]..[selectedPad] = pads[selectedPad].copyWith(
        playMode: playMode, volume: volume, retriggerGuardMs: guardMs);
    appPresetVersion += 1;
    notifyListeners();
    _persist();
  }

  void copySelectedPadTo(int targetIndex) {
    if (targetIndex == selectedPad ||
        targetIndex < 0 ||
        targetIndex >= pads.length) {
      return;
    }
    final source = pads[selectedPad];
    pads = [...pads]..[targetIndex] = PadSlot(targetIndex + 1, source.sound,
        playMode: source.playMode,
        volume: source.volume,
        retriggerGuardMs: source.retriggerGuardMs);
    appPresetVersion += 1;
    notifyListeners();
    _persist();
  }

  Future<void> savePreset() async {
    savingPreset = true;
    notifyListeners();
    await repository.savePreset(pads, appPresetVersion);
    savingPreset = false;
    await _persist();
    notifyListeners();
  }

  Future<void> syncPreset() async {
    syncingPreset = true;
    notifyListeners();
    devicePresetVersion = await repository.syncPreset(pads, appPresetVersion);
    syncingPreset = false;
    await _persist();
    notifyListeners();
  }

  void _restore(Map<String, dynamic> state) {
    library.addAll(
        (state['library'] as List<dynamic>? ?? const []).cast<String>());
    prepareTracks.addAll(
        (state['prepareTracks'] as List<dynamic>? ?? const []).cast<String>());
    importedFiles.addAll(
        (state['importedFiles'] as List<dynamic>? ?? const []).cast<String>());
    final paths = state['importedPaths'] as Map<String, dynamic>? ?? const {};
    importedPaths
        .addAll(paths.map((key, value) => MapEntry(key, value as String)));
    for (final name in importedFiles) {
      _addImportedTrack(name);
    }
    final mode = state['playbackMode'] as String?;
    playbackMode =
        PlaybackMode.values.where((item) => item.name == mode).firstOrNull ??
            PlaybackMode.sequential;
    prepareStep = state['prepareStep'] as int? ?? 0;
    final storedPlaylists = state['playlists'] as List<dynamic>?;
    if (storedPlaylists != null && storedPlaylists.isNotEmpty) {
      playlists = storedPlaylists.map((item) {
        final map = item as Map<String, dynamic>;
        return Playlist(
            id: map['id'] as String,
            name: map['name'] as String,
            trackIds: (map['trackIds'] as List<dynamic>).cast<String>());
      }).toList();
    }
    final storedPads = state['pads'] as List<dynamic>?;
    if (storedPads != null && storedPads.length == 8) {
      pads = storedPads.map((item) {
        final map = item as Map<String, dynamic>;
        return PadSlot(map['index'] as int, map['sound'] as String?,
            playMode: map['playMode'] as String? ?? 'once',
            volume: (map['volume'] as num?)?.toDouble() ?? .85,
            retriggerGuardMs: map['guardMs'] as int? ?? 300);
      }).toList();
    }
    appPresetVersion = state['appPresetVersion'] as int? ?? appPresetVersion;
    devicePresetVersion =
        state['devicePresetVersion'] as int? ?? devicePresetVersion;
    final nowPlayingId = state['nowPlayingId'] as String?;
    if (nowPlayingId != null) {
      nowPlaying =
          tracks.where((track) => track.id == nowPlayingId).firstOrNull;
    }
    queue = (state['queue'] as List<dynamic>? ?? const []).cast<String>();
    queueIndex = state['queueIndex'] as int? ?? -1;
    final storedHistory = state['usageHistory'] as List<dynamic>? ?? const [];
    usageHistory = storedHistory.map((item) {
      final map = item as Map<String, dynamic>;
      return UsageRecord(
          title: map['title'] as String,
          endedAt: DateTime.parse(map['endedAt'] as String),
          trackCount: map['trackCount'] as int);
    }).toList();
  }

  Future<void> _persist() => localStore.write({
        'library': library.toList(),
        'prepareTracks': prepareTracks.toList(),
        'prepareStep': prepareStep,
        'importedFiles': importedFiles,
        'importedPaths': importedPaths,
        'playbackMode': playbackMode.name,
        'nowPlayingId': nowPlaying?.id,
        'queue': queue,
        'queueIndex': queueIndex,
        'appPresetVersion': appPresetVersion,
        'devicePresetVersion': devicePresetVersion,
        'playlists': playlists
            .map((p) => {'id': p.id, 'name': p.name, 'trackIds': p.trackIds})
            .toList(),
        'pads': pads
            .map((p) => {
                  'index': p.index,
                  'sound': p.sound,
                  'playMode': p.playMode,
                  'volume': p.volume,
                  'guardMs': p.retriggerGuardMs
                })
            .toList(),
        'usageHistory': usageHistory
            .map((record) => {
                  'title': record.title,
                  'endedAt': record.endedAt.toIso8601String(),
                  'trackCount': record.trackCount,
                })
            .toList(),
      });

  String? _importName(String id) =>
      id.startsWith('local:') ? Uri.decodeComponent(id.substring(6)) : null;

  void _addImportedTrack(String name) {
    final id = 'local:${Uri.encodeComponent(name)}';
    if (tracks.any((track) => track.id == id)) return;
    tracks = [
      ...tracks,
      Track(
          id: id,
          title: name,
          artist: 'LOCAL FILE',
          style: 'LOCAL',
          bpm: 0,
          energy: 0,
          reason: '已复制到 App 私有目录',
          color: const Color(0xFFFF5C35))
    ];
  }

  ClientIssue _issueForImport(ImportFailure failure) => switch (failure) {
        ImportFailure.permissionDenied => const ClientIssue(
            ClientIssueKind.permission, '文件权限被拒绝', '请在系统设置中允许文件访问后重试。'),
        ImportFailure.unsupportedFormat => const ClientIssue(
            ClientIssueKind.unsupported,
            '格式不支持',
            '支持 MP3、WAV、M4A、AAC、FLAC 和 OGG。'),
        ImportFailure.damagedFile => const ClientIssue(
            ClientIssueKind.damaged, '文件可能已损坏', '文件为空或无法完整复制，请更换文件。'),
        ImportFailure.insufficientSpace =>
          const ClientIssue(ClientIssueKind.storage, '存储空间不足', '请释放设备空间后重试。'),
        ImportFailure.copyFailed => const ClientIssue(
            ClientIssueKind.cache, '导入失败', '未能写入 App 私有目录，请重试。'),
      };

  @override
  void dispose() {
    audio.dispose();
    super.dispose();
  }
}
