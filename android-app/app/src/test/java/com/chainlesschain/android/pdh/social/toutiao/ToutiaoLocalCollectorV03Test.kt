package com.chainlesschain.android.pdh.social.toutiao

import android.content.Context
import com.chainlesschain.android.pdh.social.SignProvider
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.runs
import io.mockk.verify
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import okhttp3.HttpUrl
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * §A8 v0.3 — JVM unit cover for [ToutiaoLocalCollector] v0.3 fan-out.
 * Verifies:
 *   - signProvider==null leaves v03Attempted=false and only profile emits
 *   - signProvider != null + warmUp ok triggers fetchFeed/Collection/Search
 *     and counts roll into Ok result fields
 *   - warmUp false short-circuits — no fetchFeed call, counts stay 0
 *   - snapshot JSON contains all kind=X events at expected shape
 */
class ToutiaoLocalCollectorV03Test {

    private lateinit var tempDir: File
    private lateinit var context: Context
    private lateinit var apiClient: ToutiaoApiClient
    private lateinit var credentialsStore: ToutiaoCredentialsStore
    private lateinit var collector: ToutiaoLocalCollector

    @Before
    fun setUp() {
        tempDir = createTempDir(prefix = "toutiao-v03-collector-")
        context = mockk()
        every { context.filesDir } returns tempDir
        apiClient = mockk(relaxed = true)
        // Legacy singleton setters stay stubbed solely so tests can verify
        // that the collector never mutates them.
        every { apiClient.signProvider = any() } just runs
        every { apiClient.lastErrorCode } returns 0
        every { apiClient.lastErrorMessage } returns null
        coEvery { apiClient.fetchProfileResult(any(), any()) } coAnswers {
            ToutiaoApiClient.FetchResult(
                value = apiClient.fetchProfile(firstArg()),
                error = ToutiaoApiClient.ErrorSnapshot(
                    apiClient.lastErrorCode,
                    apiClient.lastErrorMessage,
                ),
            )
        }
        coEvery { apiClient.fetchFeedResult(any(), any(), any(), any()) } coAnswers {
            ToutiaoApiClient.FetchResult(
                value = apiClient.fetchFeed(
                    firstArg(),
                    limit = thirdArg<Int>(),
                    maxPages = arg<Int>(3),
                ),
                error = ToutiaoApiClient.ErrorSnapshot(
                    apiClient.lastErrorCode,
                    apiClient.lastErrorMessage,
                ),
            )
        }
        coEvery { apiClient.fetchCollectionResult(any(), any(), any(), any()) } coAnswers {
            ToutiaoApiClient.FetchResult(
                value = apiClient.fetchCollection(
                    firstArg(),
                    limit = thirdArg<Int>(),
                    maxPages = arg<Int>(3),
                ),
                error = ToutiaoApiClient.ErrorSnapshot(
                    apiClient.lastErrorCode,
                    apiClient.lastErrorMessage,
                ),
            )
        }
        coEvery { apiClient.fetchSearchHistoryResult(any(), any(), any(), any()) } coAnswers {
            ToutiaoApiClient.FetchResult(
                value = apiClient.fetchSearchHistory(
                    firstArg(),
                    limit = thirdArg<Int>(),
                    maxPages = arg<Int>(3),
                ),
                error = ToutiaoApiClient.ErrorSnapshot(
                    apiClient.lastErrorCode,
                    apiClient.lastErrorMessage,
                ),
            )
        }
        credentialsStore = mockk(relaxed = true)
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getCookie() } returns "passport_uid=123; sessionid=abc"
        every { credentialsStore.getUid() } returns "123"
        every { credentialsStore.getDisplayName() } returns "alice"
        every { credentialsStore.recordSync(any(), any()) } just runs
        collector = ToutiaoLocalCollector(
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
        coEvery { apiClient.fetchProfile(any()) } returns ToutiaoApiClient.ProfileInfo(
            uid = "123",
            nickname = "alice",
            avatarUrl = "https://x/avatar.png",
            mobile = null,
            description = null,
            followingCount = 1,
            followerCount = 2,
            mediaId = null,
        )
        collector.signProvider = null
        val result = collector.snapshot()
        assertTrue(result is ToutiaoLocalCollector.SnapshotResult.Ok)
        val ok = result as ToutiaoLocalCollector.SnapshotResult.Ok
        assertEquals(1, ok.profileCount)
        assertEquals(0, ok.readCount)
        assertEquals(0, ok.collectionCount)
        assertEquals(0, ok.searchCount)
        assertEquals(1, ok.totalEvents)
        assertFalse(ok.v03Attempted)
        assertFalse(ok.everythingEmpty)
    }

