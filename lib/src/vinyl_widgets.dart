part of 'app.dart';

const _recordColors = [HB.mint, HB.peach, HB.lavender, Color(0xFFDBEDF4)];

void _openVinylPage(BuildContext context, Widget page) {
  final reduced = MediaQuery.disableAnimationsOf(context);
  Navigator.of(context).push(PageRouteBuilder<void>(
    transitionDuration: Duration(milliseconds: reduced ? 0 : 520),
    reverseTransitionDuration: Duration(milliseconds: reduced ? 0 : 320),
    pageBuilder: (_, __, ___) => page,
    transitionsBuilder: (_, animation, __, child) => FadeTransition(
      opacity: CurvedAnimation(parent: animation, curve: Curves.easeOut),
      child: child,
    ),
  ));
}

/// Collection artwork is an original graphic sleeve, not album metadata.
class _VinylDisplay extends StatelessWidget {
  const _VinylDisplay(
      {required this.title,
      required this.subtitle,
      required this.index,
      required this.heroTag,
      required this.onOpen,
      this.actions = const []});
  final String title, subtitle, heroTag;
  final int index;
  final VoidCallback onOpen;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final color = _recordColors[index % _recordColors.length];
    return Material(
        color: Colors.transparent,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Semantics(
              button: true,
              label: '展开 $title',
              child: InkWell(
                  onTap: onOpen,
                  borderRadius: HB.radius,
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        AspectRatio(
                            aspectRatio: 1.05,
                            child: LayoutBuilder(
                                builder: (_, box) =>
                                    Stack(clipBehavior: Clip.none, children: [
                                      Positioned(
                                          right: 0,
                                          top: 2,
                                          width: box.maxWidth * .86,
                                          height: box.maxWidth * .86,
                                          child: Hero(
                                              tag: heroTag,
                                              child: _VinylDisc(color: color))),
                                      Positioned(
                                          left: 0,
                                          right: box.maxWidth * .23,
                                          bottom: 5,
                                          height: box.maxHeight * .79,
                                          child: Container(
                                              decoration: BoxDecoration(
                                                  color: color,
                                                  borderRadius:
                                                      BorderRadius.circular(12),
                                                  border: Border.all(
                                                      color: HB.ink,
                                                      width: 1.5),
                                                  boxShadow: const [
                                                    BoxShadow(
                                                        color: HB.ink,
                                                        offset: Offset(0, 3))
                                                  ]),
                                              padding: const EdgeInsets.all(12),
                                              child: ExcludeSemantics(
                                                  child: Column(
                                                      crossAxisAlignment:
                                                          CrossAxisAlignment
                                                              .start,
                                                      mainAxisAlignment:
                                                          MainAxisAlignment
                                                              .spaceBetween,
                                                      children: [
                                                    const Text('HARBEAT',
                                                        textScaler: TextScaler
                                                            .noScaling,
                                                        style: TextStyle(
                                                            fontSize: 9,
                                                            letterSpacing: 1.5,
                                                            fontWeight:
                                                                FontWeight
                                                                    .w800)),
                                                    Icon(
                                                        index.isEven
                                                            ? Icons
                                                                .graphic_eq_rounded
                                                            : Icons
                                                                .album_outlined,
                                                        size: 40,
                                                        color: HB.deepTeal),
                                                    Text(
                                                        'VOL. ${(index + 1).toString().padLeft(2, '0')}',
                                                        textScaler: TextScaler
                                                            .noScaling,
                                                        style: const TextStyle(
                                                            fontSize: 11,
                                                            letterSpacing: 2)),
                                                  ])))),
                                    ]))),
                        const SizedBox(height: 12),
                        Text(title,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                fontSize: 16,
                                height: 1.4,
                                fontWeight: FontWeight.w800)),
                        const SizedBox(height: 6),
                        Text(subtitle,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style:
                                const TextStyle(fontSize: 14, color: HB.muted)),
                      ]))),
          if (actions.isNotEmpty)
            Row(mainAxisAlignment: MainAxisAlignment.end, children: actions),
          const SizedBox(height: 12),
          Container(
              height: 5,
              decoration: BoxDecoration(
                  color: HB.peach,
                  borderRadius: BorderRadius.circular(3),
                  border: Border.all(color: HB.ink, width: 1))),
        ]));
  }
}

