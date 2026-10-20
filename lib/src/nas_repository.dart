import 'dart:convert';
import 'package:flutter/material.dart' show Color;
import 'package:flutter/services.dart' show rootBundle;
import 'package:http/http.dart' as http;
import 'backend.dart';
import 'models.dart';

/// Read-only NAS catalog. This client never receives account/SSH credentials.
class NasCatalogRepository {
  NasCatalogRepository(
      {http.Client? client,
      Uri? baseUri,
      Future<String> Function()? snapshotLoader})
      : _client = client ?? http.Client(),
        baseUri = baseUri ??
            Uri.parse(const String.fromEnvironment('HARBEAT_NAS_BASE_URL',
                defaultValue: 'https://8.136.120.255')),
        _snapshotLoader = snapshotLoader ??
            (() => rootBundle.loadString('assets/nas/catalog.json'));
  final http.Client _client;
  final Uri baseUri;
  final Future<String> Function() _snapshotLoader;
  final Map<String, Map<String, dynamic>> _index = {};
  final Map<String, Track> _details = {};
  final Map<String, String> _detailReports = {};
  final Map<String, Map<String, dynamic>> _pinned = {};
  final Map<String, Map<String, dynamic>> _artwork = {};
  static const artworkPath = '/analysis-lab-static/mobile-artwork-v1';
  List<String> featuredIds = [];
  String snapshotDate = '';
  static const playlistId = 'nas-hiphop-v3-20260920';
  static const mix = Track(
      id: 'mix:hiphop-v3-20260920',
      title: 'HIP-HOP / SIX · V3',
      artist: 'HarBeat · 6 首连续混音',
      style: 'Hip-Hop',
      bpm: null,
      energy: null,
      reason: '根据 NAS 的段落、拍网格和人声分析生成，已渲染的完整 V3 试听。',
      color: Color(0xFFFF5C35),
      durationMs: 260945,
      previewUrl: 'asset:assets/audio/hiphop-six-v3.mp3',
      detailLoaded: true);
  static final _hash = RegExp(r'^[a-f0-9]{64}$');
  static final _catalogId =
      RegExp(r'^(track-[a-f0-9]{20}|[a-f0-9]{32}|mt2_[a-z0-9_]{1,64})$');
  static Map<String, dynamic> _map(dynamic v) =>
      v is Map ? Map<String, dynamic>.from(v) : {};
  static String? _string(dynamic v) => v is String && v.isNotEmpty ? v : null;
  static num? _number(dynamic v) => v is num && v.isFinite ? v : null;

  Future<List<Track>> bootstrap() async {
    final data = _map(jsonDecode(await _snapshotLoader()));
    _readArtwork(data['artwork']);
    snapshotDate = data['date'] as String;
    featuredIds = (data['featured_ids'] as List).cast<String>();
    final reports = (data['reports'] as List).map(_map).toList();
    for (final raw in (data['featured_reports'] as List)) {
      final r = _map(raw);
      final id = 'nas:${_map(r['audio'])['catalog_track_id']}';
      _pinned[id] = r;
    }
    final tracks = _readIndex(reports);
    for (final item in _pinned.entries) {
      final row = _index[item.key];
      if (row == null) throw const BackendException('精选歌单的目录记录缺失。');
      _details[item.key] = _parseDetail(item.value, row);
      _detailReports[item.key] = row['id'] as String;
    }
    return tracks
        .map((t) => _withArtwork(_details[t.id] ?? t, _index[t.id]!))
        .toList();
  }

  Future<dynamic> _get(String path, {int timeoutSeconds = 35}) async {
    final request = http.Request('GET', baseUri.resolve(path))
      ..followRedirects = false;
    final response = await _client
        .send(request)
        .then(http.Response.fromStream)
        .timeout(Duration(seconds: timeoutSeconds));
    if (response.statusCode != 200) {
      throw BackendException('NAS 曲库暂不可用（${response.statusCode}），请重试。');
    }
    return jsonDecode(utf8.decode(response.bodyBytes));
  }

