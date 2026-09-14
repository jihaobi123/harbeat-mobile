import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/app.dart';
import 'package:harbeat/src/audio_service.dart';
import 'package:harbeat/src/local_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('renders the primary navigation and home task', (tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(HarBeatApp(
        localStore: MemoryLocalStore(), audio: MemoryAudioService()));
    await tester.pumpAndSettle();
    expect(find.text('首页'), findsOneWidget);
    expect(find.text('音乐'), findsOneWidget);
    expect(find.text('设备'), findsOneWidget);
    expect(find.text('我的'), findsOneWidget);
    expect(find.textContaining('MAKE'), findsOneWidget);
  });

  testWidgets('opens music recommendations', (tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(HarBeatApp(
        localStore: MemoryLocalStore(), audio: MemoryAudioService()));
    await tester.tap(find.text('音乐'));
    await tester.pumpAndSettle();
    expect(find.textContaining('FIND YOUR'), findsOneWidget);
    expect(find.text('BODY\nELECTRIC'), findsOneWidget);
  });

  testWidgets('opens the full player from the mini player', (tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(HarBeatApp(
        localStore: MemoryLocalStore(), audio: MemoryAudioService()));
    await tester.tap(find.text('音乐'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('试听').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('试听').first);
    await tester.pump();
    expect(find.byType(MiniPlayer), findsOneWidget);
    await tester.tap(find.byType(MiniPlayer));
    await tester.pumpAndSettle();
    expect(find.text('NOW / PHONE'), findsOneWidget);
    expect(find.textContaining('QUEUE ·'), findsOneWidget);
  });
}
