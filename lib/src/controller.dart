import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import 'audio_service.dart';
import 'audio_factory.dart';
import 'accessory_ble.dart';
import 'mix_planner.dart';
import 'backend.dart';
import 'local_store.dart';
import 'media_storage.dart';
import 'models.dart';
import 'repository.dart';
import 'session_store.dart';
import 'nas_repository.dart';
import 'realtime_engine.dart';
import 'realtime_factory.dart';
import 'dance_repository.dart';
import 'activity_repository.dart';

part 'phone_controller.dart';
part 'network_controller.dart';
part 'nas_controller.dart';
part 'realtime_controller.dart';
part 'dance_controller.dart';
part 'smart_controller.dart';
part 'activity_controller.dart';

class AppController extends ChangeNotifier {
  AppController(this.repository,
      {LocalStore? localStore,
      AudioService? audio,
      AccessoryBle? ble,
      MediaStorage? mediaStorage,
      SessionStore? sessionStore,
      this.nasRepository,
      RealtimeEngine? realtimeEngine,
      DanceRepository? danceRepository,
      ActivityRepository? activityRepository,
      RemoteHarBeatRepository Function(BackendConfig)? backendFactory})
      : localStore = localStore ?? SharedPreferencesLocalStore(),
        audio = audio ?? createAudioService(),
        ble = ble ?? AccessoryBle(),
        sessionStore = sessionStore ?? const SecureSessionStore(),
        backendFactory = backendFactory ?? RemoteHarBeatRepository.new,
        mediaStorage = mediaStorage ?? createMediaStorage(),
        realtimeEngine = realtimeEngine ?? createRealtimeEngine(),
        danceRepository = danceRepository ?? DanceRepository(),
        activityRepository = activityRepository ?? ActivityRepository();

  HarBeatRepository repository;
  final LocalStore localStore;
  final AudioService audio;
  final AccessoryBle ble;
  final MediaStorage mediaStorage;
  final SessionStore sessionStore;
  final NasCatalogRepository? nasRepository;
  final RealtimeEngine realtimeEngine;
  final DanceRepository danceRepository;
  final ActivityRepository activityRepository;
  List<ActivityReservation> activities = [];
  bool activitiesLoading = false,
      activityBusy = false,
      activityRestoring = false;
  int _activityGeneration = 0;
  String? activityError, activeActivityId, activeActivityName;
  final Map<String, Map<String, dynamic>> activityCaches = {};
  List<Map<String, dynamic>> danceStyles = [];
  Map<String, dynamic>? dancePlan;
  String danceStyle = 'Hip-Hop';
  int danceMinutes = 5, danceEligible = 0, _danceEpoch = 0, _danceVariation = 0;
  bool danceCatalogLoading = false, dancePreparing = false;
  String? danceError;
  String danceMessage = '';
  StreamSubscription<Map<String, dynamic>>? _v3Subscription;
  bool v3Active = false;
  bool v3Loading = false;
  String smartStyle = '';
  bool smartAutomatic = true;
  String? v3Error;
  int v3Budget = 30;
  String v3Style = 'Trap';
  Map<String, dynamic> v3State = {};
  List<Map<String, dynamic>> v3Catalog = [];
  List<String> _v3PreviousQueue = [];
  bool nasLoading = false;
  String? nasError;
  bool nasLive = false;
  bool openingRealtimeLab = false;
  String? realtimeLabError;
  int nasVisibleCount = 12;
  bool _nasPlaylistCreated = false;
  Map<String, dynamic>? accountProfile;
  String? accountError;
  String? sessionWarning;
  bool uploading = false;
  double uploadProgress = 0;
  String? uploadError;
  String? uploadMessage;
  Future<void> _sessionWrites = Future.value();
  final RemoteHarBeatRepository Function(BackendConfig) backendFactory;
  static const mixStyles = ['Hip-Hop', 'Funk', 'House'];
  static const energyNames = ['松弛', '轻快', '律动', '高能', '爆发'];
  int energy = 3;
  String mixStyle = 'Hip-Hop';
  int draftEnergy = 3;
  String draftStyle = 'Hip-Hop';
  DirectionIntent? pendingIntent;
  MusicDirection? previousDirection;
  String intentFeedback = '选择音乐，开始自己的节奏。';
  String intentSource = '手机';
  bool applyingDirection = false;
  bool loopPreview = false;
  bool simulateNoMatch = false;
  bool audioBusy = false;
  bool _audioLoaded = false;
  bool _directionSessionActive = false;
  bool _disposed = false;
  Timer? _directionTimer;
  int _mixEpoch = 0;
  final List<StreamSubscription<dynamic>> _audioSubscriptions = [];
  AccessoryKind accessoryKind = AccessoryKind.ring;
  AccessoryStatus accessoryStatus = AccessoryStatus.disconnected;
  bool accessoryLocked = false;
  final Map<AccessoryGesture, ShortcutAction> shortcutMapping = {
    AccessoryGesture.single: ShortcutAction.energyUp,
    AccessoryGesture.doubleTap: ShortcutAction.energyDown,
    AccessoryGesture.hold: ShortcutAction.nextStyle,
  };
  int tab = 0;
  int musicSection = 0;
  String searchQuery = '';
  bool loading = true;
  String? catalogError;
  String? searchError;
  bool searching = false;
  String? nextCatalogCursor;
  String? nextSearchCursor;
  List<String> _catalogIds = [];
  List<String> _searchIds = [];
  int _catalogGeneration = 0;
  int _searchGeneration = 0;
  Timer? _searchTimer;
  final Set<String> detailsLoading = {};
  final Map<String, String> detailErrors = {};
  List<Track> tracks = const [];
  final Set<String> library = {};
  List<Playlist> playlists = const [
    Playlist(
        id: 'practice', name: '本周练习', trackIds: ['sidewalk', 'echo', 'floor']),
    Playlist(id: 'battle', name: 'BATTLE WARM-UP', trackIds: ['lock']),
  ];
  Track? nowPlaying;
  bool isPlaying = false;
  Duration position = Duration.zero;
  Duration duration = Duration.zero;
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

