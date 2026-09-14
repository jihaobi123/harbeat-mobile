import 'package:file_picker/file_picker.dart';

import 'media_storage_base.dart';

MediaStorage createMediaStorage() => WebMediaStorage();

class WebMediaStorage implements MediaStorage {
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
    return ImportedAudio(
        name: source.name, path: 'web://${source.name}', size: size);
  }

  @override
  Future<bool> exists(String path) async => path.startsWith('web://');

  bool _supported(String name) => const [
        'mp3',
        'wav',
        'm4a',
        'aac',
        'flac',
        'ogg'
      ].contains(name.split('.').last.toLowerCase());
}
