import 'package:flutter/material.dart';

import 'models.dart';

abstract interface class HarBeatRepository {
  Future<List<Track>> recommendations();
  Future<void> saveTrack(String id);
  Future<DeviceConnection> deviceSnapshot();
  Future<void> savePreset(List<PadSlot> slots, int version);
  Future<int> syncPreset(List<PadSlot> slots, int version);
}

class MockHarBeatRepository implements HarBeatRepository {
  @override
  Future<List<Track>> recommendations() async {
    await Future<void>.delayed(const Duration(milliseconds: 320));
    return const [
      Track(
          id: 'electric',
          title: 'ELECTRIC MOTION',
          artist: 'Nova Circuit',
          style: 'POPPING',
          bpm: 104,
          energy: 82,
          musicalKey: 'F minor',
          reason: '因为你常跳 Popping',
          color: Color(0xFF5A43FF)),
      Track(
          id: 'lock',
          title: 'LOCK IT DOWN',
          artist: 'Pocket Theory',
          style: 'LOCKING',
          bpm: 110,
          energy: 76,
          musicalKey: 'A minor',
          reason: '类似你收藏的 Funk Groove',
          color: Color(0xFFFF5C35)),
      Track(
          id: 'midnight',
          title: 'AFTER MIDNIGHT',
          artist: 'Velvet Transit',
          style: 'HIP-HOP',
          bpm: 96,
          energy: 64,
          musicalKey: 'D minor',
          reason: '适合 88–102 BPM 的练习',
          color: Color(0xFF19B97A),
          availability: TrackAvailability.metadataOnly),
      Track(
          id: 'rubber',
          title: 'RUBBER FRAME',
          artist: 'Signal Arcade',
          style: 'POPPING',
          bpm: 108,
          energy: 88,
          musicalKey: 'C minor',
          reason: '探索推荐，不改变主偏好',
          color: Color(0xFFFFC400)),
      Track(
          id: 'sidewalk',
          title: 'SIDEWALK SYNTAX',
          artist: 'Blue Basement',
          style: 'HIP-HOP',
          bpm: 92,
          energy: 58,
          musicalKey: 'G minor',
          reason: '从松弛开始，慢慢进入状态',
          color: Color(0xFF3155FF)),
      Track(
          id: 'pocket',
          title: 'POCKET PARADE',
          artist: 'The Breakmakers',
          style: 'LOCKING',
          bpm: 114,
          energy: 84,
          musicalKey: 'E minor',
          reason: '让动作跟上更饱满的节奏',
          color: Color(0xFFD8FF00)),
      Track(
          id: 'concrete',
          title: 'CONCRETE BREEZE',
          artist: 'Low Rise Club',
          style: 'HOUSE',
          bpm: 124,
          energy: 71,
          musicalKey: 'B minor',
          reason: '先收藏，音频可用后再播放',
          color: Color(0xFF808790),
          availability: TrackAvailability.unavailable),
      Track(
          id: 'echo',
          title: 'ECHO PRACTICE',
          artist: 'Mono Steps',
          style: 'POPPING',
          bpm: 100,
          energy: 54,
          musicalKey: 'F major',
          reason: '轻一点的 Funk 练习',
          color: Color(0xFFFF5C35)),
      Track(
          id: 'floor',
          title: 'OPEN FLOOR',
          artist: 'Room Service',
          style: 'HOUSE',
          bpm: 122,
          energy: 75,
          musicalKey: 'A minor',
          reason: '连续律动，打开舞池',
          color: Color(0xFF3155FF)),
      Track(
          id: 'funk',
          title: 'POCKET FUNK',
          artist: 'The Breakmakers',
          style: 'FUNK',
          bpm: 108,
          energy: 65,
          musicalKey: 'E minor',
          reason: '适合日常的中等能量练习',
          color: Color(0xFF19B97A)),
    ];
  }

  @override
  Future<void> saveTrack(String id) =>
      Future<void>.delayed(const Duration(milliseconds: 240));

  @override
  Future<DeviceConnection> deviceSnapshot() async {
    await Future<void>.delayed(const Duration(milliseconds: 220));
    return DeviceConnection.online;
  }

  @override
  Future<void> savePreset(List<PadSlot> slots, int version) =>
      Future<void>.delayed(const Duration(milliseconds: 280));

  @override
  Future<int> syncPreset(List<PadSlot> slots, int version) async {
    await Future<void>.delayed(const Duration(milliseconds: 700));
    return version;
  }
}
