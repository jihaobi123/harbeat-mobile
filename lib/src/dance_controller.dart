part of 'controller.dart';

extension DanceFlow on AppController {
  Map<String, dynamic>? get danceRun => v3State['dance'] is Map
      ? Map<String, dynamic>.from(v3State['dance'] as Map)
      : null;
  bool get danceRunning => danceRun != null;
  List<int> get danceDurations {
    final entry =
        danceStyles.where((s) => s['style'] == danceStyle).firstOrNull;
    return (entry?['durations'] as List? ?? []).cast<int>();
  }

  Future<void> loadDanceStyles() async {
    if (danceCatalogLoading) return;
    danceCatalogLoading = true;
    danceError = null;
    _changed();
    try {
      var result = await danceRepository.catalog();
      final deadline = DateTime.now().add(const Duration(minutes: 8));
      while (result['loading'] == true && !_disposed) {
        if (DateTime.now().isAfter(deadline)) {
          throw const BackendException('曲库仍在检查中，请稍后刷新。');
        }
        await Future<void>.delayed(const Duration(seconds: 3));
        if (_disposed) return;
        result = await danceRepository.catalog();
      }
      if (_disposed) return;
      danceStyles = (result['styles'] as List)
          .map((s) => Map<String, dynamic>.from(s as Map))
          .toList();
      danceEligible = result['eligible'] as int;
      if (!danceDurations.contains(danceMinutes) && danceDurations.isNotEmpty) {
        danceMinutes = danceDurations.first;
      }
    } catch (e) {
      danceError = e is BackendException ? e.message : '读取可混音曲库失败，请重试。';
    } finally {
      danceCatalogLoading = false;
      _changed();
    }
  }

  void setDanceOptions({String? style, int? minutes}) {
    if (dancePreparing || isPlaying || v3Loading) return;
    danceStyle = style ?? danceStyle;
    danceMinutes = minutes ?? danceMinutes;
    if (!danceDurations.contains(danceMinutes) && danceDurations.isNotEmpty) {
      danceMinutes = danceDurations.first;
    }
    dancePlan = null;
    danceError = null;
    _changed();
  }

  void cancelDancePreparation() {
    _danceEpoch++;
    dancePreparing = false;
    danceMessage = '已取消等待，可以重新选择。';
    _changed();
  }

  Future<void> prepareDance({bool reshuffle = false}) async {
    if (dancePreparing || !danceDurations.contains(danceMinutes)) return;
    final epoch = ++_danceEpoch;
    if (reshuffle) _danceVariation = (_danceVariation + 1) % 1000;
    dancePreparing = true;
    dancePlan = null;
    danceError = null;
    danceMessage = '正在按风格、节拍和时长选歌…';
    _changed();
    try {
      var job = await danceRepository.prepare(
          danceStyle, danceMinutes, _danceVariation);
      final deadline = DateTime.now().add(const Duration(minutes: 15));
      while (!_disposed && epoch == _danceEpoch) {
        if (job['status'] == 'ready') {
          dancePlan = Map<String, dynamic>.from(job['result'] as Map);
          danceMessage = '歌单与转场素材已就绪';
          break;
        }
        if (job['status'] == 'failed') {
          throw BackendException(job['message'] as String? ?? '素材准备失败，请重试。');
        }
        if (DateTime.now().isAfter(deadline)) {
          throw const BackendException('准备仍在进行，请稍后再次生成以继续查看。');
        }
        danceMessage = job['message'] as String? ?? '正在准备混音素材…';
        _changed();
        await Future<void>.delayed(const Duration(seconds: 2));
        if (_disposed || epoch != _danceEpoch) return;
        job = await danceRepository.status(job['id'] as String);
      }
    } catch (e) {
      if (epoch == _danceEpoch) {
        danceError = e is BackendException ? e.message : '网络中断，请重试；已准备的素材会复用。';
      }
    } finally {
      if (epoch == _danceEpoch) dancePreparing = false;
      _changed();
    }
  }

  Future<void> startDance() async {
    final plan = dancePlan;
    if (plan == null || dancePreparing || v3Loading || isPlaying) return;
    if (!v3Active) await enableV3();
    if (!v3Active) return;
    v3Loading = true;
    v3Error = null;
    _changed();
    try {
      final result = await realtimeEngine.command('configure', {'set': plan});
      final rawTracks = (plan['tracks'] as List)
          .map((t) => Map<String, dynamic>.from(t as Map))
          .toList();
      v3Catalog = rawTracks;
      for (final t in rawTracks) {
        if (!tracks.any((old) => old.id == 'nas:${t['id']}')) {
          _mergeTracks([
            Track(
                id: 'nas:${t['id']}',
                title: t['title'],
                artist: t['artist'] ?? 'NAS 音乐库',
                style: t['style'],
                bpm: t['bpm'],
                energy: null,
                reason: '按风格与时长生成的 NAS 舞程',
                color: const Color(0xFFC9F044),
                durationMs: ((t['duration'] as num) * 1000).round())
          ]);
        }
      }
      queue = v3Tracks.map((t) => t.id).toList();
      nowPlaying = v3Tracks.first;
      queueIndex = 0;
      v3Style = plan['style'] as String;
      _receiveV3(Map<String, dynamic>.from(result['state'] as Map));
      final started = await realtimeEngine
          .command('start', {'trackId': rawTracks.first['id']});
      _receiveV3(Map<String, dynamic>.from(started['state'] as Map));
    } catch (e) {
      v3Error = e is PlatformException ? e.message : '舞程启动失败，请重试。';
    } finally {
      v3Loading = false;
      _changed();
    }
  }
}
