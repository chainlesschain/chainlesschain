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

    private fun sha256Hex(bytes: ByteArray): String {
        val md = MessageDigest.getInstance("SHA-256")
        return md.digest(bytes).joinToString("") { "%02x".format(it) }
    }
}