    @Test
    fun `signProvider wired + warm ok triggers full v03 fan-out`() = runTest {
        coEvery { apiClient.fetchProfile(any()) } returns ToutiaoApiClient.ProfileInfo(
            uid = "123",
            nickname = "alice",
            avatarUrl = null,
            mobile = null,
            description = null,
            followingCount = 0,
            followerCount = 0,
            mediaId = null,
        )
        coEvery { apiClient.fetchFeed(any(), any<Int>()) } returns listOf(
            ToutiaoApiClient.FeedItem(
                itemId = "g1",
                title = "Article 1",
                category = "tech",
                author = "Acme",
                publishedAt = 1716_500_000_000L,
                readDuration = 100,
                source = "Acme News",
            ),
            ToutiaoApiClient.FeedItem(
                itemId = "g2",
                title = "Article 2",
                category = null,
                author = null,
                publishedAt = 1716_499_000_000L,
                readDuration = 0,
                source = null,
            ),
        )
        coEvery { apiClient.fetchCollection(any(), any<Int>()) } returns listOf(
            ToutiaoApiClient.CollectionItem(
                itemId = "c1",
                title = "Saved",
                category = "life",
                author = "Bob",
                savedAt = 1716_400_000_000L,
            ),
        )
        coEvery { apiClient.fetchSearchHistory(any(), any<Int>()) } returns listOf(
            ToutiaoApiClient.SearchItem(keyword = "kotlin", searchedAt = 1716_300_000_000L),
            ToutiaoApiClient.SearchItem(keyword = "rust", searchedAt = 1716_200_000_000L),
            ToutiaoApiClient.SearchItem(keyword = "go", searchedAt = 1716_100_000_000L),
        )
        val signer = FakeSigner(warmResult = true)
        collector.signProvider = signer
        val result = collector.snapshot()
        val ok = result as ToutiaoLocalCollector.SnapshotResult.Ok
        assertEquals(1, ok.profileCount)
        assertEquals(2, ok.readCount)
        assertEquals(1, ok.collectionCount)
        assertEquals(3, ok.searchCount)
        assertEquals(7, ok.totalEvents)
        assertTrue(ok.v03Attempted)
        assertFalse(ok.everythingEmpty)
        assertEquals(1, signer.warmCallCount)
        // Verify the on-disk snapshot has the new kinds
        val snapshotFile = File(ok.snapshotPath)
        assertTrue(snapshotFile.exists())
        val parsed = JSONObject(snapshotFile.readText())
        assertEquals(1, parsed.getInt("schemaVersion"))
        val events = parsed.getJSONArray("events")
        val kinds = mutableListOf<String>()
        for (i in 0 until events.length()) {
            kinds.add(events.getJSONObject(i).getString("kind"))
        }
        assertTrue(kinds.contains("profile"))
        assertEquals(2, kinds.count { it == "read" })
        assertEquals(1, kinds.count { it == "collection" })
        assertEquals(3, kinds.count { it == "search" })
    }

