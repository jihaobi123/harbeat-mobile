import 'package:flutter/material.dart';
import 'package:just_audio_background/just_audio_background.dart';

import 'src/app.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await JustAudioBackground.init(
    androidNotificationChannelId: 'com.harbeat.audio',
    androidNotificationChannelName: 'HarBeat 播放',
    androidNotificationOngoing: true,
  );
  runApp(const HarBeatApp());
}
