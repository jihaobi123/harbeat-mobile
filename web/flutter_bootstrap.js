{{flutter_js}}
{{flutter_build_config}}

// Keep preview updates visible even when an embedded browser caches app scripts.
for (const build of _flutter.buildConfig.builds) {
  if (build.mainJsPath) build.mainJsPath += '?v=20261102-cloud-candidate';
}
_flutter.loader.load();
