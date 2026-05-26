package com.chainlesschain.android.pdh.llm

import android.content.Context
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.security.MessageDigest
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * §A3.4 v0.3 — ModelManager multi-mirror fallback + SHA256 lock cover.
 *
 * MockWebServer drives HTTP scenarios; [TemporaryFolder] gives real disk so
 * `RandomAccessFile` + `partFile.renameTo` paths execute end-to-end. Fixture
 * body is 256 bytes deterministic so SHA comparison is trivially reproducible
 * and tests stay sub-second.
 *
 * Coverage:
 *   1. primary mirror 200 → Ready + SHA verify + .part cleanup
 *   2. primary 503 → secondary 200 → Ready (fallback works)
 *   3. all mirrors fail → Failed with concatenated reasons
 *   4. SHA mismatch → Failed("校验失败") + file deleted
 *   5. empty urls → Failed (defensive guard)
 *   6. existing .part → Range header sent + resume from offset
 *   7. defaultSpec invariants (SHA pinned + modelscope in fallback list)
 */
class ModelManagerTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private lateinit var server1: MockWebServer
    private lateinit var server2: MockWebServer
    private lateinit var context: Context
    private lateinit var manager: ModelManager

    private val fixtureBody = ByteArray(256) { (it % 251).toByte() } // deterministic
    private val fixtureSha = sha256Hex(fixtureBody)

    @Before
    fun setUp() {
        server1 = MockWebServer().apply { start() }
        server2 = MockWebServer().apply { start() }
        context = mockk(relaxed = true)
        every { context.filesDir } returns tmp.root
        manager = ModelManager(context)
    }

    @After
    fun tearDown() {
        server1.shutdown()
        server2.shutdown()
    }

    private fun spec(
        urls: List<String> = listOf(
            server1.url("/m.task").toString(),
            server2.url("/m.task").toString(),
        ),
        sha: String? = fixtureSha,
    ) = ModelManager.ModelSpec(
        key = "test-spec",
        filename = "m.task",
        urls = urls,
        expectedSha256 = sha,
        sizeBytesApprox = fixtureBody.size.toLong(),
        displayName = "test",
    )

    private fun bodyResponse() =
        MockResponse().setResponseCode(200).setBody(Buffer().write(fixtureBody))

    @Test
    fun `download succeeds on primary mirror with SHA verify`() = runTest {
        server1.enqueue(bodyResponse())
        val res = manager.download(spec())
        assertTrue(res is ModelManager.State.Ready, "expected Ready, got $res")
        assertEquals(fixtureSha, (res as ModelManager.State.Ready).sha256)
        assertTrue(res.file.exists())
        assertFalse(
            File(tmp.root, ".chainlesschain/models/m.task.part").exists(),
            "part file should be cleaned up after final rename",
        )
    }

    @Test
    fun `download falls back to mirror 2 when mirror 1 returns 503`() = runTest {
        server1.enqueue(MockResponse().setResponseCode(503))
        server2.enqueue(bodyResponse())
        val res = manager.download(spec())
        assertTrue(res is ModelManager.State.Ready, "expected Ready after fallback, got $res")
        assertTrue(server1.requestCount >= 1, "primary should have been attempted once")
        assertTrue(server2.requestCount >= 1, "fallback should have been hit")
    }

    @Test
    fun `download fails with concatenated reasons when all mirrors fail`() = runTest {
        server1.enqueue(MockResponse().setResponseCode(503))
        server2.enqueue(MockResponse().setResponseCode(404))
        val res = manager.download(spec())
        assertTrue(res is ModelManager.State.Failed, "expected Failed, got $res")
        val reason = (res as ModelManager.State.Failed).reason
        assertTrue(
            reason.contains("503") && reason.contains("404"),
            "should mention both mirror failures: $reason",
        )
        assertTrue(
            reason.contains("镜像 1") && reason.contains("镜像 2"),
            "should label both mirrors: $reason",
        )
    }

    @Test
    fun `SHA mismatch deletes file and returns Failed`() = runTest {
        val tampered = ByteArray(256) { 0x42 } // wrong bytes, valid 256-byte length
        server1.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().write(tampered)))
        // spec pins fixtureSha; mirror serves tampered → refresh() detects mismatch.
        val res = manager.download(spec())
        assertTrue(res is ModelManager.State.Failed, "expected Failed on SHA mismatch, got $res")
        assertTrue(
            (res as ModelManager.State.Failed).reason.contains("校验失败"),
            "reason should mention SHA verify failure: ${res.reason}",
        )
        assertFalse(
            File(tmp.root, ".chainlesschain/models/m.task").exists(),
            "tampered file should be deleted by refresh()",
        )
    }

    @Test
    fun `empty urls list returns Failed`() = runTest {
        val res = manager.download(spec(urls = emptyList()))
        assertTrue(res is ModelManager.State.Failed)
        assertTrue((res as ModelManager.State.Failed).reason.contains("urls 为空"))
    }

    @Test
    fun `resumes from existing part file with Range header`() = runTest {
        val partDir = File(tmp.root, ".chainlesschain/models").apply { mkdirs() }
        val partFile = File(partDir, "m.task.part")
        partFile.writeBytes(fixtureBody.copyOfRange(0, 100)) // pre-seed first 100 bytes
        // Mirror serves remaining 156 bytes as HTTP 206 Partial Content
        server1.enqueue(
            MockResponse().setResponseCode(206)
                .addHeader("Content-Range", "bytes 100-255/256")
                .setBody(Buffer().write(fixtureBody.copyOfRange(100, 256))),
        )
        val res = manager.download(spec(urls = listOf(server1.url("/m.task").toString())))
        assertTrue(res is ModelManager.State.Ready, "expected Ready on resume, got $res")
        val req = server1.takeRequest()
        assertEquals("bytes=100-", req.getHeader("Range"))
    }

    @Test
    fun `defaultSpec has SHA256 locked and modelscope fallback`() {
        val spec = manager.defaultSpec
        assertNotNull(spec.expectedSha256, "default SHA must be pinned (no TOFU)")
        assertEquals(64, spec.expectedSha256!!.length, "SHA256 hex = 64 chars")
        assertTrue(spec.urls.size >= 2, "should have at least primary + fallback")
        assertTrue(
            spec.urls.first().contains("hf-mirror.com"),
            "primary should remain hf-mirror.com: ${spec.urls.first()}",
        )
        assertTrue(
            spec.urls.any { it.contains("modelscope.cn") },
            "fallback list should include modelscope.cn: ${spec.urls}",
        )
        assertEquals(spec.urls.first(), spec.primaryUrl, "primaryUrl getter should return urls[0]")
    }

    // ─── 2026-05-26 — 双档模型选择器 ─────────────────────────────────────

    @Test
    fun `availableSpecs contains 0_5B as default head and 1_5B alternative`() {
        val specs = manager.availableSpecs
        assertEquals(2, specs.size, "expected exactly 0.5B + 1.5B options")
        assertEquals("qwen-0.5b", specs[0].key, "0.5B should be first (default)")
        assertEquals("qwen-1.5b", specs[1].key, "1.5B should be second (opt-in)")
        assertTrue(specs[0].displayName.contains("0.5B"), "displayName matches: ${specs[0].displayName}")
        assertTrue(specs[1].displayName.contains("1.5B"), "displayName matches: ${specs[1].displayName}")
        assertTrue(specs[0].shaLocked, "0.5B SHA must be pinned")
        // 1.5B is TOFU until first real-device download locks the SHA.
        assertFalse(specs[1].shaLocked, "1.5B should be TOFU until SHA is pinned")
        // RAM recommendation must scale up for the heavier model so UI warning fires.
        assertTrue(
            specs[1].recommendedRamMb > specs[0].recommendedRamMb,
            "1.5B should require more RAM than 0.5B: ${specs[0].recommendedRamMb} vs ${specs[1].recommendedRamMb}",
        )
    }

    @Test
    fun `selectedSpec defaults to 0_5B when prefs is empty`() {
        // setUp's relaxed mockk returns null from prefs.getString, so loadSelectedSpec
        // must fall back to qwen05bSpec.
        assertEquals("qwen-0.5b", manager.selectedSpec.value.key)
    }

    @Test
    fun `selectSpec flips selectedSpec to the new key`() {
        manager.selectSpec(manager.qwen15bSpec)
        assertEquals("qwen-1.5b", manager.selectedSpec.value.key)
        // Switching back is allowed
        manager.selectSpec(manager.qwen05bSpec)
        assertEquals("qwen-0.5b", manager.selectedSpec.value.key)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `selectSpec rejects a spec not in availableSpecs`() {
        // Construct a stray spec with the right shape but an unknown key —
        // defensive guard prevents UI from passing stale/wrong references.
        val unknown = ModelManager.ModelSpec(
            key = "made-up-model",
            filename = "x.task",
            urls = listOf("http://nope"),
            expectedSha256 = null,
            sizeBytesApprox = 1L,
            displayName = "stray",
        )
        manager.selectSpec(unknown)
    }

    @Test
    fun `selectSpec persists across ModelManager instances via SharedPreferences`() {
        // Drive a real-ish SharedPreferences via a Map-backed mock so two ModelManager
        // instances can share the prefs state. Construction 1 writes; construction 2 reads.
        val store = mutableMapOf<String, String?>()
        val editor = mockk<android.content.SharedPreferences.Editor>(relaxed = true)
        val prefs = mockk<android.content.SharedPreferences>(relaxed = true)
        every { prefs.getString(any(), any()) } answers {
            store[firstArg<String>()] ?: secondArg<String?>()
        }
        every { prefs.edit() } returns editor
        every { editor.putString(any(), any()) } answers {
            store[firstArg<String>()] = secondArg<String>()
            editor
        }
        every { editor.apply() } returns Unit

        val ctx = mockk<Context>(relaxed = true)
        every { ctx.filesDir } returns tmp.newFolder("persistence")
        every { ctx.getSharedPreferences(any(), any()) } returns prefs

        // Instance 1 — user flips to 1.5B
        val m1 = ModelManager(ctx)
        assertEquals("qwen-0.5b", m1.selectedSpec.value.key)
        m1.selectSpec(m1.qwen15bSpec)
        assertEquals("qwen-1.5b", m1.selectedSpec.value.key)

        // Instance 2 — should hydrate from prefs and see 1.5B already selected
        val m2 = ModelManager(ctx)
        assertEquals(
            "qwen-1.5b",
            m2.selectedSpec.value.key,
            "second instance should rehydrate selectedSpec from prefs",
        )
    }

    private fun sha256Hex(bytes: ByteArray): String {
        val md = MessageDigest.getInstance("SHA-256")
        return md.digest(bytes).joinToString("") { "%02x".format(it) }
    }
}