class _SavedVinylShelf extends StatelessWidget {
  const _SavedVinylShelf(this.c, this.items);
  final AppController c;
  final List<Track> items;
  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (_, box) {
        final columns = box.maxWidth < 300 ||
                MediaQuery.textScalerOf(context).scale(16) > 21
            ? 1
            : 2;
        return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const _SectionTitle('我的唱片架', action: '点开唱片，展开收藏'),
          const SizedBox(height: 12),
          for (var start = 0; start < items.length; start += columns)
            Padding(
                padding: const EdgeInsets.only(bottom: 26),
                child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (var slot = 0; slot < columns; slot++) ...[
                        if (slot > 0) const SizedBox(width: 20),
                        Expanded(
                            child: start + slot >= items.length
                                ? const SizedBox()
                                : _VinylDisplay(
                                    title: items[start + slot].title,
                                    subtitle: items[start + slot].artist,
                                    index: start + slot,
                                    heroTag: 'saved:${items[start + slot].id}',
                                    onOpen: () => _openVinylPage(
                                        context,
                                        _SavedVinylPage(
                                            c, items[start + slot].id)))),
                      ],
                    ])),
        ]);
      });
}

class _SavedVinylPage extends StatelessWidget {
  const _SavedVinylPage(this.c, this.initialId);
  final AppController c;
  final String initialId;
  @override
  Widget build(BuildContext context) => AnimatedBuilder(
      animation: c,
      builder: (_, __) => _VinylPlaylistPage(
          c: c,
          title: '我的收藏',
          items: c.tracks.where((t) => c.library.contains(t.id)).toList(),
          heroTag: 'saved:$initialId',
          initialId: initialId));
}

class _VinylDisc extends StatefulWidget {
  const _VinylDisc({this.color = HB.apricot, this.playing = false});
  final Color color;
  final bool playing;
  @override
  State<_VinylDisc> createState() => _VinylDiscState();
}

class _VinylDiscState extends State<_VinylDisc>
    with SingleTickerProviderStateMixin {
  late final AnimationController spin =
      AnimationController(vsync: this, duration: const Duration(seconds: 18));
  void syncSpin() {
    if (widget.playing &&
        !MediaQuery.disableAnimationsOf(context) &&
        TickerMode.valuesOf(context).enabled) {
      if (!spin.isAnimating) spin.repeat();
    } else {
      spin.stop();
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    syncSpin();
  }

  @override
  void didUpdateWidget(covariant _VinylDisc oldWidget) {
    super.didUpdateWidget(oldWidget);
    syncSpin();
  }

  @override
  void dispose() {
    spin.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
      child: RepaintBoundary(
          child: RotationTransition(
              key: const ValueKey('vinyl-rotation'),
              turns: spin,
              child: CustomPaint(
                  painter: _VinylPainter(widget.color),
                  size: const Size.square(160)))));
}

class _VinylPainter extends CustomPainter {
  const _VinylPainter(this.color);
  final Color color;
  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    final radius = size.shortestSide / 2 - 2;
    canvas.drawCircle(
        center + const Offset(0, 2), radius, Paint()..color = HB.line);
    canvas.drawCircle(center, radius, Paint()..color = HB.ink);
    final groove = Paint()
      ..color = const Color(0xFF3A4748)
      ..style = PaintingStyle.stroke
      ..strokeWidth = .7;
    for (var i = 0; i < 9; i++) {
      canvas.drawCircle(center, radius * (.43 + i * .06), groove);
    }
    final shine = Paint()
      ..color = const Color(0xFF657474)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    canvas.drawArc(Rect.fromCircle(center: center, radius: radius * .84), -.9,
        .7, false, shine);
    canvas.drawArc(Rect.fromCircle(center: center, radius: radius * .68), 2.24,
        .5, false, shine);
    canvas.drawCircle(center, radius * .32, Paint()..color = color);
    canvas.drawLine(
        center + Offset(-radius * .22, -radius * .1),
        center + Offset(radius * .22, -radius * .1),
        Paint()
          ..color = HB.ink
          ..strokeWidth = 1.5);
    canvas.drawCircle(center, radius * .045, Paint()..color = HB.paper);
    canvas.drawCircle(center, radius * .045, groove);
  }

  @override
  bool shouldRepaint(covariant _VinylPainter oldDelegate) =>
      oldDelegate.color != color;
}

