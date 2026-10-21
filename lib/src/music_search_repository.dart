import 'dart:typed_data';
import 'activity_repository.dart';
import 'models.dart';

Map<String, dynamic> _map(dynamic v) =>
    v is Map ? Map<String, dynamic>.from(v) : {};
String _text(dynamic value, [String fallback = '']) =>
    value is String ? value : fallback;
num? _number(dynamic v) => v is num && v.isFinite ? v : null;
final _trackId =
    RegExp(r'^(track-[a-f0-9]{20}|[a-f0-9]{32}|mt2_[a-z0-9_]{1,64})$');

class MusicHit {
  const MusicHit(
      {required this.id,
      required this.title,
      this.artist = '',
      this.provider = '',
      this.style = '',
      this.bpm,
      this.durationSeconds,
      this.coverUrl,
      this.trackId,
      this.discoveryId,
      this.isLibrary = false,
      this.playable = false,
      this.mixReady = false,
      this.remoteTrack});
  final String id, title, artist, provider, style;
  final num? bpm, durationSeconds;
  final String? coverUrl, trackId, discoveryId;
  final bool isLibrary, playable, mixReady;
  final Track? remoteTrack;
}

class MusicDownloadCandidate {
  const MusicDownloadCandidate(
      {required this.candidateId,
      required this.title,
      this.artist = '',
      this.source = '',
      this.durationSeconds});
  final String candidateId, title, artist, source;
  final num? durationSeconds;
}

class MusicImportJob {
  const MusicImportJob(
      {required this.id,
      required this.title,
      required this.state,
      this.stage = '',
      this.progress,
      this.trackId,
      this.coverUrl,
      this.error,
      this.message = ''});
  final String id, title, state, stage, message;
  final double? progress;
  final String? trackId, coverUrl, error;
  bool get playable =>
      trackId != null && const ['ready', 'ready_playback'].contains(state);
  bool get mixReady => trackId != null && state == 'ready';
  bool get terminal =>
      const ['ready', 'ready_playback', 'failed'].contains(state);
  String get statusLabel => switch (state) {
        'submitting' => '正在提交任务',
        'queued' => '等待下载',
        'downloading' => '正在下载',
        'transferring' => '正在传输到 NAS',
        'analyzing' => '正在分析和分轨',
        'publishing' => '正在发布素材',
        'ready' => '已就绪 · 可播放和混音',
        'ready_playback' => '可播放 · 混音素材未就绪',
        'failed' => '处理失败，可重试',
        _ => '正在处理'
      };
}

class MusicSearchResult {
  const MusicSearchResult(
      {required this.hits,
      required this.scope,
      this.semanticStatus,
      this.semanticMessage,
      this.covered,
      this.total,
      this.title});
  final List<MusicHit> hits;
  final String scope;
  final String? semanticStatus, semanticMessage, title;
  final int? covered, total;
}

class MusicSearchRepository {
  MusicSearchRepository(this.activity);
  final ActivityRepository activity;
  List<String> importStyles = const ['Hip-Hop'];
  String? _cover(dynamic raw) {
    if (raw is! String) return null;
    try {
      final uri = activity.baseUri.resolve(raw);
      if (uri.origin != activity.baseUri.origin ||
          uri.hasQuery ||
          uri.hasFragment ||
          !RegExp(r'^/(?:listen/music-covers|analysis-lab-static/mobile-artwork-v1)/[a-f0-9]{64}\.jpg$')
              .hasMatch(uri.path)) {
        return null;
      }
      return uri.toString();
    } on FormatException {
      return null;
    }
  }

  MusicHit _hit(dynamic raw, String scope) {
    final v = _map(raw), library = scope == 'library';
    final suppliedId = _text(v['trackId'], _text(v['id']));
    final id =
        suppliedId.startsWith('nas:') ? suppliedId.substring(4) : suppliedId;
    final trackId = library && _trackId.hasMatch(id) ? id : null;
    final discovery = !library ? _text(v['discoveryId']) : null;
    return MusicHit(
        id: trackId ?? discovery ?? '',
        title: _text(v['title'], '未命名曲目'),
        artist: _text(v['artist']),
        provider: _text(v['provider']),
        style: _text(
            v['style'],
            v['styleLabels'] is List
                ? (v['styleLabels'] as List).whereType<String>().join(' / ')
                : ''),
        bpm: _number(v['bpm']),
        durationSeconds: _number(v['duration']),
        coverUrl: _cover(v['coverUrl']),
        trackId: trackId,
        discoveryId: discovery,
        isLibrary: library,
        playable: trackId != null && v['playStatus'] == 'ready',
        mixReady: trackId != null && v['mixStatus'] == 'ready');
  }

