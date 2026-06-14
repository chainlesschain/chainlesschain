plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("com.google.dagger.hilt.android")
    id("com.google.devtools.ksp")
}

android {
    namespace = "com.chainlesschain.android.feature.localterminal"
    compileSdk = 35

    // Pinned to GitHub-hosted ubuntu-latest preinstalled NDK (same as feature-ai).
    // Local dev: run `sdkmanager "ndk;25.2.9519653" "cmake;3.22.1"` once.
    ndkVersion = "25.2.9519653"

    defaultConfig {
        // posix_spawn + POSIX_SPAWN_SETSID are __INTRODUCED_IN(28) in Android
        // NDK spawn.h — minSdk=26 (the rest of the app's baseline) won't even
        // see the function declarations at compile time. Bump just this module
        // to 28 (Android 9 Pie, released 2018; >95% device market in 2026).
        // Phase 5 Lite/Full APK variants will inherit minSdk=28 for local
        // terminal feature; the rest of ChainlessChain keeps 26.
        // See docs/design/Android_Local_Terminal.md §5 Trap 7 for the
        // posix_spawn vs fork+exec design choice.
        minSdk = 28
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Phase 2 bootstrap version — increment when $PREFIX layout / profile
        // / mkshrc / motd content changes. LocalFilesystemBootstrapper compares
        // this against the on-disk .bootstrap_version sentinel and re-extracts
        // when they differ.
        buildConfigField("String", "USR_VERSION", "\"28\"")

        // Phase 0.1 baseline ABIs. arm64-v8a is primary (modern devices),
        // armeabi-v7a kept for compatibility, x86_64 for emulator testing only.
        // Per-ABI splits are configured in :app at App Bundle time.
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64")
        }

        externalNativeBuild {
            cmake {
                cppFlags += "-std=c++17"
                cFlags += "-std=c11"
                arguments += listOf(
                    "-DANDROID_STL=c++_shared",
                    "-DANDROID_TOOLCHAIN=clang",
                    // Position-Independent Executable required since Android 5
                    // (Trap 2 — see docs/design/Android_Local_Terminal.md §5).
                    "-DANDROID_PIE=ON",
                )
            }
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    testOptions {
        unitTests {
            isReturnDefaultValues = true
        }
    }

    buildFeatures {
        // Enable BuildConfig so LocalFilesystemBootstrapper can read USR_VERSION.
        buildConfig = true
        // Phase 3 — Compose UI for LocalTerminalScreen.
        compose = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.8"
    }

    // W^X requires libmksh.so / libtoybox.so to be extracted to
    // /data/app/<pkg>/lib/<abi>/ so ProcessBuilder can exec them.
    // AGP 8+ defaults to extractNativeLibs=false (APK-resident dlopen only),
    // which works for libpty_jni.so but blocks executable use of the shells.
    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }
}

dependencies {
    implementation(project(":core-common"))

    // Hilt
    implementation("com.google.dagger:hilt-android:2.50")
    ksp("com.google.dagger:hilt-compiler:2.50")

    // Coroutines (StateFlow / SharedFlow for pty stdout streaming)
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // Logging
    implementation("com.jakewharton.timber:timber:5.0.1")

    // Phase 3 — Compose UI for LocalTerminalScreen
    val composeBom = platform("androidx.compose:compose-bom:2024.02.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.runtime:runtime")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.activity:activity-compose:1.8.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.7.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.7.0")

    // Testing
    testImplementation("junit:junit:4.13.2")
    testImplementation("io.mockk:mockk:1.13.9")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")
    testImplementation("org.jetbrains.kotlin:kotlin-test:1.9.22")

    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test:runner:1.5.2")
    androidTestImplementation("androidx.test:rules:1.5.0")
}
