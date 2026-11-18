import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show OverflowBoxFit;
import 'package:flutter/services.dart';
import 'package:file_picker/file_picker.dart';

import 'audio_service.dart';
import 'dj_reference_feedback.dart';
import 'package:url_launcher/url_launcher.dart';
import 'activity_repository.dart';
import 'music_search_repository.dart';
import 'accessory_ble.dart';
import 'backend.dart';
import 'controller.dart';
import 'local_store.dart';
import 'models.dart';
import 'nas_repository.dart';
import 'repository.dart';
import 'theme.dart';

part 'phone_screens.dart';
part 'longmix_screen.dart';
part 'dj_reference_screen.dart';
part 'music_search_panel.dart';
part 'activity_screens.dart';
part 'backend_screen.dart';
part 'upload_screen.dart';
part 'music_widgets.dart';
part 'vinyl_widgets.dart';
part 'player_turntable.dart';

class HarBeatApp extends StatefulWidget {
  const HarBeatApp({super.key, this.repository, this.localStore, this.audio});
  final HarBeatRepository? repository;
  final LocalStore? localStore;
  final AudioService? audio;

  @override
  State<HarBeatApp> createState() => _HarBeatAppState();
}

class _HarBeatAppState extends State<HarBeatApp> {
  late final AppController controller;

  @override
  void initState() {
    super.initState();
    controller = AppController(widget.repository ?? MockHarBeatRepository(),
        localStore: widget.localStore,
        audio: widget.audio,
        nasRepository:
            widget.repository == null ? NasCatalogRepository() : null)
      ..initialize();
  }

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
        debugShowCheckedModeBanner: false,
        title: 'HarBeat',
        theme: HB.theme,
        builder: (_, child) => AnnotatedRegion<SystemUiOverlayStyle>(
            value: SystemUiOverlayStyle.dark.copyWith(
                statusBarColor: Colors.transparent,
                systemNavigationBarColor: HB.white,
                systemNavigationBarIconBrightness: Brightness.dark),
            child: child!),
        home: AnimatedBuilder(
            animation: controller,
            builder: (_, __) => Shell(controller: controller)),
      );
}

class Shell extends StatelessWidget {
  const Shell({super.key, required this.controller});
  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final pages = [
      PhoneMixScreen(controller),
      MusicScreen(controller),
      PersonalScreen(controller)
    ];
    return Scaffold(
      body: SafeArea(
          child: Stack(children: [
        IndexedStack(index: controller.tab, children: [
          for (var i = 0; i < pages.length; i++)
            TickerMode(enabled: controller.tab == i, child: pages[i]),
        ]),
        if (controller.tab != 0 && controller.nowPlaying != null)
          Positioned(
              left: 12,
              right: 12,
              bottom: 6,
              child: MiniPlayer(
                  track: controller.nowPlaying!, controller: controller)),
      ])),
      bottomNavigationBar: NavigationBar(
        selectedIndex: controller.tab,
        onDestinationSelected: controller.setTab,
        destinations: const [
          NavigationDestination(
              icon: Icon(Icons.tune_rounded),
              selectedIcon: Icon(Icons.tune_rounded),
              label: '播放'),
          NavigationDestination(
              icon: Icon(Icons.album_outlined),
              selectedIcon: Icon(Icons.album),
              label: '音乐'),
          NavigationDestination(
              icon: Icon(Icons.person_outline),
              selectedIcon: Icon(Icons.person),
              label: '我的'),
        ],
      ),
    );
  }
}

class PageFrame extends StatelessWidget {
  const PageFrame(
      {super.key,
      required this.label,
      required this.title,
      this.scrollKey,
      this.compact = false,
      required this.children});
  final String label;
  final String title;
  final String? scrollKey;
  final bool compact;
  final List<Widget> children;
  static const _horizontalInset = 16.0;