  MusicSearchResult _result(Map<String, dynamic> data, String scope) {
    final coverage = _map(data['coverage']);
    return MusicSearchResult(
        hits: (data['results'] as List? ?? [])
            .take(100)
            .map((v) => _hit(v, scope))
            .where((v) => v.id.isNotEmpty)
            .toList(),
        scope: scope,
        semanticStatus: data['mode'] as String?,
        semanticMessage: data['message'] as String?,
        covered: _number(coverage['indexed'])?.toInt(),
        total: _number(coverage['total'])?.toInt(),
        title: data['title'] as String?);
  }

  Future<MusicSearchResult> search(String query, String scope) async {
    if (!const ['library', 'discover'].contains(scope)) {
      throw const ActivityException('请选择搜索范围。');
    }
    final path = Uri(
        path: '/music/search',
        queryParameters: {'q': query.trim(), 'scope': scope}).toString();
    return _result(await activity.musicRequest('GET', path), scope);
  }

  Future<MusicSearchResult> playlist(String url) async => _result(
      await activity
          .musicRequest('POST', '/music/playlist', body: {'url': url}),
      'discover');
  Future<List<MusicDownloadCandidate>> matches(MusicHit hit) async {
    if (hit.discoveryId == null || hit.isLibrary) {
      throw const ActivityException('请先选择一首发现的音乐。');
    }
    final data = await activity.musicRequest('POST', '/music/matches',
        body: {'discoveryId': hit.discoveryId});
    return (data['candidates'] as List? ?? [])
        .take(30)
        .map((raw) {
          final v = _map(raw);
          return MusicDownloadCandidate(
              candidateId: _text(v['candidateId']),
              title: _text(v['title'], hit.title),
              artist: _text(v['artist']),
              source: _text(v['source'], _text(v['provider'])),
              durationSeconds: _number(v['duration']));
        })
        .where((c) => c.candidateId.isNotEmpty)
        .toList();
  }

  MusicImportJob _job(dynamic raw) {
    final v = _map(raw), id = _text(v['trackId']);
    return MusicImportJob(
        id: _text(v['id']),
        title: _text(v['title'], '音乐导入'),
        state: _text(v['status'], _text(v['state'], 'queued')),
        stage: _text(v['stage']),
        trackId: _trackId.hasMatch(id) ? id : null,
        coverUrl: _cover(v['coverUrl']),
        message: _text(v['message']),
        error: v['error'] is String
            ? v['error']
            : (v['status'] == 'failed' ? _text(v['message']) : null));
  }

  Future<MusicImportJob> download(
          MusicDownloadCandidate candidate, String style) async =>
      _job(await activity.musicRequest('POST', '/music/download',
          body: {'candidateId': candidate.candidateId, 'style': style}));
  Future<List<MusicImportJob>> jobs() async {
    final data = await activity.musicRequest('GET', '/music/jobs');
    if (data['styles'] is List) {
      importStyles = (data['styles'] as List)
          .whereType<String>()
          .where((s) => s.isNotEmpty && s.length <= 80)
          .take(80)
          .toSet()
          .toList();
    }
    return (data['jobs'] as List? ?? [])
        .take(100)
        .map(_job)
        .where((v) => v.id.isNotEmpty)
        .toList();
  }

  Future<Map<String, String>> covers() async {
    final data = await activity.musicRequest('GET', '/music/covers');
    final output = <String, String>{};
    for (final entry in _map(data['covers']).entries.take(10000)) {
      final image = _map(entry.value), url = _cover(_map(entry.value)['url']);
      if (_trackId.hasMatch(entry.key) &&
          url != null &&
          RegExp(r'^[a-f0-9]{64}$').hasMatch(_text(image['masterSha256']))) {
        output[entry.key] = url;
      }
    }
    return output;
  }

  Future<MusicImportJob> retry(MusicImportJob job) async {
    if (!RegExp(r'^[a-zA-Z0-9_-]{1,128}$').hasMatch(job.id)) {
      throw const ActivityException('任务编号无效。');
    }
    return _job(await activity
        .musicRequest('POST', '/music/jobs/${job.id}/retry', body: {}));
  }

  Future<MusicImportJob> upload(
          {required Uint8List bytes,
          required String filename,
          required String title,
          required String style}) async =>
      _job(await activity.uploadMusic(bytes,
          filename: filename, title: title, style: style));
}
