package com.chainlesschain.android.pdh.social.common

import org.junit.After
import org.junit.Before
import org.junit.Test
import java.io.File
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Phase B0 — JVM unit cover for [DbCohortCopier].
 *
 * What we cover (Win + CI runnable):
 *  - Shell-injection guard ([DbCohortCopier.validateSourcePath]) rejects
 *    obvious metacharacters; production usage is hard-coded paths but
 *    defense-in-depth matters since collectors could grow input-driven
 *    paths later
 *  - Script shape ([DbCohortCopier.buildScript]) matches the WeChat /
 *    QQ legacy collectors byte-for-byte so a real device run produces
 *    identical su output — important for vendor SELinux compat
 *  - Cohort copy success / failure / no-root paths via fake runner
 *  - cleanup() handles missing files gracefully (returns Unit, never
 *    throws — used in `finally` style error recovery)
 *
 * What we DON'T cover:
 *  - Real `su` execution (covered by Phase 1+ platform real-device E2E)
 *  - SELinux label remapping under MIUI/HyperOS (Trap #26 candidate;
 *    only visible on real devices with vendor builds)
 */
class DbCohortCopierTest {

    private lateinit var tempDir: File

    @Before
    fun setUp() {
        tempDir = createTempDir(prefix = "cohort-copier-")
    }

    @After
    fun tearDown() {
        tempDir.deleteRecursively()
    }

    // ─── Path validation (shell injection defense) ─────────────────────────

    @Test
    fun `validateSourcePath rejects blank`() {
        assertNotNull(DbCohortCopier.validateSourcePath(""))
        assertNotNull(DbCohortCopier.validateSourcePath("   "))
    }

    @Test
    fun `validateSourcePath rejects relative paths`() {
        val err = DbCohortCopier.validateSourcePath("relative/path/foo.db")
        assertNotNull(err)
        assertContains(err, "absolute")
    }

    @Test
    fun `validateSourcePath rejects shell metacharacters`() {
        val dangerous = listOf(
            "/data/data/com.example/databases/foo.db; rm -rf /",
            "/data/data/com.example/databases/foo.db|cat /etc/passwd",
            "/data/data/com.example/databases/foo.db && evil",
            "/data/data/com.example/`evil`/foo.db",
            "/data/data/com.example/\$evil/foo.db",
            "/data/data/com.example/(evil)/foo.db",
            "/data/data/com.example/<evil>/foo.db",
            "/data/data/com.example/'evil'/foo.db",
            "/data/data/com.example/\"evil\"/foo.db",
            "/data/data/com.example/\nevil/foo.db",
        )
        for (path in dangerous) {
            val err = DbCohortCopier.validateSourcePath(path)
            assertNotNull(err, "should reject: $path")
            assertContains(err, "disallowed char")
        }
    }

    @Test
    fun `validateSourcePath accepts well-formed app db paths`() {
        val ok = listOf(
            "/data/data/com.tencent.mm/MicroMsg/abc123/EnMicroMsg.db",
            "/data/data/com.tencent.mobileqq/databases/1234567890.db",
            "/data/data/com.ss.android.ugc.aweme/databases/1234_im.db",
            "/data/data/com.sina.weibo/databases/weibo.db",
            "/data/data/tv.danmaku.bili/app_webview/Default/Cookies",
        )
        for (path in ok) {
            assertNull(DbCohortCopier.validateSourcePath(path), "should accept: $path")
        }
    }

    // ─── Script shape (parity with WeChat / QQ legacy) ─────────────────────

    @Test
    fun `buildScript mirrors WeChatDbExtractor cohort copy command`() {
        val src = "/data/data/com.tencent.mm/MicroMsg/abc/EnMicroMsg.db"
        val dst = "/data/user/0/com.chainlesschain.android.debug/cache/wechat-staging/EnMicroMsg.db"
        val script = DbCohortCopier.buildScript(src, dst, "$src-wal", "$src-shm")

        // Main DB copy + chmod 644 — Trap 7 says we need 644 because su cp
        // preserves source owner (target app's u0_a<n>); without chmod the
        // next read from our UID fails EACCES.
        assertContains(script, "cp $src $dst && chmod 644 $dst")
        // WAL sibling (defensive -f test; may not exist if app checkpointed)
        assertContains(script, "if [ -f $src-wal ] ; then cp $src-wal $dst-wal && chmod 644 $dst-wal ; fi")
        // SHM sibling
        assertContains(script, "if [ -f $src-shm ] ; then cp $src-shm $dst-shm && chmod 644 $dst-shm ; fi")
    }

    // ─── Cohort copy paths ─────────────────────────────────────────────────

