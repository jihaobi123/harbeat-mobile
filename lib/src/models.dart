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
  });

  final String id;
  final String title;
  final String artist;
  final String style;
  final int bpm;
  final int energy;
  final String reason;
  final Color color;
  final TrackAvailability availability;
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
