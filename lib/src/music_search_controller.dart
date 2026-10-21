part of 'controller.dart';

extension MusicSearchFlow on AppController {
  List<String> get musicImportStyles => musicSearchRepository.importStyles;
  bool get musicSharedWorkspaceEnabled =>
      !isRemoteMode ||
      _musicSharedWorkspaceUsed ||
      musicSearchScope == 'discover';
  bool _musicWorkspaceCurrent(int epoch) =>
      !_disposed && epoch == _musicWorkspaceEpoch && !activityRestoring;

  void resetMusicWorkspaceState() {
    _musicWorkspaceEpoch++;
    _musicSearchEpoch++;
    _musicSearchTimer?.cancel();
    musicSearchResult = null;
    _musicRemoteOwner = null;
    musicImportJobs = [];
    _musicSyncedJobs.clear();
    musicSearchError = musicJobsError = musicImportError = null;
    musicSearching = musicJobsLoading = musicImportBusy = false;
    _changed();
  }

  MusicHit _remoteMusicHit(Track track) => MusicHit(
      id: track.id,
      title: track.title,
      artist: track.artist,
      style: track.style,
      bpm: track.bpm,
      durationSeconds:
          track.durationMs == null ? null : track.durationMs! / 1000,
      coverUrl: track.coverUrl,
      isLibrary: true,
      playable: track.canPlay,
      remoteTrack: track);

  void setMusicSearchQuery(String value) {
    musicSearchQuery = value;
    _musicSearchTimer?.cancel();
    _musicSearchEpoch++;
    musicSearchError = null;
    musicSearching = value.trim().isNotEmpty;
    if (value.trim().isEmpty) {
      musicSearchResult = _knownMusicResult();
      _changed();
      return;
    }
    // Keep the text field's selection while typing; the request publishes results.
    _musicSearchTimer = Timer(
        const Duration(milliseconds: 400), () => unawaited(runMusicSearch()));
  }

  Future<void> changeMusicSearchScope(String scope) async {
    if (!const ['library', 'discover'].contains(scope) ||
        musicSearchScope == scope) {
      return;
    }
    musicSearchScope = scope;
    if (scope == 'discover') _musicSharedWorkspaceUsed = true;
    _musicSearchEpoch++;
    musicSearchResult = null;
    musicSearchError = null;
    _changed();
    await runMusicSearch();
  }

  Future<void> runMusicSearch() async {
    if (activityRestoring) return;
    _musicSearchTimer?.cancel();
    final query = musicSearchQuery.trim(), scope = musicSearchScope;
    final epoch = ++_musicSearchEpoch;
    if (query.isEmpty) {
      if (scope == 'library' &&
          !isRemoteMode &&
          nasRepository != null &&
          !nasLive &&
          !nasLoading) {
        await refreshNas();
      }
      if (_disposed || epoch != _musicSearchEpoch) return;
      musicSearching = false;
      musicSearchResult = _knownMusicResult();
      _changed();
      return;
    }
    musicSearching = true;
    musicSearchError = null;
    _changed();
    try {
      final remote = scope == 'library' ? remoteRepository : null;
      final MusicSearchResult result;
      if (remote != null) {
        final page = await remote.catalog(query: query);
        if (_disposed ||
            epoch != _musicSearchEpoch ||
            remote != remoteRepository) {
          return;
        }
        _musicRemoteOwner = remote;
        _mergeTracks(page.items);
        result = MusicSearchResult(
            scope: 'library', hits: page.items.map(_remoteMusicHit).toList());
      } else {
        result = await musicSearchRepository.search(query, scope);
      }
      if (_disposed || epoch != _musicSearchEpoch) return;
      musicSearchResult = _withKnownArtwork(result);
      _applyMusicCovers(result.hits);
    } catch (e) {
      if (!_disposed && epoch == _musicSearchEpoch) {
        musicSearchError = _musicError(e);
      }
    } finally {
      if (!_disposed && epoch == _musicSearchEpoch) {
        musicSearching = false;
        _changed();
      }
    }
  }

