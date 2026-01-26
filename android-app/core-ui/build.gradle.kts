plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.chainlesschain.android.core.ui"
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

    buildFeatures {
        compose = true
        buildConfig = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.8"
    }
}

dependencies {
    implementation(project(":core-common"))

    // Compose BOM
    val composeBom = platform("androidx.compose:compose-bom:2024.02.00")
    api(composeBom)

    // Compose UI
    api("androidx.compose.ui:ui")
    api("androidx.compose.ui:ui-graphics")
    api("androidx.compose.ui:ui-tooling-preview")
    api("androidx.compose.material3:material3")
    api("androidx.compose.material:material-icons-extended")

    // Coil图片加载
    api("io.coil-kt:coil-compose:2.6.0")
    api("io.coil-kt:coil-svg:2.6.0")
    api("io.coil-kt:coil-gif:2.6.0")

    // 图片缩放（用于图片预览）
    api("net.engawapg.lib:zoomable:1.6.1")

    // QR Code generation
    api("com.google.zxing:core:3.5.3")

    // Markdown rendering - using native Compose Text (no external dependency)

    // Navigation
    api("androidx.navigation:navigation-compose:2.7.6")

    // Lifecycle
    api("androidx.lifecycle:lifecycle-runtime-compose:2.7.0")
    api("androidx.lifecycle:lifecycle-viewmodel-compose:2.7.0")

    // Testing
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