  void _changed() {
    if (!_disposed) notifyListeners();
  }

  Future<void> initialize() async {
    await audio.initialize();
    ble.addListener(_bleChanged);
    _audioSubscriptions.add(
        ble.gestures.listen((gesture) => unawaited(handleGesture(gesture))));
    final state = await localStore.read();
    final savedBackend = state['backend'];
    if (repository is MockHarBeatRepository && savedBackend is Map) {
      try {
        var config = BackendConfig(savedBackend['url'] as String,
            api: savedBackend['api'] == 'v2'
                ? BackendApi.v2
                : BackendApi.legacy);
        try {
          config = await sessionStore.read(config) ?? config;
        } catch (_) {
          sessionWarning = '无法读取保存的登录状态，请重新登录。';
        }
        repository = _connectedRepository(config);
      } on Exception {
        catalogError = '保存的服务地址无效，请重新设置。';
      }
    }
    try {
      if (remoteRepository != null) {
        _bindSession(remoteRepository!);
        await loadAccountProfile();
        final page = await remoteRepository!.catalog();
        tracks = page.items;
        _catalogIds = page.items.map((t) => t.id).toList();
        nextCatalogCursor = page.nextCursor;
        device = DeviceConnection.disconnected;
      } else {
        final results = await Future.wait(
            [repository.recommendations(), repository.deviceSnapshot()]);
        tracks = results[0] as List<Track>;
        device = results[1] as DeviceConnection;
      }
    } catch (error) {
      catalogError = _networkMessage(error);
      device = DeviceConnection.disconnected;
    }
    if (nasRepository != null) {
      try {
        _mergeTracks(
            [...await nasRepository!.bootstrap(), NasCatalogRepository.mix]);
      } catch (_) {
        nasError = 'NAS 目录快照未能加载，请刷新曲库。';
      }
    }
    _restore(state);
    _restoreActivities(state);
    _restorePhoneState(state);
    _nasPlaylistCreated = state['nasPlaylistCreated'] == true;
    _ensureNasPlaylist();
    _audioSubscriptions.add(audio.position.listen((value) {
      if (v3Active) return;
      position = value;
      notifyListeners();
    }));
    _audioSubscriptions.add(audio.duration.listen((value) {
      if (v3Active) return;
      duration = value;
      notifyListeners();
    }));
    _audioSubscriptions.add(audio.completed.listen((_) {
      if (v3Active) return;
      if (audioBusy || applyingDirection || !isPlaying) return;
      if (pendingIntent != null) {
        if (audio is MixingAudioService) {
          final requestedId = pendingIntent!.direction.trackId;
          final requested =
              tracks.where((t) => t.id == requestedId).firstOrNull;
          cancelDirection(message: '当前歌曲已结束，正在准备下一首。');
          isPlaying = false;
          if (requested != null) unawaited(play(requested));
          return;
        }
        unawaited(_applyPending());
        return;
      }
      if (_directionSessionActive) {
        final next = _candidate(energy, mixStyle, skip: true) ?? nowPlaying;
        if (next != null) {
          unawaited(_loadTrack(next).then((_) => _persist()));
        }
        return;
      }
      if (playbackMode == PlaybackMode.repeatOne && nowPlaying != null) {
        play(nowPlaying!);
      } else {
        nextTrack(autoPlay: true);
      }
    }));
    _audioSubscriptions.add(audio.events.listen((event) {
      if (v3Active) return;
      audioEvent = event;
      if (event.startsWith('mix_plan:')) intentFeedback = event.substring(9);
      if (event == 'mix_unavailable') {
        intentFeedback = '此格式使用系统播放器；实时混音支持 MP3 / WAV / FLAC / OGG。';
      }
      if (event == 'interrupted' || event == 'headphones_disconnected') {
        isPlaying = false;
        cancelDirection(message: '播放已中断，待切换操作已取消。');
      } else if (event == 'resumed_after_interruption') {
        isPlaying = true;
      } else if (event == 'playback_error') {
        isPlaying = false;
        cancelDirection(message: '播放失败，请重新选择音频。');
        clientIssue = const ClientIssue(
            ClientIssueKind.damaged, '无法播放音频', '请重试或重新导入可用音频。');
      }
      notifyListeners();
    }));
    loading = false;
    notifyListeners();
    if (nasRepository != null) unawaited(refreshNas());
    if (nasRepository != null && v3Supported) unawaited(loadSmartChoices());
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
    if (isRemoteMode) {
      _searchTimer?.cancel();
      _searchGeneration++;
      searchError = null;
      _searchIds = [];
      nextSearchCursor = null;
      searching = value.trim().isNotEmpty;
      if (searching) {
        _searchTimer =
            Timer(const Duration(milliseconds: 350), () => searchRemote());
        // Let the text field own typing; rebuild the catalog when the request starts.
        return;
      }
    }
    notifyListeners();
  }

