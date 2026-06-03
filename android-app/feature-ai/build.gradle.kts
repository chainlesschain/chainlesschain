plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("com.google.dagger.hilt.android")
    id("com.google.devtools.ksp")
}

android {
    namespace = "com.chainlesschain.android.feature.ai"
    compileSdk = 35
    // Pinned to GitHub-hosted ubuntu-latest preinstalled NDK (W4a baseline).
    // Local dev: run `sdkmanager "ndk;25.2.9519653" "cmake;3.22.1"` once.
    ndkVersion = "25.2.9519653"

    defaultConfig {
        minSdk = 26
        // Hilt-aware test runner — see src/androidTest/.../HiltTestRunner.kt.
        testInstrumentationRunner = "com.chainlesschain.android.feature.ai.HiltTestRunner"

        // W4a: only arm64-v8a + armeabi-v7a ship.
        //   - x86_64 emulator skipped (whisper.cpp x86 SIMD off; rebuild cost ↑↑)
        //   - per-ABI splits handled at app module level (App Bundle).
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a")
        }

        externalNativeBuild {
            cmake {
                cppFlags += "-std=c++17"
                arguments += listOf(
                    "-DANDROID_STL=c++_shared",
                    "-DANDROID_TOOLCHAIN=clang",
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

    buildFeatures {
        compose = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.8"
    }

    testOptions {
        unitTests {
            isReturnDefaultValues = true
        }
    }
}

dependencies {
    implementation(project(":core-common"))
    implementation(project(":core-database"))
    implementation(project(":core-network"))
    implementation(project(":core-p2p"))
    implementation(project(":core-security"))
    implementation(project(":core-ui"))
    implementation(project(":data-ai"))
    // Phase 5.2 — CcExecService uses LocalFilesystemBootstrapper + PtyEnvironment
    // from :feature-local-terminal to resolve $PREFIX/bin/node + chainlesschain.js
    // and to source the (filtered) env for cc subprocess. Only :core-common is shared.
    implementation(project(":feature-local-terminal"))

    // Hilt
    implementation("com.google.dagger:hilt-android:2.50")
    ksp("com.google.dagger:hilt-compiler:2.50")
    implementation("androidx.hilt:hilt-navigation-compose:1.1.0")

    // DataStore
    implementation("androidx.datastore:datastore-preferences:1.0.0")

    // DocumentFile
    implementation("androidx.documentfile:documentfile:1.0.1")

    // YAML parsing (SKILL.md frontmatter)
    implementation("org.yaml:snakeyaml:2.2")

    // ONNX Runtime for ML model inference
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.17.0")

    // Logging
    implementation("com.jakewharton.timber:timber:5.0.1")

    // Testing
    testImplementation("junit:junit:4.13.2")
    testImplementation("io.mockk:mockk:1.13.9")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")
    testImplementation("org.jetbrains.kotlin:kotlin-test:1.9.22")
    testImplementation("androidx.paging:paging-common:3.2.1")
    testImplementation("androidx.arch.core:core-testing:2.2.0")

    // Instrumented testing — un-quarantines AI_RAG_IntegrationTest.kt (was
    // .kt.broken in commit 4bfc8f474 because no androidTestImplementation block
    // existed) + AIConversationUITest.kt (same quarantine).
    //
    // AI_RAG is a pure Room DAO test (no Compose UI). AIConversationUITest
    // uses Compose UI testing (createComposeRule + onNodeWithText), Material3
    // experimental APIs (ExposedDropdownMenuBox), and extended material icons
    // (Send/ContentCopy/Refresh) — hence the compose-bom + ui-test-junit4 +
    // ui-test-manifest + material-icons-extended additions below.
    //
    // Still quarantined in this module:
    //   - AIConversationE2ETest.kt.broken — uses :app's MainActivity reverse-
    //     dep + never-existed `com.chainlesschain.android.test.*` helpers;
    //     needs module-local TestActivity + test-helper module rewrite.
    androidTestImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:core:1.5.0")
    androidTestImplementation("androidx.test:runner:1.5.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")
    androidTestImplementation("org.jetbrains.kotlin:kotlin-test:1.9.22")
    androidTestImplementation(platform("androidx.compose:compose-bom:2024.02.00"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    // Shared Compose test extensions (clickOnText / typeTextInField /
    // waitForText / etc.) — formerly only at :app/.../test/. See
    // :core-test-helpers/build.gradle.kts KDoc.
    androidTestImplementation(project(":core-test-helpers"))
    // material-icons-extended needed even though :core-ui declares it as
    // api() — the transitive dep does NOT reach androidTest compile classpath.
    // Empirically verified via KnowledgeUITest unquarantine (commit 6afedbbf8).
    androidTestImplementation("androidx.compose.material:material-icons-extended")
    // Hilt deps for AIConversationE2ETest @HiltAndroidTest / HiltAndroidRule
    // compile-time. Runtime Hilt setup (HiltTestApplication via custom
    // AndroidJUnitRunner) is NOT wired — same caveat as core-e2ee's E2EE test.
    androidTestImplementation("com.google.dagger:hilt-android-testing:2.50")
    kspAndroidTest("com.google.dagger:hilt-android-compiler:2.50")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
