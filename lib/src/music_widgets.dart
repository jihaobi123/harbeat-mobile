part of 'app.dart';

/// A paper sleeve, with an offset coloured back and a small binder eyelet.
/// Only the decoration is offset; text and hit targets stay aligned.
class _PaperSleeve extends StatelessWidget {
  const _PaperSleeve(
      {required this.child,
      this.color = HB.mint,
      this.padding = const EdgeInsets.all(10)});
  final Widget child;
  final Color color;
  final EdgeInsets padding;
  @override
  Widget build(BuildContext context) => Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 6),
      child: Stack(clipBehavior: Clip.none, children: [
        Positioned.fill(
            top: 5,
            bottom: -5,
            left: 3,
            right: 3,
            child: DecoratedBox(
                decoration: BoxDecoration(
                    color: color,
                    borderRadius: HB.radius,
                    border: Border.all(color: HB.ink, width: 1.5)))),
        HardCard(padding: padding, child: child),
        Positioned(
            left: 18,
            top: -8,
            child: IgnorePointer(
                child: ExcludeSemantics(
                    child: CustomPaint(
                        size: const Size(14, 27), painter: _BinderPainter())))),
      ]));
}

class _BinderPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final pen = Paint()
      ..color = HB.ink
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5;
    canvas.drawCircle(const Offset(7, 22), 3.4, Paint()..color = HB.paper);
    canvas.drawCircle(const Offset(7, 22), 3.4, pen);
    canvas.drawRRect(
        RRect.fromRectAndRadius(
            const Rect.fromLTWH(4, 0, 6, 23), const Radius.circular(3)),
        pen);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

/// The NAS cover sits inside the existing paper sleeve; graphics are a fallback.
class _GenreArtwork extends StatelessWidget {
  const _GenreArtwork({required this.track, required this.index});
  final Track track;
  final int index;
  @override
  Widget build(BuildContext context) {
    final palette = [HB.mint, HB.lavender, HB.peach, const Color(0xFFDBEDF4)];
    return ExcludeSemantics(
        child: ClipRRect(
            borderRadius: BorderRadius.circular(11),
            child: AspectRatio(
                aspectRatio: 1.05,
                child: TrackArtwork(
                    url: track.coverUrl,
                    fallback: Stack(fit: StackFit.expand, children: [
                      CustomPaint(
                          painter: _SleevePainter(
                              palette[index % palette.length], index)),
                      Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                const Text('HARBEAT / SELECT',
                                    style: TextStyle(
                                        fontSize: 9,
                                        letterSpacing: 1,
                                        fontWeight: FontWeight.w800)),
                                FittedBox(
                                    fit: BoxFit.scaleDown,
                                    alignment: Alignment.centerLeft,
                                    child: Text(
                                        track.style
                                            .toUpperCase()
                                            .replaceAll('-', '\n'),
                                        style: const TextStyle(
                                            fontSize: 30,
                                            height: .98,
                                            fontWeight: FontWeight.w900,
                                            letterSpacing: -1))),
                                Text(
                                    'SIDE ${String.fromCharCode(65 + index % 26)}',
                                    style: const TextStyle(
                                        fontSize: 10,
                                        letterSpacing: 2,
                                        fontWeight: FontWeight.w700)),
                              ])),
                    ])))));
  }
}

