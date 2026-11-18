part of 'app.dart';

/// Owns the isolated scene engine while the ordinary player stays inactive.
class LongmixScreen extends StatefulWidget {
  const LongmixScreen(this.c, {super.key});
  final AppController c;

  @override
  State<LongmixScreen> createState() => _LongmixScreenState();
}

class _LongmixScreenState extends State<LongmixScreen> {
  StreamSubscription<Map<String, dynamic>>? _subscription;
  Map<String, dynamic> _state = {};
  List<Map<String, dynamic>> _scenes = [];
  String? _selected, _error;
  bool _pending = true,
      _prepared = false,
      _leaving = false,
      _engineClosed = false;
  Future<void>? _closing;
  int _epoch = 0;
  late final bool _accessoryWasLocked;
  AppController get c => widget.c;

  @override
  void initState() {
    super.initState();
    _accessoryWasLocked = c.accessoryLocked;
    unawaited(_initialize());
  }

  Future<void> _initialize() async {
    final epoch = _epoch;
    try {
      await c.stopForLongmix();
      if (!mounted || _leaving) return;
      c.accessoryLocked = true;
      _subscription = c.realtimeEngine.states.listen((state) {
        if (mounted && !_leaving && !c.v3Active) {
          setState(() => _state = state);
        }
      }, onError: (Object error) {
        if (mounted && !_leaving) setState(() => _error = '$error');
      });
      final reply =
          await c.realtimeEngine.command('prepare', {'mode': 'longmix'});
      if (!mounted || _leaving || epoch != _epoch) return;
      setState(() {
        _scenes = (reply['scenes'] as List? ?? [])
            .whereType<Map>()
            .map((s) => Map<String, dynamic>.from(s))
            .toList();
        _selected = _scenes.isEmpty ? null : _scenes.first['id'] as String;
        _accept(reply);
      });
    } catch (error) {
      if (mounted && !_leaving) setState(() => _error = '$error');
    } finally {
      if (mounted && !_leaving) setState(() => _pending = false);
    }
  }

  void _accept(Map<String, dynamic> reply) {
    if (reply['ok'] == false) throw StateError('${reply['error'] ?? '操作失败'}');
    if (reply['state'] is Map) {
      _state = Map<String, dynamic>.from(reply['state'] as Map);
    }
  }

  Future<void> _command(String method,
      [Map<String, dynamic> args = const {}]) async {
    if (_pending || _leaving || _engineClosed) return;
    final epoch = _epoch;
    setState(() {
      _pending = true;
      _error = null;
      if (method == 'loadScene' || method == 'stop') _prepared = false;
    });
    try {
      final reply = await c.realtimeEngine.command(method, args);
      if (!mounted || _leaving || epoch != _epoch) return;
      setState(() {
        _accept(reply);
        if (method == 'loadScene') _prepared = true;
      });
    } catch (error) {
      if (mounted && !_leaving) setState(() => _error = '$error');
    } finally {
      if (mounted && !_leaving && epoch == _epoch) {
        setState(() => _pending = false);
      }
    }
  }

  Future<void> _closeEngine() => _closing ??= _stopAndDispose();

  Future<void> _stopAndDispose() async {
    _epoch++;
    _leaving = true;
    _engineClosed = true;
    unawaited(_subscription?.cancel());
    try {
      await c.realtimeEngine
          .command('stop')
          .timeout(const Duration(seconds: 3));
    } catch (_) {
      // Destroying the native WebView also cancels a preparation still in flight.
    } finally {
      try {
        await c.realtimeEngine.dispose();
      } finally {
        c.accessoryLocked = _accessoryWasLocked;
      }
      c.resetAfterLongmixDisposal();
    }
  }

