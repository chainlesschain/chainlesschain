plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("com.google.dagger.hilt.android")
    id("com.google.devtools.ksp")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "com.chainlesschain.android.feature.knowledge"
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
    implementation(project(":core-ui"))
    implementation(project(":core-p2p")) // v1.1 W1: KnowledgeSyncApplier interface
    implementation(project(":data-knowledge"))

    // Kotlin Serialization
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")

    // Paging
    implementation("androidx.paging:paging-runtime-ktx:3.2.1")
    implementation("androidx.paging:paging-compose:3.2.1")

    // Hilt
    implementation("com.google.dagger:hilt-android:2.50")
    ksp("com.google.dagger:hilt-compiler:2.50")
    implementation("androidx.hilt:hilt-navigation-compose:1.1.0")

    // Logging
    implementation("com.jakewharton.timber:timber:5.0.1")

    // Testing
    testImplementation("junit:junit:4.13.2")
    testImplementation("io.mockk:mockk:1.13.9")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")
    testImplementation("androidx.arch.core:core-testing:2.2.0")
    testImplementation("org.jetbrains.kotlin:kotlin-test:1.9.22")

    // Instrumented testing — un-quarantines KnowledgeUITest.kt (was .kt.broken
    // in commit 4bfc8f474 because no androidTestImplementation block existed).
    // Pattern follows AuthRepositoryTest fix (commit 03026b79b) + Compose UI
    // test deps (compose-bom + ui-test-junit4 + ui-test-manifest). material-
    // icons-extended is already on the classpath transitively via :core-ui's
    // `api("androidx.compose.material:material-icons-extended")` line, so no
    // explicit dep needed here.
    //
    // Still quarantined in this module: KnowledgeE2ETest (uses :app's
    // MainActivity reverse-dep + never-existed `com.chainlesschain.android.
    // test.*` helpers); needs a module-local TestActivity rewrite.
    androidTestImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:core:1.5.0")
    androidTestImplementation("androidx.test:runner:1.5.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("org.jetbrains.kotlin:kotlin-test:1.9.22")
    androidTestImplementation(platform("androidx.compose:compose-bom:2024.02.00"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    // Even though :core-ui already declares `api("androidx.compose.material:
    // material-icons-extended")`, that transitive dep doesn't reach the
    // androidTest compile classpath — empirically verified 2026-05-20 (icons
    // PushPin/Favorite/FavoriteBorder/FormatBold/FormatItalic/Title still
    // unresolved after `--stop && clean` with only the transitive path).
    // Declare explicitly here to make the androidTest classpath self-sufficient.
    androidTestImplementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
