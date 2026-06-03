package com.chainlesschain.android.pdh.social

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * JVM unit tests for [WebSignBridge] pure helpers. The WebView-dependent
 * parts (warmUp / signUrl wiring) live in a separate androidTest because
 * Robolectric WebView is too flaky on CI; here we lock down the bits that
 * have to be byte-exact across rotations.
 */
class WebSignBridgeHelpersTest {

    // ---- decodeJsResult ----
    // evaluateJavascript callbacks deliver JSON-encoded primitives.

    @Test
    fun decodeJsResult_nullLiteralReturnsKotlinNull() {
        assertNull(WebSignBridgeHelpers.decodeJsResult("null"))
    }

    @Test
    fun decodeJsResult_undefinedReturnsKotlinNull() {
        assertNull(WebSignBridgeHelpers.decodeJsResult("undefined"))
    }

    @Test
    fun decodeJsResult_blankReturnsKotlinNull() {
        assertNull(WebSignBridgeHelpers.decodeJsResult(""))
        assertNull(WebSignBridgeHelpers.decodeJsResult("   "))
        assertNull(WebSignBridgeHelpers.decodeJsResult(null))
    }

    @Test
    fun decodeJsResult_doubleQuotedStringIsUnwrapped() {
        assertEquals("abc", WebSignBridgeHelpers.decodeJsResult("\"abc\""))
    }

    @Test
    fun decodeJsResult_escapedQuotesAreUnescaped() {
        // JS returned the string `a"b` — JSON-encoded as `"a\"b"`.
        assertEquals("a\"b", WebSignBridgeHelpers.decodeJsResult("\"a\\\"b\""))
    }

    @Test
    fun decodeJsResult_realSignatureSurvivesRoundTrip() {
        // Real-world _signature looks like base64 + `.` segments; just ensure
        // we don't mangle any of the chars Toutiao uses.
        val sig = "_02B4Z6wo00f01abcDEF.123-_=foo"
        val encoded = "\"" + sig + "\""
        assertEquals(sig, WebSignBridgeHelpers.decodeJsResult(encoded))
    }

    @Test
    fun decodeJsResult_unquotedNumberReturnsAsString() {
        // Caller asked for stringy result; if the JS returned a bare number
        // we just hand it back as-is (caller decides what to do).
        assertEquals("42", WebSignBridgeHelpers.decodeJsResult("42"))
    }

    // ---- appendSignFragment ----

    @Test
    fun appendSignFragment_simpleKeyValueAdded() {
        val url = "https://www.toutiao.com/api/news/feed/v90/?category=__all__".toHttpUrl()
        val out = WebSignBridgeHelpers.appendSignFragment(url, "_signature=abc123")
        assertEquals("abc123", out.queryParameter("_signature"))
        assertEquals("__all__", out.queryParameter("category"))
    }

    @Test
    fun appendSignFragment_acceptsLeadingQuestion() {
        val url = "https://x.com/api?a=1".toHttpUrl()
        val out = WebSignBridgeHelpers.appendSignFragment(url, "?_signature=xyz")
        assertEquals("xyz", out.queryParameter("_signature"))
    }

    @Test
    fun appendSignFragment_acceptsLeadingAmpersand() {
        val url = "https://x.com/api?a=1".toHttpUrl()
        val out = WebSignBridgeHelpers.appendSignFragment(url, "&_signature=xyz&x-bogus=qq")
        assertEquals("xyz", out.queryParameter("_signature"))
        assertEquals("qq", out.queryParameter("x-bogus"))
    }

    @Test
    fun appendSignFragment_emptyFragmentLeavesUrlUnchanged() {
        val url = "https://x.com/api?a=1".toHttpUrl()
        val out = WebSignBridgeHelpers.appendSignFragment(url, "  ")
        assertEquals(url, out)
    }

    @Test
    fun appendSignFragment_multiplePairs() {
        val url = "https://x.com/api?a=1".toHttpUrl()
        val out = WebSignBridgeHelpers.appendSignFragment(url, "_signature=sig&_ts=999&aid=24")
        assertEquals("sig", out.queryParameter("_signature"))
        assertEquals("999", out.queryParameter("_ts"))
        assertEquals("24", out.queryParameter("aid"))
    }

    // ---- buildProbeScript ----

    @Test
    fun buildProbeScript_includesAllCandidates() {
        val js = WebSignBridgeHelpers.buildProbeScript(
            listOf("window.byted_acrawler.sign", "window._signer"),
            "\"https://x.com/y\"",
        )
        assertTrue(js.contains("byted_acrawler.sign"), "probe script must mention candidate paths")
        assertTrue(js.contains("_signer"))
        assertTrue(js.contains("\"https://x.com/y\""), "probe script must pass args verbatim")
        // The probe script returns null on miss, not throws.
        assertTrue(js.contains("return null"))
    }

    @Test
    fun buildProbeScript_callsCandidatesInOrder() {
        val js = WebSignBridgeHelpers.buildProbeScript(
            listOf("a.b", "c.d.e"),
            "{x: 1}",
        )
        // Just sanity-check ordering — first candidate appears before second.
        val first = js.indexOf("\"a.b\"")
        val second = js.indexOf("\"c.d.e\"")
        assertTrue(first in 0 until second, "candidates must be ordered in the array literal")
    }
}
