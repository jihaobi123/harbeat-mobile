part of 'app.dart';

/// Presentation follows playback, never controls the audio clock.
class PlaybackTurntable extends StatefulWidget {
  const PlaybackTurntable(
      {super.key,
      required this.playing,
      this.progress = 0,
      this.size = 240,
      this.coverUrl,
      this.coverFraction = .46,
      this.mirrorTonearm = false});
  final bool playing;
  final double size, coverFraction, progress;
  final String? coverUrl;
  final bool mirrorTonearm;
  @override
  State<PlaybackTurntable> createState() => _PlaybackTurntableState();
}

class _PlaybackTurntableState extends State<PlaybackTurntable>
    with WidgetsBindingObserver, AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;

  ScrollPosition? _scroll;
  bool _onScreen = true;
  bool _foreground = true;
  bool _visibilityPending = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    _foreground = lifecycle == null || lifecycle == AppLifecycleState.resumed;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final position = Scrollable.maybeOf(context)?.position;
    if (position != _scroll) {
      _scroll?.removeListener(_scheduleVisibility);
      _scroll = position;
      _scroll?.addListener(_scheduleVisibility);
    }
    _scheduleVisibility();
  }

  void _scheduleVisibility() {
    if (_visibilityPending) return;
    _visibilityPending = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _visibilityPending = false;
      if (!mounted) return;
      final box = context.findRenderObject();
      final viewport = Scrollable.maybeOf(context)?.context.findRenderObject();
      if (box is! RenderBox ||
          !box.hasSize ||
          viewport is! RenderBox ||
          !viewport.hasSize) {
        return;
      }
      final origin = box.localToGlobal(Offset.zero);
      final visible = (origin & box.size)
          .overlaps(viewport.localToGlobal(Offset.zero) & viewport.size);
      if (_onScreen != visible) setState(() => _onScreen = visible);
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final foreground = state == AppLifecycleState.resumed;
    if (foreground != _foreground) setState(() => _foreground = foreground);
  }

  @override
  void dispose() {
    _scroll?.removeListener(_scheduleVisibility);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final reduced = MediaQuery.disableAnimationsOf(context);
    final visible = _foreground &&
        _onScreen &&
        (ModalRoute.isCurrentOf(context) ?? true) &&
        TickerMode.valuesOf(context).enabled;
    final suppressMotion = reduced || !visible;
    final disc = _VinylDisc(
        playing: widget.playing && visible,
        size: widget.size,
        coverFraction: widget.coverFraction,
        refined: true,
        color: HB.accent,
        coverUrl: widget.coverUrl);
    final width = widget.size + 44;
    final height = widget.size + 24;
    final progress = widget.progress.clamp(0.0, 1.0);
    final needleTurns = widget.playing ? -.055 + .041 * progress : -.095;
    return ExcludeSemantics(
        child: RepaintBoundary(
            child: SizedBox(
                width: width,
                height: height,
                child: Stack(clipBehavior: Clip.none, children: [
                  Positioned(left: 22, top: 24, child: disc),
                  Positioned.fill(
                      // Duration zero alone leaves an in-flight implicit tween
                      // running. Recreate its controller when suppression changes.
                      child: Transform.flip(
                          flipX: widget.mirrorTonearm,
                          child: KeyedSubtree(
                              key: ValueKey(suppressMotion),
                              child: AnimatedRotation(
                                  key: const ValueKey('playback-tonearm'),
                                  turns: needleTurns,
                                  alignment: Alignment(.6, 8 / height - 1),
                                  duration: suppressMotion
                                      ? Duration.zero
                                      : Duration(
                                          milliseconds:
                                              widget.playing ? 360 : 260),
                                  curve: Curves.easeOutCubic,
                                  child: CustomPaint(
                                      painter:
                                          _TonearmPainter(widget.size)))))),
                ]))));
  }
}

class _PlaybackDecks extends StatefulWidget {
  const _PlaybackDecks({
    required this.current,
    required this.incoming,
    required this.currentId,
    required this.currentPlaying,
    required this.incomingPlaying,
    required this.currentProgress,
    required this.incomingProgress,
  });
  final Track? current, incoming;
  final String? currentId;
  final bool currentPlaying, incomingPlaying;
  final double currentProgress, incomingProgress;

  @override
  State<_PlaybackDecks> createState() => _PlaybackDecksState();
}

class _PlaybackDecksState extends State<_PlaybackDecks> {
  String? _lastCurrentId;
  bool _currentOnA = true;

  @override
  void initState() {
    super.initState();
    _lastCurrentId = widget.currentId;
  }