  @override
  Widget build(BuildContext context) => Center(
      child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 720),
          child: ListView(
            key: ValueKey(scrollKey ?? label),
            padding: EdgeInsets.fromLTRB(
                _horizontalInset, compact ? 12 : 20, _horizontalInset, 128),
            children: [
              const Row(children: [
                Text('HarBeat',
                    style: TextStyle(
                        fontSize: 25,
                        letterSpacing: -.8,
                        fontWeight: FontWeight.w700)),
                Padding(
                    padding: EdgeInsets.only(left: 3, top: 10),
                    child: SizedBox.square(
                        dimension: 5,
                        child: DecoratedBox(
                            decoration: BoxDecoration(
                                color: HB.accent, shape: BoxShape.circle)))),
              ]),
              SizedBox(height: compact ? 10 : 20),
              Text(title,
                  style: compact
                      ? const TextStyle(
                          fontSize: 20, fontWeight: FontWeight.w600)
                      : Theme.of(context).textTheme.displayLarge),
              SizedBox(height: compact ? 10 : 20),
              ...children,
            ],
          )));
}

class MusicScreen extends StatelessWidget {
  const MusicScreen(this.c, {super.key});
  final AppController c;

  @override
  Widget build(BuildContext context) => PageFrame(
          label: 'MUSIC / PERSONAL',
          title: '发现下一首心动。',
          scrollKey: 'music-${c.musicSection}',
          children: [
            if (c.musicSection != 1) ...[
              _SearchShortcut(c),
              const SizedBox(height: 16),
            ],
            SegmentedButton<int>(
                segments: const [
                  ButtonSegment(value: 0, label: Text('推荐')),
                  ButtonSegment(value: 1, label: Text('搜索')),
                  ButtonSegment(value: 2, label: Text('曲库')),
                ],
                selected: {
                  c.musicSection >= 2 ? 2 : c.musicSection
                },
                onSelectionChanged: (selection) =>
                    c.setMusicSection(selection.single),
                style: SegmentedButton.styleFrom(
                    minimumSize: const Size(48, 48),
                    selectedBackgroundColor: HB.accentSoft,
                    selectedForegroundColor: HB.accent,
                    foregroundColor: HB.muted,
                    backgroundColor: HB.surface,
                    side: BorderSide.none,
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12)))),
            const SizedBox(height: 20),
            if (c.musicSection == 0)
              ..._recommendations(context)
            else if (c.musicSection == 1)
              SearchImportPanel(c)
            else ...[
              Row(children: [
                Expanded(
                    child: HardButton(
                        label: '已收藏',
                        selected: c.musicSection == 2,
                        color: c.musicSection == 2 ? HB.acid : HB.white,
                        onPressed: () => c.setMusicSection(2))),
                const SizedBox(width: 8),
                Expanded(
                    child: HardButton(
                        label: '歌单',
                        selected: c.musicSection == 3,
                        color: c.musicSection == 3 ? HB.acid : HB.white,
                        onPressed: () => c.setMusicSection(3))),
              ]),
              const SizedBox(height: 20),
              if (c.musicSection == 2)
                ..._library(context)
              else
                ..._playlists(context),
              const SizedBox(height: 12),
              HardButton(
                  label: '导入更多音乐',
                  color: HB.white,
                  onPressed: () => c.setMusicSection(1)),
            ],
          ]);

  List<Widget> _recommendations(BuildContext context) => [
        if (c.nasRepository == null) ...[
          Text(c.isRemoteMode ? '在线曲库 · 收藏喜欢的音乐。' : '示例目录 · 试听共用演示音频，可导入自己的音乐。',
              style: const TextStyle(fontSize: 14, color: HB.muted)),
          const SizedBox(height: 16),
        ],
        if (c.nasRepository != null) ..._nasRecommendations(context),
        if (c.nasRepository == null)
          HardCard(
              color: HB.orange,
              child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
                Expanded(
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                      const Text('THIS WEEK / PRACTICE',
                          style: TextStyle(
                              fontSize: 14, fontWeight: FontWeight.w600)),
                      const SizedBox(height: 32),
                      Text('BODY\nELECTRIC',
                          style: Theme.of(context).textTheme.headlineLarge),
                      const Text('本周练习 · 从松弛进入状态')
                    ])),
                IconButton.filled(
                    style: IconButton.styleFrom(
                        backgroundColor: HB.ink, foregroundColor: HB.acid),
                    onPressed: c.loading ? null : c.playPractice,
                    icon: const Icon(Icons.play_arrow)),
              ])),
        const SizedBox(height: 25),
        _SectionTitle(c.isRemoteMode ? '在线曲库' : '为你推荐',
            action:
                '${c.isRemoteMode ? c.cloudTracks.length : c.catalogTracks.where((t) => !t.isNas && !t.isRenderedMix).length} TRACKS'),
        if (c.isRemoteMode) ...[
          HardButton(
              label: '刷新曲库',
              color: HB.white,
              onPressed: c.loading ? null : () => c.refreshCatalog()),
          const SizedBox(height: 12),
          HardButton(
              label: c.hasBackendSession ? '上传到云端' : '登录后上传音乐',
              color: HB.acid,
              onPressed: () => _openPhonePage(
                  context,
                  c,
                  () => c.hasBackendSession
                      ? CloudUploadScreen(c)
                      : BackendScreen(c))),
          const SizedBox(height: 12),
        ],
        if (c.catalogError != null)
          _NetworkNotice(c.catalogError!, onRetry: () => c.refreshCatalog()),
        if (!c.loading &&
            c.isRemoteMode &&
            c.cloudTracks.isEmpty &&
            c.catalogError == null)
          const _Placeholder(section: '曲库为空', copy: '服务已连接，当前账号暂无可用歌曲。'),
        if (c.loading)
          const Padding(
              padding: EdgeInsets.all(30),
              child: Center(child: CircularProgressIndicator(color: HB.ink)))
        else
          _TrackGallery(
              c,
              (c.isRemoteMode
                      ? c.cloudTracks
                      : c.catalogTracks
                          .where((t) => !t.isNas && !t.isRenderedMix))
                  .toList()),
        if (c.isRemoteMode && c.localTracks.isNotEmpty) ...[
          const SizedBox(height: 20),
          _SectionTitle('本机音乐', action: '${c.localTracks.length} TRACKS'),
          ...c.localTracks.map((t) => TrackCard(
              track: t,
              playing: c.nowPlaying?.id == t.id && c.isPlaying,
              saved: c.library.contains(t.id),
              onPlay: () async {
                await c.play(t);
                c.setTab(0);
              },
              onSave: () => c.save(t),
              onOpen: () => _openTrack(context, c, t))),
        ],
        if (c.isRemoteMode && c.nextCatalogCursor != null && !c.loading)
          HardButton(
              label: '加载更多',
              color: HB.white,
              onPressed: () => c.refreshCatalog(more: true)),
      ];

  List<Widget> _nasRecommendations(BuildContext context) => [
        _SectionTitle('挑一首，开始今天。', action: '${c.nasTracks.length} 首音乐'),
        _TrackGallery(c, c.nasDisplayTracks.take(4).toList()),
        const SizedBox(height: 8),
        _FeaturedMixShelf(c),
        const SizedBox(height: 24),
        const _SectionTitle('继续发现', action: 'NAS 推荐曲库'),
        Text(
            c.nasLive
                ? '已连接 Jetson NAS · 按歌曲合并分析版本'
                : '目录快照 ${c.nasRepository?.snapshotDate ?? ''} · 正在检查更新',
            style: const TextStyle(fontSize: 14, color: HB.muted)),
        TextButton.icon(
            onPressed: c.nasLoading ? null : c.refreshNas,
            icon: const Icon(Icons.refresh_rounded, size: 20),
            label: Text(c.nasLoading ? '正在刷新 NAS…' : '刷新 NAS 曲库')),
        if (c.nasError != null)
          _NetworkNotice(c.nasError!, onRetry: c.refreshNas),
        const SizedBox(height: 8),
        _TrackGallery(
            c, c.nasDisplayTracks.skip(4).take(c.nasVisibleCount - 4).toList()),
        if (c.nasTracks.length > c.nasVisibleCount)
          HardButton(
              label: '更多 NAS 音乐', color: HB.mint, onPressed: c.showMoreNas),
      ];

  List<Widget> _library(BuildContext context) {
    final items = c.tracks.where((t) => c.library.contains(t.id)).toList();
    return items.isEmpty
        ? [
            const _Placeholder(section: '曲库为空', copy: '收藏喜欢的音乐，或导入自己的音频。'),
            const SizedBox(height: 12),
            HardButton(label: '去选音乐', onPressed: () => c.setMusicSection(0))
          ]
        : [_SavedVinylShelf(c, items)];
  }

  List<Widget> _playlists(BuildContext context) => [
        LayoutBuilder(builder: (context, constraints) {
          final columns = constraints.maxWidth < 300 ||
                  MediaQuery.textScalerOf(context).scale(16) > 21
              ? 1
              : 2;
          return Column(children: [
            for (var start = 0; start < c.playlists.length; start += columns)
              Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        for (var slot = 0; slot < columns; slot++) ...[
                          if (slot > 0) const SizedBox(width: 16),
                          Expanded(
                              child: start + slot < c.playlists.length
                                  ? _playlistFolder(context, start + slot)
                                  : const SizedBox()),
                        ],
                      ])),
          ]);
        }),
        HardButton(
            label: '+ 新建歌单',
            color: HB.white,
            onPressed: () => _createPlaylist(context)),
      ];

  Widget _playlistFolder(BuildContext context, int index) {
    final playlist = c.playlists[index];
    return _PlaylistFolder(
        name: playlist.name,
        count: playlist.trackIds
            .where((id) => c.tracks.any((track) => track.id == id))
            .length,
        totalCount: playlist.trackIds.length,
        index: index,
        heroTag: 'playlist:${playlist.id}',
        coverUrl: playlist.trackIds
            .map(
                (id) => c.tracks.where((t) => t.id == id).firstOrNull?.coverUrl)
            .whereType<String>()
            .firstOrNull,
        onOpen: () =>
            _openVinylPage(context, PlaylistDetail(c: c, playlistIndex: index)),
        onRename: () => _renamePlaylist(context, index, playlist.name),
        onDelete: () => _deletePlaylist(context, index, playlist.name));
  }

  Future<void> _createPlaylist(BuildContext context) async {
    final name = await _askName(context, '新建歌单', '例如：周五 Cypher');
    if (name != null) c.createPlaylist(name);
  }

  Future<void> _renamePlaylist(
      BuildContext context, int index, String current) async {
    final name = await _askName(context, '重命名歌单', current);
    if (name != null) c.renamePlaylist(index, name);
  }

  Future<void> _deletePlaylist(
      BuildContext context, int index, String name) async {
    final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
              title: const Text('删除歌单？'),
              content: Text('“$name”中的歌曲不会从曲库删除。'),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(dialogContext, false),
                    child: const Text('取消')),
                HardButton(
                    label: '删除',
                    color: HB.orange,
                    onPressed: () => Navigator.pop(dialogContext, true))
              ],
            ));
    if (confirmed == true) c.deletePlaylist(index);
  }

  Future<String?> _askName(
      BuildContext context, String title, String hint) async {
    final field = TextEditingController();
    return showDialog<String>(
        context: context,
        builder: (dialogContext) => AlertDialog(
              shape: const RoundedRectangleBorder(
                  borderRadius: HB.radius, side: BorderSide.none),
              title: Text(title),
              content: TextField(
                  controller: field,
                  autofocus: true,
                  decoration: InputDecoration(hintText: hint)),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(dialogContext),
                    child: const Text('取消')),
                HardButton(
                    label: '保存',
                    onPressed: () => Navigator.pop(dialogContext, field.text))
              ],
            ));
  }
}

