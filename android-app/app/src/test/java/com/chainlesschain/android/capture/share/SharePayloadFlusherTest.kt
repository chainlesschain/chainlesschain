package com.chainlesschain.android.capture.share

import com.chainlesschain.android.remote.commands.CreateNoteResponse
import com.chainlesschain.android.remote.commands.KnowledgeCommands
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * SharePayloadFlusher 单测。M3 D2 ShareReceiver 收尾验收。
 *
 * 直接 mock KnowledgeCommands.createNote 返回值；inbox 用真实 SharedInboxRepository。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SharePayloadFlusherTest {

    private fun successResp(noteId: String = "note-${System.nanoTime()}") =
        Result.success(CreateNoteResponse(success = true, noteId = noteId, message = "ok"))

    private fun newFlusher(
        cmds: KnowledgeCommands,
        inbox: SharedInboxRepository = SharedInboxRepository(),
    ) = SharePayloadFlusher(inbox, cmds) to inbox

    @Test
    fun `flushAll empty inbox returns EMPTY without calling KnowledgeCommands`() = runTest {
        val cmds = mockk<KnowledgeCommands>(relaxed = true)
        val (flusher, _) = newFlusher(cmds)
        val s = flusher.flushAll()
        assertEquals(SharePayloadFlusher.FlushSummary.EMPTY, s)
        coVerify(exactly = 0) { cmds.createNote(any(), any(), any(), any()) }
    }

    @Test
    fun `flushAll Text payload pushes with shared+text tags`() = runTest {
        val cmds = mockk<KnowledgeCommands>(relaxed = true)
        coEvery { cmds.createNote(any(), any(), any(), any()) } returns successResp()
        val (flusher, inbox) = newFlusher(cmds)
        inbox.enqueue(SharePayload.Text(text = "hello world", subject = null, timestampMs = 1L))
        val s = flusher.flushAll()
        assertEquals(1, s.pushed)
        assertEquals(0, s.failed)
        coVerify {
            cmds.createNote(
                title = "Shared text",
                content = "hello world",
                tags = listOf("shared", "text"),
            )
        }
    }

    @Test
    fun `flushAll Url payload pushes markdown link with bookmark tag`() = runTest {
        val cmds = mockk<KnowledgeCommands>(relaxed = true)
        val titleSlot = slot<String>()
        val contentSlot = slot<String>()
        coEvery {
            cmds.createNote(capture(titleSlot), capture(contentSlot), any(), any())
        } returns successResp()
        val (flusher, inbox) = newFlusher(cmds)
        inbox.enqueue(
            SharePayload.Url(
                url = "https://example.com/path",
                subject = null,
                timestampMs = 1L,
            )
        )
        flusher.flushAll()
        assertEquals("example.com/path", titleSlot.captured)
        assertEquals("[https://example.com/path](https://example.com/path)", contentSlot.captured)
        coVerify { cmds.createNote(any(), any(), any(), eq(listOf("shared", "url", "bookmark"))) }
    }

    @Test
    fun `flushAll long URL gets shortened title`() = runTest {
        val cmds = mockk<KnowledgeCommands>(relaxed = true)
        val titleSlot = slot<String>()
        coEvery {
            cmds.createNote(capture(titleSlot), any(), any(), any())
        } returns successResp()
        val (flusher, inbox) = newFlusher(cmds)
        val longUrl = "https://example.com/" + "a".repeat(80)
        inbox.enqueue(SharePayload.Url(url = longUrl, subject = null, timestampMs = 1L))
        flusher.flushAll()
        assertTrue(titleSlot.captured.length <= 60)
        assertTrue(titleSlot.captured.endsWith("..."))
    }

    @Test
    fun `flushAll subject overrides default title`() = runTest {
        val cmds = mockk<KnowledgeCommands>(relaxed = true)
        val titleSlot = slot<String>()
        coEvery {
            cmds.createNote(capture(titleSlot), any(), any(), any())
        } returns successResp()
        val (flusher, inbox) = newFlusher(cmds)
        inbox.enqueue(
            SharePayload.Text(text = "x", subject = "用户的标题", timestampMs = 1L)
        )
        flusher.flushAll()
        assertEquals("用户的标题", titleSlot.captured)
    }

    @Test
    fun `flushAll SingleImage payload formats markdown img`() = runTest {
        val cmds = mockk<KnowledgeCommands>(relaxed = true)
        val contentSlot = slot<String>()
        coEvery {
            cmds.createNote(any(), capture(contentSlot), any(), any())
        } returns successResp()
        val (flusher, inbox) = newFlusher(cmds)
        inbox.enqueue(
            SharePayload.SingleImage(
                uri = "content://media/external/12345",
                mimeType = "image/jpeg",
                subject = null,
                timestampMs = 1L,
            )
        )
        flusher.flushAll()
        assertTrue(contentSlot.captured.startsWith("![](content://media/external/12345)"))
        assertTrue(contentSlot.captured.contains("image/jpeg"))
        coVerify { cmds.createNote(any(), any(), any(), eq(listOf("shared", "image"))) }
    }

    @Test
    fun `flushAll MultiImage payload enumerates all uris`() = runTest {
        val cmds = mockk<KnowledgeCommands>(relaxed = true)
        val contentSlot = slot<String>()
        coEvery {
            cmds.createNote(any(), capture(contentSlot), any(), any())
        } returns successResp()
        val (flusher, inbox) = newFlusher(cmds)
        inbox.enqueue(
            SharePayload.MultiImage(
                uris = listOf("content://1", "content://2", "content://3"),
                mimeType = "image/png",
                subject = null,
                timestampMs = 1L,
            )
        )
        flusher.flushAll()
        val c = contentSlot.captured
        assertTrue(c.contains("![](content://1)"))
        assertTrue(c.contains("![](content://2)"))
        assertTrue(c.contains("![](content://3)"))
        coVerify { cmds.createNote(any(), any(), any(), eq(listOf("shared", "image", "batch"))) }
    }

    @Test
    fun `flushAll GenericFile derives title from URI filename`() = runTest {
        val cmds = mockk<KnowledgeCommands>(relaxed = true)
        val titleSlot = slot<String>()
        coEvery {
            cmds.createNote(capture(titleSlot), any(), any(), any())
        } returns successResp()
        val (flusher, inbox) = newFlusher(cmds)
        inbox.enqueue(
            SharePayload.GenericFile(
                uri = "content://com.foo.provider/docs/quarterly-report.pdf",
                mimeType = "application/pdf",
                subject = null,
                timestampMs = 1L,
            )
        )
        flusher.flushAll()
        assertEquals("quarterly-report.pdf", titleSlot.captured)
    }

    @Test
    fun `flushAll GenericFile with no filename in URI uses fallback`() = runTest {
        val cmds = mockk<KnowledgeCommands>(relaxed = true)
        val titleSlot = slot<String>()
        coEvery {
            cmds.createNote(capture(titleSlot), any(), any(), any())
        } returns successResp()
        val (flusher, inbox) = newFlusher(cmds)
        inbox.enqueue(
            SharePayload.GenericFile(
                uri = "content://com.foo.provider",
                mimeType = "application/octet-stream",
                subject = null,
                timestampMs = 1L,
            )
        )
        flusher.flushAll()
        assertEquals("Shared file", titleSlot.captured)
    }

    @Test
    fun `flushAll failed payload is re-enqueued back to inbox`() = runTest {
        val cmds = mockk<KnowledgeCommands>(relaxed = true)
        coEvery { cmds.createNote(any(), any(), any(), any()) } returns
            Result.failure(RuntimeException("桌面离线"))
        val (flusher, inbox) = newFlusher(cmds)
        inbox.enqueue(SharePayload.Text(text = "x", subject = null, timestampMs = 1L))
        val s = flusher.flushAll()
        assertEquals(0, s.pushed)
        assertEquals(1, s.failed)
        // 已 re-enqueue
        assertEquals(1, inbox.size())
    }

    @Test
    fun `flushAll mixed success+failure tracks counts correctly`() = runTest {
        val cmds = mockk<KnowledgeCommands>(relaxed = true)
        var call = 0
        coEvery { cmds.createNote(any(), any(), any(), any()) } answers {
            call++
            if (call == 2) Result.failure(RuntimeException("fail #2")) else successResp()
        }
        val (flusher, inbox) = newFlusher(cmds)
        inbox.enqueue(SharePayload.Text(text = "a", subject = null, timestampMs = 1L))
        inbox.enqueue(SharePayload.Text(text = "b", subject = null, timestampMs = 2L))
        inbox.enqueue(SharePayload.Text(text = "c", subject = null, timestampMs = 3L))
        val s = flusher.flushAll()
        assertEquals(2, s.pushed)
        assertEquals(1, s.failed)
        assertEquals(3, s.total)
        assertEquals(1, inbox.size())
    }

    @Test
    fun `flushAll createNote throwing exception treated as failure (not propagated)`() = runTest {
        val cmds = mockk<KnowledgeCommands>(relaxed = true)
        coEvery { cmds.createNote(any(), any(), any(), any()) } throws RuntimeException("kaboom")
        val (flusher, inbox) = newFlusher(cmds)
        inbox.enqueue(SharePayload.Text(text = "x", subject = null, timestampMs = 1L))
        val s = flusher.flushAll()
        assertEquals(0, s.pushed)
        assertEquals(1, s.failed)
    }

    @Test
    fun `flushAll drained items removed from inbox on success`() = runTest {
        val cmds = mockk<KnowledgeCommands>(relaxed = true)
        coEvery { cmds.createNote(any(), any(), any(), any()) } returns successResp()
        val (flusher, inbox) = newFlusher(cmds)
        inbox.enqueue(SharePayload.Text(text = "a", subject = null, timestampMs = 1L))
        inbox.enqueue(SharePayload.Text(text = "b", subject = null, timestampMs = 2L))
        flusher.flushAll()
        assertEquals(0, inbox.size())
    }

    @Test
    fun `flushAll preserves FIFO order across two payloads`() = runTest {
        val cmds = mockk<KnowledgeCommands>(relaxed = true)
        val received = mutableListOf<String>()
        coEvery { cmds.createNote(any(), any(), any(), any()) } answers {
            received.add(arg<String>(0))
            successResp()
        }
        val (flusher, inbox) = newFlusher(cmds)
        inbox.enqueue(SharePayload.Text(text = "x", subject = "first", timestampMs = 1L))
        inbox.enqueue(SharePayload.Text(text = "x", subject = "second", timestampMs = 2L))
        flusher.flushAll()
        assertEquals(listOf("first", "second"), received)
    }

    @Test
    fun `toCreateNoteRequest pure conversion is stable for Text`() {
        val req = SharePayloadFlusher.toCreateNoteRequest(
            SharePayload.Text("body", subject = "T", timestampMs = 1L)
        )
        assertEquals("T", req.title)
        assertEquals("body", req.content)
        assertEquals(listOf("shared", "text"), req.tags)
    }

    @Test
    fun `toCreateNoteRequest pure conversion is stable for Url`() {
        val req = SharePayloadFlusher.toCreateNoteRequest(
            SharePayload.Url("https://x.com/p", subject = null, timestampMs = 1L)
        )
        assertEquals("x.com/p", req.title)
        assertTrue(req.tags.contains("bookmark"))
    }

    @Test
    fun `blank subject treated as null and falls back to default`() = runTest {
        val cmds = mockk<KnowledgeCommands>(relaxed = true)
        val titleSlot = slot<String>()
        coEvery {
            cmds.createNote(capture(titleSlot), any(), any(), any())
        } returns successResp()
        val (flusher, inbox) = newFlusher(cmds)
        inbox.enqueue(SharePayload.Text(text = "x", subject = "   ", timestampMs = 1L))
        flusher.flushAll()
        assertEquals("Shared text", titleSlot.captured)
    }

    @Test
    fun `flushAll second invocation after re-enqueue still retries the same payload`() = runTest {
        val cmds = mockk<KnowledgeCommands>(relaxed = true)
        var calls = 0
        coEvery { cmds.createNote(any(), any(), any(), any()) } answers {
            calls++
            if (calls < 2) Result.failure(RuntimeException("first fail")) else successResp()
        }
        val (flusher, inbox) = newFlusher(cmds)
        inbox.enqueue(SharePayload.Text(text = "x", subject = null, timestampMs = 1L))
        val s1 = flusher.flushAll()
        assertEquals(1, s1.failed)
        assertEquals(1, inbox.size())
        val s2 = flusher.flushAll()
        assertEquals(1, s2.pushed)
        assertEquals(0, inbox.size())
    }

    @Test
    fun `flushAll createNote success=false (KB-side failure) NOT re-enqueued because Result is success`() = runTest {
        // Edge case: KnowledgeCommands.createNote returns Result.success even when CreateNoteResponse.success=false.
        // SharePayloadFlusher 当前只看 Result.isSuccess，所以这种边界会被算作"已推送"。
        // 把这个行为锁住作为已知/可接受语义；后续要区分需扩 createNote 包装。
        val cmds = mockk<KnowledgeCommands>(relaxed = true)
        coEvery { cmds.createNote(any(), any(), any(), any()) } returns
            Result.success(CreateNoteResponse(success = false, noteId = "", message = "denied"))
        val (flusher, inbox) = newFlusher(cmds)
        inbox.enqueue(SharePayload.Text(text = "x", subject = null, timestampMs = 1L))
        val s = flusher.flushAll()
        assertEquals(1, s.pushed)
        assertEquals(0, s.failed)
        assertFalse(inbox.size() > 0)
    }
}
