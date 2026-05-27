import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("com.google.dagger.hilt.android")
    id("com.google.devtools.ksp")
    id("io.gitlab.arturbosch.detekt") version "1.23.4"
    jacoco
}

// Hilt configuration for multi-module builds
hilt {
    enableAggregatingTask = true
}

// Detekt configuration
detekt {
    config.setFrom(files("${rootProject.projectDir}/detekt.yml"))
    buildUponDefaultConfig = true
}

// Check if google-services.json exists
val hasGoogleServices = listOf(
    "google-services.json",
    "src/debug/google-services.json",
    "src/release/google-services.json"
).map { file(it) }.any { it.exists() }

// Apply Firebase plugins only if google-services.json exists
if (hasGoogleServices) {
    apply(plugin = "com.google.gms.google-services")
    apply(plugin = "com.google.firebase.crashlytics")
    logger.lifecycle("✓ Firebase enabled (google-services.json found)")
} else {
    logger.warn("⚠ Firebase disabled (google-services.json not found)")
    logger.warn("  To enable Firebase: Add google-services.json to app/")
}

android {
    namespace = "com.chainlesschain.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.chainlesschain.android"
        // Bumped 26 → 28 (Android 9 Pie) on 2026-05-18 to align with
        // :feature-local-terminal (its native posix_spawn / POSIX_SPAWN_SETSID
        // are __INTRODUCED_IN(28) — see feature-local-terminal/build.gradle.kts
        // line 17-25). The previous 26 setting caused manifest merger to fail
        // since the Phase 2 commit 3da1f78c4 (2026-05-17) wired local-terminal
        // into :app, but android-ci.yml's continue-on-error masks hid the
        // failure. Audited 2026-05-18 alongside the false-green CI sweep.
        // API 26-27 market share <3% in 2026; Phase 5 Lite variant (without
        // local-terminal) can be revisited if a 26-baseline ship target appears.
        minSdk = 28  // Android 9 Pie
        targetSdk = 35  // Android 15
        versionCode = 503096
        versionName = "5.0.3.96"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        testInstrumentationRunnerArguments["clearPackageData"] = "true"

        vectorDrawables {
            useSupportLibrary = true
        }

        // Multi-language support
        // AGP resourceConfigurations 按精确 qualifier 匹配："zh" 只保留 values-zh/，
        // 把 values-zh-rCN/ 等带地区的都过滤掉。必须用 "-r" 前缀显式列出地区。
        resourceConfigurations.addAll(listOf("en", "zh-rCN", "zh-rTW", "zh-rHK"))

        // NDK support
        ndk {
            abiFilters.addAll(listOf("armeabi-v7a", "arm64-v8a"))
        }
    }

    signingConfigs {
        create("release") {
            // Read signing config from keystore.properties
            val keystorePropertiesFile = rootProject.file("keystore.properties")
            if (keystorePropertiesFile.exists()) {
                val keystoreProperties = Properties()
                keystoreProperties.load(FileInputStream(keystorePropertiesFile))

                storeFile = rootProject.file(keystoreProperties["release.storeFile"] as String)
                storePassword = keystoreProperties["release.storePassword"] as String
                keyAlias = keystoreProperties["release.keyAlias"] as String
                keyPassword = keystoreProperties["release.keyPassword"] as String
            } else {
                // If config file doesn't exist, use debug keystore (for development/testing only)
                logger.warn("keystore.properties not found. Using debug keystore for release build.")
                logger.warn("Please create keystore.properties from keystore.properties.template for production builds.")
                storeFile = file("../keystore/debug.keystore")
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }

    buildTypes {
        debug {
            isDebuggable = true
            isMinifyEnabled = false
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-DEBUG"
        }

        release {
            // R8 minify + resource shrink temporarily disabled (v5.0.3.91+) — AGP 8.5.2
            // R8 backend `:app:minifyReleaseWithR8` 在 .88/.89/.90 三个 release run 都
            // 4 分钟内炸 java.util.ConcurrentModificationException，已 land 的 enableR8.
            // fullMode=false (gradle.properties) + -dontoptimize (proguard) + systemProp
            // r8.threadCount=1 + heap 8→6 GB + workers.max=1 都没拦住。upstream R8 8.5.x
            // 已知 race，估计要等 AGP 8.7+ 升 R8 后再开。trade-off: APK ~+30% 体积，
            // alpha track 接受。memory [[android_release_r8_minify_hotfix_chain]] trap
            // tier 升级到 "all 4 workarounds failed → disable minify"。
            //
            // Watchdog override: `./gradlew assembleRelease -Pminify.override=true`
            // re-enables minify+shrink. Driven by .github/workflows/android-release-
            // precheck.yml r8-fullmode-probe (advisory, continue-on-error). 探针
            // 转绿 = AGP/R8 upstream race 可能修了，可以考虑翻默认回 true。详见
            // docs/internal/hidden-risk-traps.md #19 + memory
            // [[android_release_r8_minify_hotfix_chain]]。
            val minifyOverride = (project.findProperty("minify.override") as? String) == "true"
            isMinifyEnabled = minifyOverride
            isShrinkResources = minifyOverride
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.getByName("release")
        }
    }

    // Phase 7.4: App Bundle configuration - on-demand delivery
    bundle {
        // Language-based splits
        language {
            enableSplit = true
        }

        // Density-based splits
        density {
            enableSplit = true
        }

        // CPU architecture-based splits
        abi {
            enableSplit = true
        }
    }

    // Phase 7.4: APK Splits configuration - architecture-based packaging
    splits {
        // CPU architecture-based splits
        abi {
            isEnable = true
            reset()
            include("armeabi-v7a", "arm64-v8a")
            // Also generate universal APK (for testing)
            isUniversalApk = true
        }

        // Density-based splits — disabled. Runtime resource selection on Android 5.0+
        // already picks correct density assets; per-density APK splits added 10 release
        // artifacts (5 densities × 2 ABIs) for negligible size win. AAB still does
        // density delivery via the bundle{} block above for Play Store users.
        density {
            isEnable = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        encoding = "UTF-8"
    }

    kotlinOptions {
        jvmTarget = "17"
        freeCompilerArgs += listOf(
            "-opt-in=kotlin.RequiresOptIn",
            "-opt-in=kotlinx.coroutines.ExperimentalCoroutinesApi",
            "-opt-in=kotlinx.coroutines.FlowPreview",
            "-opt-in=androidx.compose.material3.ExperimentalMaterial3Api",
            "-Xcontext-receivers",
            "-XXLanguage:+BreakContinueInInlineLambdas"
        )
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.8"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
            excludes += "/META-INF/LICENSE*"
            excludes += "/META-INF/NOTICE*"
            // Phase 7.4: Exclude more redundant files to reduce APK size
            excludes += "/META-INF/*.kotlin_module"
            excludes += "/META-INF/DEPENDENCIES"
            excludes += "/META-INF/INDEX.LIST"
            excludes += "/*.txt"
            excludes += "/*.properties"
            // Exclude duplicate JetBrains annotations
            pickFirsts += "META-INF/versions/9/module-info.class"
        }
        jniLibs {
            pickFirsts += "**/libc++_shared.so"
            // Phase 4 — feature-local-terminal needs lib*.so extracted to disk
            // for ProcessBuilder.exec() to work (mksh/toybox are executables
            // renamed to .so; W^X requires the lib/<abi>/ extracted path).
            // App-level packaging overrides library-level, so flipping here
            // is mandatory. Documented as Phase 1+ trap in
            // ~/.claude/.../memory/android_native_lib_extract_w_x.md.
            //
            // Cost: APK download size +~5-10 MB (uncompressed .so) across all
            // ABIs. Install footprint unchanged.
            useLegacyPackaging = true
        }
    }

    testOptions {
        execution = "ANDROIDX_TEST_ORCHESTRATOR"
        animationsDisabled = true
        unitTests {
            isIncludeAndroidResources = true
            isReturnDefaultValues = true
        }
    }

    lint {
        // Don't abort build on lint errors during Stage 1 development
        abortOnError = false
        // Treat warnings as warnings, not errors
        warningsAsErrors = false
        // Generate HTML report for CI artifacts
        htmlReport = true
        htmlOutput = file("${project.layout.buildDirectory.get()}/reports/lint-results-debug.html")
        // Generate XML report for CI processing
        xmlReport = true
        xmlOutput = file("${project.layout.buildDirectory.get()}/reports/lint-results-debug.xml")
        // Disable specific checks that are not critical for development
        disable += setOf(
            "HardcodedText",           // Chinese strings in code - will fix later
            "ObsoleteLintCustomCheck"  // Custom lint check warnings
        )
    }
}

// JaCoCo configuration for code coverage
jacoco {
    toolVersion = "0.8.11"
}

tasks.register<JacocoReport>("jacocoE2ETestReport") {
    dependsOn("connectedDebugAndroidTest")

    reports {
        xml.required.set(true)
        html.required.set(true)
        html.outputLocation.set(layout.buildDirectory.dir("reports/jacoco/jacocoE2ETestReport"))
    }

    val fileFilter = listOf(
        "**/R.class",
        "**/R\$*.class",
        "**/BuildConfig.*",
        "**/Manifest*.*",
        "**/*Test*.*",
        "android/**/*.*",
        "**/data/model/*",
        "**/di/*",
        "**/*_Factory*",
        "**/*_HiltModules*",
        "**/*_Provide*"
    )

    val debugTree = fileTree("${project.layout.buildDirectory.get()}/tmp/kotlin-classes/debug") {
        exclude(fileFilter)
    }

    val mainSrc = "${project.projectDir}/src/main/java"

    sourceDirectories.setFrom(files(mainSrc))
    classDirectories.setFrom(files(debugTree))
    executionData.setFrom(fileTree(project.layout.buildDirectory) {
        include("outputs/code_coverage/debugAndroidTest/connected/**/*.ec")
    })
}

configurations.all {
    // Exclude old annotations-java5 to avoid duplicate classes with annotations:23.0.0
    exclude(group = "org.jetbrains", module = "annotations-java5")
    // Exclude google-webrtc to avoid conflict with threema webrtc-android (from core-p2p)
    exclude(group = "org.webrtc", module = "google-webrtc")
    // Exclude old bouncycastle to use newer version (1.77)
    exclude(group = "org.bouncycastle", module = "bcprov-jdk15on")
}

dependencies {
    // Core modules
    implementation(project(":core-common"))
    implementation(project(":core-database"))
    implementation(project(":core-did"))
    implementation(project(":core-e2ee"))
    implementation(project(":core-network"))
    implementation(project(":core-p2p"))
    implementation(project(":core-security"))
    implementation(project(":core-ui"))

    // Feature modules
    implementation(project(":feature-auth"))
    implementation(project(":feature-knowledge"))
    implementation(project(":feature-ai"))
    implementation(project(":feature-p2p"))
    implementation(project(":feature-project"))
    implementation(project(":feature-file-browser"))
    implementation(project(":feature-local-terminal"))

    // Kotlin
    implementation("org.jetbrains.kotlin:kotlin-stdlib:1.9.22")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")

    // AndroidX Core
    implementation("androidx.core:core-ktx:1.12.0")
    // appcompat 1.6.1 提供 AppCompatDelegate.setApplicationLocales（per-app locale，API 33+ 走系统机制，更低版本 AndroidX 兜底）
    implementation("androidx.appcompat:appcompat:1.6.1")
    // #21 P4: SAF folder picker — DocumentFile.fromTreeUri for folder display name
    implementation("androidx.documentfile:documentfile:1.0.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.7.0")
    implementation("androidx.lifecycle:lifecycle-process:2.7.0")
    implementation("androidx.activity:activity-compose:1.8.2")

    // DataStore
    implementation("androidx.datastore:datastore-preferences:1.0.0")

    // v1.2 #1 Android Auto — CarAppService + templates。1.4.0 是 androidx.car.app
    // 当前 stable，要求 minSdk 23（与 :app 一致）。
    implementation("androidx.car.app:app:1.4.0")

    // Jetpack Compose
    val composeBom = platform("androidx.compose:compose-bom:2024.02.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    // material-icons-extended provided transitively via core-ui

    // Navigation
    implementation("androidx.navigation:navigation-compose:2.7.6")

    // Hilt
    implementation("com.google.dagger:hilt-android:2.50")
    ksp("com.google.dagger:hilt-compiler:2.50")
    implementation("androidx.hilt:hilt-navigation-compose:1.1.0")
    implementation("androidx.hilt:hilt-work:1.1.0")
    ksp("androidx.hilt:hilt-compiler:1.1.0")

    // Room (for CommandHistoryDatabase in remote module)
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")

    // Timber
    implementation("com.jakewharton.timber:timber:5.0.1")

    // Coil for image loading
    implementation("io.coil-kt:coil-compose:2.6.0")
    implementation("io.coil-kt:coil-gif:2.6.0")
    implementation("io.coil-kt:coil-svg:2.6.0")

    // SplashScreen API (Android 12+)
    implementation("androidx.core:core-splashscreen:1.0.1")

    // Startup library for delayed initialization
    implementation("androidx.startup:startup-runtime:1.1.1")

    // Baseline Profile
    implementation("androidx.profileinstaller:profileinstaller:1.3.1")

    // Jsoup for HTML parsing (link preview)
    implementation("org.jsoup:jsoup:1.17.2")

    // A3 — Ktor embedded HTTP server for local Ollama-compatible LLM endpoint.
    // The Kotlin-hosted LLM (kotlinllamacpp JNI) hosts /api/chat + /api/tags on
    // 127.0.0.1:<port>. in-APK cc OllamaClient reads CC_HUB_OLLAMA_URL env →
    // hits this loopback. ktor 2.3.x line stays on Kotlin 1.9.x compat.
    implementation("io.ktor:ktor-server-core:2.3.13")
    implementation("io.ktor:ktor-server-cio:2.3.13")
    implementation("io.ktor:ktor-server-content-negotiation:2.3.13")
    implementation("io.ktor:ktor-serialization-kotlinx-json:2.3.13")
    // A3 — kotlinllamacpp (JNI llama.cpp) was the original v0.1 plan but per
    // 2026-05-23 dep audit (memory `pdh_llm_native_dep_audit.md`) no published
    // coord exists for that lib. Pivot: use Google's MediaPipe LLM Inference
    // task (com.google.mediapipe:tasks-genai). It's Google-maven-published
    // with prebuilt arm64-v8a .so, supports Gemma-3 1B int4 (~555 MB .task
    // file). MediaPipeLlmEngine implements LlmInferenceEngine; LlmModule binds
    // it as default. KotlinLlamaCppEngine kept as code path for future GGUF
    // route once we have a published llama.cpp Android dep, but no longer the
    // active engine.
    implementation("com.google.mediapipe:tasks-genai:0.10.35")

    // ===== v0.31.0 new dependencies =====

    // QR code generation
    implementation("com.google.zxing:core:3.5.3")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")

    // CameraX (QR code scanning)
    implementation("androidx.camera:camera-core:1.3.1")
    implementation("androidx.camera:camera-camera2:1.3.1")
    implementation("androidx.camera:camera-lifecycle:1.3.1")
    implementation("androidx.camera:camera-view:1.3.1")

    // ML Kit barcode scanning
    implementation("com.google.mlkit:barcode-scanning:17.2.0")

    // Play Services Location — FusedLocationProviderClient（M3 D2 LocationTagger 真实装）
    implementation("com.google.android.gms:play-services-location:21.2.0")

    // v1.2 #20 P0.2 Wear Phase 1 — phone → watch Data Layer message forwarding.
    // Wear-app (separate APK) has its own copy of this dep; phone needs it too
    // so MessageClient.sendMessage is available from WearPushForwarder.
    implementation("com.google.android.gms:play-services-wearable:18.2.0")
    // Provides Tasks→suspend bridge (kotlinx.coroutines.tasks.await) used by
    // WearPushForwarder to await getNodeClient.connectedNodes / sendMessage.
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.7.3")

    // Permission management
    implementation("com.google.accompanist:accompanist-permissions:0.32.0")

    // Markdown rendering (rich text editor)
    implementation("io.noties.markwon:core:4.6.2")
    implementation("io.noties.markwon:editor:4.6.2")
    implementation("io.noties.markwon:syntax-highlight:4.6.2")
    implementation("io.noties.markwon:image-coil:4.6.2")

    // ===== Phase 1: WebRTC remote control =====
    // WebRTC comes transitively from core-p2p module (ch.threema:webrtc-android:134.0.0)

    // BouncyCastle for DID crypto
    implementation("org.bouncycastle:bcprov-jdk18on:1.77")

    // §2.3 D6.2 — IMAP for 4 email vendor (QQ/Gmail/163/Outlook).
    // Jakarta Mail (Eclipse) — Android-friendly fork with no java.beans dep.
    // 1.6.7 is the last 1.x version (Android-compatible); 2.x switched to
    // jakarta.mail.* package which Android's older AGP refuses.
    implementation("com.sun.mail:android-mail:1.6.7")
    implementation("com.sun.mail:android-activation:1.6.7")

    // Paging Compose
    implementation("androidx.paging:paging-compose:3.2.1")

    // ===== Firebase Crashlytics =====
    // Only include if google-services.json exists
    if (hasGoogleServices) {
        implementation(platform("com.google.firebase:firebase-bom:32.7.0"))
        implementation("com.google.firebase:firebase-crashlytics-ktx")
        implementation("com.google.firebase:firebase-analytics-ktx")
    }

    // Testing
    testImplementation("junit:junit:4.13.2")
    testImplementation("io.mockk:mockk:1.13.9")
    testImplementation("io.mockk:mockk-android:1.13.9")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")
    testImplementation("org.jetbrains.kotlin:kotlin-test:1.9.22")
    testImplementation("app.cash.turbine:turbine:1.0.0")
    testImplementation("androidx.arch.core:core-testing:2.2.0")

    // Robolectric for Android unit tests (DIDSignerTest, etc.)
    testImplementation("org.robolectric:robolectric:4.11")
    testImplementation("androidx.test:core:1.5.0")
    testImplementation("androidx.test:core-ktx:1.5.0")
    testImplementation("androidx.test.ext:junit:1.1.5")

    // v1.2 #1 Android Auto — SessionController + TestCarContext for Screen unit tests
    testImplementation("androidx.car.app:app-testing:1.4.0")
    // Real org.json for JVM unit tests — Android SDK stub returns defaults
    // (isReturnDefaultValues=true) which makes JSONObject silently lose data,
    // breaking SignalingRpcClientTest / RemoteOperateViewModelTest.
    testImplementation("org.json:json:20240303")
    // A8 v0.1 — MockWebServer in JVM tests for BilibiliApiClient (HTTP parsing
    // logic). Already in androidTestImplementation for instrumented tests, but
    // running the same logic in JVM unit tests is ~10x faster and doesn't need
    // a device. Same artifact, just registered in two configurations.
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")

    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    androidTestImplementation("androidx.test:runner:1.5.2")
    androidTestImplementation("androidx.test:orchestrator:1.4.2")
    androidTestImplementation("io.mockk:mockk-android:1.13.9")
    androidTestImplementation("app.cash.turbine:turbine:1.0.0")

    androidTestUtil("androidx.test:orchestrator:1.4.2")

    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")

    // LeakCanary 暂时移除 —— 它会自己加一个桌面 launcher 图标（"Leaks"），
    // 在并行装多个 debug app 时桌面很乱。需要排查内存泄漏时再加回这一行。
    // debugImplementation("com.squareup.leakcanary:leakcanary-android:2.13")
}
