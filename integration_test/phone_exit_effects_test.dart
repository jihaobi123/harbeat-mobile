import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path_provider/path_provider.dart';
import 'package:harbeat/src/realtime_engine.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('phone exit effects compete and execute on real Android audio', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: Text('HarBeat 手机退出效果实机验证'))));
    final engine=PlatformRealtimeEngine();
    Map<String,dynamic> state={};final steps=<Map<String,dynamic>>[];
    var executing=false,buffered=false;
    final sub=engine.states.listen((s){state=s;if(executing&&s['buffering']==true)buffered=true;});
    Future<void> save() async {final dir=await getExternalStorageDirectory();await File('${dir!.path}/phone-exit-effects-acceptance.json').writeAsString(jsonEncode({'steps':steps,'state':state,'executionBuffered':buffered}));}
    Future<void> command(String name,[Map<String,dynamic> args=const {}]) async {
      final reply=await engine.command(name,args).timeout(const Duration(seconds:180));
      if(reply['state'] is Map)state=Map<String,dynamic>.from(reply['state']);
      expect(reply['ok'],isNot(false),reason:'$name: $reply');
      // ignore: avoid_print
      print('PHONE_FX $name ${state['current']?['title']} ${state['position']} ${state['metric']?['method']} ${state['metric']?['strategyComparison']?['state']}');
    }
    Future<void> until(bool Function() predicate,{int seconds=150}) async {
      final end=DateTime.now().add(Duration(seconds:seconds));
      while(!predicate()){if(state['metric']?['phase']=='failed'){await save();fail('Preparation failed ${jsonEncode(state)}');}if(DateTime.now().isAfter(end)){await save();fail('Timeout ${jsonEncode(state)}');}await Future<void>.delayed(const Duration(milliseconds:150));}
    }
    Future<void> pair(String a,String b,double position,{bool experiments=true,bool lifecycle=false,String? expected}) async {
      await command('stop');await command('direction',{'automatic':false,'style':'','energy':3});
      await command('start',{'trackId':a});await command('pause');await command('seek',{'position':position});
      await command('experimentalTransitions',{'enabled':experiments});await command('select',{'trackId':b});
      await until(()=>state['metric']?['phase']=='ready');
      if(expected!=null)expect(state['metric']?['method'],expected);
      final comparison=state['metric']?['strategyComparison'] as Map;expect(comparison['policy'],'musical-transition-competition-v1');
      expect((comparison['methods'] as Map).length,16);
      steps.add({'stage':'prepared','state':state});await save();
      await command('resume');await command('mixSoon');await until(()=>state['pending']!=null);
      final method=state['metric']?['method'];if(method=='original')expect(state['metric']?['strategyComparison']?['fallback'],true);
      if(expected!=null){expect(method,expected);expect(state['metric']?['strategyComparison']?['state'],'armed');}
      steps.add({'stage':'armed','state':state});await save();
      if(lifecycle){
        await command('pause');final frozen=(state['position'] as num).toDouble();await Future<void>.delayed(const Duration(milliseconds:700));
        expect((state['position'] as num).toDouble(),closeTo(frozen,.04));await command('resume');await command('cancel');
        expect(state['pending'],isNull);expect(state['current']?['id'],a);steps.add({'stage':'cancel-keeps-a','state':state});
        await command('select',{'trackId':b});await until(()=>state['metric']?['phase']=='ready');await command('mixSoon');await until(()=>state['pending']!=null);
      }
      executing=true;buffered=false;await until(()=>state['current']?['id']==b,seconds:100);final body=(state['position'] as num).toDouble();await Future<void>.delayed(const Duration(seconds:4));executing=false;
      expect(buffered,false);expect(state['playing'],true);expect((state['position'] as num).toDouble(),greaterThan(body+3));
      if(expected!=null)expect((state['observations'] as List).any((o)=>o['name']=='手机退出效果开始 / $expected'),true);
      if(expected=='drum-first')expect((state['observations'] as List).any((o)=>o['name']=='本机鼓先行开始'),true);
      if(expected=='loop-ramp')expect((state['observations'] as List).any((o)=>o['name']=='旧歌退出 / 鼓桥起播'),true);
      steps.add({'stage':'handoff','state':state});await command('pause');await command('export',{'format':'json'});await save();await Future<void>.delayed(const Duration(seconds:2));
    }
    try {
      await command('prepare',{'mode':'metric'});
      await pair('track-94581d46f6ff78ba74a0','track-f83cf73c441f8e96e0d5',35.68,expected:'vinyl-brake',lifecycle:true);
      await pair('track-f2c81091b622e28460c2','track-7eaf9606b3750a25d988',19.64,expected:'loop-roll');
      await pair('track-15c1caf2a335f253d4f2','track-1db1ea0d2d0ae13359d1',20.9,expected:'reverb-out');
      await pair('track-bcfc85b58537479bca2e','track-40d32a4aaedd94ed6ee0',147.82,expected:'backspin-echo');
      // ignore: avoid_print
      print('PHONE_FX_DEVICE_PASS');
    } catch(e) {
      // ignore: avoid_print
      print('PHONE_FX_DEVICE_ERROR $e');rethrow;
    } finally {await save();try{await engine.command('stop');}catch(_){}await sub.cancel();await engine.dispose();}
  },timeout:const Timeout(Duration(minutes:18)));
}
