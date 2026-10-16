part of 'controller.dart';

/// Phone playback, native mixing and BLE gestures share one intent path.
extension PhoneFlow on AppController {
  bool get directionDirty => draftEnergy != energy || draftStyle != mixStyle;
  bool get directionBusy => v3Active
      ? v3Busy
      : pendingIntent != null || applyingDirection || audioBusy;
  bool get accessoryConnected => accessoryStatus == AccessoryStatus.connected;
  Track? get displayTrack => nowPlaying == null
      ? _candidate(energy, mixStyle)
      : currentTrack(nowPlaying!);

  void editDirection({int? energy, String? style}) {
    if (directionBusy) return;
    if (energy != null) draftEnergy = energy.clamp(1, 5);
    if (style != null && AppController.mixStyles.contains(style)) {
      draftStyle = style;
    }
    _changed();
  }

  Track? _candidate(int targetEnergy, String targetStyle, {bool skip = false}) {
    if (simulateNoMatch) return null;
    final options = tracks
        .where((t) =>
            t.canPlay &&
            t.energy != null &&
            !t.isLocal &&
            t.mixStyle == targetStyle &&
            (!skip || t.id != nowPlaying?.id))
        .toList();
    options.sort((a, b) => (a.energy! - targetEnergy * 18)
        .abs()
        .compareTo((b.energy! - targetEnergy * 18).abs()));
    return options.firstOrNull;
  }

  Future<void> requestDirection(
      {int? targetEnergy,
      String? targetStyle,
      String source = '手机',
      bool skip = false}) async {
    if (v3Active) {
      if (targetStyle == 'Trap' || targetStyle == 'Grime') {
        await v3Request('style', style: targetStyle);
      } else {
        await v3Request(skip
            ? 'next'
            : (targetEnergy ?? energy) > energy
                ? 'up'
                : 'down');
      }
      return;
    }
    if (directionBusy) {
      _feedback('已有一次切换在等待，请先取消或等它完成。');
      return;
    }
    if (loopPreview || playbackMode == PlaybackMode.repeatOne) {
      _feedback('先结束循环，再切换音乐方向。');
      return;
    }
    final level = (targetEnergy ?? draftEnergy).clamp(1, 5);
    final style = targetStyle ?? draftStyle;
    final track = _candidate(level, style, skip: skip || isPlaying);
    if (track == null) {
      _feedback('暂时没有匹配曲目，继续当前音乐。');
      return;
    }
    draftEnergy = level;
    draftStyle = style;
    await _schedule(
        DirectionIntent(MusicDirection(level, style, track.id), source));
  }

  Future<void> _schedule(DirectionIntent intent) async {
    pendingIntent = intent;
    if (isPlaying) {
      if (audio is MixingAudioService) {
        intentFeedback = '正在准备下一首音频，当前播放继续…';
        _changed();
        unawaited(_mixDirection(intent));
        return;
      }
      if (audio is! MemoryAudioService) {
        pendingIntent = null;
        _feedback('实时混音请在手机 App 中使用；网页版可在音乐页直接选曲。');
        return;
      }
      intentFeedback = '已接收 · 等待切换（4 秒交互演示）';
      _directionTimer?.cancel();
      _directionTimer =
          Timer(const Duration(seconds: 4), () => unawaited(_applyPending()));
      _changed();
    } else {
      await _applyPending();
    }
  }

  Future<void> _mixDirection(DirectionIntent intent) async {
    final epoch = ++_mixEpoch;
    final oldTrack = nowPlaying;
    var track =
        tracks.where((t) => t.id == intent.direction.trackId).firstOrNull;
    if (oldTrack == null || track == null) {
      cancelDirection();
      return;
    }
    final previous = MusicDirection(energy, mixStyle, oldTrack.id);
    try {
      RemoteAudio? source;
      if (track.isNas) {
        track = await nasRepository!.detail(track);
        _mergeTracks([track]);
      } else if (track.isRemote) {
        track = await remoteRepository!.detail(track);
        _mergeTracks([track]);
        await remoteRepository!.ensureFreshSession();
        source = remoteRepository!.audio(track);
      }
      if (epoch != _mixEpoch || _disposed) return;
      if (!track.canPlay) throw StateError('下一首暂无可用音频，继续当前音乐。');
      final localPath = importedPaths[_importName(track.id)];
      if (track.isLocal &&
          (localPath == null || !await mediaStorage.exists(localPath))) {
        throw StateError('下一首本地文件不可访问，请重新导入。');
      }
      if (epoch != _mixEpoch || _disposed) return;
      final incoming = track;
      final success = await (audio as MixingAudioService).mixTo(
          filePath: track.isNas || track.isRenderedMix
              ? track.previewUrl
              : source?.uri.toString() ?? localPath,
          title: track.title,
          headers: source?.headers,
          plan: (position, length, nextLength) => const VocalMixPlanner().plan(
              MixProfile.fromTrack(oldTrack), MixProfile.fromTrack(incoming),
              positionMs: position.inMilliseconds,
              outgoingLengthMs: length.inMilliseconds,
              incomingLengthMs: nextLength.inMilliseconds));
      if (epoch != _mixEpoch || _disposed) return;
      if (success) {
        energy = draftEnergy = intent.direction.energy;
        mixStyle = draftStyle = intent.direction.style;
        nowPlaying = track;
        queueIndex = queue.indexOf(track.id);
        previousDirection =
            intent.restore || intent.followQueue ? null : previous;
        intentSource = intent.source;
        _directionSessionActive = !intent.followQueue;
        intentFeedback = '切换完成 · ${track.title}';
        await _persist();
      } else {
        intentFeedback = '切换已取消，继续当前音乐。';
      }
    } catch (error) {
      if (epoch != _mixEpoch || _disposed) return;
      intentFeedback =
          error is StateError ? error.message.toString() : '下一首准备失败，继续当前音乐。';
    } finally {
      if (epoch == _mixEpoch && !_disposed) {
        pendingIntent = null;
        _changed();
      }
    }
  }

