import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/realtime_engine.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
      'lab subscription shares events and leaving preserves the ordinary listener',
      () async {
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    const channel = 'harbeat/realtime/state';
    const codec = StandardMethodCodec();
    messenger.setMockMethodCallHandler(
        const MethodChannel(channel), (_) async => null);
    addTearDown(() =>
        messenger.setMockMethodCallHandler(const MethodChannel(channel), null));
    final engine = PlatformRealtimeEngine();
    final ordinary = <Map<String, dynamic>>[], lab = <Map<String, dynamic>>[];
    final normalSubscription = engine.states.listen(ordinary.add);
    final labSubscription = engine.states.listen(lab.add);
    await Future<void>.delayed(Duration.zero);
    await messenger.handlePlatformMessage(
        channel, codec.encodeSuccessEnvelope({'position': 1}), (_) {});
    await Future<void>.delayed(Duration.zero);
    expect(ordinary, [
      {'position': 1}
    ]);
    expect(lab, [
      {'position': 1}
    ]);
    await labSubscription.cancel();
    await messenger.handlePlatformMessage(
        channel, codec.encodeSuccessEnvelope({'position': 2}), (_) {});
    await Future<void>.delayed(Duration.zero);
    expect(ordinary, [
      {'position': 1},
      {'position': 2}
    ]);
    expect(lab, [
      {'position': 1}
    ]);
    await normalSubscription.cancel();
  });
}
