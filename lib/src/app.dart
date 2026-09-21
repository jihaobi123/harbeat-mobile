import 'dart:async';

import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';

import 'audio_service.dart';
import 'accessory_ble.dart';
import 'backend.dart';
import 'controller.dart';
import 'local_store.dart';
import 'models.dart';
import 'nas_repository.dart';
import 'repository.dart';
import 'theme.dart';

part 'phone_screens.dart';
part 'backend_screen.dart';
part 'upload_screen.dart';

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
        IndexedStack(index: controller.tab, children: pages),
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
              icon: Icon(Icons.tune),
              selectedIcon: Icon(Icons.tune),
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
      required this.children});
  final String label;
  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 100),
        children: [
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            Text(label,
                style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1.8)),
            const Text('H/B  001',
                style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800)),
          ]),
          const SizedBox(height: 10),
          Text(title, style: Theme.of(context).textTheme.displayLarge),
          const Divider(height: 28, thickness: 3, color: HB.ink),
          ...children,
        ],
      );
}

class MusicScreen extends StatelessWidget {
  const MusicScreen(this.c, {super.key});
  final AppController c;

  @override
  Widget build(BuildContext context) => PageFrame(
          label: 'MUSIC / PERSONAL',
          title: 'FIND YOUR\nNEXT MOVE.',
          children: [
            Row(
                children: List.generate(
                    3,
                    (i) => Expanded(
                        child: InkWell(
                            onTap: () => c.setMusicSection(i),
                            child: Container(
                              padding: const EdgeInsets.symmetric(vertical: 11),
                              decoration: BoxDecoration(
                                  color: (c.musicSection >= 2
                                              ? 2
                                              : c.musicSection) ==
                                          i
                                      ? HB.ink
                                      : Colors.transparent,
                                  border: Border.all(color: HB.ink)),
                              alignment: Alignment.center,
                              child: Text(['推荐', '搜索', '曲库'][i],
                                  style: TextStyle(
                                      color: (c.musicSection >= 2
                                                  ? 2
                                                  : c.musicSection) ==
                                              i
                                          ? HB.white
                                          : HB.ink,
                                      fontWeight: FontWeight.w900,
                                      fontSize: 12)),
                            ))))),
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
                        color: c.musicSection == 2 ? HB.acid : HB.white,
                        onPressed: () => c.setMusicSection(2))),
                const SizedBox(width: 8),
                Expanded(
                    child: HardButton(
                        label: '歌单',
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
        const Text('选好音乐，带进你的练习。',
            style: TextStyle(fontWeight: FontWeight.w900)),
        const SizedBox(height: 6),
        Text(
            c.nasRepository != null
                ? 'NAS 预处理音乐 · 原曲歌单与 V3 连续混音。'
                : c.isRemoteMode
                    ? '在线曲库 · 播放对应原曲。收藏与歌单保存在本机。'
                    : '推荐为示例目录，试听共用演示音频；也可以导入自己的音乐。',
            style: const TextStyle(fontSize: 12)),
        const SizedBox(height: 20),
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
                              fontSize: 11, fontWeight: FontWeight.w900)),
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
          ...(c.isRemoteMode
                  ? c.cloudTracks
                  : c.catalogTracks.where((t) => !t.isNas && !t.isRenderedMix))
              .map((t) => TrackCard(
                  track: t,
                  playing: c.nowPlaying?.id == t.id && c.isPlaying,
                  saved: c.library.contains(t.id),
                  onPlay: () async {
                    await c.play(t);
                    c.setTab(0);
                  },
                  onSave: () => c.save(t),
                  onOpen: () => _openTrack(context, c, t))),
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
        HardCard(
            color: HB.orange,
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('NAS SELECT / MIX V3',
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w900)),
              const SizedBox(height: 24),
              Text('HIP-HOP\nSIX',
                  style: Theme.of(context).textTheme.headlineLarge),
              const SizedBox(height: 12),
              const Text('6 首 · Trap / Grime · 4 分 21 秒',
                  style: TextStyle(fontWeight: FontWeight.w900)),
              const SizedBox(height: 8),
              Text(c.featuredNasTracks.map((t) => t.title).join(' → '),
                  style: const TextStyle(fontSize: 12)),
              const SizedBox(height: 16),
              HardButton(
                  label: '播放 V3 混音',
                  color: HB.acid,
                  onPressed:
                      c.directionBusy ? null : () => c.playNasSet(mixed: true)),
              const SizedBox(height: 10),
              HardButton(
                  label: '播放六首原曲',
                  color: HB.white,
                  onPressed: c.directionBusy || c.featuredNasTracks.length != 6
                      ? null
                      : () => c.playNasSet(mixed: false)),
              const SizedBox(height: 10),
              const Text('精选已加入歌单。混音已渲染，可离线试听；原曲播放需要网络。',
                  style: TextStyle(fontSize: 11)),
              const SizedBox(height: 14),
              HardButton(
                  label: c.openingRealtimeLab ? '正在打开…' : 'V3 实时混音',
                  color: HB.white,
                  onPressed: c.directionBusy || c.openingRealtimeLab
                      ? null
                      : c.openRealtimeLab),
              const SizedBox(height: 8),
              const Text('在播放页实时换歌、调能量，六首素材已内置。请保持前台；网页版打开在线试听。',
                  style: TextStyle(fontSize: 11)),
              if (c.realtimeLabError != null)
                Text(c.realtimeLabError!, style: const TextStyle(fontSize: 11)),
            ])),
        const SizedBox(height: 24),
        _SectionTitle('NAS 推荐曲库', action: '${c.nasTracks.length} TRACKS'),
        Text(
            c.nasLive
                ? '已连接 Jetson NAS · 按歌曲合并分析版本'
                : '目录快照 ${c.nasRepository?.snapshotDate ?? ''} · 正在检查更新',
            style: const TextStyle(fontSize: 11)),
        const SizedBox(height: 10),
        HardButton(
            label: c.nasLoading ? '正在刷新 NAS…' : '刷新 NAS 曲库',
            color: HB.white,
            onPressed: c.nasLoading ? null : c.refreshNas),
        if (c.nasError != null)
          _NetworkNotice(c.nasError!, onRetry: c.refreshNas),
        const SizedBox(height: 12),
        ...c.nasTracks.take(c.nasVisibleCount).map((t) => TrackCard(
            track: t,
            playing: c.nowPlaying?.id == t.id && c.isPlaying,
            saved: c.library.contains(t.id),
            onPlay: () async {
              await c.play(t);
              if (c.isPlaying) c.setTab(0);
            },
            onSave: () => c.save(t),
            onOpen: () => _openTrack(context, c, t))),
        if (c.nasTracks.length > c.nasVisibleCount)
          HardButton(
              label: '更多 NAS 音乐', color: HB.acid, onPressed: c.showMoreNas),
      ];

  List<Widget> _library(BuildContext context) {
    final items = c.tracks.where((t) => c.library.contains(t.id)).toList();
    return items.isEmpty
        ? [
            const _Placeholder(section: '曲库为空', copy: '收藏喜欢的音乐，或导入自己的音频。'),
            const SizedBox(height: 12),
            HardButton(label: '去选音乐', onPressed: () => c.setMusicSection(0))
          ]
        : items
            .map((t) => TrackCard(
                track: t,
                playing: false,
                saved: true,
                onPlay: () async {
                  await c.play(t);
                  c.setTab(0);
                },
                onSave: () {},
                onOpen: () => _openTrack(context, c, t)))
            .toList();
  }

  List<Widget> _playlists(BuildContext context) => [
        ...c.playlists.asMap().entries.map((entry) => Padding(
              padding: const EdgeInsets.only(bottom: 14),
              child: HardCard(
                  color: entry.key.isEven ? HB.blue : HB.orange,
                  onTap: () => Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => AnimatedBuilder(
                          animation: c,
                          builder: (_, __) =>
                              PlaylistDetail(c: c, playlistIndex: entry.key)))),
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('PLAYLIST / 0${entry.key + 1}',
                            style: TextStyle(
                                color: entry.key.isEven ? HB.acid : HB.ink,
                                fontSize: 10,
                                fontWeight: FontWeight.w900)),
                        const SizedBox(height: 30),
                        Text(entry.value.name,
                            style: Theme.of(context)
                                .textTheme
                                .headlineLarge
                                ?.copyWith(
                                    color:
                                        entry.key.isEven ? HB.white : HB.ink)),
                        Row(children: [
                          Expanded(
                              child: Text(
                                  '${entry.value.trackIds.length} TRACKS',
                                  style: TextStyle(
                                      color: entry.key.isEven
                                          ? HB.white
                                          : HB.ink))),
                          IconButton(
                              onPressed: () => _renamePlaylist(
                                  context, entry.key, entry.value.name),
                              icon: Icon(Icons.edit,
                                  color: entry.key.isEven ? HB.white : HB.ink),
                              tooltip: '重命名歌单'),
                          IconButton(
                              onPressed: () => _deletePlaylist(
                                  context, entry.key, entry.value.name),
                              icon: Icon(Icons.delete_outline,
                                  color: entry.key.isEven ? HB.white : HB.ink),
                              tooltip: '删除歌单')
                        ]),
                      ])),
            )),
        HardButton(
            label: '+ 新建歌单',
            color: HB.white,
            onPressed: () => _createPlaylist(context)),
      ];

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
                  side: BorderSide(color: HB.ink, width: 2)),
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
  Widget build(BuildContext context) {
    if (playlistIndex >= c.playlists.length) {
      return const Scaffold(body: Center(child: Text('歌单已删除')));
    }
    final playlist = c.playlists[playlistIndex];
    final items = playlist.trackIds
        .map((id) => c.tracks.where((track) => track.id == id).firstOrNull)
        .whereType<Track>()
        .toList();
    return Scaffold(
        appBar: AppBar(backgroundColor: HB.paper),
        body: Padding(
            padding: const EdgeInsets.all(16),
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(playlist.name,
                  style: Theme.of(context).textTheme.displayLarge),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(
                    child: HardButton(
                        label: '播放全部',
                        onPressed: !items.any((t) => t.canPlay)
                            ? null
                            : () {
                                c.setQueue(playlist.trackIds);
                                c.play(items.firstWhere((t) => t.canPlay));
                                c.setTab(0);
                                Navigator.pop(context);
                              })),
                const SizedBox(width: 8),
                Expanded(
                    child: HardButton(
                        label: '加入播放队列',
                        color: HB.white,
                        onPressed: !items.any((t) => t.canPlay)
                            ? null
                            : () {
                                c.setQueue([...c.queue, ...playlist.trackIds]);
                                ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(
                                        content: Text('可用音频已加入播放队列')));
                              }))
              ]),
              const SizedBox(height: 18),
              Expanded(
                  child: items.isEmpty
                      ? const _Placeholder(
                          section: '空歌单', copy: '从歌曲详情把音乐加入这里。')
                      : ReorderableListView.builder(
                          itemCount: items.length,
                          onReorder: (oldIndex, newIndex) =>
                              c.movePlaylistTrack(
                                  playlistIndex,
                                  oldIndex,
                                  newIndex > oldIndex
                                      ? newIndex - 1
                                      : newIndex),
                          itemBuilder: (_, index) {
                            final track = items[index];
                            return ListTile(
                                key: ValueKey(track.id),
                                tileColor: index.isEven ? HB.white : HB.paper,
                                leading: Container(
                                    width: 42,
                                    height: 42,
                                    color: track.color,
                                    alignment: Alignment.center,
                                    child: Text(track.bpmLabel,
                                        style: const TextStyle(
                                            fontWeight: FontWeight.w900))),
                                title: Text(track.title,
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w900)),
                                subtitle: Text(
                                    '${track.artist} · ${track.resourceLabel}'),
                                trailing: IconButton(
                                    onPressed: () => c.removeFromPlaylist(
                                        playlistIndex, track.id),
                                    icon: const Icon(Icons.close),
                                    tooltip: '从歌单移除'));
                          }))
            ])));
  }
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
        padding: const EdgeInsets.only(bottom: 14),
        child: HardCard(
            shadow: false,
            padding: EdgeInsets.zero,
            child: Column(children: [
              InkWell(
                  onTap: onOpen,
                  child: Row(children: [
                    Container(
                        width: 84,
                        height: 92,
                        color: track.color,
                        alignment: Alignment.center,
                        child: Text(
                            (track.bpm ?? 0) > 0
                                ? '${track.bpmLabel}\nBPM'
                                : track.isLocal
                                    ? 'LOCAL'
                                    : 'BPM 待分析',
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                                fontWeight: FontWeight.w900, fontSize: 18))),
                    Expanded(
                        child: Padding(
                            padding: const EdgeInsets.all(12),
                            child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                      '${track.style} · ${track.resourceLabel}',
                                      style: const TextStyle(
                                          fontSize: 9,
                                          fontWeight: FontWeight.w900,
                                          letterSpacing: 1.5)),
                                  const SizedBox(height: 5),
                                  Text(track.title,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: Theme.of(context)
                                          .textTheme
                                          .titleMedium),
                                  Text(track.artist,
                                      style: const TextStyle(fontSize: 11)),
                                  const SizedBox(height: 7),
                                  Text(track.reason,
                                      style: const TextStyle(
                                          fontSize: 11,
                                          fontWeight: FontWeight.w800)),
                                ]))),
                  ])),
              const Divider(height: 1, color: HB.ink, thickness: 2),
              Row(children: [
                Expanded(
                    child: TextButton.icon(
                        onPressed: track.canPlay ? onPlay : null,
                        icon: Icon(playing ? Icons.pause : Icons.play_arrow),
                        label: Text(!track.canPlay
                            ? '暂无音频'
                            : playing
                                ? '重新播放'
                                : '手机播放'))),
                Container(width: 2, height: 44, color: HB.ink),
                Expanded(
                    child: TextButton.icon(
                        onPressed: saved ? null : onSave,
                        icon: Icon(saved ? Icons.check : Icons.add),
                        label: Text(saved
                            ? '已保存'
                            : !track.canPlay
                                ? '收藏信息'
                                : '加入曲库'))),
              ]),
            ])),
      );
}

