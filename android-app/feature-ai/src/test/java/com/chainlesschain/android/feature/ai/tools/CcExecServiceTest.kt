package com.chainlesschain.android.feature.ai.tools

import com.chainlesschain.android.feature.localterminal.LocalFilesystemBootstrapper
import com.chainlesschain.android.feature.localterminal.PtyEnvironment
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Test
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class CcExecServiceTest {

    private lateinit var bootstrapper: LocalFilesystemBootstrapper
    private lateinit var ptyEnvironment: PtyEnvironment
    private lateinit var service: CcExecService
    private lateinit var tmpPrefix: File
    private lateinit var tmpHome: File

    @Before
    fun setUp() {
        tmpPrefix = File(System.getProperty("java.io.tmpdir"), "cc-test-prefix-${System.nanoTime()}")
        tmpPrefix.mkdirs()
        tmpHome = File(tmpPrefix, "home").apply { mkdirs() }
        bootstrapper = mockk(relaxed = true)
        every { bootstrapper.prefixDir } returns tmpPrefix
        every { bootstrapper.homeDir } returns tmpHome

        ptyEnvironment = mockk(relaxed = true)
        every { ptyEnvironment.envp() } returns arrayOf(
            "PATH=/usr/bin:/bin",
            "HOME=${tmpHome.absolutePath}",
            "OPENAI_API_KEY=sk-leak-this-secret",
            "ANTHROPIC_API_KEY=anth-leak",
            "DEEPSEEK_API_KEY=dsk-leak",
            "CC_UI_TOKEN=ui-leak",
            "DASHSCOPE_API_KEY=qwen-leak",
            "VOLCENGINE_API_KEY=doubao-leak",
            "LANG=en_US.UTF-8",
            "MY_HARMLESS=value-with=equals=in=it",
            "EMPTY=",
            "=should-be-skipped-no-key",
        )

        service = CcExecService(bootstrapper, ptyEnvironment)
    }

    // ---------- argv ----------

    @Test fun `buildArgv composes node ccJs command subargs`() {
        val argv = service.buildArgv("/n/node", "/cc.js", "note", listOf("list", "--limit", "10"))
        assertEquals(listOf("/n/node", "/cc.js", "note", "list", "--limit", "10"), argv)
    }

    @Test fun `buildArgv with empty subargs`() {
        val argv = service.buildArgv("/n/node", "/cc.js", "status", emptyList())
        assertEquals(listOf("/n/node", "/cc.js", "status"), argv)
    }

    // ---------- env filter ----------

    @Test fun `buildFilteredEnv strips secret-prefix vars`() {
        val env = service.buildFilteredEnv()
        for (prefix in CcExecService.FORBIDDEN_ENV_PREFIXES) {
            assertTrue(
                env.keys.none { it.startsWith(prefix) },
                "should have stripped $prefix; got keys: ${env.keys}"
            )
        }
    }

    @Test fun `buildFilteredEnv preserves benign vars`() {
        val env = service.buildFilteredEnv()
        assertEquals("/usr/bin:/bin", env["PATH"])
        assertEquals("en_US.UTF-8", env["LANG"])
        assertEquals(tmpHome.absolutePath, env["HOME"])
    }

    @Test fun `buildFilteredEnv preserves vars with = in value`() {
        val env = service.buildFilteredEnv()
        // indexOf('=') uses FIRST '=' as separator → value can contain =
        assertEquals("value-with=equals=in=it", env["MY_HARMLESS"])
    }

    @Test fun `buildFilteredEnv keeps empty values (cc CLI distinguishes set-empty vs unset)`() {
        val env = service.buildFilteredEnv()
        // EMPTY= → "" preserved (idx=5, k="EMPTY", v="")
        assertTrue(env.containsKey("EMPTY"))
        assertEquals("", env["EMPTY"])
    }

    @Test fun `buildFilteredEnv skips malformed entries with no key`() {
        val env = service.buildFilteredEnv()
        // "=should-be-skipped-no-key" → idx=0 → idx <= 0 skip
        assertFalse(env.containsValue("should-be-skipped-no-key"))
    }

    // ---------- truncation ----------

    @Test fun `decodeAndTruncate under limit returns full UTF8`() {
        val bytes = "hello 你好".toByteArray(Charsets.UTF_8)
        val out = service.decodeAndTruncate(bytes, 100)
        assertEquals("hello 你好", out)
    }

    @Test fun `decodeAndTruncate over limit adds marker`() {
        val bytes = ByteArray(2000) { it.toByte() }
        val out = service.decodeAndTruncate(bytes, 100)
        assertTrue(out.contains("TRUNCATED"))
        assertTrue(out.contains("total=2000"))
    }

    @Test fun `decodeAndTruncate empty input`() {
        val out = service.decodeAndTruncate(ByteArray(0), 100)
        assertEquals("", out)
    }

    // ---------- run() — missing binaries return clean Error ----------

    @Test fun `run returns Error when node binary missing`() = runTest {
        // tmpPrefix/bin/node does NOT exist
        val r = service.run("status", emptyList())
        assertTrue(r is CcResult.Error)
        val err = r as CcResult.Error
        assertTrue(err.reason.contains("Node binary missing"))
        assertNotNull(err.expectedPath)
        assertTrue(err.expectedPath!!.endsWith("/bin/node"))
    }

    @Test fun `run returns Error when ccJs missing (node exists)`() = runTest {
        // create stub node binary, not ccJs
        File(tmpPrefix, "bin").mkdirs()
        File(tmpPrefix, "bin/node").apply {
            createNewFile()
            setExecutable(true)
        }
        val r = service.run("status", emptyList())
        assertTrue(r is CcResult.Error)
        val err = r as CcResult.Error
        assertTrue(err.reason.contains("cc CLI snapshot missing"))
    }

    // ---------- B28 fix — async stream drain prevents pipe-buffer deadlock ----------
    //
    // We can't run real `node + cc CLI` in jvmTest (no Termux binary). But we
    // CAN verify the drain path with a host-shell that emits >64KB stdout —
    // that's what would have deadlocked the pre-fix code. On Windows host we
    // skip (uses cmd.exe quoting differences); on linux/mac CI it runs.

    @Test fun `B28 — executeArgv drains large stdout without deadlock`() = runTest {
        val sh = listOf("/bin/sh", "-c", "yes hello | head -c 200000")
        // Only run if /bin/sh exists (linux/mac); Windows test JVM lacks it.
        if (!File("/bin/sh").exists()) return@runTest

        val r = service.executeArgv(
            argv = sh,
            env = mapOf("PATH" to "/usr/bin:/bin"),
            cwd = tmpHome,
            timeoutMs = 10_000L,
        )
        assertTrue(r is CcResult.Ok, "expected Ok; got $r")
        val ok = r as CcResult.Ok
        assertEquals(0, ok.exitCode)
        // 200KB stdout consumed; result truncated to STDOUT_TRUNCATE_BYTES (4KB)
        assertTrue(ok.stdout.contains("TRUNCATED"))
        assertTrue(ok.stdout.contains("total=200000"))
    }

    @Test fun `executeArgv reports non-zero exit`() = runTest {
        val sh = listOf("/bin/sh", "-c", "exit 42")
        if (!File("/bin/sh").exists()) return@runTest
        val r = service.executeArgv(sh, mapOf("PATH" to "/usr/bin:/bin"), tmpHome, 5_000L)
        assertTrue(r is CcResult.Ok)
        assertEquals(42, (r as CcResult.Ok).exitCode)
    }

    @Test fun `executeArgv reports stderr separately`() = runTest {
        val sh = listOf("/bin/sh", "-c", "echo good; echo BAD >&2; exit 0")
        if (!File("/bin/sh").exists()) return@runTest
        val r = service.executeArgv(sh, mapOf("PATH" to "/usr/bin:/bin"), tmpHome, 5_000L)
        assertTrue(r is CcResult.Ok)
        val ok = r as CcResult.Ok
        assertTrue(ok.stdout.contains("good"))
        assertTrue(ok.stderr.contains("BAD"))
    }

    @Test fun `executeArgv timeout kills runaway`() = runTest {
        val sh = listOf("/bin/sh", "-c", "sleep 30")
        if (!File("/bin/sh").exists()) return@runTest
        val started = System.currentTimeMillis()
        val r = service.executeArgv(sh, mapOf("PATH" to "/usr/bin:/bin"), tmpHome, 500L)
        val elapsed = System.currentTimeMillis() - started
        assertTrue(r is CcResult.Error)
        assertTrue((r as CcResult.Error).reason.contains("timeout"))
        // confirm we didn't actually wait the full sleep (process killed)
        assertTrue(elapsed < 5_000L, "timeout took too long: ${elapsed}ms")
    }

    @Test fun `executeArgv ProcessBuilder failure returns Error`() = runTest {
        val r = service.executeArgv(
            argv = listOf("/this/path/definitely/does/not/exist"),
            env = mapOf("PATH" to "/usr/bin"),
            cwd = tmpHome,
            timeoutMs = 1_000L,
        )
        assertTrue(r is CcResult.Error)
        assertTrue((r as CcResult.Error).reason.contains("ProcessBuilder"))
    }
}
