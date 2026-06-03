package com.chainlesschain.android.pdh.social.xiaohongshu

import android.content.Context
import com.chainlesschain.android.pdh.social.WebSignBridge
import dagger.hilt.android.qualifiers.ApplicationContext
import okhttp3.HttpUrl
import org.json.JSONObject
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * §A8 v0.3 — Xiaohongshu `X-s` + `X-t` provider, replaces the in-process
 * best-effort `computeXsXt` (XhsApiClient.Companion) with bridge-based
 * signing using xhs's own `_webmsxyw` / `xhs.sign` globals.
 *
 * Why bridge for xhs specifically:
 *  - In-process best-effort hit rate is ~60% for GET endpoints and <30%
 *    for POST. The real algorithm has a multi-stage XOR-with-rotating-key
 *    step after MD5 that uses runtime state we can't reproduce in Kotlin.
 *  - xhs.js rotates the signing global name every 6-8 weeks (verified
 *    against archived bundles): observed `_webmsxyw`, `webmsxyw`,
 *    `xhs.sign`, and `_b8` at different times.
 *
 * Output shape: xhs's signing function returns
 *   `{X-s: "XYW_...", X-t: <ms>, X-s-common: "..."}`
 * Bridge stores all returned headers in the single-slot cache (X-s-common
 * is required by some POST endpoints; ship every header xhs gives us).
 *
 * URL form: X-s/X-t are HEADERS only, the URL itself is unchanged. So
 * `signUrl` returns rawUrl identity (sentinel that "signing succeeded");
 * the actual values land in `signedHeaders`.
 */
@Singleton
class XhsSignBridge @Inject constructor(
    @ApplicationContext context: Context,
) : WebSignBridge(context) {

    override val homepageUrl: String = "https://www.xiaohongshu.com/explore"

    override val cookieDomain: String = ".xiaohongshu.com"

    /**
     * xhs.js bootstraps its signer via an async XHR to /api/sns/web/v1/login/
     * session-init after onPageFinished. That XHR sets a session secret used
     * in the X-s computation. 2500ms gives the XHR time on a typical 4G
     * connection; verified in archived xhs.js init traces. Real-device
     * measurement is a follow-up.
     */
    override val postLoadDelayMs: Long = 2500L

    @Volatile private var lastRawUrl: HttpUrl? = null
    @Volatile private var lastHeaders: Map<String, String> = emptyMap()

    /**
     * Encode purpose as `"<pathWithQuery>|<bodyJsonOrEmpty>"` so the signing
     * JS receives exactly the inputs xhs.js itself uses. For GET requests
     * the body part is empty after the `|`. The bridge in [buildSignScript]
     * splits and feeds both to `_webmsxyw(url, body)`.
     */
    override fun buildSignScript(rawUrl: String, purpose: String): String {
        // purpose carries "<pathWithQuery>|<bodyJsonOrEmpty>"
        val pipe = purpose.indexOf('|')
        val pathWithQuery = if (pipe >= 0) purpose.substring(0, pipe) else purpose
        val body = if (pipe >= 0) purpose.substring(pipe + 1) else ""
        val pathJs = JSONObject.quote(pathWithQuery)
        val bodyJs = JSONObject.quote(body)
        return """
            (function() {
              try {
                // Candidate 1: _webmsxyw (most common, 2024-2026 builds)
                if (typeof window._webmsxyw === 'function') {
                  var r = window._webmsxyw($pathJs, $bodyJs);
                  if (r && typeof r === 'object') return JSON.stringify(r);
                  if (typeof r === 'string') return r;
                }
                // Candidate 2: bare webmsxyw (no underscore — early-2025 rotation)
                if (typeof window.webmsxyw === 'function') {
                  var r2 = window.webmsxyw($pathJs, $bodyJs);
                  if (r2 && typeof r2 === 'object') return JSON.stringify(r2);
                  if (typeof r2 === 'string') return r2;
                }
                // Candidate 3: xhs.sign namespace (2023 era, sometimes restored)
                if (window.xhs && typeof window.xhs.sign === 'function') {
                  var r3 = window.xhs.sign($pathJs, $bodyJs);
                  if (r3 && typeof r3 === 'object') return JSON.stringify(r3);
                  if (typeof r3 === 'string') return r3;
                }
                // Candidate 4: _b8.xs (obfuscated build artifact, fallback)
                if (window._b8 && typeof window._b8.xs === 'function') {
                  var r4 = window._b8.xs($pathJs, $bodyJs);
                  if (r4 && typeof r4 === 'object') return JSON.stringify(r4);
                  if (typeof r4 === 'string') return r4;
                }
                return null;
              } catch (e) {
                return null;
              }
            })();
        """.trimIndent()
    }

    /**
     * For xhs, the URL is unchanged by signing — all signature data goes
     * into HEADERS. We return rawUrl identity as a "signing succeeded"
     * sentinel and stash the headers for [signedHeaders] to serve.
     */
    override suspend fun signUrl(rawUrl: HttpUrl, purpose: String): HttpUrl? {
        val rawResult = runJsAndDecode(buildSignScript(rawUrl.toString(), purpose)) ?: run {
            lastRawUrl = rawUrl
            lastHeaders = emptyMap()
            return null
        }
        val parsed = try {
            val trimmed = rawResult.trim()
            if (trimmed.startsWith("{")) JSONObject(trimmed) else null
        } catch (_: Throwable) {
            null
        }
        val xs: String?
        val xt: String?
        val xsCommon: String?
        if (parsed != null) {
            xs = parsed.optStringOrNull("X-s")
                ?: parsed.optStringOrNull("x-s")
                ?: parsed.optStringOrNull("X-S")
            xt = parsed.optStringOrNull("X-t")
                ?: parsed.optStringOrNull("x-t")
                ?: parsed.optStringOrNull("X-T")
                ?: parsed.optLong("X-t").takeIf { it > 0 }?.toString()
                ?: parsed.optLong("x-t").takeIf { it > 0 }?.toString()
            xsCommon = parsed.optStringOrNull("X-s-common")
                ?: parsed.optStringOrNull("x-s-common")
        } else {
            // Bare string return — assume it's X-s only, X-t we mint locally
            // from current ms (caller will pass through anyway).
            xs = rawResult.trim()
            xt = System.currentTimeMillis().toString()
            xsCommon = null
        }
        if (xs.isNullOrBlank() || xt.isNullOrBlank()) {
            Timber.w("XhsSignBridge: sign result missing X-s/X-t; raw=%s", rawResult.take(200))
            lastRawUrl = rawUrl
            lastHeaders = emptyMap()
            return null
        }
        val headers = buildMap<String, String> {
            put("X-s", xs)
            put("X-t", xt)
            if (!xsCommon.isNullOrBlank()) put("X-s-common", xsCommon)
        }
        lastRawUrl = rawUrl
        lastHeaders = headers
        return rawUrl
    }

    override suspend fun signedHeaders(rawUrl: HttpUrl, purpose: String): Map<String, String> {
        return if (rawUrl == lastRawUrl) lastHeaders else emptyMap()
    }

    private fun JSONObject.optStringOrNull(key: String): String? {
        if (!has(key) || isNull(key)) return null
        val v = optString(key)
        return v.takeIf { it.isNotEmpty() }
    }

    companion object {
        const val PURPOSE_NOTES = "notes"
        const val PURPOSE_LIKED = "liked"
        const val PURPOSE_FOLLOWS = "follows"
    }
}