class PlaylistDetail extends StatelessWidget {
  const PlaylistDetail(
      {super.key, required this.c, required this.playlistIndex});
  final AppController c;
  final int playlistIndex;

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
      animation: c,
      builder: (_, __) {
        if (playlistIndex >= c.playlists.length) {
          return Scaffold(
              appBar: AppBar(), body: const Center(child: Text('歌单已删除')));
        }
        final playlist = c.playlists[playlistIndex];
        final items = playlist.trackIds
            .map((id) => c.tracks.where((track) => track.id == id).firstOrNull)
            .whereType<Track>()
            .toList();
        return _VinylPlaylistPage(
          c: c,
          title: playlist.name,
          items: items,
          heroTag: 'playlist:${playlist.id}',
          missingCount: playlist.trackIds.length - items.length,
          onRemove: (track) => c.removeFromPlaylist(playlistIndex, track.id),
          onReorder: (oldIndex, newIndex) => c.movePlaylistTrack(
              playlistIndex,
              playlist.trackIds.indexOf(items[oldIndex].id),
              playlist.trackIds.indexOf(
                  items[newIndex > oldIndex ? newIndex - 1 : newIndex].id)),
        );
      });
}

class TrackCard extends StatelessWidget {
  const TrackCard(
      {super.key,
      required this.track,
      required this.playing,
      required this.saved,
      required this.onPlay,
      required this.onSave,
      required this.onOpen});
  final Track track;
  final bool playing;
  final bool saved;
  final VoidCallback onPlay;
  final VoidCallback onSave;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) => Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: HardCard(
          padding: EdgeInsets.zero,
          child: Column(children: [
            InkWell(
                onTap: onOpen,
                child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(children: [
                      RecordSleeve(
                          size: 52,
                          color: HB.sleeve(track.color),
                          coverUrl: track.coverUrl),
                      const SizedBox(width: 12),
                      Expanded(
                          child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                            Text(track.title,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: Theme.of(context).textTheme.titleMedium),
                            const SizedBox(height: 4),
                            Text(track.artist,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    fontSize: 14, color: HB.muted)),
                          ])),
                      const SizedBox(width: 4),
                      const Icon(Icons.chevron_right,
                          size: 20, color: HB.muted),
                    ]))),
            Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                        '${track.style} · ${track.bpmLabel} BPM · ${track.resourceLabel}',
                        style:
                            const TextStyle(fontSize: 14, color: HB.muted)))),
            if (playing)
              const Padding(
                  padding: EdgeInsets.fromLTRB(12, 8, 12, 0),
                  child: Row(children: [
                    Icon(Icons.equalizer_rounded, size: 18, color: HB.deepTeal),
                    SizedBox(width: 6),
                    Text('正在播放',
                        style: TextStyle(color: HB.deepTeal, fontSize: 14))
                  ])),
            const Divider(height: 16),
            Row(children: [
              Expanded(
                  child: TextButton.icon(
                      onPressed: track.canPlay ? onPlay : null,
                      icon: Icon(playing
                          ? Icons.replay_rounded
                          : Icons.play_arrow_rounded),
                      label: Text(!track.canPlay
                          ? '暂无音频'
                          : playing
                              ? '重新播放'
                              : '手机播放'))),
              Expanded(
                  child: TextButton.icon(
                      onPressed: saved ? null : onSave,
                      icon: Icon(
                          saved ? Icons.check : Icons.favorite_border_rounded),
                      label: Text(saved
                          ? '已保存'
                          : !track.canPlay
                              ? '收藏信息'
                              : '加入曲库'))),
            ]),
          ])));
}

