package com.chainlesschain.android.pdh.social.douyin

import kotlinx.coroutines.test.runTest
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
 * MockWebServer-driven integration cover for [DouyinApiClient] HTTP/header
 * paths NOT covered by [DouyinApiClientFetchProfileTest] (which focuses on
 * status_code JSON-shape error branches: -5/-6/-7 + status_code!=0).
 *
 * Adds:
 *   - HTTP 4xx/5xx propagation (412 anti-spider, 401, 500)
 *   - Non-JSON body handling (anti-bot login redirect → parse error)
 *   - URL shape verification (aid=2906 query param)
 *   - Request header gates (UA / Referer / Cookie)
 *
 * See [[pdh_social_collector_test_gap_audit]] for surrounding context.
 */
class DouyinApiClientIntegrationTest {

    private lateinit var server: MockWebServer
    private lateinit var client: DouyinApiClient

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = DouyinApiClient().apply {
            baseUrl = server.url("/")
        }
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun fakeCookie() = "sessionid=fake; passport_csrf_token=fake; tt_webid=fake"

    // ─── HTTP-level error propagation ───────────────────────────────────────

    @Test
    fun `fetchProfile HTTP 412 anti-spider returns null + lastErrorCode 412`() = runTest {
        // Douyin 风控触发：no UA / IP rate-limit / missing webid → 412.
        // Real-device 2026-05-23 hit this when WebView capture missed
        // ttwid (commit 99ee56e2a). Verify HTTP code propagates.
        server.enqueue(MockResponse().setResponseCode(412).setBody("blocked"))

        val result = client.fetchProfile(fakeCookie())

        assertNull(result)
        assertEquals(412, client.lastErrorCode)
        assertNotNull(client.lastErrorMessage)
        assertTrue(client.lastErrorMessage!!.contains("412"))
    }

    @Test
    fun `fetchProfile HTTP 401 returns null + lastErrorCode 401`() = runTest {
        server.enqueue(MockResponse().setResponseCode(401).setBody("unauthorized"))

        val result = client.fetchProfile(fakeCookie())

        assertNull(result)
        assertEquals(401, client.lastErrorCode)
    }

    @Test
    fun `fetchProfile HTTP 500 server-side returns null + lastErrorCode 500`() = runTest {
        server.enqueue(MockResponse().setResponseCode(500).setBody("internal error"))

        val result = client.fetchProfile(fakeCookie())

        assertNull(result)
        assertEquals(500, client.lastErrorCode)
    }

    // ─── Non-JSON body (anti-bot login redirect) ────────────────────────────

    @Test
    fun `fetchProfile non-JSON body sets lastErrorCode parse error`() = runTest {
        // Douyin can return 200 + HTML login page when sessionid expired.
        // The JSON parser throws → caught as -3 (parse error) — distinct
        // from clean status_code branches handled by existing test.
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "text/html")
                .setBody("<!DOCTYPE html><html><body>Login required</body></html>")
        )

        val result = client.fetchProfile(fakeCookie())

        assertNull(result)
        // Douyin's doGetJson catches JSON parse exception as -3.
        assertEquals(-3, client.lastErrorCode)
        assertNotNull(client.lastErrorMessage)
        assertTrue(client.lastErrorMessage!!.startsWith("parse:"))
    }

    // ─── URL + header shape (anti-bot gates) ────────────────────────────────

    @Test
    fun `fetchProfile URL contains aid 2906 and passport path`() = runTest {
        server.enqueue(
            MockResponse().setBody("""{"status_code":0,"data":{"sec_user_id":"X","screen_name":"Y"}}""")
        )

        client.fetchProfile(fakeCookie())

        val req = server.takeRequest()
        val path = req.path ?: ""
        // aid=2906 is the douyin web client app id; without it the endpoint
        // rejects with status_code=2483. Pin this gate.
        assertTrue(path.contains("aid=2906"),
            "URL must include aid=2906, got: $path")
        assertTrue(path.contains("aweme/v1/passport/account/info/v2"),
            "URL must hit passport/info/v2 endpoint, got: $path")
    }

    @Test
    fun `fetchProfile sends UA Referer Cookie headers`() = runTest {
        server.enqueue(
            MockResponse().setBody("""{"status_code":0,"data":{"sec_user_id":"X","screen_name":"Y"}}""")
        )

        client.fetchProfile(fakeCookie())

        val req = server.takeRequest()
        // Douyin enforces browser-like UA — without it 412 anti-spider.
        assertNotNull(req.getHeader("User-Agent"))
        assertTrue(req.getHeader("User-Agent")!!.contains("Mozilla"))
        // Cookie must be passed through (sessionid is what passport endpoint validates).
        val cookie = req.getHeader("Cookie")
        assertNotNull(cookie)
        assertTrue(cookie.contains("sessionid=fake"))
    }
}
