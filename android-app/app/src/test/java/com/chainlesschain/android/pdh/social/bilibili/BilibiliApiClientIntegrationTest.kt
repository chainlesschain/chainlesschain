package com.chainlesschain.android.pdh.social.bilibili

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
 * MockWebServer-driven integration cover for [BilibiliApiClient].
 *
 * Today (pre-2026-05-24) the test suite has ~30 BilibiliLocalCollectorTest
 * cases that mock the apiClient out entirely — they verify SnapshotResult
 * orchestration but never exercise actual HTTP + JSON parsing. Real-device
 * failures (412 anti-spider / 401 / silent code:0,data:[]) have been caught
 * only by manual real-device runs, leading to a 5-commit chain of post-hoc
 * fixes after each one surfaced on Xiaomi 24115RA8EC.
 *
 * This class fills the gap between mock unit tests and manual real-device E2E:
 * verifies the API client's behavior under real HTTP scenarios using
 * [MockWebServer], without needing a Bilibili account or network.
 *
 * Scenarios covered:
 *   1. HTTP 412 (anti-spider rate-limit)         → empty list + lastErrorCode = 412
 *   2. HTTP 401 (invalid SESSDATA)                → empty list + lastErrorCode = 401
 *   3. JSON code=0 data.list=[]  (silent empty)   → empty list + lastErrorCode = 0
 *   4. JSON code=-101 (not logged in)             → empty list + lastErrorCode = -101
 *   5. JSON code=0 data.list=[1, 2] (real shape)  → 2 HistoryItem parsed correctly
 *   6. Non-JSON body (HTML login redirect)        → empty list + lastErrorCode = -3
 *
 * Out of scope (delegated to BilibiliLocalCollectorTest mock tests + real-device E2E):
 *   - SnapshotResult.Failed / Ok orchestration (collector responsibility)
 *   - WBI signing (not yet implemented in client)
 *   - Concurrent fetcher rate-limit interactions (real anti-bot behavior)
 *
 * See [[pdh_social_collector_test_gap_audit]] memory entry for the
 * surrounding context on why this layer was missing.
 */
class BilibiliApiClientIntegrationTest {

    private lateinit var server: MockWebServer
    private lateinit var client: BilibiliApiClient

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = BilibiliApiClient().apply {
            baseUrl = server.url("/")
            // Pre-seed buvid3 so prepareCookie() doesn't make an extra
            // /x/frontend/finger/spi roundtrip that would consume the
            // first enqueued MockResponse intended for fetchHistory.
            setMintedBuvid3ForTest("test-buvid3")
        }
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun fakeCookie() =
        "SESSDATA=test; DedeUserID=12345; bili_jct=jct; buvid3=ignored-by-substitute"

    // ─── Scenario 1: HTTP 412 (Bilibili anti-spider rate-limit) ─────────────

    @Test
    fun `fetchHistory 412 returns empty and records lastErrorCode 412`() = runTest {
        server.enqueue(MockResponse().setResponseCode(412).setBody("<html>blocked</html>"))

        val result = client.fetchHistory(fakeCookie())

        assertEquals(emptyList(), result)
        assertEquals(412, client.lastErrorCode)
        assertNotNull(client.lastErrorMessage)
        assertTrue(client.lastErrorMessage!!.contains("412"))
    }

    // ─── Scenario 2: HTTP 401 (invalid SESSDATA) ────────────────────────────