  MusicSearchResult _withKnownArtwork(MusicSearchResult result) =>
      MusicSearchResult(
          scope: result.scope,
          semanticStatus: result.semanticStatus,
          semanticMessage: result.semanticMessage,
          covered: result.covered,
          total: result.total,
          title: result.title,
          hits: result.hits.map((h) {
            final cover = h.coverUrl ??
                tracks
                    .where(
                        (t) => h.trackId != null && t.id == 'nas:${h.trackId}')
                    .firstOrNull
                    ?.coverUrl;
            return MusicHit(
                id: h.id,
                title: h.title,
                artist: h.artist,
                provider: h.provider,
                style: h.style,
                bpm: h.bpm,
                durationSeconds: h.durationSeconds,
                trackId: h.trackId,
                discoveryId: h.discoveryId,
                isLibrary: h.isLibrary,
                playable: h.playable,
                mixReady: h.mixReady,
                remoteTrack: h.remoteTrack,
                coverUrl: cover);
          }).toList());

  MusicSearchResult _knownMusicResult() {
    if (isRemoteMode && musicSearchScope == 'library') {
      _musicRemoteOwner = remoteRepository;
      return MusicSearchResult(
          scope: 'library', hits: cloudTracks.map(_remoteMusicHit).toList());
    }
    final catalog = {for (final row in v3Catalog) row['id']: row};
    return MusicSearchResult(
        scope: musicSearchScope,
        hits: musicSearchScope != 'library'
            ? []
            : tracks.where((t) => t.isNas).map((t) {
                final id = t.id.substring(4), row = catalog[t.id.substring(4)];
                return MusicHit(
                    id: id,
                    trackId: id,
                    title: t.title,
                    artist: t.artist,
                    style: t.style,
                    bpm: t.bpm,
                    durationSeconds:
                        t.durationMs == null ? null : t.durationMs! / 1000,
                    coverUrl: t.coverUrl,
                    isLibrary: true,
                    playable: row?['playStatus'] == 'ready' ||
                        (t.detailLoaded &&
                            t.previewUrl != null &&
                            t.availability == TrackAvailability.ready),
                    mixReady: row?['mixStatus'] == 'ready');
              }).toList());
  }

  void cancelMusicSearchDebounce() {
    _musicSearchTimer?.cancel();
    _musicSearchEpoch++;
    musicSearching = false;
  }

  String _musicError(Object error) => error is ActivityException
      ? error.message
          .replaceAll('预约服务', '音乐服务')
          .replaceAll('已保存的预约仍会保留', '已提交的任务仍会继续处理')
      : error is BackendException
          ? error.message
          : '音乐服务暂不可用，请稍后重试。';

  void _applyMusicCovers(Iterable<MusicHit> hits) {
    final byId = {
      for (final h in hits)
        if (h.trackId != null && h.coverUrl != null)
          'nas:${h.trackId}': h.coverUrl!
    };
    if (byId.isEmpty) return;
    tracks = tracks
        .map((t) => byId.containsKey(t.id) ? t.withCoverUrl(byId[t.id]) : t)
        .toList();
    if (nowPlaying != null && byId.containsKey(nowPlaying!.id)) {
      nowPlaying = nowPlaying!.withCoverUrl(byId[nowPlaying!.id]);
    }
    if (musicSearchResult != null) {
      musicSearchResult = _withKnownArtwork(musicSearchResult!);
    }
  }

  Future<List<MusicDownloadCandidate>> matchMusic(MusicHit hit) async {
    if (activityRestoring) return [];
    final epoch = _musicWorkspaceEpoch;
    _musicSharedWorkspaceUsed = true;
    musicImportError = null;
    try {
      final candidates = await musicSearchRepository.matches(hit);
      return _musicWorkspaceCurrent(epoch) ? candidates : [];
    } catch (e) {
      if (_musicWorkspaceCurrent(epoch)) {
        musicImportError = _musicError(e);
        _changed();
      }
      return [];
    }
  }

  void _mergeMusicJob(MusicImportJob job) {
    musicImportJobs = [job, ...musicImportJobs.where((j) => j.id != job.id)];
    _changed();
  }

