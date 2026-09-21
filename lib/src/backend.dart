import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart' show Color;
import 'package:http/http.dart' as http;

import 'models.dart';
import 'repository.dart';

enum BackendApi { legacy, v2 }

enum _AuthAction { login, register, refresh }

class BackendException implements Exception {
  const BackendException(this.message, {this.statusCode});
  final String message;
  final int? statusCode;
  @override
  String toString() => message;
}

class BackendConfig {
  static const defaultAddress = String.fromEnvironment('HARBEAT_API_BASE_URL',
      defaultValue: 'https://8.136.120.255');
  BackendConfig(String address,
      {this.api = BackendApi.legacy,
      String token = '',
      this.refreshToken = '',
      this.username,
      this.userId})
      : baseUri = _validate(address),
        token = token.trim();
  final Uri baseUri;
  final BackendApi api;
  // Credentials are serialized only by SessionStore, never SharedPreferences.
  final String token;
  final String refreshToken;
  final String? username;
  final int? userId;
  BackendConfig withSession(
          {required String token,
          String refreshToken = '',
          String? username,
          int? userId}) =>
      BackendConfig(baseUri.toString(),
          api: api,
          token: token,
          refreshToken: refreshToken,
          username: username,
          userId: userId);
  String get scope => '${api.name}:${Uri.encodeComponent(baseUri.toString())}';
  Map<String, dynamic> toJson() => {'url': baseUri.toString(), 'api': api.name};
  Uri endpoint(String path, [Map<String, String>? query]) =>
      Uri.parse('$baseUri$path').replace(queryParameters: query);
  static Uri _validate(String address) {
    final uri = Uri.tryParse(address.trim().replaceFirst(RegExp(r'/+$'), ''));
    if (uri == null ||
        !['http', 'https'].contains(uri.scheme) ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment) {
      throw const BackendException('请输入完整服务地址，不要包含账号、查询参数或片段。');
    }
    if (uri.scheme == 'http' &&
        !['localhost', '127.0.0.1', '::1'].contains(uri.host)) {
      throw const BackendException('远程服务请使用 HTTPS；本机联调可使用 http://127.0.0.1。');
    }
    final path = uri.path.replaceFirst(RegExp(r'/api(?:/v2)?$'), '');
    return uri.replace(path: path);
  }
}

class CatalogPage {
  const CatalogPage(this.items, {this.nextCursor});
  final List<Track> items;
  final String? nextCursor;
}

class RemoteAudio {
  const RemoteAudio(this.uri, this.headers);
  final Uri uri;
  final Map<String, String> headers;
}

/// Adapts the implemented legacy API and the documented v2 contract separately.
/// No automatic endpoint guessing or silent fallback to demonstration tracks.
class RemoteHarBeatRepository implements HarBeatRepository {
  RemoteHarBeatRepository(this.config, {http.Client? client})
      : _client = client ?? http.Client();
  BackendConfig config;
  final http.Client _client;
  Future<void> Function(BackendConfig)? onSessionChanged;
  Future<void>? _refreshing;
  Map<String, String> get _headers => {
        'Accept': 'application/json',
        if (config.token.isNotEmpty) 'Authorization': 'Bearer ${config.token}',
      };

  Future<Map<String, dynamic>> _get(String path,
          [Map<String, String>? query]) =>
      _request('GET', path, query: query);

  Future<BackendConfig> login(String username, String password) =>
      _authenticate(username, password, _AuthAction.login);

  Future<BackendConfig> register(String username, String password) =>
      _authenticate(username, password, _AuthAction.register);

  Future<BackendConfig> _authenticate(
      String username, String password, _AuthAction action) async {
    if (config.api != BackendApi.legacy) {
      throw const BackendException('第二版服务请使用它提供的访问凭据。');
    }
    if (username.trim().isEmpty || password.isEmpty) {
      throw const BackendException('请输入账号和密码。');
    }
    final data =
        await _request('POST', '/api/auth/${action.name}', auth: action, body: {
      'username': username.trim(),
      'password': password,
      if (action == _AuthAction.register) ...{
        'dance_style': 'hiphop',
        'level': 'beginner',
        'favorite_style': 'hiphop',
      },
    });
    final token = data['access_token'];
    final type = data['token_type'];
    if (token is! String ||
        token.trim().isEmpty ||
        (type != null && (type is! String || type.toLowerCase() != 'bearer'))) {
      throw BackendException(action == _AuthAction.register
          ? '注册服务未返回有效的访问凭据，账号可能已创建，请尝试登录。'
          : '登录服务未返回有效的访问凭据。');
    }
    return config.withSession(
        token: token,
        refreshToken:
            data['refresh_token'] is String ? data['refresh_token'] : '',
        username:
            data['username'] is String ? data['username'] : username.trim(),
        userId: data['user_id'] is int ? data['user_id'] : null);
  }