    @Test
    fun `fetchHistory 401 returns empty and records lastErrorCode 401`() = runTest {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"code":-101,"message":"not logged in"}"""))

        val result = client.fetchHistory(fakeCookie())

        assertEquals(emptyList(), result)
        assertEquals(401, client.lastErrorCode)
    }

    // ─── Scenario 3: silent empty (code=0 + data.list=[]) ───────────────────
    //
    // This is the trap that 2026-05-23 real-device hit: cookie is missing
    // buvid3 → Bilibili returns 200 + valid JSON shape + empty list. Without
    // lastErrorCode propagation, the user sees "synced 0 items" with no
    // actionable signal. Verify both: (a) empty list returned (b) lastErrorCode
    // stays 0 so the collector can distinguish from a real auth/rate failure.

    @Test
    fun `fetchHistory code 0 empty list returns empty and lastErrorCode 0`() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"code":0,"message":"0","data":{"cursor":{"max":0},"list":[]}}""")
        )

        val result = client.fetchHistory(fakeCookie())

        assertEquals(emptyList(), result)
        assertEquals(0, client.lastErrorCode)
        assertNull(client.lastErrorMessage)
    }

    // ─── Scenario 4: JSON-level error code (code=-101 not logged in) ────────

    @Test
    fun `fetchHistory code -101 returns empty and propagates code + message`() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"code":-101,"message":"账号未登录","data":null}""")
        )

        val result = client.fetchHistory(fakeCookie())

        assertEquals(emptyList(), result)
        assertEquals(-101, client.lastErrorCode)
        assertNotNull(client.lastErrorMessage)
        assertTrue(client.lastErrorMessage!!.contains("账号未登录"))
    }

    // ─── Scenario 5: real-shape valid response (2 items parsed) ─────────────

    @Test
    fun `fetchHistory parses 2 items with correct field mapping`() = runTest {
        // Mirrors actual Bilibili /x/web-interface/history/cursor shape circa
        // 2026-05. If Bilibili reshapes this in the future, parse will start
        // failing here BEFORE shipping a broken APK to users.
        val realShape = """
            {
              "code": 0,
              "message": "0",
              "data": {
                "cursor": {"max": 999, "view_at": 1715000000, "business": "archive"},
                "list": [
                  {
                    "title": "Rust 异步编程",
                    "view_at": 1715000123,
                    "duration": 600,
                    "history": {"bvid": "BV1abc123", "oid": 42, "business": "archive"},
                    "owner": {"name": "RustUploader", "mid": 100}
                  },
                  {
                    "title": "Kotlin 协程",
                    "view_at": 1714999000,
                    "duration": 1200,
                    "history": {"bvid": "BV2def456", "oid": 43, "business": "archive"},
                    "owner": {"name": "KotlinUploader", "mid": 101}
                  }
                ]
              }
            }
        """.trimIndent()
        server.enqueue(MockResponse().setResponseCode(200).setBody(realShape))

        val result = client.fetchHistory(fakeCookie())

        assertEquals(2, result.size)
        // First item — verify each field reaches the right place in HistoryItem.
        result[0].let {
            assertEquals("BV1abc123", it.bvid)
            assertEquals(42L, it.avid)
            assertEquals("Rust 异步编程", it.title)
            assertEquals(1715000123L, it.viewAt)
            assertEquals(600L, it.duration)
        }
        result[1].let {
            assertEquals("BV2def456", it.bvid)
            assertEquals(43L, it.avid)
            assertEquals("Kotlin 协程", it.title)
            assertEquals(1714999000L, it.viewAt)
            assertEquals(1200L, it.duration)
        }
        // No error recorded on success path.
        assertEquals(0, client.lastErrorCode)
        assertNull(client.lastErrorMessage)
    }

    // ─── Scenario 6: non-JSON body (HTML redirect to login) ─────────────────
    //
    // Some anti-bot paths return 200 + HTML login page instead of a JSON
    // error response. The JSONObject(body) parse throws — verify the catch
    // surfaces lastErrorCode = -3 (parse error) so the caller can tell this
    // apart from a network IO failure or a clean empty result.

    @Test
    fun `fetchHistory HTML body sets lastErrorCode -3 parse error`() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "text/html")
                .setBody("<html><head><title>Login - Bilibili</title></head><body></body></html>")
        )

        val result = client.fetchHistory(fakeCookie())

        assertEquals(emptyList(), result)
        assertEquals(-3, client.lastErrorCode)
        assertNotNull(client.lastErrorMessage)
        assertTrue(client.lastErrorMessage!!.startsWith("parse:"))
    }

    // ─── Cross-cutting: request headers shape (the anti-spider gates) ───────

    @Test
    fun `fetchHistory sends UA Referer Origin and Cookie headers`() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"code":0,"message":"0","data":{"list":[]}}""")
        )

        client.fetchHistory(fakeCookie())

        val recorded = server.takeRequest()
        // UA is mandatory — Bilibili returns 412 without browser-like UA.
        // Don't pin the exact UA string (it's tunable); just verify shape.
        assertTrue(
            recorded.getHeader("User-Agent")?.contains("Mozilla") == true,
            "User-Agent must be browser-like, got: ${recorded.getHeader("User-Agent")}"
        )
        // Bilibili enforces Referer + Origin for the 4 endpoints we hit.
        assertEquals("https://www.bilibili.com/", recorded.getHeader("Referer"))
        assertEquals("https://www.bilibili.com", recorded.getHeader("Origin"))
        // Cookie must be passed through (with buvid3 substituted by prepareCookie).
        val cookie = recorded.getHeader("Cookie")
        assertNotNull(cookie)
        assertTrue(cookie.contains("SESSDATA=test"))
        assertTrue(cookie.contains("DedeUserID=12345"))
        assertTrue(cookie.contains("buvid3=test-buvid3"))
    }
}