class TrackDetail extends StatelessWidget {
  const TrackDetail({super.key, required this.track, required this.c});
  final Track track;
  final AppController c;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(backgroundColor: HB.paper, foregroundColor: HB.ink),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          Container(
              height: 260,
              decoration: BoxDecoration(
                  color: HB.sleeve(track.color),
                  borderRadius: HB.radius,
                  border: Border.all(color: HB.line)),
              padding: const EdgeInsets.all(18),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('${track.bpmLabel} BPM',
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                    Text(track.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.displayLarge)
                  ])),
          const SizedBox(height: 18),
          Text(track.artist, style: Theme.of(context).textTheme.headlineMedium),
          const SizedBox(height: 10),
          Text('${track.resourceLabel} · ${track.analysisLabel}',
              style: const TextStyle(fontSize: 14)),
          const SizedBox(height: 14),
          Row(children: [
            Expanded(
                child: _Fact(label: 'KEY', value: track.musicalKey ?? '待分析')),
            Expanded(
                child: _Fact(
                    label: 'ENERGY',
                    value: track.energy != null
                        ? '${track.energy} / 100'
                        : '待分析')),
            Expanded(
                child: _Fact(
                    label: 'BPM',
                    value: (track.bpm ?? 0) > 0 ? track.bpmLabel : '待分析'))
          ]),
          const Divider(height: 32, thickness: 2, color: HB.ink),
          if (track.isRemote || track.isNas) ...[
            AnalysisStatusPanel(c, track),
            if (c.detailsLoading.contains(track.id))
              const LinearProgressIndicator(),
            if (c.detailErrors[track.id] != null)
              _NetworkNotice(c.detailErrors[track.id]!,
                  onRetry: () => c.loadTrackDetail(track)),
            if (!c.detailsLoading.contains(track.id))
              TextButton(
                  onPressed: () => c.loadTrackDetail(track),
                  child: const Text('刷新分析结果')),
            if (track.analysisRunId != null)
              Text('分析版本：${track.analysisRunId}',
                  style: const TextStyle(fontSize: 14)),
            const SizedBox(height: 8),
          ],
          Text(track.reason, style: Theme.of(context).textTheme.titleMedium),
          if (!track.canPlay) ...[
            const SizedBox(height: 12),
            const HardCard(
                shadow: false,
                color: HB.errorSurface,
                child: Text('暂无可用音频。可以收藏歌曲信息，导入音频后再播放。'))
          ],
          const SizedBox(height: 22),
          Row(children: [
            Expanded(
                child: HardButton(
                    label: track.canPlay ? '在手机播放' : '暂无音频',
                    color: HB.acid,
                    onPressed: track.canPlay
                        ? () async {
                            await c.play(track);
                            c.setTab(0);
                            if (context.mounted) Navigator.pop(context);
                          }
                        : null)),
            const SizedBox(width: 8),
            Expanded(
                child: HardButton(
                    label: c.library.contains(track.id) ? '已保存 ✓' : '加入曲库',
                    onPressed: c.library.contains(track.id)
                        ? null
                        : () => c.save(track)))
          ]),
          const SizedBox(height: 10),
          HardButton(
              label: '加入歌单',
              color: HB.white,
              onPressed: () => showModalBottomSheet<void>(
                  context: context,
                  builder: (sheetContext) => SafeArea(
                      child: Padding(
                          padding: const EdgeInsets.all(18),
                          child: Column(
                              mainAxisSize: MainAxisSize.min,
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('选择歌单',
                                    style: Theme.of(context)
                                        .textTheme
                                        .headlineMedium),
                                const SizedBox(height: 12),
                                ...c.playlists.asMap().entries.map((entry) =>
                                    ListTile(
                                        title: Text(entry.value.name),
                                        subtitle: Text(
                                            '${entry.value.trackIds.length} 首'),
                                        trailing: const Icon(Icons.add),
                                        onTap: () {
                                          c.addToPlaylist(entry.key, track.id);
                                          Navigator.pop(sheetContext);
                                        }))
                              ]))))),
        ]),
      );
}

