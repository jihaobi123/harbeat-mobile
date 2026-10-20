part of 'controller.dart';

/// The engine is chosen from the song's published evidence, not a user mode.
extension SmartPlaybackFlow on AppController {
  bool get smartControls =>
      v3Metric || (!v3Active && v3Supported && nasRepository != null);
  List<String> get smartStyles {
    final labels = v3Catalog
        .expand((t) => (t['styleLabels'] as List? ?? []).whereType<String>())
        .toSet()
        .toList()
      ..sort();
    if (smartStyle.isNotEmpty && !labels.contains(smartStyle)) {
      labels.add(smartStyle);
    }
    return labels;
  }

  Future<void> loadSmartChoices() async {
    if (nasRepository == null || v3Active) return;
    try {
      final rows = await nasRepository!.smartDirectory();
      if (_disposed || v3Active) return;
      v3Catalog = rows;
      _changed();
    } catch (_) {
      // Playback can retry the directory itself; do not invent online styles.
    }
  }

  Future<bool> prepareSmartPlayer({Track? initial}) async {
    if (!v3Supported || v3Loading) return false;
    if (!v3Active) await enableV3(mode: 'metric');
    if (!v3Active || !v3Metric) return false;
    if (initial != null && !v3Tracks.any((t) => t.id == initial.id)) {
      await disableV3();
      return false;
    }
    String key(String value) =>
        value.toLowerCase().replaceAll(RegExp(r'[\s_-]'), '');
    if (smartStyle.isNotEmpty &&
        !smartStyles.any((s) =>
            key(s) == key(smartStyle) &&
            v3Catalog
                .any((t) => (t['styleLabels'] as List? ?? []).contains(s)))) {
      await _v3Command('direction', {'automatic': false});
      smartAutomatic = false;
      v3Error = '当前曲库没有保存的风格，请重新选择；原曲可以正常播放。';
    } else {
      await _v3Command('direction', {
        'style': smartStyle,
        'energy': draftEnergy,
        'automatic': smartAutomatic,
      });
    }
    if (initial != null) await metricCurrent(initial);
    return true;
  }

  Future<bool> playSmartTrack(Track track) async {
    if (!await prepareSmartPlayer(initial: track)) return v3Active;
    await v3TogglePlayback();
    return true;
  }

  Future<void> setSmartDirection(
      {int? level, String? style, bool? automatic}) async {
    if (level != null) energy = draftEnergy = level.clamp(1, 5);
    if (style != null) smartStyle = style;
    if (automatic != null) smartAutomatic = automatic;
    _changed();
    if (v3Metric) {
      await _v3Command('direction', {
        'energy': draftEnergy,
        'style': smartStyle,
        'automatic': smartAutomatic,
      });
    } else if (style != null && AppController.mixStyles.contains(style)) {
      editDirection(style: style);
    }
    await _persist();
  }

  Future<void> recommendNext() async {
    await _v3Command('recommend');
    _changed();
  }
}
