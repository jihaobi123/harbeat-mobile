import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/app.dart';
import 'package:harbeat/src/audio_service.dart';
import 'package:harbeat/src/local_store.dart';
import 'package:harbeat/src/repository.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets(
      'phone sized viewport renders playback and queue without overflow',
      (tester) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(HarBeatApp(
        repository: MockHarBeatRepository(),
        localStore: MemoryLocalStore(),
        audio: MemoryAudioService()));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.ensureVisible(find.text('开始播放'));
    await tester.tap(find.text('开始播放'));
    await tester.pumpAndSettle();
    await Scrollable.ensureVisible(tester.element(find.text('播放队列 →')),
        alignment: .5);
    await tester.pumpAndSettle();
    await tester.tap(find.text('播放队列 →'));
    await tester.pumpAndSettle();
    expect(find.text('NOW / PHONE'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets('opens phone playback without a device requirement',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(HarBeatApp(
        repository: MockHarBeatRepository(),
        localStore: MemoryLocalStore(),
        audio: MemoryAudioService()));
    await tester.pumpAndSettle();
    expect(find.text('播放'), findsOneWidget);
    expect(find.text('音乐'), findsOneWidget);
    expect(find.text('设备'), findsNothing);
    expect(find.text('我的'), findsOneWidget);
    expect(find.text('让身体，跟着节奏。'), findsOneWidget);
    expect(find.text('开始播放'), findsOneWidget);
    expect(find.text('无需连接设备'), findsOneWidget);
  });

  testWidgets('opens music recommendations', (tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(HarBeatApp(
        repository: MockHarBeatRepository(),
        localStore: MemoryLocalStore(),
        audio: MemoryAudioService()));
    await tester.tap(find.text('音乐'));
    await tester.pumpAndSettle();
    expect(find.text('发现下一首心动。'), findsOneWidget);
    expect(find.text('BODY\nELECTRIC'), findsOneWidget);
  });

  testWidgets('music playback returns to direction controls and exposes queue',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(HarBeatApp(
        repository: MockHarBeatRepository(),
        localStore: MemoryLocalStore(),
        audio: MemoryAudioService()));
    await tester.tap(find.text('音乐'));
    await tester.pumpAndSettle();
    final play = find.byWidgetPredicate((widget) =>
        widget is IconButton &&
        (widget.tooltip?.startsWith('手机播放 ·') ?? false));
    for (var i = 0; i < 10 && play.evaluate().isEmpty; i++) {
      await tester.drag(find.byType(ListView).last, const Offset(0, -250));
      await tester.pumpAndSettle();
    }
    await tester.ensureVisible(play.first);
    await tester.pumpAndSettle();
    await tester.tap(play.first);
    await tester.pumpAndSettle();
    expect(find.text('暂停播放'), findsOneWidget);
    await tester.ensureVisible(find.text('播放队列 →'));
    await tester.tap(find.text('播放队列 →'));
    await tester.pumpAndSettle();
    expect(find.text('NOW / PHONE'), findsOneWidget);
    expect(find.textContaining('QUEUE ·'), findsOneWidget);
  });

  testWidgets('unsupported desktop never fabricates a BLE connection',
      (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.linux;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    await tester.pumpWidget(HarBeatApp(
        repository: MockHarBeatRepository(),
        localStore: MemoryLocalStore(),
        audio: MemoryAudioService()));
    await tester.pumpAndSettle();
    await tester.tap(find.text('我的'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('我的饰品'), 200,
        scrollable: find.byType(Scrollable).last);
    await tester.tap(find.text('我的饰品'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('查找附近饰品'));
    await tester.tap(find.text('查找附近饰品'));
    await tester.pumpAndSettle();
    expect(find.text('真实蓝牙请在 Android 或 iOS App 中使用。'), findsOneWidget);
    expect(find.textContaining('模拟按键确认'), findsNothing);
    expect(find.textContaining('快捷控制已配置'), findsNothing);
    debugDefaultTargetPlatformOverride = null;
  });
}
