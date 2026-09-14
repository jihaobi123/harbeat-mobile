import 'package:flutter/material.dart';

import 'audio_service.dart';
import 'controller.dart';
import 'local_store.dart';
import 'models.dart';
import 'repository.dart';
import 'theme.dart';

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
        localStore: widget.localStore, audio: widget.audio)
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
      HomeScreen(controller),
      MusicScreen(controller),
      DeviceScreen(controller),
      ProfileScreen(controller)
    ];
    return Scaffold(
      body: SafeArea(
          child: Stack(children: [
        IndexedStack(index: controller.tab, children: pages),
        if (controller.nowPlaying case final track?)
          Positioned(
              left: 12,
              right: 12,
              bottom: 6,
              child: MiniPlayer(track: track, controller: controller)),
      ])),
      bottomNavigationBar: NavigationBar(
        selectedIndex: controller.tab,
        onDestinationSelected: controller.setTab,
        destinations: const [
          NavigationDestination(
              icon: Icon(Icons.home_outlined),
              selectedIcon: Icon(Icons.home),
              label: '首页'),
          NavigationDestination(
              icon: Icon(Icons.album_outlined),
              selectedIcon: Icon(Icons.album),
              label: '音乐'),
          NavigationDestination(
              icon: Icon(Icons.sensors_outlined),
              selectedIcon: Icon(Icons.sensors),
              label: '设备'),
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

class DeviceStatusBar extends StatelessWidget {
  const DeviceStatusBar({super.key, required this.status, required this.onTap});
  final DeviceConnection status;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final online = status == DeviceConnection.online;
    return HardCard(
      color: online ? HB.acid : HB.orange,
      onTap: onTap,
      child: Row(children: [
        Icon(online ? Icons.check_circle : Icons.sync, color: HB.ink),
        const SizedBox(width: 10),
        Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(online ? 'RK3588 · ONLINE' : '正在确认设备',
              style: Theme.of(context).textTheme.titleMedium),
          Text(online ? 'HarBeat Stage 01 / 延迟 18ms' : '读取设备快照中',
              style: const TextStyle(fontSize: 11)),
        ])),
        const Icon(Icons.arrow_forward),
      ]),
    );
  }
}

class HomeScreen extends StatelessWidget {
  const HomeScreen(this.c, {super.key});
  final AppController c;