class TrackDetail extends StatelessWidget {
  const TrackDetail({super.key, required this.track, required this.c});
  final Track track;
  final AppController c;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(backgroundColor: track.color, foregroundColor: HB.ink),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          Container(
              height: 260,
              color: track.color,
              padding: const EdgeInsets.all(18),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('${track.bpmLabel} BPM',
                        style: const TextStyle(fontWeight: FontWeight.w900)),
                    Text(track.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.displayLarge)
                  ])),
          const SizedBox(height: 18),
          Text(track.artist, style: Theme.of(context).textTheme.headlineMedium),
          const SizedBox(height: 10),
          Text('${track.resourceLabel} · ${track.analysisLabel}',
              style: const TextStyle(fontSize: 12)),
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
                  style: const TextStyle(fontSize: 11)),
            const SizedBox(height: 8),
          ],
          Text(track.reason, style: Theme.of(context).textTheme.titleMedium),
          if (!track.canPlay) ...[
            const SizedBox(height: 12),
            const HardCard(
                shadow: false,
                color: Color(0xFFFFD4C9),
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
  Widget build(BuildContext context) => Material(
      color: Colors.transparent,
      child: HardCard(
          color: HB.ink,
          shadow: false,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            InkWell(
                onTap: () => controller.setTab(0),
                child: Row(children: [
                  Container(width: 35, height: 35, color: track.color),
                  const SizedBox(width: 9),
                  Expanded(
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                        Text(track.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                color: HB.white,
                                fontSize: 12,
                                fontWeight: FontWeight.w900)),
                        Text('${track.bpmLabel} BPM · PHONE',
                            style: const TextStyle(
                                color: Colors.white60, fontSize: 9))
                      ])),
                  IconButton(
                      onPressed: controller.previousTrack,
                      icon: const Icon(Icons.skip_previous, color: HB.white),
                      tooltip: '上一首'),
                  IconButton(
                      onPressed: controller.togglePlayback,
                      icon: Icon(
                          controller.isPlaying ? Icons.pause : Icons.play_arrow,
                          color: HB.acid),
                      tooltip: controller.isPlaying ? '暂停' : '继续播放'),
                  IconButton(
                      onPressed: controller.nextTrack,
                      icon: const Icon(Icons.skip_next, color: HB.white),
                      tooltip: '下一首')
                ])),
            LinearProgressIndicator(
                value: controller.duration.inMilliseconds == 0
                    ? 0
                    : (controller.position.inMilliseconds /
                            controller.duration.inMilliseconds)
                        .clamp(0, 1),
                minHeight: 3,
                color: HB.acid,
                backgroundColor: Colors.white24)
          ])));
}