  Future<void> ensureFreshSession() async {
    if (config.refreshToken.isEmpty) return;
    try {
      final payload = jsonDecode(utf8.decode(
          base64Url.decode(base64Url.normalize(config.token.split('.')[1]))));
      final exp = payload['exp'];
      if (exp is num &&
          exp * 1000 > DateTime.now().millisecondsSinceEpoch + 60000) {
        return;
      }
    } catch (_) {
      // Opaque tokens are validated by the service; don't interpret them as JWTs.
      return;
    }
    await refreshSession();
  }

  Future<void> refreshSession() =>
      _refreshing ??= _refreshSession().whenComplete(() => _refreshing = null);

  Future<void> _refreshSession() async {
    if (config.api != BackendApi.legacy || config.refreshToken.isEmpty) {
      throw const BackendException('请重新登录。', statusCode: 401);
    }
    try {
      final data = await _request('POST', '/api/auth/refresh',
          auth: _AuthAction.refresh,
          body: {'refresh_token': config.refreshToken});
      final token = data['access_token'];
      if (token is! String ||
          token.isEmpty ||
          (data['token_type'] != null && data['token_type'] != 'bearer')) {
        throw const BackendException('登录续期返回的数据无效，请重新登录。');
      }
      config = config.withSession(
          token: token,
          refreshToken: data['refresh_token'] is String
              ? data['refresh_token']
              : config.refreshToken,
          username:
              data['username'] is String ? data['username'] : config.username,
          userId: data['user_id'] is int ? data['user_id'] : config.userId);
      await onSessionChanged?.call(config);
    } on BackendException catch (e) {
      if (e.statusCode == 401 || e.statusCode == 403) {
        config = config.withSession(token: '');
        await onSessionChanged?.call(config);
      }
      rethrow;
    }
  }

  Future<Map<String, dynamic>> profile() => _get('/api/auth/me');

  Future<Map<String, dynamic>> _request(String method, String path,
      {Map<String, String>? query,
      Map<String, dynamic>? body,
      _AuthAction? auth,
      bool retryAuth = true}) async {
    try {
      if (auth == null) await ensureFreshSession();
      final sentToken = config.token;
      final request = http.Request(method, config.endpoint(path, query))
        // Never replay passwords or bearer credentials to a redirect target.
        ..followRedirects = false
        ..headers
            .addAll(auth != null ? {'Accept': 'application/json'} : _headers);
      if (body != null) {
        request.headers['Content-Type'] = 'application/json; charset=utf-8';
        request.body = jsonEncode(body);
      }
      final response = await _client
          .send(request)
          .then(http.Response.fromStream)
          .timeout(const Duration(seconds: 15));
      if (response.statusCode == 401) {
        if (auth == null && retryAuth && config.refreshToken.isNotEmpty) {
          if (sentToken == config.token) await refreshSession();
          return _request(method, path,
              query: query, body: body, retryAuth: false);
        }
        throw BackendException(
            auth == _AuthAction.login
                ? '账号或密码不正确，请重新输入。'
                : '登录凭据缺失或已过期，请在音乐服务中重新登录。',
            statusCode: 401);
      }
      if (response.statusCode == 403) {
        throw const BackendException('当前账号没有访问这项资源的权限。', statusCode: 403);
      }
      if (response.statusCode == 404) {
        throw BackendException(auth != null
            ? '该服务没有提供旧版${auth == _AuthAction.register ? '注册' : '登录'}接口，请检查连接设置。'
            : '接口或歌曲不存在，请检查服务地址与接口版本。');
      }
      if (auth == _AuthAction.register && response.statusCode == 409) {
        throw const BackendException('这个账号已被注册，请更换账号或返回登录。');
      }
      if (auth == _AuthAction.register && response.statusCode == 422) {
        throw const BackendException('注册信息不符合服务要求，请检查账号和密码。');
      }
      if (response.statusCode >= 300 && response.statusCode < 400) {
        throw const BackendException('服务地址发生跳转，请在连接设置中填写最终的 HTTPS 地址。');
      }
      if (response.statusCode == 429) {
        throw const BackendException('请求过于频繁，请稍后重试。');
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw BackendException(auth == _AuthAction.register
            ? '注册结果未确认（HTTP ${response.statusCode}），请先尝试登录。'
            : '服务暂不可用（HTTP ${response.statusCode}），请重试。');
      }
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      if (decoded is! Map<String, dynamic> ||
          decoded['error'] != null ||
          (decoded['code'] != null && decoded['code'] != 0) ||
          decoded['data'] is! Map<String, dynamic>) {
        throw BackendException(auth == _AuthAction.register
            ? '注册结果未确认，账号可能已创建，请先尝试登录。'
            : '服务返回的数据格式不匹配，请检查接口版本。');
      }
      return decoded['data'] as Map<String, dynamic>;
    } on BackendException {
      rethrow;
    } on TimeoutException {
      throw BackendException(auth == _AuthAction.register
          ? '注册结果未确认：连接超时。请检查网络并先尝试登录。'
          : '连接超时，请检查网络后重试。');
    } on FormatException {
      throw BackendException(auth == _AuthAction.register
          ? '注册结果未确认，账号可能已创建，请先尝试登录。'
          : '服务未返回有效数据，请检查连接设置。');
    } catch (_) {
      throw BackendException(auth == _AuthAction.register
          ? '注册结果未确认，请检查网络与服务地址，并先尝试登录。'
          : '无法连接音乐服务，请检查地址、网络和浏览器跨域配置。');
    }
  }

