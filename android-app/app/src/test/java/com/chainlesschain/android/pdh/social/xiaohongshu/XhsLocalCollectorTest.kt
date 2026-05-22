package com.chainlesschain.android.pdh.social.xiaohongshu

import android.content.Context
import io.mockk.coEvery
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.runs
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * §A8 v0.2 — JVM unit cover for [XhsLocalCollector] orchestration.
 *
 * Mirror of WeiboLocalCollectorTest. Verifies:
 *   - snapshot JSON shape matches SNAPSHOT_SCHEMA_VERSION=1 (the contract
 *     between Kotlin and packages/personal-data-hub/lib/adapters/social-
 *     xiaohongshu/index.js _syncViaSnapshot — drift = silent ingest failure)
 *   - all 3 kinds (note/liked/follow) round-trip into events
 *   - NoCredentials when not logged in (cookie OR a1 OR uid missing)
 *   - everythingEmpty=true surfaces correctly
 *   - one API throwing doesn't tank the others
 *   - acceptLoginCookie (suspend) requires BOTH a1 cookie field AND fetchMe
 *     success — key behavior diff from Bilibili (1 step) and Weibo (1 step).
 */
class XhsLocalCollectorTest {

    private lateinit var tempDir: File
    private lateinit var context: Context
    private lateinit var apiClient: XhsApiClient
    private lateinit var credentialsStore: XhsCredentialsStore
    private lateinit var collector: XhsLocalCollector

    @Before
    fun setUp() {
        tempDir = createTempDir(prefix = "xhs-collector-")
        context = mockk()
        every { context.filesDir } returns tempDir
        apiClient = mockk()
        // Collector reads apiClient.lastErrorCode + lastErrorMessage to surface
        // X-S signature failure (-461) vs anti-bot ban (-100) distinctions.
        every { apiClient.lastErrorCode } returns 0
        every { apiClient.lastErrorMessage } returns null
        credentialsStore = mockk(relaxed = true)
        collector = XhsLocalCollector(
            context = context,
            apiClient = apiClient,
            credentialsStore = credentialsStore,
        )
    }

    @After
    fun tearDown() {
        tempDir.deleteRecursively()
    }

