part of 'app.dart';

void _openTrack(BuildContext context, AppController c, Track track) {
  _openPhonePage(
      context, c, () => TrackDetail(track: c.currentTrack(track), c: c));
  if (track.isRemote || track.isNas) unawaited(c.loadTrackDetail(track));
}

void _openPhonePage(
    BuildContext context, AppController c, Widget Function() page) {
  Navigator.of(context).push(MaterialPageRoute(
      builder: (_) =>
          AnimatedBuilder(animation: c, builder: (_, __) => page())));
}

class PhoneMixScreen extends StatelessWidget {
  const PhoneMixScreen(this.c, {super.key});
  final AppController c;

  @override
  Widget build(BuildContext context) {
    final pending = c.pendingIntent;
    return PageFrame(
        label: c.v3Active ? 'PLAY / V3 REALTIME' : 'PLAY / PHONE FIRST',
        title: '让身体，跟着节奏。',
        children: [
          if (c.v3Supported) ...[
            Row(children: [
              Expanded(
                  child: HardButton(
                      label: '标准播放',
                      selected: !c.v3Active,
                      color: c.v3Active ? HB.white : HB.acid,
                      onPressed: c.v3Loading ? null : c.disableV3)),
              const SizedBox(width: 10),
              Expanded(
                  child: HardButton(
                      label: 'V3 实时混音',
                      selected: c.v3Active,
                      color: c.v3Active ? HB.orange : HB.white,
                      busy: c.v3Loading,
                      onPressed:
                          c.v3Loading || c.audioBusy ? null : c.enableV3)),
            ]),
            const SizedBox(height: 16),
          ],
          if (!c.v3Active && c.v3Error != null)
            Text(c.v3Error!, style: const TextStyle(color: HB.error)),
          Row(children: [
            const Icon(Icons.phone_android, size: 17),
            const SizedBox(width: 6),
            Expanded(
                child: Text(
                    c.v3Active
                        ? c.v3Continuous
                            ? '连续混音 · ${c.v3Tracks.length} 首已发布素材'
                            : c.danceRunning
                                ? '${c.danceRun!['style']} · 自动舞程'
                                : '本机实时混音 · 六首离线试听'
                        : c.isRemoteMode
                            ? '手机播放 · 在线曲库'
                            : '手机播放 · 本地曲库',
                    style: const TextStyle(fontSize: 14))),
            Text(
                c.accessoryConnected
                    ? '${c.accessoryKind.label} · 蓝牙已连接'
                    : '无需连接设备',
                style: const TextStyle(fontSize: 14)),
          ]),
          const SizedBox(height: 18),
          _PlaybackCard(c),
          if (c.isRemoteMode && c.catalogError != null)
            _NetworkNotice(c.catalogError!, onRetry: () => c.refreshCatalog()),
          const SizedBox(height: 24),
          if (c.v3Active) ...[
            Row(children: [
              Expanded(
                  child: HardButton(
                      label: '新版连续混音',
                      selected: c.v3Continuous,
                      color: c.v3Continuous ? HB.acid : HB.white,
                      onPressed:
                          c.v3Loading || c.dancePreparing || c.v3Continuous
                              ? null
                              : () => c.switchV3Mode(true))),
              const SizedBox(width: 10),
              Expanded(
                  child: HardButton(
                      label: '定时舞程',
                      selected: !c.v3Continuous,
                      color: c.v3Continuous ? HB.white : HB.acid,
                      onPressed:
                          c.v3Loading || c.dancePreparing || !c.v3Continuous
                              ? null
                              : () => c.switchV3Mode(false))),
            ]),
            const SizedBox(height: 16),
            if (c.v3Continuous) _ContinuousSetup(c) else _DanceSetup(c),
            const SizedBox(height: 20),
          ],
          if (c.clientIssue != null) ...[
            const SizedBox(height: 16),
            _IssueCard(c),
          ],
          if (c.v3Active)
            _V3Directions(c)
          else ...[
            const SizedBox(height: 26),
            _SectionTitle('能量',
                action: '想要 · ${AppController.energyNames[c.draftEnergy - 1]}'),
            Row(
                children: List.generate(
                    5,
                    (index) => Expanded(
                            child: Padding(
                          padding: EdgeInsets.only(right: index == 4 ? 0 : 5),
                          child: Semantics(
                              selected: c.draftEnergy == index + 1,
                              button: true,
                              label:
                                  '能量 ${index + 1} ${AppController.energyNames[index]}',
                              child: InkWell(
                                onTap: c.directionBusy
                                    ? null
                                    : () => c.editDirection(energy: index + 1),
                                child: Container(
                                    padding: const EdgeInsets.symmetric(
                                        vertical: 12),
                                    decoration: BoxDecoration(
                                        color: c.draftEnergy == index + 1
                                            ? HB.acid
                                            : HB.white,
                                        borderRadius: BorderRadius.circular(12),
                                        border: Border.all(
                                            color: HB.ink, width: 1.5)),
                                    child: Column(children: [
                                      Text('${index + 1}',
                                          style: const TextStyle(
                                              fontSize: 23,
                                              fontWeight: FontWeight.w900)),
                                      Text(AppController.energyNames[index],
                                          style: const TextStyle(fontSize: 14)),
                                    ])),
                              )),
                        )))),
            const SizedBox(height: 8),
            const Text('调整选曲的强弱与密度，音量保持不变。', style: TextStyle(fontSize: 14)),
            const SizedBox(height: 24),
            const _SectionTitle('风格', action: 'NEXT DIRECTION'),
            Row(
                children: AppController.mixStyles
                    .map((style) => Expanded(
                            child: Padding(
                          padding:
                              EdgeInsets.only(right: style == 'House' ? 0 : 7),
                          child: Semantics(
                              selected: c.draftStyle == style,
                              child: HardButton(
                                  label: style,
                                  color: c.draftStyle == style
                                      ? HB.acid
                                      : HB.white,
                                  onPressed: c.directionBusy
                                      ? null
                                      : () => c.editDirection(style: style))),
                        )))
                    .toList()),
            const SizedBox(height: 20),
            if (pending != null)
              HardCard(
                  color: HB.orange,
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(c.applyingDirection ? '正在执行切换' : '等下一个切换点',
                            style: Theme.of(context).textTheme.titleMedium),
                        const SizedBox(height: 8),
                        Text(
                            '${pending.source} · ${pending.direction.style} / 能量 ${pending.direction.energy}'),
                        Text(
                            '接下来：${c.tracks.firstWhere((t) => t.id == pending.direction.trackId).title}'),
                        const SizedBox(height: 6),
                        Text(c.intentFeedback,
                            style: const TextStyle(fontSize: 14)),
                        const SizedBox(height: 12),
                        HardButton(
                            label: '取消这次切换',
                            color: HB.white,
                            onPressed: c.applyingDirection
                                ? null
                                : () => c.cancelDirection()),
                      ]))
            else ...[
              Text(
                  '当前方向：${c.mixStyle} · ${AppController.energyNames[c.energy - 1]}',
                  style: const TextStyle(fontWeight: FontWeight.w900)),
              const SizedBox(height: 10),
              SizedBox(
                  width: double.infinity,
                  child: HardButton(
                      label: c.isPlaying ? '按这个方向混音' : '准备这个音乐方向',
                      onPressed: c.directionDirty && !c.directionBusy
                          ? () => c.requestDirection()
                          : null)),
              if (c.previousDirection != null)
                TextButton.icon(
                    onPressed: c.directionBusy ? null : c.restoreDirection,
                    icon: const Icon(Icons.undo, color: HB.ink),
                    label: const Text('恢复上一个音乐方向',
                        style: TextStyle(color: HB.ink))),
            ],
            const SizedBox(height: 12),
            Semantics(
                liveRegion: true,
                child: Text(c.intentFeedback,
                    style: const TextStyle(fontSize: 14))),
          ],
          const SizedBox(height: 22),
          _SettingsCard(
              title: c.accessoryConnected
                  ? '${c.accessoryKind.label}快捷控制'
                  : '把控制交给饰品',
              detail: c.accessoryConnected
                  ? (c.accessoryLocked ? '防误触已开启' : '轻按、双击、长按 · 动作可自定义')
                  : '手机已经可以播放，连接饰品后控制更顺手',
              icon: Icons.touch_app,
              onTap: () => _openPhonePage(context, c, () => ShortcutScreen(c))),
        ]);
  }
}

