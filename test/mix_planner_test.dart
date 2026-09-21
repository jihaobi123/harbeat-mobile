import 'package:flutter_test/flutter_test.dart';
import 'dart:io';
import 'dart:convert';
import 'package:harbeat/src/mix_planner.dart';
import 'package:harbeat/src/accessory_ble.dart';
import 'package:harbeat/src/models.dart';

void main() {
  const planner = VocalMixPlanner();
  test('Dart entry choices match the supplied Python v4 on 24 reference cases',
      () {
    final cases = jsonDecode(
            File('test/fixtures/vocal_v4_entry_golden.json').readAsStringSync())
        as List;
    for (final sample in cases) {
      final profile = MixProfile(
          bpm: 120,
          durationMs: 180000,
          bars: (sample['bars'] as List).cast<int>(),
          vocals: (sample['vocals'] as List)
              .map((p) => (p[0] as int, p[1] as int))
              .toList());
      expect(
          planner.entryCue(profile, sample['overlap'] as int), sample['cue']);
    }
  });
  test(
      'v4 overlap merges overlapping padded intervals instead of double counting',
      () {
    expect(planner.vocalRatio([(1000, 2000), (1800, 3000)], 0, 4000), .7);
    expect(planner.vocalRatio([(1000, 2000)], 1500, 1800), 1);
    expect(planner.vocalRatio([], 0, 4000), 0);
  });
  test('v4 entry cue avoids the opening vocal', () {
    expect(
        planner.entryCue(
            const MixProfile(
                bpm: 120,
                durationMs: 180000,
                bars: [0, 4000, 8000, 12000, 16000],
                vocals: [(0, 7000)]),
            16000),
        8000);
  });
  test('direct and double/half tempo rules match supplied algorithm', () {
    expect(planner.entryRate(120, 125), .96);
    expect(planner.entryRate(75, 148), closeTo(150 / 148, 1e-10));
    expect(planner.entryRate(150, 74), closeTo(75 / 74, 1e-10));
    expect(planner.entryRate(120, 160), 1);
    expect(planner.entryRate(0, 120), 1);
  });
  test('future cues stay inside both actual decoded files', () {
    final plan = planner.plan(
        const MixProfile(bpm: 120, durationMs: 24000, bars: [2000, 4000, 6000]),
        const MixProfile(bpm: 125, durationMs: 24000, bars: [2000, 4000]),
        positionMs: 1000,
        outgoingLengthMs: 24000,
        incomingLengthMs: 24000);
    expect(plan.outgoingCueMs, greaterThan(1000));
    expect(plan.outgoingCueMs + plan.overlapMs, lessThanOrEqualTo(24000));
    expect(plan.incomingCueMs + plan.overlapMs * plan.incomingRate,
        lessThan(24000));
    expect(plan.note, contains('人声数据未提供'));
  });
  test('short unanalysed files use original speed and never invented grid', () {
    final plan = planner.plan(const MixProfile(bpm: null, durationMs: 4000),
        const MixProfile(bpm: null, durationMs: 3000),
        positionMs: 2000, outgoingLengthMs: 4000, incomingLengthMs: 3000);
    expect(plan.incomingRate, 1);
    expect(plan.overlapMs, lessThanOrEqualTo(1650));
    expect(plan.note, startsWith('原速交叉淡化'));
  });
  test('unknown or malformed BLE frames cannot control playback', () {
    final map = GesturePacketMap({
      AccessoryGesture.single: '01 00',
      AccessoryGesture.doubleTap: '02 00',
      AccessoryGesture.hold: '03 00'
    });
    expect(map.decode([1, 0]), AccessoryGesture.single);
    expect(map.decode([1, 0, 0]), isNull);
    expect(map.decode([]), isNull);
    expect(
        () => GesturePacketMap(
            {for (final g in AccessoryGesture.values) g: '01'}),
        throwsFormatException);
    expect(() => GesturePacketMap.normalize('0x01'), throwsFormatException);
    expect(() => GesturePacketMap.normalize('1'), throwsFormatException);
  });
}
