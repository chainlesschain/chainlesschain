package com.chainlesschain.android.feature.localterminal

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Phase 2 instrumented tests for [LocalFilesystemBootstrapper] and
 * [PtyEnvironment], plus end-to-end "bootstrap → spawn mksh via
 * `$PREFIX/bin/mksh` → echo works" validation.
 */
@RunWith(AndroidJUnit4::class)
class LocalFilesystemBootstrapperTest {

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val bootstrapper = LocalFilesystemBootstrapper(context)
    private val env = PtyEnvironment(bootstrapper)
    private val scope = CoroutineScope(SupervisorJob())

    @Before
    fun wipePrefixForCleanRun() {
        // Ensure each test starts fresh — the previous test's $PREFIX/HOME
        // would otherwise persist across the test class run.
        if (bootstrapper.prefixDir.exists()) {
            bootstrapper.prefixDir.deleteRecursively()
        }
    }

    @After
    fun teardown() {
        scope.cancel()
    }

    // -----------------------------------------------------------------------
    // Bootstrap layout & idempotency
    // -----------------------------------------------------------------------

    @Test
    fun bootstrap_firstRun_extractsFullLayout() = runBlocking {
        val result = bootstrapper.bootstrap()
        assertTrue("first bootstrap should succeed", result.isSuccess)
        assertEquals("first run should report full extract", true, result.getOrThrow())

        val prefix = bootstrapper.prefixDir
        assertTrue(File(prefix, "bin").isDirectory)
        assertTrue(File(prefix, "etc").isDirectory)
        assertTrue(File(prefix, "lib").isDirectory)
        assertTrue(File(prefix, "share/doc").isDirectory)
        assertTrue(File(prefix, "tmp").isDirectory)
        assertTrue(File(prefix, "etc/profile").isFile)
        assertTrue(File(prefix, "etc/mkshrc").isFile)
        assertTrue(File(prefix, "etc/motd").isFile)
        assertTrue(File(prefix, ".bootstrap_version").isFile)
        assertEquals(
            BuildConfig.USR_VERSION,
            File(prefix, ".bootstrap_version").readText().trim()
        )

        assertTrue("HOME should be created", bootstrapper.homeDir.isDirectory)
    }

    @Test
    fun bootstrap_secondRun_isRelinkOnly() = runBlocking {
        bootstrapper.bootstrap().getOrThrow()
        // Touch a file inside $PREFIX/home to verify it survives the second run.
        val markerInHome = File(bootstrapper.homeDir, "test_marker")
        markerInHome.writeText("phase-2")

        val result = bootstrapper.bootstrap()
        assertTrue(result.isSuccess)
        assertEquals(
            "second bootstrap with same USR_VERSION should report relink-only (false)",
            false,
            result.getOrThrow()
        )
        assertEquals(
            "HOME data must persist across relink-only bootstrap",
            "phase-2",
            markerInHome.readText()
        )
    }

    @Test
    fun bootstrap_versionMismatch_triggersFullExtract() = runBlocking {
        bootstrapper.bootstrap().getOrThrow()
        // Simulate a stale install by overwriting the version sentinel.
        File(bootstrapper.prefixDir, ".bootstrap_version").writeText("0")

        val result = bootstrapper.bootstrap()
        assertEquals(true, result.getOrThrow())
        assertEquals(
            BuildConfig.USR_VERSION,
            File(bootstrapper.prefixDir, ".bootstrap_version").readText().trim()
        )
    }

    // -----------------------------------------------------------------------
    // Symlink wiring
    // -----------------------------------------------------------------------

    @Test
    fun bootstrap_libSymlinks_pointAtApkNativeLibDir() = runBlocking {
        bootstrapper.bootstrap().getOrThrow()

        val libMksh = File(bootstrapper.prefixDir, "lib/libmksh.so")
        assertTrue("lib/libmksh.so symlink should exist", libMksh.exists())

        val resolved = libMksh.toPath().toRealPath().toFile()
        val expectedPrefix = File(context.applicationInfo.nativeLibraryDir).absolutePath
        assertTrue(
            "lib/libmksh.so should resolve to APK nativeLibraryDir, got ${resolved.absolutePath}",
            resolved.absolutePath.startsWith(expectedPrefix)
        )
    }

    @Test
    fun bootstrap_binMkshAndSh_pointAtLibMksh() = runBlocking {
        bootstrapper.bootstrap().getOrThrow()

        val mksh = File(bootstrapper.prefixDir, "bin/mksh")
        val sh = File(bootstrapper.prefixDir, "bin/sh")
        assertTrue("bin/mksh should exist", mksh.exists())
        assertTrue("bin/sh should exist", sh.exists())
        // Both must be executable through the symlink chain.
        assertTrue("bin/mksh should be canExecute", mksh.canExecute())
        assertTrue("bin/sh should be canExecute", sh.canExecute())
    }

