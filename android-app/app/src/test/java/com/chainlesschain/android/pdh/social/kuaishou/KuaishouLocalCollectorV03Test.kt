package com.chainlesschain.android.pdh.social.kuaishou

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
 * §A8 v0.3 — KuaishouLocalCollector v0.3 fan-out JVM cover.
 * Mirrors DouyinLocalCollectorV03Test.
 */
class KuaishouLocalCollectorV03Test {

    private lateinit var tempDir: File
    private lateinit var context: Context
    private lateinit var apiClient: KuaishouApiClient
    private lateinit var credentialsStore: KuaishouCredentialsStore
    private lateinit var collector: KuaishouLocalCollector

    @Before
    fun setUp() {
        tempDir = createTempDir(prefix = "kuaishou-v03-collector-")
        context = mockk()
        every { context.filesDir } returns tempDir
        apiClient = mockk(relaxed = true)
        every { apiClient.signProvider = any() } just runs
        every { apiClient.lastErrorCode } returns 0
        every { apiClient.lastErrorMessage } returns null
        credentialsStore = mockk(relaxed = true)
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getCookie() } returns "userId=12345; kuaishou.web.cp.api_ph=foo"
        every { credentialsStore.getUid() } returns "12345"
        every { credentialsStore.getDisplayName() } returns "alice"
        every { credentialsStore.recordSync(any(), any()) } just runs
        collector = KuaishouLocalCollector(
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
    fun `signProvider null preserves v02 behavior`() = runTest {
        coEvery { apiClient.fetchProfile(any()) } returns KuaishouApiClient.ProfileInfo(
            uid = "12345", nickname = "alice", kuaishouId = "k_alice",
            avatarUrl = null, sex = null, city = null, constellation = null, description = null,
        )
        collector.signProvider = null
        val result = collector.snapshot()
        val ok = result as KuaishouLocalCollector.SnapshotResult.Ok
        assertEquals(1, ok.profileCount)
        assertEquals(0, ok.watchCount)
        assertEquals(0, ok.collectCount)
        assertEquals(0, ok.searchCount)
        assertFalse(ok.v03Attempted)
    }

    @Test
    fun `full v03 fan-out emits all three kinds`() = runTest {
        coEvery { apiClient.fetchProfile(any()) } returns KuaishouApiClient.ProfileInfo(
            uid = "12345", nickname = "alice", kuaishouId = null,
            avatarUrl = null, sex = null, city = null, constellation = null, description = null,
        )
        coEvery { apiClient.fetchWatchHistory(any(), any()) } returns listOf(
            KuaishouApiClient.WatchItem("w1", "Watched 1", "Bob", "u_bob", 1716_500_000_000L, 30_000L),
            KuaishouApiClient.WatchItem("w2", "Watched 2", null, null, 1716_499_000_000L, 0L),
        )
        coEvery { apiClient.fetchProfilePhotos(any(), any(), any()) } returns listOf(
            KuaishouApiClient.ProfilePhotoItem("p1", "My post", 1716_400_000_000L),
        )
        coEvery { apiClient.fetchSearchHistory(any(), any()) } returns listOf(
            KuaishouApiClient.SearchItem("kotlin", 1716_300_000_000L),
            KuaishouApiClient.SearchItem("rust", 1716_200_000_000L),
        )
        collector.signProvider = FakeSigner(warmResult = true)
        val result = collector.snapshot()
        val ok = result as KuaishouLocalCollector.SnapshotResult.Ok
        assertEquals(1, ok.profileCount)
        assertEquals(2, ok.watchCount)
        assertEquals(1, ok.collectCount)
        assertEquals(2, ok.searchCount)
        assertEquals(6, ok.totalEvents)
        assertTrue(ok.v03Attempted)
        val parsed = JSONObject(File(ok.snapshotPath).readText())
        val events = parsed.getJSONArray("events")
        val kinds = mutableListOf<String>()
        for (i in 0 until events.length()) kinds.add(events.getJSONObject(i).getString("kind"))
        assertTrue(kinds.contains("profile"))
        assertEquals(2, kinds.count { it == "watch" })
        assertEquals(1, kinds.count { it == "collect" })
        assertEquals(2, kinds.count { it == "search" })
    }

    @Test
    fun `signer warmUp false skips v03 endpoints`() = runTest {
        coEvery { apiClient.fetchProfile(any()) } returns KuaishouApiClient.ProfileInfo(
            uid = "12345", nickname = "alice", kuaishouId = null,
            avatarUrl = null, sex = null, city = null, constellation = null, description = null,
        )
        collector.signProvider = FakeSigner(warmResult = false)
        val result = collector.snapshot()
        val ok = result as KuaishouLocalCollector.SnapshotResult.Ok
        assertTrue(ok.v03Attempted)
        assertEquals(1, ok.profileCount)
        assertEquals(0, ok.watchCount)
        assertEquals(0, ok.collectCount)
        assertEquals(0, ok.searchCount)
    }

    @Test
    fun `fetchProfilePhotos receives resolved uid`() = runTest {
        coEvery { apiClient.fetchProfile(any()) } returns KuaishouApiClient.ProfileInfo(
            uid = "FROM_PROFILE", nickname = "alice", kuaishouId = null,
            avatarUrl = null, sex = null, city = null, constellation = null, description = null,
        )
        var seenUid: String? = null
        coEvery { apiClient.fetchProfilePhotos(any(), any(), any()) } answers {
            seenUid = secondArg()
            emptyList()
        }
        coEvery { apiClient.fetchWatchHistory(any(), any()) } returns emptyList()
        coEvery { apiClient.fetchSearchHistory(any(), any()) } returns emptyList()
        collector.signProvider = FakeSigner(warmResult = true)
        collector.snapshot()
        // Profile uid takes precedence over stored uid
        assertEquals("FROM_PROFILE", seenUid)
    }
}
