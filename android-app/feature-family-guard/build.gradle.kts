plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("com.google.dagger.hilt.android")
    id("com.google.devtools.ksp")
}

// FAMILY-01 scaffold: see docs/design/AI陪学_v0.1_ticket_tree.md.
// Modeled after :feature-hooks (clean minimal template); intentionally NO native
// build, NO ML deps — those join in later FAMILY-* tickets if needed.
android {
    namespace = "com.chainlesschain.android.feature.familyguard"
    compileSdk = 35

    defaultConfig {
        // Aligned with :app minSdk 28 (lifted 26 → 28 on 2026-05-18 for
        // :feature-local-terminal posix_spawn). family-guard depends on neither,
        // but matching :app avoids a downstream merge conflict warning.
        minSdk = 28
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // FAMILY-02: Room schema export — diff via git lets us audit migration
        // chain correctness at PR time. Mirrors :core-database/build.gradle.kts.
        ksp {
            arg("room.schemaLocation", "$projectDir/schemas")
            arg("room.incremental", "true")
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
    implementation(project(":core-ui"))
    // FAMILY-02: KeyManager.getDatabaseKey() for SQLCipher passphrase.
    // Shared key with ChainlessChainDatabase is intentional (same encrypted
    // SharedPreferences slot); a dedicated key派生 lands when M6 Companion
    // TEE Vault ships (see docs/design/AI陪学_主文档.md §3.6).
    implementation(project(":core-security"))

    // Kotlin + Coroutine 标配 (FAMILY-01 ticket scope)
    implementation("org.jetbrains.kotlin:kotlin-stdlib:1.9.22")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")

    // Compose 标配
    implementation(platform("androidx.compose:compose-bom:2024.02.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.navigation:navigation-compose:2.7.6")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.7.0")

    // Hilt 标配
    implementation("com.google.dagger:hilt-android:2.50")
    ksp("com.google.dagger:hilt-compiler:2.50")
    implementation("androidx.hilt:hilt-navigation-compose:1.1.0")

    // FAMILY-02: Room + SQLCipher — version + artifact IDs mirror
    // :core-database/build.gradle.kts so a future upgrade can happen lockstep.
    val roomVersion = "2.6.1"
    implementation("androidx.room:room-runtime:$roomVersion")
    implementation("androidx.room:room-ktx:$roomVersion")
    ksp("androidx.room:room-compiler:$roomVersion")
    implementation("net.zetetic:sqlcipher-android:4.12.0")
    implementation("androidx.sqlite:sqlite-ktx:2.4.0")

    // Logging
    implementation("com.jakewharton.timber:timber:5.0.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("io.mockk:mockk:1.13.9")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")
    testImplementation("org.jetbrains.kotlin:kotlin-test:1.9.22")
    // FAMILY-02: Room in-memory DB + Robolectric for schema-shape unit tests.
    testImplementation("androidx.room:room-testing:$roomVersion")
    testImplementation("org.robolectric:robolectric:4.11")
    testImplementation("androidx.test:core:1.5.0")
    testImplementation("androidx.test.ext:junit:1.1.5")

    debugImplementation("androidx.compose.ui:ui-tooling")
}
