package com.chainlesschain.android.core.e2ee

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
 *   testInstrumentationRunner = "com.chainlesschain.android.core.e2ee.HiltTestRunner"
 *
 * Without this runner, @HiltAndroidTest tests compile but silently fail at
 * runtime because Hilt's component graph isn't bootstrapped (the test app
 * is a vanilla Application instead of HiltTestApplication).
 *
 * Duplicated per-module rather than shared via :core-testing because AGP
 * library modules don't naturally cross-consume androidTest source sets;
 * the alternative (testFixtures or putting helper code in main/) trades
 * complexity for ~15 lines of duplication.
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