class FullPlayer extends StatelessWidget {
  const FullPlayer(this.c, {super.key});
  final AppController c;

  @override
  Widget build(BuildContext context) {
    final track = c.nowPlaying;
    if (track == null) return const SizedBox.shrink();
    final max = c.duration.inMilliseconds <= 0
        ? 1.0
        : c.duration.inMilliseconds.toDouble();
    return Scaffold(
        backgroundColor: track.color,
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
                          const SizedBox(height: 12),
                          Text(track.title,
                              style: Theme.of(context).textTheme.displayLarge),
                          const SizedBox(height: 8),
                          Text('${track.artist} · ${track.bpmLabel} BPM',
                              style:
                                  const TextStyle(fontWeight: FontWeight.w900)),
                          const SizedBox(height: 28),
                          Slider(
                              value: c.position.inMilliseconds
                                  .toDouble()
                                  .clamp(0, max),
                              max: max,
                              activeColor: HB.ink,
                              onChanged: c.danceRunning
                                  ? null
                                  : (value) => c.seek(
                                      Duration(milliseconds: value.round()))),
                          Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(_time(c.position)),
                                Text(_time(c.duration))
                              ]),
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
                                          ? HB.orange
                                          : HB.ink,
                                      icon: const Icon(
                                          Icons.format_list_numbered)),
                                  IconButton(
                                      tooltip: '单曲循环',
                                      onPressed: () => c.setPlaybackMode(
                                          PlaybackMode.repeatOne),
                                      color: c.playbackMode ==
                                              PlaybackMode.repeatOne
                                          ? HB.orange
                                          : HB.ink,
                                      icon: const Icon(Icons.repeat_one)),
                                  IconButton(
                                      tooltip: '随机播放',
                                      onPressed: () => c.setPlaybackMode(
                                          PlaybackMode.shuffle),
                                      color:
                                          c.playbackMode == PlaybackMode.shuffle
                                              ? HB.orange
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
                                        backgroundColor: HB.acid,
                                        foregroundColor: HB.ink),
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
                                  const TextStyle(fontWeight: FontWeight.w900)),
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
                color: Colors.grey, fontSize: 9, fontWeight: FontWeight.w900)),
        Text(value,
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900))
      ]);
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title, {required this.action});
  final String title;
  final String action;
  @override
  Widget build(BuildContext context) => Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        Text(title, style: Theme.of(context).textTheme.headlineMedium),
        Text(action,
            style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w900))
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
                style: const TextStyle(fontSize: 11))
          ]))));
}