  Future<Track> uploadAudio(
      {required String filename,
      required int length,
      required Stream<List<int>> bytes,
      required String title,
      required String artist,
      void Function(int, int)? onProgress}) async {
    if (config.api != BackendApi.legacy) {
      throw const BackendException('当前服务版本尚未提供已接入的上传接口。');
    }
    if (config.token.isEmpty) {
      throw const BackendException('请先登录再上传。', statusCode: 401);
    }
    if (length <= 44 || length > 200 * 1024 * 1024) {
      throw const BackendException('请选择有效音频，文件不能超过 200 MB。');
    }
    if (!['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg']
        .contains(filename.split('.').last.toLowerCase())) {
      throw const BackendException('请选择 MP3、WAV、M4A、AAC、FLAC 或 OGG 音频。');
    }
    try {
      await ensureFreshSession();
      // Check/refresh credentials before sending file bytes. Never replay uploads.
      await profile();
      var sent = 0;
      final request =
          http.MultipartRequest('POST', config.endpoint('/api/library/upload'))
            ..followRedirects = false
            ..headers.addAll(_headers)
            ..fields.addAll({'title': title.trim(), 'artist': artist.trim()})
            ..files.add(http.MultipartFile('file', bytes.map((chunk) {
              sent += chunk.length;
              onProgress?.call(sent, length);
              return chunk;
            }), length, filename: filename));
      final response = await _client
          .send(request)
          .then(http.Response.fromStream)
          .timeout(const Duration(minutes: 3));
      if (response.statusCode == 401) {
        throw const BackendException('登录已过期，请重新登录后检查曲库。', statusCode: 401);
      }
      if (response.statusCode == 413) {
        throw const BackendException('服务拒绝了文件大小，请选择更小的音频。');
      }
      if (response.statusCode >= 300 && response.statusCode < 400) {
        throw const BackendException('上传地址发生跳转，请检查服务地址；文件未自动重发。');
      }
      if (response.statusCode >= 500) {
        throw const BackendException('服务端保存音频失败，请刷新曲库确认结果。文件未自动重传。');
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw BackendException(
            '上传未完成（HTTP ${response.statusCode}），请检查文件格式和服务设置。');
      }
      final envelope = jsonDecode(utf8.decode(response.bodyBytes));
      if (envelope is! Map ||
          envelope['code'] != 0 ||
          envelope['data'] is! Map<String, dynamic>) {
        throw const BackendException('上传结果未确认，请先刷新曲库，避免重复上传。');
      }
      return _track(envelope['data'] as Map<String, dynamic>, detail: true);
    } on BackendException {
      rethrow;
    } on TimeoutException {
      throw const BackendException('上传超时，结果未确认。请先刷新曲库，避免重复上传。');
    } catch (_) {
      throw const BackendException('上传连接中断，结果未确认。请检查网络并刷新曲库。');
    }
  }

