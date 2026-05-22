package com.chainlesschain.android.pdh.social.bilibili

import kotlinx.coroutines.test.runTest
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
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
 * A8 v0.1 — JVM unit cover for [BilibiliApiClient].
 *
 * Each endpoint is mocked via MockWebServer with a representative JSON payload
 * (kept compact — only fields the parser reads). Verifies:
 *   - response shape parsing
 *   - cookie + Referer header attachment
 *   - code != 0 → null (no throw)
 *   - 4xx → null
 *   - missing JSON fields → safe defaults
 */
class BilibiliApiClientTest {

    private lateinit var server: MockWebServer
    private lateinit var client: BilibiliApiClient

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = BilibiliApiClient().apply {
            baseUrl = server.url("/").toString().toHttpUrl()
            httpClient = OkHttpClient.Builder().build()
        }
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    // ─── extractUid ─────────────────────────────────────────────────────────

    @Test
    fun `extractUid pulls DedeUserID from cookie string`() {
        val cookie = "SESSDATA=abc; DedeUserID=12345; bili_jct=xyz"
        assertEquals(12345L, client.extractUid(cookie))
    }

    @Test
    fun `extractUid returns null when DedeUserID absent`() {
        assertNull(client.extractUid("SESSDATA=abc; bili_jct=xyz"))
    }

    @Test
    fun `extractUid returns null when DedeUserID non-numeric`() {
        assertNull(client.extractUid("SESSDATA=abc; DedeUserID=garbage"))
    }

    @Test
    fun `extractUid returns null when DedeUserID is 0 (mid-logout state)`() {
        // Bilibili never issues uid=0; a "0" value means the cookie's been
        // cleared but the field is still present — treat as unauthenticated.
        assertNull(client.extractUid("SESSDATA=abc; DedeUserID=0"))
    }

    // ─── fetchHistory ───────────────────────────────────────────────────────

