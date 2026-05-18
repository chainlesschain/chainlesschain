package com.chainlesschain.android.feature.localterminal

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Phase 0.5 integration smoke — validates that the Phase 0 NDK toolchain
 * actually produced working Android binaries that execute on a real device /
 * emulator.
 *
 * What this test proves:
 *
 *  1. `libpty_jni.so` is loadable from a Kotlin-side JNI bridge (verifies
 *     the placeholder symbol path Kotlin → C linker → libpty_jni.so → log).
 *  2. `libmksh.so` is present at `<app>/lib/<abi>/libmksh.so` after APK install
 *     (Android 10+ W^X requires this exact path naming for exec to work).
 *  3. `libmksh.so` actually executes — running `libmksh.so -c "echo hello"`
 *     should print exactly `"hello\n"` and exit 0.
 *
 * This is the bridge between Phase 0 ("source compiles and binaries produced")
 * and Phase 1 ("PTY can spawn a real shell child"). If this test fails, do not
 * proceed to Phase 1.
 *
 * Required execution environment:
 *
 *  - Connected emulator or real Android device (API 26+; matches feature module
 *    minSdk).
 *  - Run via: `./gradlew :feature-local-terminal:connectedDebugAndroidTest`
 *  - Or in CI ubuntu-latest with AVD prepared
 *  - Cannot run on host JVM (this test exercises real OS process spawning).
 */
@RunWith(AndroidJUnit4::class)
class LocalTerminalSmokeTest {

    @Test
    fun ptyJniPlaceholderLoadsAndReportsVersion() {
        val bridge = LocalTerminalNative()
        val version = bridge.nativeVersion()
        // The placeholder returns this exact string. When Phase 1.1 lands, this
        // assertion will likely change to a real version constant.
        assertEquals("phase-0.1-skeleton", version)
    }

    @Test
    fun mkshIsInstalledInNativeLibDir() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val mkshPath = File(context.applicationInfo.nativeLibraryDir, "libmksh.so")
        assertTrue(
            "libmksh.so should be at ${mkshPath.absolutePath} after APK install. " +
                "If missing: Phase 0.2 build broke, or testInstrumentationRunner is not " +
                "picking up the merged native libs.",
            mkshPath.exists()
        )
        assertTrue(
            "libmksh.so should be executable from W^X-whitelisted lib/<abi>/ path",
            mkshPath.canExecute()
        )
    }

    @Test
    fun mkshExecutesAndPrintsHello() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val mkshPath = File(context.applicationInfo.nativeLibraryDir, "libmksh.so")
        assertTrue("libmksh.so prerequisite missing", mkshPath.exists())

        val proc = ProcessBuilder(mkshPath.absolutePath, "-c", "echo hello")
            .redirectErrorStream(true)
            .start()

        val output = proc.inputStream.bufferedReader().readText()
        val exitCode = proc.waitFor()

        assertEquals(
            "mksh -c 'echo hello' should print 'hello\\n' (got: '$output')",
            "hello\n",
            output
        )
        assertEquals(
            "mksh should exit 0 after a successful echo",
            0,
            exitCode
        )
    }

    @Test
    fun mkshIdentifiesAsMirOSShell() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val mkshPath = File(context.applicationInfo.nativeLibraryDir, "libmksh.so")
        assertTrue("libmksh.so prerequisite missing", mkshPath.exists())

        // mksh KSH_VERSION reports the upstream version banner. R59c → contains
        // "MIRBSD KSH R59c". This validates we built the actual MirOS Korn Shell
        // and not, e.g., a stub or fallback shell.
        val proc = ProcessBuilder(
            mkshPath.absolutePath,
            "-c",
            "echo \"\$KSH_VERSION\""
        )
            .redirectErrorStream(true)
            .start()

        val output = proc.inputStream.bufferedReader().readText().trim()
        val exitCode = proc.waitFor()

        assertEquals(0, exitCode)
        assertTrue(
            "KSH_VERSION should announce MIRBSD KSH (got: '$output')",
            output.contains("MIRBSD KSH", ignoreCase = true)
        )
    }
}