  Future<CatalogPage> catalog({String query = '', String? cursor}) async {
    final legacy = config.api == BackendApi.legacy;
    final data = await _get(
        legacy
            ? '/api/library/songs${query.isEmpty ? '' : '/search'}'
            : '/api/v2/tracks',
        {
          if (query.isNotEmpty) 'q': query,
          if (!legacy) 'limit': '30',
          if (!legacy && cursor != null) 'cursor': cursor,
        });
    final raw = data[legacy ? 'songs' : 'items'];
    if (raw is! List || raw.any((v) => v is! Map<String, dynamic>)) {
      throw const BackendException('歌曲列表格式不匹配。');
    }
    final next = data['next_cursor'];
    if (next != null && next is! String) {
      throw const BackendException('分页信息格式不匹配。');
    }
    return CatalogPage(
        raw.map((v) => _track(v as Map<String, dynamic>)).toList(),
        nextCursor: next == '' ? null : next as String?);
  }

  Future<Track> detail(Track track) async {
    if (!track.id.startsWith('remote:${config.scope}:')) {
      throw const BackendException('这首歌属于另一项音乐服务，请重新选择。');
    }
    final id = Uri.encodeComponent(track.backendId!);
    final data = await _get(config.api == BackendApi.legacy
        ? '/api/library/songs/$id'
        : '/api/v2/tracks/$id');
    final result = _track(data, detail: true);
    if (result.id != track.id) throw const BackendException('歌曲详情与所选歌曲不一致。');
    return result;
  }

  RemoteAudio audio(Track track, {bool web = kIsWeb}) {
    final id = Uri.encodeComponent(track.backendId!);
    final direct = track.previewUrl;
    if (direct != null && direct.isNotEmpty) {
      final uri = config.baseUri.resolve(direct);
      if (!['http', 'https'].contains(uri.scheme) ||
          uri.userInfo.isNotEmpty ||
          (uri.scheme == 'http' &&
              !['localhost', '127.0.0.1', '::1'].contains(uri.host))) {
        throw const BackendException('服务返回了不支持的音频地址。');
      }
      // Absolute preview URLs are expected to be self-authorizing, short-lived URLs.
      // Never forward a user's bearer token to a CDN or third-party URL.
      return RemoteAudio(uri, const {});
    }
    var uri = config.endpoint(config.api == BackendApi.legacy
        ? '/api/stream/$id'
        : '/api/v2/tracks/$id/preview');
    if (web && config.token.isNotEmpty) {
      if (config.api == BackendApi.v2) {
        throw const BackendException('浏览器播放需要后端返回短时 preview_url；当前可使用手机端鉴权播放。');
      }
      // The legacy stream explicitly accepts ?token=. Only retained in memory.
      uri = uri.replace(queryParameters: {'token': config.token});
      return RemoteAudio(uri, const {});
    }
    return RemoteAudio(uri, {
      if (config.token.isNotEmpty) 'Authorization': 'Bearer ${config.token}',
    });
  }

