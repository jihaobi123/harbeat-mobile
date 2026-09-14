import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

abstract interface class LocalStore {
  Future<Map<String, dynamic>> read();
  Future<void> write(Map<String, dynamic> value);
}

class SharedPreferencesLocalStore implements LocalStore {
  static const _key = 'harbeat_local_state_v1';

  @override
  Future<Map<String, dynamic>> read() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw == null) return {};
    try {
      return jsonDecode(raw) as Map<String, dynamic>;
    } on FormatException {
      return {};
    }
  }

  @override
  Future<void> write(Map<String, dynamic> value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(value));
  }
}

class MemoryLocalStore implements LocalStore {
  Map<String, dynamic> value = {};

  @override
  Future<Map<String, dynamic>> read() async => value;

  @override
  Future<void> write(Map<String, dynamic> next) async {
    value = jsonDecode(jsonEncode(next)) as Map<String, dynamic>;
  }
}
