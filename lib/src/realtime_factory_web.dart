// ignore_for_file: deprecated_member_use, avoid_web_libraries_in_flutter
import 'dart:async';
import 'dart:convert';
import 'dart:html' as html;
import 'dart:math';
import 'realtime_engine.dart';

RealtimeEngine createRealtimeEngine() => WebMetricEngine();

/// Runs the APK's metric engine as a same-origin audio frame for web acceptance.
class WebMetricEngine extends RealtimeEngine {
  final _states = StreamController<Map<String, dynamic>>.broadcast();
  final _pending = <int, Completer<Map<String, dynamic>>>{};
  final _ready = Completer<void>();
  html.IFrameElement? _frame;
  StreamSubscription<html.MessageEvent>? _messages;
  StreamSubscription<html.Event>? _visibility;
  int _sequence = 0;
  bool _disposed = false;
  final _token =
      base64UrlEncode(List.generate(24, (_) => Random.secure().nextInt(256)));
  @override
  bool get supported => html.window.isSecureContext == true;
  @override
  bool get supportsLegacy => false;
  @override
  Stream<Map<String, dynamic>> get states => _states.stream;

  void _initialize() {
    if (_frame != null) return;
    final frame = _frame = html.IFrameElement()
      ..src = 'metric-engine/metric-engine.html#$_token'
      ..allow = 'autoplay'
      ..setAttribute('aria-hidden', 'true')
      ..tabIndex = -1;
    frame.style
      ..position = 'fixed'
      ..width = '1px'
      ..height = '1px'
      ..opacity = '0'
      ..pointerEvents = 'none';
    _messages = html.window.onMessage.listen((event) {
      if (_disposed ||
          event.origin != html.window.location.origin ||
          event.data is! String) {
        return;
      }
      try {
        final message =
            jsonDecode(event.data as String) as Map<String, dynamic>;
        if (message['token'] != _token) return;
        switch (message['harbeat']) {
          case 'metric-state':
            final state =
                jsonDecode(message['json'] as String) as Map<String, dynamic>;
            if (state['ready'] == true && !_ready.isCompleted) {
              _ready.complete();
            }
            _states.add(state);
          case 'metric-reply':
            final result =
                jsonDecode(message['json'] as String) as Map<String, dynamic>;
            final pending = _pending.remove(message['id']);
            if (result['ok'] == true) {
              pending?.complete(result);
            } else {
              pending?.completeError(
                  StateError(result['error']?.toString() ?? '操作未完成'));
            }
          case 'metric-export':
            final text = message['text'] as String;
            if (text.length > 20 * 1024 * 1024) return;
            final url = html.Url.createObjectUrlFromBlob(
                html.Blob([text], 'application/json'));
            html.AnchorElement(href: url)
              ..download = 'HarBeat-智能混音记录.json'
              ..click();
            Timer(const Duration(seconds: 1),
                () => html.Url.revokeObjectUrl(url));
        }
      } catch (_) {
        // Ignore malformed/unrelated frame messages; command timeout reports failure.
      }
    });
    _visibility = html.document.onVisibilityChange.listen((_) {
      if (html.document.hidden == true) {
        _send({'harbeat': 'metric-lifecycle', 'active': false});
      }
    });
    html.document.body!.append(frame);
  }

  void _send(Map<String, dynamic> value) => _frame?.contentWindow?.postMessage(
      jsonEncode({...value, 'token': _token}), html.window.location.origin);

  @override
  Future<Map<String, dynamic>> command(String method,
      [Map<String, dynamic> args = const {}]) async {
    if (_disposed) throw StateError('混音引擎已关闭');
    if (method == 'prepare' && args['mode'] != 'metric') {
      throw StateError('网页当前支持智能分轨；连续混音和定时舞程请使用 Android');
    }
    _initialize();
    await _ready.future.timeout(const Duration(seconds: 20));
    final id = ++_sequence, pending = Completer<Map<String, dynamic>>();
    _pending[id] = pending;
    _send({
      'harbeat': 'metric-command',
      'id': id,
      'method': method,
      'args': args
    });
    try {
      return await pending.future.timeout(Duration(
          seconds:
              const ['metricPrepare', 'mixSoon'].contains(method) ? 420 : 180));
    } finally {
      _pending.remove(id);
    }
  }

  @override
  Future<void> dispose() async {
    _disposed = true;
    await _messages?.cancel();
    await _visibility?.cancel();
    for (final pending in _pending.values) {
      pending.completeError(StateError('混音引擎已关闭'));
    }
    _pending.clear();
    _frame?.remove();
    await _states.close();
  }
}