  Future<void> play(Track track) async {
    if (v3Metric && v3Tracks.any((t) => t.id == track.id)) {
      if (v3State['current']?['id'] == track.id.substring(4)) {
        if (!isPlaying) await v3TogglePlayback();
      } else if (!isPlaying && v3Pending == null) {
        await metricCurrent(track);
        if (nowPlaying?.id == track.id) await v3TogglePlayback();
      } else {
        await metricSelectNext(track.id.substring(4));
      }
      return;
    }
    if (v3Active) {
      await v3Select(track);
      return;
    }
    if (audioBusy || applyingDirection) return;
    if (track.isNas && v3Supported && await playSmartTrack(track)) return;
    cancelDirection(message: '手机播放');
    if (await _loadTrack(track)) {
      _directionSessionActive = false;
      if (track.mixStyle != 'Local') {
        mixStyle = draftStyle = track.mixStyle;
        if (track.energy != null) {
          energy = draftEnergy = (track.energy! / 18).round().clamp(1, 5);
        }
      }
      previousDirection = null;
      await _persist();
      notifyListeners();
    }
  }

  Future<bool> _loadTrack(Track track) async {
    audioBusy = true;
    clientIssue = null;
    _changed();
    try {
      RemoteAudio? remoteAudio;
      if (track.isNas) {
        track = await nasRepository!.detail(track);
        _mergeTracks([track]);
      } else if (track.isRemote) {
        final remote = remoteRepository;
        if (remote == null) throw const BackendException('请连接这首歌所属的音乐服务。');
        track = await remote.detail(track);
        _mergeTracks([track]);
      }
      if (!track.canPlay) {
        intentFeedback = '这首歌暂无可用音频，可以先收藏。';
        return false;
      }
      if (track.isRemote) {
        await remoteRepository!.ensureFreshSession();
        remoteAudio = remoteRepository!.audio(track);
      }
      final path = importedPaths[_importName(track.id)];
      if (track.isLocal && (path == null || !await mediaStorage.exists(path))) {
        clientIssue = const ClientIssue(
            ClientIssueKind.cache, '音频文件不可访问', '请重新导入。浏览器导入的音频仅在本次打开期间可用。');
        return false;
      }
      await audio.play(
          filePath: track.isNas || track.isRenderedMix
              ? track.previewUrl
              : remoteAudio?.uri.toString() ?? path,
          title: track.title,
          headers: remoteAudio?.headers);
      await audio.setLoop(playbackMode == PlaybackMode.repeatOne);
      if (_disposed) return false;
      nowPlaying = track;
      if (!queue.contains(track.id)) queue = [...queue, track.id];
      queueIndex = queue.indexOf(track.id);
      position = Duration.zero;
      loopPreview = false;
      _audioLoaded = true;
      isPlaying = true;
      intentFeedback = track.isRenderedMix
          ? 'V3 六首连续混音 · 离线试听'
          : track.isNas
              ? '正在播放 NAS 原曲'
              : track.isRemote
                  ? '正在播放在线原曲'
                  : intentFeedback;
      return true;
    } catch (error) {
      if (error is! BackendException) {
        isPlaying = false;
        _audioLoaded = false;
      }
      clientIssue = ClientIssue(
          error is BackendException
              ? ClientIssueKind.offline
              : ClientIssueKind.damaged,
          '无法播放音频',
          error is BackendException ? error.message : '请检查网络、音频格式或重新导入。');
      intentFeedback = '未执行：音频加载失败。';
      return false;
    } finally {
      audioBusy = false;
      _changed();
    }
  }

