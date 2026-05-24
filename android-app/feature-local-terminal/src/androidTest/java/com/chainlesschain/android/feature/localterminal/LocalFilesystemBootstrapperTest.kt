package com.chainlesschain.android.feature.localterminal

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
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
    private val env = PtyEnvironment(context, bootstrapper)
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
    // Concurrency — trap #24 regression guard
    // -----------------------------------------------------------------------

    /**
     * Real-device repro of the 2026-05-24 race: two HubLocal cards each
     * launched a viewModelScope coroutine that called bootstrapper.bootstrap()
     * in parallel. Without the bootstrapMutex, thread A entered
     * extractCcCliIfPresent holding an open tarball FileOutputStream while
     * thread B re-entered wipeAndRecreate → prefixDir.deleteRecursively()
     * returned false (open file in the tree) → B threw IOException AND
     * partially wiped etc/+share/. A then wrote .bootstrap_version=6.
     * Permanent stuck state: next boot saw version match → skipped wipe →
     * writeStaticFiles ENOENT on etc/profile.
     *
     * Post-fix expectation: 8 concurrent callers all succeed, the on-disk
     * tree is intact (etc/profile present), and exactly one caller reports
     * fullExtract=true (the first to acquire the mutex on a clean tree).
     */
    @Test
    fun bootstrap_concurrentCallers_allSucceedAndTreeIntact() = runBlocking {
        val deferreds = (1..8).map {
            async(Dispatchers.IO) { bootstrapper.bootstrap() }
        }
        val results = deferreds.awaitAll()

        results.forEachIndexed { idx, r ->
            assertTrue(
                "concurrent caller #$idx must succeed, got ${r.exceptionOrNull()}",
                r.isSuccess
            )
        }
        val fullExtractCount = results.count { it.getOrThrow() }
        assertEquals(
            "exactly one caller should report fullExtract=true on clean tree",
            1, fullExtractCount
        )

        val prefix = bootstrapper.prefixDir
        assertTrue("etc/ must survive race", File(prefix, "etc").isDirectory)
        assertTrue("etc/profile must exist", File(prefix, "etc/profile").isFile)
        assertTrue("share/doc must survive race", File(prefix, "share/doc").isDirectory)
        assertTrue(".bootstrap_version must exist", File(prefix, ".bootstrap_version").isFile)
        assertEquals(
            BuildConfig.USR_VERSION,
            File(prefix, ".bootstrap_version").readText().trim()
        )
    }

    /**
     * Defense-in-depth: even if a pre-fix install left the device in the
     * stuck state (`.bootstrap_version` present + `etc/` wiped), the next
     * bootstrap call must self-heal via the mkdirs() in writeStaticFiles
     * rather than crash with ENOENT on etc/profile.
     */
    @Test
    fun bootstrap_recoversFromMissingEtcAfterVersionMatch() = runBlocking {
        // Bootstrap once cleanly so .bootstrap_version=USR_VERSION is on disk.
        bootstrapper.bootstrap().getOrThrow()
        // Simulate the pre-fix stuck state.
        File(bootstrapper.prefixDir, "etc").deleteRecursively()
        File(bootstrapper.prefixDir, "share").deleteRecursively()

        val result = bootstrapper.bootstrap()
        assertTrue(
            "self-heal bootstrap must succeed, got ${result.exceptionOrNull()}",
            result.isSuccess
        )
        // Version matched, so this is a relink-only run (fullExtract=false),
        // yet etc/ must have been re-created by the defensive mkdirs().
        assertEquals(false, result.getOrThrow())
        assertTrue(File(bootstrapper.prefixDir, "etc/profile").isFile)
    }

    /**
     * 2026-05-24 trap #24 v2 — instance-scoped Mutex failed under real-device
     * Hilt cross-module DI (PtyEnvironment / LocalSessionViewModel /
     * LocalCcRunner inject the same class through different module paths
     * and may produce >1 instance despite @Singleton). The fix moves the
     * mutex to `companion object` so it's process-wide regardless of
     * instance count.
     *
     * This test verifies the fix by explicitly constructing TWO
     * Bootstrapper instances and racing them. Pre-fix: both instances
     * could enter wipeAndRecreate concurrently and corrupt each other's
     * extract. Post-fix: companion `processBootstrapMutex` serialises
     * regardless of instance identity.
     *
     * Assertion: exactly ONE caller across both instances reports
     * fullExtract=true on a clean tree (the second caller — same or
     * different instance — sees `.bootstrap_version` already written
     * and takes the relink-only fast path).
     */
    @Test
    fun bootstrap_multiInstance_companionMutexSerialises() = runBlocking {
        val instanceA = LocalFilesystemBootstrapper(context)
        val instanceB = LocalFilesystemBootstrapper(context)
        // Sanity: prove the instances are distinct (HashCode differs).
        // If JIT optimises this away the test still works — the property
        // we care about is mutex serialisation, not instance distinctness.
        assertTrue(
            "instances must be distinct objects to exercise companion mutex",
            instanceA !== instanceB
        )

        val deferreds = (0..7).map { idx ->
            async(Dispatchers.IO) {
                val target = if (idx % 2 == 0) instanceA else instanceB
                target.bootstrap()
            }
        }
        val results = deferreds.awaitAll()

        results.forEachIndexed { idx, r ->
            assertTrue(
                "concurrent multi-instance caller #$idx must succeed, got ${r.exceptionOrNull()}",
                r.isSuccess
            )
        }
        val fullExtractCount = results.count { it.getOrThrow() }
        assertEquals(
            "exactly one caller across BOTH instances should report fullExtract=true; " +
                "race would surface as 2+ (each instance wipes once independently)",
            1, fullExtractCount
        )

        // Verify tree integrity — race would leave etc/ wiped by losing thread
        // mid-way through winning thread's extract.
        val prefix = instanceA.prefixDir  // same dir for both instances
        assertTrue("etc/ must survive multi-instance race", File(prefix, "etc").isDirectory)
        assertTrue("etc/profile must exist", File(prefix, "etc/profile").isFile)
        assertEquals(
            BuildConfig.USR_VERSION,
            File(prefix, ".bootstrap_version").readText().trim()
        )
    }

    /**
     * extractCcCliIfPresent atomicity — pre-fix, extract wrote directly to
     * `$PREFIX/lib/node_modules/chainlesschain/`, so a concurrent caller's
     * wipe would leave a half-deleted / half-rewritten module tree mixed
     * with the prior install's files. Real-device symptom: `hub.js`
     * ended up as the OLD commit's content (1286 lines) while `bin/` had
     * the NEW tgz content — making `cc hub ask --max-facts 20` fail with
     * `error: unknown option '--max-facts'` (Commander didn't know the
     * flag because the old hub.js didn't define it).
     *
     * Post-fix: extract goes to `chainlesschain.tmp/` first, then atomic
     * rename. If any caller is mid-extract the other waits at the
     * companion mutex; tree is always either prior good state or new
     * good state, never half.
     *
     * Assertion: after concurrent bootstrap() with cc bundle present,
     * `chainlesschain.tmp` does NOT exist on disk (rename succeeded or
     * the loser didn't even enter extract due to mutex).
     */
    @Test
    fun extractCcCli_noTmpResidueAfterConcurrentBootstrap() = runBlocking {
        // Skip cleanly if asset isn't shipped (Phase 0-4 baseline build).
        val tgzAsset = "local-terminal/cc-cli.tgz"
        val ccBundleShipped = try {
            context.assets.open(tgzAsset).use { it.read() != -1 }
        } catch (_: Exception) {
            false
        }
        if (!ccBundleShipped) {
            // Test is meaningless without bundled cc CLI; pass trivially.
            return@runBlocking
        }

        val deferreds = (1..6).map {
            async(Dispatchers.IO) { bootstrapper.bootstrap() }
        }
        deferreds.awaitAll().forEach {
            assertTrue("bootstrap must succeed", it.isSuccess)
        }

        val ccModuleParent = File(bootstrapper.prefixDir, "lib/node_modules")
        val tmpResidue = File(ccModuleParent, "chainlesschain.tmp")
        assertFalse(
            "chainlesschain.tmp must NOT exist after extract completes — " +
                "leftover indicates rename failed or exception aborted mid-extract",
            tmpResidue.exists()
        )

        // Spot-check that the real ccModule is intact (has src/ and bin/).
        val ccModule = File(ccModuleParent, "chainlesschain")
        assertTrue("chainlesschain/ must exist", ccModule.isDirectory)
        assertTrue(
            "chainlesschain/src/commands/ must exist (top-level extract complete)",
            File(ccModule, "src/commands").isDirectory
        )
        assertTrue(
            "chainlesschain/bin/chainlesschain.js must exist",
            File(ccModule, "bin/chainlesschain.js").isFile
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
