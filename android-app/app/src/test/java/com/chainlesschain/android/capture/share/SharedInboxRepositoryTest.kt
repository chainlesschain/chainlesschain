package com.chainlesschain.android.capture.share

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class SharedInboxRepositoryTest {

    private lateinit var repo: SharedInboxRepository

    @Before
    fun setup() {
        repo = SharedInboxRepository()
    }

    private fun text(s: String, ts: Long = 1700000000000L) =
        SharePayload.Text(s, subject = null, timestampMs = ts)

    @Test
    fun `enqueue grows the list`() {
        repo.enqueue(text("a"))
        repo.enqueue(text("b"))
        repo.enqueue(text("c"))

        assertEquals(3, repo.size())
        assertEquals("a", (repo.entries.value[0] as SharePayload.Text).text)
        assertEquals("c", (repo.entries.value[2] as SharePayload.Text).text)
    }

    @Test
    fun `enqueue returns updated size`() {
        assertEquals(1, repo.enqueue(text("a")))
        assertEquals(2, repo.enqueue(text("b")))
    }

    @Test
    fun `drain returns and clears`() {
        repo.enqueue(text("a"))
        repo.enqueue(text("b"))

        val snapshot = repo.drain()

        assertEquals(2, snapshot.size)
        assertEquals(0, repo.size())
        assertEquals("a", (snapshot[0] as SharePayload.Text).text)
    }

    @Test
    fun `clear empties without returning`() {
        repo.enqueue(text("x"))

        repo.clear()

        assertEquals(0, repo.size())
    }

    @Test
    fun `enqueue beyond MAX_ENTRIES drops oldest`() {
        repeat(SharedInboxRepository.MAX_ENTRIES + 50) { i ->
            repo.enqueue(text("e$i", ts = (1700000000000L + i)))
        }

        assertEquals(SharedInboxRepository.MAX_ENTRIES, repo.size())
        // 头部应是 50 - 199（即最早 50 个被丢）
        val first = repo.entries.value.first() as SharePayload.Text
        assertEquals("e50", first.text)
    }

    @Test
    fun `mixed payload types preserved in order`() {
        val tA: SharePayload = SharePayload.Text("A", subject = null, timestampMs = 1L)
        val tB: SharePayload = SharePayload.Url("https://b", subject = null, timestampMs = 2L)
        val tC: SharePayload = SharePayload.SingleImage(
            uri = "content://c", mimeType = "image/png", subject = null, timestampMs = 3L,
        )

        repo.enqueue(tA)
        repo.enqueue(tB)
        repo.enqueue(tC)

        assertEquals(3, repo.size())
        val drained = repo.drain()
        assertTrue(drained[0] is SharePayload.Text)
        assertTrue(drained[1] is SharePayload.Url)
        assertTrue(drained[2] is SharePayload.SingleImage)
    }
}