  @override
  Widget build(BuildContext context) => PageFrame(
          label: 'TUESDAY / 18 AUG',
          title: 'MAKE\nTHE FLOOR\nMOVE.',
          children: [
            DeviceStatusBar(status: c.device, onTap: () => c.setTab(2)),
            const SizedBox(height: 20),
            HardCard(
                color: HB.blue,
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('PREP  /  03',
                          style: TextStyle(
                              color: HB.acid,
                              fontSize: 11,
                              fontWeight: FontWeight.w900)),
                      const SizedBox(height: 30),
                      Text('今晚的\nCYPHER',
                          style: Theme.of(context)
                              .textTheme
                              .headlineLarge
                              ?.copyWith(color: HB.white)),
                      const SizedBox(height: 10),
                      const Text('18 首歌 · Pad 预设待同步',
                          style: TextStyle(color: HB.white)),
                      const SizedBox(height: 14),
                      HardButton(
                          label: '继续准备 →',
                          onPressed: () => Navigator.of(context).push(
                              MaterialPageRoute(
                                  builder: (_) => AnimatedBuilder(
                                      animation: c,
                                      builder: (_, __) => PrepareWizard(c))))),
                    ])),
            const SizedBox(height: 24),
            const _SectionTitle('快速开始', action: 'QUICK / 02'),
            Row(children: [
              Expanded(
                  child: HardCard(
                      shadow: false,
                      onTap: () => c.setTab(1),
                      child: const Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(Icons.play_arrow, size: 34),
                            SizedBox(height: 18),
                            Text('手机播放',
                                style: TextStyle(fontWeight: FontWeight.w900))
                          ]))),
              const SizedBox(width: 10),
              Expanded(
                  child: HardCard(
                      shadow: false,
                      color: HB.orange,
                      onTap: () => c.setTab(2),
                      child: const Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(Icons.add_link, size: 34),
                            SizedBox(height: 18),
                            Text('连接设备',
                                style: TextStyle(fontWeight: FontWeight.w900))
                          ]))),
            ]),
          ]);
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
                    4,
                    (i) => Expanded(
                        child: InkWell(
                            onTap: () => c.setMusicSection(i),
                            child: Container(
                              padding: const EdgeInsets.symmetric(vertical: 11),
                              decoration: BoxDecoration(
                                  color: c.musicSection == i
                                      ? HB.ink
                                      : Colors.transparent,
                                  border: Border.all(color: HB.ink)),
                              alignment: Alignment.center,
                              child: Text(['推荐', '搜索', '曲库', '歌单'][i],
                                  style: TextStyle(
                                      color: c.musicSection == i
                                          ? HB.white
                                          : HB.ink,
                                      fontWeight: FontWeight.w900,
                                      fontSize: 12)),
                            ))))),
            const SizedBox(height: 20),
            if (c.musicSection == 0)
              ..._recommendations(context)
            else if (c.musicSection == 1)
              ..._search(context)
            else if (c.musicSection == 2)
              ..._library(context)
            else
              ..._playlists(context),
          ]);

  List<Widget> _recommendations(BuildContext context) => [
        Wrap(
            spacing: 7,
            runSpacing: 7,
            children: ['POPPING', 'HIP-HOP', '88–112 BPM', '+ 编辑']
                .map((x) => Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                    decoration: BoxDecoration(
                        color: x.startsWith('+') ? HB.white : HB.acid,
                        border: Border.all(color: HB.ink, width: 2)),
                    child: Text(x,
                        style: const TextStyle(
                            fontSize: 10, fontWeight: FontWeight.w900))))
                .toList()),
        const SizedBox(height: 20),
        HardCard(
            color: HB.orange,
            child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Expanded(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                    const Text('TODAY / MIX 04',
                        style: TextStyle(
                            fontSize: 11, fontWeight: FontWeight.w900)),
                    const SizedBox(height: 32),
                    Text('BODY\nELECTRIC',
                        style: Theme.of(context).textTheme.headlineLarge),
                    const Text('28 MIN · 8 TRACKS')
                  ])),
              IconButton.filled(
                  style: IconButton.styleFrom(
                      backgroundColor: HB.ink, foregroundColor: HB.acid),
                  onPressed:
                      c.tracks.isEmpty ? null : () => c.play(c.tracks.first),
                  icon: const Icon(Icons.play_arrow)),
            ])),
        const SizedBox(height: 25),
        const _SectionTitle('为你推荐', action: '换一批 ↻'),
        if (c.loading)
          const Padding(
              padding: EdgeInsets.all(30),
              child: Center(child: CircularProgressIndicator(color: HB.ink)))
        else
          ...c.tracks.map((t) => TrackCard(
              track: t,
              playing: c.nowPlaying?.id == t.id,
              saved: c.library.contains(t.id),
              onPlay: () => c.play(t),
              onSave: () => c.save(t),
              onOpen: () => Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => TrackDetail(track: t, c: c))))),
      ];

  List<Widget> _library(BuildContext context) {
    final items = c.tracks.where((t) => c.library.contains(t.id)).toList();
    return items.isEmpty
        ? [const _Placeholder(section: '曲库为空', copy: '从推荐中保存第一首歌。')]
        : items
            .map((t) => TrackCard(
                track: t,
                playing: false,
                saved: true,
                onPlay: () => c.play(t),
                onSave: () {},
                onOpen: () {}))
            .toList();
  }

  List<Widget> _search(BuildContext context) => [
        TextField(
          onChanged: c.setSearchQuery,
          decoration: const InputDecoration(
              prefixIcon: Icon(Icons.search),
              hintText: '歌曲、艺人、舞种',
              filled: true,
              fillColor: HB.white,
              border: OutlineInputBorder(
                  borderRadius: BorderRadius.zero,
                  borderSide: BorderSide(color: HB.ink, width: 2)),
              enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.zero,
                  borderSide: BorderSide(color: HB.ink, width: 2))),
        ),
        const SizedBox(height: 16),
        Row(children: [
          Expanded(
              child: HardButton(
                  label: '导入本地音频',
                  color: HB.white,
                  onPressed: c.importLocalAudio)),
          if (c.importedFiles.isNotEmpty) ...[
            const SizedBox(width: 8),
            Text('${c.importedFiles.length} FILES',
                style: const TextStyle(fontWeight: FontWeight.w900))
          ]
        ]),
        if (c.clientIssue != null)
          Padding(
              padding: const EdgeInsets.only(top: 12),
              child: HardCard(
                  shadow: false,
                  color: const Color(0xFFFFD4C9),
                  child: Row(children: [
                    const Icon(Icons.error_outline),
                    const SizedBox(width: 10),
                    Expanded(
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                          Text(c.clientIssue!.title,
                              style:
                                  const TextStyle(fontWeight: FontWeight.w900)),
                          Text(c.clientIssue!.detail,
                              style: const TextStyle(fontSize: 11)),
                        ])),
                    IconButton(
                        onPressed: c.clearClientIssue,
                        icon: const Icon(Icons.close))
                  ]))),
        if (c.importedFiles.isNotEmpty)
          Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: HardCard(
                  shadow: false,
                  color: HB.acid,
                  child: Text(c.importedFiles.join('\n'),
                      style: const TextStyle(
                          fontSize: 11, fontWeight: FontWeight.w900)))),
        const SizedBox(height: 16),
        if (c.loading)
          const Center(child: CircularProgressIndicator())
        else if (c.searchResults.isEmpty)
          const _Placeholder(section: '没有结果', copy: '换个关键词，或从本地导入有权使用的音乐。')
        else
          ...c.searchResults.map((t) => TrackCard(
              track: t,
              playing: c.nowPlaying?.id == t.id,
              saved: c.library.contains(t.id),
              onPlay: () => c.play(t),
              onSave: () => c.save(t),
              onOpen: () => Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => TrackDetail(track: t, c: c))))),
      ];

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
                        onPressed: items.isEmpty
                            ? null
                            : () {
                                c.setQueue(playlist.trackIds);
                                c.play(items.first);
                              })),
                const SizedBox(width: 8),
                Expanded(
                    child: HardButton(
                        label: '加入准备',
                        color: HB.white,
                        onPressed: items.isEmpty
                            ? null
                            : () => c.selectPlaylistForPrepare(playlist)))
              ]),
              const SizedBox(height: 18),
              Expanded(
                  child: items.isEmpty
                      ? const _Placeholder(
                          section: '空歌单', copy: '从歌曲详情把音乐加入这里。')
                      : ReorderableListView.builder(
                          itemCount: items.length,
                          onReorderItem: (oldIndex, newIndex) =>
                              c.movePlaylistTrack(
                                  playlistIndex, oldIndex, newIndex),
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
                                    child: Text('${track.bpm}',
                                        style: const TextStyle(
                                            fontWeight: FontWeight.w900))),
                                title: Text(track.title,
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w900)),
                                subtitle: Text(track.artist),
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
                        child: Text('${track.bpm}\nBPM',
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                                fontWeight: FontWeight.w900, fontSize: 18))),
                    Expanded(
                        child: Padding(
                            padding: const EdgeInsets.all(12),
                            child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(track.style,
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
                        onPressed: onPlay,
                        icon: Icon(playing ? Icons.pause : Icons.play_arrow),
                        label: Text(playing ? '播放中' : '试听'))),
                Container(width: 2, height: 44, color: HB.ink),
                Expanded(
                    child: TextButton.icon(
                        onPressed: saved ? null : onSave,
                        icon: Icon(saved ? Icons.check : Icons.add),
                        label: Text(saved
                            ? '已保存'
                            : track.availability ==
                                    TrackAvailability.metadataOnly
                                ? '存为候选'
                                : '加入曲库'))),
              ]),
            ])),
      );
}

