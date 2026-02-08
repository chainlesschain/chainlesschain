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
        minSdk = 26  // Android 8.0
        targetSdk = 35  // Android 15
        versionCode = 32
        versionName = "0.32.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        testInstrumentationRunnerArguments["clearPackageData"] = "true"

        vectorDrawables {
            useSupportLibrary = true
        }

        // Multi-language support
        resourceConfigurations.addAll(listOf("zh", "en"))

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

                storeFile = file(keystoreProperties["release.storeFile"] as String)
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
            isMinifyEnabled = true
            isShrinkResources = true
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

        // Density-based splits
        density {
            isEnable = true
            reset()
            include("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
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
            // Phase 7.4: Keep only necessary CPU architectures
            // Use new compression method
            useLegacyPackaging = false
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

    // Kotlin
    implementation("org.jetbrains.kotlin:kotlin-stdlib:1.9.22")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.2")

    // AndroidX Core
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.7.0")
    implementation("androidx.lifecycle:lifecycle-process:2.7.0")
    implementation("androidx.activity:activity-compose:1.8.2")

    // DataStore
    implementation("androidx.datastore:datastore-preferences:1.0.0")

    // Jetpack Compose
    val composeBom = platform("androidx.compose:compose-bom:2024.02.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")

    // Navigation
    implementation("androidx.navigation:navigation-compose:2.7.6")

    // Hilt
    implementation("com.google.dagger:hilt-android:2.50")
    ksp("com.google.dagger:hilt-compiler:2.50")
    implementation("androidx.hilt:hilt-navigation-compose:1.1.0")

    // Timber
    implementation("com.jakewharton.timber:timber:5.0.1")

    // Coil for image loading
    implementation("io.coil-kt:coil-compose:2.5.0")
    implementation("io.coil-kt:coil-gif:2.5.0")
    implementation("io.coil-kt:coil-svg:2.5.0")

    // SplashScreen API (Android 12+)
    implementation("androidx.core:core-splashscreen:1.0.1")

    // Startup library for delayed initialization
    implementation("androidx.startup:startup-runtime:1.1.1")

    // Baseline Profile
    implementation("androidx.profileinstaller:profileinstaller:1.3.1")

    // Jsoup for HTML parsing (link preview)
    implementation("org.jsoup:jsoup:1.17.2")

    // ===== v0.31.0 new dependencies =====

    // QR code generation
    implementation("com.google.zxing:core:3.5.2")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")

    // CameraX (QR code scanning)
    implementation("androidx.camera:camera-core:1.3.1")
    implementation("androidx.camera:camera-camera2:1.3.1")
    implementation("androidx.camera:camera-lifecycle:1.3.1")
    implementation("androidx.camera:camera-view:1.3.1")

    // ML Kit barcode scanning
    implementation("com.google.mlkit:barcode-scanning:17.2.0")

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
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")
    testImplementation("app.cash.turbine:turbine:1.0.0")

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

    // LeakCanary - Memory leak detection (Debug only)
    debugImplementation("com.squareup.leakcanary:leakcanary-android:2.13")
}