class _PlaybackCard extends StatelessWidget {
  const _PlaybackCard(this.c);
  final AppController c;

  @override
  Widget build(BuildContext context) {
    final track = c.displayTrack;
    final busy =
        c.loading || (c.v3Active ? c.v3Busy && !c.isPlaying : c.audioBusy);
    return _PaperSleeve(
        color: HB.teal,
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Wrap(
              spacing: 12,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                        color: HB.mint, borderRadius: BorderRadius.circular(8)),
                    child: Text(
                        busy
                            ? '正在准备'
                            : c.isPlaying
                                ? '正在播放'
                                : '准备就绪',
                        style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            color: HB.deepTeal))),
                Text(
                    c.v3Active
                        ? 'V3 · 实时混音'
                        : track?.resourceLabel ?? (c.loading ? '正在加载' : '选择歌曲'),
                    style: const TextStyle(fontSize: 14, color: HB.muted)),
              ]),
          const SizedBox(height: 20),
          Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
            RecordSleeve(
                size: 88,
                color: track == null ? HB.mint : HB.sleeve(track.color)),
            const SizedBox(width: 16),
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  Text(track?.title ?? '今天，跳什么？',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.headlineLarge),
                  const SizedBox(height: 6),
                  Text(track?.artist ?? '选一首喜欢的音乐开始',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: HB.muted, fontSize: 14)),
                ])),
          ]),
          const SizedBox(height: 20),
          Text(
              c.v3Active
                  ? '${c.v3Style} · ${track?.bpmLabel ?? '—'} BPM · 实时交接'
                  : track?.isRenderedMix == true
                      ? 'Hip-Hop · 125–149.4 BPM · 6 首连续混音'
                      : '${track?.mixStyle ?? c.mixStyle} · ${track == null ? 'BPM 待分析' : '${track.bpmLabel} BPM'} · 能量 ${c.energy}',
              style: const TextStyle(color: HB.muted, fontSize: 14)),
          const SizedBox(height: 20),
          ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                  value: c.duration.inMilliseconds <= 0
                      ? 0
                      : (c.position.inMilliseconds / c.duration.inMilliseconds)
                          .clamp(0, 1),
                  color: HB.deepTeal,
                  backgroundColor: HB.mint,
                  minHeight: 4)),
          Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 12,
              children: [
                Text(
                    '${FullPlayer._time(c.position)} / ${FullPlayer._time(c.duration)}',
                    style: const TextStyle(
                        color: HB.muted,
                        fontSize: 14,
                        fontFeatures: [FontFeature.tabularFigures()])),
                TextButton(
                    onPressed: c.nowPlaying == null
                        ? null
                        : () => _openPhonePage(context, c, () => FullPlayer(c)),
                    child: const Text('播放队列 →')),
              ]),
          Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
            Expanded(
                child: TextButton(
                    style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 4, vertical: 12)),
                    onPressed: c.v3Active
                        ? c.v3Continuous
                            ? null
                            : c.cycleV3Budget
                        : c.directionBusy || track?.isRenderedMix == true
                            ? null
                            : c.togglePracticeLoop,
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      Icon(c.v3Active ? Icons.timelapse : Icons.repeat_rounded,
                          size: 24),
                      const SizedBox(height: 8),
                      Text(
                          c.v3Active
                              ? c.v3Continuous
                                  ? '等待 18s'
                                  : '等待 ${c.v3Budget}s'
                              : c.loopPreview
                                  ? '结束循环'
                                  : '循环 16 拍',
                          textAlign: TextAlign.center),
                    ]))),
            Expanded(
                child: PlaybackButton(
                    label: c.isPlaying
                        ? '暂停播放'
                        : c.v3Active && c.v3State['current'] != null
                            ? '继续播放'
                            : '开始播放',
                    playing: c.isPlaying,
                    busy: busy,
                    onPressed: c.loading ||
                            (c.v3Active
                                ? c.v3Loading || (!c.isPlaying && c.v3Busy)
                                : c.applyingDirection)
                        ? null
                        : c.togglePlayback)),
            Expanded(
                child: TextButton(
                    style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 4, vertical: 12)),
                    onPressed: c.directionBusy ||
                            !c.isPlaying ||
                            (c.v3Continuous &&
                                c.continuousSelection['status'] != 'ready')
                        ? null
                        : () => c.nextTrack(),
                    child:
                        const Column(mainAxisSize: MainAxisSize.min, children: [
                      Icon(Icons.skip_next_rounded, size: 24),
                      SizedBox(height: 8),
                      Text('下一首 / 混入', textAlign: TextAlign.center),
                    ]))),
          ]),
          if (c.v3Active)
            Center(
                child: TextButton.icon(
                    onPressed: c.v3Stop,
                    icon: const Icon(Icons.stop_rounded, size: 20),
                    label: const Text('停止混音'))),
          const Divider(height: 24),
          Text(
              c.v3Active
                  ? '选点、EQ 和双轨混音实时执行。锁屏或离开 App 会暂停。'
                  : track?.isRenderedMix == true
                      ? 'V3 已渲染试听 · 6 首连续混音，当前播放无需联网。'
                      : track?.isNas == true
                          ? 'NAS 原曲可在线播放；下一首使用手机实时混音，和完整 V3 试听分别提供。'
                          : track?.isLocal == true
                              ? '正在播放本机音频。上传到云端后可获取音乐分析。'
                              : track?.isRemote == true
                                  ? '点下一首进行混音；缺少节拍或人声数据时使用原速淡化。'
                                  : c.isRemoteMode
                                      ? '从云端曲库或本机音乐选择歌曲。'
                                      : '示例曲共用试听音频；16 拍按示例 BPM 截取，未做节拍对齐。',
              style: const TextStyle(color: HB.muted, fontSize: 14)),
        ]));
  }
}