class DeviceScreen extends StatelessWidget {
  const DeviceScreen(this.c, {super.key});
  final AppController c;

  @override
  Widget build(BuildContext context) => PageFrame(
          label: 'DEVICE / STAGE 01',
          title: 'READY\nMEANS READY.',
          children: [
            DeviceStatusBar(status: c.device, onTap: () {}),
            const SizedBox(height: 22),
            HardCard(
                color: HB.ink,
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('OUTPUT FACT',
                          style: TextStyle(
                              color: HB.acid,
                              fontSize: 10,
                              fontWeight: FontWeight.w900,
                              letterSpacing: 1.5)),
                      const SizedBox(height: 22),
                      Text('MAIN OUT / STEREO',
                          style: Theme.of(context)
                              .textTheme
                              .headlineMedium
                              ?.copyWith(color: HB.white)),
                      const SizedBox(height: 4),
                      const Text('RK3588 是当前播放事实源',
                          style:
                              TextStyle(color: Colors.white70, fontSize: 11)),
                      const SizedBox(height: 16),
                      const Row(children: [
                        Expanded(child: _Fact(label: 'STORAGE', value: '68%')),
                        Expanded(child: _Fact(label: 'LATENCY', value: '18ms')),
                        Expanded(child: _Fact(label: 'TRACKS', value: '126'))
                      ]),
                    ])),
            const SizedBox(height: 24),
            const _SectionTitle('Pad 预设', action: '8 SLOTS'),
            HardCard(
                onTap: () => Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => AnimatedBuilder(
                        animation: c, builder: (_, __) => PadEditor(c)))),
                child: Row(children: [
                  Container(
                      width: 52,
                      height: 52,
                      color: HB.orange,
                      alignment: Alignment.center,
                      child: const Text('03',
                          style: TextStyle(
                              fontWeight: FontWeight.w900, fontSize: 22))),
                  const SizedBox(width: 12),
                  Expanded(
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                        const Text('CYPHER FUN',
                            style: TextStyle(
                                fontWeight: FontWeight.w900, fontSize: 17)),
                        Text(
                            c.presetDirty
                                ? 'App v${c.appPresetVersion} / Device v${c.devicePresetVersion} · 待同步'
                                : '已同步到设备',
                            style: const TextStyle(fontSize: 11))
                      ])),
                  const Icon(Icons.arrow_forward),
                ])),
            const SizedBox(height: 18),
            HardButton(
                label: '播放测试音',
                color: HB.white,
                onPressed: () => ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('测试音命令已发送；等待 RK 快照确认')))),
            const SizedBox(height: 10),
            HardButton(
                label: '使用配对码连接',
                color: HB.orange,
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => AnimatedBuilder(
                        animation: c, builder: (_, __) => PairingScreen(c))))),
          ]);
}

