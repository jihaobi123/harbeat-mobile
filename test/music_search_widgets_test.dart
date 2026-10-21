import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/app.dart';
import 'package:harbeat/src/activity_repository.dart';
import 'package:harbeat/src/music_search_repository.dart';
import 'package:harbeat/src/audio_service.dart';
import 'package:harbeat/src/controller.dart';
import 'package:harbeat/src/local_store.dart';
import 'package:harbeat/src/models.dart';
import 'package:harbeat/src/repository.dart';
import 'package:harbeat/src/theme.dart';

class ProbeMusicRepository extends MusicSearchRepository {
  ProbeMusicRepository()
      : super(ActivityRepository(credentials: MemoryActivityCredentials()));
  int matchCount = 0, downloadCount = 0, jobsCount = 0;
  @override
  Future<Map<String, String>> covers() async => {};
  String? downloadedId;
  @override
  Future<List<MusicDownloadCandidate>> matches(MusicHit hit) async {
    matchCount++;
    return const [
      MusicDownloadCandidate(
          candidateId: 'candidate-private',
          title: '实际下载版本 Extended',
          artist: 'Test Artist',
          source: '公开音源',
          durationSeconds: 187)
    ];
  }

  @override
  Future<MusicImportJob> download(
      MusicDownloadCandidate candidate, String style) async {
    downloadCount++;
    downloadedId = candidate.candidateId;
    return const MusicImportJob(
        id: 'own-job', title: '实际下载版本 Extended', state: 'queued');
  }

  @override
  Future<List<MusicImportJob>> jobs() async {
    jobsCount++;
    return [];
  }

  @override
  Future<MusicSearchResult> search(String query, String scope) async =>
      MusicSearchResult(hits: const [], scope: scope);
}

AppController probeController([ProbeMusicRepository? repo]) =>
    AppController(MockHarBeatRepository(),
        localStore: MemoryLocalStore(),
        audio: MemoryAudioService(),
        musicSearchRepository: repo ?? ProbeMusicRepository());

Widget panel(AppController c, {double scale = 1}) => MaterialApp(
    theme: HB.theme,
    builder: (_, child) => MediaQuery(
        data: MediaQueryData(textScaler: TextScaler.linear(scale)),
        child: child!),
    home: Scaffold(body: SingleChildScrollView(child: SearchImportPanel(c))));