    @Test
    fun bootstrap_toyboxSymlinks_skipWhenLibtoyboxAbsent() = runBlocking {
        // Windows-host build doesn't produce libtoybox.so, so the toybox
        // bin symlinks should be skipped without erroring. Detect by checking
        // whether libtoybox.so is in nativeLibraryDir; if not, expect ls etc
        // to be absent.
        val nativeDir = File(context.applicationInfo.nativeLibraryDir)
        val hasToybox = File(nativeDir, "libtoybox.so").exists()

        bootstrapper.bootstrap().getOrThrow()

        val lsSymlink = File(bootstrapper.prefixDir, "bin/ls")
        if (hasToybox) {
            assertTrue("bin/ls should exist when libtoybox is built", lsSymlink.exists())
        } else {
            assertFalse(
                "bin/ls should be absent when libtoybox missing (Windows dev box build)",
                lsSymlink.exists()
            )
        }
    }

    // -----------------------------------------------------------------------
    // PtyEnvironment
    // -----------------------------------------------------------------------

    @Test
    fun envp_containsExpectedDefaults() = runBlocking {
        bootstrapper.bootstrap().getOrThrow()
        val envp = env.envp()
        val envMap = envp.associate { entry ->
            val idx = entry.indexOf('=')
            entry.substring(0, idx) to entry.substring(idx + 1)
        }
        val prefix = bootstrapper.prefixDir.absolutePath

        assertEquals("$prefix/bin:/system/bin:/system/xbin", envMap["PATH"])
        assertEquals(bootstrapper.homeDir.absolutePath, envMap["HOME"])
        assertEquals("$prefix/tmp", envMap["TMPDIR"])
        assertEquals("$prefix/bin/mksh", envMap["SHELL"])
        assertEquals("xterm-256color", envMap["TERM"])
        assertEquals("en_US.UTF-8", envMap["LANG"])
    }

    @Test
    fun envp_extraOverridesDefaults() = runBlocking {
        bootstrapper.bootstrap().getOrThrow()
        val envp = env.envp(mapOf("TERM" to "dumb", "CUSTOM" to "x"))
        val termEntries = envp.filter { it.startsWith("TERM=") }
        assertEquals("TERM should appear exactly once", 1, termEntries.size)
        assertEquals("TERM=dumb", termEntries.first())
        assertTrue("CUSTOM=x should appear", envp.any { it == "CUSTOM=x" })
    }

    // -----------------------------------------------------------------------
    // End-to-end: bootstrap → spawn via $PREFIX/bin/mksh → echo works
    // -----------------------------------------------------------------------

    @Test
    fun mksh_via_prefixBinSymlink_runsEcho() = runBlocking {
        bootstrapper.bootstrap().getOrThrow()
        val client = LocalPtyClient(scope)
        val cfg = LocalPtyClient.Config(
            executable = env.mkshExecutable,
            argv = arrayOf(env.mkshExecutable, "-c", "echo via-prefix"),
            envp = env.envp(mapOf("TERM" to "dumb")),
            cwd = null,
        )

        val startResult = client.start(cfg)
        assertTrue(
            "spawn via \$PREFIX/bin/mksh should succeed: ${startResult.exceptionOrNull()}",
            startResult.isSuccess
        )

        val outputs = mutableListOf<ByteArray>()
        val collector = scope.launch {
            client.stdoutFlow.collect { outputs.add(it) }
        }

        val exit = withTimeout(5_000) { client.exitFlow.first() }
        assertEquals(0, exit)
        withTimeoutOrNull(500) { delay(500) }
        collector.cancel()

        val combined = outputs.fold(StringBuilder()) { sb, bytes ->
            sb.append(String(bytes, Charsets.UTF_8))
        }.toString()
        assertTrue(
            "stdout via \$PREFIX/bin/mksh should contain 'via-prefix'; got: $combined",
            combined.contains("via-prefix")
        )

        client.shutdown()
    }

    @Test
    fun mksh_login_loadsProfileAndExposesPathExports() = runBlocking {
        bootstrapper.bootstrap().getOrThrow()
        val client = LocalPtyClient(scope)
        // mksh -l loads $ENV (= /usr/etc/profile). Then run a command that
        // prints $PATH and $PREFIX — both should reflect the profile values.
        val cfg = LocalPtyClient.Config(
            executable = env.mkshExecutable,
            argv = arrayOf(env.mkshExecutable, "-l", "-c", "echo PATH=\$PATH; echo PREFIX=\$PREFIX"),
            envp = env.envp(mapOf("TERM" to "dumb")),
            cwd = null,
        )
        client.start(cfg).getOrThrow()

        val outputs = mutableListOf<ByteArray>()
        val collector = scope.launch {
            client.stdoutFlow.collect { outputs.add(it) }
        }
        val exit = withTimeout(5_000) { client.exitFlow.first() }
        assertEquals(0, exit)
        withTimeoutOrNull(500) { delay(500) }
        collector.cancel()

        val combined = outputs.fold(StringBuilder()) { sb, bytes ->
            sb.append(String(bytes, Charsets.UTF_8))
        }.toString()
        assertTrue(
            "login profile should set PATH=\$PREFIX/bin:...; got: $combined",
            combined.contains("PATH=") && combined.contains("/bin")
        )
        assertTrue(
            "PREFIX should be exported by profile; got: $combined",
            combined.contains("PREFIX=") && combined.contains(bootstrapper.prefixDir.absolutePath)
        )

        client.shutdown()
    }
}
