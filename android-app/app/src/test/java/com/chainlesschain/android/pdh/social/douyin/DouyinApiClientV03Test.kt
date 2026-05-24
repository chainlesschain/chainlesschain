package com.chainlesschain.android.pdh.social.douyin

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
 * §A8 v0.3 — Douyin fetchHistory / fetchFavourites / fetchLikes JVM cover.
 *
 * Stub SignProvider returns both signed URL (with `_signature` query) AND
 * a fake X-Bogus header. Tests assert:
 *  - HTTP request received has X-Bogus header (Douyin's anti-bot gate)
 *  - HTTP request URL has _signature query
 *  - null signer → no HTTP issued (NullSignProvider short-circuit)
 *  - aweme_list parsing handles missing author / 0 create_time
 *  - HTTP 412 / non-JSON propagate to lastErrorCode
 */
class DouyinApiClientV03Test {

    private lateinit var server: MockWebServer
    private lateinit var client: DouyinApiClient

    /**
     * Stub signer simulates the dual-output Douyin pattern: signUrl appends
     * _signature query, signedHeaders returns X-Bogus header. Lookup by
     * URL identity so paired (signUrl, signedHeaders) calls for the same
     * rawUrl can be tested.
     */
    private class StubSignProvider : SignProvider {
        var lastPurpose: String? = null
        var failNext: Boolean = false
        private val urlToHeaders = HashMap<HttpUrl, Map<String, String>>()
        override suspend fun signUrl(rawUrl: HttpUrl, purpose: String): HttpUrl? {
            lastPurpose = purpose
            if (failNext) return null
            urlToHeaders[rawUrl] = mapOf("X-Bogus" to "bogus-$purpose")
            return rawUrl.newBuilder().addQueryParameter("_signature", "sig-$purpose").build()
        }
        override suspend fun signedHeaders(rawUrl: HttpUrl, purpose: String): Map<String, String> {
            return urlToHeaders[rawUrl] ?: emptyMap()
        }
    }

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = DouyinApiClient().apply {
            baseUrl = server.url("/").toString().toHttpUrl()
            httpClient = OkHttpClient.Builder().build()
        }
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun fetchHistory_invokesSignerAndAttachesBogusHeader() = runTest {
        val signer = StubSignProvider()
        client.signProvider = signer
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """
                {
                  "aweme_list": [
                    {"aweme_id": "a1", "desc": "Dance video", "create_time": 1716500000,
                     "duration": 30000,
                     "author": {"sec_uid": "MS4w_alice", "nickname": "Alice"}},
                    {"aweme_id": "a2", "desc": "Cooking", "create_time": 1716499000,
                     "duration": 45000}
                  ]
                }
                """.trimIndent(),
            ),
        )
        val items = client.fetchHistory("sessionid=abc")
        assertEquals(2, items.size)
        assertEquals("a1", items[0].awemeId)
        assertEquals("Dance video", items[0].description)
        assertEquals("Alice", items[0].authorNickname)
        assertEquals("MS4w_alice", items[0].authorSecUid)
        assertEquals(1716500000_000L, items[0].watchedAt)
        assertEquals(30000L, items[0].duration)
        assertEquals("history", signer.lastPurpose)
        val req = server.takeRequest()
        assertTrue(req.requestUrl.toString().contains("_signature=sig-history"))
        assertTrue(req.requestUrl.toString().contains("aweme/v1/web/history/read"))
        assertEquals("bogus-history", req.getHeader("X-Bogus"))
    }

    @Test
    fun fetchFavourites_signerCalledWithFavouritePurpose() = runTest {
        val signer = StubSignProvider()
        client.signProvider = signer
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """
                {
                  "aweme_list": [
                    {"aweme_id": "f1", "desc": "Saved video", "create_time": 1716400000,
                     "author": {"nickname": "Bob"}}
                  ]
                }
                """.trimIndent(),
            ),
        )
        val items = client.fetchFavourites("cookie")
        assertEquals(1, items.size)
        assertEquals("f1", items[0].awemeId)
        assertEquals("Bob", items[0].authorNickname)
        assertEquals(1716400000_000L, items[0].savedAt)
        val req = server.takeRequest()
        assertTrue(req.requestUrl.toString().contains("_signature=sig-favourite"))
        assertEquals("bogus-favourite", req.getHeader("X-Bogus"))
    }

    @Test
    fun fetchLikes_handlesMissingAuthor() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """
                {
                  "aweme_list": [
                    {"aweme_id": "l1", "desc": "Liked but no author", "create_time": 1716300000}
                  ]
                }
                """.trimIndent(),
            ),
        )
        val items = client.fetchLikes("cookie")
        assertEquals(1, items.size)
        assertEquals("l1", items[0].awemeId)
        assertEquals(null, items[0].authorNickname)
    }

    @Test
    fun fetchHistory_returnsEmptyWhenSignerFails() = runTest {
        val signer = StubSignProvider().apply { failNext = true }
        client.signProvider = signer
        val items = client.fetchHistory("cookie")
        assertTrue(items.isEmpty())
        assertEquals(-99, client.lastErrorCode)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun fetchHistory_defaultsToNullSignProviderShortCircuits() = runTest {
        client.signProvider = NullSignProvider
        val items = client.fetchHistory("cookie")
        assertTrue(items.isEmpty())
        assertEquals(0, server.requestCount)
    }

    @Test
    fun fetchHistory_http412PropagatesErrorCode() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(MockResponse().setResponseCode(412).setBody("blocked"))
        val items = client.fetchHistory("cookie")
        assertTrue(items.isEmpty())
        assertEquals(412, client.lastErrorCode)
    }

    @Test
    fun fetchHistory_nonJsonBodySurfacesError() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(MockResponse().setResponseCode(200).setBody("<html>login</html>"))
        val items = client.fetchHistory("cookie")
        assertTrue(items.isEmpty())
        assertEquals(-4, client.lastErrorCode)
    }

    @Test
    fun fetchFavourites_emptyAwemeListReturnsEmpty() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(MockResponse().setResponseCode(200).setBody("{\"aweme_list\":[]}"))
        val items = client.fetchFavourites("cookie")
        assertTrue(items.isEmpty())
        assertEquals(0, client.lastErrorCode)
    }

    @Test
    fun fetchHistory_signedHeadersOmittedWhenSignerProvidesNone() = runTest {
        // A signer that signs the URL but supplies no extra headers — the
        // request should still go out (Toutiao-style), just without X-Bogus.
        client.signProvider = object : SignProvider {
            override suspend fun signUrl(rawUrl: HttpUrl, purpose: String): HttpUrl? =
                rawUrl.newBuilder().addQueryParameter("_signature", "url-only").build()
            // signedHeaders defaults to emptyMap
        }
        server.enqueue(MockResponse().setResponseCode(200).setBody("{\"aweme_list\":[]}"))
        client.fetchHistory("cookie")
        val req = server.takeRequest()
        assertTrue(req.requestUrl.toString().contains("_signature=url-only"))
        assertEquals(null, req.getHeader("X-Bogus"))
    }

    @Test
    fun fetchLikes_zeroCreateTimeFallsToNullTs() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """
                {"aweme_list":[
                  {"aweme_id":"l99","desc":"No ts","create_time":0}
                ]}
                """.trimIndent(),
            ),
        )
        val items = client.fetchLikes("cookie")
        assertEquals(1, items.size)
        assertEquals(0L, items[0].likedAt)
    }
}
