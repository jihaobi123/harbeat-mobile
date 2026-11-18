import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:harbeat/src/app.dart';
import 'package:harbeat/src/controller.dart';
import 'package:harbeat/src/dj_reference_feedback.dart';
import 'realtime_player_test.dart' show FakeRealtime, ProbeAudio, setup;

class ReferenceEngine extends FakeRealtime {
  bool missing = false;
  final comparison = <String, dynamic>{
    'case': {
      'id': 'a' * 64,
      'title': 'Hapa 对照',
      'fromTitle': 'House Loop 2',
      'toTitle': 'Electro House vol 1',
      'bpm': 124,
      'duration': 8.0,
      'sources': {
        'a': {'sourceStart': 12},
        'b': {'sourceStart': 24, 'sourceBpm': 128}
      }
    },
    'variant': 'original',
    'playing': false,
    'busy': false,
    'coverage': {
      'original': {'seconds': 0.0, 'fraction': 0.0, 'intervals': []},
      'reference': {'seconds': 0.0, 'fraction': 0.0, 'intervals': []}
    }
  };
  @override
  Future<Map<String, dynamic>> command(String method,
      [Map<String, dynamic> args = const {}]) async {
    calls.add(method);
    if (method == 'prepare' && missing) throw StateError('DJ 对照素材尚未就绪');
    return {
      'ok': true,
      'state': {
        'djReference': comparison,
        'metric': {'djReference': true}
      }
    };
  }
}

void main() {
  testWidgets(
      'can save an unheard preference and return without adopting the reference in normal playback',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    final engine = ReferenceEngine();
    late AppController c;
    await tester.runAsync(() async {
      c = await setup(engine, ProbeAudio());
    });
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: Builder(
                builder: (context) => TextButton(
                    onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute(
                            builder: (_) => DjReferenceScreen(c))),
                    child: const Text('Open'))))));
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('参考交接更顺'), 200,
        scrollable: find.byType(Scrollable).first);
    await tester.ensureVisible(find.text('参考交接更顺'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('参考交接更顺'));
    await tester.pumpAndSettle();
    final record = await DjReferenceFeedbackStore().read('a' * 64);
    expect(record!['preference'], 'reference');
    expect((record['coverage'] as Map)['reference']['seconds'], 0);
    await tester.scrollUntilVisible(find.text('返回普通播放'), 200,
        scrollable: find.byType(Scrollable).first);
    await tester.ensureVisible(find.text('返回普通播放'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('返回普通播放'));
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));
    await tester.pumpAndSettle();
    expect(engine.calls, contains('djClose'));
    expect(engine.calls, contains('djSnapshot'));
    expect(c.v3Active, false);
    expect(find.text('Open'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
  testWidgets(
      'missing bundled case shows retry and leaves normal playback reachable',
      (tester) async {
    final engine = ReferenceEngine()..missing = true;
    late AppController c;
    await tester.runAsync(() async {
      c = await setup(engine, ProbeAudio());
    });
    await tester.pumpWidget(MaterialApp(home: DjReferenceScreen(c)));
    await tester.pumpAndSettle();
    expect(find.textContaining('尚未就绪'), findsOneWidget);
    expect(find.text('重试读取素材'), findsOneWidget);
    expect(find.text('返回普通播放'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();
    c.dispose();
  });
}
