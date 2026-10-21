part of 'controller.dart';

extension ActivityFlow on AppController {
  void _restoreActivities(Map<String, dynamic> state) {
    final saved = state['activities'];
    if (saved is! List) return;
    activities = saved
        .whereType<Map>()
        .map((v) {
          try {
            return ActivityReservation.fromJson(Map<String, dynamic>.from(v));
          } catch (_) {
            return null;
          }
        })
        .whereType<ActivityReservation>()
        .toList();
  }

  Future<void> loadActivities({bool quiet = false}) async {
    if (activitiesLoading || activityRestoring || _disposed) return;
    final generation = _activityGeneration;
    activitiesLoading = true;
    if (!quiet) activityError = null;
    _changed();
    try {
      final result = await activityRepository.list();
      if (_disposed || generation != _activityGeneration) return;
      activities = result;
      activityError = null;
      await _persist();
    } catch (e) {
      if (!_disposed && generation == _activityGeneration) {
        activityError = _activityMessage(e);
      }
    } finally {
      if (!_disposed && generation == _activityGeneration) {
        activitiesLoading = false;
        _changed();
      }
    }
  }

  String _activityMessage(Object e) =>
      e is ActivityException ? e.message : '预约操作未完成，请重试。';
  void _keepActivity(ActivityReservation reservation) {
    activities = [
      reservation,
      ...activities.where((a) => a.id != reservation.id)
    ];
    unawaited(_persist());
    _changed();
  }

  Future<ActivityReservation?> saveActivity(
      {required String name,
      required List<String> styles,
      required DateTime startsAt,
      required int durationMinutes,
      required int energy,
      required int trackLimit,
      ActivityReservation? reuse}) async {
    if (activityBusy) return null;
    activityBusy = true;
    activityError = null;
    _changed();
    try {
      final result = reuse == null
          ? await activityRepository.create(
              name: name,
              styles: styles,
              startsAt: startsAt,
              durationMinutes: durationMinutes,
              energy: energy,
              trackLimit: trackLimit)
          : await activityRepository.reuse(reuse.id, startsAt, durationMinutes);
      if (_disposed) return null;
      _keepActivity(result);
      return result;
    } catch (e) {
      activityError = _activityMessage(e);
      return null;
    } finally {
      activityBusy = false;
      _changed();
    }
  }

  Future<ActivityReservation?> refreshActivity(String id) async {
    if (_disposed || activityRestoring) return null;
    final generation = _activityGeneration;
    try {
      final result = await activityRepository.get(id);
      if (_disposed || generation != _activityGeneration) return null;
      activityError = null;
      _keepActivity(result);
      return result;
    } catch (e) {
      if (!_disposed && generation == _activityGeneration) {
        activityError = _activityMessage(e);
        _changed();
      }
      return null;
    }
  }

  Future<void> retryActivity(String id) async {
    if (activityBusy) return;
    activityBusy = true;
    activityError = null;
    _changed();
    try {
      _keepActivity(await activityRepository.retry(id));
    } catch (e) {
      activityError = _activityMessage(e);
    } finally {
      activityBusy = false;
      _changed();
    }
  }

  Future<bool> openActivity(ActivityReservation reservation) async {
    if (activityBusy || !reservation.playable) return false;
    activityBusy = true;
    activityError = null;
    _changed();
    try {
      final manifest = await activityRepository.manifest(reservation.packId);
      if (_disposed) return false;
      if (v3Active && !v3Metric) await disableV3();
      if (!v3Active) await enableV3(mode: 'metric');
      if (!v3Active || !v3Metric) {
        throw ActivityException(v3Error ?? '当前设备暂时无法启动混音播放。');
      }
      await realtimeEngine.command('stop');
      final bound = await realtimeEngine.command(
          'setSession', {'manifest': manifest, 'name': reservation.name});
      if (bound['state'] is Map) {
        _receiveV3(Map<String, dynamic>.from(bound['state']));
      }
      final first = manifest['initialTrackId']?.toString();
      if (first == null || !v3Catalog.any((t) => t['id'] == first)) {
        throw const ActivityException('这个 set 的首曲暂不可用，请更新素材。');
      }
      await setSmartDirection(
          level: reservation.energy,
          style: reservation.styles.length == 1 ? reservation.styles.first : '',
          automatic: true);
      if (v3Error != null) throw ActivityException(v3Error!);
      final result = await realtimeEngine.command('start', {'trackId': first});
      if (result['state'] is Map) {
        _receiveV3(Map<String, dynamic>.from(result['state']));
      }
      activeActivityId = reservation.id;
      activeActivityName = reservation.name;
      tab = 0;
      await _persist();
      return true;
    } catch (e) {
      activityError = _activityMessage(e);
      return false;
    } finally {
      activityBusy = false;
      _changed();
    }
  }

  Future<void> cacheActivity(ActivityReservation reservation) async {
    if (activityBusy) return;
    activityBusy = true;
    activityError = null;
    _changed();
    try {
      final manifest = await activityRepository.manifest(reservation.packId);
      if (v3Active && !v3Metric) {
        throw const ActivityException('请先退出其他播放工具，再准备本机素材。');
      }
      if (!v3Active) await enableV3(mode: 'metric');
      if (!v3Metric) throw ActivityException(v3Error ?? '当前设备暂不能准备本机素材。');
      final result =
          await realtimeEngine.command('cacheSet', {'manifest': manifest});
      if (result['state'] is Map) {
        _receiveV3(Map<String, dynamic>.from(result['state']));
      }
      final cache = result['cache'];
      if (cache is Map) {
        activityCaches[reservation.packId] = Map<String, dynamic>.from(cache);
      }
    } catch (e) {
      activityError = _activityMessage(e);
    } finally {
      activityBusy = false;
      _changed();
    }
  }

  Map<String, dynamic> activityCache(String packId) {
    final progress = metricState['cache'];
    if (progress is Map && progress['packId'] == packId) {
      return Map<String, dynamic>.from(progress);
    }
    final set = metricState['activitySet'];
    if (set is Map && set['packId'] == packId && set['cache'] is Map) {
      return Map<String, dynamic>.from(set['cache']);
    }
    return activityCaches[packId] ?? {};
  }

  Future<void> exitActivity() async {
    if (v3Metric) {
      await _v3Command('clearSet');
      if (v3Error != null) return;
    }
    activeActivityId = null;
    activeActivityName = null;
    _changed();
  }

  Future<void> restoreActivityBackup(String raw) async {
    if (activityRestoring || _disposed) return;
    final generation = ++_activityGeneration;
    activityRestoring = true;
    activitiesLoading = false;
    activityError = null;
    _changed();
    try {
      await activityRepository.importBackup(raw);
      if (_disposed || generation != _activityGeneration) return;
      activities = [];
      activityRestoring = false;
      await loadActivities();
    } finally {
      if (!_disposed && generation == _activityGeneration) {
        activityRestoring = false;
        _changed();
      }
    }
  }
}
