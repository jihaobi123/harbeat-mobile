// Real APK bridge acceptance; update the same nativeqa package without clearing data.
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path_provider/path_provider.dart';
import 'package:harbeat/src/realtime_engine.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('native-tempo crossgenre, cancellation, pause and original gradual path', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: Text('HarBeat 跨风格实机验证'))));
    final engine=PlatformRealtimeEngine();
    Map<String,dynamic> state={};final steps=<Map<String,dynamic>>[];
    var executing=false,buffered=false;
    final sub=engine.states.listen((s){state=s;if(executing&&s['buffering']==true)buffered=true;});
    Future<void> save() async {final dir=await getExternalStorageDirectory();await File('${dir!.path}/crossgenre-acceptance.json').writeAsString(jsonEncode({'steps':steps,'state':state,'executionBuffered':buffered}));}
    Future<void> command(String name,[Map<String,dynamic> args=const {}]) async {
      final reply=await engine.command(name,args).timeout(const Duration(seconds:180));
      if(reply['state'] is Map)state=Map<String,dynamic>.from(reply['state']);
      expect(reply['ok'],isNot(false),reason:'$name: $reply');
      // ignore: avoid_print
      print('CROSSGENRE_QA $name ${state['current']?['title']} ${state['position']} ${state['metric']?['phase']} ${state['metric']?['method']} ${state['error']}');
    }
    Future<void> until(bool Function() predicate,{int seconds=180}) async {
      final end=DateTime.now().add(Duration(seconds:seconds));
      while(!predicate()){if(state['metric']?['phase']=='failed'){await save();fail('Preparation failed: ${jsonEncode(state)}');}if(DateTime.now().isAfter(end)){await save();fail('Timeout ${jsonEncode(state)}');}await Future<void>.delayed(const Duration(milliseconds:150));}
    }
    Future<void> pair(String a,String b,double position,String method,{bool lifecycle=false}) async {
      await command('stop');await command('direction',{'automatic':false,'style':'','energy':3});
      await command('start',{'trackId':a});await command('pause');await command('seek',{'position':position});await command('select',{'trackId':b});
      await until(()=>state['metric']?['phase']=='ready');
      expect(state['metric']?['method'],method);steps.add({'stage':'prepared','method':method,'state':state});await save();
      await command('resume');await command('mixSoon');await until(()=>state['pending']!=null);
      steps.add({'stage':'armed','method':method,'state':state});await save();
      if(lifecycle){
        await command('pause');final frozen=(state['position'] as num).toDouble();await Future<void>.delayed(const Duration(milliseconds:700));
        expect((state['position'] as num).toDouble(),closeTo(frozen,.04));expect(state['pending'],isNotNull);
        await command('resume');await command('cancel');expect(state['current']?['id'],a);expect(state['pending'],isNull);
        final before=(state['position'] as num).toDouble();await Future<void>.delayed(const Duration(milliseconds:800));expect((state['position'] as num).toDouble(),greaterThan(before+.5));
        steps.add({'stage':'cancel-keeps-a','state':state});await command('select',{'trackId':b});await until(()=>state['metric']?['phase']=='ready');await command('mixSoon');
      }
      executing=true;buffered=false;await until(()=>state['current']?['id']==b,seconds:100);await Future<void>.delayed(const Duration(seconds:5));executing=false;
      expect(state['playing'],true);expect(state['buffering'],false);expect(buffered,false);expect(state['current']?['id'],b);
      steps.add({'stage':'handoff','method':method,'state':state});await command('export',{'format':'json'});await save();
    }
    try{
      await command('prepare',{'mode':'metric'});expect(state['metric']?['release']?['crossGenrePolicy'],'crossgenre-structural-v1');
      await pair('track-778955521e34b542bb1f','track-6ac3f8303bcf91194b8b',23.759,'structural-cut',lifecycle:true);
      await pair('track-7c2bf679f8b535d46e5c','track-6697a1fda1c7949c0051',5.0,'echo-out');
      await pair('track-15c1caf2a335f253d4f2','track-76918c53c3df889caccc',20.9,'original');
      await command('stop');await command('direction',{'automatic':false,'style':''});
      await command('start',{'trackId':'track-778955521e34b542bb1f'});await command('pause');await command('seek',{'position':23.759});await command('select',{'trackId':'track-6ac3f8303bcf91194b8b'});
      await until(()=>state['metric']?['phase']=='ready');expect(state['metric']?['recommendation']?['cue']?['end'],lessThan(60));
      await command('direction',{'automatic':true});
      await until(()=>state['metric']?['phase']=='ready'&&((state['metric']?['recommendation']?['cue']?['end'] as num?)?.toDouble()??0)>=62.5);
      final automaticExit=(state['metric']['recommendation']['cue']['end'] as num).toDouble();
      steps.add({'stage':'manual-to-automatic-retention','state':state});await save();
      await command('seek',{'position':automaticExit-15});await until(()=>state['metric']?['phase']=='ready');
      await command('resume');executing=true;buffered=false;await until(()=>state['pending']!=null,seconds:40);
      steps.add({'stage':'automatic-armed','state':state});await until(()=>state['current']?['id']=='track-6ac3f8303bcf91194b8b',seconds:40);
      await Future<void>.delayed(const Duration(seconds:5));executing=false;expect(buffered,false);expect(state['playing'],true);
      steps.add({'stage':'automatic-handoff','state':state});await command('export',{'format':'json'});await save();
      // ignore: avoid_print
      print('CROSSGENRE_DEVICE_PASS');
    }finally{await save();await command('stop');await sub.cancel();await engine.dispose();}
  },timeout:const Timeout(Duration(minutes:18)));
}