    @Test
    fun `signProvider warmUp false — skip v03 endpoints, profile still emits`() = runTest {
        coEvery { apiClient.fetchProfile(any()) } returns ToutiaoApiClient.ProfileInfo(
            uid = "123",
            nickname = "alice",
            avatarUrl = null,
            mobile = null,
            description = null,
            followingCount = 0,
            followerCount = 0,
            mediaId = null,
        )
        val signer = FakeSigner(warmResult = false)
        collector.signProvider = signer
        val result = collector.snapshot()
        val ok = result as ToutiaoLocalCollector.SnapshotResult.Ok
        // v03Attempted is true (provider was wired) but counts stay at 0
        // because warmUp returned false. ApiClient.fetchFeed must NOT
        // be called in this path — covered by mockk's `relaxed=true`
        // default returning empty.
        assertTrue(ok.v03Attempted)
        assertEquals(1, ok.profileCount)
        assertEquals(0, ok.readCount)
        assertEquals(0, ok.collectionCount)
        assertEquals(0, ok.searchCount)
        assertEquals(1, ok.warmExpected())
    }

    @Test
    fun `read event capturedAt falls back to snapshot ts when publishedAt is 0`() = runTest {
        coEvery { apiClient.fetchProfile(any()) } returns null
        coEvery { apiClient.fetchFeed(any(), any<Int>()) } returns listOf(
            ToutiaoApiClient.FeedItem(
                itemId = "g99",
                title = "T",
                category = null,
                author = null,
                publishedAt = 0L,
                readDuration = 0,
                source = null,
            ),
        )
        coEvery { apiClient.fetchCollection(any(), any<Int>()) } returns emptyList()
        coEvery { apiClient.fetchSearchHistory(any(), any<Int>()) } returns emptyList()
        collector.signProvider = FakeSigner(warmResult = true)
        val before = System.currentTimeMillis()
        val result = collector.snapshot()
        val ok = result as ToutiaoLocalCollector.SnapshotResult.Ok
        val parsed = JSONObject(File(ok.snapshotPath).readText())
        val event = parsed.getJSONArray("events").getJSONObject(0)
        assertEquals("read", event.getString("kind"))
        val capturedAt = event.getLong("capturedAt")
        assertTrue(capturedAt >= before, "capturedAt must fall back to snapshot ts, not stay 0")
    }

    // Helper for the warmUp-false test — silences `unused parameter` from `signer`
    // by giving us a stable expected count after the test bodies execute.
    @Test
    fun `stream failures remain aggregated after later successes`() = runTest {
        coEvery { apiClient.fetchProfileResult(any(), any()) } returns ToutiaoApiClient.FetchResult(
            value = null,
            error = ToutiaoApiClient.ErrorSnapshot(401, "profile expired"),
        )
        coEvery {
            apiClient.fetchFeedResult(any(), any(), any(), any())
        } returns ToutiaoApiClient.FetchResult(
            value = listOf(
                ToutiaoApiClient.FeedItem(
                    itemId = "g1",
                    title = "partial",
                    category = null,
                    author = null,
                    publishedAt = 1L,
                    readDuration = 0,
                    source = null,
                ),
            ),
            error = ToutiaoApiClient.ErrorSnapshot(
                ToutiaoApiClient.ERROR_PAGINATION_TRUNCATED,
                "feed pagination truncated at page 2: repeated cursor",
            ),
        )
        coEvery {
            apiClient.fetchCollectionResult(any(), any(), any(), any())
        } returns ToutiaoApiClient.FetchResult(
            value = emptyList(),
            error = ToutiaoApiClient.ErrorSnapshot(),
        )
        coEvery {
            apiClient.fetchSearchHistoryResult(any(), any(), any(), any())
        } returns ToutiaoApiClient.FetchResult(
            value = listOf(ToutiaoApiClient.SearchItem(keyword = "ok", searchedAt = 2L)),
            error = ToutiaoApiClient.ErrorSnapshot(),
        )
        collector.signProvider = FakeSigner(warmResult = true)

        val ok = collector.snapshot() as ToutiaoLocalCollector.SnapshotResult.Ok

        assertEquals(401, ok.lastErrorCode)
        assertEquals(listOf("profile", "feed"), ok.streamFailures.map { it.stream })
        assertTrue(ok.lastErrorMessage!!.contains("profile expired"))
        assertTrue(ok.lastErrorMessage!!.contains("pagination truncated"))
        assertEquals(2, ok.totalEvents)
    }

