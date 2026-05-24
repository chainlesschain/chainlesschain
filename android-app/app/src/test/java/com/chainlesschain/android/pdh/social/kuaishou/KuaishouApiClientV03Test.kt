package com.chainlesschain.android.pdh.social.kuaishou

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
 * §A8 v0.3 — Kuaishou GraphQL POST endpoints JVM cover.
 *
 * Sign stub returns dual-output (URL __NS_sig3 query + kpf/kpn headers).
 * Asserts:
 *  - POST request to /graphql carries kpf + kpn headers (Kuaishou anti-bot gate)
 *  - Request URL has __NS_sig3 query (signer applied)
 *  - GraphQL response shape parse: `{data:{visionFeedRecommend:{feeds:[{photo:{...}}]}}}`
 *  - GraphQL `errors` array → lastErrorCode=-5
 *  - null signer → no HTTP issued (NullSignProvider short-circuit)
 *  - HTTP 412 / non-JSON propagate
 */
class KuaishouApiClientV03Test {

    private lateinit var server: MockWebServer
    private lateinit var client: KuaishouApiClient

    private class StubSignProvider : SignProvider {
        var lastPurpose: String? = null
        var failNext: Boolean = false
        private val urlToHeaders = HashMap<HttpUrl, Map<String, String>>()
        override suspend fun signUrl(rawUrl: HttpUrl, purpose: String): HttpUrl? {
            lastPurpose = purpose
            if (failNext) return null
            urlToHeaders[rawUrl] = mapOf("kpf" to "PC_WEB", "kpn" to "KUAISHOU_VISION")
            return rawUrl.newBuilder().addQueryParameter("__NS_sig3", "sig-stub").build()
        }
        override suspend fun signedHeaders(rawUrl: HttpUrl, purpose: String): Map<String, String> {
            return urlToHeaders[rawUrl] ?: emptyMap()
        }
    }

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = KuaishouApiClient().apply {
            baseUrl = server.url("/").toString().toHttpUrl()
            httpClient = OkHttpClient.Builder().build()
        }
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun fetchWatchHistory_parsesFeedsAndAttachesHeaders() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """
                {
                  "data": {
                    "visionFeedRecommend": {
                      "feeds": [
                        {"photo": {"id": "p1", "caption": "Dance video",
                                    "timestamp": 1716500000, "duration": 30000},
                         "author": {"name": "Alice", "id": "u1"}},
                        {"photo": {"id": "p2", "caption": "Cooking",
                                    "timestamp": 1716499000}}
                      ]
                    }
                  }
                }
                """.trimIndent(),
            ),
        )
        val items = client.fetchWatchHistory("kuaishou.web.cp.api_ph=foo")
        assertEquals(2, items.size)
        assertEquals("p1", items[0].photoId)
        assertEquals("Dance video", items[0].caption)
        assertEquals("Alice", items[0].authorName)
        assertEquals("u1", items[0].authorId)
        assertEquals(1716500000_000L, items[0].viewedAt)
        assertEquals(30000L, items[0].duration)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertTrue(req.requestUrl.toString().contains("graphql"))
        assertTrue(req.requestUrl.toString().contains("__NS_sig3=sig-stub"))
        assertEquals("PC_WEB", req.getHeader("kpf"))
        assertEquals("KUAISHOU_VISION", req.getHeader("kpn"))
        // Body should be JSON with operationName
        val body = req.body.readUtf8()
        assertTrue(body.contains("visionFeedRecommend"))
    }

    @Test
    fun fetchProfilePhotos_userIdInVariables() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """
                {
                  "data": {
                    "visionProfilePhotoList": {
                      "feeds": [
                        {"photo": {"id": "pp1", "caption": "My post 1", "timestamp": 1716400000}}
                      ]
                    }
                  }
                }
                """.trimIndent(),
            ),
        )
        val items = client.fetchProfilePhotos("cookie", "12345")
        assertEquals(1, items.size)
        assertEquals("pp1", items[0].photoId)
        assertEquals(1716400000_000L, items[0].postedAt)
        val req = server.takeRequest()
        val body = req.body.readUtf8()
        assertTrue(body.contains("\"userId\":\"12345\""))
    }

    @Test
    fun fetchSearchHistory_objectShape() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """
                {
                  "data": {
                    "visionSearchPhoto": {
                      "recentSearchList": [
                        {"keyword": "kotlin", "time": 1716500000},
                        {"keyword": "rust", "searchTime": 1716499000}
                      ]
                    }
                  }
                }
                """.trimIndent(),
            ),
        )
        val items = client.fetchSearchHistory("cookie")
        assertEquals(2, items.size)
        assertEquals("kotlin", items[0].keyword)
        assertEquals(1716500000_000L, items[0].searchedAt)
    }

    @Test
    fun fetchSearchHistory_emptyHistoryReturnsEmpty() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(MockResponse().setResponseCode(200).setBody("{\"data\":{\"visionSearchPhoto\":{}}}"))
        val items = client.fetchSearchHistory("cookie")
        assertTrue(items.isEmpty())
    }

    @Test
    fun fetchWatchHistory_returnsEmptyWhenSignerFails() = runTest {
        client.signProvider = StubSignProvider().apply { failNext = true }
        val items = client.fetchWatchHistory("cookie")
        assertTrue(items.isEmpty())
        assertEquals(-99, client.lastErrorCode)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun fetchWatchHistory_nullProviderShortCircuits() = runTest {
        client.signProvider = NullSignProvider
        val items = client.fetchWatchHistory("cookie")
        assertTrue(items.isEmpty())
        assertEquals(0, server.requestCount)
    }

    @Test
    fun fetchWatchHistory_http412PropagatesErrorCode() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(MockResponse().setResponseCode(412).setBody("blocked"))
        val items = client.fetchWatchHistory("cookie")
        assertTrue(items.isEmpty())
        assertEquals(412, client.lastErrorCode)
    }

    @Test
    fun fetchWatchHistory_graphqlErrorsSetLastError() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """
                {"errors":[{"message":"NOT_LOGGED_IN"}]}
                """.trimIndent(),
            ),
        )
        val items = client.fetchWatchHistory("cookie")
        assertTrue(items.isEmpty())
        assertEquals(-5, client.lastErrorCode)
        assertNotNull(client.lastErrorMessage)
        assertTrue(client.lastErrorMessage!!.contains("NOT_LOGGED_IN"))
    }

    @Test
    fun fetchProfilePhotos_nonJsonResponseSurfacesError() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(MockResponse().setResponseCode(200).setBody("<html>blocked</html>"))
        val items = client.fetchProfilePhotos("cookie", "1234")
        assertTrue(items.isEmpty())
        assertEquals(-4, client.lastErrorCode)
    }

    @Test
    fun fetchWatchHistory_flatPhotoFallback() = runTest {
        // Some responses don't nest the photo under `photo` — feed item
        // IS the photo. Verify fallback parse.
        client.signProvider = StubSignProvider()
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """
                {"data":{"visionFeedRecommend":{"feeds":[
                  {"id":"flat1","caption":"Flat shape","timestamp":1716300000}
                ]}}}
                """.trimIndent(),
            ),
        )
        val items = client.fetchWatchHistory("cookie")
        assertEquals(1, items.size)
        assertEquals("flat1", items[0].photoId)
    }
}