class _VinylPlaylistPage extends StatefulWidget {
  const _VinylPlaylistPage(
      {required this.c,
      required this.title,
      required this.items,
      required this.heroTag,
      this.initialId,
      this.missingCount = 0,
      this.onRemove,
      this.onReorder});
  final AppController c;
  final String title, heroTag;
  final String? initialId;
  final List<Track> items;
  final int missingCount;
  final ValueChanged<Track>? onRemove;
  final ReorderCallback? onReorder;
  @override
  State<_VinylPlaylistPage> createState() => _VinylPlaylistPageState();
}

class _VinylPlaylistPageState extends State<_VinylPlaylistPage>
    with SingleTickerProviderStateMixin {
  late final AnimationController unfold = AnimationController(
      vsync: this, duration: const Duration(milliseconds: 720));
  String? selectedId;
  String? lastPlayingId;
  bool editing = false;
  bool entered = false;
  AppController get c => widget.c;
  bool get busy => c.audioBusy || c.v3Busy || c.applyingDirection;
  Track? get selected =>
      widget.items.where((t) => t.id == selectedId).firstOrNull ??
      widget.items.where((t) => t.id == c.nowPlaying?.id).firstOrNull ??
      widget.items.firstOrNull;
  @override
  void initState() {
    super.initState();
    selectedId = widget.initialId;
    lastPlayingId = c.nowPlaying?.id;
  }

  @override
  void didUpdateWidget(covariant _VinylPlaylistPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (lastPlayingId != c.nowPlaying?.id) {
      lastPlayingId = c.nowPlaying?.id;
      if (widget.items.any((t) => t.id == lastPlayingId)) {
        selectedId = lastPlayingId;
      }
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      unfold.value = 1;
      entered = true;
    } else if (!entered) {
      entered = true;
      unfold.forward();
    }
  }

  @override
  void dispose() {
    unfold.dispose();
    super.dispose();
  }

  Future<void> play(Track track) async {
    if (busy || !track.canPlay) return;
    setState(() => selectedId = track.id);
    c.setQueue(widget.items.map((t) => t.id).toList());
    if (c.nowPlaying?.id == track.id) {
      await c.togglePlayback();
    } else {
      await c.play(track);
    }
  }

  Future<void> step(bool forward) async {
    if (busy) return;
    c.setQueue(widget.items.map((t) => t.id).toList());
    if (forward) {
      await c.nextTrack();
    } else {
      await c.previousTrack();
    }
  }

  void addQueue() {
    c.setQueue([...c.queue, ...widget.items.map((t) => t.id)]);
    ScaffoldMessenger.of(context)
        .showSnackBar(const SnackBar(content: Text('可用音频已加入播放队列')));
  }

  Widget tile(int index) {
    final track = widget.items[index];
    final active = c.nowPlaying?.id == track.id;
    Widget card = _LinkedTrackTile(
        track: track,
        index: index,
        active: active,
        playing: active && c.isPlaying,
        onPlay: busy || !track.canPlay ? null : () => play(track),
        onDetail: () => _openTrack(context, c, track),
        editing: editing,
        onRemove:
            widget.onRemove == null ? null : () => widget.onRemove!(track),
        onMoveUp: widget.onReorder != null && index > 0
            ? () => widget.onReorder!(index, index - 1)
            : null,
        onMoveDown: widget.onReorder != null && index < widget.items.length - 1
            ? () => widget.onReorder!(index, index + 2)
            : null);
    if (widget.onReorder != null) {
      card = ReorderableDelayedDragStartListener(index: index, child: card);
    }
    return KeyedSubtree(
        key: ValueKey(track.id),
        child: AnimatedBuilder(
            animation: unfold,
            child: card,
            builder: (_, child) {
              final begin = (index.clamp(0, 5)) * .055;
              final progress = Curves.easeOutCubic
                  .transform(((unfold.value - begin) / .65).clamp(0.0, 1.0));
              return Opacity(
                  opacity: progress,
                  child: Transform.translate(
                      offset: Offset(35 * (1 - progress), 0), child: child));
            }));
  }

  @override
  Widget build(BuildContext context) {
    final current = selected;
    final playing = current?.id == c.nowPlaying?.id && c.isPlaying;
    final playable = widget.items.any((t) => t.canPlay);
    return Scaffold(
        backgroundColor: HB.paper,
        appBar: AppBar(
            backgroundColor: HB.paper,
            surfaceTintColor: HB.paper,
            title: const Text('我的唱片',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            centerTitle: true,
            leading: Padding(
                padding: const EdgeInsets.all(4),
                child: IconButton(
                    tooltip: '收起唱片',
                    onPressed: () => Navigator.maybePop(context),
                    style: IconButton.styleFrom(
                        backgroundColor: HB.apricot,
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                            side: const BorderSide(color: HB.ink, width: 1.5))),
                    icon: const Icon(Icons.arrow_back_rounded))),
            actions: [
              IconButton(
                  tooltip: editing ? '完成管理' : '管理歌单',
                  onPressed: () => setState(() => editing = !editing),
                  icon:
                      Icon(editing ? Icons.check_rounded : Icons.tune_rounded))
            ]),
        body: Center(
            child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 900),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                          padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
                          child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('ON THE RECORD',
                                    style: TextStyle(
                                        fontSize: 11,
                                        letterSpacing: 2,
                                        color: HB.deepTeal,
                                        fontWeight: FontWeight.w700)),
                                const SizedBox(height: 6),
                                Text(widget.title,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: Theme.of(context)
                                        .textTheme
                                        .displayLarge),
                                const SizedBox(height: 6),
                                Text(
                                    '${widget.items.length} 首音乐${widget.missingCount > 0 ? ' · ${widget.missingCount} 首待加载' : ''}${widget.onReorder != null ? ' · 长按歌曲排序' : ''}',
                                    style: const TextStyle(
                                        fontSize: 14, color: HB.muted)),
                                const SizedBox(height: 8),
                                Row(children: [
                                  Expanded(
                                      child: TextButton.icon(
                                          onPressed: !playable || busy
                                              ? null
                                              : () => play(widget.items
                                                  .firstWhere(
                                                      (t) => t.canPlay)),
                                          icon: const Icon(
                                              Icons.play_circle_outline),
                                          label: const Text('播放全部'))),
                                  Expanded(
                                      child: TextButton.icon(
                                          onPressed:
                                              !playable ? null : addQueue,
                                          icon: const Icon(Icons.queue_music),
                                          label: const Text('加入播放队列'))),
                                ]),
                                if (c.clientIssue != null)
                                  Text(c.clientIssue!.detail,
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                          fontSize: 14, color: HB.error)),
                              ])),
                      Expanded(child: LayoutBuilder(builder: (_, box) {
                        final largeText =
                            MediaQuery.textScalerOf(context).scale(16) > 21;
                        final railWidth = box.maxWidth >= 650
                            ? 176.0
                            : largeText
                                ? 44.0
                                : 80.0;
                        return Row(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              SizedBox(
                                  width: railWidth,
                                  child: ClipRect(
                                      child: AnimatedBuilder(
                                          animation: unfold,
                                          builder: (_, __) =>
                                              Transform.translate(
                                                  offset: Offset(
                                                      -60 *
                                                          (1 -
                                                              Curves
                                                                  .easeOutCubic
                                                                  .transform(unfold
                                                                      .value)),
                                                      0),
                                                  child: Stack(
                                                      clipBehavior: Clip.none,
                                                      children: [
                                                        Positioned.fill(
                                                            child: CustomPaint(
                                                                painter:
                                                                    _RecordRailPainter())),
                                                        Positioned(
                                                            top: 48,
                                                            left:
                                                                railWidth >= 120
                                                                    ? 12
                                                                    : largeText
                                                                        ? -48
                                                                        : -60,
                                                            width: largeText
                                                                ? 112
                                                                : 160,
                                                            height: largeText
                                                                ? 112
                                                                : 160,
                                                            child: Hero(
                                                                tag: widget
                                                                    .heroTag,
                                                                child: _VinylDisc(
                                                                    color: HB
                                                                        .apricot,
                                                                    playing:
                                                                        playing))),
                                                        Positioned(
                                                            top: 245,
                                                            left: 8,
                                                            child: ExcludeSemantics(
                                                                child: RotatedBox(
                                                                    quarterTurns:
                                                                        3,
                                                                    child: Text(
                                                                        playing
                                                                            ? 'NOW SPINNING / 33⅓'
                                                                            : 'SIDE A / HARBEAT',
                                                                        textScaler:
                                                                            TextScaler
                                                                                .noScaling,
                                                                        style: const TextStyle(
                                                                            fontSize:
                                                                                10,
                                                                            letterSpacing:
                                                                                2,
                                                                            color:
                                                                                HB.deepTeal))))),
                                                      ]))))),
                              Expanded(
                                  child: widget.items.isEmpty
                                      ? Padding(
                                          padding: const EdgeInsets.only(
                                              right: 20, bottom: 20),
                                          child: Center(
                                              child: Column(
                                                  mainAxisSize:
                                                      MainAxisSize.min,
                                                  children: [
                                                Text(
                                                    widget.missingCount > 0
                                                        ? '歌曲暂不可用'
                                                        : '空歌单',
                                                    style: Theme.of(context)
                                                        .textTheme
                                                        .titleMedium),
                                                const SizedBox(height: 10),
                                                Text(
                                                    widget.missingCount > 0
                                                        ? '刷新曲库后重试，已收藏的歌曲仍会保留。'
                                                        : '从歌曲详情把音乐加入这里。',
                                                    textAlign: TextAlign.center,
                                                    style: const TextStyle(
                                                        fontSize: 14,
                                                        color: HB.muted)),
                                              ])))
                                      : widget.onReorder == null
                                          ? ListView.builder(
                                              key: const ValueKey(
                                                  'record-track-list'),
                                              padding:
                                                  const EdgeInsets.fromLTRB(
                                                      14, 8, 20, 30),
                                              itemCount: widget.items.length,
                                              itemBuilder: (_, index) =>
                                                  tile(index))
                                          : ReorderableListView.builder(
                                              key: const ValueKey(
                                                  'record-track-list'),
                                              buildDefaultDragHandles: false,
                                              padding:
                                                  const EdgeInsets.fromLTRB(
                                                      14, 8, 20, 30),
                                              itemCount: widget.items.length,
                                              onReorder: widget.onReorder!,
                                              proxyDecorator: (child, _,
                                                      animation) =>
                                                  Material(
                                                      color: Colors.transparent,
                                                      elevation: 0,
                                                      child: child),
                                              itemBuilder: (_, index) =>
                                                  tile(index))),
                            ]);
                      })),
                    ]))),
        bottomNavigationBar: SafeArea(
            top: false,
            child: Center(
                heightFactor: 1,
                child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 720),
                    child: Padding(
                        padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
                        child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                            children: [
                              IconButton(
                                  tooltip: '上一首',
                                  onPressed: busy || !playable
                                      ? null
                                      : () => step(false),
                                  icon:
                                      const Icon(Icons.skip_previous_rounded)),
                              PlaybackButton(
                                  label: playing ? '暂停播放' : '播放唱片',
                                  playing: playing,
                                  busy: busy,
                                  onPressed: current == null || !current.canPlay
                                      ? null
                                      : () => play(current)),
                              IconButton(
                                  tooltip: '下一首',
                                  onPressed: busy || !playable
                                      ? null
                                      : () => step(true),
                                  icon: const Icon(Icons.skip_next_rounded)),
                            ]))))));
  }
}

