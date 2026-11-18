part of 'controller.dart';

extension NasFlow on AppController {
  static final realtimeLabUrl = CloudEndpoints.mediaUri
      .resolve('/analysis-lab-static/v3-live-20260920/index.html');
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
  List<Track> get nasDisplayTracks => [
        ...nasTracks.where((t) => t.coverUrl != null),
        ...nasTracks.where((t) => t.coverUrl == null),
      ];
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
      await loadPhoneSourceCatalog();
    } catch (e) {
      if (!_disposed) nasError = 'NAS 刷新失败，保留已加载目录。${_networkMessage(e)}';
    } finally {
      nasLoading = false;
      _changed();
    }
  }

  Future<void> loadPhoneSourceCatalog() async {
    if (nasRepository == null || !v3Supported) return;
    final rows = await nasRepository!.phoneSourceDirectory();
    if (_disposed || rows.isEmpty) return;
    if (v3Active) {
      if (!v3Metric) return;
      bool missing() => rows
          .any((row) => !v3Catalog.any((entry) => entry['id'] == row['id']));
      if (missing()) {
        try {
          await _refreshV3MusicCatalog();
        } catch (_) {
          return; // Keep the current audio and last playable source playlist.
        }
        if (_disposed || (v3Active && (!v3Metric || missing()))) return;
      }
    }
    final sourceTracks = rows.map((row) {
      final id = 'nas:${row['id']}';
      final cover = _sourceCatalogCover(row['coverPath']);
      final existing = tracks.where((t) => t.id == id).firstOrNull;
      if (existing?.detailLoaded == true) {
        return existing!.withCoverUrl(cover ?? existing.coverUrl);
      }
      return Track(
          id: id,
          title: row['title'] as String,
          artist: row['artist'] is String
              ? row['artist'] as String
              : row['collection'] as String,
          style: row['style'] is String ? row['style'] as String : 'NAS',
          bpm: row['bpm'] as num?,
          energy: null,
          color: const Color(0xFFFF683B),
          reason:
              row['mixStatus'] == 'ready' ? '已分析的街舞 DJ 音乐' : '原曲可试听，暂不参与自动混音。',
          needsReview: row['mixStatus'] != 'ready',
          durationMs: ((row['duration'] as num) * 1000).round(),
          coverUrl: cover);
    }).toList();
    _mergeTracks(sourceTracks);
    final ids = sourceTracks.map((t) => t.id).toList();
    final index = playlists
        .indexWhere((p) => p.id == NasCatalogRepository.phoneSourcePlaylistId);
    if (index < 0) {
      playlists = [
        ...playlists,
        Playlist(
            id: NasCatalogRepository.phoneSourcePlaylistId,
            name: '街舞 DJ · 新增音乐',
            trackIds: ids)
      ];
      unawaited(_persist());
    } else {
      final current = playlists[index], available = ids.toSet();
      final retained = current.trackIds.where(available.contains).toList();
      final known = retained.toSet();
      final next = [...retained, ...ids.where((id) => !known.contains(id))];
      if (!listEquals(current.trackIds, next)) {
        playlists = [...playlists]..[index] = current.copyWith(trackIds: next);
        unawaited(_persist());
      }
    }
    _changed();
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
