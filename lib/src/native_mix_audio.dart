import 'dart:async';
import 'dart:io';
import 'package:audio_service/audio_service.dart' as background;
import 'package:audio_session/audio_session.dart';
import 'package:flutter_soloud/flutter_soloud.dart' as sl;
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:just_audio/just_audio.dart' as ja;
import 'audio_service.dart';
import 'mix_planner.dart';

class _Deck {
  _Deck(this.source, this.title, this.temporary);
  final sl.AudioSource source;
  final String title;
  final File? temporary;
  sl.SoundHandle? handle;
}

/// Two native voices share SoLoud's sample clock. Dart only polls UI state;
/// scheduled starts and gain envelopes execute in the C++ audio callback.
class NativeMixAudio implements MixingAudioService {
  final sl.SoLoud _engine = sl.SoLoud.instance;
  final _positions = StreamController<Duration>.broadcast();
  final _durations = StreamController<Duration>.broadcast();
  final _completions = StreamController<void>.broadcast();
  final _events = StreamController<String>.broadcast();
  final List<StreamSubscription<dynamic>> _subscriptions = [];
  AudioSession? _session;
  _MediaHandler? _handler;
  _Deck? _current, _incoming;
  ja.AudioPlayer? _fallback;
  final Set<Future<void>> _retirements = {};
  Completer<bool>? _mixDone;
  Duration? _mixEnd;
  Timer? _poll;
  bool _playing = false, _disposed = false, _resumeAfterInterruption = false;
  bool _loop = false;
  int _generation = 0;
  static const double gain = .74; // vocal-v4 render headroom

  @override
  Future<void> initialize() async {
    await _engine.init(sampleRate: 44100, bufferSize: 1024);
    _handler = await background.AudioService.init<_MediaHandler>(
        builder: () => _MediaHandler(this),
        config: const background.AudioServiceConfig(
            androidNotificationChannelId: 'com.harbeat.audio',
            androidNotificationChannelName: 'HarBeat 播放',
            androidNotificationOngoing: true));
    _session = await AudioSession.instance;
    await _session!.configure(const AudioSessionConfiguration.music());
    _subscriptions.add(_session!.interruptionEventStream.listen((event) async {
      if (event.begin) {
        _resumeAfterInterruption = _playing;
        if (event.type == AudioInterruptionType.duck) {
          _engine.setGlobalVolume(.35);
          _events.add('ducked');
        } else {
          await pause();
          _events.add('interrupted');
        }
      } else if (event.type == AudioInterruptionType.duck) {
        _engine.setGlobalVolume(1);
      } else if (_resumeAfterInterruption &&
          event.type == AudioInterruptionType.pause) {
        await resume();
        _events.add('resumed_after_interruption');
      }
    }));
    _subscriptions.add(_session!.becomingNoisyEventStream.listen((_) async {
      _resumeAfterInterruption = false;
      await pause();
      _events.add('headphones_disconnected');
    }));
    _poll = Timer.periodic(const Duration(milliseconds: 80), (_) => _tick());
  }

  bool _valid(_Deck? deck) =>
      _engine.isInitialized &&
      deck?.handle != null &&
      _engine.getIsValidVoiceHandle(deck!.handle!);
  Duration get currentPosition =>
      _fallback?.position ??
      (_valid(_current)
          ? _engine.getPosition(_current!.handle!)
          : Duration.zero);

