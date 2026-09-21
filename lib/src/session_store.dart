import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'backend.dart';

abstract interface class SessionStore {
  Future<BackendConfig?> read(BackendConfig server);
  Future<void> write(BackendConfig session);
  Future<void> clear();
}

class SecureSessionStore implements SessionStore {
  const SecureSessionStore();
  static const _key = 'harbeat_authenticated_session_v1';
  static const _storage = FlutterSecureStorage();

  @override
  Future<BackendConfig?> read(BackendConfig server) async {
    final raw = await _storage.read(key: _key);
    if (raw == null) return null;
    try {
      final data = jsonDecode(raw) as Map<String, dynamic>;
      final saved = BackendConfig(data['url'],
          api: data['api'] == 'v2' ? BackendApi.v2 : BackendApi.legacy,
          token: data['access_token'],
          refreshToken: data['refresh_token'] ?? '',
          username: data['username'],
          userId: data['user_id']);
      return saved.scope == server.scope && saved.token.isNotEmpty
          ? saved
          : null;
    } on FormatException {
      await clear();
      return null;
    } on TypeError {
      await clear();
      return null;
    }
  }

  @override
  Future<void> write(BackendConfig session) async {
    if (session.token.isEmpty) return clear();
    await _storage.write(
        key: _key,
        value: jsonEncode({
          ...session.toJson(),
          'access_token': session.token,
          'refresh_token': session.refreshToken,
          'username': session.username,
          'user_id': session.userId,
        }));
  }

  @override
  Future<void> clear() => _storage.delete(key: _key);
}

class MemorySessionStore implements SessionStore {
  BackendConfig? value;
  @override
  Future<BackendConfig?> read(BackendConfig server) async =>
      value?.scope == server.scope ? value : null;
  @override
  Future<void> write(BackendConfig session) async => value = session;
  @override
  Future<void> clear() async => value = null;
}