class _RecordRailPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    for (var i = 0; i < 3; i++) {
      final x = size.width - 30 + i * 11;
      final path = Path()
        ..moveTo(x - 28, -10)
        ..cubicTo(x + 44, size.height * .3, x - 34, size.height * .65, x,
            size.height + 10);
      canvas.drawPath(
          path,
          Paint()
            ..color = [HB.teal, HB.apricot, HB.mint][i]
            ..style = PaintingStyle.stroke
            ..strokeWidth = 10);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _LinkedTrackTile extends StatelessWidget {
  const _LinkedTrackTile(
      {required this.track,
      required this.index,
      required this.active,
      required this.playing,
      required this.onPlay,
      required this.onDetail,
      required this.editing,
      this.onRemove,
      this.onMoveUp,
      this.onMoveDown});
  final Track track;
  final int index;
  final bool active, playing, editing;
  final VoidCallback? onPlay, onRemove, onMoveUp, onMoveDown;
  final VoidCallback onDetail;
  @override
  Widget build(BuildContext context) {
    final color = _recordColors[index % _recordColors.length];
    final duration = track.durationMs == null
        ? '时长待加载'
        : FullPlayer._time(Duration(milliseconds: track.durationMs!));
    return Padding(
        padding: const EdgeInsets.only(top: 6, bottom: 20),
        child: Stack(clipBehavior: Clip.none, children: [
          Positioned.fill(
              top: 5,
              bottom: -5,
              left: 3,
              right: 3,
              child: Transform.rotate(
                  angle: index.isEven ? -.022 : .018,
                  child: DecoratedBox(
                      decoration: BoxDecoration(
                          color: color,
                          borderRadius: BorderRadius.circular(18),
                          border: Border.all(color: HB.ink, width: 1.5))))),
          Material(
              color: active ? const Color(0xFFF1F9F6) : HB.white,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(18),
                  side: BorderSide(
                      color: active ? HB.deepTeal : HB.ink, width: 1.5)),
              child: InkWell(
                  onTap: onDetail,
                  borderRadius: BorderRadius.circular(18),
                  child: Padding(
                      padding: const EdgeInsets.fromLTRB(14, 16, 4, 16),
                      child: Row(children: [
                        RecordSleeve(size: 38, color: color),
                        const SizedBox(width: 10),
                        Expanded(
                            child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                              Text(track.title,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                      fontSize: 16,
                                      height: 1.3,
                                      fontWeight: FontWeight.w800)),
                              const SizedBox(height: 5),
                              Text(track.artist,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                      fontSize: 14, color: HB.muted)),
                              const SizedBox(height: 5),
                              Text(playing ? '正在播放 · $duration' : duration,
                                  style: TextStyle(
                                      fontSize: 14,
                                      color: playing ? HB.deepTeal : HB.muted)),
                            ])),
                        if (editing)
                          PopupMenuButton<String>(
                              tooltip: '${track.title} 的更多操作',
                              icon: const Icon(Icons.more_vert_rounded),
                              onSelected: (action) {
                                switch (action) {
                                  case 'detail':
                                    onDetail();
                                  case 'remove':
                                    onRemove?.call();
                                  case 'up':
                                    onMoveUp?.call();
                                  case 'down':
                                    onMoveDown?.call();
                                }
                              },
                              itemBuilder: (_) => [
                                    const PopupMenuItem(
                                        value: 'detail', child: Text('歌曲详情')),
                                    if (onMoveUp != null)
                                      const PopupMenuItem(
                                          value: 'up', child: Text('上移')),
                                    if (onMoveDown != null)
                                      const PopupMenuItem(
                                          value: 'down', child: Text('下移')),
                                    if (onRemove != null)
                                      const PopupMenuItem(
                                          value: 'remove',
                                          child: Text('从歌单移除')),
                                  ])
                        else
                          IconButton(
                              tooltip:
                                  '${playing ? '暂停' : '播放'} · ${track.title}',
                              onPressed: onPlay,
                              icon: Icon(
                                  playing
                                      ? Icons.pause_rounded
                                      : Icons.play_circle_fill_rounded,
                                  color: onPlay == null
                                      ? HB.muted
                                      : playing
                                          ? HB.deepTeal
                                          : HB.ink,
                                  size: 26)),
                      ])))),
          Positioned(
              left: -16,
              top: 40,
              child: IgnorePointer(
                  child: ExcludeSemantics(
                      child: CustomPaint(
                          size: const Size(28, 12),
                          painter: _HorizontalRingPainter())))),
        ]));
  }
}

class _HorizontalRingPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final pen = Paint()
      ..color = HB.ink
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5;
    for (final x in [2.0, 25.0]) {
      canvas.drawCircle(Offset(x, 6), 3, Paint()..color = HB.paper);
      canvas.drawCircle(Offset(x, 6), 3, pen);
    }
    canvas.drawRRect(
        RRect.fromRectAndRadius(
            const Rect.fromLTWH(1, 3, 25, 6), const Radius.circular(3)),
        Paint()..color = HB.white);
    canvas.drawRRect(
        RRect.fromRectAndRadius(
            const Rect.fromLTWH(1, 3, 25, 6), const Radius.circular(3)),
        pen);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