  Future<_Deck> _open(
      String? path, String title, Map<String, String>? headers) async {
    File? temporary;
    try {
      sl.AudioSource source;
      if (path == null) {
        source = await _engine.loadAsset('assets/audio/preview.wav',
            mode: sl.LoadMode.disk);
      } else if (path.startsWith('asset:')) {
        source =
            await _engine.loadAsset(path.substring(6), mode: sl.LoadMode.disk);
      } else if (path.startsWith('http://') || path.startsWith('https://')) {
        final folder = await getTemporaryDirectory();
        temporary = File(
            '${folder.path}/hb-mix-${DateTime.now().microsecondsSinceEpoch}.audio');
        final client = http.Client();
        IOSink? sink;
        try {
          final request = http.Request('GET', Uri.parse(path))
            ..followRedirects = false;
          request.headers.addAll(headers ?? {});
          final response =
              await client.send(request).timeout(const Duration(seconds: 20));
          if (response.statusCode != 200) throw StateError('音频下载失败');
          if ((response.contentLength ?? 0) > 200 * 1024 * 1024) {
            throw StateError('音频过大');
          }
          sink = temporary.openWrite();
          var received = 0;
          await for (final chunk
              in response.stream.timeout(const Duration(seconds: 30))) {
            if (_disposed) throw StateError('播放器已关闭');
            received += chunk.length;
            if (received > 200 * 1024 * 1024) throw StateError('音频过大');
            sink.add(chunk);
          }
          if (received == 0) throw StateError('音频为空');
          await sink.flush();
        } finally {
          await sink?.close();
          client.close();
        }
        source = await _engine.loadFile(temporary.path, mode: sl.LoadMode.disk);
      } else {
        source = await _engine.loadFile(path, mode: sl.LoadMode.disk);
      }
      return _Deck(source, title, temporary);
    } catch (_) {
      if (temporary != null && await temporary.exists()) {
        await temporary.delete();
      }
      rethrow;
    }
  }

  Future<void> _release(_Deck? deck) async {
    if (deck == null) return;
    if (_valid(deck)) await _engine.stop(deck.handle!);
    // The engine deduplicates sources (e.g. the same preview asset on A/B).
    if (_engine.isInitialized &&
        deck.source.soundHash != _current?.source.soundHash &&
        deck.source.soundHash != _incoming?.source.soundHash) {
      await _engine.disposeSource(deck.source);
    }
    if (deck.temporary != null && await deck.temporary!.exists()) {
      await deck.temporary!.delete();
    }
  }

  void _retire(_Deck? deck) {
    if (deck == null) return;
    late final Future<void> retirement;
    retirement = _release(deck).catchError((Object _) {
      if (!_disposed) _events.add('playback_error');
    }).whenComplete(() => _retirements.remove(retirement));
    _retirements.add(retirement);
  }

  Future<void> _playPlatformAudio(
      String path, String title, Map<String, String>? headers) async {
    final player = ja.AudioPlayer();
    try {
      final uri = Uri.tryParse(path);
      if (path.startsWith('asset:')) {
        await player.setAsset(path.substring(6));
      } else if (uri?.scheme == 'http' || uri?.scheme == 'https') {
        await player.setUrl(path, headers: headers);
      } else {
        await player.setFilePath(path);
      }
      await stop();
      _fallback = player;
      if (!await _session!.setActive(true)) throw StateError('无法取得音频焦点');
      _handler?.mediaItem.add(background.MediaItem(
          id: 'harbeat-phone',
          title: title,
          album: 'HarBeat',
          duration: player.duration));
      _durations.add(player.duration ?? Duration.zero);
      _playing = true;
      unawaited(player.play().catchError((Object _) {
        if (!_disposed) _events.add('playback_error');
      }));
      _events.add('mix_unavailable');
    } catch (_) {
      await player.dispose();
      if (_fallback == player) _fallback = null;
      rethrow;
    }
  }

  @override
  Future<void> play(
      {String? filePath,
      String title = 'HarBeat',
      Map<String, String>? headers}) async {
    cancelMix();
    final generation = ++_generation;
    late final _Deck next;
    try {
      next = await _open(filePath, title, headers);
    } on sl.SoLoudFileLoadFailedException {
      if (filePath == null || _disposed || generation != _generation) rethrow;
      await _playPlatformAudio(filePath, title, headers);
      return;
    }
    if (_disposed || generation != _generation) {
      await _release(next);
      return;
    }
    if (!await _session!.setActive(true)) {
      await _release(next);
      throw StateError('无法取得音频焦点');
    }
    final old = _current;
    await _fallback?.dispose();
    _fallback = null;
    next.handle = _engine.play(next.source, volume: gain, paused: true);
    _current = next;
    await _release(old);
    _engine.setPause(next.handle!, false);
    _playing = true;
    _announce();
  }

