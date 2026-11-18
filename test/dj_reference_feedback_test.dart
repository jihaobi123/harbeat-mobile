import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:harbeat/src/dj_reference_feedback.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
      'preference can be saved before playback and remains bound to case and observed coverage',
      () async {
    SharedPreferences.setMockInitialValues({});
    final store = DjReferenceFeedbackStore();
    final id = 'a' * 64;
    await store.save(
        caseId: id,
        preference: 'reference',
        variant: 'original',
        coverage: {
          'original': {'seconds': 0.0, 'fraction': 0.0, 'intervals': []},
          'reference': {'seconds': 0.0, 'fraction': 0.0, 'intervals': []}
        });
    final record = await DjReferenceFeedbackStore().read(id);
    expect(record!['preference'], 'reference');
    expect(record['variant'], 'original');
    expect((record['coverage'] as Map)['original']['seconds'], 0);
    expect(await store.read('b' * 64), isNull);
  });
}
