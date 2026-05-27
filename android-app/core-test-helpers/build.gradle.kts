plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.chainlesschain.android.test"
    compileSdk = 35

    defaultConfig {
        minSdk = 26
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
}

// Shared test infrastructure module — `:core-test-helpers`.
//
// Why this module exists:
//   1. ComposeTestExtensions (clickOnText / typeTextInField / waitForText /
//      assertSnackbarMessage / waitForLoadingToComplete / clickBackButton, etc.)
//      previously lived only at `:app/src/androidTest/.../test/`, so feature
//      modules' androidTest source sets could not see them — this was the
//      root cause behind the "non-existent com.chainlesschain.android.test.*
//      helper package" referenced by the 18 stubbed AIConv/Knowledge E2E
//      tests. Now those extensions live in `:core-test-helpers/main` and are
//      consumable from any module that adds `androidTestImplementation(project(
//      ":core-test-helpers"))`.
//   2. Helper code lives in the `main` source set (not androidTest) so this
//      module ships as an ordinary Android library that downstream modules
//      can depend on; the consumer side picks the dep scope.
//   3. Compose UI testing artifacts (ui-test-junit4 / activity-compose) are
//      `api` so consumers get them transitively — they were redeclared in
//      every feature module previously.
dependencies {
    // Compose test infrastructure — api so consumers automatically get
    // ComposeTestRule / SemanticsMatcher / performTextInput / etc.
    api(platform("androidx.compose:compose-bom:2024.02.00"))
    api("androidx.compose.ui:ui-test-junit4")
    api("androidx.activity:activity-compose:1.8.2")
    // ui-test-manifest must be on the consuming module's debugImplementation
    // (it injects a debug-only Activity for createComposeRule); cannot be
    // transitively api'd from a library.

    // Coroutines for waitUntil polling helpers.
    api("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")
    api("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // JUnit4 rules (TestWatcher base for fixtures).
    api("junit:junit:4.13.2")
    api("androidx.test:core:1.5.0")

    // Room — for InMemoryDatabaseFixture's Room.inMemoryDatabaseBuilder.
    api("androidx.room:room-runtime:2.6.1")
    api("androidx.room:room-ktx:2.6.1")

    // Database entity / DAO types referenced by DatabaseFixture (FriendEntity,
    // PostEntity, etc.). Consumers also get :core-database transitively, which
    // matches what `androidTestImplementation(project(":core-database"))` used
    // to do at the per-feature level.
    api(project(":core-database"))

    // MockWebServer for NetworkSimulator (formerly only in :core-network's
    // androidTest source set, where no downstream feature could see it).
    api("com.squareup.okhttp3:mockwebserver:4.12.0")
}
