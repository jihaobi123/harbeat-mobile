part of 'app.dart';

String _activityStyleKey(String value) =>
    value.toLowerCase().replaceAll(RegExp(r'[\s_-]'), '');

String _activityTime(DateTime value) =>
    '${value.year}/${value.month.toString().padLeft(2, '0')}/${value.day.toString().padLeft(2, '0')} ${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';

class ActivityListScreen extends StatefulWidget {
  const ActivityListScreen(this.c, {super.key});
  final AppController c;
  @override
  State<ActivityListScreen> createState() => _ActivityListScreenState();
}

class _ActivityListScreenState extends State<ActivityListScreen> {
  Timer? _poll;
  bool _backupBusy = false;
  @override
  void initState() {
    super.initState();
    unawaited(widget.c.loadActivities());
    _poll = Timer.periodic(const Duration(seconds: 5), (_) {
      if (ModalRoute.of(context)?.isCurrent == true) {
        unawaited(widget.c.loadActivities(quiet: true));
      }
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _backup(bool importing) async {
    if (_backupBusy || widget.c.activityBusy) return;
    setState(() => _backupBusy = true);
    try {
      if (importing) {
        final file = await FilePicker.pickFile(
            type: FileType.custom, allowedExtensions: ['json']);
        if (file == null) return;
        if (await file.length() > 4096) {
          throw const ActivityException('预约备份过大。');
        }
        final bytes = await file.readAsBytes();
        await widget.c.restoreActivityBackup(utf8.decode(bytes));
      } else {
        final raw = await widget.c.activityRepository.exportBackup();
        await FilePicker.saveFile(
            dialogTitle: '保存私人预约备份',
            fileName: 'harbeat-reservations.json',
            type: FileType.custom,
            allowedExtensions: ['json'],
            bytes: Uint8List.fromList(utf8.encode(raw)));
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(importing ? '已恢复预约备份' : '已提交保存预约备份')));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('预约备份操作未完成，请重试。')));
      }
    } finally {
      if (mounted) setState(() => _backupBusy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
      animation: widget.c,
      builder: (context, _) {
        final c = widget.c;
        return Scaffold(
            appBar: AppBar(title: const Text('我的预约')),
            body: PageFrame(label: 'MY SETS', title: '提前准备，随时再用。', children: [
              const Text('选好活动风格和时间，云端会提前准备交接。活动结束后，set 继续保留。'),
              const SizedBox(height: 16),
              HardButton(
                  label: '新建预约',
                  onPressed: () =>
                      _openPhonePage(context, c, () => ActivityFormScreen(c))),
              const SizedBox(height: 16),
              if (c.activitiesLoading) const LinearProgressIndicator(),
              if (c.activityError != null)
                Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(c.activityError!,
                        style: const TextStyle(color: HB.error))),
              if (c.activities.isEmpty && !c.activitiesLoading)
                const Padding(
                    padding: EdgeInsets.symmetric(vertical: 24),
                    child: Text('还没有预约。创建后，在这里查看准备进度。')),
              ...c.activities.map((a) => Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: HardCard(
                      child: InkWell(
                          onTap: () => _openPhonePage(
                              context, c, () => ActivityDetailScreen(c, a.id)),
                          child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(a.name,
                                    style:
                                        Theme.of(context).textTheme.titleLarge),
                                const SizedBox(height: 8),
                                Text(
                                    '${a.styles.join(' / ')} · ${a.durationMinutes} 分钟'),
                                Text(_activityTime(a.startsAt)),
                                const SizedBox(height: 8),
                                Text(a.ended ? '已结束 · set 已保留' : '已预约',
                                    style: const TextStyle(
                                        fontWeight: FontWeight.bold)),
                                Text(a.preparationLabel),
                                const SizedBox(height: 4),
                                const Text('查看预约 →',
                                    style: TextStyle(color: HB.deepTeal)),
                              ]))))),
              const SizedBox(height: 20),
              const Text('预约保存在当前设备的私人工作区。换手机前导出备份；备份包含访问凭据，请自行保管。',
                  style: TextStyle(fontSize: 14, color: HB.muted)),
              Wrap(spacing: 12, children: [
                TextButton(
                    onPressed: _backupBusy || c.activityBusy
                        ? null
                        : () => _backup(false),
                    child: const Text('导出私人备份')),
                TextButton(
                    onPressed: _backupBusy || c.activityBusy
                        ? null
                        : () => _backup(true),
                    child: const Text('恢复预约备份')),
                TextButton(
                    onPressed: () => c.loadActivities(),
                    child: const Text('刷新'))
              ]),
            ]));
      });
}

