import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path_provider/path_provider.dart';
import 'package:harbeat/src/realtime_engine.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('actual Listen entry executes an evidence selected stem method', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: Text('HarBeat 自适应分轨实机验证'))));
    final engine=PlatformRealtimeEngine();
    Map<String,dynamic> state={};final steps=<Map<String,dynamic>>[];
    var executing=false,buffered=false;
    final sub=engine.states.listen((s){state=s;if(executing&&s['buffering']==true)buffered=true;});
    Future<void> save() async {final dir=await getExternalStorageDirectory();await File('${dir!.path}/adaptive-mix-acceptance.json').writeAsString(jsonEncode({'steps':steps,'state':state,'executionBuffered':buffered}));}
    Future<void> command(String name,[Map<String,dynamic> args=const {}]) async {
      final reply=await engine.command(name,args).timeout(const Duration(seconds:180));
      if(reply['state'] is Map)state=Map<String,dynamic>.from(reply['state']);
      expect(reply['ok'],isNot(false),reason:'$name: $reply');
      // ignore: avoid_print
      print('ADAPTIVE_QA $name ${state['position']} ${state['metric']?['method']} ${state['metric']?['strategyComparison']?['state']}');
    }
    Future<void> until(bool Function() predicate,{int seconds=120}) async {
      final end=DateTime.now().add(Duration(seconds:seconds));
      while(!predicate()){if(DateTime.now().isAfter(end)){await save();fail('Timeout ${jsonEncode(state)}');}await Future<void>.delayed(const Duration(milliseconds:200));}
    }
    try {
      await command('prepare',{'mode':'metric'});await command('direction',{'automatic':false,'style':'','energy':3});
      await command('start',{'trackId':'track-d2d58531421de0eb9690'});await command('pause');await command('seek',{'position':25.0});
      await command('select',{'trackId':'track-831997216a86a4914ef9'});
      await until(()=>state['metric']?['strategyComparison']?['state']=='ready');
      final method=state['metric']?['method'];expect(method,isNot('original'));
      steps.add({'stage':'analysis-ready','state':state});await save();
      await command('resume');await command('mixSoon');await until(()=>state['pending']!=null);
      expect(state['metric']?['method'],method);steps.add({'stage':'armed','state':state});await save();
      await command('pause');final frozen=(state['position'] as num).toDouble();await Future<void>.delayed(const Duration(milliseconds:750));
      expect((state['position'] as num).toDouble(),closeTo(frozen,.04));await command('resume');
      executing=true;await until(()=>state['current']?['id']=='track-831997216a86a4914ef9',seconds:75);
      final body=(state['position'] as num).toDouble();await Future<void>.delayed(const Duration(seconds:5));executing=false;expect(buffered,false);expect(state['playing'],true);
      expect((state['position'] as num).toDouble(),greaterThan(body+4));
      final observations=state['observations'] as List;
      expect(observations.any((o)=>o['name']=='本机分轨交接开始'),true);
      expect(observations.any((o)=>o['name']=='B 原速正文接管'),true);
      steps.add({'stage':'handoff','state':state});await command('pause');await command('export',{'format':'json'});await save();await Future<void>.delayed(const Duration(seconds:2));
      // ignore: avoid_print
      print('ADAPTIVE_DEVICE_PASS method=$method');
    } finally {await save();await command('stop');await sub.cancel();await engine.dispose();}
  },timeout:const Timeout(Duration(minutes:8)));
}
