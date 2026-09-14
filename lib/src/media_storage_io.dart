import 'dart:io';

import 'package:disk_space_plus/disk_space_plus.dart';
import 'package:file_picker/file_picker.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import 'media_storage_base.dart';

MediaStorage createMediaStorage() => IoMediaStorage();

class IoMediaStorage implements MediaStorage {
  static const _extensions = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'];

  @override
  Future<ImportedAudio> import(PlatformFile source) async {
    final sourceSize = await source.xFile.length();
    final extension =
        p.extension(source.name).replaceFirst('.', '').toLowerCase();
    if (!_extensions.contains(extension)) {
      throw const AudioImportException(
          ImportFailure.unsupportedFormat, '仅支持 MP3、WAV、M4A、AAC、FLAC 和 OGG');
    }
    if (sourceSize <= 44) {
      throw const AudioImportException(ImportFailure.damagedFile, '文件为空或已损坏');
    }
    final freeMb = await DiskSpacePlus().getFreeDiskSpace ?? 0;
    final requiredMb = sourceSize / 1024 / 1024 + 20;
    if (freeMb < requiredMb) {
      throw AudioImportException(ImportFailure.insufficientSpace,
          '空间不足，需要 ${requiredMb.ceil()}MB，当前可用 ${freeMb.floor()}MB');
    }
    try {
      final root = await getApplicationSupportDirectory();
      final directory = Directory(p.join(root.path, 'harbeat_audio'));
      await directory.create(recursive: true);
      final safeName =
          p.basename(source.name).replaceAll(RegExp(r'[^\w.\- ]'), '_');
      final destination = p.join(
          directory.path, '${DateTime.now().microsecondsSinceEpoch}_$safeName');
      await source.xFile.saveTo(destination);
      final copied = File(destination);
      final copiedSize = await copied.length();
      if (copiedSize != sourceSize || copiedSize <= 44) {
        if (await copied.exists()) await copied.delete();
        throw const AudioImportException(
            ImportFailure.damagedFile, '复制后校验失败，文件可能损坏');
      }
      return ImportedAudio(
          name: source.name, path: destination, size: copiedSize);
    } on FileSystemException catch (error) {
      final denied = error.osError?.errorCode == 13;
      throw AudioImportException(
          denied ? ImportFailure.permissionDenied : ImportFailure.copyFailed,
          denied ? '没有读取或写入文件的权限' : '复制文件失败，请重试');
    }
  }

  @override
  Future<bool> exists(String path) => File(path).exists();
}
