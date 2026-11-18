import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/backend.dart';
import 'package:harbeat/src/cloud_endpoints.dart';
import 'package:harbeat/src/activity_repository.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:harbeat/src/nas_repository.dart';
import 'package:harbeat/src/dance_repository.dart';
import 'package:harbeat/src/realtime_engine.dart';

const expectedCloud = String.fromEnvironment('HARBEAT_BASE_URL',
    defaultValue: String.fromEnvironment('HARBEAT_API_BASE_URL',
        defaultValue: 'https://47.108.118.177'));
const expectedMedia =
    String.fromEnvironment('HARBEAT_NAS_BASE_URL', defaultValue: expectedCloud);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('candidate defaults use the new HTTPS origin without an API suffix', () {
    expect(BackendConfig.defaultAddress, expectedCloud);
    final nas = NasCatalogRepository(), dance = DanceRepository();
    final activity = ActivityRepository();
    addTearDown(activity.dispose);
    expect(activity.baseUri.origin, expectedCloud);
    addTearDown(nas.close);
    addTearDown(dance.close);
    expect(nas.baseUri.origin, expectedMedia);
    expect(dance.baseUri.origin, nas.baseUri.origin);
    expect(
        BackendConfig(BackendConfig.defaultAddress)
            .endpoint('/api/auth/login')
            .path,
        '/api/auth/login');
    expect(BackendConfig('https://custom.example:8443').baseUri.toString(),
        'https://custom.example:8443');
  });
  test('private reservation storage is isolated from custom origins', () async {
    FlutterSecureStorage.setMockInitialValues(
        {'harbeat_activity_workspace_v1': 'old-private'});
    final customRepo =
        ActivityRepository(baseUri: Uri.parse('https://custom.example'));
    addTearDown(customRepo.dispose);
    final custom = customRepo.credentials;
    final cloudRepo =
        ActivityRepository(baseUri: Uri.parse(CloudEndpoints.newOrigin));
    addTearDown(cloudRepo.dispose);
    final cloud = cloudRepo.credentials;
    expect(await custom.read(), isNull);
    expect(await cloud.read(), 'old-private');
    await custom.write('custom-private');
    await cloud.write('new-private');
    expect(await custom.read(), 'custom-private');
    expect(await cloud.read(), 'new-private');
    final oldRepo =
        ActivityRepository(baseUri: Uri.parse('https://8.136.120.255'));
    addTearDown(oldRepo.dispose);
    expect(await oldRepo.credentials.read(), 'old-private');
  });
  test('root configuration rejects API suffixes and credential-bearing URLs',
      () {
    for (final address in [
      'https://example.com/api',
      'https://user:pass@example.com',
      'https://example.com?q=1',
      'https://example.com#x',
      'http://example.com'
    ]) {
      expect(() => CloudEndpoints.root(address), throwsFormatException);
    }
    expect(CloudEndpoints.root('http://127.0.0.1:8766/').origin,
        'http://127.0.0.1:8766');
  });
  test(
      'legacy reservation origin mapping is exact and cannot carry signed URLs',
      () {
    final target = Uri.parse(CloudEndpoints.newOrigin);
    for (final origin in ['http://8.136.120.255', 'https://8.136.120.255/']) {
      expect(CloudEndpoints.acceptsReservationBackup(origin, target), isTrue);
    }
    for (final origin in [
      'https://8.136.120.255:444',
      'https://8.136.120.255/api',
      'https://8.136.120.255?sig=private',
      'https://evil.test',
      'https://8.136.120.255.evil.test'
    ]) {
      expect(CloudEndpoints.acceptsReservationBackup(origin, target), isFalse);
    }
  });
  test('native preparation receives the same cloud origin as the NAS client',
      () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    const channel = MethodChannel('harbeat/realtime');
    MethodCall? captured;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      captured = call;
      return <String, dynamic>{};
    });
    addTearDown(() => TestDefaultBinaryMessengerBinding
        .instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null));
    await PlatformRealtimeEngine().command('prepare', {'mode': 'metric'});
    expect(captured!.arguments['args']['publicOrigin'], expectedMedia);
  });
}
