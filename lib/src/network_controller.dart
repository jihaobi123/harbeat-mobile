part of 'controller.dart';

extension NetworkFlow on AppController {
  RemoteHarBeatRepository? get remoteRepository =>
      repository is RemoteHarBeatRepository
          ? repository as RemoteHarBeatRepository
          : null;
  bool get isRemoteMode => remoteRepository != null;
  bool get hasBackendSession =>
      remoteRepository?.config.token.isNotEmpty == true;
  String? get accountName =>
      accountProfile?['username'] as String? ??
      remoteRepository?.config.username;
  List<Track> get cloudTracks => _byIds(_catalogIds);
  List<Track> get localTracks => tracks.where((t) => t.isLocal).toList();
  List<Track> get catalogTracks => isRemoteMode
      ? [..._byIds(_catalogIds), ...tracks.where((t) => t.isLocal)]
      : tracks;
  List<Track> _byIds(List<String> ids) {
    final indexed = {for (final t in tracks) t.id: t};
    return ids.map((id) => indexed[id]).whereType<Track>().toList();
  }

  RemoteHarBeatRepository _connectedRepository(BackendConfig config) {
    final remote = backendFactory(config);
    _bindSession(remote);
    return remote;
  }

  void _bindSession(RemoteHarBeatRepository remote) {
    remote.onSessionChanged = (session) async {
      if (_disposed || remote != remoteRepository) return;
      if (session.token.isEmpty) accountProfile = null;
      await _saveSession(session);
      _changed();
    };
  }

  Future<void> _saveSession(BackendConfig session) {
    _sessionWrites = _sessionWrites.then((_) async {
      try {
        if (session.token.isEmpty) {
          await sessionStore.clear();
        } else {
          await sessionStore.clear();
          await sessionStore.write(session);
        }
        sessionWarning = null;
      } catch (_) {
        sessionWarning = '当前会话可用，但登录状态未能安全保存；下次打开需重新登录。';
      }
    });
    return _sessionWrites;
  }

  Future<void> loadAccountProfile() async {
    final remote = remoteRepository;
    if (remote == null ||
        remote.config.api != BackendApi.legacy ||
        remote.config.token.isEmpty) {
      return;
    }
    try {
      final profile = await remote.profile();
      if (remote != remoteRepository || _disposed) return;
      if (profile['username'] is! String || profile['id'] is! int) {
        throw const BackendException('账号信息格式不匹配，请刷新账号信息。');
      }
      if (remote.config.userId != null &&
          profile['id'] != remote.config.userId) {
        throw const BackendException('账号身份校验失败，请重新登录。');
      }
      accountProfile = profile;
      accountError = null;
    } catch (e) {
      if (remote == remoteRepository) {
        accountError = _networkMessage(e);
        if (e is BackendException &&
            (e.statusCode == 401 || e.statusCode == 403)) {
          remote.config = BackendConfig(remote.config.baseUri.toString(),
              api: remote.config.api);
          accountProfile = null;
          await _saveSession(remote.config);
        }
      }
    }
    _changed();
  }

  Future<void> logoutBackend() async {
    final remote = remoteRepository;
    if (remote == null) return;
    if (uploading || audioBusy || applyingDirection) {
      throw const BackendException('请等待当前操作完成后退出登录。');
    }
    remote.onSessionChanged = null;
    await _sessionWrites;
    try {
      await sessionStore.clear();
    } catch (_) {
      _bindSession(remote);
      throw const BackendException('未能清除保存的登录凭据，请重试退出。');
    }
    await configureBackend(BackendConfig(remote.config.baseUri.toString(),
        api: remote.config.api));
    accountProfile = null;
    accountError = null;
    _changed();
  }

  Track currentTrack(Track track) =>
      tracks.where((t) => t.id == track.id).firstOrNull ?? track;
  String _networkMessage(Object error) =>
      error is BackendException ? error.message : '音乐服务暂不可用，请重试。';

  void _mergeTracks(List<Track> items) {
    final merged = {for (final t in tracks) t.id: t};
    for (final item in items) {
      merged[item.id] = item;
    }
    tracks = merged.values.toList();
  }

  Future<void> loginBackend(BackendConfig config,
      {required String username, required String password}) async {
    if (audioBusy || applyingDirection || uploading) {
      throw const BackendException('请等待当前播放操作完成后登录。');
    }
    final auth = backendFactory(config);
    late BackendConfig session;
    try {
      session = await auth.login(username, password);
    } finally {
      auth.close();
    }
    // Keep the current catalog and playback intact if authentication fails.
    if (!_disposed) await configureBackend(session);
  }

  // Return the new session separately so the UI can acknowledge account creation
  // before loading the catalog, even if that subsequent request fails.
  Future<BackendConfig> createBackendAccount(BackendConfig config,
      {required String username, required String password}) async {
    if (audioBusy || applyingDirection || uploading) {
      throw const BackendException('请等待当前播放操作完成后注册。');
    }
    final auth = backendFactory(config);
    try {
      return await auth.register(username, password);
    } finally {
      auth.close();
    }
  }

