part of 'controller.dart';

extension RealtimeFlow on AppController {
  bool get v3Metric => v3State['metric'] is Map;
  bool get v3LegacySupported => realtimeEngine.supportsLegacy;
  Map<String, dynamic> get metricState =>
      Map<String, dynamic>.from(v3State['metric'] as Map? ?? const {});
  Map<String, dynamic>? get metricResult => metricState['result'] is Map
      ? Map<String, dynamic>.from(metricState['result'] as Map)
      : null;
  bool get v3Continuous => v3State['continuous'] is Map;
  Map<String, dynamic> get continuousState => v3Continuous
      ? Map<String, dynamic>.from(v3State['continuous'] as Map)
      : const {};
  Map<String, dynamic> get continuousSelection => Map<String, dynamic>.from(
      continuousState['selection'] as Map? ?? const {});
  bool get v3Supported => realtimeEngine.supported;
  bool get v3Busy => v3Loading || v3State['busy'] == true;
  Map<String, dynamic>? get v3Pending => v3State['pending'] is Map
      ? Map<String, dynamic>.from(v3State['pending'] as Map)
      : null;
  Map<String, dynamic>? get v3Plan => v3State['plan'] is Map
      ? Map<String, dynamic>.from(v3State['plan'] as Map)
      : null;
  List<Track> get v3Tracks =>
      _byIds(v3Catalog.map((t) => 'nas:${t['id']}').toList());

  void _receiveV3(Map<String, dynamic> state) {
    if (!v3Active || _disposed) return;
    v3State = state;
    isPlaying = state['playing'] == true;
    position = Duration(
        milliseconds: ((state['position'] as num? ?? 0) * 1000).round());
    if (state['current'] is Map) {
      final current = Map<String, dynamic>.from(state['current'] as Map);
      final id = 'nas:${current['id']}';
      final track = tracks.where((t) => t.id == id).firstOrNull;
      if (track != null) {
        final changed = nowPlaying?.id != id;
        nowPlaying = track;
        queueIndex = queue.indexOf(id);
        if (changed) unawaited(_persist());
      }
      duration = Duration(
          milliseconds: ((current['duration'] as num? ?? 0) * 1000).round());
      v3Style = current['style']?.toString() ?? v3Style;
    }
    intentFeedback = (state['error'] as String?)?.isNotEmpty == true
        ? state['error'] as String
        : state['status']?.toString() ?? '';
    _changed();
  }