  Future<MusicImportJob?> downloadMusic(MusicDownloadCandidate candidate,
      {String style = 'Hip-Hop'}) async {
    if (musicImportBusy || activityRestoring) return null;
    final epoch = _musicWorkspaceEpoch;
    _musicSharedWorkspaceUsed = true;
    musicImportBusy = true;
    musicImportError = null;
    _changed();
    try {
      final job = await musicSearchRepository.download(candidate, style);
      if (!_musicWorkspaceCurrent(epoch)) return null;
      _mergeMusicJob(job);
      return job;
    } catch (e) {
      if (_musicWorkspaceCurrent(epoch)) musicImportError = _musicError(e);
      return null;
    } finally {
      if (_musicWorkspaceCurrent(epoch)) {
        musicImportBusy = false;
        _changed();
      }
    }
  }

  Future<void> refreshMusicJobs() async {
    if (musicJobsLoading || activityRestoring || !musicSharedWorkspaceEnabled) {
      return;
    }
    final epoch = _musicWorkspaceEpoch;
    musicJobsLoading = true;
    musicJobsError = null;
    _changed();
    try {
      final jobs = await musicSearchRepository.jobs();
      if (!_musicWorkspaceCurrent(epoch)) return;
      musicImportJobs = jobs;
      final ready = jobs
          .where((j) =>
              j.playable && !_musicSyncedJobs.contains('${j.id}/${j.state}'))
          .toList();
      if (ready.isNotEmpty) {
        await _refreshMusicCatalog();
        if (!_musicWorkspaceCurrent(epoch)) return;
        for (final job in ready) {
          if (tracks.any((t) => t.id == 'nas:${job.trackId}')) {
            _musicSyncedJobs.add('${job.id}/${job.state}');
          }
        }
      }
      _applyMusicCovers(jobs.where((j) => j.playable && j.coverUrl != null).map(
          (j) => MusicHit(
              id: j.trackId!,
              trackId: j.trackId,
              title: j.title,
              coverUrl: j.coverUrl,
              isLibrary: true)));
      // Cover extraction may complete after the audio becomes ready.
      try {
        final covers = await musicSearchRepository.covers();
        if (!_musicWorkspaceCurrent(epoch)) return;
        _applyMusicCovers(covers.entries.map((e) => MusicHit(
            id: e.key,
            trackId: e.key,
            title: '',
            coverUrl: e.value,
            isLibrary: true)));
      } catch (_) {/* Artwork failures do not hide download progress. */}
    } catch (e) {
      if (_musicWorkspaceCurrent(epoch)) musicJobsError = _musicError(e);
    } finally {
      if (_musicWorkspaceCurrent(epoch)) {
        musicJobsLoading = false;
        _changed();
      }
    }
  }

  /// Appends newly published index rows without preparing a new audio context.
  Future<void> _refreshMusicCatalog() async {
    if (nasRepository != null) await refreshNas();
    if (_disposed || !v3Active || !v3Metric) return;
    final result = await realtimeEngine.command('refreshLibrary');
    if (_disposed) return;
    final rows = (result['tracks'] as List? ?? [])
        .whereType<Map>()
        .map((r) => Map<String, dynamic>.from(r))
        .toList();
    final known = v3Catalog.map((v) => v['id']).toSet();
    v3Catalog = [...v3Catalog, ...rows.where((r) => !known.contains(r['id']))];
    for (final row in rows) {
      final id = row['id'];
      if (id is! String || tracks.any((t) => t.id == 'nas:$id')) continue;
      _mergeTracks([
        Track(
            id: 'nas:$id',
            title: row['title']?.toString() ?? '未命名曲目',
            artist: row['collection']?.toString() ?? 'NAS 音乐库',
            style: row['style']?.toString() ?? 'NAS',
            bpm: row['bpm'] as num?,
            energy: null,
            reason: '已发布的预处理曲目',
            color: const Color(0xFFC9F044),
            durationMs: ((row['duration'] as num? ?? 0) * 1000).round())
      ]);
    }
    if (result['state'] is Map) {
      _receiveV3(Map<String, dynamic>.from(result['state'] as Map));
    }
    _changed();
  }

