import 'package:flutter/material.dart';

enum DeviceConnection {
  noDevice,
  resolving,
  pairing,
  online,
  busy,
  disconnected
}

enum TrackAvailability { ready, metadataOnly, unavailable }

enum LiveCommandState {
  idle,
  sent,
  queued,
  executing,
  completed,
  rejected,
  timeoutUnknown
}

enum PlaybackMode { sequential, repeatOne, shuffle }

enum ClientIssueKind {
  offline,
  permission,
  cache,
  conflict,
  unsupported,
  damaged,
  storage
}

class ClientIssue {
  const ClientIssue(this.kind, this.title, this.detail);
  final ClientIssueKind kind;
  final String title;
  final String detail;
}

class Track {
  const Track({
    required this.id,
    required this.title,
    required this.artist,
    required this.style,
    required this.bpm,
    required this.energy,
    required this.reason,
    required this.color,
    this.availability = TrackAvailability.ready,
    this.musicalKey,
    this.backendId,
    this.durationMs,
    this.analysisStatus,
    this.analysisRunId,
    this.manifestSha256,
    this.vocalSummary = const {},
    this.needsReview = false,
    this.qualityFlags = const [],
    this.analysis = const {},
    this.previewUrl,
    this.detailLoaded = false,
  });

  final String id;
  final String title;
  final String artist;
  final String style;
  final num? bpm;
  final int? energy;
  final String reason;
  final Color color;
  final TrackAvailability availability;
  final String? musicalKey;
  final String? backendId;
  final int? durationMs;
  final String? analysisStatus;
  final String? analysisRunId;
  final String? manifestSha256;
  final Map<String, dynamic> vocalSummary;
  final bool needsReview;
  final List<String> qualityFlags;
  final Map<String, dynamic> analysis;
  final String? previewUrl;
  final bool detailLoaded;
  bool get isRemote => backendId != null;
  bool get isNas => id.startsWith('nas:');
  bool get isRenderedMix => id.startsWith('mix:');
  String get bpmLabel => bpm == null || bpm! <= 0
      ? '待分析'
      : bpm! % 1 == 0
          ? bpm!.toInt().toString()
          : bpm!.toStringAsFixed(1);
  String get analysisLabel => isNas && !detailLoaded
      ? '预处理目录 · 详情待加载'
      : isRenderedMix
          ? 'V3 完整混音 · 已渲染'
          : isRemote || isNas
              ? switch (analysisStatus) {
                  'ready' ||
                  'completed' ||
                  'done' =>
                    needsReview ? '分析待复核' : '分析已完成',
                  'degraded' => '分析部分降级',
                  'partial' => '分析部分完成',
                  'failed' || 'error' || 'unavailable' => '分析暂不可用',
                  'pending' ||
                  'queued' ||
                  'analyzing' ||
                  'core_analyzing' ||
                  'stem_separating' ||
                  'feature_analyzing' ||
                  'style_analyzing' =>
                    '分析中',
                  _ => '待分析',
                }
              : isLocal
                  ? '音频已导入，分析尚未接入'
                  : '分析数据为示例';
  bool get isLocal => id.startsWith('local:');
  bool get canPlay => availability == TrackAvailability.ready;
  String get mixStyle => switch (style.toUpperCase()) {
        'POPPING' || 'LOCKING' || 'FUNK' => 'Funk',
        'HIP-HOP' => 'Hip-Hop',
        'HOUSE' => 'House',
        _ => 'Local',
      };
  String get resourceLabel => switch (availability) {
        TrackAvailability.ready => isRenderedMix
            ? '离线混音试听'
            : isNas
                ? (detailLoaded ? 'NAS 原曲' : 'NAS · 待检查音频')
                : isLocal
                    ? '本地音频'
                    : isRemote
                        ? '在线音频'
                        : '示例试听',
        TrackAvailability.metadataOnly => '仅歌曲信息',
        TrackAvailability.unavailable => '资源不可用',
      };
}

enum AccessoryKind { ring, band, pendant }

enum AccessoryStatus { disconnected, discovering, confirming, connected }

enum AccessoryGesture { single, doubleTap, hold }

enum ShortcutAction { energyUp, energyDown, nextStyle, nextTrack, playback }

extension AccessoryLabels on AccessoryKind {
  String get label => switch (this) {
        AccessoryKind.ring => '戒指',
        AccessoryKind.band => '手环',
        AccessoryKind.pendant => '项链',
      };
}

extension GestureLabels on AccessoryGesture {
  String get label => switch (this) {
        AccessoryGesture.single => '轻按一次',
        AccessoryGesture.doubleTap => '快速双击',
        AccessoryGesture.hold => '长按',
      };
}

extension ShortcutLabels on ShortcutAction {
  String get label => switch (this) {
        ShortcutAction.energyUp => '能量提高一档',
        ShortcutAction.energyDown => '能量降低一档',
        ShortcutAction.nextStyle => '切换下一个风格',
        ShortcutAction.nextTrack => '下一首',
        ShortcutAction.playback => '播放 / 暂停',
      };
}

class MusicDirection {
  const MusicDirection(this.energy, this.style, this.trackId);
  final int energy;
  final String style;
  final String trackId;
}

class DirectionIntent {
  const DirectionIntent(this.direction, this.source,
      {this.restore = false, this.followQueue = false});
  final MusicDirection direction;
  final String source;
  final bool restore;
  final bool followQueue;
}

class PadSlot {
  const PadSlot(
    this.index,
    this.sound, {
    this.playMode = 'once',
    this.volume = .85,
    this.retriggerGuardMs = 300,
  });
  final int index;
  final String? sound;
  final String playMode;
  final double volume;
  final int retriggerGuardMs;

  PadSlot copyWith({
    String? sound,
    bool clear = false,
    String? playMode,
    double? volume,
    int? retriggerGuardMs,
  }) =>
      PadSlot(
        index,
        clear ? null : sound ?? this.sound,
        playMode: playMode ?? this.playMode,
        volume: volume ?? this.volume,
        retriggerGuardMs: retriggerGuardMs ?? this.retriggerGuardMs,
      );
}

class Playlist {
  const Playlist(
      {required this.id, required this.name, required this.trackIds});
  final String id;
  final String name;
  final List<String> trackIds;

  Playlist add(String trackId) =>
      Playlist(id: id, name: name, trackIds: {...trackIds, trackId}.toList());

  Playlist copyWith({String? name, List<String>? trackIds}) => Playlist(
        id: id,
        name: name ?? this.name,
        trackIds: trackIds ?? this.trackIds,
      );
}

class UsageRecord {
  const UsageRecord(
      {required this.title, required this.endedAt, required this.trackCount});
  final String title;
  final DateTime endedAt;
  final int trackCount;
}