  @override
  void didUpdateWidget(covariant _PlaybackDecks oldWidget) {
    super.didUpdateWidget(oldWidget);
    final id = widget.currentId;
    if (id == null || id == _lastCurrentId) return;
    if (_lastCurrentId != null) _currentOnA = !_currentOnA;
    _lastCurrentId = id;
  }

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 4, bottom: 8),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: _deck('A', _currentOnA)),
          Expanded(child: _deck('B', !_currentOnA)),
        ]),
      );

  Widget _deck(String letter, bool current) => _PlaybackDeck(
        key: ValueKey('mix-deck-$letter'),
        letter: letter,
        track: current ? widget.current : widget.incoming,
        current: current,
        playing: current ? widget.currentPlaying : widget.incomingPlaying,
        progress: current ? widget.currentProgress : widget.incomingProgress,
      );
}

class _PlaybackDeck extends StatelessWidget {
  const _PlaybackDeck({
    super.key,
    required this.letter,
    required this.track,
    required this.current,
    required this.playing,
    required this.progress,
  });
  final String letter;
  final Track? track;
  final bool current, playing;
  final double progress;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context).textTheme;
    final song = track;
    final description = [
      if ((song?.bpm ?? 0) > 0) '${song!.bpmLabel} BPM',
      if (song != null && song.artist.isNotEmpty) song.artist,
    ].join(' · ');
    final status = playing
        ? '播放中'
        : current && song != null
            ? '当前'
            : '待播';
    return Column(children: [
      Semantics(
        label: '$letter 盘，$status',
        excludeSemantics: true,
        child: Text(letter,
            style: theme.labelLarge
                ?.copyWith(color: HB.muted, fontWeight: FontWeight.w700)),
      ),
      const SizedBox(height: 8),
      LayoutBuilder(builder: (context, constraints) {
        final height = MediaQuery.sizeOf(context).height;
        // The two visible halves together cover about 73% of the page width.
        final size = (constraints.maxWidth * 1.46)
            .clamp(0.0, (height * .34).clamp(144.0, 300.0));
        final left = letter == 'A';
        // Center the spindle on the outside edge of each deck window.
        final offscreen = -(size + 44) / 2;
        return SizedBox(
          key: ValueKey('mix-deck-window-$letter'),
          height: size + 24,
          width: double.infinity,
          child: Stack(clipBehavior: Clip.hardEdge, children: [
            Positioned(
              left: left ? offscreen : null,
              right: left ? null : offscreen,
              top: 0,
              child: Opacity(
                opacity: song == null ? .34 : 1,
                child: PlaybackTurntable(
                    key: ValueKey(song?.id),
                    mirrorTonearm: !left,
                    coverFraction: .58,
                    playing: playing,
                    progress: progress,
                    size: size,
                    coverUrl: song?.coverUrl),
              ),
            ),
          ]),
        );
      }),
      const SizedBox(height: 10),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10),
        child: Column(children: [
          Text(song?.title ?? (current ? '选择歌曲' : '等待下一首'),
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: theme.titleSmall?.copyWith(
                  color: song == null ? HB.muted : HB.ink,
                  fontWeight: FontWeight.w600)),
          if (description.isNotEmpty) ...[
            const SizedBox(height: 3),
            Text(description,
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.bodySmall?.copyWith(color: HB.muted)),
          ],
        ]),
      ),
    ]);
  }
}

/// Small geometric tonearm; only its pose changes, independent of disc rotation.
class _TonearmPainter extends CustomPainter {
  const _TonearmPainter(this.discSize);
  final double discSize;
  @override
  void paint(Canvas canvas, Size size) {
    final pivot = Offset(size.width * .8, 4);
    final bend = pivot + Offset(0, discSize * .27);
    final head = pivot + Offset(-discSize * .12, discSize * .48);
    final tip = pivot + Offset(-discSize * .10, discSize * .53);
    final path = Path()
      ..moveTo(pivot.dx, pivot.dy)
      ..lineTo(bend.dx, bend.dy)
      ..lineTo(head.dx, head.dy)
      ..lineTo(tip.dx, tip.dy);
    canvas.drawPath(
        path.shift(const Offset(1, 2)),
        Paint()
          ..color = const Color(0x18202124)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 7
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round);
    canvas.drawPath(
        path,
        Paint()
          ..color = HB.muted
          ..style = PaintingStyle.stroke
          ..strokeWidth = 4
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round);
    canvas.drawPath(
        path,
        Paint()
          ..color = HB.line
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round);
    canvas.drawLine(
        head,
        tip,
        Paint()
          ..color = HB.ink
          ..strokeWidth = 8
          ..strokeCap = StrokeCap.round);
    canvas.drawCircle(tip, 1.5, Paint()..color = HB.accent);
    canvas.drawCircle(pivot, 8, Paint()..color = HB.surfaceStrong);
    canvas.drawCircle(pivot, 5, Paint()..color = HB.muted);
    canvas.drawCircle(pivot, 2, Paint()..color = HB.line);
  }

  @override
  bool shouldRepaint(_TonearmPainter oldDelegate) =>
      oldDelegate.discSize != discSize;
}