void main() {
  testWidgets('search distinguishes the real library from external discovery',
      (tester) async {
    final c = AppController(MockHarBeatRepository(),
        localStore: MemoryLocalStore(), audio: MemoryAudioService());
    c.tracks = const [
      Track(
          id: 'electric',
          title: 'ELECTRIC MOTION',
          artist: 'Nova',
          style: 'POPPING',
          bpm: 104,
          energy: 80,
          reason: '',
          color: Colors.teal)
    ];
    await tester.pumpWidget(MaterialApp(
        theme: HB.theme,
        home: Scaffold(
            body: SingleChildScrollView(child: SearchImportPanel(c)))));
    expect(find.text('曲库内'), findsOneWidget);
    expect(find.text('发现新音乐'), findsOneWidget);
    expect(find.text('ELECTRIC MOTION'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });

  testWidgets('link import has a real lookup action rather than demo parsing',
      (tester) async {
    final c = AppController(MockHarBeatRepository(),
        localStore: MemoryLocalStore(), audio: MemoryAudioService());
    await tester.pumpWidget(MaterialApp(
        theme: HB.theme,
        home: Scaffold(
            body: SingleChildScrollView(child: SearchImportPanel(c)))));
    await tester.tap(find.text('链接'));
    await tester.pump();
    expect(find.text('查找链接中的音乐'), findsOneWidget);
    expect(find.text('演示解析结果'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
  testWidgets(
      'external metadata cannot play and candidate needs explicit version confirmation',
      (tester) async {
    final repo = ProbeMusicRepository(), c = probeController(repo);
    c.musicSearchScope = 'discover';
    c.musicSearchResult = const MusicSearchResult(scope: 'discover', hits: [
      MusicHit(
          id: 'opaque-song',
          discoveryId: 'opaque-song',
          title: '发现歌曲',
          artist: '歌手',
          durationSeconds: 180)
    ]);
    await tester.pumpWidget(panel(c));
    expect(find.text('手机播放'), findsNothing);
    await tester.ensureVisible(find.text('匹配下载音源'));
    await tester.tap(find.text('匹配下载音源'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(repo.matchCount, 1);
    expect(repo.downloadCount, 0);
    expect(find.text('实际下载版本 Extended'), findsOneWidget);
    final confirm = find.widgetWithText(FilledButton, '下载并分析');
    expect(tester.widget<FilledButton>(confirm).onPressed, isNull);
    await tester.tap(find.text('实际下载版本 Extended'));
    await tester.pump();
    expect(repo.downloadCount, 0);
    expect(tester.widget<FilledButton>(confirm).onPressed, isNotNull);
    await tester.tap(confirm);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(repo.downloadCount, 1);
    expect(repo.downloadedId, 'candidate-private');
    expect(find.text('等待下载'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });

  testWidgets(
      'ready playback job can open its actual song without requiring mix readiness',
      (tester) async {
    final c = probeController();
    c.musicImportJobs = const [
      MusicImportJob(
          id: 'ready-one',
          title: '已发布音频',
          state: 'ready_playback',
          trackId: 'track-aaaaaaaaaaaaaaaaaaaa')
    ];
    await tester.pumpWidget(panel(c));
    expect(find.text('播放已下载音乐'), findsOneWidget);
    expect(find.text('查看歌曲'), findsOneWidget);
    expect(find.text('音频可播放，混音素材尚未就绪。'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });

  testWidgets(
      'search input survives async controller updates and mode switches',
      (tester) async {
    final c = probeController();
    await tester.pumpWidget(panel(c));
    final field = find.widgetWithText(TextField, '歌曲、艺人、舞种或 BPM');
    await tester.enterText(field, '深夜 鼓点重 95 BPM');
    final edit = tester.widget<TextField>(field).controller!;
    edit.selection = const TextSelection.collapsed(offset: 3);
    c.musicSearchError = '语义服务暂不可用，已使用关键词搜索。';
    c.notifyListeners();
    await tester.pump();
    expect(edit.text, '深夜 鼓点重 95 BPM');
    expect(edit.selection.baseOffset, 3);
    await tester.tap(find.text('本地音频'));
    await tester.pump();
    await tester.tap(find.text('搜索').first);
    await tester.pump();
    expect(tester.widget<TextField>(field).controller, same(edit));
    expect(edit.text, '深夜 鼓点重 95 BPM');
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });

  testWidgets('my tasks are polled only while music search is visible',
      (tester) async {
    final repo = ProbeMusicRepository(), c = probeController(repo);
    c.tab = 1;
    c.musicSection = 1;
    await tester.pumpWidget(panel(c));
    await tester.pump();
    expect(repo.jobsCount, 1);
    await tester.pump(const Duration(seconds: 5));
    await tester.pump();
    expect(repo.jobsCount, 2);
    c.setTab(0);
    await tester.pump();
    await tester.pump(const Duration(seconds: 10));
    expect(repo.jobsCount, 2);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });

  testWidgets('semantic fallback and own task cards fit 360px with large text',
      (tester) async {
    tester.view.physicalSize = const Size(360, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final c = probeController();
    c.musicSearchResult = const MusicSearchResult(
        scope: 'library',
        semanticStatus: 'text',
        semanticMessage: '语义服务暂不可用，已使用关键词搜索。',
        covered: 120,
        total: 160,
        hits: [
          MusicHit(
              id: 'real',
              title: '非常长的实际曲库音乐标题与版本信息',
              artist: '很长的实际艺人名称和合作艺人',
              isLibrary: true,
              playable: true,
              mixReady: false,
              durationSeconds: 200)
        ]);
    c.musicImportJobs = const [
      MusicImportJob(
          id: 'failed-own',
          title: '这是已经进入后台队列但暂时下载失败的真实任务',
          state: 'failed',
          error: '源站暂不可用，请稍后重试。')
    ];
    await tester.pumpWidget(panel(c, scale: 1.5));
    expect(find.text('关键词搜索'), findsOneWidget);
    expect(find.text('语义分析覆盖 120 / 160 首'), findsOneWidget);
    expect(tester.takeException(), isNull);
    for (var i = 0; i < 5; i++) {
      await tester.drag(
          find.byType(SingleChildScrollView).first, const Offset(0, -300));
      await tester.pump();
      expect(tester.takeException(), isNull);
    }
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
  testWidgets(
      'download version dialog remains usable at 360px and text scale 1.5',
      (tester) async {
    tester.view.physicalSize = const Size(360, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final c = probeController();
    c.musicSearchScope = 'discover';
    c.musicSearchResult = const MusicSearchResult(scope: 'discover', hits: [
      MusicHit(
          id: 'opaque',
          discoveryId: 'opaque',
          title: '这是一首带有很长版本名称的外部音乐',
          artist: '很长的合作艺人名称',
          provider: '网易云',
          durationSeconds: 185)
    ]);
    await tester.pumpWidget(panel(c, scale: 1.5));
    expect(find.textContaining('网易云'), findsOneWidget);
    await tester.ensureVisible(find.text('匹配下载音源'));
    await tester.tap(find.text('匹配下载音源'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('确认下载版本'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('取消'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
  testWidgets('actual library search result can still be saved to my library',
      (tester) async {
    final c = probeController();
    c.tracks = const [
      Track(
          id: 'nas:track-aaaaaaaaaaaaaaaaaaaa',
          title: '真实 NAS 歌曲',
          artist: '音乐人',
          style: 'Hip-Hop',
          bpm: 95,
          energy: 60,
          reason: '',
          color: Colors.teal)
    ];
    c.musicSearchResult = const MusicSearchResult(scope: 'library', hits: [
      MusicHit(
          id: 'track-aaaaaaaaaaaaaaaaaaaa',
          trackId: 'track-aaaaaaaaaaaaaaaaaaaa',
          title: '真实 NAS 歌曲',
          artist: '音乐人',
          isLibrary: true,
          playable: true,
          mixReady: true)
    ]);
    await tester.pumpWidget(panel(c));
    await tester.ensureVisible(find.text('加入曲库'));
    await tester.tap(find.text('加入曲库'));
    await tester.pump();
    expect(c.library, contains('nas:track-aaaaaaaaaaaaaaaaaaaa'));
    expect(find.text('已保存'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
  testWidgets(
      'owned analysis job title and status precede a long discovery result list',
      (tester) async {
    final c = probeController();
    c.musicSearchScope = 'discover';
    c.musicSearchResult = MusicSearchResult(
        scope: 'discover',
        hits: List.generate(
            24,
            (i) => MusicHit(
                id: 'discovery-$i',
                discoveryId: 'discovery-$i',
                title: '搜索命中 ${i + 1}',
                artist: '实际歌曲艺人')));
    c.musicImportJobs = const [
      MusicImportJob(
          id: 'a123456789abcdef0123456789abcdef',
          title: '已提交的下载分析任务',
          state: 'analyzing')
    ];
    await tester.pumpWidget(panel(c));
    final firstHitY = tester.getTopLeft(find.text('搜索命中 1')).dy;
    expect(tester.getTopLeft(find.text('我的下载与分析')).dy, lessThan(firstHitY));
    expect(tester.getTopLeft(find.text('已提交的下载分析任务')).dy, lessThan(firstHitY));
    expect(tester.getTopLeft(find.text('正在分析和分轨')).dy, lessThan(firstHitY));
    expect(find.text('我的下载与分析'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
}