  Track _track(Map<String, dynamic> data, {bool detail = false}) {
    final legacy = config.api == BackendApi.legacy;
    final rawId = data[legacy ? 'id' : 'track_id'];
    if (rawId is! String || rawId.isEmpty) {
      throw const BackendException('歌曲缺少稳定 ID。');
    }
    Map<String, dynamic> object(dynamic v) =>
        v is Map<String, dynamic> ? v : {};
    num? number(dynamic v) => v is num && v.isFinite ? v : null;
    String? string(dynamic v) =>
        v is String && v.trim().isNotEmpty ? v.trim() : null;
    List<String> strings(dynamic v) =>
        v is List ? v.whereType<String>().toList() : [];
    final analysis = object(data['analysis']);
    final tempo = object(analysis['tempo']);
    final key = object(analysis['key']);
    final quality = object(data['quality']);
    final energy = number(legacy
        ? data['energy']
        : object(analysis['energy'])['overall'] ?? data['energy']);
    final labels = legacy
        ? (data['dance_styles'] is List
            ? (data['dance_styles'] as List)
                .map((v) =>
                    v is String ? v : object(v)['style'] ?? object(v)['name'])
                .whereType<String>()
                .toList()
            : <String>[])
        : strings(data['style_labels']);
    final style =
        labels.isEmpty ? string(data['style']) ?? '未分类' : labels.join(' / ');
    final resource = string(data['resource_status']);
    final available =
        legacy ? (number(data['file_size']) ?? 0) > 0 : resource == 'complete';
    final flags = strings(data['quality_flags'] ?? quality['quality_flags']);
    return Track(
      id: 'remote:${config.scope}:${Uri.encodeComponent(rawId)}',
      backendId: rawId,
      title: string(data['title']) ?? '未命名歌曲',
      artist: string(data['artist']) ?? '未知艺人',
      style: style,
      bpm: number(data['bpm']) ?? number(tempo['bpm']),
      energy: energy == null
          ? null
          : ((legacy && energy > 1 ? energy : energy * 100).clamp(0, 100))
              .round(),
      musicalKey:
          string(data[legacy ? 'key' : 'key_name']) ?? string(key['name']),
      durationMs: legacy
          ? (number(data['duration']) == null
              ? null
              : (number(data['duration'])! * 1000).round())
          : number(data['duration_ms'])?.round(),
      analysisStatus: string(data['analysis_status']),
      analysisRunId: string(data['analysis_run_id']) ??
          string(object(data['pinned_analysis'])['analysis_run_id']),
      manifestSha256:
          string(object(data['pinned_analysis'])['manifest_sha256']),
      vocalSummary: Map.unmodifiable(object(data['vocal_summary'])),
      needsReview: data['needs_review'] == true ||
          quality['needs_review'] == true ||
          data['beat_needs_review'] == true,
      qualityFlags: flags,
      analysis: Map.unmodifiable(legacy ? _legacyAnalysis(data) : analysis),
      previewUrl: string(data['preview_url']),
      detailLoaded: detail,
      availability: data['can_play'] == false || resource == 'missing'
          ? TrackAvailability.unavailable
          : available
              ? TrackAvailability.ready
              : TrackAvailability.metadataOnly,
      reason:
          flags.isEmpty ? '来自音乐服务 · 收藏与歌单暂保存在本机' : '分析提示：${flags.join('、')}',
      color: const Color(0xFF3155FF),
    );
  }

  Map<String, dynamic> _legacyAnalysis(Map<String, dynamic> data) {
    final vocals = <Map<String, int>>[];
    for (final event in (data['vocal_events'] is List
        ? data['vocal_events'] as List
        : const [])) {
      if (event is! Map || event['start'] is! num || event['end'] is! num) {
        continue;
      }
      final start = (event['start'] as num).toDouble();
      final end = (event['end'] as num).toDouble();
      if (start.isFinite && end.isFinite && start >= 0 && end > start) {
        vocals.add({
          'start_ms': (start * 1000).round(),
          'end_ms': (end * 1000).round()
        });
      }
    }
    List<int> times(String field) =>
        (data[field] is List ? data[field] as List : [])
            .whereType<num>()
            .where((v) => v.isFinite && v >= 0)
            .map((v) => (v * 1000).round())
            .toList();
    return {
      if (vocals.isNotEmpty)
        'vocal_activity': {
          'status': 'ready',
          'source': 'legacy_vocal_events',
          'intervals': vocals,
        },
      'beat_grid': {
        'unit': 'ms',
        'beats_ms': times('beat_points'),
        'downbeats_ms': times('downbeats'),
        'needs_review': data['beat_needs_review'] == true
      },
      // Keep legacy curves/windows with their units intact; do not pass them off as v2.
      'legacy': {
        for (final key in [
          'energy_curve',
          'transition_windows',
          'vocal_events',
          'stems',
          'analysis_stages'
        ])
          if (data[key] != null) key: data[key]
      },
    };
  }

  @override
  Future<List<Track>> recommendations() async => (await catalog()).items;
  @override
  Future<void> saveTrack(
      String id) async {} // Personal collections remain explicitly local.
  @override
  Future<DeviceConnection> deviceSnapshot() async =>
      DeviceConnection.disconnected;
  @override
  Future<void> savePreset(List<PadSlot> slots, int version) async =>
      throw const BackendException('当前服务尚未接入 Pad 同步。');
  @override
  Future<int> syncPreset(List<PadSlot> slots, int version) async =>
      throw const BackendException('当前服务尚未接入 Pad 同步。');
  void close() => _client.close();
}