  /// Public style choices only; no audio or analysis is loaded before playback.
  Future<List<Map<String, dynamic>>> smartDirectory() async {
    final value = _map(await _get('/listen/library.json', timeoutSeconds: 12));
    if (value['schema'] != 'harbeat.continuous-library.v1' ||
        value['tracks'] is! List) {
      throw const BackendException('智能选曲目录暂不可用。');
    }
    return (value['tracks'] as List)
        .map(_map)
        .where((row) =>
            row['id'] is String &&
            _catalogId.hasMatch(row['id'] as String) &&
            row['playStatus'] == 'ready' &&
            row['mixStatus'] == 'ready' &&
            row['styleLabels'] is List &&
            (row['styleLabels'] as List).every((s) => s is String))
        .toList();
  }

  Future<List<Track>> refresh() async {
    final artwork = _refreshArtwork();
    final data = await _get('/api/analysis-lab/reports');
    if (data is! List) throw const BackendException('NAS 目录格式不匹配。');
    await artwork;
    return _readIndex(data.map(_map).toList());
  }

  Future<void> _refreshArtwork() async {
    try {
      _readArtwork(await _get('$artworkPath/catalog.json', timeoutSeconds: 10));
    } catch (_) {
      // A cover outage must not prevent music or discard the previous catalog.
    }
  }

  void _readArtwork(dynamic value) {
    final data = _map(value);
    if (data['schema'] != 'harbeat.mobile-artwork.v1' ||
        data['tracks'] is! List) {
      return;
    }
    final next = <String, Map<String, dynamic>>{};
    for (final raw in (data['tracks'] as List).take(10000)) {
      final item = _map(raw);
      final id = _string(item['catalog_track_id']) ?? '';
      final sha = _string(item['audio_sha256']) ?? '';
      final image = _string(item['cover_sha256']) ?? '';
      if ((id.isEmpty || _catalogId.hasMatch(id)) &&
          _hash.hasMatch(sha) &&
          _hash.hasMatch(image)) {
        next[id.isEmpty ? '*/$sha' : 'nas:$id/$sha'] = item;
      }
    }
    _artwork
      ..clear()
      ..addAll(next);
  }

  Track _withArtwork(Track track, Map<String, dynamic> row) {
    final sha = _map(row['audio'])['sha256'];
    final image = _artwork['${track.id}/$sha'] ?? _artwork['*/$sha'];
    return track.withCoverUrl(
        image == null
            ? null
            : baseUri
                .resolve('$artworkPath/${image['cover_sha256']}.jpg')
                .toString(),
        artworkArtist: _string(image?['artist']));
  }

  List<Track> _readIndex(List<Map<String, dynamic>> rows) {
    rows.sort((a, b) => (b['created_at'] as String? ?? '')
        .compareTo(a['created_at'] as String? ?? ''));
    final next = <String, Map<String, dynamic>>{};
    for (final row in rows) {
      final a = _map(row['audio']);
      final catalog = _string(a['catalog_track_id']);
      if (catalog == null ||
          !_catalogId.hasMatch(catalog) ||
          !_hash.hasMatch(_string(row['id']) ?? '') ||
          !['published_manifest_reference', 'library_record_reference']
              .contains(a['binding'])) {
        continue;
      }
      next.putIfAbsent('nas:$catalog', () => row);
    }
    // Keep the six-song set bound to the report used to render the audition.
    for (final e in _pinned.entries) {
      next[e.key] = e.value;
    }
    _index
      ..clear()
      ..addAll(next);
    final tracks = next.entries.map((e) {
      if (_detailReports[e.key] == e.value['id'] &&
          _details.containsKey(e.key)) {
        return _withArtwork(_details[e.key]!, e.value);
      }
      return _withArtwork(_summary(e.key, e.value), e.value);
    }).toList();
    tracks
        .sort((a, b) => a.title.toLowerCase().compareTo(b.title.toLowerCase()));
    return tracks;
  }