class _V3Directions extends StatelessWidget {
  const _V3Directions(this.c);
  final AppController c;
  @override
  Widget build(BuildContext context) {
    final pending = c.v3Pending;
    final plan = c.v3Plan;
    final enabled = c.isPlaying && !c.v3Busy;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SizedBox(height: 26),
      if (!c.v3Continuous) ...[
        const _SectionTitle('能量', action: 'NEXT DIRECTION'),
        Row(children: [
          Expanded(
              child: HardButton(
                  label: '降低能量 ↓',
                  color: HB.white,
                  onPressed: enabled ? () => c.v3Request('down') : null)),
          const SizedBox(width: 10),
          Expanded(
              child: HardButton(
                  label: '提高能量 ↑',
                  color: HB.acid,
                  onPressed: enabled ? () => c.v3Request('up') : null)),
        ]),
        const SizedBox(height: 8),
        const Text('按局部能量寻找下一首，保持输出音量。', style: TextStyle(fontSize: 14)),
        if (!c.danceRunning) ...[
          const SizedBox(height: 24),
          const _SectionTitle('风格', action: 'NEXT DIRECTION'),
          Row(
              children: ['Trap', 'Grime']
                  .map((style) => Expanded(
                      child: Padding(
                          padding:
                              EdgeInsets.only(right: style == 'Trap' ? 10 : 0),
                          child: HardButton(
                              label: style,
                              color: c.v3Style == style ? HB.acid : HB.white,
                              onPressed: enabled
                                  ? () => c.v3Request('style', style: style)
                                  : null))))
                  .toList()),
        ],
      ],
      const SizedBox(height: 20),
      HardCard(
          color: pending != null ? HB.orange : HB.white,
          shadow: false,
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(
                pending != null
                    ? (pending['locked'] == true ? '正在交接' : '已安排下一首')
                    : '混音状态',
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            if (pending != null)
              Text(
                  '${pending['title']} · ${(pending['remaining'] as num).toStringAsFixed(1)} 秒后接管'),
            Semantics(
                liveRegion: true,
                child: Text(c.v3Error ?? c.intentFeedback,
                    style: const TextStyle(fontSize: 14))),
            if (pending != null || c.v3State['busy'] == true) ...[
              const SizedBox(height: 12),
              HardButton(
                  label: pending?['locked'] == true ? '交接已锁定' : '取消这次切换',
                  color: HB.white,
                  onPressed: pending?['locked'] == true ? null : c.v3Cancel),
            ],
          ])),
      const SizedBox(height: 20),
      _SectionTitle(
          c.v3Continuous
              ? '边听边选下一首'
              : c.danceRunning
                  ? '本次歌单'
                  : '六首精选',
          action: c.v3Continuous || c.danceRunning
              ? '${c.v3Tracks.length} TRACKS'
              : 'HIP-HOP / SIX'),
      DropdownButtonFormField<String>(
          key: ValueKey(
              '${c.nowPlaying?.id}:${c.continuousSelection['id']}:${c.continuousState['label']}'),
          initialValue: c.v3Tracks.any((t) =>
                  t.id ==
                  (c.v3Continuous && c.continuousSelection['id'] != null
                      ? 'nas:${c.continuousSelection['id']}'
                      : c.nowPlaying?.id))
              ? c.v3Continuous && c.continuousSelection['id'] != null
                  ? 'nas:${c.continuousSelection['id']}'
                  : c.nowPlaying!.id
              : null,
          isExpanded: true,
          decoration: const InputDecoration(
              border: HB.inputBorder,
              contentPadding:
                  EdgeInsets.symmetric(horizontal: 12, vertical: 10)),
          items: c.v3Tracks.map((t) {
            final entry =
                c.v3Catalog.firstWhere((e) => 'nas:${e['id']}' == t.id);
            final label = c.continuousState['label'] as String? ?? '';
            final allowed = !c.v3Continuous ||
                (entry['playStatus'] != 'unavailable' &&
                    (label.isEmpty ||
                        (entry['styleLabels'] as List? ?? []).contains(label)));
            return DropdownMenuItem(
                value: t.id, enabled: allowed, child: Text(t.title));
          }).toList(),
          onChanged:
              c.v3Loading || (!c.v3Continuous && c.v3Busy) || c.danceRunning
                  ? null
                  : (id) {
                      if (id != null) {
                        c.play(c.v3Tracks.firstWhere((t) => t.id == id));
                      }
                    }),
      const SizedBox(height: 8),
      Text(
          c.v3Continuous
              ? '选歌会在后台准备；点“下一首 / 混入”交接。已经开始的交接会先完成，再准备新选择。'
              : c.danceRunning
                  ? '系统会自动寻找窗口混入下一首，也可点“下一首 / 混入”。'
                  : '播放中选歌会寻找交接窗口；暂停时选歌会从头开始。',
          style: const TextStyle(fontSize: 14)),
      const SizedBox(height: 18),
      if (plan != null)
        HardCard(
            shadow: false,
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${plan['from']} → ${plan['to']}',
                  style: const TextStyle(fontWeight: FontWeight.w900)),
              const SizedBox(height: 8),
              Text(
                  '${plan['bars']} 小节 · ×${(plan['rate'] as num).toStringAsFixed(3)} · ${plan['dynamicEq'] == true ? '动态均衡' : plan['midDuck'] == true ? '人声中频 −5 dB' : '原声中频'}',
                  style: const TextStyle(fontSize: 14)),
              const SizedBox(height: 6),
              Text('${plan['reason']}', style: const TextStyle(fontSize: 14)),
            ])),
      const SizedBox(height: 8),
      Wrap(spacing: 10, children: [
        TextButton.icon(
            onPressed: (c.v3State['logCount'] as num? ?? 0) > 0
                ? () => c.v3Export('json')
                : null,
            icon: const Icon(Icons.download, size: 17),
            label: const Text('保存混音日志')),
        TextButton(
            onPressed: (c.v3State['logCount'] as num? ?? 0) > 0
                ? () => c.v3Export('md')
                : null,
            child: const Text('保存决策说明')),
      ]),
      Text(
          c.v3Continuous
              ? '准备完成后在手机实时衔接；没有合适窗口时保留当前播放。'
              : c.danceRunning
                  ? '使用 NAS 已预处理歌曲，每首截取最多 150 秒参与舞程；暂停不计入跳舞时长。'
                  : '当前六首每首最多 150 秒；小节与风格结果仍待人工确认。',
          style: const TextStyle(fontSize: 14)),
    ]);
  }
}

