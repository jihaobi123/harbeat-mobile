import 'dart:math' as math;
import 'models.dart';

/// Millisecond-only projection of backend evidence. Missing vocal evidence is
/// kept distinct from a report that positively contains zero vocal intervals.
class MixProfile {
  const MixProfile(
      {required this.bpm,
      required this.durationMs,
      this.bars = const [],
      this.vocals,
      this.windows = const []});
  final double? bpm;
  final int durationMs;
  final List<int> bars;
  final List<(int, int)>? vocals;
  final List<Map<String, dynamic>> windows;

  factory MixProfile.fromTrack(Track track) {
    final grid = track.analysis['beat_grid'];
    final values = grid is Map ? grid['bars_ms'] ?? grid['downbeats_ms'] : null;
    final bars = values is List
        ? values
            .whereType<num>()
            .where((v) => v.isFinite && v >= 0)
            .map((v) => v.round())
            .toSet()
            .toList()
        : <int>[];
    bars.sort();
    final vocal = track.analysis['vocal_activity'];
    List<(int, int)>? intervals;
    if (vocal is Map &&
        vocal['status'] == 'ready' &&
        vocal['intervals'] is List) {
      intervals = [];
      for (final item in vocal['intervals'] as List) {
        if (item is Map && item['start_ms'] is num && item['end_ms'] is num) {
          final a = (item['start_ms'] as num).toDouble();
          final b = (item['end_ms'] as num).toDouble();
          if (a.isFinite && b.isFinite && a >= 0 && b > a) {
            intervals.add((a.round(), b.round()));
          }
        }
      }
    }
    final rawWindows = track.analysis['transition_windows'];
    return MixProfile(
        bpm: track.bpm?.toDouble(),
        durationMs: track.durationMs ?? 0,
        bars: track.needsReview ? const [] : bars,
        vocals: intervals,
        windows: rawWindows is List
            ? rawWindows
                .whereType<Map>()
                .map((v) => Map<String, dynamic>.from(v))
                .toList()
            : const []);
  }
}

class MixPlan {
  const MixPlan(
      {required this.outgoingCueMs,
      required this.incomingCueMs,
      required this.overlapMs,
      required this.incomingRate,
      required this.note});
  final int outgoingCueMs, incomingCueMs, overlapMs;
  final double incomingRate;
  final String note;
}

/// Port of vocal-v4's padded/merged overlap and entry-cue scoring. Scheduling
/// bounds differ for a live manual command: choose a future bar within 8 bars,
/// rather than the offline renderer's 90–205 second track segment.
class VocalMixPlanner {
  const VocalMixPlanner();
  double vocalRatio(List<(int, int)> intervals, int start, int end) {
    if (end <= start) return 0;
    final clipped = intervals
        .where((p) => p.$2 > p.$1)
        .map((p) => (math.max(start, p.$1 - 400), math.min(end, p.$2 + 400)))
        .where((p) => p.$2 > p.$1)
        .toList()
      ..sort((a, b) => a.$1.compareTo(b.$1));
    var covered = 0, right = start;
    for (final p in clipped) {
      covered += math.max(0, p.$2 - math.max(right, p.$1));
      right = math.max(right, p.$2);
    }
    return covered / (end - start);
  }

  int entryCue(MixProfile profile, int overlapMs) {
    final choices = <int>{0, ...profile.bars.where((v) => v > 0 && v <= 24000)}
        .toList()
      ..sort();
    double score(int cue) =>
        vocalRatio(profile.vocals ?? [], cue, cue + overlapMs) * 90 +
        cue / 1000 +
        (cue > 12000 ? 16 : 0);
    choices.sort((a, b) {
      final c = score(a).compareTo(score(b));
      return c == 0 ? a.compareTo(b) : c;
    });
    return choices.first;
  }

  double entryRate(double? from, double? to) {
    if (from == null ||
        to == null ||
        !from.isFinite ||
        !to.isFinite ||
        from <= 0 ||
        to <= 0) {
      return 1;
    }
    if ((from - to).abs() <= 10) return from / to;
    if ((from * 2 - to).abs() <= 5) return from * 2 / to;
    if ((from / 2 - to).abs() <= 5) return from / 2 / to;
    return 1;
  }

  MixPlan plan(MixProfile outgoing, MixProfile incoming,
      {required int positionMs,
      required int outgoingLengthMs,
      required int incomingLengthMs}) {
    final earliest = positionMs + 350; // preload has already completed
    final available = outgoingLengthMs - earliest;
    if (available < 600 || incomingLengthMs < 1000) {
      throw StateError('歌曲已接近结尾，请待下一首开始后再切换。');
    }
    final requestedRate = entryRate(outgoing.bpm, incoming.bpm);
    final rate =
        requestedRate >= .90 && requestedRate <= 1.10 ? requestedRate : 1.0;
    final from = outgoing.bpm, to = incoming.bpm;
    final compatible = from != null &&
        to != null &&
        from > 0 &&
        to > 0 &&
        ((from - to).abs() <= 10 ||
            (from * 2 - to).abs() <= 5 ||
            (from / 2 - to).abs() <= 5);
    final evidence =
        outgoing.bars.isNotEmpty && incoming.bars.isNotEmpty && compatible;
    final vocalEvidence = outgoing.vocals != null && incoming.vocals != null;
    // v4 mix_blend uses 16 s; absent grids use a short, unaligned 2 s fade.
    var overlap = math.min(evidence ? 16000 : 2000, available);
    var entry = entryCue(incoming, overlap);
    if (entry + overlap * rate >= incomingLengthMs) entry = 0;
    overlap =
        math.min(overlap, ((incomingLengthMs - entry - 200) / rate).floor());
    final barMs = outgoing.bpm != null && outgoing.bpm! > 0
        ? 240000 / outgoing.bpm!
        : 2000;
    final latest =
        math.min(earliest + (8 * barMs).round(), outgoingLengthMs - overlap);
    final choices = evidence
        ? outgoing.bars.where((v) => v >= earliest && v <= latest).toList()
        : <int>[];
    double score(int cue) =>
        (cue - earliest) / 1000 +
        vocalRatio(outgoing.vocals ?? [], cue, cue + overlap) * 55 +
        vocalRatio(outgoing.vocals ?? [], cue - 4000, cue + 2000) * 18;
    choices.sort((a, b) {
      final c = score(a).compareTo(score(b));
      return c == 0 ? a.compareTo(b) : c;
    });
    final cue = choices.isEmpty ? earliest : choices.first;
    return MixPlan(
        outgoingCueMs: cue,
        incomingCueMs: entry,
        overlapMs: overlap,
        incomingRate: choices.isNotEmpty ? rate : 1,
        note:
            '${choices.isEmpty ? '原速交叉淡化' : '按小节切换'} · ${vocalEvidence ? '人声避让' : '人声数据未提供'}');
  }
}