    @Test
    fun `fetchHistory parses cursor list`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """
                {
                  "code": 0,
                  "message": "0",
                  "data": {
                    "list": [
                      {
                        "title": "Rust 异步学习",
                        "view_at": 1715000000,
                        "duration": 600,
                        "history": { "bvid": "BV1abc", "oid": 42 },
                        "owner": { "name": "UpA", "mid": 100 },
                        "part": "01 介绍"
                      },
                      {
                        "title": "另一个视频",
                        "view_at": 1714000000,
                        "history": { "bvid": "BV2def", "oid": 99 },
                        "owner": { "name": "UpB", "mid": 200 }
                      }
                    ]
                  }
                }
                """.trimIndent()
            )
        )
        val items = client.fetchHistory("SESSDATA=fake")
        assertEquals(2, items.size)
        assertEquals("BV1abc", items[0].bvid)
        assertEquals(42L, items[0].avid)
        assertEquals("Rust 异步学习", items[0].title)
        assertEquals(600L, items[0].duration)
        assertEquals("UpA", items[0].uploader)
        assertEquals(100L, items[0].uploaderMid)
        assertEquals("01 介绍", items[0].part)

        val request = server.takeRequest()
        assertEquals("/x/v2/history/cursor?ps=30", request.path)
        assertTrue(request.getHeader("Cookie")!!.contains("SESSDATA=fake"))
        assertEquals("https://www.bilibili.com/", request.getHeader("Referer"))
    }

    @Test
    fun `fetchHistory returns empty when code non-zero`() = runTest {
        server.enqueue(
            MockResponse().setBody("""{"code":-101,"message":"账号未登录","data":null}""")
        )
        val items = client.fetchHistory("SESSDATA=expired")
        assertTrue(items.isEmpty())
    }

    @Test
    fun `fetchHistory returns empty on HTTP 412 anti-bot`() = runTest {
        server.enqueue(MockResponse().setResponseCode(412).setBody("blocked"))
        val items = client.fetchHistory("SESSDATA=fake")
        assertTrue(items.isEmpty())
    }

    // ─── fetchFavourites ────────────────────────────────────────────────────

    @Test
    fun `fetchFavourites walks folder list then per-folder items`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """
                {
                  "code": 0,
                  "data": {
                    "list": [
                      { "id": 111, "title": "学习" },
                      { "id": 222, "title": "音乐" }
                    ]
                  }
                }
                """.trimIndent()
            )
        )
        server.enqueue(
            MockResponse().setBody(
                """
                {
                  "code": 0,
                  "data": {
                    "medias": [
                      { "bvid": "BV1study1", "title": "前端架构",
                        "fav_time": 1714000000,
                        "upper": { "name": "码农UP" } }
                    ]
                  }
                }
                """.trimIndent()
            )
        )
        server.enqueue(
            MockResponse().setBody(
                """
                {
                  "code": 0,
                  "data": {
                    "medias": [
                      { "bvid": "BV1music1", "title": "MV", "fav_time": 1713000000 }
                    ]
                  }
                }
                """.trimIndent()
            )
        )
        val items = client.fetchFavourites(cookie = "SESSDATA=fake", uid = 12345)
        assertEquals(2, items.size)
        // First folder
        assertEquals("BV1study1", items[0].bvid)
        assertEquals("学习", items[0].folderName)
        assertEquals("码农UP", items[0].uploader)
        assertEquals(1714000000L * 1000, items[0].savedAt)
        // Second folder
        assertEquals("BV1music1", items[1].bvid)
        assertEquals("音乐", items[1].folderName)
        assertEquals(1713000000L * 1000, items[1].savedAt)
    }

    @Test
    fun `fetchFavourites empty folder list yields empty result`() = runTest {
        server.enqueue(MockResponse().setBody("""{"code":0,"data":{"list":[]}}"""))
        val items = client.fetchFavourites("SESSDATA=fake", 12345)
        assertTrue(items.isEmpty())
    }

    // ─── fetchDynamics ──────────────────────────────────────────────────────

    @Test
    fun `fetchDynamics parses feed items with author and desc`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """
                {
                  "code": 0,
                  "data": {
                    "items": [
                      {
                        "id_str": "999",
                        "type": "DYNAMIC_TYPE_AV",
                        "modules": {
                          "module_author": {
                            "name": "我关注的UP",
                            "mid": 200,
                            "pub_ts": 1713000000
                          },
                          "module_dynamic": {
                            "major": {
                              "archive": { "title": "今天发了一个新视频" }
                            }
                          }
                        }
                      }
                    ]
                  }
                }
                """.trimIndent()
            )
        )
        val items = client.fetchDynamics("SESSDATA=fake")
        assertEquals(1, items.size)
        assertEquals("999", items[0].rid)
        assertEquals("av", items[0].dynamicType)
        assertEquals("今天发了一个新视频", items[0].summary)
        assertEquals("我关注的UP", items[0].authorName)
        assertEquals(200L, items[0].authorMid)
        assertEquals(1713000000L * 1000, items[0].publishedAt)
    }

    // ─── fetchFollows ───────────────────────────────────────────────────────

    @Test
    fun `fetchFollows parses follower list`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """
                {
                  "code": 0,
                  "data": {
                    "list": [
                      {
                        "mid": 300,
                        "uname": "美食UP",
                        "face": "https://i0.hdslb.com/face300.jpg",
                        "sign": "好吃的视频",
                        "mtime": 1712000000
                      },
                      {
                        "mid": 400,
                        "uname": "数码UP",
                        "mtime": 1711000000
                      }
                    ]
                  }
                }
                """.trimIndent()
            )
        )
        val items = client.fetchFollows("SESSDATA=fake", 12345)
        assertEquals(2, items.size)
        assertEquals(300L, items[0].mid)
        assertEquals("美食UP", items[0].uname)
        assertEquals("好吃的视频", items[0].sign)
        assertEquals(1712000000L * 1000, items[0].followedAt)

        // Second item has no face/sign — verify nulls don't crash parsing
        assertEquals(400L, items[1].mid)
        assertEquals("数码UP", items[1].uname)
        assertNull(items[1].face)
        assertNull(items[1].sign)

        val request = server.takeRequest()
        assertTrue(request.path!!.contains("vmid=12345"))
        assertTrue(request.path!!.contains("order_type=attention"))
    }

    @Test
    fun `fetchFollows skips entries with mid 0 (deleted accounts)`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """
                {
                  "code": 0,
                  "data": {
                    "list": [
                      { "mid": 0, "uname": "已注销" },
                      { "mid": 500, "uname": "活跃UP", "mtime": 1710000000 }
                    ]
                  }
                }
                """.trimIndent()
            )
        )
        val items = client.fetchFollows("SESSDATA=fake", 12345)
        assertEquals(1, items.size)
        assertEquals(500L, items[0].mid)
    }
}
