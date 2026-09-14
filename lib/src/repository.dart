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
          reason: '因为你常跳 Popping',
          color: Color(0xFF5A43FF)),
      Track(
          id: 'lock',
          title: 'LOCK IT DOWN',
          artist: 'Pocket Theory',
          style: 'LOCKING',
          bpm: 110,
          energy: 76,
          reason: '类似你收藏的 Funk Groove',
          color: Color(0xFFFF5C35)),
      Track(
          id: 'midnight',
          title: 'AFTER MIDNIGHT',
          artist: 'Velvet Transit',
          style: 'HIP-HOP',
          bpm: 96,
          energy: 64,
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
          reason: '探索推荐，不改变主偏好',
          color: Color(0xFFFFC400)),
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