  Future<void> configureBackend(BackendConfig config) async {
    if (audioBusy || applyingDirection || uploading) {
      throw const BackendException('请等待当前播放操作完成后切换服务。');
    }
    cancelDirection();
    await audio.stop();
    remoteRepository?.onSessionChanged = null;
    remoteRepository?.close();
    repository = _connectedRepository(config);
    accountProfile = null;
    accountError = null;
    uploadError = null;
    uploadMessage = null;
    _catalogGeneration++;
    _searchGeneration++;
    _searchTimer?.cancel();
    _searchIds = [];
    _catalogIds = [];
    searchQuery = '';
    searchError = null;
    nextSearchCursor = null;
    searching = false;
    tracks =
        tracks.where((t) => t.isLocal || t.isNas || t.isRenderedMix).toList();
    nowPlaying = null;
    isPlaying = false;
    _audioLoaded = false;
    loopPreview = false;
    queue = [];
    queueIndex = -1;
    detailErrors.clear();
    await _saveSession(config);
    await _persist();
    await loadAccountProfile();
    await refreshCatalog();
  }

  Future<void> useDemoCatalog() async {
    if (audioBusy || applyingDirection || uploading) return;
    cancelDirection();
    await audio.stop();
    remoteRepository?.onSessionChanged = null;
    remoteRepository?.close();
    repository = MockHarBeatRepository();
    accountProfile = null;
    accountError = null;
    await _saveSession(BackendConfig(BackendConfig.defaultAddress));
    _catalogGeneration++;
    _searchGeneration++;
    _searchTimer?.cancel();
    searchQuery = '';
    searching = false;
    searchError = null;
    nowPlaying = null;
    isPlaying = false;
    _audioLoaded = false;
    loopPreview = false;
    queue = [];
    queueIndex = -1;
    final local =
        tracks.where((t) => t.isLocal || t.isNas || t.isRenderedMix).toList();
    loading = true;
    _changed();
    tracks = [...await repository.recommendations(), ...local];
    loading = false;
    catalogError = null;
    await _persist();
    _changed();
  }

  Future<void> refreshCatalog({bool more = false}) async {
    final remote = remoteRepository;
    if (remote == null) return;
    if (more && (loading || nextCatalogCursor == null)) return;
    final generation = ++_catalogGeneration;
    loading = true;
    catalogError = null;
    _changed();
    try {
      final cursor = more ? nextCatalogCursor : null;
      final page = await remote.catalog(cursor: cursor);
      if (_disposed || generation != _catalogGeneration) return;
      _mergeTracks(page.items);
      _catalogIds = {
        ...(more ? _catalogIds : <String>[]),
        ...page.items.map((t) => t.id)
      }.toList();
      nextCatalogCursor = page.nextCursor == cursor ? null : page.nextCursor;
    } catch (error) {
      if (generation == _catalogGeneration) {
        catalogError = _networkMessage(error);
      }
    } finally {
      if (generation == _catalogGeneration) {
        loading = false;
        _changed();
      }
    }
  }

  Future<void> searchRemote({bool more = false}) async {
    final remote = remoteRepository;
    final query = searchQuery.trim();
    if (remote == null || query.isEmpty || (more && nextSearchCursor == null)) {
      return;
    }
    final generation = ++_searchGeneration;
    searching = true;
    searchError = null;
    _changed();
    try {
      final cursor = more ? nextSearchCursor : null;
      final page = await remote.catalog(query: query, cursor: cursor);
      if (_disposed || generation != _searchGeneration) return;
      _mergeTracks(page.items);
      _searchIds = {
        ...(more ? _searchIds : <String>[]),
        ...page.items.map((t) => t.id)
      }.toList();
      nextSearchCursor = page.nextCursor == cursor ? null : page.nextCursor;
    } catch (error) {
      if (generation == _searchGeneration) searchError = _networkMessage(error);
    } finally {
      if (generation == _searchGeneration) {
        searching = false;
        _changed();
      }
    }
  }

  Future<void> loadTrackDetail(Track track) async {
    final remote = remoteRepository;
    if ((!track.isNas && (remote == null || !track.isRemote)) ||
        detailsLoading.contains(track.id)) {
      return;
    }
    detailsLoading.add(track.id);
    detailErrors.remove(track.id);
    _changed();
    try {
      final result = track.isNas
          ? await nasRepository!.detail(track, force: true)
          : await remote!.detail(track);
      if (_disposed || (!track.isNas && remote != remoteRepository)) return;
      _mergeTracks([result]);
    } catch (error) {
      if (remote == remoteRepository) {
        detailErrors[track.id] = _networkMessage(error);
      }
    } finally {
      detailsLoading.remove(track.id);
      _changed();
    }
  }

  Future<void> uploadCloudAudio(PlatformFile file,
      {required String title, required String artist}) async {
    if (uploading) return;
    final remote = remoteRepository;
    if (remote == null || !hasBackendSession) {
      throw const BackendException('请先登录音乐服务，再上传到云端。');
    }
    uploading = true;
    uploadProgress = 0;
    uploadError = null;
    uploadMessage = null;
    _changed();
    try {
      final result = await remote.uploadAudio(
          filename: file.name,
          length: await file.length(),
          bytes: file.readAsByteStream(),
          title: title,
          artist: artist,
          onProgress: (sent, total) {
            if (!_disposed && remote == remoteRepository) {
              uploadProgress = (sent / total).clamp(0, 1);
              _changed();
            }
          });
      if (_disposed || remote != remoteRepository) return;
      _mergeTracks([result]);
      _catalogIds = {..._catalogIds, result.id}.toList();
      uploadProgress = 1;
      uploadMessage = '上传成功：${result.title}。分析进度可在歌曲详情查看。';
      await refreshCatalog();
    } catch (e) {
      if (remote == remoteRepository) uploadError = _networkMessage(e);
    } finally {
      uploading = false;
      _changed();
    }
  }
}