  Future<void> togglePlayback() async {
    if (v3Active) {
      await v3TogglePlayback();
      return;
    }
    if (audioBusy || applyingDirection) return;
    if (!isPlaying &&
        v3Supported &&
        (nowPlaying?.isNas == true ||
            (nowPlaying == null && nasRepository != null))) {
      if (await prepareSmartPlayer(initial: nowPlaying)) {
        await v3TogglePlayback();
        return;
      }
    }
    if (isPlaying) {
      cancelDirection(message: '已暂停，待切换操作已取消。');
      await audio.pause();
      isPlaying = false;
    } else {
      final track = nowPlaying ??
          _candidate(energy, mixStyle) ??
          tracks.where((t) => t.canPlay).firstOrNull;
      if (track == null) return;
      if (!_audioLoaded) {
        await _loadTrack(track);
      } else {
        await audio.resume();
        isPlaying = true;
      }
    }
    notifyListeners();
    await _persist();
  }

  Future<void> seek(Duration value) async {
    if (v3Active) {
      await _v3Command('seek', {'position': value.inMilliseconds / 1000});
      return;
    }
    cancelDirection(message: '播放位置已调整。');
    position = value;
    notifyListeners();
    await audio.seek(value);
  }

  Future<void> nextTrack({bool autoPlay = false}) async {
    if (v3Metric) {
      await recommendNext();
      return;
    }
    if (v3Active) {
      await v3Request('next');
      return;
    }
    if (tracks.isEmpty || directionBusy) return;
    if (queue.isEmpty) {
      queue = tracks.where((t) => t.canPlay).map((t) => t.id).toList();
    }
    queue = queue
        .where((id) => tracks.any((t) => t.id == id && t.canPlay))
        .toList();
    if (queue.isEmpty) return;
    final int nextIndex;
    if (playbackMode == PlaybackMode.shuffle && queue.length > 1) {
      nextIndex = (queueIndex +
              1 +
              DateTime.now().millisecondsSinceEpoch % (queue.length - 1)) %
          queue.length;
    } else {
      nextIndex = (queueIndex + 1) % queue.length;
    }
    final next =
        tracks.where((track) => track.id == queue[nextIndex]).firstOrNull;
    if (next == null) return;
    if (!autoPlay && isPlaying && next.id == nowPlaying?.id) {
      _feedback('队列中没有其他歌曲，请先添加要混入的音乐。');
      return;
    }
    if (!autoPlay &&
        isPlaying &&
        audio is MixingAudioService &&
        next.id != nowPlaying?.id) {
      await _schedule(DirectionIntent(
          MusicDirection(energy,
              next.mixStyle == 'Local' ? mixStyle : next.mixStyle, next.id),
          '手机',
          followQueue: true));
    } else if (autoPlay) {
      await _loadTrack(next);
      await _persist();
    } else {
      await play(next);
    }
  }

