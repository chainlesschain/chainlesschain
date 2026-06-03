package com.chainlesschain.android.feature.ai

import android.app.Application
import android.content.Context
import androidx.test.runner.AndroidJUnitRunner
import dagger.hilt.android.testing.HiltTestApplication

/**
 * Custom AndroidJUnitRunner that swaps the test process's Application instance
 * for Hilt's HiltTestApplication — required for any @HiltAndroidTest in this
 * module's androidTest source set to actually receive injected dependencies
 * at runtime.
 *
 * Wire-up: this module's build.gradle.kts defaultConfig must declare
 *   testInstrumentationRunner = "com.chainlesschain.android.feature.ai.HiltTestRunner"
 *
 * See core-e2ee/.../HiltTestRunner.kt for the broader rationale.
 */
class HiltTestRunner : AndroidJUnitRunner() {
    override fun newApplication(
        cl: ClassLoader?,
        className: String?,
        context: Context?
    ): Application {
        return super.newApplication(cl, HiltTestApplication::class.java.name, context)
    }
}