  Future<Track?> musicHitTrack(MusicHit hit) async {
    if (hit.isLibrary && hit.remoteTrack != null) {
      if (!hit.playable ||
          _musicRemoteOwner == null ||
          _musicRemoteOwner != remoteRepository ||
          !hit.remoteTrack!.isRemote) {
        musicSearchError = '音乐服务已切换，请重新搜索这首歌。';
        _changed();
        return null;
      }
      return currentTrack(hit.remoteTrack!);
    }
    if (!hit.isLibrary || !hit.playable || hit.trackId == null) {
      musicSearchError = '这首音乐还未进入可播放曲库，请先下载分析。';
      _changed();
      return null;
    }
    try {
      final id = 'nas:${hit.trackId}';
      if (!tracks.any((t) => t.id == id) ||
          (v3Metric && !v3Catalog.any((r) => r['id'] == hit.trackId))) {
        await _refreshMusicCatalog();
      }
      if (_disposed) return null;
      final track = tracks.where((t) => t.id == id).firstOrNull;
      if (track == null) throw const ActivityException('曲库正在同步，请稍后刷新任务。');
      if (hit.coverUrl != null) {
        _applyMusicCovers([hit]);
        return tracks.firstWhere((t) => t.id == id);
      }
      return track;
    } catch (e) {
      musicSearchError = _musicError(e);
      _changed();
      return null;
    }
  }

  Future<Track?> musicJobTrack(MusicImportJob job) => musicHitTrack(MusicHit(
      id: job.trackId ?? job.id,
      title: job.title,
      trackId: job.trackId,
      coverUrl: job.coverUrl,
      isLibrary: true,
      playable: job.playable,
      mixReady: job.mixReady));
  Future<void> playMusicHit(MusicHit hit) async {
    final track = await musicHitTrack(hit);
    if (track != null && !_disposed) {
      await play(track);
      if (isPlaying) setTab(0);
    }
  }

  Future<void> playMusicJob(MusicImportJob job) async {
    final track = await musicJobTrack(job);
    if (track != null && !_disposed) {
      await play(track);
      if (isPlaying) setTab(0);
    }
  }

  Future<void> retryMusicJob(MusicImportJob job) async {
    if (activityRestoring) return;
    final epoch = _musicWorkspaceEpoch;
    _musicSharedWorkspaceUsed = true;
    musicImportError = null;
    try {
      final next = await musicSearchRepository.retry(job);
      if (_musicWorkspaceCurrent(epoch)) _mergeMusicJob(next);
    } catch (e) {
      if (_musicWorkspaceCurrent(epoch)) {
        musicImportError = _musicError(e);
        _changed();
      }
    }
  }

  Future<void> searchMusicLink(String url) async {
    if (activityRestoring) return;
    _musicSharedWorkspaceUsed = true;
    _musicSearchTimer?.cancel();
    final epoch = ++_musicSearchEpoch;
    musicSearching = true;
    musicSearchError = null;
    _changed();
    try {
      final result = await musicSearchRepository.playlist(url.trim());
      if (!_disposed && epoch == _musicSearchEpoch) {
        musicSearchScope = 'discover';
        musicSearchResult = result;
      }
    } catch (e) {
      if (!_disposed && epoch == _musicSearchEpoch) {
        musicSearchError = _musicError(e);
      }
    } finally {
      if (!_disposed && epoch == _musicSearchEpoch) {
        musicSearching = false;
        _changed();
      }
    }
  }

  Future<MusicImportJob?> uploadMusicAudio(
      {required String filename,
      required Uint8List bytes,
      String title = '',
      String style = ''}) async {
    if (musicImportBusy || activityRestoring) return null;
    final epoch = _musicWorkspaceEpoch;
    _musicSharedWorkspaceUsed = true;
    musicImportBusy = true;
    musicImportError = null;
    _changed();
    try {
      final job = await musicSearchRepository.upload(
          bytes: bytes, filename: filename, title: title, style: style);
      if (!_musicWorkspaceCurrent(epoch)) return null;
      _mergeMusicJob(job);
      return job;
    } catch (e) {
      if (_musicWorkspaceCurrent(epoch)) musicImportError = _musicError(e);
      return null;
    } finally {
      if (_musicWorkspaceCurrent(epoch)) {
        musicImportBusy = false;
        _changed();
      }
    }
  }
}