    private fun stubCredentialsLoggedIn(
        uid: Long = 12345L,
        userIdStr: String = "5e8c8f7e0000000000abcdef",
        a1: String = "a1-fp-token",
    ) {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getCookie() } returns "web_session=xyz; a1=$a1"
        every { credentialsStore.getUid() } returns uid
        every { credentialsStore.getUserIdStr() } returns userIdStr
        every { credentialsStore.getA1() } returns a1
        every { credentialsStore.getDisplayName() } returns "tester"
        every { credentialsStore.recordSync(any(), any()) } just runs
    }

    @Test
    fun `returns NoCredentials when not logged in`() = runTest {
        every { credentialsStore.hasCredentials() } returns false
        val result = collector.snapshot()
        assertTrue(result is XhsLocalCollector.SnapshotResult.NoCredentials)
    }

    @Test
    fun `returns NoCredentials when a1 missing (defensive)`() = runTest {
        // hasCredentials passes but a1 separately missing — defensive guard
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getCookie() } returns "web_session=x"
        every { credentialsStore.getA1() } returns null
        val result = collector.snapshot()
        assertTrue(result is XhsLocalCollector.SnapshotResult.NoCredentials)
    }

    @Test
    fun `writes snapshot with 3 kinds when all APIs succeed`() = runTest {
        stubCredentialsLoggedIn()
        coEvery { apiClient.fetchNotes(any(), any(), any(), any()) } returns listOf(
            XhsApiClient.NoteItem(
                noteId = "N1", title = "今日穿搭", desc = "夏日清凉", type = "normal",
                createdAt = 1715000000L * 1000,
                likedCount = 100, collectedCount = 30, commentCount = 15,
            )
        )
        coEvery { apiClient.fetchLiked(any(), any(), any()) } returns listOf(
            XhsApiClient.LikedItem(
                noteId = "N2", title = "好喜欢的菜谱", likedAt = 0L,
                authorNickname = "美食家",
            )
        )
        coEvery { apiClient.fetchFollows(any(), any(), any(), any()) } returns listOf(
            XhsApiClient.FollowItem(
                userId = "USR99", nickname = "carol",
                image = "https://example.com/c.jpg", followedAt = 0L,
            )
        )

        val result = collector.snapshot()
        assertTrue(result is XhsLocalCollector.SnapshotResult.Ok)
        val ok = result as XhsLocalCollector.SnapshotResult.Ok
        assertEquals(1, ok.noteCount)
        assertEquals(1, ok.likedCount)
        assertEquals(1, ok.followCount)
        assertEquals(3, ok.totalEvents)
        assertFalse(ok.everythingEmpty)

        val file = File(ok.snapshotPath)
        assertTrue(file.exists())
        val raw = JSONObject(file.readText(Charsets.UTF_8))
        assertEquals(1, raw.getInt("schemaVersion"))
        assertNotNull(raw.optJSONObject("account"))
        assertEquals("5e8c8f7e0000000000abcdef", raw.optJSONObject("account")!!.getString("uid"))
        val events = raw.getJSONArray("events")
        assertEquals(3, events.length())
        val kinds = (0 until events.length()).map { events.getJSONObject(it).getString("kind") }.sorted()
        assertEquals(listOf("follow", "liked", "note"), kinds)

        verify { credentialsStore.recordSync(any(), 3) }
    }

    @Test
    fun `everythingEmpty when all 3 APIs return empty`() = runTest {
        stubCredentialsLoggedIn()
        coEvery { apiClient.fetchNotes(any(), any(), any(), any()) } returns emptyList()
        coEvery { apiClient.fetchLiked(any(), any(), any()) } returns emptyList()
        coEvery { apiClient.fetchFollows(any(), any(), any(), any()) } returns emptyList()

        val result = collector.snapshot()
        assertTrue(result is XhsLocalCollector.SnapshotResult.Ok)
        val ok = result as XhsLocalCollector.SnapshotResult.Ok
        assertEquals(0, ok.totalEvents)
        assertTrue(ok.everythingEmpty)
    }

    @Test
    fun `one API throwing does not tank the others`() = runTest {
        stubCredentialsLoggedIn()
        coEvery { apiClient.fetchNotes(any(), any(), any(), any()) } throws RuntimeException("X-S sig failed")
        coEvery { apiClient.fetchLiked(any(), any(), any()) } returns emptyList()
        coEvery { apiClient.fetchFollows(any(), any(), any(), any()) } returns listOf(
            XhsApiClient.FollowItem(userId = "U1", nickname = "u", image = null, followedAt = 0L)
        )

        val result = collector.snapshot()
        assertTrue(result is XhsLocalCollector.SnapshotResult.Ok)
        val ok = result as XhsLocalCollector.SnapshotResult.Ok
        assertEquals(0, ok.noteCount) // crashed → 0
        assertEquals(1, ok.followCount) // success → 1
        assertEquals(1, ok.totalEvents)
    }

    @Test
    fun `snapshot events have flat kind field expected by JS adapter`() = runTest {
        stubCredentialsLoggedIn()
        coEvery { apiClient.fetchNotes(any(), any(), any(), any()) } returns listOf(
            XhsApiClient.NoteItem(
                noteId = "N1", title = "t", desc = null, type = "video",
                createdAt = 100L, likedCount = 0, collectedCount = 0, commentCount = 0,
            )
        )
        coEvery { apiClient.fetchLiked(any(), any(), any()) } returns emptyList()
        coEvery { apiClient.fetchFollows(any(), any(), any(), any()) } returns emptyList()

        val result = collector.snapshot() as XhsLocalCollector.SnapshotResult.Ok
        val raw = JSONObject(File(result.snapshotPath).readText(Charsets.UTF_8))
        val events: JSONArray = raw.getJSONArray("events")
        val first = events.getJSONObject(0)
        assertEquals("note", first.getString("kind"))
        assertEquals("note-N1", first.getString("id"))
        assertTrue(first.has("capturedAt"))
        assertEquals("N1", first.getString("noteId"))
        assertEquals("video", first.getString("type"))
    }

    // ─── acceptLoginCookie (2-step: extractA1 + fetchMe) ───────────────────

    @Test
    fun `acceptLoginCookie returns true and persists when a1+fetchMe ok`() = runTest {
        val cookie = "web_session=x; a1=abc-fp"
        coEvery { apiClient.fetchMe(cookie) } returns XhsApiClient.MeResult(
            userId = "5e8c8f7e0000000000abcdef", numericUid = 99L, nickname = "alice",
        )
        every { credentialsStore.saveCredentials(any(), any(), any(), any(), any()) } just runs

        val ok = collector.acceptLoginCookie(cookie)
        assertTrue(ok)
        verify { credentialsStore.saveCredentials(cookie, 99L, "5e8c8f7e0000000000abcdef", "abc-fp", "alice") }
    }

    @Test
    fun `acceptLoginCookie returns false when a1 cookie field absent`() = runTest {
        // cookie missing a1 entirely
        val cookie = "web_session=x; webBuild=v1"
        val ok = collector.acceptLoginCookie(cookie)
        assertFalse(ok)
        // fetchMe never called when a1 is missing — saves an HTTP roundtrip
        verify(exactly = 0) { credentialsStore.saveCredentials(any(), any(), any(), any(), any()) }
    }

    @Test
    fun `acceptLoginCookie returns false when fetchMe returns null`() = runTest {
        val cookie = "web_session=expired; a1=abc-fp"
        coEvery { apiClient.fetchMe(cookie) } returns null
        val ok = collector.acceptLoginCookie(cookie)
        assertFalse(ok)
        verify(exactly = 0) { credentialsStore.saveCredentials(any(), any(), any(), any(), any()) }
    }

    @Test
    fun `logout clears credentials store`() {
        every { credentialsStore.clear() } just runs
        collector.logout()
        verify { credentialsStore.clear() }
    }
}