  Future<void> _applyPending() async {
    final intent = pendingIntent;
    if (intent == null || applyingDirection || _disposed) return;
    _directionTimer?.cancel();
    applyingDirection = true;
    final old = MusicDirection(
        energy, mixStyle, displayTrack?.id ?? intent.direction.trackId);
    final track =
        tracks.where((t) => t.id == intent.direction.trackId).firstOrNull;
    final wasPlaying = isPlaying;
    final success = track != null &&
        track.canPlay &&
        (!wasPlaying || await _loadTrack(track));
    if (_disposed) return;
    if (success) {
      _directionSessionActive = true;
      energy = draftEnergy = intent.direction.energy;
      mixStyle = draftStyle = intent.direction.style;
      nowPlaying = track;
      if (!wasPlaying) {
        // Changing the paused selection must not resume the previously loaded file.
        _audioLoaded = false;
        position = Duration.zero;
      }
      previousDirection = intent.restore ? null : old;
      intentSource = intent.source;
      intentFeedback = intent.restore
          ? '已恢复上一个音乐方向。'
          : wasPlaying
              ? '已执行 · ${intent.source} · $mixStyle / 能量 $energy'
              : '已准备好，点击播放开始。';
      await _persist();
    } else {
      intentFeedback = '未执行：音频不可用，方向保持不变。';
    }
    pendingIntent = null;
    applyingDirection = false;
    _changed();
  }

  void cancelDirection({String message = '已取消，继续当前音乐。'}) {
    if (v3Active) {
      unawaited(v3Cancel());
      return;
    }
    if (applyingDirection) return;
    _mixEpoch++;
    if (audio is MixingAudioService) (audio as MixingAudioService).cancelMix();
    _directionTimer?.cancel();
    pendingIntent = null;
    draftEnergy = energy;
    draftStyle = mixStyle;
    intentFeedback = message;
    _changed();
  }

  Future<void> restoreDirection() async {
    final previous = previousDirection;
    if (previous == null || directionBusy) return;
    if (loopPreview || playbackMode == PlaybackMode.repeatOne) {
      _feedback('先结束循环，再恢复音乐方向。');
      return;
    }
    draftEnergy = previous.energy;
    draftStyle = previous.style;
    await _schedule(DirectionIntent(previous, '手机', restore: true));
  }

  Future<void> togglePracticeLoop() async {
    if (v3Active) return;
    if (directionBusy) {
      _feedback('先完成或取消切换，再开启循环。');
      return;
    }
    final track = nowPlaying;
    if (track == null ||
        !_audioLoaded ||
        (track.bpm ?? 0) <= 0 ||
        track.isLocal ||
        track.isRemote) {
      _feedback('请先播放示例音频；未分析的本地音频暂不支持 16 拍预览。');
      return;
    }
    audioBusy = true;
    _changed();
    try {
      final end = Duration(milliseconds: (16 * 60000 / track.bpm!).round());
      await audio.setLoopRegion(
          loopPreview ? null : (end > duration ? duration : end));
      loopPreview = !loopPreview;
      playbackMode = PlaybackMode.sequential;
      _feedback(loopPreview ? '循环已开启 · 按示例 BPM 截取前 16 拍，未做节拍对齐。' : '已结束循环。');
    } catch (_) {
      _feedback('循环设置失败，请重新播放后重试。');
    } finally {
      audioBusy = false;
      if (!_disposed) _changed();
    }
  }

