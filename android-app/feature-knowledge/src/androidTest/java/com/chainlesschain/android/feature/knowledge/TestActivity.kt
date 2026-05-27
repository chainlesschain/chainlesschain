package com.chainlesschain.android.feature.knowledge

import androidx.activity.ComponentActivity
import dagger.hilt.android.AndroidEntryPoint

/**
 * Hilt-aware [ComponentActivity] used as the host for `createAndroidComposeRule`
 * in this module's androidTest source set.
 *
 * Replaces the never-existent `:app/MainActivity` reverse-dependency that
 * Wave 2 quarantine investigation flagged (see memory
 * `android_quarantined_tests_llm_hallucinated.md`). The previous test files
 * used `createAndroidComposeRule<MainActivity>()` which referenced an
 * Activity in `:app`, but `:feature-knowledge`'s androidTest source set
 * cannot import from `:app` (reverse dep).
 *
 * The `@AndroidEntryPoint` annotation lets `hiltViewModel()` calls inside
 * the test's `setContent { ... }` Composable resolve through Hilt — the
 * androidTest source set's [FakeRemoteSkillProviderModule] /
 * [FakeSyncOutboundModule] provide the cross-module bindings that the
 * production `:app/RemoteModule` would normally supply.
 *
 * Registered in `src/androidTest/AndroidManifest.xml`.
 */
@AndroidEntryPoint
class TestActivity : ComponentActivity()
