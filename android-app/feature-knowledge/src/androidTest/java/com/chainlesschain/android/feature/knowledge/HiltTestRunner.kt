package com.chainlesschain.android.feature.knowledge

import android.app.Application
import android.content.Context
import androidx.test.runner.AndroidJUnitRunner
import dagger.hilt.android.testing.HiltTestApplication

/**
 * Custom AndroidJUnitRunner — swaps Application class to HiltTestApplication
 * so @HiltAndroidTest tests get DI injection at runtime.
 *
 * Wire-up: build.gradle.kts defaultConfig
 *   testInstrumentationRunner = "com.chainlesschain.android.feature.knowledge.HiltTestRunner"
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