class _ContinuousSetup extends StatelessWidget {
  const _ContinuousSetup(this.c);
  final AppController c;
  @override
  Widget build(BuildContext context) {
    final state = c.continuousState;
    final selection = c.continuousSelection;
    final labels = c.v3Catalog
        .expand((t) => (t['styleLabels'] as List? ?? []).whereType<String>())
        .toSet()
        .toList()
      ..sort();
    final label = state['label'] as String? ?? '';
    final volume = (state['volume'] as num? ?? .85).toDouble();
    final status = switch (selection['status']) {
      'loading' => '正在准备下一首，当前歌曲继续播放…',
      'queued' => '新选择已排队，当前交接完成后开始准备。',
      'ready' => '下一首已就绪，可以点“下一首 / 混入”。',
      'failed' => selection['error']?.toString() ?? '下一首暂时无法准备，请换一首。',
      _ => '选择歌曲后开始，播放中可以继续选歌。',
    };
    return HardCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('边听，边选下一首。', style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 8),
      Text(
          state['preview'] == true
              ? '当前可用 ${c.v3Tracks.length} 首已发布试听，每首最多 150 秒。完整曲库素材尚未上线。'
              : '已连接完整连续曲库；按需准备歌曲和下一首。',
          style: const TextStyle(fontSize: 14)),
      const SizedBox(height: 14),
      DropdownButtonFormField<String>(
        key: ValueKey('continuous-style-$label'),
        initialValue: labels.contains(label) ? label : '',
        isExpanded: true,
        decoration:
            const InputDecoration(labelText: '下一首风格', border: HB.inputBorder),
        items: [
          const DropdownMenuItem(value: '', child: Text('全部风格')),
          ...labels.map((s) => DropdownMenuItem(value: s, child: Text(s)))
        ],
        onChanged: (value) {
          if (value != null) c.continuousFilter(label: value);
        },
      ),
      SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('自动接歌'),
          subtitle:
              const Text('临近曲尾时自动衔接已准备的歌曲', style: TextStyle(fontSize: 14)),
          activeThumbColor: HB.blue,
          value: state['automatic'] != false,
          onChanged: c.continuousAutomatic),
      Row(children: [
        const Text('音量', style: TextStyle(fontSize: 14)),
        Expanded(
            child: Slider(
                value: volume.clamp(0, 1),
                activeColor: HB.blue,
                label: '${(volume * 100).round()}%',
                onChanged: c.continuousVolume)),
        Text('${(volume * 100).round()}%',
            style: const TextStyle(fontSize: 14)),
      ]),
      Semantics(
          liveRegion: true,
          child: Text(status, style: const TextStyle(fontSize: 14))),
      if ((state['notice'] as String? ?? '').isNotEmpty) ...[
        const SizedBox(height: 8),
        Text(state['notice'] as String, style: const TextStyle(fontSize: 14)),
      ],
    ]));
  }
}