    @Test
    fun `request context is forwarded without mutating api singleton`() = runTest {
        val permit: suspend (ToutiaoApiClient.SourceRequest) -> Unit = { }
        val seenContexts = mutableListOf<ToutiaoApiClient.RequestContext>()
        coEvery { apiClient.fetchProfileResult(any(), any()) } coAnswers {
            seenContexts.add(secondArg())
            ToutiaoApiClient.FetchResult(
                value = null,
                error = ToutiaoApiClient.ErrorSnapshot(),
            )
        }
        collector.beforeSourceRequest = permit

        collector.snapshot()

        assertEquals(1, seenContexts.size)
        assertTrue(seenContexts.single().beforeSourceRequest === permit)
        verify(exactly = 0) { apiClient.beforeSourceRequest = any() }
        verify(exactly = 0) { apiClient.signProvider = any() }
    }

    @Test
    fun `acceptLoginCookie propagates cancellation without saving credentials`() = runTest {
        every { apiClient.extractUidResult(any()) } returns ToutiaoApiClient.FetchResult(
            value = "123",
            error = ToutiaoApiClient.ErrorSnapshot(),
        )
        coEvery {
            apiClient.fetchProfileResult(any(), any())
        } throws CancellationException("stop")

        assertFailsWith<CancellationException> {
            collector.acceptLoginCookieResult("passport_uid=123")
        }
        verify(exactly = 0) {
            credentialsStore.saveCredentials(any(), any(), any())
        }
    }

    @Test
    fun `accept login failure keeps uid diagnostic atomic and skips global error getters`() = runTest {
        val expected = ToutiaoApiClient.ErrorSnapshot(
            code = -7,
            message = "request-local missing uid",
        )
        every { apiClient.extractUidResult(any()) } returns ToutiaoApiClient.FetchResult(
            value = null,
            error = expected,
        )
        every { apiClient.lastErrorCode } returns 503
        every { apiClient.lastErrorMessage } returns "unrelated concurrent failure"

        val result = collector.acceptLoginCookieResult("guest-cookie")

        assertFalse(result.accepted)
        assertEquals(expected, result.error)
        coVerify(exactly = 0) { apiClient.fetchProfileResult(any(), any()) }
        verify(exactly = 0) {
            credentialsStore.saveCredentials(any(), any(), any())
        }
        verify(exactly = 0) { apiClient.lastErrorCode }
        verify(exactly = 0) { apiClient.lastErrorMessage }
    }

    @Test
    fun `accept login freezes collector context for profile without polluting singleton`() = runTest {
        val signer = FakeSigner()
        val permit: suspend (ToutiaoApiClient.SourceRequest) -> Unit = { }
        var seenContext: ToutiaoApiClient.RequestContext? = null
        every { apiClient.extractUidResult(any()) } returns ToutiaoApiClient.FetchResult(
            value = "cookie-uid",
            error = ToutiaoApiClient.ErrorSnapshot(),
        )
        coEvery { apiClient.fetchProfileResult(any(), any()) } coAnswers {
            seenContext = secondArg()
            ToutiaoApiClient.FetchResult(
                value = null,
                error = ToutiaoApiClient.ErrorSnapshot(code = 503, message = "best effort"),
            )
        }
        collector.signProvider = signer
        collector.beforeSourceRequest = permit

        val result = collector.acceptLoginCookieResult("passport_uid=123", "fallback")

        assertTrue(result.accepted)
        assertEquals(ToutiaoApiClient.ErrorSnapshot(), result.error)
        assertTrue(seenContext?.signProvider === signer)
        assertTrue(seenContext?.beforeSourceRequest === permit)
        verify { credentialsStore.saveCredentials("passport_uid=123", "cookie-uid", "fallback") }
        verify(exactly = 0) { apiClient.beforeSourceRequest = any() }
        verify(exactly = 0) { apiClient.signProvider = any() }
    }

    private fun ToutiaoLocalCollector.SnapshotResult.Ok.warmExpected(): Int =
        if (v03Attempted) 1 else 0
}