    @Test
    fun `copy returns failure when path validation rejects`() {
        val runner = FakeRunner(rootAvailable = true, execReturns = true)
        val copier = DbCohortCopier(runner)
        val result = copier.copy(
            srcDb = "relative/foo.db",
            dstDb = File(tempDir, "out.db"),
        )
        assertTrue(result.isFailure)
        val err = result.exceptionOrNull()
        assertTrue(err is IllegalArgumentException)
        // Should NOT even probe su — fail fast on validation
        assertEquals(0, runner.isSuAvailableCalls.size)
        assertEquals(0, runner.execCalls.size)
    }

    @Test
    fun `copy returns failure when su not available`() {
        val runner = FakeRunner(rootAvailable = false)
        val copier = DbCohortCopier(runner)
        val result = copier.copy(
            srcDb = "/data/data/com.example/databases/foo.db",
            dstDb = File(tempDir, "out.db"),
        )
        assertTrue(result.isFailure)
        val err = result.exceptionOrNull()
        assertTrue(err is IllegalStateException)
        assertContains(err.message ?: "", "su not available")
        // Path validated + root probed but never executed
        assertEquals(1, runner.isSuAvailableCalls.size)
        assertEquals(0, runner.execCalls.size)
    }

    @Test
    fun `copy returns failure when exec returns non-zero`() {
        val runner = FakeRunner(rootAvailable = true, execReturns = false)
        val copier = DbCohortCopier(runner)
        val result = copier.copy(
            srcDb = "/data/data/com.example/databases/foo.db",
            dstDb = File(tempDir, "out.db"),
        )
        assertTrue(result.isFailure)
        val err = result.exceptionOrNull()
        assertTrue(err is RuntimeException)
        assertContains(err.message ?: "", "non-zero")
        assertEquals(1, runner.execCalls.size)
    }

    @Test
    fun `copy returns success and forwards script + timeout to runner`() {
        val runner = FakeRunner(rootAvailable = true, execReturns = true)
        val copier = DbCohortCopier(runner)
        val srcDb = "/data/data/com.example/databases/foo.db"
        val dstDb = File(tempDir, "out.db")
        val result = copier.copy(srcDb, dstDb, timeoutMs = 12_345L)

        assertTrue(result.isSuccess)
        assertEquals(1, runner.execCalls.size)
        val (cmd, timeout) = runner.execCalls[0]
        assertEquals(12_345L, timeout)
        // Script must contain the dst absolute path
        assertContains(cmd, dstDb.absolutePath)
        // ...and the WAL/SHM defensive tests
        assertContains(cmd, "if [ -f $srcDb-wal ]")
        assertContains(cmd, "if [ -f $srcDb-shm ]")
    }

    @Test
    fun `copy uses default 30s timeout when caller omits`() {
        val runner = FakeRunner(rootAvailable = true, execReturns = true)
        val copier = DbCohortCopier(runner)
        copier.copy(
            srcDb = "/data/data/com.example/databases/foo.db",
            dstDb = File(tempDir, "out.db"),
        )
        assertEquals(30_000L, runner.execCalls[0].second)
    }

    // ─── cleanup() ─────────────────────────────────────────────────────────

    @Test
    fun `cleanup removes main db + wal + shm when present`() {
        val dst = File(tempDir, "out.db")
        val wal = File(tempDir, "out.db-wal")
        val shm = File(tempDir, "out.db-shm")
        dst.writeText("main")
        wal.writeText("wal")
        shm.writeText("shm")

        val copier = DbCohortCopier(FakeRunner())
        copier.cleanup(dst)

        assertFalse(dst.exists())
        assertFalse(wal.exists())
        assertFalse(shm.exists())
    }

    @Test
    fun `cleanup is no-op when files dont exist`() {
        val dst = File(tempDir, "nonexistent.db")
        val copier = DbCohortCopier(FakeRunner())
        // Should not throw — used in finally-style recovery paths
        copier.cleanup(dst)
        assertFalse(dst.exists())
    }

    @Test
    fun `cleanup removes only main when wal+shm absent`() {
        val dst = File(tempDir, "out.db")
        dst.writeText("main")

        val copier = DbCohortCopier(FakeRunner())
        copier.cleanup(dst)
        assertFalse(dst.exists())
    }

    // ─── Test fixture ──────────────────────────────────────────────────────

    private class FakeRunner(
        var rootAvailable: Boolean = true,
        var execReturns: Boolean = true,
    ) : RootShellRunner {
        val isSuAvailableCalls = mutableListOf<Unit>()
        val execCalls = mutableListOf<Pair<String, Long>>()

        override fun isSuAvailable(): Boolean {
            isSuAvailableCalls.add(Unit)
            return rootAvailable
        }

        override fun exec(cmd: String, timeoutMs: Long): Boolean {
            execCalls.add(cmd to timeoutMs)
            return execReturns
        }

        override fun execAndCapture(cmd: String, timeoutMs: Long): String? = null
    }
}