  Track _summary(String id, Map<String, dynamic> r) {
    final s = _map(r['summary']), a = _map(r['audio']);
    return Track(
        id: id,
        title: _string(r['title']) ?? '未命名曲目',
        artist: 'NAS 音乐库',
        style: 'NAS',
        bpm: _number(s['bpm']),
        energy: _number(s['energy']) == null
            ? null
            : (_number(s['energy'])! * 100).round().clamp(0, 100),
        color: const Color(0xFFC9F044),
        reason: '已发布的预处理曲目 · 播放前读取原曲与分析',
        durationMs:
            ((_number(s['duration']) ?? _number(a['duration']) ?? 0) * 1000)
                .round(),
        musicalKey: _string(s['camelot']) ?? _string(s['key']),
        analysisStatus: 'pending');
  }

  Future<Track> detail(Track track, {bool force = false}) async {
    final row = _index[track.id];
    if (row == null) throw const BackendException('这首歌曲不在 NAS 目录中，请刷新曲库。');
    if (!force &&
        _detailReports[track.id] == row['id'] &&
        _details.containsKey(track.id)) {
      return _withArtwork(_details[track.id]!, row);
    }
    final report = _map(await _get('/api/analysis-lab/reports/${row['id']}'));
    final result = _parseDetail(report, row);
    _details[track.id] = result;
    _detailReports[track.id] = row['id'] as String;
    return _withArtwork(result, row);
  }

  Track _parseDetail(Map<String, dynamic> r, Map<String, dynamic> row) {
    final a = _map(r['audio']), expected = _map(row['audio']);
    final docs = _map(r['documents']), core = _map(docs['core']);
    if (a['binding'] == 'library_record_reference') {
      return _parseLegacy(r, row);
    }
    final assets = _map(core['assets']),
        master = _map(_map(a['assets'])['master']);
    final source = _map(core['source']), analysis = _map(core['analysis']);
    final masterSha = _string(_map(assets['master'])['sha256']);
    if (r['id'] != row['id'] ||
        a['catalog_track_id'] != expected['catalog_track_id'] ||
        a['sha256'] != expected['sha256'] ||
        core['track_id'] != a['catalog_track_id'] ||
        a['binding'] != 'published_manifest_reference') {
      throw const BackendException('NAS 分析与歌曲身份不一致，已停止加载。');
    }
    final available = master['status'] == 'available' &&
        _hash.hasMatch(_string(master['id']) ?? '') &&
        _hash.hasMatch(masterSha ?? '') &&
        master['declared_sha256'] == masterSha;
    final quality = _map(core['quality']);
    final genre = _map(_map(r['extensions'])['genre']);
    final top = _map(genre['data'])['top'];
    final genreFirst =
        top is List && top.isNotEmpty ? _map(top.first) : <String, dynamic>{};
    final manual = source['style_labels'] is List
        ? (source['style_labels'] as List).whereType<String>().join(' / ')
        : '';
    final style =
        genre['status'] == 'ready' && genreFirst['parent'] == 'Hip Hop'
            ? 'Hip-Hop'
            : (manual.isNotEmpty ? manual : 'NAS');
    final vocal = _map(docs['vocal_activity']),
        vocalSource = _map(_map(docs['vocal_activity'])['source']);
    final vocalBound = vocal['status'] == 'ready' &&
        vocal['intervals'] is List &&
        vocalSource['track_id'] == core['track_id'] &&
        vocalSource['analysis_run_id'] == core['analysis_run_id'] &&
        _hash.hasMatch(_string(vocalSource['vocal_sha256']) ?? '') &&
        vocalSource['vocal_sha256'] ==
            _map(_map(assets['stems'])['vocals'])['sha256'];
    // Only publish vocal timing after checking both run and stem identities.
    analysis.remove('vocal_activity');
    if (vocalBound) analysis['vocal_activity'] = vocal;
    return Track(
        id: 'nas:${a['catalog_track_id']}',
        title: _string(r['title']) ?? '未命名曲目',
        artist: _string(source['artist']) ?? 'NAS 音乐库',
        style: style,
        bpm: _number(_map(analysis['tempo'])['bpm']),
        energy: _number(_map(analysis['energy'])['overall']) == null
            ? null
            : (_number(_map(analysis['energy'])['overall'])! * 100)
                .round()
                .clamp(0, 100),
        reason:
            'NAS 原曲 · ${genreFirst['label'] ?? '风格未确认'}${manual.isEmpty ? '' : '\n目录标签：$manual'}',
        color: const Color(0xFFC9F044),
        availability: available
            ? TrackAvailability.ready
            : TrackAvailability.metadataOnly,
        durationMs: _number(_map(assets['master'])['duration_ms'])?.round(),
        musicalKey: _string(_map(analysis['key'])['camelot']) ??
            _string(_map(analysis['key'])['name']),
        analysisStatus: _string(core['status']),
        analysisRunId: _string(core['analysis_run_id']),
        needsReview: quality['needs_review'] == true,
        qualityFlags: quality['quality_flags'] is List
            ? (quality['quality_flags'] as List).whereType<String>().toList()
            : [],
        analysis: analysis,
        vocalSummary: vocalBound ? vocal : {},
        previewUrl: available
            ? baseUri
                .resolve('/api/analysis-lab/media/${master['id']}')
                .toString()
            : null,
        detailLoaded: true);
  }

