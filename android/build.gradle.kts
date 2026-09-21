allprojects {
    // Flutter 3.41's integration_test still requests Espresso 3.2.0, whose
    // duplicate namespaces fail AGP 9's manifest validation.
    configurations.configureEach {
        resolutionStrategy.eachDependency {
            if (requested.group == "androidx.test.espresso") {
                useVersion("3.6.1")
            }
        }
    }
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    if (name == "reactive_ble_mobile") {
        afterEvaluate {
            // Plugin 5.5.0 pins API 33, below its resolved AndroidX dependencies.
            extensions.configure<com.android.build.gradle.LibraryExtension> {
                compileSdk = 36
            }
        }
    }
    // audio_session 0.2.4 assumes AGP 9 always enables built-in Kotlin.
    // This Flutter project uses AGP's legacy Kotlin compatibility mode.
    if (name == "audio_session" &&
        providers.gradleProperty("android.builtInKotlin").orNull == "false") {
        pluginManager.withPlugin("com.android.library") {
            pluginManager.apply("org.jetbrains.kotlin.android")
        }
    }
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