  Future<void> enableV3({bool continuous = true, String? mode}) async {
    if (v3Active ||
        v3Loading ||
        audioBusy ||
        applyingDirection ||
        !v3Supported) {
      return;
    }
    v3Loading = true;
    v3Error = null;
    cancelDirection(message: '正在准备 V3 实时混音');
    try {
      await audio.stop();
      _audioLoaded = false;
      isPlaying = false;
      loopPreview = false;
      playbackMode = PlaybackMode.sequential;
      v3Active = true;
      _v3Subscription ??=
          realtimeEngine.states.listen(_receiveV3, onError: (Object e) {
        v3Error = '智能衔接连接中断，停止后重新播放可重试。';
        _changed();
      });
      final result = await realtimeEngine.command(
          'prepare', {'mode': mode ?? (continuous ? 'continuous' : 'legacy')});
      if (_disposed) return;
      v3Catalog = (result['tracks'] as List)
          .map((t) => Map<String, dynamic>.from(t as Map))
          .toList();
      for (final t in v3Catalog) {
        if (!tracks.any((item) => item.id == 'nas:${t['id']}')) {
          _mergeTracks([
            Track(
                id: 'nas:${t['id']}',
                title: t['title'],
                artist: t['collection'] as String? ?? 'HIP-HOP / SIX',
                style: t['style'],
                bpm: t['bpm'],
                energy: null,
                reason: mode == 'metric' ? '智能分轨混音素材' : 'V3 本地实时素材',
                color: const Color(0xFFFF683B),
                durationMs: ((t['duration'] as num) * 1000).round())
          ]);
        }
      }
      _v3PreviousQueue = List.of(queue);
      queue = v3Tracks.map((t) => t.id).toList();
      if (!queue.contains(nowPlaying?.id)) {
        nowPlaying = mode == 'metric'
            ? v3Tracks
                .where((t) => v3Catalog.any((e) =>
                    'nas:${e['id']}' == t.id && e['playStatus'] == 'ready'))
                .first
            : v3Tracks.where((t) => t.title == 'Big Girls').firstOrNull ??
                v3Tracks.first;
      }
      queueIndex = queue.indexOf(nowPlaying!.id);
      v3Style = v3Catalog.firstWhere(
          (t) => 'nas:${t['id']}' == nowPlaying!.id)['style'] as String;
      position = Duration.zero;
      duration = Duration(
          milliseconds: ((v3Catalog.firstWhere(
                          (t) => 'nas:${t['id']}' == nowPlaying!.id)['duration']
                      as num) *
                  1000)
              .round());
      _receiveV3(Map<String, dynamic>.from(result['state'] as Map));
      tab = 0;
      if (mode != 'metric' && nasRepository != null && danceStyles.isEmpty) {
        unawaited(loadDanceStyles());
      }
    } catch (e) {
      v3Active = false;
      v3Error = e is PlatformException
          ? e.message ?? '混音引擎未能启动，请重试。'
          : e is TimeoutException
              ? '连接混音引擎超时，请重试。'
              : e is StateError
                  ? e.message.toString()
                  : '混音服务未能连接，请检查网络后重试。';
    } finally {
      v3Loading = false;
      _changed();
    }
  }

  Future<void> switchV3Mode(bool continuous) async {
    if (v3Loading || dancePreparing) return;
    await disableV3();
    if (!v3Active) await enableV3(continuous: continuous);
  }

  Future<void> switchMetricMode() async {
    if (v3Loading || dancePreparing) return;
    await disableV3();
    if (!v3Active) await enableV3(mode: 'metric');
    if (v3Metric) {
      await setSmartDirection(level: draftEnergy, style: smartStyle);
    }
  }

  Future<void> metricPrepare() => _v3Command('metricPrepare');
  Future<void> metricSelectNext(String id) =>
      _v3Command('select', {'trackId': id});
  Future<void> metricMethod(String method) =>
      _v3Command('metricMethod', {'method': method});
  Future<void> metricApply({bool audition = false}) =>
      _v3Command('metricApply', {'audition': audition});
  Future<void> metricFilter({String? label, String? query}) =>
      _v3Command('filters', {
        if (label != null) 'label': label,
        if (query != null) 'query': query,
      });
  Future<void> metricCurrent(Track track) async {
    if (v3Pending != null) return;
    if (v3State['current'] != null) {
      await _v3Command('stop');
      if (v3State['current'] != null) return;
    }
    nowPlaying = track;
    queueIndex = queue.indexOf(track.id);
    position = Duration.zero;
    duration = Duration(milliseconds: track.durationMs ?? 0);
    _changed();
  }

  Future<void> continuousVolume(double value) =>
      _v3Command('volume', {'value': value});
  Future<void> continuousAutomatic(bool value) =>
      _v3Command('automatic', {'enabled': value});
  Future<void> continuousFilter({String? label, String? collection}) =>
      _v3Command('filters', {
        if (label != null) 'label': label,
        if (collection != null) 'collection': collection,
      });

  Future<void> disableV3() async {
    if (!v3Active || v3Loading) return;
    v3Loading = true;
    v3Error = null;
    try {
      await realtimeEngine.command('stop');
      v3Active = false;
      isPlaying = false;
      _audioLoaded = false;
      position = Duration.zero;
      queue = _v3PreviousQueue;
      if (nowPlaying != null && !queue.contains(nowPlaying!.id)) {
        queue = [...queue, nowPlaying!.id];
      }
      queueIndex = nowPlaying == null ? -1 : queue.indexOf(nowPlaying!.id);
      v3State = {};
      intentFeedback = '已切换标准播放，点击开始播放。';
      await _persist();
    } catch (_) {
      v3Error = '无法停止实时引擎，请重试后再切换。';
    } finally {
      v3Loading = false;
      _changed();
    }
  }

