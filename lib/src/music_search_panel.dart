part of 'app.dart';

class SearchImportPanel extends StatefulWidget {
  const SearchImportPanel(this.c, {super.key});
  final AppController c;
  @override
  State<SearchImportPanel> createState() => _SearchImportPanelState();
}

class _SearchImportPanelState extends State<SearchImportPanel> {
  int mode = 0;
  late final TextEditingController query =
      TextEditingController(text: widget.c.musicSearchQuery);
  final link = TextEditingController();
  Timer? _poll;
  bool _started = false, _busy = false, _linked = false;
  String? _actionError;

  bool get _visible => widget.c.tab == 1 && widget.c.musicSection == 1;

  @override
  void initState() {
    super.initState();
    widget.c.addListener(_changed);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _syncPolling();
    });
  }

  void _changed() {
    if (!mounted) return;
    _syncPolling();
    setState(() {});
  }

  void _syncPolling() {
    if (!_visible) {
      if (_poll != null) widget.c.cancelMusicSearchDebounce();
      _poll?.cancel();
      _poll = null;
      return;
    }
    _poll ??= Timer.periodic(const Duration(seconds: 5), (_) {
      if (mounted && _visible) unawaited(widget.c.refreshMusicJobs());
    });
    if (!_started) {
      _started = true;
      unawaited(widget.c.runMusicSearch());
      unawaited(widget.c.refreshMusicJobs());
    }
  }

  @override
  void dispose() {
    widget.c.removeListener(_changed);
    widget.c.cancelMusicSearchDebounce();
    _poll?.cancel();
    query.dispose();
    link.dispose();
    super.dispose();
  }

  Future<void> _action(Future<void> Function() action) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _actionError = null;
    });
    try {
      await action();
    } catch (error) {
      if (mounted) {
        setState(() => _actionError = error is FormatException
            ? error.message
            : error is ActivityException
                ? error.message
                : '暂时无法完成操作，请重试。');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _match(MusicHit hit) => _action(() async {
        final candidates = await widget.c.matchMusic(hit);
        if (!mounted) return;
        if (candidates.isEmpty) {
          setState(() => _actionError =
              widget.c.musicImportError ?? '暂时没有找到可下载音源，可以换个关键词或导入本地音频。');
          return;
        }
        String? selected;
        final styles = widget.c.musicImportStyles
            .where((s) => s.isNotEmpty)
            .toSet()
            .toList();
        var style = styles.contains(hit.style) ? hit.style : '';
        final candidate = await showDialog<MusicDownloadCandidate>(
          context: context,
          builder: (context) => StatefulBuilder(
              builder: (context, update) => AlertDialog(
                    title: const Text('确认下载版本'),
                    content: SizedBox(
                      width: 460,
                      child: SingleChildScrollView(
                          child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text('搜索歌曲：${hit.title} · ${hit.artist}'),
                          const SizedBox(height: 10),
                          const Text('请核对曲名、作者、时长和版本；匹配结果可能是不同剪辑。'),
                          const SizedBox(height: 8),
                          RadioGroup<String>(
                            groupValue: selected,
                            onChanged: (value) =>
                                update(() => selected = value),
                            child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  ...candidates
                                      .map((item) => RadioListTile<String>(
                                            contentPadding: EdgeInsets.zero,
                                            value: item.candidateId,
                                            title: Text(item.title),
                                            subtitle: Text(
                                                '${item.artist}\n${item.source} · ${_musicDuration(item.durationSeconds)}'),
                                          )),
                                ]),
                          ),
                          const SizedBox(height: 12),
                          DropdownButtonFormField<String>(
                            initialValue: style,
                            isExpanded: true,
                            items: [
                              const DropdownMenuItem(
                                  value: '', child: Text('自动分析')),
                              ...styles.map((value) => DropdownMenuItem(
                                  value: value, child: Text(value))),
                            ],
                            onChanged: (value) => style = value ?? '',
                            decoration: const InputDecoration(
                              labelText: '舞种 / 风格标签',
                              border: HB.inputBorder,
                              helperText: '自动分析，或选择舞种用于筛选。',
                            ),
                          ),
                        ],
                      )),
                    ),
                    actions: [
                      TextButton(
                          onPressed: () => Navigator.pop(context),
                          child: const Text('取消')),
                      FilledButton(
                          onPressed: selected == null
                              ? null
                              : () {
                                  Navigator.pop(
                                      context,
                                      candidates.firstWhere((item) =>
                                          item.candidateId == selected));
                                },
                          child: const Text('下载并分析')),
                    ],
                  )),
        );
        if (candidate != null) {
          await widget.c.downloadMusic(candidate, style: style);
        }
      });

  Future<void> _upload() => _action(() async {
        final file = await FilePicker.pickFile(
          type: FileType.custom,
          allowedExtensions: const ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'],
        );
        if (!mounted || file == null) return;
        final size = await file.length();
        if (size <= 44 || size > 64 * 1024 * 1024) {
          throw const FormatException('请选择不超过 64 MB 的音频文件。');
        }
        final bytes = await file.readAsBytes();
        if (!mounted) return;
        final confirm = await showDialog<bool>(
            context: context,
            builder: (context) => AlertDialog(
                  title: const Text('上传并分析'),
                  content: Text(
                      '${file.name}\n文件将上传到音乐服务，再下载至 NAS 并进行预处理。离开页面后任务继续。'),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(context, false),
                        child: const Text('取消')),
                    FilledButton(
                        onPressed: () => Navigator.pop(context, true),
                        child: const Text('上传并分析')),
                  ],
                ));
        if (confirm == true) {
          await widget.c.uploadMusicAudio(filename: file.name, bytes: bytes);
        }
      });

  @override
  Widget build(BuildContext context) {
    final c = widget.c;
    final result = c.musicSearchResult;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Wrap(
          spacing: 7,
          runSpacing: 8,
          children: List.generate(
              3,
              (i) => HardButton(
                    label: ['搜索', '本地音频', '链接'][i],
                    color: mode == i ? HB.acid : HB.white,
                    onPressed: () {
                      final previous = mode;
                      setState(() {
                        mode = i;
                        _actionError = null;
                      });
                      if (i == 0 && previous == 2) {
                        unawaited(c.runMusicSearch());
                      }
                    },
                  ))),
      const SizedBox(height: 18),
      if (mode == 0) ...[
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final scope
              in const {'library': '曲库内', 'discover': '发现新音乐'}.entries)
            HardButton(
                label: scope.value,
                selected: c.musicSearchScope == scope.key,
                color: c.musicSearchScope == scope.key ? HB.mint : HB.white,
                onPressed: () => c.changeMusicSearchScope(scope.key)),
        ]),
        const SizedBox(height: 16),
        TextField(
          controller: query,
          maxLength: 300,
          onChanged: c.setMusicSearchQuery,
          onSubmitted: (_) => c.runMusicSearch(),
          textInputAction: TextInputAction.search,
          decoration: InputDecoration(
            counterText: '',
            labelText: '歌曲、艺人、舞种或 BPM',
            hintText: c.isRemoteMode ? '歌名、艺人或风格' : '也可以描述：深夜、鼓点重、95 BPM',
            prefixIcon: const Icon(Icons.search),
            filled: true,
            fillColor: HB.white,
            border: HB.inputBorder,
          ),
        ),
        const SizedBox(height: 12),
        if (c.musicSearchScope == 'library')
          Text(c.isRemoteMode ? '搜索已连接服务中的歌曲、艺人或风格。' : '可按歌名查找，也可以描述氛围、节奏和用途。',
              style: const TextStyle(color: HB.muted, fontSize: 14))
        else
          const Text('先查找歌曲，再匹配可下载音源并确认版本。下载与分析完成后才能播放。',
              style: TextStyle(color: HB.muted, fontSize: 14)),
      ] else if (mode == 1) ...[
        HardCard(
            color: HB.acid,
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Icon(Icons.audio_file_outlined, size: 36),
              const SizedBox(height: 12),
              Text('带上自己的音乐',
                  style: Theme.of(context).textTheme.headlineMedium),
              const SizedBox(height: 10),
              const Text(
                  'MP3 / WAV / M4A / AAC / FLAC / OGG · 最大 64 MB · 20 秒至 20 分钟'),
              const SizedBox(height: 14),
              HardButton(
                  label: '上传并分析',
                  color: HB.white,
                  onPressed: _busy ? null : _upload),
            ])),
        const SizedBox(height: 12),
        const Text('上传后由 NAS / Jetson 预处理。分析完成的音乐会进入真实曲库；关闭页面不会中断后台任务。',
            style: TextStyle(fontSize: 14)),
      ] else ...[
        TextField(
            controller: link,
            keyboardType: TextInputType.url,
            onChanged: (_) => setState(() => _linked = false),
            decoration: const InputDecoration(
                labelText: '音乐或歌单链接',
                hintText: 'https://…',
                filled: true,
                fillColor: HB.white,
                border: HB.inputBorder)),
        const SizedBox(height: 14),
        HardButton(
            label: '查找链接中的音乐',
            onPressed: _busy
                ? null
                : () => _action(() async {
                      final uri = Uri.tryParse(link.text.trim());
                      if (uri == null ||
                          !['http', 'https'].contains(uri.scheme) ||
                          uri.host.isEmpty) {
                        throw const FormatException('请输入完整的音乐或歌单链接。');
                      }
                      await c.searchMusicLink(link.text.trim());
                      if (mounted) {
                        setState(() => _linked = c.musicSearchError == null);
                      }
                    })),
        const SizedBox(height: 12),
        const Text('查找真实歌曲信息，确认具体音源后再下载并分析。', style: TextStyle(fontSize: 14)),
      ],
      if (_busy || c.musicSearching) ...[
        const SizedBox(height: 16),
        const LinearProgressIndicator(),
      ],
      if (_actionError != null) ...[
        const SizedBox(height: 12),
        HardCard(color: const Color(0xFFFFD4C9), child: Text(_actionError!)),
      ],
      if (c.musicImportError != null && c.musicImportError != _actionError) ...[
        const SizedBox(height: 12),
        HardCard(
            color: const Color(0xFFFFD4C9), child: Text(c.musicImportError!)),
      ],
      if (mode == 1 && c.musicSearchError != null)
        HardCard(
            color: const Color(0xFFFFD4C9), child: Text(c.musicSearchError!)),
      if (mode == 2 && !_linked && c.musicSearchError != null)
        _NetworkNotice(c.musicSearchError!,
            onRetry: () => _action(() async {
                  await c.searchMusicLink(link.text.trim());
                  if (mounted) {
                    setState(() => _linked = c.musicSearchError == null);
                  }
                })),
      if (c.musicSharedWorkspaceEnabled && c.musicImportJobs.isNotEmpty)
        _jobsPanel(),
      if (mode == 0 || (mode == 2 && _linked)) ...[
        const SizedBox(height: 16),
        if (c.musicSearchError != null)
          _NetworkNotice(c.musicSearchError!, onRetry: c.runMusicSearch),
        if (result?.semanticStatus != null && result?.scope == 'library')
          Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                  result!.semanticStatus == 'semantic' ? '语义搜索' : '关键词搜索',
                  style: const TextStyle(fontSize: 14, color: HB.muted))),
        if (result?.semanticMessage?.isNotEmpty == true)
          Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(result!.semanticMessage!,
                  style: const TextStyle(color: HB.muted, fontSize: 14))),
        if (result?.covered != null && result?.total != null)
          Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text('语义分析覆盖 ${result!.covered} / ${result.total} 首',
                  style: const TextStyle(color: HB.muted, fontSize: 14))),
        if (!c.musicSearching &&
            c.musicSearchError == null &&
            (result?.hits.isEmpty ?? true))
          Text(
              c.musicSearchScope == 'discover' &&
                      query.text.trim().isEmpty &&
                      mode == 0
                  ? '输入歌名或艺人，发现新的音乐。'
                  : '没有找到可用结果，试试其他关键词。',
              style: const TextStyle(color: HB.muted)),
        for (final hit in result?.hits ?? <MusicHit>[]) _hitCard(hit),
      ],
      if (c.musicSharedWorkspaceEnabled && c.musicImportJobs.isEmpty)
        _jobsPanel(),
    ]);
  }

  Widget _jobsPanel() {
    final c = widget.c;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SizedBox(height: 24),
      Row(children: [
        Expanded(
            child:
                Text('我的下载与分析', style: Theme.of(context).textTheme.titleLarge)),
        IconButton(
            tooltip: '刷新任务',
            onPressed: c.musicJobsLoading ? null : c.refreshMusicJobs,
            icon: const Icon(Icons.refresh)),
      ]),
      const SizedBox(height: 8),
      const Text('任务保存在私人工作区，离开页面后继续处理。',
          style: TextStyle(fontSize: 14, color: HB.muted)),
      const SizedBox(height: 12),
      if (c.musicJobsError != null)
        _NetworkNotice(c.musicJobsError!, onRetry: c.refreshMusicJobs),
      if (c.musicImportJobs.isEmpty)
        const Text('还没有下载或上传任务。', style: TextStyle(color: HB.muted)),
      for (final job in c.musicImportJobs) _jobCard(job),
    ]);
  }

  Widget _hitCard(MusicHit hit) => Padding(
      padding: const EdgeInsets.only(top: 14),
      child: HardCard(
        color: HB.white,
        onTap: hit.isLibrary && hit.playable && !_busy
            ? () => _action(() async {
                  final track = await widget.c.musicHitTrack(hit);
                  if (mounted && track != null) {
                    _openTrack(context, widget.c, track);
                  }
                })
            : null,
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            RecordSleeve(size: 58, coverUrl: hit.coverUrl),
            const SizedBox(width: 12),
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  Text(hit.title,
                      style: const TextStyle(
                          fontSize: 18, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 4),
                  Text(hit.artist, style: const TextStyle(color: HB.muted)),
                ])),
          ]),
          const SizedBox(height: 12),
          Text(
              [
                if (hit.provider.isNotEmpty) hit.provider,
                if (hit.style.isNotEmpty) hit.style,
                if (hit.bpm != null) '${hit.bpm} BPM',
                _musicDuration(hit.durationSeconds),
                hit.remoteTrack != null
                    ? hit.remoteTrack!.analysisLabel
                    : hit.isLibrary
                        ? (hit.mixReady
                            ? '可混音'
                            : hit.playable
                                ? '可播放 · 混音未就绪'
                                : '音频待就绪')
                        : '外部歌曲信息 · 尚未下载'
              ].join(' · '),
              style: const TextStyle(color: HB.muted, fontSize: 14)),
          const SizedBox(height: 12),
          if (hit.isLibrary) ...[
            HardButton(
                label: '手机播放',
                color: HB.mint,
                onPressed: hit.playable
                    ? () async {
                        await widget.c.playMusicHit(hit);
                      }
                    : null),
            const SizedBox(height: 8),
            HardButton(
                label: widget.c.library
                        .contains(hit.remoteTrack?.id ?? 'nas:${hit.trackId}')
                    ? '已保存'
                    : '加入曲库',
                color: HB.white,
                onPressed: !hit.playable ||
                        widget.c.library.contains(
                            hit.remoteTrack?.id ?? 'nas:${hit.trackId}')
                    ? null
                    : () => _action(() async {
                          final track = await widget.c.musicHitTrack(hit);
                          if (track != null) await widget.c.save(track);
                        })),
          ] else
            HardButton(
                label: '匹配下载音源',
                color: HB.mint,
                onPressed: _busy ? null : () => _match(hit)),
        ]),
      ));

  Widget _jobCard(MusicImportJob job) => Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: HardCard(
        color: HB.white,
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            RecordSleeve(size: 48, coverUrl: job.coverUrl),
            const SizedBox(width: 12),
            Expanded(
                child: Text(job.title,
                    style: const TextStyle(fontWeight: FontWeight.w800))),
          ]),
          const SizedBox(height: 10),
          Text(job.statusLabel),
          if (!job.terminal) ...[
            const SizedBox(height: 10),
            LinearProgressIndicator(value: job.progress)
          ],
          if (job.error?.isNotEmpty == true) ...[
            const SizedBox(height: 8),
            Text(job.error!,
                style: const TextStyle(color: HB.muted, fontSize: 14))
          ],
          if (job.playable) ...[
            const SizedBox(height: 8),
            Text(job.mixReady ? '已完成分析，可播放及混音。' : '音频可播放，混音素材尚未就绪。',
                style: const TextStyle(fontSize: 14, color: HB.muted)),
            const SizedBox(height: 12),
            HardButton(
                label: '播放已下载音乐',
                color: HB.mint,
                onPressed: () async {
                  await widget.c.playMusicJob(job);
                }),
            const SizedBox(height: 8),
            HardButton(
                label: '查看歌曲',
                color: HB.white,
                onPressed: () async {
                  final track = await widget.c.musicJobTrack(job);
                  if (mounted && track != null) {
                    _openTrack(context, widget.c, track);
                  }
                }),
          ] else if (job.state == 'failed') ...[
            const SizedBox(height: 12),
            HardButton(
                label: '重试任务', onPressed: () => widget.c.retryMusicJob(job)),
          ],
        ]),
      ));
}

String _musicDuration(num? seconds) {
  if (seconds == null || seconds <= 0) return '时长未知';
  final rounded = seconds.round();
  return '${rounded ~/ 60}:${(rounded % 60).toString().padLeft(2, '0')}';
}