class ActivityFormScreen extends StatefulWidget {
  const ActivityFormScreen(this.c, {super.key, this.reuse, this.copy});
  final AppController c;
  final ActivityReservation? reuse, copy;
  @override
  State<ActivityFormScreen> createState() => _ActivityFormScreenState();
}

class _ActivityFormScreenState extends State<ActivityFormScreen> {
  final _form = GlobalKey<FormState>();
  late final TextEditingController _name;
  final _styles = <String>{};
  late DateTime _start;
  int _minutes = 60, _energy = 3, _limit = 8;
  @override
  void initState() {
    super.initState();
    final from = widget.reuse ?? widget.copy;
    _name = TextEditingController(text: from?.name ?? '');
    _styles.addAll(from?.styles ?? ['Hip-Hop']);
    _start = DateTime.now().add(const Duration(hours: 1));
    _minutes = from?.durationMinutes ?? 60;
    _energy = from?.energy ?? 3;
    _limit = from?.trackLimit ?? 8;
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _date() async {
    final now = DateTime.now();
    final day = await showDatePicker(
        context: context,
        initialDate: _start,
        firstDate: DateTime(now.year, now.month, now.day),
        lastDate: now.add(const Duration(days: 365)));
    if (day == null || !mounted) return;
    final time = await showTimePicker(
        context: context, initialTime: TimeOfDay.fromDateTime(_start));
    if (time != null && mounted) {
      setState(() => _start =
          DateTime(day.year, day.month, day.day, time.hour, time.minute));
    }
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    if (_styles.isEmpty || _start.isBefore(DateTime.now())) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('请选择至少一种风格和未来的开始时间。')));
      return;
    }
    final result = await widget.c.saveActivity(
        name: _name.text.trim(),
        styles: _styles.toList(),
        startsAt: _start,
        durationMinutes: _minutes,
        energy: _energy,
        trackLimit: _limit,
        reuse: widget.reuse);
    if (result != null && mounted) {
      Navigator.of(context).pushReplacement(MaterialPageRoute(
          builder: (_) => ActivityDetailScreen(widget.c, result.id)));
    }
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
      animation: widget.c,
      builder: (context, _) {
        final reusing = widget.reuse != null;
        final styleLabels = {
          ...AppController.mixStyles,
          'KPOP',
          'Popping',
          'Locking',
          'Breaking',
          'Jazz Hip-Hop',
          'Boom Bap',
          'Trap',
          'Grime',
          ...widget.c.smartStyles,
          ..._styles
        }.toList();
        final seen = <String>{};
        final styles =
            styleLabels.where((s) => seen.add(_activityStyleKey(s))).toList();
        return Scaffold(
            appBar: AppBar(title: Text(reusing ? '再次预约' : '新建预约')),
            body: PageFrame(
                label: 'RESERVATION',
                title: reusing ? '熟悉的 set，新的时间。' : '为这次活动准备音乐。',
                children: [
                  Form(
                      key: _form,
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            TextFormField(
                                controller: _name,
                                readOnly: reusing,
                                maxLength: 80,
                                decoration:
                                    const InputDecoration(labelText: '预约名称'),
                                validator: (v) => v == null || v.trim().isEmpty
                                    ? '写一个预约名称'
                                    : null),
                            const SizedBox(height: 16),
                            Text(reusing ? '沿用原 set 的风格和素材' : '活动风格（可多选）',
                                style: const TextStyle(
                                    fontWeight: FontWeight.bold)),
                            Wrap(
                                spacing: 8,
                                runSpacing: 6,
                                children: styles
                                    .map((s) => FilterChip(
                                        label: Text(s),
                                        selected: _styles.any((label) =>
                                            _activityStyleKey(label) ==
                                            _activityStyleKey(s)),
                                        onSelected: reusing
                                            ? null
                                            : (yes) => setState(() {
                                                  if (yes &&
                                                      _styles.length < 8) {
                                                    _styles.add(s);
                                                  } else if (!yes) {
                                                    _styles.removeWhere(
                                                        (label) =>
                                                            _activityStyleKey(
                                                                label) ==
                                                            _activityStyleKey(
                                                                s));
                                                  }
                                                })))
                                    .toList()),
                            const SizedBox(height: 20),
                            OutlinedButton.icon(
                                onPressed: widget.c.activityBusy ? null : _date,
                                icon: const Icon(Icons.calendar_month),
                                label: Text('开始时间\n${_activityTime(_start)}',
                                    textAlign: TextAlign.center)),
                            const SizedBox(height: 16),
                            DropdownButtonFormField<int>(
                                initialValue: _minutes,
                                decoration:
                                    const InputDecoration(labelText: '预计活动时长'),
                                items: {
                                  15,
                                  30,
                                  60,
                                  90,
                                  120,
                                  180,
                                  240,
                                  480,
                                  _minutes
                                }
                                    .map((n) => DropdownMenuItem(
                                        value: n, child: Text('$n 分钟')))
                                    .toList(),
                                onChanged: (v) =>
                                    setState(() => _minutes = v ?? 60)),
                            const SizedBox(height: 16),
                            Text(
                                '能量 · ${AppController.energyNames[_energy - 1]}'),
                            Slider(
                                value: _energy.toDouble(),
                                min: 1,
                                max: 5,
                                divisions: 4,
                                onChanged: reusing
                                    ? null
                                    : (v) =>
                                        setState(() => _energy = v.round())),
                            DropdownButtonFormField<int>(
                                initialValue: _limit,
                                decoration:
                                    const InputDecoration(labelText: '候选曲目数量'),
                                items: [4, 8, 12]
                                    .map((n) => DropdownMenuItem(
                                        value: n, child: Text('$n 首')))
                                    .toList(),
                                onChanged: reusing
                                    ? null
                                    : (v) => setState(() => _limit = v ?? 8)),
                            const SizedBox(height: 12),
                            Text(
                                reusing
                                    ? '复用已经准备的素材，不会因为改时间重新生成。'
                                    : '云端只使用已有合格分析的歌曲。候选数量和交接成功数以准备结果为准，活动时长不代表不重复播放保证。',
                                style: const TextStyle(
                                    fontSize: 14, color: HB.muted)),
                            const SizedBox(height: 20),
                            if (widget.c.activityError != null)
                              Text(widget.c.activityError!,
                                  style: const TextStyle(color: HB.error)),
                            HardButton(
                                label: widget.c.activityBusy
                                    ? '正在保存…'
                                    : reusing
                                        ? '保存新时间'
                                        : '预约并开始准备',
                                onPressed:
                                    widget.c.activityBusy ? null : _save),
                          ]))
                ]));
      });
}