class PadEditor extends StatelessWidget {
  const PadEditor(this.c, {super.key});
  final AppController c;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
            backgroundColor: HB.paper,
            title: const Text('PAD / EDIT 03'),
            centerTitle: false),
        body: ListView(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 40),
            children: [
              Text('HIT IT.\nMAKE IT YOURS.',
                  style: Theme.of(context).textTheme.displayLarge),
              const Divider(height: 28, thickness: 3, color: HB.ink),
              const Text('固定安全控制不会出现在这里。选择一个槽位编辑音效。',
                  style: TextStyle(fontSize: 12)),
              const SizedBox(height: 16),
              GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: 8,
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 2,
                    crossAxisSpacing: 9,
                    mainAxisSpacing: 9,
                    childAspectRatio: 1.35),
                itemBuilder: (_, i) {
                  final pad = c.pads[i];
                  final selected = c.selectedPad == i;
                  return InkWell(
                      onTap: () => c.selectPad(i),
                      child: Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                            color: [
                              HB.orange,
                              HB.blue,
                              HB.acid,
                              const Color(0xFFFFC400)
                            ][i % 4],
                            border: Border.all(
                                color: HB.ink, width: selected ? 5 : 2)),
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text('0${i + 1}',
                                  style: const TextStyle(
                                      fontWeight: FontWeight.w900)),
                              Text(pad.sound ?? 'EMPTY +',
                                  style: TextStyle(
                                      color: i % 4 == 1 ? HB.white : HB.ink,
                                      fontWeight: FontWeight.w900,
                                      fontSize: 16))
                            ]),
                      ));
                },
              ),
              const SizedBox(height: 22),
              _SectionTitle('Slot 0${c.selectedPad + 1}',
                  action: c.pads[c.selectedPad].sound ?? 'EMPTY'),
              Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: ['AIR HORN', 'CROWD UP', 'HIT', 'SCRATCH STOP']
                      .map((sound) => HardButton(
                          label: sound,
                          color: c.pads[c.selectedPad].sound == sound
                              ? HB.acid
                              : HB.white,
                          onPressed: () => c.assignSound(sound)))
                      .toList()),
              const SizedBox(height: 18),
              const Text('PLAY MODE',
                  style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 1.4)),
              const SizedBox(height: 8),
              SegmentedButton<String>(
                  segments: const [
                    ButtonSegment(value: 'once', label: Text('一次')),
                    ButtonSegment(value: 'hold', label: Text('按住')),
                    ButtonSegment(value: 'loop', label: Text('循环'))
                  ],
                  selected: {
                    c.pads[c.selectedPad].playMode
                  },
                  onSelectionChanged: (value) =>
                      c.updateSelectedPad(playMode: value.first)),
              const SizedBox(height: 14),
              Text('音量 ${(c.pads[c.selectedPad].volume * 100).round()}%',
                  style: const TextStyle(fontWeight: FontWeight.w900)),
              Slider(
                  value: c.pads[c.selectedPad].volume,
                  onChanged: (value) => c.updateSelectedPad(volume: value),
                  activeColor: HB.ink),
              Text('防连击 ${c.pads[c.selectedPad].retriggerGuardMs}ms',
                  style: const TextStyle(fontWeight: FontWeight.w900)),
              Slider(
                  value: c.pads[c.selectedPad].retriggerGuardMs.toDouble(),
                  min: 0,
                  max: 1000,
                  divisions: 10,
                  onChanged: (value) =>
                      c.updateSelectedPad(guardMs: value.round()),
                  activeColor: HB.ink),
              const SizedBox(height: 9),
              HardButton(
                  label: '复制到其他槽位',
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
                                  Text('复制 Slot 0${c.selectedPad + 1}',
                                      style: Theme.of(context)
                                          .textTheme
                                          .headlineMedium),
                                  const SizedBox(height: 10),
                                  Wrap(
                                      spacing: 8,
                                      runSpacing: 8,
                                      children: List.generate(
                                          8,
                                          (index) => HardButton(
                                              label: '0${index + 1}',
                                              color: index == c.selectedPad
                                                  ? Colors.grey.shade300
                                                  : HB.acid,
                                              onPressed: index == c.selectedPad
                                                  ? null
                                                  : () {
                                                      c.copySelectedPadTo(
                                                          index);
                                                      Navigator.pop(
                                                          sheetContext);
                                                    })))
                                ]),
                          )))),
              const SizedBox(height: 6),
              TextButton.icon(
                  onPressed: () => c.assignSound(null),
                  icon: const Icon(Icons.delete_outline),
                  label: const Text('清空槽位')),
              const Divider(height: 30, thickness: 2, color: HB.ink),
              if (c.presetDirty)
                const Text('⚠ App 版本与设备版本不同。同步会覆盖设备中的 Pad 预设。',
                    style: TextStyle(fontWeight: FontWeight.w800)),
              const SizedBox(height: 12),
              Row(children: [
                Expanded(
                    child: HardButton(
                        label: '保存到 App',
                        color: HB.white,
                        busy: c.savingPreset,
                        onPressed: c.savePreset)),
                const SizedBox(width: 8),
                Expanded(
                    child: HardButton(
                        label: '同步到设备',
                        busy: c.syncingPreset,
                        onPressed:
                            c.device == DeviceConnection.online && c.presetDirty
                                ? c.syncPreset
                                : null)),
              ]),
            ]),
      );
}

