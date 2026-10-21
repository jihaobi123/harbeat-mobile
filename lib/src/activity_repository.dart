import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'backend.dart';

class ActivityException implements Exception {
  const ActivityException(this.message);
  final String message;
  @override
  String toString() => message;
}

abstract class ActivityCredentials {
  Future<String?> read();
  Future<void> write(String token);
}

class SecureActivityCredentials implements ActivityCredentials {
  const SecureActivityCredentials();
  static const _storage = FlutterSecureStorage();
  static const _key = 'harbeat_activity_workspace_v1';
  @override
  Future<String?> read() => _storage.read(key: _key);
  @override
  Future<void> write(String token) => _storage.write(key: _key, value: token);
}

class MemoryActivityCredentials implements ActivityCredentials {
  String? value;
  @override
  Future<String?> read() async => value;
  @override
  Future<void> write(String token) async {
    value = token;
  }
}

class ActivityReservation {
  ActivityReservation(this.json);
  final Map<String, dynamic> json;
  String get id => json['id'] as String;
  String get packId => json['packId'] as String;
  String get name => json['name'] as String;
  List<String> get styles => (json['styles'] as List).cast<String>();
  DateTime get startsAt => DateTime.parse(json['startsAt']).toLocal();
  int get durationMinutes => (json['durationMinutes'] as num).toInt();
  DateTime get endsAt => startsAt.add(Duration(minutes: durationMinutes));
  bool get ended => DateTime.now().isAfter(endsAt);
  int get energy => (json['energy'] as num?)?.toInt() ?? 3;
  int get trackLimit => (json['trackLimit'] as num?)?.toInt() ?? 8;
  Map<String, dynamic> get pack =>
      Map<String, dynamic>.from(json['pack'] as Map? ?? {});
  String get state => pack['state']?.toString() ?? 'queued';
  int get prepared => (pack['prepared'] as num?)?.toInt() ?? 0;
  int get total => (pack['total'] as num?)?.toInt() ?? 0;
  int get failed => (pack['failed'] as num?)?.toInt() ?? 0;
  bool get playable =>
      prepared > 0 && const ['ready', 'partial'].contains(state);
  String get preparationLabel => switch (state) {
        'ready' => '已准备 $prepared 个交接',
        'partial' => '部分就绪 · $prepared / $total 个交接',
        'stale' => '分析版本已更新，请重新准备',
        'failed' => '准备未完成，可重试',
        'planning' => '正在选曲和检查分析',
        'preparing' => '正在准备 · $prepared / $total 个交接',
        _ => '已预约，等待准备',
      };
  static ActivityReservation fromJson(Map<String, dynamic> value) {
    final id = RegExp(r'^[a-f0-9]{32}$');
    if (!id.hasMatch(value['id']?.toString() ?? '') ||
        !id.hasMatch(value['packId']?.toString() ?? '') ||
        value['name'] is! String ||
        value['styles'] is! List ||
        (value['styles'] as List).any((s) => s is! String) ||
        DateTime.tryParse(value['startsAt']?.toString() ?? '') == null ||
        value['durationMinutes'] is! num) {
      throw const ActivityException('预约记录格式不完整，请刷新。');
    }
    return ActivityReservation(Map<String, dynamic>.from(value));
  }
}

class ActivityRepository {
  ActivityRepository(
      {http.Client? client, ActivityCredentials? credentials, Uri? baseUri})
      : _client = client ?? http.Client(),
        credentials = credentials ?? const SecureActivityCredentials(),
        baseUri = baseUri ??
            (kIsWeb ? Uri.base : Uri.parse(BackendConfig.defaultAddress));
  final http.Client _client;
  final ActivityCredentials credentials;
  final Uri baseUri;
  Future<String>? _creating;
  String? _token;
  static const api = '/listen/set-api';
  static bool _validToken(String token) =>
      RegExp(r'^[A-Za-z0-9_-]{32,256}$').hasMatch(token);
  Future<String> _workspace() =>
      _creating ??= _loadWorkspace().whenComplete(() => _creating = null);
  Future<String> _loadWorkspace() async {
    final saved = _token ?? await credentials.read();
    if (saved != null && _validToken(saved)) return _token = saved;
    final data = await _request('POST', '/workspaces', authenticated: false);
    final token = data['token']?.toString() ?? '';
    if (!_validToken(token)) throw const ActivityException('预约服务没有返回有效的保存凭据。');
    await credentials.write(token);
    return _token = token;
  }

