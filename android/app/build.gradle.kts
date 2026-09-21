plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

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