  void close() => _client.close();

  Track _parseLegacy(Map<String, dynamic> r, Map<String, dynamic> row) {
    final a = _map(r['audio']), expected = _map(row['audio']);
    final core = _map(_map(r['documents'])['core']);
    final master = _map(_map(a['assets'])['master']);
    if (r['id'] != row['id'] ||
        a['catalog_track_id'] != expected['catalog_track_id'] ||
        a['sha256'] != expected['sha256'] ||
        core['id'] != a['catalog_track_id'] ||
        (core['original_sha256'] != null &&
            core['original_sha256'] != a['sha256']) ||
        !_hash.hasMatch(_string(a['sha256']) ?? '')) {
      throw const BackendException('NAS 旧版分析与歌曲身份不一致，已停止加载。');
    }
    final ready = a['hash_verification'] == 'verified' &&
        master['status'] == 'available' &&
        _hash.hasMatch(_string(master['id']) ?? '');
    final styles = core['dance_styles'] is List
        ? (core['dance_styles'] as List).whereType<String>().join(' / ')
        : 'NAS';
    final rawBars = core['downbeats'];
    final bars = rawBars is List
        ? rawBars
            .whereType<num>()
            .where((v) => v.isFinite && v >= 0)
            .map((v) => (v * 1000).round())
            .toList()
        : <int>[];
    return Track(
        id: 'nas:${a['catalog_track_id']}',
        title: _string(r['title']) ?? '未命名曲目',
        artist: _string(core['artist']) ?? 'NAS 音乐库',
        style: styles.isEmpty ? 'NAS' : styles,
        bpm: _number(core['bpm']),
        energy: _number(core['energy']) == null
            ? null
            : (_number(core['energy'])! * 100).round().clamp(0, 100),
        reason: 'NAS 原曲 · 旧版预处理记录。缺少可核验的分析时间轴时，手机使用原速淡化。',
        color: const Color(0xFF8BA9FF),
        availability:
            ready ? TrackAvailability.ready : TrackAvailability.metadataOnly,
        durationMs: ((_number(a['duration']) ?? 0) * 1000).round(),
        musicalKey: _string(core['camelot_key']) ?? _string(core['key']),
        analysisStatus: _string(core['analysis_status']),
        needsReview: core['beat_needs_review'] != false ||
            core['original_sha256'] == null,
        analysis: core['original_sha256'] == null
            ? {}
            : {
                'beat_grid': {'bars_ms': bars}
              },
        previewUrl: ready
            ? baseUri
                .resolve('/api/analysis-lab/media/${master['id']}')
                .toString()
            : null,
        detailLoaded: true);
  }
}