  Future<void> previousTrack() async {
    if (queue.isEmpty || audioBusy || applyingDirection) return;
    queueIndex = queueIndex <= 0 ? queue.length - 1 : queueIndex - 1;
    final previous =
        tracks.where((track) => track.id == queue[queueIndex]).firstOrNull;
    if (previous == null) return;
    await play(previous);
  }

  void setQueue(List<String> trackIds) {
    if (v3Active) {
      // V3's six prepared candidates are a pool, not a sequential queue.
      _v3PreviousQueue = trackIds
          .where((id) => tracks.any((t) => t.id == id && t.canPlay))
          .toSet()
          .toList();
      return;
    }
    queue = trackIds
        .toSet()
        .where((id) => tracks.any((track) => track.id == id && track.canPlay))
        .toList();
    queueIndex = nowPlaying == null ? -1 : queue.indexOf(nowPlaying!.id);
    notifyListeners();
    _persist();
  }

  void removeQueueItem(String id) {
    if (v3Active) return;
    queue = [...queue]..remove(id);
    queueIndex = nowPlaying == null ? -1 : queue.indexOf(nowPlaying!.id);
    notifyListeners();
    _persist();
  }

  void moveQueueItem(int oldIndex, int newIndex) {
    if (v3Active) return;
    final next = [...queue];
    final item = next.removeAt(oldIndex);
    next.insert(newIndex, item);
    queue = next;
    queueIndex = nowPlaying == null ? -1 : queue.indexOf(nowPlaying!.id);
    notifyListeners();
    _persist();
  }

  void setPlaybackMode(PlaybackMode mode) {
    if (v3Active) {
      _feedback('V3 按实时方向选曲，暂不支持循环或随机播放模式。');
      return;
    }
    cancelDirection(message: '播放模式已更新。');
    if (loopPreview) {
      loopPreview = false;
      audio.setLoopRegion(null);
    }
    playbackMode = mode;
    audio.setLoop(mode == PlaybackMode.repeatOne);
    audio.setShuffle(mode == PlaybackMode.shuffle);
    notifyListeners();
    _persist();
  }

  List<Track> get searchResults {
    final q = searchQuery.trim().toLowerCase();
    if (isRemoteMode) {
      return [
        ..._byIds(q.isEmpty ? _catalogIds : _searchIds),
        ...tracks.where((t) =>
            (t.isLocal || t.isNas || t.isRenderedMix) &&
            '${t.title} ${t.artist} ${t.style} ${t.bpm}'
                .toLowerCase()
                .contains(q)),
      ];
    }
    if (q.isEmpty) return tracks;
    return tracks
        .where((track) =>
            '${track.title} ${track.artist} ${track.style} ${track.mixStyle} ${track.bpm}'
                .toLowerCase()
                .contains(q))
        .toList();
  }

  Future<void> save(Track track) async {
    if (!track.isNas && !track.isRenderedMix) {
      await repository.saveTrack(track.id);
    }
    library.add(track.id);
    await _persist();
    notifyListeners();
  }

  void addToPlaylist(int index, String trackId) {
    library.add(trackId);
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
        library.add('local:${Uri.encodeComponent(imported.name)}');
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
    if (storedPlaylists != null) {
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
        'nasPlaylistCreated': _nasPlaylistCreated,
        'activities': activities.map((a) => a.json).toList(),
        if (remoteRepository != null)
          'backend': remoteRepository!.config.toJson(),
        ..._phoneState(),
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
          bpm: null,
          energy: null,
          reason: kIsWeb ? '本次浏览器可播 · 节拍与调性待分析' : '已导入手机 · 节拍与调性待分析',
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
    _disposed = true;
    _directionTimer?.cancel();
    ble.removeListener(_bleChanged);
    ble.dispose();
    _searchTimer?.cancel();
    remoteRepository?.close();
    nasRepository?.close();
    danceRepository.close();
    activityRepository.dispose();
    for (final subscription in _audioSubscriptions) {
      subscription.cancel();
    }
    audio.dispose();
    _v3Subscription?.cancel();
    realtimeEngine.dispose();
    super.dispose();
  }
}
