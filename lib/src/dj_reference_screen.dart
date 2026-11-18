part of 'app.dart';

/// One immutable, Jetson-approved case; ordinary playback never adopts its rules.
class DjReferenceScreen extends StatefulWidget {
  const DjReferenceScreen(this.c, {super.key});
  final AppController c;
  @override
  State<DjReferenceScreen> createState() => _DjReferenceScreenState();
}

class _DjReferenceScreenState extends State<DjReferenceScreen> {
  final _feedback = DjReferenceFeedbackStore();
  StreamSubscription<Map<String, dynamic>>? _subscription;
  Map<String, dynamic> _state = {};
  String? _error, _preference;
  bool _pending = true, _saving = false, _leaving = false;
  int _epoch = 0;
  late final bool _accessoryWasLocked;
  Future<void>? _closing;
  AppController get c => widget.c;
  Map<String, dynamic> get data =>
      Map<String, dynamic>.from(_state['djReference'] as Map? ?? {});
  Map<String, dynamic>? get spec =>
      data['case'] is Map ? Map<String, dynamic>.from(data['case']) : null;
  @override
  void initState() {
    super.initState();
    _accessoryWasLocked = c.accessoryLocked;
    unawaited(_initialize());
  }

  Future<void> _initialize() async {
    try {
      await c.stopForLongmix();
      if (!mounted || _leaving) return;
      c.accessoryLocked = true;
      _subscription = c.realtimeEngine.states.listen((state) {
        if (mounted && !_leaving && state['djReference'] is Map) {
          setState(() => _state = state);
        }
      });
      await _prepare();
    } catch (e) {
      if (mounted && !_leaving) {
        setState(() {
          _error = '$e';
          _pending = false;
        });
      }
    }
  }

  void _accept(Map<String, dynamic> reply) {
    if (reply['ok'] == false) throw StateError('${reply['error'] ?? '操作失败'}');
    if (reply['state'] is Map) {
      _state = Map<String, dynamic>.from(reply['state']);
    }
  }

  Future<void> _prepare() async {
    if (_leaving) return;
    final epoch = _epoch;
    setState(() {
      _pending = true;
      _error = null;
    });
    try {
      final reply =
          await c.realtimeEngine.command('prepare', {'mode': 'dj-reference'});
      if (!mounted || _leaving || epoch != _epoch) return;
      setState(() => _accept(reply));
      final id = spec?['id'];
      if (id is String) {
        final record = await _feedback.read(id);
        if (mounted && !_leaving && epoch == _epoch) {
          setState(() => _preference = record?['preference'] as String?);
        }
      }
    } catch (e) {
      if (mounted && !_leaving && epoch == _epoch) {
        setState(() => _error = '$e');
      }
    } finally {
      if (mounted && !_leaving && epoch == _epoch) {
        setState(() => _pending = false);
      }
    }
  }

  Future<void> _command(String method,
      [Map<String, dynamic> args = const {}]) async {
    if (_leaving || (_pending && method != 'djStop')) return;
    if (method == 'djStop') _epoch++;
    final epoch = _epoch;
    setState(() {
      _pending = true;
      _error = null;
    });
    try {
      final reply = await c.realtimeEngine.command(method, args);
      if (mounted && !_leaving && epoch == _epoch) {
        setState(() => _accept(reply));
      }
    } catch (e) {
      if (mounted && !_leaving && epoch == _epoch) {
        setState(() => _error = '$e');
      }
    } finally {
      if (mounted && !_leaving && epoch == _epoch) {
        setState(() => _pending = false);
      }
    }
  }

  Future<void> _choose(String preference) async {
    if (_saving || _leaving || spec == null) return;
    setState(() => _saving = true);
    try {
      final reply = await c.realtimeEngine.command('djSnapshot');
      if (!mounted || _leaving) return;
      _accept(reply);
      final id = spec?['id'];
      if (id is! String) throw StateError('对照身份尚未就绪');
      await _feedback.save(
          caseId: id,
          preference: preference,
          variant: data['variant']?.toString() ?? 'original',
          coverage: Map<String, dynamic>.from(data['coverage'] as Map? ?? {}));
      if (mounted && !_leaving) setState(() => _preference = preference);
    } catch (e) {
      if (mounted && !_leaving) setState(() => _error = '$e');
    } finally {
      if (mounted && !_leaving) setState(() => _saving = false);
    }
  }

  Future<void> _close() => _closing ??= _closeOnce();
  Future<void> _closeOnce() async {
    _leaving = true;
    _epoch++;
    await _subscription?.cancel();
    try {
      await c.realtimeEngine
          .command('djClose')
          .timeout(const Duration(seconds: 3));
    } catch (_) {
      try {
        await c.realtimeEngine
            .command('stop')
            .timeout(const Duration(seconds: 3));
      } catch (_) {}
    } finally {
      c.accessoryLocked = _accessoryWasLocked;
    }
  }

  Future<void> _leave() async {
    await _close();
    if (mounted) Navigator.of(context).pop();
  }