class _DanceSetup extends StatelessWidget {
  const _DanceSetup(this.c);
  final AppController c;
  @override
  Widget build(BuildContext context) {
    final run = c.danceRun;
    final editable = !c.isPlaying && !c.dancePreparing && !c.v3Loading;
    final selected = c.dancePlan;
    final songs = (selected?['tracks'] as List? ?? []).cast<Map>();
    return HardCard(
        color: HB.paper,
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const _SectionTitle('本次舞程', action: 'YOUR DANCE SET'),
          const SizedBox(height: 12),
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
                flex: 3,
                child: DropdownButtonFormField<String>(
                    key: ValueKey(
                        'dance-style-${c.danceStyle}-${c.danceStyles.length}'),
                    initialValue: c.danceStyle,
                    isExpanded: true,
                    decoration: const InputDecoration(
                        labelText: '音乐风格', border: HB.inputBorder),
                    items: (c.danceStyles.isEmpty
                            ? [
                                {'style': c.danceStyle, 'count': 0}
                              ]
                            : c.danceStyles)
                        .map((s) => DropdownMenuItem<String>(
                            value: s['style'] as String,
                            child: Text('${s['style']}',
                                overflow: TextOverflow.ellipsis)))
                        .toList(),
                    onChanged:
                        editable ? (v) => c.setDanceOptions(style: v) : null)),
            const SizedBox(width: 10),
            Expanded(
                flex: 2,
                child: DropdownButtonFormField<int>(
                    key: ValueKey(
                        'dance-minutes-${c.danceStyle}-${c.danceMinutes}'),
                    initialValue: c.danceMinutes,
                    isExpanded: true,
                    decoration: const InputDecoration(
                        labelText: '大概跳多久', border: HB.inputBorder),
                    items: [5, 10, 15, 20, 30]
                        .map((m) => DropdownMenuItem(
                            value: m,
                            enabled: c.danceDurations.contains(m),
                            child: Text('$m 分钟')))
                        .toList(),
                    onChanged: editable
                        ? (v) => c.setDanceOptions(minutes: v)
                        : null)),
          ]),
          const SizedBox(height: 12),
          if (c.danceCatalogLoading)
            const Text('正在读取可混音曲库…', style: TextStyle(fontSize: 14))
          else if (c.danceStyles.isEmpty)
            HardButton(
                label: '读取 NAS 曲库',
                color: HB.white,
                onPressed: c.loadDanceStyles)
          else
            Text(
                c.danceDurations.isEmpty
                    ? '${c.danceStyle} 暂无足够的兼容素材，请选择其他风格。'
                    : '从 ${c.danceEligible} 首可混音歌曲中选曲，按节拍和时长自动安排。',
                style: const TextStyle(fontSize: 14)),
          if (c.danceError != null) ...[
            const SizedBox(height: 8),
            Text(c.danceError!,
                style: const TextStyle(fontSize: 14, color: HB.error)),
            TextButton(
                onPressed: c.loadDanceStyles, child: const Text('刷新可用曲库')),
          ],
          const SizedBox(height: 14),
          if (c.dancePreparing) ...[
            const LinearProgressIndicator(color: HB.ink),
            const SizedBox(height: 8),
            Text(c.danceMessage, style: const TextStyle(fontSize: 14)),
            TextButton(
                onPressed: c.cancelDancePreparation, child: const Text('取消等待')),
          ] else if (selected == null)
            HardButton(
                label: '自动选歌',
                color: HB.acid,
                onPressed: editable && c.danceDurations.contains(c.danceMinutes)
                    ? () => c.prepareDance()
                    : null)
          else ...[
            Text(
                '${selected['style']} · 约 ${(selected['seconds'] as num) ~/ 60} 分钟 · ${songs.length} 首',
                style: const TextStyle(fontWeight: FontWeight.w900)),
            const SizedBox(height: 8),
            ...songs.take(5).map((s) => Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text('${songs.indexOf(s) + 1}. ${s['title']}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 14)))),
            if (songs.length > 5)
              Text('另有 ${songs.length - 5} 首，开始后可查看完整歌单',
                  style: const TextStyle(fontSize: 14)),
            const SizedBox(height: 12),
            HardButton(
                label: '开始这场舞程',
                color: HB.acid,
                busy: c.v3Loading,
                onPressed: editable ? c.startDance : null),
            TextButton(
                onPressed:
                    editable ? () => c.prepareDance(reshuffle: true) : null,
                child: const Text('换一组歌曲')),
          ],
          if (run != null) ...[
            const SizedBox(height: 12),
            LinearProgressIndicator(
                value: ((run['elapsed'] as num? ?? 0) /
                        (run['total'] as num? ?? 1))
                    .clamp(0, 1)
                    .toDouble(),
                color: HB.ink),
            const SizedBox(height: 8),
            Text(
                '${run['message']} · ${FullPlayer._time(Duration(seconds: (run['elapsed'] as num? ?? 0).floor()))} / ${FullPlayer._time(Duration(seconds: (run['total'] as num? ?? 0).floor()))}',
                style: const TextStyle(fontSize: 14)),
          ],
          const SizedBox(height: 8),
          const Text('首次需联网准备素材；开始后自动衔接，到时淡出。锁屏或离开 App 会暂停。',
              style: TextStyle(fontSize: 14)),
        ]));
  }
}

class _IssueCard extends StatelessWidget {
  const _IssueCard(this.c);
  final AppController c;
  @override
  Widget build(BuildContext context) => HardCard(
      color: const Color(0xFFFFD4C9),
      shadow: false,
      child: Row(children: [
        Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(c.clientIssue!.title,
              style: const TextStyle(fontWeight: FontWeight.w900)),
          Text(c.clientIssue!.detail, style: const TextStyle(fontSize: 14)),
        ])),
        IconButton(
            tooltip: '关闭提示',
            onPressed: c.clearClientIssue,
            icon: const Icon(Icons.close))
      ]));
}

class _SettingsCard extends StatelessWidget {
  const _SettingsCard(
      {required this.title,
      required this.detail,
      required this.icon,
      required this.onTap,
      this.color = HB.white});
  final String title;
  final String detail;
  final IconData icon;
  final VoidCallback onTap;
  final Color color;
  @override
  Widget build(BuildContext context) => HardCard(
      color: color,
      onTap: onTap,
      child: Row(children: [
        Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
                color: HB.mint, borderRadius: BorderRadius.circular(12)),
            child: Icon(icon, size: 24, color: HB.deepTeal)),
        const SizedBox(width: 12),
        Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title,
              style:
                  const TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
          const SizedBox(height: 5),
          Text(detail, style: const TextStyle(fontSize: 14)),
        ])),
        const Icon(Icons.chevron_right),
      ]));
}

