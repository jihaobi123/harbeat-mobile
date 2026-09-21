import 'package:file_picker/file_picker.dart';

import 'media_storage_base.dart';

MediaStorage createMediaStorage() => WebMediaStorage();

class WebMediaStorage implements MediaStorage {
  final Set<String> _sessionPaths = {};
  @override
  Future<ImportedAudio> import(PlatformFile source) async {
    final size = await source.xFile.length();
    if (!_supported(source.name)) {
      throw const AudioImportException(
          ImportFailure.unsupportedFormat, '仅支持 MP3、WAV、M4A、AAC、FLAC 和 OGG');
    }
    if (size <= 44) {
      throw const AudioImportException(ImportFailure.damagedFile, '文件为空或已损坏');
    }
    final path = source.xFile.path;
    _sessionPaths.add(path);
    return ImportedAudio(name: source.name, path: path, size: size);
  }

  @override
  Future<bool> exists(String path) async => _sessionPaths.contains(path);

  bool _supported(String name) => const [
        'mp3',
        'wav',
        'm4a',
        'aac',
        'flac',
        'ogg'
      ].contains(name.split('.').last.toLowerCase());
}
