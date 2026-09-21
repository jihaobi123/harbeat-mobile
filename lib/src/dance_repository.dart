import 'dart:convert';
import 'package:http/http.dart' as http;
import 'backend.dart';

class DanceRepository {
  DanceRepository({http.Client? client, Uri? baseUri})
      : _client = client ?? http.Client(),
        baseUri = baseUri ?? Uri.parse('https://8.136.120.255');
  final http.Client _client;
  final Uri baseUri;
  Future<Map<String, dynamic>> _get(String path,
      [Map<String, String>? query]) async {
    final uri = baseUri
        .resolve('/api/analysis-lab/dance/$path')
        .replace(queryParameters: query);
    final request = http.Request('GET', uri)..followRedirects = false;
    final response = await http.Response.fromStream(await _client.send(request))
        .timeout(const Duration(seconds: 60));
    if (response.statusCode != 200) {
      String message = '舞程服务暂不可用（${response.statusCode}），请稍后重试。';
      try {
        final value = jsonDecode(utf8.decode(response.bodyBytes));
        if (value is Map && value['detail'] is String) {
          message = value['detail'];
        }
      } catch (_) {}
      throw BackendException(message);
    }
    return Map<String, dynamic>.from(
        jsonDecode(utf8.decode(response.bodyBytes)) as Map);
  }

  Future<Map<String, dynamic>> catalog() => _get('catalog');
  Future<Map<String, dynamic>> prepare(
          String style, int minutes, int variation) =>
      _get('set',
          {'style': style, 'minutes': '$minutes', 'variation': '$variation'});
  Future<Map<String, dynamic>> status(String id) {
    if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(id)) {
      throw const BackendException('舞程任务编号不正确。');
    }
    return _get('jobs/$id');
  }

  void close() => _client.close();
}