  @override
  void dispose() {
    unawaited(_close());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = spec,
        playing = data['playing'] == true,
        paused = data['paused'] == true,
        busy = _pending || data['busy'] == true;
    final duration = (data['duration'] as num? ?? 0).toDouble(),
        position = (data['position'] as num? ?? 0).toDouble();
    final coverage = data['coverage'] as Map? ?? {};
    String heard(String key) {
      final v = coverage[key] as Map? ?? {};
      return '${((v['seconds'] as num?) ?? 0).toStringAsFixed(1)} 秒 · ${(((v['fraction'] as num?) ?? 0) * 100).round()}%';
    }

    final sources = s?['sources'] as Map? ?? {},
        a = sources['a'] as Map? ?? {},
        b = sources['b'] as Map? ?? {};
    return PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop) unawaited(_leave());
        },
        child: Scaffold(
            appBar: AppBar(
                title: const Text('DJ 参考交接对照'),
                leading: IconButton(
                    onPressed: _leave, icon: const Icon(Icons.arrow_back))),
            body: PageFrame(
                label: 'REFERENCE AUDITION',
                title: '同一接点，比较交接。',
                children: [
                  const Text(
                      '原渐混在 8 拍内交接，参考版按示范重建渐入、共同播放和渐出阶段。两版只改变音量曲线。可以随时选择，试听进度会一同保存。'),
                  const SizedBox(height: 16),
                  if (s != null)
                    HardCard(
                        color: HB.mint,
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(s['title']?.toString() ?? '',
                                  style:
                                      Theme.of(context).textTheme.titleMedium),
                              const SizedBox(height: 8),
                              Text('${s['fromTitle']} → ${s['toTitle']}'),
                              Text(
                                  '${s['bpm']} BPM · 参考交接窗口 ${(s['duration'] as num).toStringAsFixed(2)} 秒'),
                              Text(
                                  'A 接点 ${(a['sourceStart'] as num).toStringAsFixed(3)} 秒 · B 接点 ${(b['sourceStart'] as num).toStringAsFixed(3)} 秒'),
                              Text(
                                  'B 原速 ${b['sourceBpm']} BPM，过渡时保调对齐 ${s['bpm']} BPM'),
                              TextButton(
                                  onPressed: () => launchUrl(
                                      Uri.parse(
                                          'https://www.youtube.com/watch?v=aqFRSSYp2bg'),
                                      mode: LaunchMode.externalApplication),
                                  child: const Text('查看 Hapa 官方示范'))
                            ])),
                  const SizedBox(height: 16),
                  Text(data['status']?.toString() ?? '正在读取对照资料…'),
                  if (busy) const LinearProgressIndicator(),
                  if (_error != null ||
                      data['error']?.toString().isNotEmpty == true)
                    Padding(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        child: Text(_error ?? data['error'].toString(),
                            style: const TextStyle(color: HB.error))),
                  if (duration > 0) ...[
                    const SizedBox(height: 12),
                    LinearProgressIndicator(
                        value: (position / duration).clamp(0, 1)),
                    Text(
                        '${position.toStringAsFixed(1)} / ${duration.toStringAsFixed(1)} 秒')
                  ],
                  const SizedBox(height: 16),
                  Wrap(spacing: 10, runSpacing: 10, children: [
                    FilledButton(
                        onPressed: busy || s == null
                            ? null
                            : () => _command('djPlay', {'variant': 'original'}),
                        child: const Text('播放原渐混')),
                    FilledButton(
                        onPressed: busy || s == null
                            ? null
                            : () =>
                                _command('djPlay', {'variant': 'reference'}),
                        child: const Text('播放参考交接')),
                    OutlinedButton(
                        onPressed: busy || !playing && !paused
                            ? null
                            : () => _command(paused ? 'djResume' : 'djPause'),
                        child: Text(paused ? '继续' : '暂停')),
                    OutlinedButton(
                        onPressed: () => _command('djStop'),
                        child: const Text('停止')),
                    if (s == null && !busy)
                      OutlinedButton(
                          onPressed: _prepare, child: const Text('重试读取素材'))
                  ]),
                  const SizedBox(height: 24),
                  Text('原渐混 · ${heard('original')}'),
                  Text('参考交接 · ${heard('reference')}'),
                  const SizedBox(height: 12),
                  const Text('你更喜欢哪一个？',
                      style: TextStyle(fontWeight: FontWeight.bold)),
                  Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: {
                        'original': '原渐混更顺',
                        'reference': '参考交接更顺',
                        'same': '差不多',
                        'neither': '两版都不合适'
                      }
                          .entries
                          .map((e) => ChoiceChip(
                              label: Text(e.value),
                              selected: _preference == e.key,
                              onSelected: s == null || _saving
                                  ? null
                                  : (_) => _choose(e.key)))
                          .toList()),
                  if (_preference != null)
                    const Text('选择已保存在此设备，可随时修改。',
                        style: TextStyle(fontSize: 14, color: HB.muted)),
                  const SizedBox(height: 20),
                  const Text('本入口独立保存这次公开示范的试听选择。',
                      style: TextStyle(fontSize: 14, color: HB.muted)),
                  TextButton(onPressed: _leave, child: const Text('返回普通播放')),
                ])));
  }
}