  Future<Map<String, dynamic>> _request(String method, String path,
      {Map<String, dynamic>? body, bool authenticated = true}) async {
    final token = authenticated ? await _workspace() : null;
    final request = http.Request(method, baseUri.resolve('$api$path'))
      ..followRedirects = false;
    request.headers.addAll({
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Harbeat-Set': '1',
      if (token != null) 'Authorization': 'Bearer $token'
    });
    if (body != null) request.body = jsonEncode(body);
    try {
      final response = await _client
          .send(request)
          .then(http.Response.fromStream)
          .timeout(const Duration(seconds: 30));
      if (response.statusCode == 401) {
        throw const ActivityException('预约访问凭据失效，请恢复预约备份；原预约不会被删除。');
      }
      if (response.bodyBytes.length > 8 * 1024 * 1024) {
        throw const ActivityException('预约数据超过本次读取范围。');
      }
      final value = jsonDecode(utf8.decode(response.bodyBytes));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw ActivityException(value is Map && value['detail'] is String
            ? value['detail']
            : '预约服务暂不可用，请稍后重试。');
      }
      if (value is! Map) throw const ActivityException('预约服务响应不完整。');
      return Map<String, dynamic>.from(value);
    } on ActivityException {
      rethrow;
    } catch (_) {
      throw const ActivityException('预约服务未能连接，已保存的预约仍会保留。');
    }
  }

  Future<List<ActivityReservation>> list() async {
    final data = await _request('GET', '/reservations');
    return (data['reservations'] as List)
        .map((v) => ActivityReservation.fromJson(Map<String, dynamic>.from(v)))
        .toList();
  }

  Future<ActivityReservation> get(String id) async =>
      ActivityReservation.fromJson(await _request('GET', '/reservations/$id'));
  Future<ActivityReservation> create(
          {required String name,
          required List<String> styles,
          required DateTime startsAt,
          required int durationMinutes,
          required int energy,
          required int trackLimit}) async =>
      ActivityReservation.fromJson(
          await _request('POST', '/reservations', body: {
        'name': name,
        'styles': styles,
        'startsAt': startsAt.toUtc().toIso8601String(),
        'durationMinutes': durationMinutes,
        'energy': energy,
        'trackLimit': trackLimit
      }));
  Future<ActivityReservation> reuse(
          String id, DateTime startsAt, int durationMinutes) async =>
      ActivityReservation.fromJson(
          await _request('POST', '/reservations/$id/reuse', body: {
        'startsAt': startsAt.toUtc().toIso8601String(),
        'durationMinutes': durationMinutes
      }));
  Future<ActivityReservation> retry(String id) async =>
      ActivityReservation.fromJson(
          await _request('POST', '/reservations/$id/prepare', body: {}));
  Future<Map<String, dynamic>> manifest(String packId) =>
      _request('GET', '/packs/$packId/manifest');
  Future<String> exportBackup() async => jsonEncode({
        'schema': 'harbeat.activity-workspace-backup.v1',
        'server': BackendConfig.defaultAddress,
        'token': await _workspace()
      });
  Future<void> importBackup(String raw) async {
    final creating = _creating;
    if (creating != null) {
      try {
        await creating;
      } catch (_) {/* A valid backup can restore access. */}
    }
    if (raw.length > 4096) throw const ActivityException('预约备份过大或格式不正确。');
    try {
      final data = jsonDecode(raw);
      if (data['schema'] != 'harbeat.activity-workspace-backup.v1' ||
          data['server'] != BackendConfig.defaultAddress ||
          data['token'] is! String ||
          !_validToken(data['token'])) {
        throw const FormatException();
      }
      final token = data['token'] as String, previous = _token;
      _token = token;
      try {
        await list();
        await credentials.write(token);
      } catch (_) {
        _token = previous;
        rethrow;
      }
    } on ActivityException {
      rethrow;
    } catch (_) {
      throw const ActivityException('无法识别这个预约备份。');
    }
  }

  void dispose() => _client.close();
}