class PersonalScreen extends StatelessWidget {
  const PersonalScreen(this.c, {super.key});
  final AppController c;
  @override
  Widget build(BuildContext context) =>
      PageFrame(label: 'PROFILE / PERSONAL', title: '你的音乐，你的节奏。', children: [
        HardCard(
            color: HB.acid,
            child: Row(children: [
              const CircleAvatar(
                  backgroundColor: HB.ink,
                  foregroundColor: HB.white,
                  child: Icon(Icons.person)),
              const SizedBox(width: 12),
              Expanded(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                    Text(
                        c.hasBackendSession
                            ? (c.accountName ?? '已连接账号')
                            : '未登录',
                        style: const TextStyle(fontWeight: FontWeight.w900)),
                    Text(
                        c.hasBackendSession
                            ? '已登录 · 音乐在手机，控制在手边。'
                            : '登录后使用自己的云端曲库。',
                        style: const TextStyle(fontSize: 14)),
                  ])),
            ])),
        const SizedBox(height: 25),
        if (c.accountError != null)
          _NetworkNotice(c.accountError!, onRetry: c.loadAccountProfile),
        _SettingsCard(
            title: '音乐服务',
            detail: c.isRemoteMode
                ? (c.catalogError == null
                    ? '在线曲库 · ${c.remoteRepository!.config.baseUri.host}'
                    : '连接异常 · 点击设置或重试')
                : '示例模式 · 连接你的后端曲库',
            icon: Icons.cloud_outlined,
            onTap: () => _openPhonePage(context, c, () => BackendScreen(c))),
        const SizedBox(height: 18),
        _SettingsCard(
            title: '我的曲库',
            detail: '${c.library.length} 首收藏 · ${c.playlists.length} 个歌单',
            icon: Icons.library_music,
            onTap: () {
              c.setMusicSection(2);
              c.setTab(1);
            }),
        const SizedBox(height: 18),
        _SettingsCard(
            title: '饰品快捷控制',
            detail: '动作映射与防误触 · 保存在手机',
            icon: Icons.touch_app,
            onTap: () => _openPhonePage(context, c, () => ShortcutScreen(c))),
        const SizedBox(height: 18),
        _SettingsCard(
            title: '我的饰品',
            detail: c.accessoryConnected
                ? '${c.accessoryKind.label}已连接 · 蓝牙'
                : '添加戒指、手环或项链',
            icon: Icons.sensors,
            color: HB.orange,
            onTap: () => _openPhonePage(context, c, () => AccessoryScreen(c))),
        const SizedBox(height: 25),
        const Text('手机负责播放与选曲。饰品断开时，音乐继续。',
            style: TextStyle(fontWeight: FontWeight.w900)),
        const SizedBox(height: 18),
        const ExpansionTile(
            tilePadding: EdgeInsets.zero,
            title: Text('后续设备扩展'),
            children: [
              Padding(
                  padding: EdgeInsets.only(bottom: 16),
                  child: Text(
                      'HiFi Core 的独立音频输出、Pad 与 Party 共玩留待后续版本接入。当前播放无需 RK3588；原有预设数据继续保留。')),
            ]),
        if (c.usageHistory.isNotEmpty) ...[
          const SizedBox(height: 16),
          const _SectionTitle('历史使用记录', action: 'ARCHIVE'),
          ...c.usageHistory.map((r) => ListTile(
              title: Text(r.title),
              subtitle: Text(
                  '${r.trackCount} 首 · ${r.endedAt.month}/${r.endedAt.day}'))),
        ],
      ]);
}

class AccessoryScreen extends StatelessWidget {
  const AccessoryScreen(this.c, {super.key});
  final AppController c;
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('我的饰品'), backgroundColor: HB.paper),
        body: PageFrame(
            label: 'ACCESSORY / PERSONAL',
            title: '让控制，触手可及。',
            children: [
              const Text('BLE / 手机负责播放，饰品负责控制',
                  style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14)),
              const SizedBox(height: 22),
              HardCard(
                  color: HB.acid,
                  child: SizedBox(
                      height: 130,
                      child: Center(
                          child: Icon(
                              switch (c.accessoryKind) {
                                AccessoryKind.ring => Icons.circle_outlined,
                                AccessoryKind.band => Icons.watch_outlined,
                                AccessoryKind.pendant => Icons.diamond_outlined
                              },
                              size: 85,
                              color: HB.ink)))),
              const SizedBox(height: 22),
              Row(
                  children: AccessoryKind.values
                      .map((kind) => Expanded(
                              child: Padding(
                            padding: const EdgeInsets.only(right: 6),
                            child: HardButton(
                                label: kind.label,
                                color: c.accessoryKind == kind
                                    ? HB.acid
                                    : HB.white,
                                onPressed: () => c.setAccessoryKind(kind)),
                          )))
                      .toList()),
              const SizedBox(height: 22),
              if (c.accessoryStatus == AccessoryStatus.disconnected) ...[
                const Text('让你的饰品靠近手机，并按设备说明进入广播状态。'),
                const SizedBox(height: 16),
                HardButton(label: '查找附近饰品', onPressed: c.discoverAccessory),
              ] else if (c.accessoryStatus == AccessoryStatus.discovering) ...[
                const LinearProgressIndicator(color: HB.ink),
                const SizedBox(height: 16),
                const Text('正在查找附近的真实蓝牙设备…'),
                const SizedBox(height: 16),
                HardButton(
                    label: '取消查找',
                    color: HB.white,
                    onPressed: c.cancelDiscovery),
              ] else if (c.accessoryStatus == AccessoryStatus.confirming) ...[
                HardCard(
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                      Text('正在连接 ${c.ble.selected?.name ?? '饰品'}',
                          style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 8),
                      const LinearProgressIndicator(color: HB.ink),
                    ])),
                TextButton(
                    onPressed: c.disconnectAccessory,
                    child: const Text('取消连接')),
              ] else ...[
                HardCard(
                    color: HB.acid,
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                              '${c.ble.selected?.name ?? c.accessoryKind.label}已连接',
                              style: Theme.of(context).textTheme.titleMedium),
                          const SizedBox(height: 8),
                          Text(c.ble.controlsReady
                              ? '快捷控制已配置'
                              : '连接成功 · 待配置设备按键协议'),
                          const SizedBox(height: 12),
                          HardButton(
                              label: '设置设备按键协议',
                              color: HB.white,
                              onPressed: c.ble.channels.isEmpty
                                  ? null
                                  : () => _openPhonePage(
                                      context, c, () => BleProtocolScreen(c))),
                          const SizedBox(height: 16),
                          HardButton(
                              label: '调整快捷控制',
                              color: HB.white,
                              onPressed: () => _openPhonePage(
                                  context, c, () => ShortcutScreen(c))),
                        ])),
                const SizedBox(height: 14),
                TextButton.icon(
                    onPressed: c.disconnectAccessory,
                    icon: const Icon(Icons.link_off),
                    label: const Text('断开连接')),
              ],
              const SizedBox(height: 16),
              Text(c.ble.message, style: const TextStyle(fontSize: 14)),
              if (c.accessoryStatus == AccessoryStatus.discovering ||
                  c.accessoryStatus == AccessoryStatus.disconnected)
                ...c.ble.peers.values.map((peer) => Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: HardCard(
                        child: ListTile(
                            contentPadding: EdgeInsets.zero,
                            title: Text(peer.name),
                            subtitle: Text('${peer.id}\n信号 ${peer.rssi} dBm'),
                            trailing: const Icon(Icons.chevron_right),
                            onTap: () => c.ble.connect(peer))))),
              const SizedBox(height: 24),
              HardButton(
                  label: '返回播放',
                  color: HB.white,
                  onPressed: () {
                    c.setTab(0);
                    Navigator.of(context).popUntil((r) => r.isFirst);
                  }),
            ]),
      );
}

