package com.chainlesschain.android.pdh.social.weibo

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
 * MockWebServer-driven integration cover for [WeiboApiClient].
 *
 * Mirror of BilibiliApiClientIntegrationTest, adapted for Weibo specifics:
 *   - No buvid3 mint roundtrip (Weibo doesn't have device-fingerprint pre-call)
 *   - X-Requested-With + MWeibo-Pwa headers are mandatory anti-detection
 *     (without them m.weibo.cn serves HTML instead of JSON)
 *   - fetchUid uses /api/config + checks data.login boolean (not just code=0)
 *   - Common JSON error codes: -100 silent ban, -50101 cookie expired, -4 anti-bot
 *
 * Scenarios:
 *   1. HTTP 403 (rate-limit)                      → empty + lastErrorCode = 403
 *   2. JSON ok=-100 (silent ban)                  → empty + lastErrorCode = -100
 *   3. JSON ok=-50101 (cookie expired)            → empty + lastErrorCode = -50101
 *   4. fetchUid login=false                        → null UID (no exception)
 *   5. fetchPosts real shape (2 card_type=9)      → 2 PostItem parsed
 *   6. fetchPosts mixed cards (filter card_type)  → only card_type=9 kept
 *   7. Header shape (XHR + Pwa + Cookie)          → anti-detection headers present
 *
 * See [[pdh_social_collector_test_gap_audit]] memory entry for context.
 */
class WeiboApiClientIntegrationTest {

    private lateinit var server: MockWebServer
    private lateinit var client: WeiboApiClient

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = WeiboApiClient().apply {
            baseUrl = server.url("/")
        }
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun fakeCookie() = "SUB=fake; SUBP=fake; _T_WM=fake"

    // ─── Scenario 1: HTTP 403 (rate-limit) ──────────────────────────────────

    @Test
    fun `fetchPosts 403 returns empty and records lastErrorCode 403`() = runTest {
        server.enqueue(MockResponse().setResponseCode(403).setBody("forbidden"))

        val result = client.fetchPosts(fakeCookie(), uid = 9876L)

        assertEquals(emptyList(), result)
        assertEquals(403, client.lastErrorCode)
    }

    // ─── Scenario 2: silent ban (ok=-100) ───────────────────────────────────
    //
    // -100 = silent ban — same IP requested too quickly. Real-device reproduces
    // when running 3 fetchers in too-fast succession.

    @Test
    fun `fetchPosts ok -100 silent ban returns empty and propagates code + msg`() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"ok":-100,"msg":"too many requests"}""")
        )

        val result = client.fetchPosts(fakeCookie(), uid = 9876L)

        assertEquals(emptyList(), result)
        assertEquals(-100, client.lastErrorCode)
        assertNotNull(client.lastErrorMessage)
        assertTrue(client.lastErrorMessage!!.contains("too many requests"))
    }

    // ─── Scenario 3: cookie expired (ok=-50101) ─────────────────────────────

    @Test
    fun `fetchPosts ok -50101 cookie expired returns empty and propagates code`() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"ok":-50101,"msg":"login expired"}""")
        )

        val result = client.fetchPosts(fakeCookie(), uid = 9876L)

        assertEquals(emptyList(), result)
        assertEquals(-50101, client.lastErrorCode)
    }

    // ─── Scenario 3b: HTML body (cookie expired anti-bot redirect) ──────────
    //
    // WeiboApiClient has a dedicated "trimmed.startsWith('{')" check (line 236)
    // that catches anti-bot HTML responses BEFORE JSON parse — sets
    // lastErrorCode = -4 with a clear "non-json (cookie expired?)" hint.
    // This is a key differentiator from Bilibili (which surfaces parse
    // failure as -3 generic).

    @Test
    fun `fetchPosts HTML body sets lastErrorCode -4 non-json hint`() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "text/html")
                .setBody("<!DOCTYPE html><html><body>Login required</body></html>")
        )

        val result = client.fetchPosts(fakeCookie(), uid = 9876L)

        assertEquals(emptyList(), result)
        assertEquals(-4, client.lastErrorCode)
        assertNotNull(client.lastErrorMessage)
        assertTrue(client.lastErrorMessage!!.contains("non-json"))
    }

    // ─── Scenario 4: fetchUid login=false ───────────────────────────────────
    //
    // /api/config returns 200 + valid JSON even when not logged in — the
    // signal is data.login=false. Verify fetchUid returns null instead of
    // raising or returning a default.

    @Test
    fun `fetchUid returns null when login is false`() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"data":{"login":false,"uid":""}}""")
        )

        val uid = client.fetchUid(fakeCookie())

        assertNull(uid)
    }

    @Test
    fun `fetchUid returns parsed uid when login is true`() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"data":{"login":true,"uid":"9876543210"}}""")
        )

        val uid = client.fetchUid(fakeCookie())

        assertEquals(9876543210L, uid)
    }

    // ─── Scenario 5/6: real-shape posts + card_type filter ──────────────────

    @Test
    fun `fetchPosts parses card_type=9 cards and filters others`() = runTest {
        // Real m.weibo.cn /api/container/getIndex shape: mixed card types,
        // only card_type=9 (mblog) is a post. The other types are
        // banner/topic/placeholder and must be skipped.
        val payload = """
            {
              "ok": 1,
              "data": {
                "cards": [
                  {"card_type": 1, "title": "Banner — must be skipped"},
                  {
                    "card_type": 9,
                    "mblog": {
                      "id": "M1",
                      "mid": "M1",
                      "text": "First post <a>link</a>",
                      "created_at": "Sat Jan 01 12:00:00 +0800 2026",
                      "source": "iPhone 客户端",
                      "reposts_count": 5,
                      "comments_count": 3,
                      "attitudes_count": 100,
                      "pic_num": 2
                    }
                  },
                  {"card_type": 11, "title": "Topic — must be skipped"},
                  {
                    "card_type": 9,
                    "mblog": {
                      "id": "M2",
                      "mid": "M2",
                      "text": "Second post",
                      "created_at": "Sat Jan 02 13:00:00 +0800 2026",
                      "reposts_count": 0,
                      "comments_count": 0,
                      "attitudes_count": 0,
                      "pic_num": 0
                    }
                  }
                ]
              }
            }
        """.trimIndent()
        server.enqueue(MockResponse().setResponseCode(200).setBody(payload))

        val result = client.fetchPosts(fakeCookie(), uid = 9876L)

        assertEquals(2, result.size, "must filter out card_type 1 and 11")
        result[0].let {
            assertEquals("M1", it.mid)
            // stripHtml removes the anchor tag wrapper but keeps the inner text
            assertEquals("First post link", it.text)
            assertEquals("iPhone 客户端", it.source)
            assertEquals(5, it.repostsCount)
            assertEquals(3, it.commentsCount)
            assertEquals(100, it.likesCount)
            assertEquals(2, it.picCount)
            // createdAt must parse — non-zero proves parseWeiboTime didn't fail
            assertTrue(it.createdAt > 0, "createdAt must parse from canonical format")
        }
        assertEquals("M2", result[1].mid)
    }

    // ─── Scenario 7: header shape (anti-detection gates) ────────────────────

    @Test
    fun `fetchPosts sends X-Requested-With MWeibo-Pwa and Cookie headers`() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"ok":1,"data":{"cards":[]}}""")
        )

        client.fetchPosts(fakeCookie(), uid = 9876L)

        val recorded = server.takeRequest()
        // m.weibo.cn anti-detection: without these two headers the server
        // returns HTML instead of JSON, which JSONObject() then fails to parse.
        assertEquals("XMLHttpRequest", recorded.getHeader("X-Requested-With"))
        assertEquals("1", recorded.getHeader("MWeibo-Pwa"))
        assertEquals("https://m.weibo.cn/", recorded.getHeader("Referer"))
        assertNotNull(recorded.getHeader("User-Agent"))
        assertTrue(
            recorded.getHeader("User-Agent")!!.contains("Mozilla"),
            "User-Agent must be browser-like"
        )
        val cookie = recorded.getHeader("Cookie")
        assertNotNull(cookie)
        assertTrue(cookie.contains("SUB=fake"))
    }

    @Test
    fun `fetchPosts URL contains correct containerid for uid`() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"ok":1,"data":{"cards":[]}}""")
        )

        client.fetchPosts(fakeCookie(), uid = 9876L)

        val recorded = server.takeRequest()
        val path = recorded.path ?: ""
        // Weibo timeline endpoint uses containerid=107603<uid> for "user's own
        // posts" — this magic prefix has been the right value since 2015. If
        // Weibo changes it, every Weibo user's timeline will return empty.
        assertTrue(path.contains("containerid=1076039876"),
            "URL should contain containerid=107603<uid>, got: $path")
        assertTrue(path.contains("type=uid"))
        assertTrue(path.contains("value=9876"))
    }
}
