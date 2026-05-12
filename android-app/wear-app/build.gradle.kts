plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
}

/**
 * v1.2 #20 P0.2 — Wear OS module。
 *
 * 独立 APK，与 phone app 同 applicationId（设计文档 §10）。Wearable Data Layer
 * 通过 applicationId 配对手机/手表实例，因此**必须**保持一致；release
 * signing key 也要同。
 *
 * 不依赖 phone 模块的 feature/core libs（手表内存极有限，Wear OS 4 推荐保持
 * <30 MB）。仅 Wear Compose + 自家 Wearable Data Layer wrapper（Phase 1+
 * 加 :core-wear-sync 共享 message-id 协议常量）。
 *
 * Hilt 暂不引入 — Phase 0 scaffold 内连依赖图都极简，先用手工 DI；Phase 2
 * 接 BiometricPrompt 再评估是否需要。
 */
android {
    namespace = "com.chainlesschain.android.wear"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.chainlesschain.android"
        minSdk = 26  // Wear OS 3.0+
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0-wear"
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            isDebuggable = true
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
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

    buildFeatures {
        compose = true
        buildConfig = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.8"
    }

    packaging {
        resources {
            excludes += setOf(
                "/META-INF/{AL2.0,LGPL2.1}",
                "/META-INF/DEPENDENCIES",
                "/META-INF/LICENSE*",
                "/META-INF/NOTICE*",
            )
        }
    }
}

dependencies {
    // Kotlin + coroutines
    implementation("org.jetbrains.kotlin:kotlin-stdlib:1.9.22")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")

    // AndroidX core
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
    implementation("androidx.activity:activity-compose:1.8.2")

    // Wear Compose (separate from phone Compose — Material is wear-specific)
    val composeBom = platform("androidx.compose:compose-bom:2024.02.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.wear.compose:compose-material:1.3.1")
    implementation("androidx.wear.compose:compose-foundation:1.3.1")
    implementation("androidx.wear:wear:1.3.0")

    // Google Play Services — Wearable Data Layer
    implementation("com.google.android.gms:play-services-wearable:18.2.0")

    // v1.2 Wear Phase 2 — biometric for 高风险 approval (sign / Critical alerts)
    implementation("androidx.biometric:biometric:1.1.0")
    // BiometricPrompt 需要 FragmentActivity (来自 androidx.fragment)
    implementation("androidx.fragment:fragment-ktx:1.6.2")
    // Tasks.await() — coroutine bridge for play-services Task<T>
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.7.3")

    // Timber for logging consistency with phone module
    implementation("com.jakewharton.timber:timber:5.0.1")

    // Tests
    testImplementation("junit:junit:4.13.2")
    testImplementation("io.mockk:mockk:1.13.9")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")
    testImplementation("org.jetbrains.kotlin:kotlin-test:1.9.22")
    testImplementation("org.robolectric:robolectric:4.11")
    testImplementation("androidx.test:core-ktx:1.5.0")
    testImplementation("androidx.test.ext:junit:1.1.5")
}
