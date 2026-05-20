plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("com.google.devtools.ksp")
    id("com.google.dagger.hilt.android")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "com.chainlesschain.android.core.e2ee"
    compileSdk = 35

    defaultConfig {
        minSdk = 26

        // Hilt-aware test runner — swaps Application class to HiltTestApplication
        // so @HiltAndroidTest tests get DI injection at runtime. See
        // src/androidTest/.../HiltTestRunner.kt for the override.
        testInstrumentationRunner = "com.chainlesschain.android.core.e2ee.HiltTestRunner"
        consumerProguardFiles("consumer-rules.pro")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
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
}

dependencies {
    // Android Core
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")

    // Kotlin Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // Kotlinx Serialization
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")

    // Hilt Dependency Injection
    implementation("com.google.dagger:hilt-android:2.50")
    ksp("com.google.dagger:hilt-compiler:2.50")

    // Cryptography - Tink (Google's crypto library)
    implementation("com.google.crypto.tink:tink-android:1.15.0")

    // BouncyCastle (for Curve25519 support)
    implementation("org.bouncycastle:bcprov-jdk18on:1.77")

    // Logging
    implementation("com.jakewharton.timber:timber:5.0.1")

    // Testing
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")
    testImplementation("org.mockito.kotlin:mockito-kotlin:5.1.0")
    testImplementation("org.mockito:mockito-core:5.5.0")
    testImplementation("org.robolectric:robolectric:4.11")  // Android unit testing framework

    // Instrumented testing — un-quarantines E2EEIntegrationTest.kt (was
    // .kt.broken in commit 4bfc8f474 because no androidTestImplementation
    // block existed for the deps it actually needs). The Hilt-test deps
    // unlock @HiltAndroidTest + HiltAndroidRule compile-time. Runtime DI
    // (HiltTestApplication via a custom AndroidJUnitRunner) is NOT wired
    // here — the workflow's connectedAndroidTest will surface that when
    // the test actually runs on a device; out of Win-side compile scope.
    androidTestImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:core:1.5.0")
    androidTestImplementation("androidx.test:runner:1.5.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
    androidTestImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")
    androidTestImplementation("org.jetbrains.kotlin:kotlin-test:1.9.22")
    androidTestImplementation("com.google.dagger:hilt-android-testing:2.50")
    kspAndroidTest("com.google.dagger:hilt-android-compiler:2.50")
}

// Apply Jacoco configuration
apply(from = rootProject.file("jacoco-config.gradle.kts"))