  @override
  Future<bool> mixTo(
      {String? filePath,
      required String title,
      Map<String, String>? headers,
      required MixPlan Function(Duration, Duration, Duration) plan}) async {
    if (_fallback != null) {
      throw StateError('此音频格式支持单曲播放；混音请使用 MP3、WAV、FLAC 或 OGG。');
    }
    if (!_playing || !_valid(_current)) throw StateError('请先开始播放');
    cancelMix();
    final generation = ++_generation;
    final next = await _open(filePath, title, headers);
    if (_disposed ||
        generation != _generation ||
        !_playing ||
        !_valid(_current)) {
      await _release(next);
      return false;
    }
    try {
      final position = currentPosition;
      final selected = plan(position, _engine.getLength(_current!.source),
          _engine.getLength(next.source));
      if (selected.overlapMs < 200 ||
          selected.incomingRate < .9 ||
          selected.incomingRate > 1.1) {
        throw StateError('切换参数超出范围');
      }
      if (selected.incomingRate != 1) {
        next.source.filters.pitchShiftFilter.activate();
      }
      final now = _engine.getEngineTime();
      final start = now +
          Duration(
              milliseconds: selected.outgoingCueMs - position.inMilliseconds);
      if (start - now < const Duration(milliseconds: 150)) {
        throw StateError('错过切换点，请重试');
      }
      final length = Duration(milliseconds: selected.overlapMs);
      next.handle = _engine.playScheduled(next.source, start, volume: 0);
      _engine.seek(
          next.handle!, Duration(milliseconds: selected.incomingCueMs));
      if (selected.incomingRate != 1) {
        next.source.filters.pitchShiftFilter
            .timeStretch(next.handle!, selected.incomingRate);
      }
      _incoming = next;
      _mixDone = Completer<bool>();
      _mixEnd = start + length;
      // No thenStop: cancellation must be able to keep the outgoing voice.
      _engine.fadeScheduled(_current!.handle!, start, 0, length);
      _engine.fadeScheduled(next.handle!, start, gain, length);
      _events.add('mix_plan:${selected.note}');
      return await _mixDone!.future;
    } catch (_) {
      if (_incoming == next) _incoming = null;
      await _release(next);
      if (_valid(_current)) _engine.setVolume(_current!.handle!, gain);
      rethrow;
    }
  }

  void _tick() {
    if (_disposed) return;
    if (_fallback != null) {
      _positions.add(_fallback!.position);
      _handler?.publish(_playing, _fallback!.position);
      if (_playing &&
          _fallback!.processingState == ja.ProcessingState.completed) {
        _playing = false;
        _completions.add(null);
      }
      return;
    }
    if (_incoming != null &&
        _mixEnd != null &&
        _engine.getEngineTime() >= _mixEnd!) {
      final old = _current;
      _current = _incoming;
      _incoming = null;
      _mixEnd = null;
      // v4 restores original tempo after the incoming overlap segment.
      if (_valid(_current)) {
        _engine.setRelativePlaySpeed(_current!.handle!, 1);
        if (_current!.source.filters.pitchShiftFilter.isActive) {
          _current!.source.filters.pitchShiftFilter
              .shift(soundHandle: _current!.handle)
              .value = 1;
        }
      }
      _retire(old);
      _mixDone?.complete(true);
      _mixDone = null;
      _announce();
    }
    if (_valid(_current)) {
      final position = currentPosition;
      _positions.add(position);
      _handler?.publish(_playing, position);
    } else if (_playing && _incoming == null) {
      _playing = false;
      _handler?.publish(false, Duration.zero);
      _completions.add(null);
    }
  }

  void _announce() {
    if (_current == null) return;
    final length = _engine.getLength(_current!.source);
    _durations.add(length);
    _handler?.mediaItem.add(background.MediaItem(
        id: 'harbeat-phone',
        title: _current!.title,
        album: 'HarBeat',
        duration: length));
    _handler?.publish(_playing, currentPosition);
  }

