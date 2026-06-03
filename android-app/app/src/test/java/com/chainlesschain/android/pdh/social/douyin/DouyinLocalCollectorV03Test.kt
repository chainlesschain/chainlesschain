package com.chainlesschain.android.pdh.social.douyin

import android.content.Context
import com.chainlesschain.android.pdh.social.SignProvider
import io.mockk.coEvery
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.runs
import kotlinx.coroutines.test.runTest
import okhttp3.HttpUrl
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * §A8 v0.3 — DouyinLocalCollector v0.3 fan-out JVM cover.
 * Mirrors ToutiaoLocalCollectorV03Test.
 */
class DouyinLocalCollectorV03Test {

    private lateinit var tempDir: File
    private lateinit var context: Context
    private lateinit var apiClient: DouyinApiClient
    private lateinit var credentialsStore: DouyinCredentialsStore
    private lateinit var collector: DouyinLocalCollector

    @Before
    fun setUp() {
        tempDir = createTempDir(prefix = "douyin-v03-collector-")
        context = mockk()
        every { context.filesDir } returns tempDir
        apiClient = mockk(relaxed = true)
        every { apiClient.signProvider = any() } just runs
        every { apiClient.lastErrorCode } returns 0
        every { apiClient.lastErrorMessage } returns null
        credentialsStore = mockk(relaxed = true)
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getCookie() } returns "sessionid=abc"
        every { credentialsStore.getSecUid() } returns "MS4w_alice"
        every { credentialsStore.getShortId() } returns "1234"
        every { credentialsStore.getDisplayName() } returns "alice"
        every { credentialsStore.recordSync(any(), any()) } just runs
        collector = DouyinLocalCollector(
            context = context,
            apiClient = apiClient,
            credentialsStore = credentialsStore,
        )
    }

    @After
    fun tearDown() {
        tempDir.deleteRecursively()
    }

    private class FakeSigner(val warmResult: Boolean = true) : SignProvider {
        var warmCallCount = 0
        override suspend fun warmUp(cookie: String): Boolean {
            warmCallCount += 1
            return warmResult
        }
        override suspend fun signUrl(rawUrl: HttpUrl, purpose: String): HttpUrl? = rawUrl
    }

    @Test
    fun `signProvider null preserves v02 behavior — profile only`() = runTest {
        coEvery { apiClient.fetchProfile(any()) } returns DouyinApiClient.ProfileInfo(
            secUid = "MS4w_alice",
            shortId = "1234",
            nickname = "alice",
            signature = null,
            avatarUrl = null,
            followingCount = 0,
            followerCount = 0,
            awemeCount = 0,
            favoritingCount = 0,
            totalFavorited = 0,
        )
        collector.signProvider = null
        val result = collector.snapshot()
        val ok = result as DouyinLocalCollector.SnapshotResult.Ok
        assertEquals(1, ok.profileCount)
        assertEquals(0, ok.historyCount)
        assertEquals(0, ok.favouriteCount)
        assertEquals(0, ok.likeCount)
        assertFalse(ok.v03Attempted)
    }

    @Test
    fun `signProvider warm + ok triggers full v03 fan-out`() = runTest {
        coEvery { apiClient.fetchProfile(any()) } returns DouyinApiClient.ProfileInfo(
            secUid = "MS4w_alice", shortId = null, nickname = "alice", signature = null,
            avatarUrl = null, followingCount = 0, followerCount = 0, awemeCount = 0,
            favoritingCount = 0, totalFavorited = 0,
        )
        coEvery { apiClient.fetchHistory(any(), any()) } returns listOf(
            DouyinApiClient.HistoryItem("h1", "Watched 1", "MS4w_bob", "Bob", 1716_500_000_000L, 30_000L),
            DouyinApiClient.HistoryItem("h2", "Watched 2", null, null, 1716_499_000_000L, 45_000L),
        )
        coEvery { apiClient.fetchFavourites(any(), any()) } returns listOf(
            DouyinApiClient.FavouriteItem("f1", "Saved", "Carol", 1716_400_000_000L),
        )
        coEvery { apiClient.fetchLikes(any(), any()) } returns listOf(
            DouyinApiClient.LikeItem("l1", "Liked 1", "Dave", 1716_300_000_000L),
            DouyinApiClient.LikeItem("l2", "Liked 2", null, 1716_200_000_000L),
            DouyinApiClient.LikeItem("l3", "Liked 3", null, 1716_100_000_000L),
        )
        val signer = FakeSigner(warmResult = true)
        collector.signProvider = signer
        val result = collector.snapshot()
        val ok = result as DouyinLocalCollector.SnapshotResult.Ok
        assertEquals(1, ok.profileCount)
        assertEquals(2, ok.historyCount)
        assertEquals(1, ok.favouriteCount)
        assertEquals(3, ok.likeCount)
        assertEquals(7, ok.totalEvents)
        assertTrue(ok.v03Attempted)
        assertEquals(1, signer.warmCallCount)
        val parsed = JSONObject(File(ok.snapshotPath).readText())
        val events = parsed.getJSONArray("events")
        val kinds = mutableListOf<String>()
        for (i in 0 until events.length()) kinds.add(events.getJSONObject(i).getString("kind"))
        assertTrue(kinds.contains("profile"))
        assertEquals(2, kinds.count { it == "history" })
        assertEquals(1, kinds.count { it == "favourite" })
        assertEquals(3, kinds.count { it == "like" })
    }

    @Test
    fun `signProvider warmUp false skips v03, profile still emits`() = runTest {
        coEvery { apiClient.fetchProfile(any()) } returns DouyinApiClient.ProfileInfo(
            secUid = "MS4w_alice", shortId = null, nickname = "alice", signature = null,
            avatarUrl = null, followingCount = 0, followerCount = 0, awemeCount = 0,
            favoritingCount = 0, totalFavorited = 0,
        )
        collector.signProvider = FakeSigner(warmResult = false)
        val result = collector.snapshot()
        val ok = result as DouyinLocalCollector.SnapshotResult.Ok
        assertTrue(ok.v03Attempted)
        assertEquals(1, ok.profileCount)
        assertEquals(0, ok.historyCount)
        assertEquals(0, ok.favouriteCount)
        assertEquals(0, ok.likeCount)
    }

    @Test
    fun `history capturedAt falls back to snapshot ts when watchedAt is 0`() = runTest {
        coEvery { apiClient.fetchProfile(any()) } returns null
        coEvery { apiClient.fetchHistory(any(), any()) } returns listOf(
            DouyinApiClient.HistoryItem("h99", "T", null, null, 0L, 0L),
        )
        coEvery { apiClient.fetchFavourites(any(), any()) } returns emptyList()
        coEvery { apiClient.fetchLikes(any(), any()) } returns emptyList()
        collector.signProvider = FakeSigner(warmResult = true)
        val before = System.currentTimeMillis()
        val result = collector.snapshot()
        val ok = result as DouyinLocalCollector.SnapshotResult.Ok
        val parsed = JSONObject(File(ok.snapshotPath).readText())
        val event = parsed.getJSONArray("events").getJSONObject(0)
        assertEquals("history", event.getString("kind"))
        assertTrue(event.getLong("capturedAt") >= before)
    }
}