  Future<void> _v3Command(String method,
      [Map<String, dynamic> args = const {}]) async {
    if (!v3Active || v3Loading) return;
    v3Error = null;
    try {
      final result = await realtimeEngine.command(method, args);
      if (result['state'] is Map) {
        _receiveV3(Map<String, dynamic>.from(result['state'] as Map));
      }
      if (method == 'export') intentFeedback = '日志已提交保存到 下载 / HarBeat';
    } catch (e) {
      v3Error = e is PlatformException
          ? e.message
          : e is StateError
              ? e.message.toString()
              : '操作未完成，请重试。';
    }
    _changed();
  }

  Future<void> v3TogglePlayback() async {
    if (v3Loading || (!isPlaying && v3Busy)) return;
    if (isPlaying ||
        (v3State['buffering'] == true && v3State['paused'] != true)) {
      await _v3Command('pause');
    } else if (v3State['current'] != null) {
      await _v3Command('resume');
    } else if (nowPlaying != null) {
      if (danceRunning) {
        await startDance();
        return;
      }
      await _v3Command('start', {'trackId': nowPlaying!.id.substring(4)});
    }
  }

  Future<void> v3Select(Track track) async {
    if (v3Metric && v3Tracks.any((t) => t.id == track.id)) {
      if (v3State['current'] == null) {
        await metricCurrent(track);
      } else {
        await _v3Command('select', {'trackId': track.id.substring(4)});
      }
      return;
    }
    if (v3Metric) {
      await disableV3();
      if (!v3Active && await _loadTrack(track)) {
        intentFeedback = '正在播放原曲；这首歌还没有可用的智能混音资料。';
        _changed();
      }
      return;
    }
    if (v3Continuous && v3Tracks.any((t) => t.id == track.id)) {
      final entry = v3Catalog.firstWhere((t) => 'nas:${t['id']}' == track.id);
      if (entry['playStatus'] == 'unavailable') {
        v3Error = '这首歌的连续播放素材尚未就绪。';
      } else if (v3State['current'] == null) {
        nowPlaying = track;
        queueIndex = queue.indexOf(track.id);
        position = Duration.zero;
        duration =
            Duration(milliseconds: ((entry['duration'] as num) * 1000).round());
      } else {
        await _v3Command('select', {'trackId': track.id.substring(4)});
      }
      _changed();
      return;
    }
    if (danceRunning && v3Tracks.any((t) => t.id == track.id)) {
      intentFeedback = '自动舞程已按顺序准备转场，请使用下一首；换歌单可重新生成舞程。';
      _changed();
      return;
    }
    if (!v3Tracks.any((t) => t.id == track.id)) {
      await disableV3();
      if (!v3Active) await play(track);
      return;
    }
    if (isPlaying) {
      await v3Request('next', targetId: track.id.substring(4));
    } else {
      await _v3Command('start', {'trackId': track.id.substring(4)});
    }
  }

  Future<void> v3Request(String kind, {String? style, String? targetId}) =>
      _v3Command('request', {
        'intent': {
          'kind': kind,
          if (style != null) 'style': style,
          if (targetId != null) 'targetId': targetId
        },
        'budget': v3Budget
      });
  Future<void> v3Cancel() => _v3Command('cancel');
  Future<void> v3Stop() => _v3Command('stop');
  Future<void> v3Export(String format) =>
      _v3Command('export', {'format': format});
  void cycleV3Budget() {
    v3Budget = switch (v3Budget) { 30 => 10, 10 => 18, _ => 30 };
    _changed();
  }
}
