package com.chainlesschain.android.pdh.social.weibo

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
 * §A8 v0.2 — JVM unit cover for [WeiboLocalCollector] orchestration.
 *
 * Mirrors BilibiliLocalCollectorTest. Verifies:
 *   - snapshot JSON shape matches SNAPSHOT_SCHEMA_VERSION=1 (the contract
 *     between Kotlin and packages/personal-data-hub/lib/adapters/social-weibo
 *     /index.js _syncViaSnapshot — drift here = silent ingest failure)
 *   - all 3 kinds (post/favourite/follow) round-trip into events
 *   - NoCredentials when not logged in
 *   - everythingEmpty=true surfaces correctly
 *   - one API throwing doesn't tank the others
 *   - acceptLoginCookie (suspend) persists when fetchUid returns uid, refuses
 *     otherwise (key behavior diff from Bilibili: UID needs HTTP roundtrip)
 */
class WeiboLocalCollectorTest {

    private lateinit var tempDir: File
    private lateinit var context: Context
    private lateinit var apiClient: WeiboApiClient
    private lateinit var credentialsStore: WeiboCredentialsStore
    private lateinit var collector: WeiboLocalCollector

    @Before
    fun setUp() {
        tempDir = createTempDir(prefix = "weibo-collector-")
        context = mockk()
        every { context.filesDir } returns tempDir
        apiClient = mockk()
        // Collector reads apiClient.lastErrorCode + lastErrorMessage to surface
        // ok=-100 / ok=-50101 vs IO error distinctions. Stub default zero/null
        // so unstubbed code paths don't throw MockKException.
        every { apiClient.lastErrorCode } returns 0
        every { apiClient.lastErrorMessage } returns null
        credentialsStore = mockk(relaxed = true)
        collector = WeiboLocalCollector(
            context = context,
            apiClient = apiClient,
            credentialsStore = credentialsStore,
        )
    }

    @After
    fun tearDown() {
        tempDir.deleteRecursively()
    }

