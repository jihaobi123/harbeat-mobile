// Exercise the real cloud approval and device graph; restore the regular GUI APK afterwards.
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path_provider/path_provider.dart';
import 'package:harbeat/src/realtime_engine.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('automatic approval reaches overlapping device mix and B body', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: Text('HarBeat 自动混音实机检查'))));
    final engine = PlatformRealtimeEngine();
    Map<String,dynamic> state = {};
    final observations = <Map<String,dynamic>>[];
    final sub = engine.states.listen((s) { state=s; });
    Future<void> command(String name,[Map<String,dynamic> args=const {}]) async {
      // ignore: avoid_print
      print('AUTOMATIC_MIX_COMMAND $name');
      final r=await engine.command(name,args).timeout(const Duration(seconds:60));
      if(r['state'] is Map) state=Map<String,dynamic>.from(r['state'] as Map);
      // ignore: avoid_print
      print('AUTOMATIC_MIX_REPLY $name ${state['metric']?['phase']} ${state['position']}');
    }
    Future<void> until(bool Function() done,{int seconds=180}) async {
      final end=DateTime.now().add(Duration(seconds:seconds));
      while(!done()) {
        if(DateTime.now().isAfter(end)) fail('Automatic mix timeout: ${jsonEncode(state)}');
        await Future<void>.delayed(const Duration(milliseconds:200));
      }
    }
    try {
      await command('prepare',{'mode':'metric'});
      await command('direction',{'automatic':false,'style':'','energy':3});
      const a='track-279ccdf918bb538eedf1', b='track-081af87cba3d1f0cb5f8';
      await command('start',{'trackId':a});
      await command('select',{'trackId':b});
      await command('direction',{'automatic':true});
      await until(() => (state['metric'] as Map?)?['phase']=='ready' || (state['metric'] as Map?)?['phase']=='armed');
      observations.add({'stage':'prepared','state':state});
      expect(state['current']['id'],a);
      await until(() => state['current']?['id']==b);
      observations.add({'stage':'takeover','state':state});
      await Future<void>.delayed(const Duration(seconds:5));
      expect(state['playing'],true);
      expect(state['buffering'],false);
      expect(state['current']['id'],b);
      await command('export',{'format':'json'});
      final dir=await getExternalStorageDirectory();
      await File('${dir!.path}/automatic-mix-acceptance.json').writeAsString(jsonEncode({'observations':observations,'finalState':state}));
      // ignore: avoid_print
      print('AUTOMATIC_MIX_DEVICE_PASS ${jsonEncode({'from':a,'to':b,'position':state['position']})}');
    } finally {
      await command('stop');
      await sub.cancel();
      await engine.dispose();
    }
  }, timeout: const Timeout(Duration(minutes:6)));
}