class MiniPlayer extends StatelessWidget {
  const MiniPlayer({super.key, required this.track, required this.controller});
  final Track track;
  final AppController controller;
  @override
  Widget build(BuildContext context) => HardCard(
      color: HB.mint,
      padding: const EdgeInsets.fromLTRB(12, 8, 8, 6),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Row(children: [
          Expanded(
              child: InkWell(
                  onTap: () => controller.setTab(0),
                  child: ConstrainedBox(
                      constraints: const BoxConstraints(minHeight: 48),
                      child: Row(children: [
                        RecordSleeve(
                            size: 40,
                            color: HB.sleeve(track.color),
                            coverUrl: controller.currentTrack(track).coverUrl),
                        const SizedBox(width: 10),
                        Expanded(
                            child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                              Text(track.title,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                      fontSize: 16,
                                      fontWeight: FontWeight.w700)),
                              Text(controller.isPlaying ? '正在播放' : '已暂停',
                                  style: const TextStyle(
                                      color: HB.muted, fontSize: 14)),
                            ])),
                      ])))),
          IconButton(
              onPressed: controller.previousTrack,
              icon: const Icon(Icons.skip_previous_rounded),
              tooltip: '上一首'),
          IconButton.filled(
              onPressed: controller.togglePlayback,
              style: IconButton.styleFrom(
                  backgroundColor: HB.ink, foregroundColor: HB.white),
              icon: Icon(controller.isPlaying
                  ? Icons.pause_rounded
                  : Icons.play_arrow_rounded),
              tooltip: controller.isPlaying ? '暂停' : '继续播放'),
          IconButton(
              onPressed: controller.nextTrack,
              icon: const Icon(Icons.skip_next_rounded),
              tooltip: '下一首'),
        ]),
        const SizedBox(height: 6),
        ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
                value: controller.duration.inMilliseconds == 0
                    ? 0
                    : (controller.position.inMilliseconds /
                            controller.duration.inMilliseconds)
                        .clamp(0, 1),
                minHeight: 3,
                color: HB.deepTeal,
                backgroundColor: HB.white)),
      ]));
}

