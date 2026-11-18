import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

/// Kept separate from normal playback state and keyed by the immutable case.
class DjReferenceFeedbackStore {
  static const key = 'harbeat_dj_reference_feedback_v1';
  Future<Map<String, dynamic>> _records() async {
    final raw = (await SharedPreferences.getInstance()).getString(key);
    if (raw == null || raw.length > 256 * 1024) return {};
    try {
      final value = jsonDecode(raw);
      return value is Map ? Map<String, dynamic>.from(value) : {};
    } catch (_) {
      return {};
    }
  }

  Future<Map<String, dynamic>?> read(String caseId) async {
    final value = (await _records())[caseId];
    return value is Map ? Map<String, dynamic>.from(value) : null;
  }

  Future<void> save(
      {required String caseId,
      required String preference,
      required String variant,
      required Map<String, dynamic> coverage}) async {
    if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(caseId) ||
        !const ['original', 'reference', 'same', 'neither']
            .contains(preference) ||
        !const ['original', 'reference'].contains(variant)) {
      throw StateError('试听记录身份不完整');
    }
    final safe = <String, dynamic>{};
    for (final side in ['original', 'reference']) {
      final value = coverage[side];
      if (value is! Map) throw StateError('试听覆盖记录不完整');
      final seconds = value['seconds'],
          fraction = value['fraction'],
          intervals = value['intervals'];
      if (seconds is! num ||
          !seconds.isFinite ||
          seconds < 0 ||
          seconds > 60 ||
          fraction is! num ||
          !fraction.isFinite ||
          fraction < 0 ||
          fraction > 1 ||
          intervals is! List ||
          intervals.length > 256) {
        throw StateError('试听覆盖记录无效');
      }
      double end = -1;
      for (final interval in intervals) {
        if (interval is! List ||
            interval.length != 2 ||
            interval.any((v) => v is! num || !v.isFinite) ||
            interval[0] < 0 ||
            interval[0] < end ||
            interval[1] < interval[0] ||
            interval[1] > 60) {
          throw StateError('试听时间区间无效');
        }
        end = (interval[1] as num).toDouble();
      }
      safe[side] = {
        'seconds': seconds,
        'fraction': fraction,
        'intervals': intervals
      };
    }
    final records = await _records();
    records.remove(caseId);
    records[caseId] = {
      'caseId': caseId,
      'preference': preference,
      'variant': variant,
      'coverage': safe,
      'recordedAt': DateTime.now().toUtc().toIso8601String(),
      'schema': 'harbeat.dj-reference-feedback.v1'
    };
    while (records.length > 20) {
      records.remove(records.keys.first);
    }
    final ok = await (await SharedPreferences.getInstance())
        .setString(key, jsonEncode(records));
    if (!ok) throw StateError('试听选择未能保存，请重试');
  }
}
