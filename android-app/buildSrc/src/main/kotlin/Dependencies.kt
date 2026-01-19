/**
 * 统一依赖版本管理
 * 所有依赖版本集中在这里管理,避免版本不一致问题
 */
object Versions {
    // Kotlin & Coroutines
    const val kotlin = "1.9.22"
    const val coroutines = "1.7.3"
    const val serialization = "1.6.3"

    // Android
    const val compileSdk = 35
    const val minSdk = 26
    const val targetSdk = 35
    const val buildTools = "34.0.0"

    // AndroidX Core
    const val coreKtx = "1.12.0"
    const val appcompat = "1.6.1"
    const val lifecycle = "2.7.0"
    const val activity = "1.8.2"
    const val datastore = "1.0.0"

    // Compose
    const val composeBom = "2024.02.00"
    const val composeCompiler = "1.5.8"
    const val navigation = "2.7.6"

    // Database
    const val room = "2.6.1"
    const val sqlcipher = "4.12.0"
    const val sqlite = "2.4.0"

    // Network
    const val retrofit = "2.11.0"
    const val okhttp = "4.12.0"

    // DI
    const val hilt = "2.50"
    const val hiltNavigationCompose = "1.1.0"

    // Security
    const val tink = "1.15.0"
    const val biometric = "1.1.0"

    // Crypto
    const val bouncycastle = "1.70"

    // Logging
    const val timber = "5.0.1"

    // Testing
    const val junit = "4.13.2"
    const val junitExt = "1.1.5"
    const val espresso = "3.5.1"
    const val mockk = "1.13.9"
    const val truth = "1.4.2"

    // Build Tools
    const val gradlePlugin = "8.5.2"
    const val ksp = "1.9.22-1.0.17"
}

object Libs {
    // Kotlin
    object Kotlin {
        const val stdlib = "org.jetbrains.kotlin:kotlin-stdlib:${Versions.kotlin}"
        const val coroutinesAndroid = "org.jetbrains.kotlinx:kotlinx-coroutines-android:${Versions.coroutines}"
        const val coroutinesCore = "org.jetbrains.kotlinx:kotlinx-coroutines-core:${Versions.coroutines}"
        const val serializationJson = "org.jetbrains.kotlinx:kotlinx-serialization-json:${Versions.serialization}"
    }

    // AndroidX Core
    object AndroidX {
        const val coreKtx = "androidx.core:core-ktx:${Versions.coreKtx}"
        const val appcompat = "androidx.appcompat:appcompat:${Versions.appcompat}"
        const val lifecycleRuntimeKtx = "androidx.lifecycle:lifecycle-runtime-ktx:${Versions.lifecycle}"
        const val lifecycleRuntimeCompose = "androidx.lifecycle:lifecycle-runtime-compose:${Versions.lifecycle}"
        const val lifecycleViewModelKtx = "androidx.lifecycle:lifecycle-viewmodel-ktx:${Versions.lifecycle}"
        const val activityCompose = "androidx.activity:activity-compose:${Versions.activity}"
        const val datastorePreferences = "androidx.datastore:datastore-preferences:${Versions.datastore}"
    }

    // Compose
    object Compose {
        const val bom = "androidx.compose:compose-bom:${Versions.composeBom}"
        const val ui = "androidx.compose.ui:ui"
        const val uiGraphics = "androidx.compose.ui:ui-graphics"
        const val uiToolingPreview = "androidx.compose.ui:ui-tooling-preview"
        const val material3 = "androidx.compose.material3:material3"
        const val materialIconsExtended = "androidx.compose.material:material-icons-extended"
        const val navigation = "androidx.navigation:navigation-compose:${Versions.navigation}"

        // Debug
        const val uiTooling = "androidx.compose.ui:ui-tooling"
        const val uiTestManifest = "androidx.compose.ui:ui-test-manifest"

        // Testing
        const val uiTestJunit4 = "androidx.compose.ui:ui-test-junit4"
    }

    // Database
    object Room {
        const val runtime = "androidx.room:room-runtime:${Versions.room}"
        const val ktx = "androidx.room:room-ktx:${Versions.room}"
        const val compiler = "androidx.room:room-compiler:${Versions.room}"
        const val testing = "androidx.room:room-testing:${Versions.room}"
    }

    object Database {
        const val sqlcipher = "net.zetetic:sqlcipher-android:${Versions.sqlcipher}"
        const val sqliteKtx = "androidx.sqlite:sqlite-ktx:${Versions.sqlite}"
    }

    // Network
    object Network {
        const val retrofit = "com.squareup.retrofit2:retrofit:${Versions.retrofit}"
        const val retrofitConverterGson = "com.squareup.retrofit2:converter-gson:${Versions.retrofit}"
        const val retrofitConverterSerialization = "com.squareup.retrofit2:converter-kotlinx-serialization:${Versions.retrofit}"
        const val okhttp = "com.squareup.okhttp3:okhttp:${Versions.okhttp}"
        const val okhttpLoggingInterceptor = "com.squareup.okhttp3:logging-interceptor:${Versions.okhttp}"
    }

    // Dependency Injection
    object Hilt {
        const val android = "com.google.dagger:hilt-android:${Versions.hilt}"
        const val compiler = "com.google.dagger:hilt-compiler:${Versions.hilt}"
        const val navigationCompose = "androidx.hilt:hilt-navigation-compose:${Versions.hiltNavigationCompose}"
    }

    // Security
    object Security {
        const val tink = "com.google.crypto.tink:tink-android:${Versions.tink}"
        const val biometric = "androidx.biometric:biometric:${Versions.biometric}"
        const val bouncycastle = "org.bouncycastle:bcprov-jdk15on:${Versions.bouncycastle}"
    }

    // Logging
    object Logging {
        const val timber = "com.jakewharton.timber:timber:${Versions.timber}"
    }

    // Testing
    object Testing {
        const val junit = "junit:junit:${Versions.junit}"
        const val junitExt = "androidx.test.ext:junit:${Versions.junitExt}"
        const val espressoCore = "androidx.test.espresso:espresso-core:${Versions.espresso}"
        const val mockk = "io.mockk:mockk:${Versions.mockk}"
        const val mockkAndroid = "io.mockk:mockk-android:${Versions.mockk}"
        const val coroutinesTest = "org.jetbrains.kotlinx:kotlinx-coroutines-test:${Versions.coroutines}"
        const val truth = "com.google.truth:truth:${Versions.truth}"
    }
}

object Plugins {
    const val androidApplication = "com.android.application"
    const val androidLibrary = "com.android.library"
    const val kotlinAndroid = "org.jetbrains.kotlin.android"
    const val kotlinSerialization = "org.jetbrains.kotlin.plugin.serialization"
    const val hilt = "com.google.dagger.hilt.android"
    const val ksp = "com.google.devtools.ksp"
}