class BleProtocolScreen extends StatefulWidget {
  const BleProtocolScreen(this.c, {super.key});
  final AppController c;
  @override
  State<BleProtocolScreen> createState() => _BleProtocolScreenState();
}

class _BleProtocolScreenState extends State<BleProtocolScreen> {
  BleNotifyChannel? selected;
  final inputs = {
    for (final gesture in AccessoryGesture.values)
      gesture: TextEditingController()
  };
  String? error;
  @override
  void dispose() {
    for (final input in inputs.values) {
      input.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ble = widget.c.ble;
    return Scaffold(
        appBar: AppBar(title: const Text('设备按键协议'), backgroundColor: HB.paper),
        body: PageFrame(label: 'BLE / CONTROLS', title: '设定你的控制方式。', children: [
          const Text('根据饰品固件说明选择通知特征，并填写三个按键对应的完整数据包。未知格式不会触发播放控制。'),
          const SizedBox(height: 18),
          ...ble.channels.map((channel) => ListTile(
              leading: Icon(selected == channel
                  ? Icons.radio_button_checked
                  : Icons.radio_button_off),
              onTap: () => setState(() => selected = channel),
              title: Text(channel.characteristic,
                  style: const TextStyle(fontSize: 14)),
              subtitle: Text('服务 ${channel.service}',
                  style: const TextStyle(fontSize: 14)))),
          for (final gesture in AccessoryGesture.values)
            Padding(
                padding: const EdgeInsets.only(top: 12),
                child: TextField(
                    controller: inputs[gesture],
                    maxLength: 191,
                    decoration: InputDecoration(
                        labelText: '${gesture.label} · 十六进制数据',
                        hintText: '按固件协议填写'))),
          if (error != null)
            Text(error!, style: const TextStyle(color: HB.error)),
          const SizedBox(height: 16),
          HardButton(
              label: '订阅按键通知',
              onPressed: selected == null || !widget.c.accessoryConnected
                  ? null
                  : () async {
                      try {
                        final mapping = GesturePacketMap(
                            inputs.map((k, v) => MapEntry(k, v.text)));
                        await ble.bind(selected!, mapping);
                        if (mounted) setState(() => error = null);
                      } on FormatException catch (e) {
                        setState(() => error = e.message);
                      } catch (_) {
                        if (mounted) {
                          setState(() => error = '订阅失败，请重新连接后选择通知特征。');
                        }
                      }
                    }),
          const SizedBox(height: 20),
          Text(ble.message),
          if (ble.lastPacket.isNotEmpty)
            SelectableText('最近收到：${ble.lastPacket}'),
        ]));
  }
}

class ShortcutScreen extends StatelessWidget {
  const ShortcutScreen(this.c, {super.key});
  final AppController c;
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('饰品快捷控制'), backgroundColor: HB.paper),
        body: PageFrame(
            label: 'CONTROL / YOUR WAY',
            title: '轻触一下，继续跳。',
            children: [
              Text(
                  '${c.accessoryKind.label} · ${c.accessoryConnected ? '蓝牙已连接' : '未连接'}'),
              const SizedBox(height: 12),
              const Text('给三个动作分配常用操作。设置保存在手机，下次连接继续使用。'),
              if (!c.accessoryConnected) ...[
                const SizedBox(height: 16),
                HardButton(
                    label: '先添加你的饰品',
                    onPressed: () =>
                        _openPhonePage(context, c, () => AccessoryScreen(c))),
              ],
              const SizedBox(height: 22),
              ...AccessoryGesture.values.map((gesture) => Padding(
                    padding: const EdgeInsets.only(bottom: 14),
                    child: HardCard(
                        shadow: false,
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(gesture.label,
                                  style: const TextStyle(
                                      fontWeight: FontWeight.w900)),
                              DropdownButton<ShortcutAction>(
                                  isExpanded: true,
                                  value: c.shortcutMapping[gesture],
                                  items: ShortcutAction.values
                                      .map((a) => DropdownMenuItem(
                                          value: a, child: Text(a.label)))
                                      .toList(),
                                  onChanged: (action) {
                                    if (action != null) {
                                      c.setShortcut(gesture, action);
                                    }
                                  }),
                            ])),
                  )),
              HardCard(
                  color: c.accessoryLocked ? HB.orange : HB.white,
                  shadow: false,
                  child: SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: const Text('防误触锁定',
                          style: TextStyle(fontWeight: FontWeight.w900)),
                      subtitle: Text(c.accessoryLocked
                          ? '饰品动作暂不执行，手机仍可操作'
                          : '练舞时可随时锁定饰品控制'),
                      activeTrackColor: HB.ink,
                      value: c.accessoryLocked,
                      onChanged: (_) => c.toggleAccessoryLock())),
              const SizedBox(height: 24),
              const _SectionTitle('试试快捷动作', action: 'DEMO'),
              const Text('这里模拟饰品按键，与手机按钮使用相同的方向控制。',
                  style: TextStyle(fontSize: 14)),
              const SizedBox(height: 12),
              Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: AccessoryGesture.values
                      .map((g) => HardButton(
                          label: g.label,
                          color: HB.white,
                          onPressed: c.accessoryConnected
                              ? () => c.handleGesture(g)
                              : null))
                      .toList()),
              const SizedBox(height: 12),
              Semantics(
                  liveRegion: true,
                  child: Text(c.intentFeedback,
                      style: const TextStyle(fontSize: 14))),
              ExpansionTile(
                  tilePadding: EdgeInsets.zero,
                  title: const Text('交互边界演示'),
                  children: [
                    SwitchListTile(
                        title: const Text('模拟没有匹配曲目'),
                        value: c.simulateNoMatch,
                        onChanged: c.setNoMatchSimulation),
                    const Padding(
                        padding: EdgeInsets.only(bottom: 12),
                        child: Text('示例目录和试听音频随 App 提供。断网仍可试用；真实蓝牙与节拍过渡尚未接入。',
                            style: TextStyle(fontSize: 14))),
                  ]),
              const SizedBox(height: 18),
              HardButton(
                  label: '回到音乐',
                  onPressed: () {
                    c.setTab(0);
                    Navigator.of(context).popUntil((r) => r.isFirst);
                  }),
            ]),
      );
}