class _SleevePainter extends CustomPainter {
  const _SleevePainter(this.color, this.variant);
  final Color color;
  final int variant;
  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = color);
    final ink = Paint()
      ..color = HB.ink
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5;
    final accent = variant.isEven ? HB.teal : HB.apricot;
    final center = Offset(size.width * .95, size.height * .57);
    if (variant % 3 == 0) {
      canvas.drawCircle(center, size.width * .46, Paint()..color = accent);
      for (final factor in [.46, .36, .26, .12]) {
        canvas.drawCircle(center, size.width * factor, ink);
      }
      canvas.drawCircle(center, size.width * .035, Paint()..color = HB.ink);
    } else if (variant % 3 == 1) {
      for (var i = 0; i < 4; i++) {
        final path = Path()
          ..moveTo(size.width * .65 + i * 13, -10)
          ..cubicTo(size.width * .25, size.height * .5, size.width * 1.4,
              size.height * .5, size.width * .7 + i * 13, size.height + 10);
        canvas.drawPath(
            path,
            Paint()
              ..color = i.isEven ? accent : HB.white
              ..style = PaintingStyle.stroke
              ..strokeWidth = 12);
        canvas.drawPath(path, ink);
      }
    } else {
      for (var row = 0; row < 6; row++) {
        for (var col = 0; col < 3; col++) {
          canvas.drawRect(
              Rect.fromLTWH(size.width * .64 + col * 20, row * 26.0, 20, 26),
              Paint()..color = (row + col).isEven ? accent : HB.white);
        }
      }
      canvas.drawOval(
          Rect.fromCenter(
              center: center,
              width: size.width * .6,
              height: size.height * .65),
          ink);
    }
  }

  @override
  bool shouldRepaint(covariant _SleevePainter oldDelegate) =>
      oldDelegate.color != color || oldDelegate.variant != variant;
}

class _TrackGallery extends StatelessWidget {
  const _TrackGallery(this.c, this.tracks);
  final AppController c;
  final List<Track> tracks;
  @override
  Widget build(BuildContext context) =>
      LayoutBuilder(builder: (context, constraints) {
        final columns = constraints.maxWidth < 300 ||
                MediaQuery.textScalerOf(context).scale(16) > 21
            ? 1
            : 2;
        return Column(children: [
          for (var start = 0; start < tracks.length; start += columns)
            Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (var slot = 0; slot < columns; slot++) ...[
                        if (slot > 0) const SizedBox(width: 16),
                        Expanded(
                            child: start + slot < tracks.length
                                ? _TrackSleeveCard(
                                    c, tracks[start + slot], start + slot)
                                : const SizedBox()),
                      ],
                    ])),
        ]);
      });
}

class _TrackSleeveCard extends StatelessWidget {
  const _TrackSleeveCard(this.c, this.track, this.index);
  final AppController c;
  final Track track;
  final int index;
  @override
  Widget build(BuildContext context) {
    final saved = c.library.contains(track.id);
    final playing = c.isPlaying && c.nowPlaying?.id == track.id;
    final scale = MediaQuery.textScalerOf(context);
    return _PaperSleeve(
        color: [HB.peach, HB.mint, HB.lavender][index % 3],
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          InkWell(
              onTap: () => _openTrack(context, c, track),
              borderRadius: BorderRadius.circular(12),
              child: Semantics(
                  button: true,
                  label: '查看 ${track.title} 详情',
                  child: _GenreArtwork(track: track, index: index))),
          const SizedBox(height: 12),
          InkWell(
              onTap: () => _openTrack(context, c, track),
              child: SizedBox(
                  height: scale.scale(16) * 3,
                  child: Text(track.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleMedium))),
          Text(track.artist,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 14, color: HB.muted)),
          const SizedBox(height: 8),
          Text(playing ? '正在播放' : '${track.bpmLabel} BPM',
              style: const TextStyle(fontSize: 14, color: HB.deepTeal)),
          const SizedBox(height: 4),
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            IconButton(
                onPressed: saved ? null : () => c.save(track),
                tooltip:
                    saved ? '已保存 · ${track.title}' : '加入曲库 · ${track.title}',
                icon: Icon(
                    saved
                        ? Icons.favorite_rounded
                        : Icons.favorite_border_rounded,
                    color: saved ? HB.deepTeal : HB.muted,
                    size: 22)),
            IconButton.filled(
                key: ValueKey('gallery-play-${track.id}'),
                tooltip: track.canPlay
                    ? '手机播放 · ${track.title}'
                    : '暂无音频 · ${track.title}',
                style: IconButton.styleFrom(
                    backgroundColor: HB.ink,
                    foregroundColor: HB.white,
                    minimumSize: const Size(48, 48)),
                onPressed: !track.canPlay
                    ? null
                    : () async {
                        await c.play(track);
                        if (c.isPlaying) c.setTab(0);
                      },
                icon: Icon(
                    playing ? Icons.replay_rounded : Icons.play_arrow_rounded)),
          ]),
        ]));
  }
}

