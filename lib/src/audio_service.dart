import 'dart:async';

import 'package:audio_service/audio_service.dart';
import 'package:audio_session/audio_session.dart';
import 'package:just_audio/just_audio.dart';
import 'mix_planner.dart';

abstract interface class MixingAudioService implements AudioService {
  /// Downloads/opens B before asking for a plan against the live audio clock.
  Future<bool> mixTo(
      {String? filePath,
      required String title,
      Map<String, String>? headers,
      required MixPlan Function(
              Duration position, Duration length, Duration nextLength)
          plan});
  void cancelMix();
}

abstract interface class AudioService {
  Future<void> initialize();
  Future<void> play(
      {String? filePath,
      String title = 'HarBeat Preview',
      Map<String, String>? headers});
  Future<void> pause();
  Future<void> resume();
  Future<void> stop();
  Future<void> seek(Duration position);
  Future<void> setLoop(bool enabled);
  Future<void> setShuffle(bool enabled);
  Future<void> setLoopRegion(Duration? end);
  Stream<Duration> get position;
  Stream<Duration> get duration;
  Stream<void> get completed;
  Stream<String> get events;
  Future<void> dispose();
}

class PreviewAudioService implements AudioService {
  final AudioPlayer _player = AudioPlayer();
  final StreamController<void> _completed = StreamController.broadcast();
  final StreamController<String> _events = StreamController.broadcast();
  bool _resumeAfterInterruption = false;
  StreamSubscription<AudioInterruptionEvent>? _interruptionSub;
  StreamSubscription<void>? _noisySub;
  StreamSubscription<PlayerState>? _stateSub;

  @override
  Future<void> initialize() async {
    final session = await AudioSession.instance;
    await session.configure(const AudioSessionConfiguration.music());
    _interruptionSub = session.interruptionEventStream.listen((event) async {
      if (event.begin) {
        _resumeAfterInterruption = _player.playing;
        if (event.type == AudioInterruptionType.duck) {
          await _player.setVolume(.35);
          _events.add('ducked');
        } else {
          await _player.pause();
          _events.add('interrupted');
        }
      } else if (event.type == AudioInterruptionType.duck) {
        await _player.setVolume(1);
        _events.add('unducked');
      } else if (_resumeAfterInterruption &&
          event.type == AudioInterruptionType.pause) {
        _startPlayback();
        _events.add('resumed_after_interruption');
      }
    });
    _noisySub = session.becomingNoisyEventStream.listen((_) async {
      await _player.pause();
      _resumeAfterInterruption = false;
      _events.add('headphones_disconnected');
    });
    _stateSub = _player.playerStateStream.listen((state) {
      if (state.processingState == ProcessingState.completed) {
        _completed.add(null);
      }
    });
  }

  @override
  Future<void> play(
      {String? filePath,
      String title = 'HarBeat Preview',
      Map<String, String>? headers}) async {
    final source = filePath == null
        ? AudioSource.asset('assets/audio/preview.wav',
            tag: MediaItem(id: 'preview', title: title, album: 'HarBeat'))
        : filePath.startsWith('asset:')
            ? AudioSource.asset(filePath.substring(6),
                tag: MediaItem(id: filePath, title: title, album: 'HarBeat'))
            : ['blob:', 'data:', 'https:', 'http:'].any(filePath.startsWith)
                ? AudioSource.uri(Uri.parse(filePath),
                    headers: headers,
                    tag: MediaItem(
                        id: Uri.parse(filePath)
                            .replace(query: '', fragment: '')
                            .toString(),
                        title: title,
                        album: 'HarBeat'))
                : AudioSource.file(filePath,
                    tag: MediaItem(
                        id: filePath, title: title, album: 'HarBeat'));
    await _player.setAudioSource(source);
    _startPlayback();
  }

  void _startPlayback() {
    // just_audio's play future completes when playback stops, not when it starts.
    unawaited(_player.play().catchError((Object error) {
      if (!_events.isClosed) _events.add('playback_error');
    }));
  }

  @override
  Future<void> pause() => _player.pause();
  @override
  Future<void> resume() async => _startPlayback();
  @override
  Future<void> stop() => _player.stop();
  @override
  Future<void> seek(Duration position) => _player.seek(position);
  @override
  Future<void> setLoop(bool enabled) =>
      _player.setLoopMode(enabled ? LoopMode.one : LoopMode.off);
  @override
  Future<void> setShuffle(bool enabled) =>
      _player.setShuffleModeEnabled(enabled);
  @override
  Future<void> setLoopRegion(Duration? end) async {
    await _player.setClip(start: Duration.zero, end: end);
    await _player.setLoopMode(end == null ? LoopMode.off : LoopMode.one);
  }

  @override
  Stream<Duration> get position => _player.positionStream;
  @override
  Stream<Duration> get duration => _player.durationStream
      .where((value) => value != null)
      .map((value) => value!);
  @override
  Stream<void> get completed => _completed.stream;
  @override
  Stream<String> get events => _events.stream;

  @override
  Future<void> dispose() async {
    await _interruptionSub?.cancel();
    await _noisySub?.cancel();
    await _stateSub?.cancel();
    await _completed.close();
    await _events.close();
    await _player.dispose();
  }
}

class MemoryAudioService implements AudioService {
  @override
  Stream<Duration> get position => const Stream.empty();
  @override
  Stream<Duration> get duration => const Stream.empty();
  @override
  Stream<void> get completed => const Stream.empty();
  @override
  Stream<String> get events => const Stream.empty();
  @override
  Future<void> initialize() async {}
  @override
  Future<void> play(
      {String? filePath,
      String title = 'HarBeat Preview',
      Map<String, String>? headers}) async {}
  @override
  Future<void> pause() async {}
  @override
  Future<void> resume() async {}
  @override
  Future<void> stop() async {}
  @override
  Future<void> seek(Duration position) async {}
  @override
  Future<void> setLoop(bool enabled) async {}
  @override
  Future<void> setShuffle(bool enabled) async {}
  @override
  Future<void> setLoopRegion(Duration? end) async {}
  @override
  Future<void> dispose() async {}
}