class ProfileScreen extends StatelessWidget {
  const ProfileScreen(this.c, {super.key});
  final AppController c;
  @override
  Widget build(BuildContext context) => PageFrame(
          label: 'PROFILE / PERSONAL',
          title: 'YOUR TASTE.\nYOUR RULES.',
          children: [
            const HardCard(
                color: HB.acid,
                child: Row(children: [
                  CircleAvatar(
                      backgroundColor: HB.ink,
                      foregroundColor: HB.white,
                      child: Text('F')),
                  SizedBox(width: 12),
                  Expanded(
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                        Text('FENG / DANCER',
                            style: TextStyle(fontWeight: FontWeight.w900)),
                        Text('Popping · Hiphop · Intermediate',
                            style: TextStyle(fontSize: 11))
                      ]))
                ])),
            const SizedBox(height: 24),
            const _SectionTitle('画像控制', action: 'PERSONAL ONLY'),
            const HardCard(
                shadow: false,
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('活动播放不写入个人画像',
                          style: TextStyle(fontWeight: FontWeight.w900)),
                      SizedBox(height: 6),
                      Text('一次现场的换歌和能量调整，不会改变你的长期推荐。',
                          style: TextStyle(fontSize: 12))
                    ])),
            const SizedBox(height: 22),
            _SectionTitle('使用记录', action: '${c.usageHistory.length} SESSIONS'),
            if (c.usageHistory.isEmpty)
              const _Placeholder(section: '暂无使用记录', copy: '结束一次现场使用后会保存在这里。')
            else
              ...c.usageHistory.map((record) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: HardCard(
                        shadow: false,
                        child: Row(children: [
                          const Icon(Icons.history),
                          const SizedBox(width: 10),
                          Expanded(
                              child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                Text(record.title,
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w900)),
                                Text(
                                    '${record.trackCount} 首 · ${record.endedAt.month}/${record.endedAt.day} ${record.endedAt.hour.toString().padLeft(2, '0')}:${record.endedAt.minute.toString().padLeft(2, '0')}',
                                    style: const TextStyle(fontSize: 11))
                              ]))
                        ])),
                  )),
          ]);
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
                    Text('${track.bpm} BPM',
                        style: const TextStyle(fontWeight: FontWeight.w900)),
                    Text(track.title,
                        style: Theme.of(context).textTheme.displayLarge)
                  ])),
          const SizedBox(height: 18),
          Text(track.artist, style: Theme.of(context).textTheme.headlineMedium),
          const SizedBox(height: 14),
          Row(children: [
            Expanded(child: _Fact(label: 'STYLE', value: track.style)),
            Expanded(child: _Fact(label: 'ENERGY', value: '${track.energy}%')),
            Expanded(child: _Fact(label: 'BPM', value: '${track.bpm}'))
          ]),
          const Divider(height: 32, thickness: 2, color: HB.ink),
          Text(track.reason, style: Theme.of(context).textTheme.titleMedium),
          if (track.availability == TrackAvailability.metadataOnly) ...[
            const SizedBox(height: 12),
            const HardCard(
                shadow: false,
                color: Color(0xFFFFD4C9),
                child: Text('只有元数据。可以保存为候选，但补充合法资源后才能完整播放。'))
          ],
          const SizedBox(height: 22),
          Row(children: [
            Expanded(
                child: HardButton(
                    label: '试听',
                    color: HB.ink,
                    onPressed: () => c.play(track))),
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

class PairingScreen extends StatefulWidget {
  const PairingScreen(this.c, {super.key});
  final AppController c;
  @override
  State<PairingScreen> createState() => _PairingScreenState();
}

class _PairingScreenState extends State<PairingScreen> {
  final code = TextEditingController();
  String? error;
  @override
  void dispose() {
    code.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(backgroundColor: HB.paper),
        body: ListView(padding: const EdgeInsets.all(20), children: [
          Container(
              width: 108,
              height: 108,
              color: HB.acid,
              alignment: Alignment.center,
              child: const Icon(Icons.link, size: 52)),
          const SizedBox(height: 28),
          Text('PAIR THE\nBEAT.',
              style: Theme.of(context).textTheme.displayLarge),
          const SizedBox(height: 12),
          const Text('输入设备屏幕上显示的 6 位配对码。连接会在 15 秒后超时。'),
          const SizedBox(height: 24),
          TextField(
              controller: code,
              maxLength: 6,
              keyboardType: TextInputType.number,
              textAlign: TextAlign.center,
              style: const TextStyle(
                  fontSize: 28, fontWeight: FontWeight.w900, letterSpacing: 8),
              decoration: const InputDecoration(
                  counterText: '',
                  hintText: '000000',
                  border: OutlineInputBorder(
                      borderRadius: BorderRadius.zero,
                      borderSide: BorderSide(width: 2)))),
          if (error != null)
            Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(error!,
                    style: const TextStyle(
                        color: HB.orange, fontWeight: FontWeight.w900))),
          const SizedBox(height: 14),
          HardButton(
              label: widget.c.pairing ? '正在配对…' : '连接 RK3588',
              busy: widget.c.pairing,
              onPressed: () async {
                final ok = await widget.c.pairDevice(code.text);
                if (!context.mounted) {
                  return;
                }
                if (ok) {
                  Navigator.pop(context);
                } else {
                  setState(() => error = '请输入完整的 6 位配对码');
                }
              }),
        ]),
      );
}

class PrepareWizard extends StatelessWidget {
  const PrepareWizard(this.c, {super.key});
  final AppController c;

  @override
  Widget build(BuildContext context) {
    final titles = ['选择音乐', '选择 Pad', '检查资源', '同步就绪'];
    return Scaffold(
      appBar: AppBar(
          backgroundColor: HB.paper,
          title: Text('PREP / 0${c.prepareStep + 1}'),
          actions: [
            TextButton(
                onPressed: () {
                  c.resetPrepare();
                  Navigator.pop(context);
                },
                child: const Text('退出'))
          ]),
      body: Column(children: [
        LinearProgressIndicator(
            value: (c.prepareStep + 1) / 4,
            minHeight: 8,
            color: HB.blue,
            backgroundColor: HB.white),
        Expanded(
            child: ListView(padding: const EdgeInsets.all(18), children: [
          Text(titles[c.prepareStep].toUpperCase(),
              style: Theme.of(context).textTheme.displayLarge),
          const Divider(height: 28, thickness: 3, color: HB.ink),
          if (c.prepareStep == 0) ..._music(context),
          if (c.prepareStep == 1) ..._pads(context),
          if (c.prepareStep == 2) ..._check(context),
          if (c.prepareStep == 3) ..._ready(context),
        ])),
        Container(
            color: HB.white,
            padding: const EdgeInsets.all(12),
            child: SafeArea(
                top: false,
                child: Row(children: [
                  Expanded(
                      child: HardButton(
                          label: '上一步',
                          color: HB.white,
                          onPressed: c.prepareStep == 0
                              ? null
                              : c.previousPrepareStep)),
                  const SizedBox(width: 8),
                  Expanded(
                      child: HardButton(
                          label: c.prepareStep == 3 ? '开始使用' : '继续 →',
                          onPressed: _canContinue
                              ? () {
                                  if (c.prepareStep == 3) {
                                    c.startLive();
                                    Navigator.of(context).pushReplacement(
                                        MaterialPageRoute(
                                            builder: (_) => AnimatedBuilder(
                                                animation: c,
                                                builder: (_, __) =>
                                                    LiveScreen(c))));
                                  } else {
                                    c.nextPrepareStep();
                                  }
                                }
                              : null)),
                ]))),
      ]),
    );
  }

  bool get _canContinue => switch (c.prepareStep) {
        0 => c.prepareTracks.isNotEmpty,
        1 => c.pads.any((p) => p.sound != null),
        2 => c.device == DeviceConnection.online,
        _ => c.resourceCheckPassed
      };

  List<Widget> _music(BuildContext context) => [
        const Text('选择本次使用的音乐。每次选择都会保留在当前草稿。'),
        const SizedBox(height: 14),
        const Text('整歌单加入', style: TextStyle(fontWeight: FontWeight.w900)),
        const SizedBox(height: 8),
        SizedBox(
            height: 52,
            child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: c.playlists.length,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (_, index) => HardButton(
                    label:
                        '${c.playlists[index].name} · ${c.playlists[index].trackIds.length}',
                    color: HB.white,
                    onPressed: c.playlists[index].trackIds.isEmpty
                        ? null
                        : () =>
                            c.selectPlaylistForPrepare(c.playlists[index])))),
        const SizedBox(height: 14),
        ...c.tracks.map((t) => CheckboxListTile(
            value: c.prepareTracks.contains(t.id),
            onChanged: (_) => c.togglePrepareTrack(t.id),
            activeColor: HB.ink,
            checkColor: HB.acid,
            shape: const Border.fromBorderSide(
                BorderSide(color: HB.ink, width: 2)),
            title: Text(t.title,
                style: const TextStyle(fontWeight: FontWeight.w900)),
            subtitle: Text('${t.artist} · ${t.bpm} BPM'))),
      ];

  List<Widget> _pads(BuildContext context) => [
        HardCard(
            color: HB.orange,
            child: Row(children: [
              const Expanded(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                    Text('CYPHER FUN',
                        style: TextStyle(
                            fontSize: 20, fontWeight: FontWeight.w900)),
                    Text('8 个槽位 · 4 个已配置')
                  ])),
              Text('APP v${c.appPresetVersion}',
                  style: const TextStyle(fontWeight: FontWeight.w900))
            ])),
        const SizedBox(height: 16),
        HardButton(
            label: '编辑 Pad 预设',
            color: HB.white,
            onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) => AnimatedBuilder(
                        animation: c, builder: (_, __) => PadEditor(c))))),
      ];

  List<Widget> _check(BuildContext context) => [
        _CheckRow(
            ok: c.device == DeviceConnection.online,
            title: '目标设备',
            detail: c.device == DeviceConnection.online
                ? 'HarBeat Stage 01 在线'
                : '设备未连接'),
        _CheckRow(
            ok: c.prepareTracks.isNotEmpty,
            title: '音乐资源',
            detail: '${c.prepareTracks.length} 首已选择'),
        _CheckRow(
            ok: c.pads.any((p) => p.sound != null),
            title: 'Pad 预设',
            detail: '${c.pads.where((p) => p.sound != null).length} 个槽位已配置'),
        const _CheckRow(
            ok: true, title: '协议兼容性', detail: 'RK protocol v1 · 兼容'),
      ];

  List<Widget> _ready(BuildContext context) => [
        HardCard(
            color: c.resourceCheckPassed ? HB.acid : HB.orange,
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(c.resourceCheckPassed ? 'READY / 100%' : 'BLOCKED',
                  style: Theme.of(context).textTheme.headlineLarge),
              const SizedBox(height: 10),
              Text(c.resourceCheckPassed
                  ? '${c.prepareTracks.length} 首音乐与 Pad 预设已完成 Mock 校验。'
                  : '返回检查设备与资源。'),
            ])),
        const SizedBox(height: 16),
        const Text('开始后，播放事实与命令结果将以 RK 快照为准。',
            style: TextStyle(fontWeight: FontWeight.w900)),
      ];
}

