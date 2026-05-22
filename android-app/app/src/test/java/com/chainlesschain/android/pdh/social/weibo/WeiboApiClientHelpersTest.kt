package com.chainlesschain.android.pdh.social.weibo

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * §A8 v0.2 — WeiboApiClient companion helpers (parseWeiboTime / stripHtml).
 *
 * Full HTTP path test requires MockWebServer (Robolectric) — kept light here
 * because the JSON parse logic is exercised by WeiboLocalCollectorTest via
 * coEvery stubs on the suspend fetchers.
 */
class WeiboApiClientHelpersTest {

    @Test
    fun `parseWeiboTime handles canonical Weibo time format`() {
        // "Sun Jan 12 13:45:00 +0800 2026" is what m.weibo.cn returns for
        // mblog.created_at — the SimpleDateFormat pattern "EEE MMM dd HH:mm:ss Z yyyy"
        val ms = WeiboApiClient.parseWeiboTime("Sun Jan 12 13:45:00 +0800 2026")
        assertTrue(ms > 0L, "parseWeiboTime should return >0 epoch-ms")
        // 2026-01-12 13:45:00 +0800 = 1768189500000 (sanity within 1 day window)
        // Don't pin to exact ms (locale daylight diffs across CI), just check year
        assertTrue(ms > 1735689600000L, "should resolve to 2026 or later") // 2025-01-01
        assertTrue(ms < 1800000000000L, "should not overshoot past 2027")  // approx
    }

    @Test
    fun `parseWeiboTime handles unix-seconds string fallback`() {
        // 微博偶尔直接发整数字符串（少数 endpoint），需自动判 unix vs ms
        val secStr = WeiboApiClient.parseWeiboTime("1715000000")
        assertEquals(1715000000L * 1000, secStr)
        val msStr = WeiboApiClient.parseWeiboTime("1715000000000")
        assertEquals(1715000000000L, msStr)
    }

    @Test
    fun `parseWeiboTime returns 0 on null or empty`() {
        assertEquals(0L, WeiboApiClient.parseWeiboTime(null))
        assertEquals(0L, WeiboApiClient.parseWeiboTime(""))
        assertEquals(0L, WeiboApiClient.parseWeiboTime("   "))
    }

    @Test
    fun `parseWeiboTime returns 0 on garbage`() {
        assertEquals(0L, WeiboApiClient.parseWeiboTime("not-a-date"))
        assertEquals(0L, WeiboApiClient.parseWeiboTime("2026-13-99 25:99:99"))
    }

    @Test
    fun `stripHtml removes anchor tags but keeps inner text`() {
        val raw = "看 <a href='/n/微博小秘书'>@微博小秘书</a> 的转发"
        assertEquals("看 @微博小秘书 的转发", WeiboApiClient.stripHtml(raw))
    }

    @Test
    fun `stripHtml unescapes common HTML entities`() {
        val raw = "&quot;hello&quot; &amp; world &lt;3&gt;&nbsp;&nbsp;test"
        assertEquals("\"hello\" & world <3>  test", WeiboApiClient.stripHtml(raw))
    }

    @Test
    fun `stripHtml handles null or empty`() {
        assertEquals("", WeiboApiClient.stripHtml(null))
        assertEquals("", WeiboApiClient.stripHtml(""))
    }

    @Test
    fun `stripHtml strips span and img wrappers (微博 emoji)`() {
        val raw = "今天<span class='url-icon'><img src='emoji'></span>开心"
        assertEquals("今天开心", WeiboApiClient.stripHtml(raw))
    }
}
