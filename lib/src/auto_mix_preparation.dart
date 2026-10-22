import 'dart:async';
import 'package:flutter/foundation.dart';
import 'activity_repository.dart';

/// Normal playback uses the existing authenticated preparation/publisher queue.
/// No administrator credential or server path crosses this boundary.
class AutoMixPreparation extends ChangeNotifier {
  AutoMixPreparation(this.repository, this.deliver,
      {this.debounce = const Duration(milliseconds: 800),
      this.pollInterval = const Duration(seconds: 5)});
  final ActivityRepository repository;
  final Future<void> Function(Map<String, dynamic>, String) deliver;
  final Duration debounce, pollInterval;
  Timer? _timer;
  int _generation = 0;
  bool _disposed = false;
  String _key = '';
  String state = 'idle', message = '';
  String? packId;

  void request(List<String> styles, int energy, {bool retry = false}) {
    final labels = styles.toSet().toList()..sort();
    final key = '${labels.join('|')}::$energy';
    if (labels.isEmpty || labels.length > 8) return;
    if (!retry && key == _key && state != 'error') return;
    _key = key;
    final generation = ++_generation;
    _timer?.cancel();
    state = 'waiting';
    message = '正在为你的方向准备音乐';
    packId = null;
    notifyListeners();
    _timer = Timer(debounce, () => _prepare(labels, energy, generation));
  }

  bool _valid(int generation) => !_disposed && generation == _generation;
  void _publish(String status, String text) {
    state = status;
    message = text;
    notifyListeners();
  }

  Future<void> _prepare(List<String> styles, int energy, int generation) async {
    try {
      final existing = await repository.list();
      if (!_valid(generation)) return;
      String key(List<String> values) =>
          (List<String>.of(values)..sort()).join('|');
      final matches = existing
          .where((r) =>
              r.name.startsWith('自动接歌 · ') &&
              r.energy == energy &&
              key(r.styles) == key(styles) &&
              r.trackLimit == 4)
          .toList();
      // Reopen the same durable request after app restarts; never create one
      // reservation per poll, song, or repeated direction tap.
      var reservation = matches.isNotEmpty
          ? matches.first
          : await repository.create(
              name:
                  '自动接歌 · ${styles.length == 1 ? styles.first : '自由风格'} · $energy',
              styles: styles,
              startsAt: DateTime.now(),
              durationMinutes: 60,
              energy: energy,
              trackLimit: 4);
      if (!_valid(generation)) return;
      packId = reservation.packId;
      if (const ['failed', 'partial', 'stale'].contains(reservation.state) ||
          reservation.state == 'ready' && !reservation.hasJetsonStrategies) {
        reservation = await repository.retry(reservation.id);
      }
      final started = DateTime.now();
      while (_valid(generation)) {
        if (reservation.playable && reservation.hasJetsonStrategies) {
          final manifest = await repository.manifest(reservation.packId);
          if (!_valid(generation)) return;
          await deliver(manifest, reservation.name);
          if (_valid(generation)) _publish('delivered', '云端已就绪，正在下载分轨');
          return;
        }
        if (const ['failed', 'stale'].contains(reservation.state)) {
          throw const ActivityException('这组音乐暂未准备成功，当前歌曲继续播放，可重试。');
        }
        if (DateTime.now().difference(started) > const Duration(minutes: 30)) {
          throw const ActivityException('云端仍在准备，稍后重试会接着已有进度继续。');
        }
        _publish(
            'preparing',
            reservation.total > 0
                ? '云端正在准备接点 · ${reservation.prepared}/${reservation.total}'
                : '正在选曲、准备并发布分轨，当前歌曲继续播放');
        await Future<void>.delayed(pollInterval);
        if (!_valid(generation)) return;
        reservation = await repository.get(reservation.id);
      }
    } catch (e) {
      if (_valid(generation)) {
        _publish('error',
            e is ActivityException ? e.message : '音乐准备暂未连接，当前歌曲继续播放，可重试。');
      }
    }
  }

  void cancel() {
    _generation++;
    _timer?.cancel();
    _key = '';
    if (!_disposed) _publish('idle', '');
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    _timer?.cancel();
    super.dispose();
  }
}
