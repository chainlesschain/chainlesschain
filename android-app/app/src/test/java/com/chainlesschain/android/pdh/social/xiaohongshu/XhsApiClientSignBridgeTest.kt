package com.chainlesschain.android.pdh.social.xiaohongshu

import com.chainlesschain.android.pdh.social.NullSignProvider
import com.chainlesschain.android.pdh.social.SignProvider
import kotlinx.coroutines.test.runTest
import okhttp3.HttpUrl
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * §A8 v0.3 — XhsApiClient signProvider integration JVM cover.
 *
 * Bridge wiring: when signProvider is wired AND returns non-empty
 * signedHeaders, ApiClient must use those over the in-process best-effort
 * computeXsXt. When signProvider returns null (rotation / warm-up fail)
 * OR empty headers, ApiClient must fall back to computeXsXt so v0.2
 * partial coverage is preserved.
 *
 * Asserts the X-s/X-t/X-s-common headers reach the server with the
 * bridge's literal values when the bridge is wired.
 */
class XhsApiClientSignBridgeTest {

    private lateinit var server: MockWebServer
    private lateinit var client: XhsApiClient

    /**
     * Stub signer returns deterministic bridge-style headers. Real bridge
     * extracts X-s/X-t/X-s-common from `window._webmsxyw(...)` output; the
     * stub just hardcodes them.
     */
    private class StubBridge : SignProvider {
        var lastPurpose: String? = null
        var failNext: Boolean = false
        var headersForNext: Map<String, String> = mapOf(
            "X-s" to "XYW_bridge_sig",
            "X-t" to "1716500000000",
            "X-s-common" to "common_value",
        )
        private val urlToHeaders = HashMap<HttpUrl, Map<String, String>>()
        override suspend fun signUrl(rawUrl: HttpUrl, purpose: String): HttpUrl? {
            lastPurpose = purpose
            if (failNext) return null
            urlToHeaders[rawUrl] = headersForNext
            return rawUrl
        }
        override suspend fun signedHeaders(rawUrl: HttpUrl, purpose: String): Map<String, String> {
            return urlToHeaders[rawUrl] ?: emptyMap()
        }
    }

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = XhsApiClient().apply { baseUrl = server.url("/") }
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `signed request uses bridge X-s X-t X-s-common when bridge wired`() = runTest {
        client.signProvider = StubBridge()
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """
                {"success":true,"code":0,"data":{"notes":[
                  {"note_id":"n1","display_title":"T","type":"normal","time":1716500000,
                   "interact_info":{"liked_count":"123","collected_count":"45","comment_count":"6"}}
                ]}}
                """.trimIndent(),
            ),
        )
        val notes = client.fetchNotes("web_session=x; a1=fake", "fake_a1", "user-1")
        assertEquals(1, notes.size)
        val req = server.takeRequest()
        // Bridge headers must reach the server VERBATIM (no fallback overwrite).
        // HTTP headers are case-insensitive (per RFC 7230 §3.2 + OkHttp's Headers
        // class normalizes), so we cannot disambiguate "bridge X-s" vs "fallback
        // X-S" by case alone — verifying the value is the actual test.
        assertEquals("XYW_bridge_sig", req.getHeader("X-s"))
        assertEquals("1716500000000", req.getHeader("X-t"))
        assertEquals("common_value", req.getHeader("X-s-common"))
    }

    @Test
    fun `falls back to computeXsXt when bridge wired but returns null`() = runTest {
        client.signProvider = StubBridge().apply { failNext = true }
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"success":true,"code":0,"data":{"notes":[]}}"""
            ),
        )
        client.fetchNotes("web_session=x; a1=fake", "fake_a1", "user-1")
        val req = server.takeRequest()
        // Bridge failed → fallback ships X-S/X-T from computeXsXt.
        // (HTTP headers are case-insensitive — getHeader resolves regardless
        // of case, so we only assert that signature headers are present.)
        assertNotNull(req.getHeader("X-S"))
        assertNotNull(req.getHeader("X-T"))
    }

    @Test
    fun `falls back to computeXsXt when bridge wired but headers empty`() = runTest {
        // Bridge returns OK URL but empty header map — same fallback path
        // (covers warm-up succeeded but JS probe missed → empty result)
        client.signProvider = object : SignProvider {
            override suspend fun signUrl(rawUrl: HttpUrl, purpose: String): HttpUrl? = rawUrl
            override suspend fun signedHeaders(rawUrl: HttpUrl, purpose: String): Map<String, String> = emptyMap()
        }
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"success":true,"code":0,"data":{"notes":[]}}"""
            ),
        )
        client.fetchNotes("web_session=x; a1=fake", "fake_a1", "user-1")
        val req = server.takeRequest()
        assertNotNull(req.getHeader("X-S"))
        assertNotNull(req.getHeader("X-T"))
    }

    @Test
    fun `default NullSignProvider preserves v02 fallback behavior`() = runTest {
        // No signProvider wired → ApiClient sees NullSignProvider default →
        // signUrl returns null → bridgeHeaders empty → computeXsXt fallback
        assertEquals(NullSignProvider, client.signProvider)
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"success":true,"code":0,"data":{"notes":[]}}"""
            ),
        )
        client.fetchNotes("web_session=x; a1=fake", "fake_a1", "user-1")
        val req = server.takeRequest()
        // v0.2 fallback headers still go out
        assertNotNull(req.getHeader("X-S"))
        assertNotNull(req.getHeader("X-T"))
    }

    @Test
    fun `purpose carries pathWithQuery and empty body for GET`() = runTest {
        val bridge = StubBridge()
        client.signProvider = bridge
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"success":true,"code":0,"data":{"notes":[]}}"""
            ),
        )
        client.fetchNotes("web_session=x; a1=fake", "fake_a1", "user-1")
        assertNotNull(bridge.lastPurpose)
        // Format: "<pathWithQuery>|" — pipe separator + empty body part
        assertTrue(bridge.lastPurpose!!.contains("|"), "purpose must use pipe separator")
        assertTrue(
            bridge.lastPurpose!!.contains("api/sns/web/v2/user_posted"),
            "purpose must include request path",
        )
        assertTrue(
            bridge.lastPurpose!!.contains("user_id=user-1"),
            "purpose must include query params",
        )
    }

    @Test
    fun `bridge invoked for fetchLiked path too`() = runTest {
        val bridge = StubBridge()
        client.signProvider = bridge
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"success":true,"code":0,"data":{"notes":[]}}"""
            ),
        )
        client.fetchLiked("web_session=x; a1=fake", "fake_a1")
        val req = server.takeRequest()
        assertEquals("XYW_bridge_sig", req.getHeader("X-s"))
        assertNotNull(bridge.lastPurpose)
        assertTrue(bridge.lastPurpose!!.contains("note/like/page"))
    }

    @Test
    fun `bridge invoked for fetchFollows path too`() = runTest {
        val bridge = StubBridge()
        client.signProvider = bridge
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"success":true,"code":0,"data":{"users":[]}}"""
            ),
        )
        client.fetchFollows("web_session=x; a1=fake", "fake_a1", "user-1")
        val req = server.takeRequest()
        assertEquals("XYW_bridge_sig", req.getHeader("X-s"))
        assertNotNull(bridge.lastPurpose)
        assertTrue(bridge.lastPurpose!!.contains("follow/list"))
    }

    @Test
    fun `bridge X-s-common omitted when stub doesn't set it`() = runTest {
        // X-s-common is optional — older xhs.js builds didn't return it.
        // Ensure ApiClient passes through whatever the bridge provides
        // and doesn't synthesize an empty value.
        client.signProvider = StubBridge().apply {
            headersForNext = mapOf("X-s" to "sig", "X-t" to "999")
        }
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"success":true,"code":0,"data":{"notes":[]}}"""
            ),
        )
        client.fetchNotes("web_session=x; a1=fake", "fake_a1", "user-1")
        val req = server.takeRequest()
        assertEquals("sig", req.getHeader("X-s"))
        assertEquals("999", req.getHeader("X-t"))
        assertNull(req.getHeader("X-s-common"))
    }
}