class ActivityDetailScreen extends StatefulWidget {
  const ActivityDetailScreen(this.c, this.id, {super.key});
  final AppController c;
  final String id;
  @override
  State<ActivityDetailScreen> createState() => _ActivityDetailScreenState();
}

class _ActivityDetailScreenState extends State<ActivityDetailScreen> {
  Timer? _poll;
  @override
  void initState() {
    super.initState();
    unawaited(widget.c.refreshActivity(widget.id));
    _poll = Timer.periodic(const Duration(seconds: 5), (_) {
      if (ModalRoute.of(context)?.isCurrent == true) {
        unawaited(widget.c.refreshActivity(widget.id));
      }
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
      animation: widget.c,
      builder: (context, _) {
        final c = widget.c;
        final a = c.activities.where((a) => a.id == widget.id).firstOrNull;
        if (a == null) {
          return Scaffold(
              appBar: AppBar(title: const Text('预约详情')),
              body: Center(child: Text(c.activityError ?? '正在读取预约…')));
        }
        final cache = c.activityCache(a.packId),
            completed = cache['completed'] ?? 0,
            total = cache['total'] ?? 0;
        final downloading = cache['state'] == 'downloading';
        final warnings =
            (a.pack['warnings'] as List? ?? []).whereType<String>().toList();
        return Scaffold(
            appBar: AppBar(title: const Text('预约详情')),
            body: PageFrame(label: 'PREPARED SET', title: a.name, children: [
              Text(a.styles.join(' / '),
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              Text('${_activityTime(a.startsAt)} · ${a.durationMinutes} 分钟'),
              Text(a.ended ? '已结束 · 音乐 set 继续保留' : '活动开始前可提前试听'),
              const SizedBox(height: 20),
              HardCard(
                  color: HB.mint,
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('云端素材',
                            style: TextStyle(fontWeight: FontWeight.bold)),
                        const SizedBox(height: 8),
                        Text(a.preparationLabel),
                        if (a.total > 0)
                          Padding(
                              padding: const EdgeInsets.only(top: 10),
                              child: LinearProgressIndicator(
                                  value: (a.prepared / a.total).clamp(0, 1))),
                        if (a.failed > 0) Text('${a.failed} 个交接暂未准备成功'),
                        const SizedBox(height: 8),
                        const Text('关闭网页后，云端仍会继续准备。活动结束不会删除已准备的 set。',
                            style: TextStyle(fontSize: 14))
                      ])),
              if (warnings.isNotEmpty) ...[
                const SizedBox(height: 12),
                const Text('部分歌曲可能缺少合适的交接，播放时会沿用现有安全检查。')
              ],
              const SizedBox(height: 18),
              HardButton(
                  label: c.activityBusy ? '正在处理…' : '进入播放',
                  onPressed: !a.playable || a.state == 'stale' || c.activityBusy
                      ? null
                      : () async {
                          if (await c.openActivity(a) && context.mounted) {
                            Navigator.of(context)
                                .popUntil((route) => route.isFirst);
                          }
                        }),
              const SizedBox(height: 12),
              HardCard(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                    const Text('本机素材',
                        style: TextStyle(fontWeight: FontWeight.bold)),
                    const SizedBox(height: 8),
                    Text(total == 0
                        ? '尚未检查此设备的音频缓存'
                        : '已缓存 $completed / $total 个片段'),
                    if (cache['message'] is String) Text(cache['message']),
                    const SizedBox(height: 8),
                    const Text('在本页下载并验证素材。缓存可能被浏览器清理；云端已就绪不代表手机已下载。',
                        style: TextStyle(fontSize: 14, color: HB.muted)),
                    TextButton(
                        onPressed: !a.playable ||
                                a.state == 'stale' ||
                                c.activityBusy ||
                                downloading
                            ? null
                            : () => c.cacheActivity(a),
                        child: Text(downloading
                            ? '正在准备本机素材…'
                            : c.activityBusy
                                ? '处理中…'
                                : '准备本机素材'))
                  ])),
              const SizedBox(height: 12),
              if (c.activityError != null)
                Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(c.activityError!,
                        style: const TextStyle(color: HB.error))),
              HardButton(
                  label: '再次预约这个 set',
                  color: HB.white,
                  onPressed: c.activityBusy
                      ? null
                      : () => _openPhonePage(
                          context, c, () => ActivityFormScreen(c, reuse: a))),
              if (a.state == 'failed' || a.state == 'partial')
                TextButton(
                    onPressed:
                        c.activityBusy ? null : () => c.retryActivity(a.id),
                    child: const Text('重试未完成的准备')),
              if (a.state == 'stale')
                TextButton(
                    onPressed: c.activityBusy
                        ? null
                        : () => _openPhonePage(
                            context, c, () => ActivityFormScreen(c, copy: a)),
                    child: const Text('按原设置创建更新后的 set')),
              const SizedBox(height: 12),
              const Text('再次预约只新增活动时间，保留原曲目和已准备的交接。新的独立预约可以重新选风格。',
                  style: TextStyle(fontSize: 14, color: HB.muted)),
            ]));
      });
}
