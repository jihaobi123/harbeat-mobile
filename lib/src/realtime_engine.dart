import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

abstract class RealtimeEngine {
  bool get supported;
  Stream<Map<String, dynamic>> get states;
  Future<Map<String, dynamic>> command(String method,
      [Map<String, dynamic> args = const {}]);
  Future<void> dispose();
}

class PlatformRealtimeEngine implements RealtimeEngine {
  bool _initialized = false;
  static const _method = MethodChannel('harbeat/realtime');
  static const _events = EventChannel('harbeat/realtime/state');
  @override
  bool get supported =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
  @override
  Stream<Map<String, dynamic>> get states => _events
      .receiveBroadcastStream()
      .map((value) => Map<String, dynamic>.from(value as Map));
  @override
  Future<Map<String, dynamic>> command(String method,
      [Map<String, dynamic> args = const {}]) async {
    if (!supported) throw StateError('当前设备尚未接入 V3 本机引擎');
    _initialized = true;
    final result = await _method.invokeMapMethod<String, dynamic>(
        'command', {'method': method, 'args': args});
    return result ?? {};
  }

  @override
  Future<void> dispose() async {
    if (supported && _initialized) {
      try {
        await _method.invokeMethod<void>('dispose');
      } on PlatformException catch (_) {
      } on MissingPluginException catch (_) {}
    }
  }
}