class _SearchShortcut extends StatelessWidget {
  const _SearchShortcut(this.c);
  final AppController c;
  @override
  Widget build(BuildContext context) => HardCard(
      padding: EdgeInsets.zero,
      onTap: () => c.setMusicSection(1),
      child: Semantics(
          button: true,
          label: '搜索歌曲或艺人',
          child: Row(children: [
            Container(
                width: 48,
                height: 48,
                decoration: const BoxDecoration(
                    border:
                        Border(right: BorderSide(color: HB.ink, width: 1.5))),
                child: const Icon(Icons.search_rounded, size: 24)),
            const SizedBox(width: 14),
            const Expanded(
                child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 12),
                    child: Text('搜索歌曲 / 艺人',
                        style: TextStyle(fontSize: 16, color: HB.muted)))),
            const Padding(
                padding: EdgeInsets.only(right: 12),
                child: Icon(Icons.north_east_rounded, size: 20)),
          ])));
}

class _FeaturedMixShelf extends StatelessWidget {
  const _FeaturedMixShelf(this.c);
  final AppController c;
  @override
  Widget build(BuildContext context) => _PaperSleeve(
      color: HB.apricot,
      padding: EdgeInsets.zero,
      child: ExpansionTile(
          shape: const Border(),
          collapsedShape: const Border(),
          tilePadding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          leading: const RecordSleeve(size: 52, color: HB.lavender),
          title: const Text('HIP-HOP SIX',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
          subtitle: const Text('精选歌单 · 6 首 · 4 分 21 秒',
              style: TextStyle(fontSize: 14, color: HB.muted)),
          children: [
            Text(c.featuredNasTracks.map((t) => t.title).join(' · '),
                style: const TextStyle(fontSize: 14, color: HB.muted)),
            const SizedBox(height: 12),
            Wrap(spacing: 8, runSpacing: 8, children: [
              HardButton(
                  label: '播放 V3 混音',
                  color: HB.apricot,
                  onPressed:
                      c.directionBusy ? null : () => c.playNasSet(mixed: true)),
              HardButton(
                  label: '播放六首原曲',
                  color: HB.white,
                  onPressed: c.directionBusy || c.featuredNasTracks.length != 6
                      ? null
                      : () => c.playNasSet(mixed: false)),
              HardButton(
                  label: c.openingRealtimeLab ? '正在打开…' : 'V3 实时混音',
                  color: HB.mint,
                  onPressed: c.directionBusy || c.openingRealtimeLab
                      ? null
                      : c.openRealtimeLab),
            ]),
            const SizedBox(height: 12),
            const Text('混音试听已内置；原曲需联网。实时混音可在播放页选歌，请保持前台。',
                style: TextStyle(fontSize: 14, color: HB.muted)),
            if (c.realtimeLabError != null)
              Text(c.realtimeLabError!,
                  style: const TextStyle(color: HB.error)),
          ]));
}

class _PlaylistFolder extends StatelessWidget {
  const _PlaylistFolder(
      {required this.name,
      required this.count,
      required this.totalCount,
      required this.index,
      required this.heroTag,
      this.coverUrl,
      required this.onOpen,
      required this.onRename,
      required this.onDelete});
  final String name, heroTag;
  final String? coverUrl;
  final int count, totalCount, index;
  final VoidCallback onOpen, onRename, onDelete;

  @override
  Widget build(BuildContext context) => _VinylDisplay(
        title: name,
        subtitle:
            count == totalCount ? '$count 首音乐' : '$count / $totalCount 首可用',
        index: index,
        heroTag: heroTag,
        coverUrl: coverUrl,
        onOpen: onOpen,
        actions: [
          IconButton(
              onPressed: onRename,
              icon: const Icon(Icons.edit_outlined, size: 20),
              tooltip: '重命名歌单'),
          IconButton(
              onPressed: onDelete,
              icon: const Icon(Icons.delete_outline_rounded, size: 20),
              tooltip: '删除歌单'),
        ],
      );
}