  @override
  void cancelMix() {
    _generation++;
    final next = _incoming;
    _incoming = null;
    _mixEnd = null;
    if (_valid(_current)) {
      _engine.setVolume(_current!.handle!, gain); // cancels native fader
    }
    _mixDone?.complete(false);
    _mixDone = null;
    _retire(next);
  }

  @override
  Future<void> pause() async {
    cancelMix();
    await _fallback?.pause();
    if (_valid(_current)) _engine.setPause(_current!.handle!, true);
    _playing = false;
    _handler?.publish(false, currentPosition);
  }

  @override
  Future<void> resume() async {
    if (_fallback != null) {
      if (await _session!.setActive(true)) {
        _playing = true;
        unawaited(_fallback!.play().catchError((Object _) {
          if (!_disposed) _events.add('playback_error');
        }));
      }
      return;
    }
    if (_valid(_current) && await _session!.setActive(true)) {
      _engine.setPause(_current!.handle!, false);
      _playing = true;
      _handler?.publish(true, currentPosition);
    }
  }

  @override
  Future<void> stop() async {
    cancelMix();
    final fallback = _fallback;
    _fallback = null;
    await fallback?.dispose();
    final old = _current;
    _current = null;
    _playing = false;
    await _release(old);
    _handler?.publish(false, Duration.zero, idle: true);
    await _session?.setActive(false);
  }

  @override
  Future<void> seek(Duration position) async {
    cancelMix();
    await _fallback?.seek(position);
    if (_valid(_current)) _engine.seek(_current!.handle!, position);
  }

  @override
  Future<void> setLoop(bool enabled) async {
    _loop = enabled;
    await _fallback?.setLoopMode(enabled ? ja.LoopMode.one : ja.LoopMode.off);
    if (_valid(_current)) _engine.setLooping(_current!.handle!, enabled);
  }

  @override
  Future<void> setShuffle(
      bool enabled) async {} // queue order belongs to controller
  @override
  Future<void> setLoopRegion(Duration? end) async {
    if (!_valid(_current)) return;
    _engine.setLoopPoint(_current!.handle!, Duration.zero);
    _engine.setLoopEndPoint(_current!.handle!, end);
    _engine.setLooping(_current!.handle!, end != null || _loop);
  }

  @override
  Stream<Duration> get position => _positions.stream;
  @override
  Stream<Duration> get duration => _durations.stream;
  @override
  Stream<void> get completed => _completions.stream;
  @override
  Stream<String> get events => _events.stream;
  @override
  Future<void> dispose() async {
    _disposed = true;
    _poll?.cancel();
    for (final sub in _subscriptions) {
      await sub.cancel();
    }
    await stop();
    await Future.wait(_retirements.toList());
    await _engine.deinitAsync();
    await Future.wait([
      _positions.close(),
      _durations.close(),
      _completions.close(),
      _events.close()
    ]);
  }
}

class _MediaHandler extends background.BaseAudioHandler {
  _MediaHandler(this.player);
  final NativeMixAudio player;
  void publish(bool playing, Duration position, {bool idle = false}) =>
      playbackState.add(background.PlaybackState(
          controls: [
            playing
                ? background.MediaControl.pause
                : background.MediaControl.play,
            background.MediaControl.stop
          ],
          systemActions: const {
            background.MediaAction.seek
          },
          androidCompactActionIndices: const [
            0
          ],
          playing: playing,
          updatePosition: position,
          processingState: idle
              ? background.AudioProcessingState.idle
              : background.AudioProcessingState.ready));
  @override
  Future<void> play() async {
    await player.resume();
    player._events.add('resumed_after_interruption');
  }

  @override
  Future<void> pause() async {
    await player.pause();
    player._events.add('interrupted');
  }

  @override
  Future<void> stop() async {
    await player.stop();
    player._events.add('interrupted');
  }

  @override
  Future<void> seek(Duration position) => player.seek(position);
}
