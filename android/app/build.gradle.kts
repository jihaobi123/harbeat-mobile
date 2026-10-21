import groovy.json.JsonSlurper
import java.io.File
import java.security.MessageDigest

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Audio assets are generated before APK packaging, never downloaded by Gradle.
// An old bundle after a TypeScript update must fail rather than silently ship.
val verifyRealtimeAssets by tasks.registering {
    group = "verification"
    description = "Verify source-bound offline audio engine assets prepared by tools/build_realtime.py"
    doLast {
        val repository = rootProject.projectDir.parentFile
        val bundle = file("src/main/assets/realtime")
        val manifest = bundle.resolve("mobile-build.json")
        check(manifest.isFile) { "Missing audio engine. Run python tools/build_realtime.py --download before building the APK." }
        @Suppress("UNCHECKED_CAST")
        val data = JsonSlurper().parse(manifest) as Map<String, Any?>
        check(data["schema"] == "harbeat.android-engine-build.v2") { "Audio bundle is outdated. Run python tools/build_realtime.py." }
        fun verify(entries: Any?, base: File) {
            val files = entries as? Map<*, *> ?: error("Invalid audio bundle manifest")
            check(files.isNotEmpty()) { "Empty audio bundle manifest" }
            files.forEach { (name, expected) ->
                val asset = base.resolve(name.toString()).canonicalFile
                check(asset.toPath().startsWith(base.canonicalFile.toPath()) && asset.isFile) { "Missing audio build input: $name" }
                val digest = MessageDigest.getInstance("SHA-256")
                asset.inputStream().use { input ->
                    val buffer = ByteArray(1024 * 1024)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        digest.update(buffer, 0, count)
                    }
                }
                val actual = digest.digest().joinToString("") { "%02x".format(it) }
                check(actual == expected) { "Stale or damaged audio asset: $name. Run python tools/build_realtime.py." }
            }
        }
        verify(data["files"], bundle)
        verify(data["sourceFiles"], repository)
        val recordedSources = (data["sourceFiles"] as Map<*, *>).keys.map { it.toString() }
            .filter { it.startsWith("vendor/realtime-v3/src/") }.toSet()
        val currentSources = repository.resolve("vendor/realtime-v3/src").walkTopDown()
            .filter { it.isFile }.map { it.relativeTo(repository).invariantSeparatorsPath }.toSet()
        check(recordedSources == currentSources) { "Audio source files were added/removed after bundling. Run python tools/build_realtime.py." }
    }
}
tasks.named("preBuild").configure { dependsOn(verifyRealtimeAssets) }

// Install a locally signed preview alongside an existing differently signed APK.
// Local builds default to a separate package. Production requires an explicit
// -PharbeatPreview=false; Flutter's installer may uninstall a conflicting ID.
val isPreviewBuild = providers.gradleProperty("harbeatPreview").orElse("true").get() != "false"
val isQaBuild = providers.gradleProperty("harbeatQa").orNull == "true" ||
    providers.gradleProperty("target").orNull?.replace('\\', '/')?.contains("integration_test/") == true

android {
    namespace = "com.example.harbeat"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.example.harbeat"
        if (isQaBuild) applicationIdSuffix = ".nativeqa"
        else if (isPreviewBuild) applicationIdSuffix = ".preview"
        manifestPlaceholders["appLabel"] = if (isQaBuild) "HarBeat Native QA" else if (isPreviewBuild) "HarBeat Preview" else "harbeat"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    implementation("androidx.webkit:webkit:1.15.0")
}

android.androidResources.noCompress += "flac"
