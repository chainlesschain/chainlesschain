package com.chainlesschain.android.pdh.social.xiaohongshu

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * MockWebServer-driven integration cover for the 3 [XhsApiClient] fetchers
 * not covered by [XhsApiClientFetchMeTest] (which only tests fetchMe):
 *   - fetchNotes  (用户自己发布的笔记，需 X-S 签名)
 *   - fetchLiked  (点赞过的笔记，需 X-S 签名)
 *   - fetchFollows (关注列表，需 X-S 签名)
 *
 * Plus xhs-specific error modes:
 *   - non-JSON body → lastErrorCode = -4 (login redirect anti-bot detector)
 *   - success=false OR code!=0 → lastErrorCode = code or -461
 *   - HTTP 461 (xhs 风控特征码) → empty + lastErrorCode = 461
 *
 * X-S signing is exercised but not verified by value — MockWebServer doesn't
 * authenticate the X-S header, just records it. We assert the header is
 * present so a future refactor that drops the requireSign path fails here
 * first instead of on a real device with `460 invalid signature`.
 *
 * See [[pdh_social_collector_test_gap_audit]] for surrounding context.
 */
class XhsApiClientIntegrationTest {

    private lateinit var server: MockWebServer
    private lateinit var client: XhsApiClient

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = XhsApiClient().apply {
            baseUrl = server.url("/")
        }
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun fakeCookie() = "web_session=fake; a1=fake; webId=fake"
    private fun fakeA1() = "1234567890abcdef"
    private fun fakeUserId() = "5e8c1234abc"

    // ─── fetchNotes ─────────────────────────────────────────────────────────

    @Test
    fun `fetchNotes parses 2 notes with interact_info counts`() = runTest {
        // Real xhs /user_posted shape circa 2026-05. liked_count / collected_count
        // / comment_count are STRINGS like "1.2万" (parseCount converts).
        val payload = """
            {
              "success": true, "code": 0,
              "data": {
                "notes": [
                  {
                    "note_id": "N1",
                    "display_title": "周末家常菜",
                    "desc": "简单红烧肉",
                    "type": "normal",
                    "time": 1714000000000,
                    "interact_info": {
                      "liked_count": "1.2万",
                      "collected_count": "320",
                      "comment_count": "45"
                    }
                  },
                  {
                    "note_id": "N2",
                    "title": "无 display_title 走 title 兜底",
                    "type": "video",
                    "time": 1713000000,
                    "interact_info": {
                      "liked_count": "0",
                      "collected_count": "0",
                      "comment_count": "0"
                    }
                  }
                ]
              }
            }
        """.trimIndent()
        server.enqueue(MockResponse().setBody(payload))

        val notes = client.fetchNotes(fakeCookie(), fakeA1(), fakeUserId())

        assertEquals(2, notes.size)
        notes[0].let {
            assertEquals("N1", it.noteId)
            assertEquals("周末家常菜", it.title)
            assertEquals("简单红烧肉", it.desc)
            assertEquals("normal", it.type)
            // time was 1714000000000 (ms scale, > 1e12 branch — kept as is)
            assertEquals(1714000000000L, it.createdAt)
            // liked_count "1.2万" → 12000 via parseCount (helper test covers exact)
            assertTrue(it.likedCount > 0, "1.2万 must parse to positive count")
        }
        notes[1].let {
            assertEquals("N2", it.noteId)
            assertEquals("无 display_title 走 title 兜底", it.title)
            // time was 1713000000 (seconds, < 1e12) → multiplied by 1000
            assertEquals(1713000000_000L, it.createdAt)
        }
        assertEquals(0, client.lastErrorCode)
    }

    @Test
    fun `fetchNotes empty when data notes missing returns empty`() = runTest {
        server.enqueue(MockResponse().setBody("""{"success":true,"code":0,"data":{}}"""))
        val notes = client.fetchNotes(fakeCookie(), fakeA1(), fakeUserId())
        assertEquals(emptyList(), notes)
    }

    @Test
    fun `fetchNotes sends X-S X-T headers (signed-request gate)`() = runTest {
        server.enqueue(MockResponse().setBody("""{"success":true,"code":0,"data":{"notes":[]}}"""))

        client.fetchNotes(fakeCookie(), fakeA1(), fakeUserId())

        val req = server.takeRequest()
        // requireSign=true path must produce X-S + X-T. Don't pin the values
        // (they're HMAC-derived from a1); a future refactor that accidentally
        // strips the signed-request branch (regression) fails here BEFORE
        // shipping to users (xhs returns `460 invalid signature` server-side).
        assertNotNull(req.getHeader("X-S"), "fetchNotes must include X-S header (requireSign=true)")
        assertNotNull(req.getHeader("X-T"), "fetchNotes must include X-T header")
        // Standard request headers must always be present
        assertTrue(req.getHeader("User-Agent")!!.contains("Mozilla"))
        assertEquals("https://www.xiaohongshu.com/", req.getHeader("Referer"))
        assertEquals("https://www.xiaohongshu.com", req.getHeader("Origin"))
        assertTrue(req.getHeader("Cookie")!!.contains("web_session=fake"))
    }

    // ─── fetchLiked ─────────────────────────────────────────────────────────

