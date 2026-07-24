package com.chainlesschain.android.pdh.social.toutiao

import com.chainlesschain.android.pdh.social.NullSignProvider
import com.chainlesschain.android.pdh.social.SignProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.util.concurrent.CancellationException
import java.util.Collections
import java.util.concurrent.TimeUnit
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
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
        var callCount: Int = 0
        var throwOnCall: Int? = null
        override suspend fun signUrl(rawUrl: HttpUrl, purpose: String): HttpUrl? {
            callCount += 1
            lastPurpose = purpose
            lastUrl = rawUrl
            if (throwOnCall == callCount) error("signer exploded")
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
    fun fetchSearchHistory_missingRecognizedListFailsClosed() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(MockResponse().setResponseCode(200).setBody("{\"data\":{}}"))
        val items = client.fetchSearchHistory("cookie")
        assertTrue(items.isEmpty())
        assertEquals(-6, client.lastErrorCode)
        assertTrue(client.lastErrorMessage!!.contains("recognized list"))
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

    @Test
    fun fetchFeed_rejectsBusinessErrorAndInvokesPermitBeforeNetwork() = runTest {
        client.signProvider = StubSignProvider()
        val permits = mutableListOf<ToutiaoApiClient.SourceRequest>()
        client.beforeSourceRequest = { request ->
            assertEquals(0, server.requestCount)
            permits.add(request)
        }
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"err_no":1,"message":"params illegal","data":[]}"""),
        )

        val items = client.fetchFeed("cookie")

        assertTrue(items.isEmpty())
        assertEquals(1, client.lastErrorCode)
        assertEquals("params illegal", client.lastErrorMessage)
        assertEquals(listOf("feed"), permits.map { it.operation })
        assertEquals(listOf(1), permits.map { it.page })
    }

    @Test
    fun fetchFeed_paginatesDedupesAndPreservesPartialTransportError() = runTest {
        client.signProvider = StubSignProvider()
        val permits = mutableListOf<ToutiaoApiClient.SourceRequest>()
        client.beforeSourceRequest = { permits.add(it) }
        server.enqueue(
            MockResponse().setBody(
                """{"has_more":true,"next":{"max_behot_time":100},"data":[{"group_id":"g1"},{"group_id":"g2"}]}""",
            ),
        )
        server.enqueue(
            MockResponse().setBody(
                """{"has_more":true,"next":{"max_behot_time":90},"data":[{"group_id":"g2"},{"group_id":"g3"}]}""",
            ),
        )
        server.enqueue(MockResponse().setResponseCode(503).setBody("busy"))

        val items = client.fetchFeed("cookie", limit = 10)

        assertEquals(listOf("g1", "g2", "g3"), items.map { it.itemId })
        assertEquals(503, client.lastErrorCode)
        assertEquals(listOf(1, 2, 3), permits.map { it.page })
        assertEquals(listOf(null, "100", "90"), permits.map { it.cursor })
        assertTrue(server.takeRequest().requestUrl!!.queryParameter("max_behot_time") == null)
        assertEquals("100", server.takeRequest().requestUrl!!.queryParameter("max_behot_time"))
        assertEquals("90", server.takeRequest().requestUrl!!.queryParameter("max_behot_time"))
    }

    @Test
    fun fetchCollection_capsPagesAtTen() = runTest {
        client.signProvider = StubSignProvider()
        repeat(10) { index ->
            val next = index + 1
            server.enqueue(
                MockResponse().setBody(
                    """{"has_more":true,"next_offset":$next,"data":[{"group_id":"c$index"}]}""",
                ),
            )
        }

        val items = client.fetchCollection("cookie", limit = 1_000, maxPages = 99)

        assertEquals(10, items.size)
        assertEquals(10, server.requestCount)
        assertEquals(ToutiaoApiClient.ERROR_PAGINATION_TRUNCATED, client.lastErrorCode)
    }

    @Test
    fun fetchProfile_acceptsPassportV2SuccessAndPreservesNestedError() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"message":"success","data":{"user_id":"42","screen_name":"alice"}}""",
            ),
        )
        val success = client.fetchProfileResult("sessionid=ok")
        assertEquals("42", success.value?.uid)
        assertEquals(0, success.error.code)

        server.enqueue(
            MockResponse().setBody(
                """{"message":"error","data":{"error_code":16,"description":"该应用无权限"}}""",
            ),
        )
        val denied = client.fetchProfileResult("sessionid=denied")
        assertNull(denied.value)
        assertEquals(16, denied.error.code)
        assertEquals("该应用无权限", denied.error.message)
    }

    @Test
    fun fetchFeed_rejectsSignedAliasesAndExplicitFailureFlags() = runTest {
        client.signProvider = StubSignProvider()
        val cases = listOf(
            Triple("""{"code":451,"message":"code blocked","data":[]}""", 451, "code blocked"),
            Triple("""{"errno":"452","description":"errno blocked","data":[]}""", 452, "errno blocked"),
            Triple("""{"errorCode":453,"error_description":"camel blocked","data":[]}""", 453, "camel blocked"),
            Triple("""{"error_code":454,"err_tips":"snake blocked","data":[]}""", 454, "snake blocked"),
            Triple("""{"success":false,"message":"denied","data":[]}""", -6, "denied"),
            Triple("""{"ok":"false","error_description":"not ok","data":[]}""", -6, "not ok"),
            Triple("""{"message":"error","description":"explicit error","data":[]}""", -6, "explicit error"),
        )
        for ((body, expectedCode, expectedMessage) in cases) {
            server.enqueue(MockResponse().setBody(body))
            val result = client.fetchFeedResult("cookie")
            assertTrue(result.value.isEmpty())
            assertEquals(expectedCode, result.error.code)
            assertEquals(expectedMessage, result.error.message)
        }

        server.enqueue(
            MockResponse().setBody(
                """{"code":200,"message":"success","error":"false","data":[{"group_id":"ok"}]}""",
            ),
        )
        val accepted = client.fetchFeedResult("cookie", limit = 1)
        assertEquals(listOf("ok"), accepted.value.map { it.itemId })
        assertEquals(0, accepted.error.code)
    }

    @Test
    fun fetchFeed_rejectsFractionalAndOutOfRangeBusinessCodesWithoutTruncatingThem() = runTest {
        client.signProvider = StubSignProvider()
        for (body in listOf(
            """{"code":1.5,"data":[]}""",
            """{"errorCode":2147483648,"data":[]}""",
            """{"code":null,"data":[]}""",
            """{"success":"maybe","data":[]}""",
            """{"ok":{},"data":[]}""",
        )) {
            server.enqueue(MockResponse().setBody(body))
            val result = client.fetchFeedResult("cookie")
            assertTrue(result.value.isEmpty())
            assertEquals(-6, result.error.code)
            assertTrue(result.error.message!!.contains("must be"))
        }
    }

    @Test
    fun fetchFeed_marksRepeatedPagesAndCursorsAsPartialPaginationErrors() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(
            MockResponse().setBody(
                """{"has_more":true,"next":{"max_behot_time":100},"data":[{"group_id":"g1"}]}""",
            ),
        )
        server.enqueue(
            MockResponse().setBody(
                """{"has_more":true,"next":{"max_behot_time":90},"data":[{"group_id":"g1"}]}""",
            ),
        )
        val repeatedPage = client.fetchFeedResult("cookie", limit = 10)
        assertEquals(listOf("g1"), repeatedPage.value.map { it.itemId })
        assertEquals(ToutiaoApiClient.ERROR_PAGINATION_TRUNCATED, repeatedPage.error.code)
        assertTrue(repeatedPage.error.message!!.contains("repeated page"))

        server.enqueue(
            MockResponse().setBody(
                """{"has_more":true,"next":{"max_behot_time":80},"data":[{"group_id":"g2"}]}""",
            ),
        )
        server.enqueue(
            MockResponse().setBody(
                """{"has_more":true,"next":{"max_behot_time":80},"data":[{"group_id":"g3"}]}""",
            ),
        )
        val repeatedCursor = client.fetchFeedResult("cookie", limit = 10)
        assertEquals(listOf("g2", "g3"), repeatedCursor.value.map { it.itemId })
        assertEquals(ToutiaoApiClient.ERROR_PAGINATION_TRUNCATED, repeatedCursor.error.code)
        assertTrue(repeatedCursor.error.message!!.contains("repeated cursor"))
    }

    @Test
    fun paginationRejectsMissingCompositeAndNonForwardContinuationsWithPartialRows() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(
            MockResponse().setBody(
                """{"has_more":true,"data":[{"group_id":"g1"}]}""",
            ),
        )
        val missingCursor = client.fetchFeedResult("cookie", limit = 10)
        assertEquals(listOf("g1"), missingCursor.value.map { it.itemId })
        assertEquals(ToutiaoApiClient.ERROR_PAGINATION_TRUNCATED, missingCursor.error.code)

        server.enqueue(
            MockResponse().setBody(
                """{"has_more":true,"next":{"max_behot_time":{"bad":1}},"data":[{"group_id":"g2"}]}""",
            ),
        )
        val compositeCursor = client.fetchFeedResult("cookie", limit = 10)
        assertEquals(listOf("g2"), compositeCursor.value.map { it.itemId })
        assertEquals(ToutiaoApiClient.ERROR_PAGINATION_TRUNCATED, compositeCursor.error.code)
        assertTrue(compositeCursor.error.message!!.contains("scalar"))

        for (offset in listOf("0", "1.5", "9223372036854775808")) {
            server.enqueue(
                MockResponse().setBody(
                    """{"has_more":true,"next_offset":$offset,"data":[{"group_id":"c$offset"}]}""",
                ),
            )
            val result = client.fetchCollectionResult("cookie", limit = 10)
            assertEquals(1, result.value.size)
            assertEquals(ToutiaoApiClient.ERROR_PAGINATION_TRUNCATED, result.error.code)
        }
    }

    @Test
    fun fetchFeed_preservesPageOneWhenPageTwoSignerThrowsAndPropagatesSignerCancellation() = runTest {
        val signer = StubSignProvider().apply { throwOnCall = 2 }
        client.signProvider = signer
        server.enqueue(
            MockResponse().setBody(
                """{"has_more":true,"next":{"max_behot_time":100},"data":[{"group_id":"g1"}]}""",
            ),
        )
        val partial = client.fetchFeedResult("cookie", limit = 10)
        assertEquals(listOf("g1"), partial.value.map { it.itemId })
        assertEquals(ToutiaoApiClient.ERROR_SIGNER_UNAVAILABLE, partial.error.code)
        assertTrue(partial.error.message!!.contains("signer exploded"))
        assertEquals(1, server.requestCount)

        client.signProvider = object : SignProvider {
            override suspend fun signUrl(rawUrl: HttpUrl, purpose: String): HttpUrl? {
                throw CancellationException("stop")
            }
        }
        assertFailsWith<CancellationException> {
            client.fetchFeed("cookie")
        }
    }

    @Test
    fun fetchResultKeepsItsErrorAfterLaterGlobalSuccess() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(
            MockResponse().setBody(
                """{"error_code":461,"description":"first failed","data":[]}""",
            ),
        )
        val failed = client.fetchFeedResult("cookie")
        server.enqueue(MockResponse().setBody("""{"data":[]}"""))
        val succeeded = client.fetchFeedResult("cookie")

        assertEquals(461, failed.error.code)
        assertEquals("first failed", failed.error.message)
        assertEquals(0, succeeded.error.code)
        assertEquals(0, client.lastErrorCode)
    }

    @Test
    fun extractUidResultKeepsValueAndDiagnosticTogetherAcrossLaterCalls() {
        val missing = client.extractUidResult("sessionid=guest")
        val accepted = client.extractUidResult("passport_uid=42")

        assertNull(missing.value)
        assertEquals(-7, missing.error.code)
        assertTrue(missing.error.message!!.contains("passport_uid"))
        assertEquals("42", accepted.value)
        assertEquals(ToutiaoApiClient.ErrorSnapshot(), accepted.error)
        assertEquals(0, client.lastErrorCode)
    }

    @Test
    fun legacyFetchFreezesSignerAndPermitForEveryPage() = runTest {
        val replacementSigner = StubSignProvider()
        val originalPermits = mutableListOf<ToutiaoApiClient.SourceRequest>()
        val replacementPermits = mutableListOf<ToutiaoApiClient.SourceRequest>()
        var originalSignCalls = 0
        val originalSigner = object : SignProvider {
            override suspend fun signUrl(rawUrl: HttpUrl, purpose: String): HttpUrl {
                originalSignCalls += 1
                if (originalSignCalls == 1) {
                    client.signProvider = replacementSigner
                    client.beforeSourceRequest = { replacementPermits.add(it) }
                }
                return rawUrl.newBuilder()
                    .addQueryParameter("_signature", "frozen-context")
                    .build()
            }
        }
        client.signProvider = originalSigner
        client.beforeSourceRequest = { originalPermits.add(it) }
        server.enqueue(
            MockResponse().setBody(
                """{"has_more":true,"next":{"max_behot_time":100},"data":[{"group_id":"g1"}]}""",
            ),
        )
        server.enqueue(
            MockResponse().setBody(
                """{"data":[{"group_id":"g2"}]}""",
            ),
        )

        val result = client.fetchFeedResult("cookie", limit = 10)

        assertEquals(listOf("g1", "g2"), result.value.map { it.itemId })
        assertEquals(0, result.error.code)
        assertEquals(2, originalSignCalls)
        assertEquals(0, replacementSigner.callCount)
        assertEquals(listOf(1, 2), originalPermits.map { it.page })
        assertTrue(replacementPermits.isEmpty())
        val requests = listOf(server.takeRequest(), server.takeRequest())
        assertTrue(
            requests.all {
                it.requestUrl?.queryParameter("_signature") == "frozen-context"
            },
        )
    }

    @Test
    fun explicitRequestContextsStayIsolatedWhenFetchesRunConcurrently() = runTest {
        fun signer(tag: String): SignProvider = object : SignProvider {
            override suspend fun signUrl(rawUrl: HttpUrl, purpose: String): HttpUrl =
                rawUrl.newBuilder().addQueryParameter("_signature", tag).build()
        }
        val permitsA = Collections.synchronizedList(
            mutableListOf<ToutiaoApiClient.SourceRequest>(),
        )
        val permitsB = Collections.synchronizedList(
            mutableListOf<ToutiaoApiClient.SourceRequest>(),
        )
        val contextA = ToutiaoApiClient.RequestContext(
            signProvider = signer("context-a"),
            beforeSourceRequest = { permitsA.add(it) },
        )
        val contextB = ToutiaoApiClient.RequestContext(
            signProvider = signer("context-b"),
            beforeSourceRequest = { permitsB.add(it) },
        )
        repeat(2) {
            server.enqueue(
                MockResponse().setBody(
                    """{"data":[{"group_id":"row-$it"}]}""",
                ),
            )
        }

        val results = awaitAll(
            async { client.fetchFeedResult("cookie-a", contextA, limit = 1) },
            async { client.fetchFeedResult("cookie-b", contextB, limit = 1) },
        )

        assertTrue(results.all { it.error.code == 0 && it.value.size == 1 })
        assertEquals(1, permitsA.size)
        assertEquals(1, permitsB.size)
        val signatures = listOf(server.takeRequest(), server.takeRequest())
            .mapNotNull { it.requestUrl?.queryParameter("_signature") }
            .toSet()
        assertEquals(setOf("context-a", "context-b"), signatures)
    }

    @Test
    fun stringTrueHasMoreWithoutContinuationKeepsRowsAndReportsTruncation() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(
            MockResponse().setBody(
                """{"has_more":"true","data":[{"group_id":"partial"}]}""",
            ),
        )

        val result = client.fetchFeedResult("cookie", limit = 10)

        assertEquals(listOf("partial"), result.value.map { it.itemId })
        assertEquals(ToutiaoApiClient.ERROR_PAGINATION_TRUNCATED, result.error.code)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun topLevelFeedCursorAdvertisesAndDrivesTheNextPage() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(
            MockResponse().setBody(
                """{"max_behot_time":100,"data":[{"group_id":"g1"}]}""",
            ),
        )
        server.enqueue(
            MockResponse().setBody(
                """{"data":[{"group_id":"g2"}]}""",
            ),
        )

        val result = client.fetchFeedResult("cookie", limit = 10)

        assertEquals(listOf("g1", "g2"), result.value.map { it.itemId })
        assertEquals(0, result.error.code)
        assertEquals(2, server.requestCount)
        server.takeRequest()
        assertEquals(
            "100",
            server.takeRequest().requestUrl?.queryParameter("max_behot_time"),
        )
    }

    @Test
    fun malformedAndConflictingPaginationFlagsFailClosedWithPartialRows() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(
            MockResponse().setBody(
                """{"has_more":"maybe","data":[{"group_id":"feed-partial"}]}""",
            ),
        )
        val malformedFeed = client.fetchFeedResult("cookie", limit = 10)
        assertEquals(listOf("feed-partial"), malformedFeed.value.map { it.itemId })
        assertEquals(
            ToutiaoApiClient.ERROR_PAGINATION_TRUNCATED,
            malformedFeed.error.code,
        )
        assertTrue(malformedFeed.error.message!!.contains("boolean-like"))

        server.enqueue(
            MockResponse().setBody(
                """
                {
                  "has_more": true,
                  "hasMore": false,
                  "next_offset": 1,
                  "data": [{"group_id":"collection-partial"}]
                }
                """.trimIndent(),
            ),
        )
        val conflictingOffset = client.fetchCollectionResult("cookie", limit = 10)
        assertEquals(
            listOf("collection-partial"),
            conflictingOffset.value.map { it.itemId },
        )
        assertEquals(
            ToutiaoApiClient.ERROR_PAGINATION_TRUNCATED,
            conflictingOffset.error.code,
        )
        assertTrue(conflictingOffset.error.message!!.contains("conflicting"))
    }

    @Test
    fun malformedPaginationFlagsOnEmptyPagesFailClosedAcrossAllStreams() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(
            MockResponse().setBody(
                """{"has_more":{},"data":[]}""",
            ),
        )
        val feed = client.fetchFeedResult("cookie")

        server.enqueue(
            MockResponse().setBody(
                """{"hasMore":2,"data":[]}""",
            ),
        )
        val collection = client.fetchCollectionResult("cookie")

        server.enqueue(
            MockResponse().setBody(
                """{"has_more":"maybe","data":{"user_search_history":[]}}""",
            ),
        )
        val search = client.fetchSearchHistoryResult("cookie")

        for (result in listOf(feed.error, collection.error, search.error)) {
            assertEquals(ToutiaoApiClient.ERROR_PAGINATION_TRUNCATED, result.code)
            assertTrue(result.message!!.contains("boolean-like"))
        }
    }

    @Test
    fun emptyPagesWithExplicitFeedOrOffsetContinuationsAreTruncationErrors() = runTest {
        client.signProvider = StubSignProvider()
        server.enqueue(
            MockResponse().setBody(
                """{"next":{"max_behot_time":100},"data":[]}""",
            ),
        )
        val feed = client.fetchFeedResult("cookie")

        server.enqueue(
            MockResponse().setBody(
                """{"next_offset":10,"data":[]}""",
            ),
        )
        val collection = client.fetchCollectionResult("cookie")

        assertEquals(ToutiaoApiClient.ERROR_PAGINATION_TRUNCATED, feed.error.code)
        assertTrue(feed.error.message!!.contains("empty page advertised"))
        assertEquals(
            ToutiaoApiClient.ERROR_PAGINATION_TRUNCATED,
            collection.error.code,
        )
        assertTrue(collection.error.message!!.contains("empty page advertised"))
        assertEquals(2, server.requestCount)
    }

    @Test
    fun fetchFeed_disablesRedirectFollowUpsSoOnePermitMeansOneRequest() = runTest {
        client.signProvider = StubSignProvider()
        val permits = mutableListOf<ToutiaoApiClient.SourceRequest>()
        client.beforeSourceRequest = { permits.add(it) }
        server.enqueue(
            MockResponse()
                .setResponseCode(302)
                .addHeader("Location", server.url("/redirected")),
        )
        server.enqueue(MockResponse().setBody("""{"data":[{"group_id":"unexpected"}]}"""))

        val result = client.fetchFeedResult("cookie")
        assertTrue(result.value.isEmpty())
        assertEquals(302, result.error.code)
        assertEquals(1, permits.size)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun retryAfterZeroCannotSpendASecondWireAttemptOrPermit() = runTest {
        client.signProvider = StubSignProvider()
        val permits = mutableListOf<ToutiaoApiClient.SourceRequest>()
        client.beforeSourceRequest = { permits.add(it) }
        server.enqueue(
            MockResponse()
                .setResponseCode(503)
                .addHeader("Retry-After", "0")
                .setBody("busy"),
        )
        server.enqueue(MockResponse().setBody("""{"data":[{"group_id":"unexpected"}]}"""))

        val result = client.fetchFeedResult("cookie")

        assertTrue(result.value.isEmpty())
        assertEquals(503, result.error.code)
        assertEquals(1, permits.size)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun http421IsPreservedWhileItsImplicitFollowUpIsDisabled() = runTest {
        client.signProvider = StubSignProvider()
        val permits = mutableListOf<ToutiaoApiClient.SourceRequest>()
        client.beforeSourceRequest = { permits.add(it) }
        server.enqueue(
            MockResponse()
                .setResponseCode(421)
                .setBody("misdirected"),
        )
        server.enqueue(MockResponse().setBody("""{"data":[{"group_id":"unexpected"}]}"""))

        val result = client.fetchFeedResult("cookie")

        assertTrue(result.value.isEmpty())
        assertEquals(421, result.error.code)
        assertEquals("HTTP 421", result.error.message)
        assertEquals(1, permits.size)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun fetchFeed_cancellationCancelsDelayedBodyWithoutRecordingIoFailure() = runBlocking {
        client.signProvider = StubSignProvider()
        server.enqueue(
            MockResponse()
                .setBody("""{"data":[{"group_id":"too-late"}]}""")
                .setBodyDelay(30, TimeUnit.SECONDS),
        )
        val pending = async(Dispatchers.IO) {
            client.fetchFeed("cookie")
        }
        val request = withContext(Dispatchers.IO) {
            server.takeRequest(5, TimeUnit.SECONDS)
        }
        assertNotNull(request)
        pending.cancel()
        withTimeout(2_000) { pending.join() }
        assertTrue(pending.isCancelled)
        assertEquals(0, client.lastErrorCode)
    }
}