class _CheckRow extends StatelessWidget {
  const _CheckRow(
      {required this.ok, required this.title, required this.detail});
  final bool ok;
  final String title;
  final String detail;
  @override
  Widget build(BuildContext context) => Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: HardCard(
          shadow: false,
          color: ok ? HB.white : const Color(0xFFFFD4C9),
          child: Row(children: [
            Icon(ok ? Icons.check_box : Icons.error,
                color: ok ? HB.ink : HB.orange),
            const SizedBox(width: 10),
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  Text(title,
                      style: const TextStyle(fontWeight: FontWeight.w900)),
                  Text(detail, style: const TextStyle(fontSize: 11))
                ]))
          ])));
}

class LiveScreen extends StatelessWidget {
  const LiveScreen(this.c, {super.key});
  final AppController c;

  @override
  Widget build(BuildContext context) {
    final track = c.nowPlaying ?? (c.tracks.isNotEmpty ? c.tracks.first : null);
    final busy = ![LiveCommandState.idle, LiveCommandState.completed]
        .contains(c.commandState);
    return Scaffold(
      backgroundColor: HB.ink,
      body: Stack(children: [
        SafeArea(
            child: ListView(padding: const EdgeInsets.all(18), children: [
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            const Text('LIVE / RK FACT',
                style: TextStyle(color: HB.acid, fontWeight: FontWeight.w900)),
            TextButton(
                onPressed: () {
                  c.endLive();
                  Navigator.pop(context);
                },
                child: const Text('结束使用', style: TextStyle(color: HB.white)))
          ]),
          const SizedBox(height: 20),
          Text(track?.title ?? 'NO TRACK',
              style: Theme.of(context)
                  .textTheme
                  .displayLarge
                  ?.copyWith(color: HB.white)),
          const SizedBox(height: 8),
          Text('${track?.artist ?? '—'}  /  ${track?.bpm ?? 0} BPM',
              style: const TextStyle(
                  color: Colors.white60, fontWeight: FontWeight.w900)),
          const SizedBox(height: 30),
          HardCard(
              color: HB.acid,
              child: Row(children: [
                const Icon(Icons.sensors),
                const SizedBox(width: 10),
                Expanded(
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                      const Text('RK3588 ONLINE',
                          style: TextStyle(fontWeight: FontWeight.w900)),
                      Text(
                          c.lastCommand == null
                              ? '等待现场意图'
                              : '${c.lastCommand} · ${_commandLabel(c.commandState)}',
                          style: const TextStyle(fontSize: 11))
                    ]))
              ])),
          const SizedBox(height: 26),
          const Text('BACKUP INTENTS',
              style: TextStyle(color: HB.white, fontWeight: FontWeight.w900)),
          const SizedBox(height: 10),
          GridView.count(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              crossAxisCount: 2,
              crossAxisSpacing: 9,
              mainAxisSpacing: 9,
              childAspectRatio: 1.7,
              children: ['下一首', '炸一点', '稳一下', '延长', 'TALK', '撤销']
                  .map((x) => HardButton(
                      label: x,
                      color: x == 'TALK' ? HB.orange : HB.white,
                      onPressed: busy ? null : () => c.sendLiveCommand(x)))
                  .toList()),
          if (busy)
            const Padding(
                padding: EdgeInsets.only(top: 18),
                child: LinearProgressIndicator(
                    color: HB.acid, backgroundColor: Colors.white24)),
          const SizedBox(height: 20),
          const Text('备用控制只发送意图；界面状态来自 Mock RK 快照，不以按钮点击作为完成事实。',
              style: TextStyle(color: Colors.white54, fontSize: 11)),
        ])),
        if (c.screenLocked)
          Positioned.fill(
              child: Material(
            color: HB.ink,
            child: SafeArea(
                child: Center(
                    child: GestureDetector(
              onLongPress: c.toggleScreenLock,
              child: const HardCard(
                  color: HB.acid,
                  child: Padding(
                    padding: EdgeInsets.symmetric(horizontal: 28, vertical: 22),
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      Icon(Icons.lock, size: 42),
                      SizedBox(height: 12),
                      Text('现场控制已锁定',
                          style: TextStyle(
                              fontSize: 22, fontWeight: FontWeight.w900)),
                      SizedBox(height: 8),
                      Text('长按此处解锁 · 防止误触',
                          style: TextStyle(fontWeight: FontWeight.w700))
                    ]),
                  )),
            ))),
          )),
        Positioned(
            right: 18,
            bottom: 18,
            child: FloatingActionButton(
              backgroundColor: HB.acid,
              onPressed: c.toggleScreenLock,
              child: Icon(c.screenLocked ? Icons.lock_open : Icons.lock),
            ))
      ]),
    );
  }

  static String _commandLabel(LiveCommandState state) => switch (state) {
        LiveCommandState.idle => '空闲',
        LiveCommandState.sent => '已发送',
        LiveCommandState.queued => '已排队',
        LiveCommandState.executing => '执行中',
        LiveCommandState.completed => '已完成',
        LiveCommandState.rejected => '已拒绝',
        LiveCommandState.timeoutUnknown => '正在确认设备状态'
      };
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
                onTap: () => Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => AnimatedBuilder(
                        animation: controller,
                        builder: (_, __) => FullPlayer(controller)))),
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
                        Text('${track.bpm} BPM · PHONE',
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
            child: Padding(
                padding: const EdgeInsets.all(22),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Spacer(),
                      Text('NOW / PHONE',
                          style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 12),
                      Text(track.title,
                          style: Theme.of(context).textTheme.displayLarge),
                      const SizedBox(height: 8),
                      Text('${track.artist} · ${track.bpm} BPM',
                          style: const TextStyle(fontWeight: FontWeight.w900)),
                      const SizedBox(height: 28),
                      Slider(
                          value: c.position.inMilliseconds
                              .toDouble()
                              .clamp(0, max),
                          max: max,
                          activeColor: HB.ink,
                          onChanged: (value) =>
                              c.seek(Duration(milliseconds: value.round()))),
                      Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(_time(c.position)),
                            Text(_time(c.duration))
                          ]),
                      Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            IconButton(
                                tooltip: '顺序播放',
                                onPressed: () =>
                                    c.setPlaybackMode(PlaybackMode.sequential),
                                color: c.playbackMode == PlaybackMode.sequential
                                    ? HB.orange
                                    : HB.ink,
                                icon: const Icon(Icons.format_list_numbered)),
                            IconButton(
                                tooltip: '单曲循环',
                                onPressed: () =>
                                    c.setPlaybackMode(PlaybackMode.repeatOne),
                                color: c.playbackMode == PlaybackMode.repeatOne
                                    ? HB.orange
                                    : HB.ink,
                                icon: const Icon(Icons.repeat_one)),
                            IconButton(
                                tooltip: '随机播放',
                                onPressed: () =>
                                    c.setPlaybackMode(PlaybackMode.shuffle),
                                color: c.playbackMode == PlaybackMode.shuffle
                                    ? HB.orange
                                    : HB.ink,
                                icon: const Icon(Icons.shuffle)),
                          ]),
                      const SizedBox(height: 22),
                      Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            IconButton.filled(
                                onPressed: c.previousTrack,
                                icon: const Icon(Icons.skip_previous),
                                iconSize: 34),
                            const SizedBox(width: 18),
                            IconButton.filled(
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
                                onPressed: c.nextTrack,
                                icon: const Icon(Icons.skip_next),
                                iconSize: 34)
                          ]),
                      const SizedBox(height: 24),
                      Text('QUEUE · ${c.queue.length}',
                          style: const TextStyle(fontWeight: FontWeight.w900)),
                      const SizedBox(height: 8),
                      SizedBox(
                          height: 110,
                          child: ReorderableListView(
                              onReorderItem: c.moveQueueItem,
                              children: c.queue.map((id) {
                                final item = c.tracks
                                    .where((candidate) => candidate.id == id)
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
                                    trailing: IconButton(
                                        icon: const Icon(Icons.close),
                                        onPressed: () => c.removeQueueItem(id)),
                                    onTap: () => c.play(item));
                              }).toList()))
                    ]))));
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
