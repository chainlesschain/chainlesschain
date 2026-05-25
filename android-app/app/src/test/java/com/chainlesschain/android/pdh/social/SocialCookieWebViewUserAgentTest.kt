package com.chainlesschain.android.pdh.social

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * 2026-05-25 — locks UA spoofing contract added to defeat 5 平台
 * (Bilibili / 抖音 / 小红书 / 头条 / 快手) 的 Android WebView UA 反检测
 * → 「请用 X App 打开」拦截页（无 JS 轮询，cookie 永远 Set-Cookie 不下来）。
 *
 * 真机 E2E 验：6 platform 各自登录 → 不命中拦截页 + cookie 落 CookieManager。
 * 详 memory `pdh_social_webview_deeplink_cookie_capture.md`。
 */
class SocialCookieWebViewUserAgentTest {

    @Test
    fun `sanitize strips wv marker from Android WebView UA`() {
        // 真实 Android 13 Chrome WebView 119 UA 样本
        val raw = "Mozilla/5.0 (Linux; Android 13; Pixel 5 Build/TQ3A.230805.001; wv) " +
            "AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Version/4.0 Chrome/119.0.6045.66 Mobile Safari/537.36"

        val out = sanitizeWebViewUserAgent(raw)

        assertFalse(out.contains("; wv)"), "wv marker should be stripped: $out")
        assertFalse(
            out.contains(" Version/4.0"),
            "Version/4.0 WebView marker should be stripped: $out",
        )
        assertTrue(out.contains("Chrome/119"), "Chrome version must remain: $out")
        assertTrue(out.contains("Mobile Safari"), "Mobile Safari tail must remain: $out")
    }

    @Test
    fun `sanitize is idempotent — second call no-op`() {
        val raw = "Mozilla/5.0 (Linux; Android 13; wv) Version/4.0 Chrome/119.0 Mobile Safari/537.36"
        val once = sanitizeWebViewUserAgent(raw)
        val twice = sanitizeWebViewUserAgent(once)
        assertEquals(once, twice, "double sanitize should be no-op")
    }

    @Test
    fun `sanitize leaves desktop Chrome UA untouched`() {
        // 没有 wv / Version/4.0 → 该 UA 是干净桌面 Chrome，sanitize 不动它
        val pristine = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
        assertEquals(pristine, sanitizeWebViewUserAgent(pristine))
    }

    @Test
    fun `sanitize strips arbitrary Version segment not just 4_0`() {
        // 某些 WebView 上 Version 段可能不是 4.0（理论上 Chrome WebView 一直
        // 是 4.0，但 regex 该泛化，万一变了别炸）
        val raw = "Mozilla/5.0 (Linux; Android 14; wv) Version/5.1 Chrome/120.0 Mobile Safari/537.36"
        val out = sanitizeWebViewUserAgent(raw)
        assertFalse(out.contains("Version/"), "any Version/<N> should be stripped: $out")
    }

    @Test
    fun `DESKTOP_CHROME_USER_AGENT looks like real Win Chrome`() {
        // Smoke test — 防有人改这串改坏了基本形态（Chrome 检测一些字段格式）
        val ua = DESKTOP_CHROME_USER_AGENT
        assertTrue(ua.startsWith("Mozilla/5.0"), "must start with Mozilla/5.0: $ua")
        assertTrue(ua.contains("Windows NT 10.0"), "must claim Win NT 10: $ua")
        assertTrue(ua.contains("AppleWebKit/537.36"), "must carry AppleWebKit/537.36: $ua")
        assertTrue(Regex("Chrome/\\d+\\.").containsMatchIn(ua), "must carry Chrome/<major>.: $ua")
        assertTrue(ua.contains("Safari/537.36"), "must carry Safari/537.36 tail: $ua")
        // 不能含 wv marker 也不能含 mobile（这串是桌面 UA）
        assertFalse(ua.contains("; wv)"), "desktop UA must not carry wv marker: $ua")
        assertFalse(ua.contains("Mobile"), "desktop UA must not claim Mobile: $ua")
    }
}
