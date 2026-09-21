part of 'controller.dart';

extension NasFlow on AppController {
  static final realtimeLabUrl = Uri.parse(
      'https://8.136.120.255/analysis-lab-static/v3-live-20260920/index.html');
  Future<void> openRealtimeLab({Future<bool> Function(Uri)? launcher}) async {
    if (audioBusy || applyingDirection || openingRealtimeLab) return;
    openingRealtimeLab = true;
    realtimeLabError = null;
    _changed();
    try {
      final bool opened;
      if (launcher == null && v3Supported) {
        await enableV3();
        tab = 0;
        opened = v3Active;
      } else {
        cancelDirection(message: '准备打开 V3 实时实验');
        if (isPlaying) await togglePlayback();
        opened = await (launcher ??
            ((uri) => launchUrl(uri,
                mode: LaunchMode.externalApplication,
                webOnlyWindowName: '_self')))(realtimeLabUrl);
      }
      if (!opened) throw StateError('实时混音未能打开');
    } catch (_) {
      realtimeLabError = '未能打开实时混音，请重试。';
    } finally {
      openingRealtimeLab = false;
      _changed();
    }
  }

  List<Track> get nasTracks => tracks.where((t) => t.isNas).toList();
  List<Track> get featuredNasTracks => _byIds(nasRepository?.featuredIds ?? []);
  void _ensureNasPlaylist() {
    final ids = nasRepository?.featuredIds ?? [];
    if (_nasPlaylistCreated || ids.length != 6 || _byIds(ids).length != 6) {
      return;
    }
    if (!playlists.any((p) => p.id == NasCatalogRepository.playlistId)) {
      playlists = [
        ...playlists,
        Playlist(
            id: NasCatalogRepository.playlistId,
            name: 'HIP-HOP / SIX · NAS 精选',
            trackIds: List.of(ids))
      ];
    }
    _nasPlaylistCreated = true;
    unawaited(_persist());
  }

  Future<void> refreshNas() async {
    if (nasRepository == null || nasLoading) return;
    nasLoading = true;
    nasError = null;
    _changed();
    try {
      final items = await nasRepository!.refresh();
      if (_disposed) return;
      // Remove stale catalog rows without invalidating saved/playing songs.
      final retained = {
        ...library,
        ...queue,
        for (final p in playlists) ...p.trackIds,
        if (nowPlaying != null) nowPlaying!.id
      };
      tracks =
          tracks.where((t) => !t.isNas || retained.contains(t.id)).toList();
      _mergeTracks(items);
      nasLive = true;
      _ensureNasPlaylist();
    } catch (e) {
      if (!_disposed) nasError = 'NAS 刷新失败，保留已加载目录。${_networkMessage(e)}';
    } finally {
      nasLoading = false;
      _changed();
    }
  }

  void showMoreNas() {
    nasVisibleCount += 12;
    _changed();
  }

  Future<void> playNasSet({required bool mixed}) async {
    if (audioBusy || applyingDirection) return;
    if (mixed) {
      setQueue([NasCatalogRepository.mix.id]);
      await play(NasCatalogRepository.mix);
    } else {
      final items = featuredNasTracks;
      if (items.length != 6) return;
      setQueue(items.map((t) => t.id).toList());
      await play(items.first);
    }
    if (isPlaying) setTab(0);
  }
}