class SearchImportPanel extends StatefulWidget {
  const SearchImportPanel(this.c, {super.key});
  final AppController c;
  @override
  State<SearchImportPanel> createState() => _SearchImportPanelState();
}

class _SearchImportPanelState extends State<SearchImportPanel> {
  int mode = 0;
  late final TextEditingController query =
      TextEditingController(text: widget.c.searchQuery);
  final link = TextEditingController();
  bool parsed = false;
  String? linkError;
  @override
  void dispose() {
    query.dispose();
    link.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.c;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Wrap(
          spacing: 7,
          runSpacing: 8,
          children: List.generate(
              3,
              (i) => HardButton(
                  label: ['搜索', '本地音频', '链接'][i],
                  color: mode == i ? HB.acid : HB.white,
                  onPressed: () => setState(() => mode = i)))),
      const SizedBox(height: 18),
      if (c.isRemoteMode) ...[
        HardButton(
            label: c.hasBackendSession ? '上传到云端' : '登录后上传音乐',
            color: HB.acid,
            onPressed: () => _openPhonePage(
                context,
                c,
                () => c.hasBackendSession
                    ? CloudUploadScreen(c)
                    : BackendScreen(c))),
        const SizedBox(height: 18),
      ],
      if (mode == 0) ...[
        TextField(
            controller: query,
            onChanged: c.setSearchQuery,
            decoration: const InputDecoration(
                labelText: '歌曲、艺人、舞种或 BPM',
                hintText: '试试 Popping 或 104',
                prefixIcon: Icon(Icons.search),
                filled: true,
                fillColor: HB.white,
                border: HB.inputBorder)),
        const SizedBox(height: 20),
        if (c.searching) const LinearProgressIndicator(),
        if (c.searchError != null)
          _NetworkNotice(c.searchError!, onRetry: () => c.searchRemote()),
        if (!c.searching && c.searchError == null && c.searchResults.isEmpty)
          const _Placeholder(section: '没有找到', copy: '试试更短的关键词，或导入本地音频。'),
        ...c.searchResults.map((t) => TrackCard(
            track: t,
            playing: c.isPlaying && c.nowPlaying?.id == t.id,
            saved: c.library.contains(t.id),
            onSave: () => c.save(t),
            onOpen: () => _openTrack(context, c, t),
            onPlay: () async {
              await c.play(t);
              c.setTab(0);
            })),
        if (c.nextSearchCursor != null && !c.searching)
          HardButton(
              label: '更多搜索结果', onPressed: () => c.searchRemote(more: true)),
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
              const Text('MP3 / WAV / M4A / AAC / FLAC / OGG'),
              const SizedBox(height: 14),
              HardButton(
                  label: '导入本地音频',
                  color: HB.white,
                  onPressed: c.importLocalAudio),
            ])),
        const SizedBox(height: 14),
        const Text('导入后可直接播放。BPM、调性与能量分析尚未接入。浏览器导入仅本次可用，刷新后需要重新选择文件；手机版会保留音频。',
            style: TextStyle(fontSize: 14)),
        const SizedBox(height: 18),
        if (c.clientIssue != null) _IssueCard(c),
        ...c.tracks.where((t) => t.isLocal).map((t) => ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.audio_file),
            title: Text(t.title),
            subtitle: const Text('本地导入 · 分析待接入'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _openTrack(context, c, t))),
      ] else ...[
        TextField(
            controller: link,
            keyboardType: TextInputType.url,
            onChanged: (_) => setState(() {
                  parsed = false;
                  linkError = null;
                }),
            decoration: InputDecoration(
                labelText: '音乐或歌单链接',
                hintText: 'https://…',
                errorText: linkError,
                filled: true,
                fillColor: HB.white,
                border: HB.inputBorder)),
        const SizedBox(height: 14),
        HardButton(
            label: '演示解析结果',
            onPressed: () {
              final uri = Uri.tryParse(link.text.trim());
              setState(() {
                parsed = uri != null &&
                    ['http', 'https'].contains(uri.scheme) &&
                    uri.host.isNotEmpty;
                linkError = parsed ? null : '请输入完整的 http 或 https 链接';
              });
            }),
        const SizedBox(height: 14),
        const Text('链接用于查找歌曲信息。这里仅展示示例结果，不请求外部平台；播放仍需可用音频。',
            style: TextStyle(fontSize: 14)),
        if (parsed) ...[
          const SizedBox(height: 20),
          const Text('示例匹配 · 非实际解析',
              style: TextStyle(fontWeight: FontWeight.w900)),
          const SizedBox(height: 10),
          ...c.tracks.where((t) => t.id == 'midnight').map((t) => TrackCard(
              track: t,
              playing: false,
              saved: c.library.contains(t.id),
              onPlay: () {},
              onSave: () => c.save(t),
              onOpen: () => _openTrack(context, c, t))),
        ],
      ],
    ]);
  }
}
