package com.chainlesschain.android.feature.ai

import androidx.activity.ComponentActivity
import dagger.hilt.android.AndroidEntryPoint

/**
 * Hilt-aware [ComponentActivity] host for `createAndroidComposeRule` in this
 * module's androidTest source set.
 *
 * See `:feature-knowledge`'s sibling `TestActivity.kt` KDoc for the broader
 * rationale (replaces never-importable `:app/MainActivity` reverse-dep that
 * the 10 stubbed AIConversationE2ETest tests referenced).
 *
 * Registered in `src/androidTest/AndroidManifest.xml`.
 */
@AndroidEntryPoint
class TestActivity : ComponentActivity()
