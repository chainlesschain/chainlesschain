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
import kotlin.test.assertFalse
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
            // prepareCookie() calls mintBuvid3() which fires an extra request
            // to /x/frontend/finger/spi BEFORE the real endpoint. Without
            // seeding here, every fetcher test would have to enqueue 2
            // responses (1 for the mint, 1 for the real endpoint), and the
            // existing single-enqueue tests hang in runTest with
            // UncompletedCoroutinesError — see CI run 26347368380 (8 failures).
            setMintedBuvid3ForTest("test-buvid3")
            // 2026-05-24 — same trap, second axis: prepareRequest() now also
            // calls ensureWbiMixinKey() which fires /x/web-interface/nav. Seed
            // a deterministic mixin so existing single-enqueue tests are
            // unaffected; WBI-specific tests reset it via setWbiMixinKeyForTest
            // (null) to exercise the nav-fetch + degraded-no-mixin paths.
            setWbiMixinKeyForTest("test-mixin-key")
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
        // 2026-05-22 real-device fix: /x/v2/history/cursor returns 404,
        // switched to /x/web-interface/history/cursor with type=archive
        // (see BilibiliApiClient.kt:113-117). 2026-05-24: WBI signing now
        // appends `wts` + `w_rid` query params, so the path is no longer an
        // exact match — assert by substring.
        assertTrue(
            request.path!!.startsWith("/x/web-interface/history/cursor?"),
            "path: ${request.path}",
        )
        assertTrue(request.path!!.contains("ps=30"))
        assertTrue(request.path!!.contains("type=archive"))
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

    // ─── WBI signature (2026-05-24 bug-fix for silent empty data) ──────────
    //
    // Bilibili web APIs gate on `w_rid` + `wts` query params derived from
    // a `mixin_key` rotated daily via /x/web-interface/nav. Missing → server
    // returns `{code:0, data:{list:[]}}` (silently empty) or -400. Verified
    // on real device 2026-05-24 — 4-API-empty persisted even with valid
    // SESSDATA + buvid3 until WBI signing was added.

    @Test
    fun `md5Hex matches well-known vectors and is lowercase hex`() {
        assertEquals("d41d8cd98f00b204e9800998ecf8427e", md5Hex(""))
        assertEquals("900150983cd24fb0d6963f7d28e17f72", md5Hex("abc"))
        assertTrue(md5Hex("anything").matches(Regex("[0-9a-f]{32}")))
    }

    @Test
    fun `urlEncodeWbi uses percent-20 for space and UTF-8 for non-ascii`() {
        // URLEncoder produces "+" for space — Bilibili's JS uses encodeURIComponent
        // which produces "%20". The wrapper must rewrite + → %20.
        assertEquals("hello%20world", urlEncodeWbi("hello world"))
        // Literal "+" must encode to %2B and survive the + → %20 rewrite.
        assertEquals("a%2Bb", urlEncodeWbi("a+b"))
        assertEquals("plain", urlEncodeWbi("plain"))
        // UTF-8 path: "中文" → E4 B8 AD E6 96 87
        assertEquals("%E4%B8%AD%E6%96%87", urlEncodeWbi("中文"))
    }

    @Test
    fun `extractWbiKeyFromUrl pulls the filename basename`() {
        assertEquals(
            "7cd084941338484aae1ad9425b84077c",
            client.extractWbiKeyFromUrl(
                "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png",
            ),
        )
        assertEquals(
            "4932caff0ff746eab6f01bf08b70ac45",
            client.extractWbiKeyFromUrl(
                "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.jpg",
            ),
        )
    }

    @Test
    fun `extractWbiKeyFromUrl returns null on malformed inputs`() {
        assertNull(client.extractWbiKeyFromUrl(""))
        assertNull(client.extractWbiKeyFromUrl("not-a-url-without-slash"))
        // dot before last slash should not be parsed as extension
        assertNull(client.extractWbiKeyFromUrl("https://example.com/no-extension"))
    }

    @Test
    fun `signUrl appends wts and 32-char hex w_rid, preserves original params`() {
        val original = "https://api.bilibili.com/x/something?foo=bar&baz=qux".toHttpUrl()
        val signed = client.signUrl(original, "test-mixin-key")
        assertEquals("bar", signed.queryParameter("foo"))
        assertEquals("qux", signed.queryParameter("baz"))
        val wts = signed.queryParameter("wts")
        val wRid = signed.queryParameter("w_rid")
        assertNotNull(wts)
        assertNotNull(wRid)
        assertTrue(wRid!!.matches(Regex("[0-9a-f]{32}")), "w_rid must be 32 hex chars: $wRid")
    }

    @Test
    fun `signUrl w_rid equals md5 of alphabetically-sorted canonical plus mixin`() {
        // Pin the math: build expected w_rid by reading wts back out of the
        // signed URL, then assert md5(canonical + mixin) matches what signUrl
        // produced. This locks both (1) alphabetical sort by key and (2) the
        // exact canonical-string shape (key=value joined by &).
        val mixin = "fixedMixinKey0123"
        val raw = "https://api.bilibili.com/x/space/myinfo?b=2&a=1".toHttpUrl()
        val signed = client.signUrl(raw, mixin)
        val wts = signed.queryParameter("wts")!!
        val canonical = "a=1&b=2&wts=$wts"
        assertEquals(md5Hex(canonical + mixin), signed.queryParameter("w_rid"))
    }

    @Test
    fun `signUrl strips forbidden chars from values before signing`() {
        // Bilibili's JS strips ! ' ( ) * from values before signing (but the
        // URL the request goes out on still has the original value). Without
        // this step the server's recomputed w_rid won't match → silent empty.
        val mixin = "k"
        val raw = "https://api.bilibili.com/x/y?p=hello!'()*world".toHttpUrl()
        val signed = client.signUrl(raw, mixin)
        val wts = signed.queryParameter("wts")!!
        // Outgoing URL retains the original (un-stripped) value
        assertEquals("hello!'()*world", signed.queryParameter("p"))
        // Signature uses the cleaned value
        val canonical = "p=helloworld&wts=$wts"
        assertEquals(md5Hex(canonical + mixin), signed.queryParameter("w_rid"))
    }

    @Test
    fun `fetchHistory URL is signed when wbi mixin key is seeded`() = runTest {
        // Default setUp seeds the mixin to "test-mixin-key" — verify the
        // outgoing path actually carries wts + w_rid.
        server.enqueue(MockResponse().setBody("""{"code":0,"data":{"list":[]}}"""))
        client.fetchHistory("SESSDATA=fake")
        val req = server.takeRequest()
        assertTrue(req.path!!.contains("wts="), "request must carry wts param: ${req.path}")
        assertTrue(req.path!!.contains("w_rid="), "request must carry w_rid param: ${req.path}")
    }

    @Test
    fun `fetchHistory URL is unsigned and falls back when nav fetch fails`() = runTest {
        // Reset the seeded mixin so prepareRequest() actually fires /nav,
        // then return 500 to force the degraded "use unsigned URL" branch.
        client.setWbiMixinKeyForTest(null)
        server.enqueue(MockResponse().setResponseCode(500))                 // /nav fails
        server.enqueue(MockResponse().setBody("""{"code":0,"data":{"list":[]}}"""))
        client.fetchHistory("SESSDATA=fake")

        val navReq = server.takeRequest()
        assertTrue(
            navReq.path!!.contains("/x/web-interface/nav"),
            "first request must hit /nav, got ${navReq.path}",
        )
        val histReq = server.takeRequest()
        assertTrue(
            histReq.path!!.contains("/x/web-interface/history/cursor"),
            "second request must be history, got ${histReq.path}",
        )
        assertFalse(
            histReq.path!!.contains("w_rid="),
            "history must not carry w_rid when wbi unavailable: ${histReq.path}",
        )
    }

    @Test
    fun `ensureWbiMixinKey derives mixin from nav wbi_img response and caches it`() = runTest {
        client.setWbiMixinKeyForTest(null)
        // Two 64-byte-total keys so the WBI_MIXIN_KEY_TABLE indexing has
        // enough source chars (raw = imgKey + subKey, length must be ≥ 64).
        val imgKey = "7cd084941338484aae1ad9425b84077c"  // 32 chars
        val subKey = "4932caff0ff746eab6f01bf08b70ac45"  // 32 chars
        server.enqueue(
            MockResponse().setBody(
                """
                {
                  "code": 0,
                  "data": {
                    "wbi_img": {
                      "img_url": "https://i0.hdslb.com/bfs/wbi/$imgKey.png",
                      "sub_url": "https://i0.hdslb.com/bfs/wbi/$subKey.png"
                    }
                  }
                }
                """.trimIndent(),
            ),
        )
        server.enqueue(MockResponse().setBody("""{"code":0,"data":{"list":[]}}"""))

        client.fetchHistory("SESSDATA=fake")

        // First request: /nav (consumed)
        val navReq = server.takeRequest()
        assertTrue(navReq.path!!.contains("/x/web-interface/nav"))
        // Second: history, signed.
        val histReq = server.takeRequest()
        assertTrue(histReq.path!!.contains("wts="))
        assertTrue(histReq.path!!.contains("w_rid="))

        // Second call must NOT re-fetch /nav (cache hit).
        server.enqueue(MockResponse().setBody("""{"code":0,"data":{"list":[]}}"""))
        client.fetchHistory("SESSDATA=fake")
        val secondHist = server.takeRequest()
        assertTrue(
            secondHist.path!!.contains("/x/web-interface/history/cursor"),
            "second fetch must skip /nav and go straight to history: ${secondHist.path}",
        )
    }
}
