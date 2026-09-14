import 'package:file_picker/file_picker.dart';

enum ImportFailure {
  permissionDenied,
  unsupportedFormat,
  damagedFile,
  insufficientSpace,
  copyFailed
}

class ImportedAudio {
  const ImportedAudio(
      {required this.name, required this.path, required this.size});
  final String name;
  final String path;
  final int size;
}

class AudioImportException implements Exception {
  const AudioImportException(this.failure, this.message);
  final ImportFailure failure;
  final String message;
  @override
  String toString() => message;
}

abstract interface class MediaStorage {
  Future<ImportedAudio> import(PlatformFile source);
  Future<bool> exists(String path);
}

class MemoryMediaStorage implements MediaStorage {
  final Set<String> paths = {};
  @override
  Future<ImportedAudio> import(PlatformFile source) async {
    final path = '/private/${source.name}';
    final size = await source.xFile.length();
    paths.add(path);
    return ImportedAudio(name: source.name, path: path, size: size);
  }

  @override
  Future<bool> exists(String path) async => paths.contains(path);
}
