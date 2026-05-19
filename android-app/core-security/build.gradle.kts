plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("com.google.dagger.hilt.android")
    id("com.google.devtools.ksp")
}

android {
    namespace = "com.chainlesschain.android.core.security"
    compileSdk = 35

    defaultConfig {
        minSdk = 26
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
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
    implementation(project(":core-common"))

    // AndroidX Security
    api("androidx.security:security-crypto:1.1.0")

    // Tink Crypto
    api("com.google.crypto.tink:tink-android:1.15.0")

    // Biometric
    api("androidx.biometric:biometric:1.1.0")

    // Hilt
    implementation("com.google.dagger:hilt-android:2.50")
    ksp("com.google.dagger:hilt-compiler:2.50")

    // Timber Logging
    implementation("com.jakewharton.timber:timber:5.0.1")

    // Testing — unit
    testImplementation("junit:junit:4.13.2")
    testImplementation("io.mockk:mockk:1.13.9")
    testImplementation("org.jetbrains.kotlin:kotlin-test:1.9.22")

    // Testing — instrumented (androidTest/SecurePreferencesTest.kt needs these
    // to even compile; the test file has been red at compile-time for a long
    // time because the deps were missing, masked by core-e2ee's dex failure
    // surfacing first in the same workflow).
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test:core:1.5.0")
    androidTestImplementation("androidx.test:runner:1.5.2")
    androidTestImplementation("org.jetbrains.kotlin:kotlin-test:1.9.22")
}
