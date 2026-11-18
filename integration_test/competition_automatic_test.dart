import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path_provider/path_provider.dart';
import 'package:harbeat/src/realtime_engine.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('automatic competition retains A then schedules and completes a creative native handoff', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: Text('HarBeat 自动接歌竞争实机验证'))));
    final engine=PlatformRealtimeEngine();Map<String,dynamic> state={};final steps=<Map<String,dynamic>>[];
    var observing=false,buffered=false;
    final sub=engine.states.listen((s){state=s;if(observing&&s['buffering']==true)buffered=true;});
    Future<void> save() async {final dir=await getExternalStorageDirectory();await File('${dir!.path}/competition-automatic-acceptance.json').writeAsString(jsonEncode({'steps':steps,'state':state,'buffered':buffered}));}
    Future<void> command(String name,[Map<String,dynamic> args=const {}]) async {
      final reply=await engine.command(name,args).timeout(const Duration(seconds:180));if(reply['state'] is Map)state=Map<String,dynamic>.from(reply['state']);expect(reply['ok'],isNot(false));
      // ignore: avoid_print
      print('COMPETITION_AUTO $name ${state['position']} ${state['metric']?['method']} ${state['metric']?['phase']}');
    }
    Future<void> until(bool Function() done,{int seconds=140}) async {final end=DateTime.now().add(Duration(seconds:seconds));while(!done()){if(DateTime.now().isAfter(end)){await save();fail('Automatic timeout ${jsonEncode(state)}');}await Future<void>.delayed(const Duration(milliseconds:150));}}
    try {
      await command('prepare',{'mode':'metric'});await command('direction',{'automatic':false,'style':'','energy':3});
      await command('start',{'trackId':'track-94581d46f6ff78ba74a0'});await command('pause');await command('seek',{'position':160.0});
      await command('select',{'trackId':'track-f83cf73c441f8e96e0d5'});await command('direction',{'automatic':true});
      await until(()=>state['metric']?['phase']=='ready');expect(state['metric']?['method'],isNot('original'));
      final cue=state['metric']['recommendation']['cue'] as Map;expect(cue['start'],greaterThanOrEqualTo((state['duration'] as num)*.5));
      steps.add({'stage':'prepared','state':state});await save();observing=true;await command('resume');
      await until(()=>state['pending']!=null&&state['metric']?['strategyComparison']?['state']=='armed',seconds:90);expect(state['metric']?['method'],'vinyl-brake');
      steps.add({'stage':'automatic-armed','state':state});await save();
      await until(()=>state['current']?['id']=='track-f83cf73c441f8e96e0d5',seconds:90);final body=(state['position'] as num).toDouble();await Future<void>.delayed(const Duration(seconds:4));observing=false;
      expect(buffered,false);expect(state['playing'],true);expect((state['position'] as num).toDouble(),greaterThan(body+3));
      expect((state['observations'] as List).any((o)=>o['name']=='手机退出效果开始 / vinyl-brake'),true);
      steps.add({'stage':'automatic-handoff','state':state});await command('pause');await command('experimentalTransitions',{'enabled':false});
      final comparison=state['metric']['strategyComparison'] as Map;expect(comparison['experimental'],false);
      for(final method in ['vinyl-brake','backspin-echo','loop-roll','reverb-out']){expect(comparison['methods'][method]['eligible'],false);expect(comparison['methods'][method]['reason'],'实验手法已关闭');}
      steps.add({'stage':'experimental-disabled','state':state});await command('export',{'format':'json'});await save();await Future<void>.delayed(const Duration(seconds:2));
      // ignore: avoid_print
      print('COMPETITION_AUTO_PASS');
    } finally {await save();try{await engine.command('stop');}catch(_){}await sub.cancel();await engine.dispose();}
  },timeout:const Timeout(Duration(minutes:8)));
}