class _PlaybackPosition extends StatefulWidget {
  const _PlaybackPosition(this.controller, {super.key, this.queueButton});

  final AppController controller;
  final Widget? queueButton;

  @override
  State<_PlaybackPosition> createState() => _PlaybackPositionState();
}

class _PlaybackPositionState extends State<_PlaybackPosition> {
  double? _preview;
  bool _seeking = false;

  Future<void> _finish(double value) async {
    setState(() {
      _preview = value;
      _seeking = true;
    });
    try {
      await widget.controller.seek(Duration(milliseconds: value.round()));
    } finally {
      if (mounted) {
        setState(() {
          _preview = null;
          _seeking = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.controller;
    final duration = c.duration.inMilliseconds.toDouble();
    final max = duration > 0 ? duration : 1.0;
    final enabled = duration > 0 &&
        !_seeking &&
        !c.danceRunning &&
        !c.audioBusy &&
        (!c.v3Active ||
            (c.v3State['current'] != null &&
                !c.v3Busy &&
                c.v3Pending?['locked'] != true));
    final value =
        (_preview ?? c.position.inMilliseconds.toDouble()).clamp(0.0, max);
    final elapsed = FullPlayer._time(Duration(milliseconds: value.round()));
    final total = FullPlayer._time(c.duration);
    final queueButton = widget.queueButton;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          label: '播放进度',
          child: Slider(
            key: const Key('playback-position'),
            value: value,
            max: max,
            activeColor: HB.deepTeal,
            semanticFormatterCallback: (value) =>
                FullPlayer._time(Duration(milliseconds: value.round())),
            onChanged:
                enabled ? (value) => setState(() => _preview = value) : null,
            onChangeEnd: enabled ? _finish : null,
          ),
        ),
        if (queueButton == null)
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [Text(elapsed), Text(total)],
          )
        else
          Wrap(
            spacing: 12,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text('$elapsed / $total',
                  style: const TextStyle(
                      color: HB.muted,
                      fontSize: 14,
                      fontFeatures: [FontFeature.tabularFigures()])),
              queueButton,
            ],
          ),
      ],
    );
  }
}

