package com.chainlesschain.android.pdh.social.toutiao

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
 * MockWebServer-driven integration cover for [ToutiaoApiClient] HTTP/header
 * paths NOT covered by [ToutiaoApiClientFetchProfileTest] (which focuses on
 * status_code JSON-shape error branches).
 *
 * Adds (parallel to DouyinApiClientIntegrationTest):
 *   - HTTP 4xx/5xx propagation (412 anti-spider, 401, 500)
 *   - Non-JSON body handling (anti-bot login redirect → parse error -4)
 *   - URL shape verification (aid=24 query param + /passport/account/info/v2/)
 *   - Request header gates (UA / Referer / Cookie)
 *
 * See [[pdh_social_collector_test_gap_audit]] for surrounding context.
 */
class ToutiaoApiClientIntegrationTest {

    private lateinit var server: MockWebServer
    private lateinit var client: ToutiaoApiClient

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = ToutiaoApiClient().apply {
            baseUrl = server.url("/")
        }
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun fakeCookie() = "passport_uid=99999; sessionid=fake; tt_webid=fake"

    // ─── HTTP-level error propagation ───────────────────────────────────────

    @Test
    fun `fetchProfile HTTP 412 anti-spider returns null + lastErrorCode 412`() = runTest {
        // Toutiao 风控触发：no UA / IP rate-limit / missing ttwid → 412.
        // Verify HTTP code propagates to lastErrorCode for UI surface.
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
    fun `fetchProfile non-JSON body sets lastErrorCode -4 non-json hint`() = runTest {
        // Toutiao can return 200 + HTML login page when sessionid expired or
        // anti-bot triggered. doGetJson has a `trimmed.startsWith("{")` check
        // that catches the HTML BEFORE JSON parse and sets lastErrorCode = -4.
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "text/html")
                .setBody("<!DOCTYPE html><html><body>Login required</body></html>")
        )

        val result = client.fetchProfile(fakeCookie())

        assertNull(result)
        assertEquals(-4, client.lastErrorCode)
        assertNotNull(client.lastErrorMessage)
        assertTrue(client.lastErrorMessage!!.contains("non-json"))
    }

    // ─── URL + header shape (anti-bot gates) ────────────────────────────────

    @Test
    fun `fetchProfile URL contains aid 24 and passport path`() = runTest {
        server.enqueue(
            MockResponse().setBody("""{"status_code":0,"data":{"user_id":"99","screen_name":"x"}}""")
        )

        client.fetchProfile(fakeCookie())

        val req = server.takeRequest()
        val path = req.path ?: ""
        // aid=24 is the toutiao web client app id; without it the endpoint
        // rejects with status_code=2483. Pin this gate.
        assertTrue(
            path.contains("aid=24"),
            "URL must include aid=24, got: $path"
        )
        assertTrue(
            path.contains("passport/account/info/v2"),
            "URL must hit passport/account/info/v2 endpoint, got: $path"
        )
    }

    @Test
    fun `fetchProfile sends UA Referer Cookie headers`() = runTest {
        server.enqueue(
            MockResponse().setBody("""{"status_code":0,"data":{"user_id":"99","screen_name":"x"}}""")
        )

        client.fetchProfile(fakeCookie())

        val req = server.takeRequest()
        // Toutiao enforces browser-like UA — without it 412 anti-spider.
        assertNotNull(req.getHeader("User-Agent"))
        assertTrue(req.getHeader("User-Agent")!!.contains("Mozilla"))
        // Referer must be www.toutiao.com (anti-bot soft gate).
        assertNotNull(req.getHeader("Referer"))
        assertTrue(req.getHeader("Referer")!!.contains("toutiao.com"))
        // Cookie must be passed through.
        val cookie = req.getHeader("Cookie")
        assertNotNull(cookie)
        assertTrue(cookie.contains("passport_uid=99999"))
    }

    // ─── extractUid pure-cookie shortcut (unchanged from v0.1) ──────────────

    @Test
    fun `extractUid pulls passport_uid from cookie`() {
        val uid = client.extractUid("passport_uid=12345; tt_webid=xx")
        assertEquals("12345", uid)
        assertEquals(0, client.lastErrorCode)
    }

    @Test
    fun `extractUid handles multi_sids first segment`() {
        val uid = client.extractUid("multi_sids=678:abc;901:def; other=val")
        assertEquals("678", uid)
    }

    @Test
    fun `extractUid returns null on anonymous cookie + sets code -7`() {
        // Only device fingerprints, no uid field — typical游客态。
        assertNull(client.extractUid("tt_webid=anon; s_v_web_id=anon"))
        assertEquals(-7, client.lastErrorCode)
    }
}