    @Test
    fun `fetchLiked parses notes with author nickname`() = runTest {
        val payload = """
            {
              "success": true, "code": 0,
              "data": {
                "notes": [
                  {
                    "note_id": "L1",
                    "display_title": "点赞过的笔记 1",
                    "user": {"nickname": "原作者A"}
                  },
                  {
                    "note_id": "L2",
                    "title": "另一条 (无 display_title)"
                  }
                ]
              }
            }
        """.trimIndent()
        server.enqueue(MockResponse().setBody(payload))

        val liked = client.fetchLiked(fakeCookie(), fakeA1())

        assertEquals(2, liked.size)
        assertEquals("L1", liked[0].noteId)
        assertEquals("点赞过的笔记 1", liked[0].title)
        assertEquals("原作者A", liked[0].authorNickname)
        assertEquals("另一条 (无 display_title)", liked[1].title)
        // xhs 不返显式 liked_at — likedAt 统一为 0
        assertEquals(0L, liked[0].likedAt)
    }

    // ─── fetchFollows ───────────────────────────────────────────────────────

    @Test
    fun `fetchFollows parses user list and skips entries missing user_id`() = runTest {
        val payload = """
            {
              "success": true, "code": 0,
              "data": {
                "users": [
                  {"user_id": "U1", "nickname": "好友A", "image": "https://avatar/1"},
                  {"nickname": "无 user_id 必须 skip"},
                  {"user_id": "U2", "nickname": "好友B"}
                ]
              }
            }
        """.trimIndent()
        server.enqueue(MockResponse().setBody(payload))

        val follows = client.fetchFollows(fakeCookie(), fakeA1(), fakeUserId())

        assertEquals(2, follows.size, "entry without user_id must be filtered out")
        follows[0].let {
            assertEquals("U1", it.userId)
            assertEquals("好友A", it.nickname)
            assertEquals("https://avatar/1", it.image)
        }
        assertEquals("U2", follows[1].userId)
    }

    @Test
    fun `fetchFollows URL contains user_id query param`() = runTest {
        server.enqueue(MockResponse().setBody("""{"success":true,"code":0,"data":{"users":[]}}"""))

        client.fetchFollows(fakeCookie(), fakeA1(), userId = "TARGET-UID-123")

        val req = server.takeRequest()
        // 2026-05-27 RESTful path 改：user_id 入 URL path 段而不是 query。
        // endpoint 名 `followings`，pagination 改 page-based。
        assertTrue(req.path!!.contains("/user/TARGET-UID-123/followings"),
            "follows URL must put user_id in path + use 'followings' — got: ${req.path}")
        assertTrue(req.path!!.contains("page=1"))
    }

    // ─── Cross-cutting error modes (xhs-specific) ───────────────────────────

    @Test
    fun `fetchNotes non-JSON body sets lastErrorCode -4 cookie-expired hint`() = runTest {
        // xhs anti-bot signature: when cookie is invalid/expired, server returns
        // 200 + HTML login redirect instead of JSON. doGetJson's trimmed check
        // catches this BEFORE JSON parse and sets -4 with a "non-json (cookie
        // expired?)" hint — distinct from -3 generic parse error.
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "text/html")
                .setBody("<!DOCTYPE html><html><body>Please login</body></html>")
        )

        val notes = client.fetchNotes(fakeCookie(), fakeA1(), fakeUserId())

        assertEquals(emptyList(), notes)
        assertEquals(-4, client.lastErrorCode)
        assertNotNull(client.lastErrorMessage)
        assertTrue(client.lastErrorMessage!!.contains("non-json"))
    }

    @Test
    fun `fetchNotes success false sets lastErrorCode -461 sentinel`() = runTest {
        // xhs occasionally returns success=false without a code field. doGetJson
        // synthesizes lastErrorCode = -461 (xhs 风控特征码 sentinel) so the
        // collector can distinguish from a code:N response.
        server.enqueue(MockResponse().setBody("""{"success":false,"msg":"风控"}"""))

        val notes = client.fetchNotes(fakeCookie(), fakeA1(), fakeUserId())

        assertEquals(emptyList(), notes)
        assertEquals(-461, client.lastErrorCode)
        assertNotNull(client.lastErrorMessage)
        assertTrue(client.lastErrorMessage!!.contains("风控"))
    }

    @Test
    fun `fetchNotes code 460 invalid signature propagates`() = runTest {
        // xhs returns 200 + code=460 when X-S signature is wrong. doGetJson
        // sets lastErrorCode = 460 (real code, not -461 sentinel).
        server.enqueue(MockResponse().setBody("""{"success":false,"code":460,"msg":"invalid signature"}"""))

        val notes = client.fetchNotes(fakeCookie(), fakeA1(), fakeUserId())

        assertEquals(emptyList(), notes)
        assertEquals(460, client.lastErrorCode)
    }

    @Test
    fun `fetchFollows HTTP 461 风控特征码 returns empty + propagates`() = runTest {
        server.enqueue(MockResponse().setResponseCode(461).setBody("blocked"))

        val follows = client.fetchFollows(fakeCookie(), fakeA1(), fakeUserId())

        assertEquals(emptyList(), follows)
        assertEquals(461, client.lastErrorCode)
    }
}
