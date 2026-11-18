/// Build-time public gateway. Never contains /api or private device addresses.
/// The new-origin APK is a staged artifact until the migration cutover notice.
class CloudEndpoints {
  static const newOrigin = 'https://47.108.118.177';
  static const publicAddress = String.fromEnvironment('HARBEAT_BASE_URL',
      defaultValue: String.fromEnvironment('HARBEAT_API_BASE_URL',
          defaultValue: newOrigin));
  static const mediaAddress = String.fromEnvironment('HARBEAT_NAS_BASE_URL',
      defaultValue: publicAddress);

  static Uri root(String value) {
    final uri = Uri.parse(value.trim());
    if (!['http', 'https'].contains(uri.scheme) ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment ||
        !['', '/'].contains(uri.path) ||
        (uri.scheme == 'http' &&
            !['localhost', '127.0.0.1', '::1'].contains(uri.host))) {
      throw const FormatException('服务地址只填写协议和主机，不添加 /api。');
    }
    return Uri.parse(uri.origin);
  }

  static Uri get publicUri => root(publicAddress);
  static Uri get mediaUri => root(mediaAddress);

  static bool acceptsReservationBackup(String saved, Uri target) {
    final source = Uri.tryParse(saved.trim());
    if (source == null ||
        !['http', 'https'].contains(source.scheme) ||
        source.host.isEmpty ||
        source.userInfo.isNotEmpty ||
        source.hasQuery ||
        source.hasFragment ||
        !['', '/'].contains(source.path)) {
      return false;
    }
    if (source.origin == target.origin) return true;
    // The migration preserves workspace data. Validate access on the target
    // before persisting a restored credential; never apply to custom hosts.
    return target.origin == newOrigin &&
        ['http://8.136.120.255', 'https://8.136.120.255']
            .contains(source.origin);
  }
}