    private fun stubCredentialsLoggedIn(uid: Long = 12345L) {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getCookie() } returns "SUB=x; SUBP=y; _T_WM=z"
        every { credentialsStore.getUid() } returns uid
        every { credentialsStore.getDisplayName() } returns "tester"
        every { credentialsStore.recordSync(any(), any()) } just runs
    }

    @Test
    fun `returns NoCredentials when not logged in`() = runTest {
        every { credentialsStore.hasCredentials() } returns false
        val result = collector.snapshot()
        assertTrue(result is WeiboLocalCollector.SnapshotResult.NoCredentials)
    }

    @Test
    fun `writes snapshot with 3 kinds when all APIs succeed`() = runTest {
        stubCredentialsLoggedIn()
        coEvery { apiClient.fetchPosts(any(), any(), any()) } returns listOf(
            WeiboApiClient.PostItem(
                mid = "M1", text = "今天天气真好",
                createdAt = 1715000000L * 1000, source = "iPhone",
                repostsCount = 5, commentsCount = 3, likesCount = 10, picCount = 1,
            )
        )
        coEvery { apiClient.fetchFavourites(any(), any()) } returns listOf(
            WeiboApiClient.FavouriteItem(
                mid = "M2", text = "收藏",
                favAt = 1714000000L * 1000, authorScreenName = "bob",
            )
        )
        coEvery { apiClient.fetchFollows(any(), any(), any()) } returns listOf(
            WeiboApiClient.FollowItem(
                uid = 99L, screenName = "carol", description = "hi",
                avatarUrl = "https://example.com/c.jpg", followedAt = 0L,
            )
        )

        val result = collector.snapshot()
        assertTrue(result is WeiboLocalCollector.SnapshotResult.Ok)
        val ok = result as WeiboLocalCollector.SnapshotResult.Ok
        assertEquals(1, ok.postCount)
        assertEquals(1, ok.favouriteCount)
        assertEquals(1, ok.followCount)
        assertEquals(3, ok.totalEvents)
        assertFalse(ok.everythingEmpty)

        val file = File(ok.snapshotPath)
        assertTrue(file.exists())
        val raw = JSONObject(file.readText(Charsets.UTF_8))
        assertEquals(1, raw.getInt("schemaVersion"))
        assertNotNull(raw.optJSONObject("account"))
        assertEquals("12345", raw.optJSONObject("account")!!.getString("uid"))
        val events = raw.getJSONArray("events")
        assertEquals(3, events.length())
        val kinds = (0 until events.length()).map { events.getJSONObject(it).getString("kind") }.sorted()
        assertEquals(listOf("favourite", "follow", "post"), kinds)

        verify { credentialsStore.recordSync(any(), 3) }
    }

    @Test
    fun `everythingEmpty when all 3 APIs return empty`() = runTest {
        stubCredentialsLoggedIn()
        coEvery { apiClient.fetchPosts(any(), any(), any()) } returns emptyList()
        coEvery { apiClient.fetchFavourites(any(), any()) } returns emptyList()
        coEvery { apiClient.fetchFollows(any(), any(), any()) } returns emptyList()

        val result = collector.snapshot()
        assertTrue(result is WeiboLocalCollector.SnapshotResult.Ok)
        val ok = result as WeiboLocalCollector.SnapshotResult.Ok
        assertEquals(0, ok.totalEvents)
        assertTrue(ok.everythingEmpty)
    }

    @Test
    fun `one API throwing does not tank the others`() = runTest {
        stubCredentialsLoggedIn()
        coEvery { apiClient.fetchPosts(any(), any(), any()) } throws RuntimeException("transient 5xx")
        coEvery { apiClient.fetchFavourites(any(), any()) } returns emptyList()
        coEvery { apiClient.fetchFollows(any(), any(), any()) } returns listOf(
            WeiboApiClient.FollowItem(
                uid = 1L, screenName = "u", description = null,
                avatarUrl = null, followedAt = 0L,
            )
        )

        val result = collector.snapshot()
        assertTrue(result is WeiboLocalCollector.SnapshotResult.Ok)
        val ok = result as WeiboLocalCollector.SnapshotResult.Ok
        assertEquals(0, ok.postCount) // crashed → 0
        assertEquals(1, ok.followCount) // success → 1
        assertEquals(1, ok.totalEvents)
    }

    @Test
    fun `snapshot events have flat kind field expected by JS adapter`() = runTest {
        // Adapter's _syncViaSnapshot reads ev.kind directly. Drift = JS adapter
        // silently drops events.
        stubCredentialsLoggedIn()
        coEvery { apiClient.fetchPosts(any(), any(), any()) } returns listOf(
            WeiboApiClient.PostItem(
                mid = "M1", text = "t", createdAt = 100L, source = null,
                repostsCount = 0, commentsCount = 0, likesCount = 0, picCount = 0,
            )
        )
        coEvery { apiClient.fetchFavourites(any(), any()) } returns emptyList()
        coEvery { apiClient.fetchFollows(any(), any(), any()) } returns emptyList()

        val result = collector.snapshot() as WeiboLocalCollector.SnapshotResult.Ok
        val raw = JSONObject(File(result.snapshotPath).readText(Charsets.UTF_8))
        val events: JSONArray = raw.getJSONArray("events")
        val first = events.getJSONObject(0)
        assertEquals("post", first.getString("kind"))
        assertEquals("post-M1", first.getString("id"))
        assertTrue(first.has("capturedAt"))
        assertEquals("M1", first.getString("mid"))
        assertEquals("t", first.getString("text"))
    }

    // ─── acceptLoginCookie (suspend — key diff from Bilibili) ──────────────

    @Test
    fun `acceptLoginCookie returns true and persists when fetchUid succeeds`() = runTest {
        coEvery { apiClient.fetchUid("SUB=x; SUBP=y") } returns 99L
        every { credentialsStore.saveCredentials(any(), any(), any()) } just runs

        val ok = collector.acceptLoginCookie("SUB=x; SUBP=y")
        assertTrue(ok)
        verify { credentialsStore.saveCredentials("SUB=x; SUBP=y", 99L, null) }
    }

    @Test
    fun `acceptLoginCookie returns false when fetchUid returns null`() = runTest {
        coEvery { apiClient.fetchUid("SUB=expired") } returns null
        val ok = collector.acceptLoginCookie("SUB=expired")
        assertFalse(ok)
        verify(exactly = 0) { credentialsStore.saveCredentials(any(), any(), any()) }
    }

    @Test
    fun `logout clears credentials store`() {
        every { credentialsStore.clear() } just runs
        collector.logout()
        verify { credentialsStore.clear() }
    }
}