  Future<void> playPractice() async {
    final practice = tracks
        .where((t) => isRemoteMode
            ? t.canPlay
            : ['sidewalk', 'echo', 'floor'].contains(t.id))
        .toList();
    if (practice.isEmpty) return;
    setQueue(practice.map((t) => t.id).toList());
    await play(practice.first);
    setTab(0);
  }

  void setAccessoryKind(AccessoryKind kind) {
    if (kind == accessoryKind) return;
    disconnectAccessory();
    accessoryKind = kind;
    _persist();
    _changed();
  }

  Future<void> discoverAccessory() => ble.scan();

  void cancelDiscovery() {
    ble.stopScan();
  }

  void _bleChanged() {
    final wasConnected = accessoryConnected;
    accessoryStatus = ble.status;
    if (wasConnected && !accessoryConnected && pendingIntent?.source != '手机') {
      cancelDirection(message: '饰品断开，待执行动作已取消；手机播放继续。');
    }
    _changed();
  }

  void disconnectAccessory() {
    unawaited(ble.disconnect());
    accessoryStatus = AccessoryStatus.disconnected;
    if (pendingIntent != null && pendingIntent!.source != '手机') {
      cancelDirection(message: '饰品断开，待执行动作已取消；手机播放继续。');
    } else {
      _feedback('饰品已断开，手机播放继续。');
    }
  }

  void setShortcut(AccessoryGesture gesture, ShortcutAction action) {
    shortcutMapping[gesture] = action;
    _persist();
    _changed();
  }

  void toggleAccessoryLock() {
    accessoryLocked = !accessoryLocked;
    if (accessoryLocked &&
        pendingIntent != null &&
        pendingIntent!.source != '手机') {
      cancelDirection(message: '饰品已锁定，待执行动作已取消。');
    }
    _persist();
    _changed();
  }

  Future<void> handleGesture(AccessoryGesture gesture) async {
    if (!accessoryConnected) {
      _feedback('饰品未连接，手机控制仍可使用。');
      return;
    }
    if (accessoryLocked) {
      _feedback('饰品控制已锁定，动作未执行。');
      return;
    }
    final action = shortcutMapping[gesture]!;
    if (v3Active) {
      switch (action) {
        case ShortcutAction.playback:
          await v3TogglePlayback();
        case ShortcutAction.energyUp:
          await v3Request('up');
        case ShortcutAction.energyDown:
          await v3Request('down');
        case ShortcutAction.nextTrack:
          await v3Request('next');
        case ShortcutAction.nextStyle:
          await v3Request('style', style: v3Style == 'Trap' ? 'Grime' : 'Trap');
      }
      return;
    }
    if (action == ShortcutAction.playback) {
      await togglePlayback();
      return;
    }
    final delta = action == ShortcutAction.energyUp
        ? 1
        : action == ShortcutAction.energyDown
            ? -1
            : 0;
    if (energy + delta < 1 || energy + delta > 5) {
      _feedback('已经到达能量边界。');
      return;
    }
    await requestDirection(
        targetEnergy: energy + delta,
        targetStyle: action == ShortcutAction.nextStyle
            ? AppController
                .mixStyles[(AppController.mixStyles.indexOf(mixStyle) + 1) % 3]
            : mixStyle,
        source: accessoryKind.label,
        skip: action == ShortcutAction.nextTrack);
  }

  void setNoMatchSimulation(bool value) {
    simulateNoMatch = value;
    _changed();
  }

  void _feedback(String message) {
    intentFeedback = message;
    if (!_disposed) _changed();
  }

  Map<String, dynamic> _phoneState() => {
        'directionSessionActive': _directionSessionActive,
        'mixEnergy': energy,
        'mixStyle': mixStyle,
        'accessoryKind': accessoryKind.name,
        'accessoryLocked': accessoryLocked,
        'shortcuts':
            shortcutMapping.map((key, value) => MapEntry(key.name, value.name)),
      };

  void _restorePhoneState(Map<String, dynamic> state) {
    _directionSessionActive = state['directionSessionActive'] == true;
    energy =
        draftEnergy = ((state['mixEnergy'] as num?)?.toInt() ?? 3).clamp(1, 5);
    final style = state['mixStyle'];
    mixStyle = draftStyle =
        AppController.mixStyles.contains(style) ? style as String : 'Hip-Hop';
    accessoryKind = AccessoryKind.values
            .where((k) => k.name == state['accessoryKind'])
            .firstOrNull ??
        AccessoryKind.ring;
    accessoryLocked = state['accessoryLocked'] == true;
    final stored = state['shortcuts'];
    if (stored is Map) {
      for (final gesture in AccessoryGesture.values) {
        shortcutMapping[gesture] = ShortcutAction.values
                .where((a) => a.name == stored[gesture.name])
                .firstOrNull ??
            shortcutMapping[gesture]!;
      }
    }
    // Physical connection, pending requests and active playback are never restored.
  }
}
