package com.chainlesschain.android.pdh.social.toutiao

import com.chainlesschain.android.pdh.social.NullSignProvider
import com.chainlesschain.android.pdh.social.SignProvider
import kotlinx.coroutines.test.runTest
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * §A8 v0.3 — Toutiao fetchFeed / fetchCollection / fetchSearchHistory cover
 * via MockWebServer with a sentinel SignProvider.
 *
 * The fake signer just appends `_signature=test-sig-<purpose>` so we can
 * assert: (a) signing was invoked, (b) the response shape parse is correct,
 * (c) NullSignProvider short-circuits with lastErrorCode=-99 instead of
 * issuing the unsigned request.
 */
class ToutiaoApiClientV03Test {

    private lateinit var server: MockWebServer
    private lateinit var client: ToutiaoApiClient

    private class StubSignProvider : SignProvider {
        var lastPurpose: String? = null
        var lastUrl: HttpUrl? = null
        var failNext: Boolean = false
        override suspend fun signUrl(rawUrl: HttpUrl, purpose: String): HttpUrl? {
            lastPurpose = purpose
            lastUrl = rawUrl
            if (failNext) return null
            return rawUrl.newBuilder()
                .addQueryParameter("_signature", "test-sig-$purpose")
                .build()
        }
    }

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = ToutiaoApiClient().apply {
            baseUrl = server.url("/").toString().toHttpUrl()
            httpClient = OkHttpClient.Builder().build()
        }
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun fetchFeed_invokesSignerAndParsesTopLevelData() = runTest {
        val signer = StubSignProvider()
        client.signProvider = signer
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """
                {
                  "data": [
                    {"group_id": "g1", "title": "Article 1", "category": "tech",
                     "source": "Acme News", "behot_time": 1716500000, "read_duration": 120},
                    {"group_id": "g2", "title": "Article 2", "behot_time": 1716499000}
                  ]
                }
                """.trimIndent(),
            ),
        )
        val items = client.fetchFeed("sessionid=abc; passport_uid=123")
        assertEquals(2, items.size)
        assertEquals("g1", items[0].itemId)
        assertEquals("Article 1", items[0].title)
        assertEquals("tech", items[0].category)
        assertEquals("Acme News", items[0].author)
        assertEquals(1716500000_000L, items[0].publishedAt)
        assertEquals(120, items[0].readDuration)
        // Signer was called for "feed" purpose
        assertEquals("feed", signer.lastPurpose)
        // Request URL got _signature appended
        val received = server.takeRequest()
        assertTrue(received.requestUrl.toString().contains("_signature=test-sig-feed"))
        assertTrue(received.requestUrl.toString().contains("category=__all__"))
    }

    @Test
    fun fetchFeed_decodesNestedRawDataCells() = runTest {
        client.signProvider = StubSignProvider()
        // Some feed cells nest the article inside raw_data as a JSON string.
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """
                {
                  "data": [
                    {"raw_data": "{\"group_id\":\"g42\",\"title\":\"Nested\",\"behot_time\":1716000000}"}
                  ]
                }
                """.trimIndent(),
            ),
        )
        val items = client.fetchFeed("cookie")
        assertEquals(1, items.size)
        assertEquals("g42", items[0].itemId)
        assertEquals("Nested", items[0].title)
    }

    @Test
    fun fetchFeed_returnsEmptyWhenSignerFails() = runTest {
        val signer = StubSignProvider().apply { failNext = true }
        client.signProvider = signer
        val items = client.fetchFeed("cookie")
        assertTrue(items.isEmpty())
        assertEquals(-99, client.lastErrorCode)
        assertNotNull(client.lastErrorMessage)
        assertTrue(client.lastErrorMessage!!.contains("_signature unavailable"))
        // CRITICAL: no HTTP request was issued — anti-bot would penalize us.
        assertEquals(0, server.requestCount)
    }

    @Test
    fun fetchFeed_defaultsToNullSignProviderShortCircuits() = runTest {
        // Without a configured signer, signProvider defaults to
        // NullSignProvider; calling fetchFeed must NOT issue an HTTP request.
        client.signProvider = NullSignProvider
        val items = client.fetchFeed("cookie")
        assertTrue(items.isEmpty())
        assertEquals(0, server.requestCount)
    }

    @Test
    fun fetchCollection_parsesUserInfoNickname() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """
                {
                  "data": [
                    {"group_id": "c1", "title": "Saved 1",
                     "user_info": {"name": "Author1"},
                     "behot_time": 1716000000, "category": "life"},
                    {"item_id": "c2", "title": "Saved 2", "source": "Backup Source",
                     "create_time": 1715900000}
                  ]
                }
                """.trimIndent(),
            ),
        )
        val items = client.fetchCollection("cookie")
        assertEquals(2, items.size)
        assertEquals("c1", items[0].itemId)
        assertEquals("Author1", items[0].author)
        assertEquals(1716000000_000L, items[0].savedAt)
        // Second one: falls back to source for author + create_time
        assertEquals("c2", items[1].itemId)
        assertEquals("Backup Source", items[1].author)
        assertEquals(1715900000_000L, items[1].savedAt)
    }

    @Test
    fun fetchCollection_signerCalledWithCommentsPurpose() = runTest {
        val signer = StubSignProvider()
        client.signProvider = signer
        server.enqueue(MockResponse().setResponseCode(200).setBody("{\"data\":[]}"))
        client.fetchCollection("cookie")
        assertEquals("comments", signer.lastPurpose)
        val req = server.takeRequest()
        assertTrue(req.requestUrl.toString().contains("article/v2/tab_comments"))
        assertTrue(req.requestUrl.toString().contains("_signature=test-sig-comments"))
    }

    @Test
    fun fetchSearchHistory_objectShape() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """
                {
                  "data": {
                    "user_search_history": [
                      {"keyword": "kotlin coroutines", "time": 1716500000},
                      {"keyword": "rust async", "search_time": 1716499000}
                    ]
                  }
                }
                """.trimIndent(),
            ),
        )
        val items = client.fetchSearchHistory("cookie")
        assertEquals(2, items.size)
        assertEquals("kotlin coroutines", items[0].keyword)
        assertEquals(1716500000_000L, items[0].searchedAt)
        assertEquals("rust async", items[1].keyword)
        assertEquals(1716499000_000L, items[1].searchedAt)
    }

    @Test
    fun fetchSearchHistory_stringShapeOlderApi() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """
                {
                  "data": {
                    "search_history": ["foo", "bar", "baz"]
                  }
                }
                """.trimIndent(),
            ),
        )
        val items = client.fetchSearchHistory("cookie")
        assertEquals(3, items.size)
        assertEquals("foo", items[0].keyword)
        assertEquals("bar", items[1].keyword)
        assertEquals("baz", items[2].keyword)
        // Timestamps are monotonically decreasing (later items get older ts)
        assertTrue(items[0].searchedAt > items[2].searchedAt)
    }

    @Test
    fun fetchSearchHistory_emptyHistoryReturnsEmpty() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(MockResponse().setResponseCode(200).setBody("{\"data\":{}}"))
        val items = client.fetchSearchHistory("cookie")
        assertTrue(items.isEmpty())
    }

    @Test
    fun fetchSearchHistory_signerFailureShortCircuits() = runTest {
        client.signProvider = StubSignProvider().apply { failNext = true }
        val items = client.fetchSearchHistory("cookie")
        assertTrue(items.isEmpty())
        assertEquals(0, server.requestCount)
        assertEquals(-99, client.lastErrorCode)
    }

    @Test
    fun fetchFeed_http412PropagatesErrorCode() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(MockResponse().setResponseCode(412).setBody("blocked"))
        val items = client.fetchFeed("cookie")
        assertTrue(items.isEmpty())
        assertEquals(412, client.lastErrorCode)
    }

    @Test
    fun fetchCollection_emptyDataReturnsEmpty() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(MockResponse().setResponseCode(200).setBody("{\"data\":[]}"))
        val items = client.fetchCollection("cookie")
        assertTrue(items.isEmpty())
        assertEquals(0, client.lastErrorCode)
    }

    @Test
    fun fetchFeed_emptyDataReturnsEmpty() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(MockResponse().setResponseCode(200).setBody("{\"data\":[]}"))
        val items = client.fetchFeed("cookie")
        assertTrue(items.isEmpty())
    }
}
