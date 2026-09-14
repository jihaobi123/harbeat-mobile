import 'media_storage_base.dart';
import 'media_storage_stub.dart' if (dart.library.io) 'media_storage_io.dart'
    as implementation;

export 'media_storage_base.dart';

MediaStorage createMediaStorage() => implementation.createMediaStorage();