class FullPlayer extends StatelessWidget {
  const FullPlayer(this.c, {super.key});
  final AppController c;

  @override
  Widget build(BuildContext context) {
    final track = c.nowPlaying;
    if (track == null) return const SizedBox.shrink();
    return Scaffold(
        backgroundColor: HB.paper,
        appBar: AppBar(backgroundColor: Colors.transparent),
        body: SafeArea(
            top: false,
            child: SingleChildScrollView(
                child: Padding(
                    padding: const EdgeInsets.all(22),
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const SizedBox(height: 20),
                          Text('NOW / PHONE',
                              style: Theme.of(context).textTheme.titleMedium),
                          const SizedBox(height: 20),
                          Center(
                              child: RecordSleeve(
                                  size: 160,
                                  color: HB.sleeve(track.color),
                                  coverUrl: c.currentTrack(track).coverUrl)),
                          const SizedBox(height: 24),
                          Text(track.title,
                              style: Theme.of(context).textTheme.displayLarge),
                          const SizedBox(height: 8),
                          Text('${track.artist} · ${track.bpmLabel} BPM',
                              style: const TextStyle(
                                  fontWeight: FontWeight.w500,
                                  color: HB.muted,
                                  fontFeatures: [
                                    FontFeature.tabularFigures()
                                  ])),
                          const SizedBox(height: 28),
                          _PlaybackPosition(c, key: ValueKey(track.id)),
                          if (!c.v3Active)
                            Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  IconButton(
                                      tooltip: '顺序播放',
                                      onPressed: () => c.setPlaybackMode(
                                          PlaybackMode.sequential),
                                      color: c.playbackMode ==
                                              PlaybackMode.sequential
                                          ? HB.deepTeal
                                          : HB.ink,
                                      icon: const Icon(
                                          Icons.format_list_numbered)),
                                  IconButton(
                                      tooltip: '单曲循环',
                                      onPressed: () => c.setPlaybackMode(
                                          PlaybackMode.repeatOne),
                                      color: c.playbackMode ==
                                              PlaybackMode.repeatOne
                                          ? HB.deepTeal
                                          : HB.ink,
                                      icon: const Icon(Icons.repeat_one)),
                                  IconButton(
                                      tooltip: '随机播放',
                                      onPressed: () => c.setPlaybackMode(
                                          PlaybackMode.shuffle),
                                      color:
                                          c.playbackMode == PlaybackMode.shuffle
                                              ? HB.deepTeal
                                              : HB.ink,
                                      icon: const Icon(Icons.shuffle)),
                                ]),
                          const SizedBox(height: 22),
                          Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                IconButton.filled(
                                    tooltip: '上一首',
                                    onPressed:
                                        c.danceRunning ? null : c.previousTrack,
                                    icon: const Icon(Icons.skip_previous),
                                    iconSize: 34),
                                const SizedBox(width: 18),
                                IconButton.filled(
                                    tooltip: c.isPlaying ? '暂停播放' : '继续播放',
                                    style: IconButton.styleFrom(
                                        minimumSize: const Size(72, 72),
                                        backgroundColor: HB.ink,
                                        foregroundColor: HB.white),
                                    onPressed: c.togglePlayback,
                                    icon: Icon(c.isPlaying
                                        ? Icons.pause
                                        : Icons.play_arrow),
                                    iconSize: 44),
                                const SizedBox(width: 18),
                                IconButton.filled(
                                    tooltip: '下一首',
                                    onPressed: c.nextTrack,
                                    icon: const Icon(Icons.skip_next),
                                    iconSize: 34)
                              ]),
                          const SizedBox(height: 24),
                          Text(
                              c.danceRunning
                                  ? '舞程歌单 · ${c.queue.length} · 自动衔接'
                                  : c.v3Active
                                      ? '候选曲目 · ${c.queue.length} · 按方向实时选曲'
                                      : 'QUEUE · ${c.queue.length}',
                              style:
                                  const TextStyle(fontWeight: FontWeight.w600)),
                          const SizedBox(height: 8),
                          SizedBox(
                              height: 240,
                              child: ReorderableListView(
                                  buildDefaultDragHandles: !c.v3Active,
                                  onReorder: (oldIndex, newIndex) =>
                                      c.moveQueueItem(
                                          oldIndex,
                                          newIndex > oldIndex
                                              ? newIndex - 1
                                              : newIndex),
                                  children: c.queue.map((id) {
                                    final item = c.tracks
                                        .where(
                                            (candidate) => candidate.id == id)
                                        .firstOrNull;
                                    if (item == null) {
                                      return const SizedBox.shrink();
                                    }
                                    return ListTile(
                                        key: ValueKey(id),
                                        dense: true,
                                        selected: item.id == track.id,
                                        title: Text(item.title),
                                        subtitle: Text(item.artist),
                                        trailing: c.v3Active
                                            ? null
                                            : IconButton(
                                                icon: const Icon(Icons.close),
                                                onPressed: () =>
                                                    c.removeQueueItem(id)),
                                        onTap: () => c.play(item));
                                  }).toList()))
                        ])))));
  }

  static String _time(Duration value) =>
      '${value.inMinutes}:${(value.inSeconds % 60).toString().padLeft(2, '0')}';
}

class _Fact extends StatelessWidget {
  const _Fact({required this.label, required this.value});
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) =>
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label,
            style: const TextStyle(
                color: HB.muted, fontSize: 14, fontWeight: FontWeight.w600)),
        Text(value,
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600))
      ]);
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title, {required this.action});
  final String title;
  final String action;
  @override
  Widget build(BuildContext context) => Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 12,
          runSpacing: 4,
          children: [
            Text(title, style: Theme.of(context).textTheme.headlineMedium),
            Text(action,
                style:
                    const TextStyle(fontSize: 14, fontWeight: FontWeight.w600))
          ]));
}

class _Placeholder extends StatelessWidget {
  const _Placeholder({required this.section, this.copy = '该分区将在后续纵向切片中接入。'});
  final String section;
  final String copy;
  @override
  Widget build(BuildContext context) => HardCard(
      shadow: false,
      child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 34),
          child: Center(
              child: Column(children: [
            const Text('＋',
                style: TextStyle(fontSize: 42, fontWeight: FontWeight.w300)),
            Text(section, style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 5),
            Text(copy,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 14))
          ]))));
}