  Future<void> _leave() async {
    if (_leaving) return;
    setState(() => _leaving = true);
    await _closeEngine();
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _openStable() async {
    // Stable remains reachable even while preparation is pending or has failed.
    await _closeEngine();
    try {
      await const MethodChannel('harbeat/platform')
          .invokeMethod<void>('openStableMix');
    } catch (error) {
      if (mounted) {
        setState(() => _error = error is PlatformException
            ? error.message ?? '无法打开稳定版，请从桌面打开'
            : '无法打开稳定版，请从桌面打开');
      }
    } finally {
      if (mounted) {
        setState(() {
          _leaving = false;
          _pending = false;
          _prepared = false;
          _state = {};
        });
      }
    }
  }

  @override
  void dispose() {
    unawaited(_closeEngine());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final playing = _state['playing'] == true;
    final paused = _state['paused'] == true;
    final enabled = !_pending && !_leaving && !_engineClosed;
    final scene = _state['scene'] as Map?;
    return PopScope(
      // Only _leave pops after cleanup; repeated system back must keep waiting.
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_leave());
      },
      child: Scaffold(
        appBar: AppBar(title: const Text('两来源长混试验')),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          const Text('同一对歌曲、同一交接位置，分别试听普通交接和长混。'),
          const SizedBox(height: 16),
          if (_scenes.isNotEmpty)
            DropdownButtonFormField<String>(
              isExpanded: true,
              initialValue: _selected,
              decoration: const InputDecoration(labelText: '试听场景'),
              items: [
                for (final s in _scenes)
                  DropdownMenuItem(
                      value: s['id'] as String,
                      child: Text('${s['title']}',
                          overflow: TextOverflow.ellipsis))
              ],
              onChanged: enabled && !playing && !paused
                  ? (value) => setState(() {
                        _selected = value;
                        _prepared = false;
                      })
                  : null,
            ),
          const SizedBox(height: 12),
          Text(_pending ? '正在准备，请稍候…' : '${_state['status'] ?? '选择试听方式'}'),
          if (scene != null)
            Text(
                '${scene['title']} · ${scene['variant'] == 'long' ? '长混' : '普通交接'}'),
          if (_state['position'] is num)
            Text(
                '${(_state['position'] as num).toStringAsFixed(1)} / ${((_state['duration'] as num?) ?? 0).toStringAsFixed(1)} 秒'),
          if (scene?['selectedExit'] != null)
            Text('已选退出点：${scene!['selectedExit']}'),
          if (_error != null || _state['error'] != null)
            Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Text(_error ?? '${_state['error']}',
                    style: const TextStyle(color: HB.error))),
          if (!_pending && _scenes.isEmpty && _error == null)
            const Text('暂时没有已批准的试听场景，可以返回普通混音。'),
          const SizedBox(height: 12),
          Wrap(spacing: 8, runSpacing: 8, children: [
            OutlinedButton(
                onPressed: enabled && _selected != null && !playing && !paused
                    ? () => _command('loadScene',
                        {'sceneId': _selected, 'variant': 'reference'})
                    : null,
                child: const Text('准备普通交接')),
            OutlinedButton(
                onPressed: enabled && _selected != null && !playing && !paused
                    ? () => _command(
                        'loadScene', {'sceneId': _selected, 'variant': 'long'})
                    : null,
                child: const Text('准备长混')),
            FilledButton(
                onPressed: enabled && _prepared && !playing && !paused
                    ? () => _command('start')
                    : null,
                child: const Text('播放')),
            OutlinedButton(
                onPressed: enabled && (playing || paused)
                    ? () => _command(paused ? 'resume' : 'pause')
                    : null,
                child: Text(paused ? '继续' : '暂停')),
            OutlinedButton(
                onPressed: enabled && playing && scene?['variant'] == 'long'
                    ? () => _command('exit')
                    : null,
                child: const Text('合适点退出')),
            OutlinedButton(
                onPressed: enabled ? () => _command('stop') : null,
                child: const Text('停止')),
            TextButton(
                onPressed: enabled
                    ? () => _command('export', {'format': 'json'})
                    : null,
                child: const Text('导出试听日志')),
          ]),
          const SizedBox(height: 24),
          OutlinedButton(onPressed: _leave, child: const Text('返回普通混音')),
          TextButton(onPressed: _openStable, child: const Text('打开已安装稳定版')),
        ]),
      ),
    );
  }
}
