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
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

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
    // existed). Pure Room DAO test, no Compose UI needed — minimal dep set.
    //
    // Still quarantined in this module:
    //   - AIConversationUITest.kt.broken — same author's hallucinated
    //     MessageEntity schema + Compose structural bugs (ExposedDropdownMenu
    //     experimental API / invalid `var by` delegate / @Composable invocation
    //     context). Needs deeper Compose-knowledgeable rewrite; can't be done
    //     by AuthRepositoryTest-style dep patch alone.
    //   - AIConversationE2ETest.kt.broken — uses :app's MainActivity reverse-
    //     dep + never-existed `com.chainlesschain.android.test.*` helpers;
    //     needs module-local TestActivity + test-helper module.
    androidTestImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:core:1.5.0")
    androidTestImplementation("androidx.test:runner:1.5.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")
    androidTestImplementation("org.jetbrains.kotlin:kotlin-test:1.9.22")
}
