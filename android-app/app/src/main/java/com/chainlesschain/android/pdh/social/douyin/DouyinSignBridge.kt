package com.chainlesschain.android.pdh.social.douyin

import android.content.Context
import com.chainlesschain.android.pdh.social.WebSignBridge
import com.chainlesschain.android.pdh.social.WebSignBridgeHelpers
import dagger.hilt.android.qualifiers.ApplicationContext
import okhttp3.HttpUrl
import org.json.JSONObject
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * §A8 v0.3 — Douyin `X-Bogus` + `_signature` provider, mirrors Toutiao's
 * bridge but with two key differences vs Toutiao:
 *
 *  1) Output shape: ByteDance's `byted_acrawler.sign({url})` returns an
 *     object `{X-Bogus: "...", _signature: "..."}` for Douyin (the
 *     `aweme-v1-web-endpoints` endpoints want `X-Bogus` as a request HEADER and
 *     `_signature` as a query param). The same function on Toutiao
 *     returns just `_signature` because the Toutiao endpoints don't gate
 *     on `X-Bogus`. Bridge parses the JSON and exposes:
 *       - signed URL via [signUrl] (with `_signature` query param added)
 *       - extra headers via [signedHeaders] (containing `X-Bogus`)
 *
 *  2) Single-slot cache: each `aweme-v1-web-endpoints` call needs ONE JS eval to
 *     produce both URL + header. ApiClient calls [signUrl] then
 *     [signedHeaders] in sequence; we stash the result keyed by rawUrl
 *     so the second call doesn't re-evaluate.
 *
 * Real-device verification 2026-05-24 (not yet — Win box can't drive):
 *   - acrawler.js loaded ~1.5s after onPageFinished on Xiaomi 24115RA8EC
 *     in earlier Bilibili / Toutiao bridge measurements; reusing the
 *     2500ms post-load grace.
 *   - `byted_acrawler.sign` is the same global as Toutiao's (same
 *     ByteDance acrawler family). aid=2906 for Douyin web (vs aid=24
 *     for Toutiao).
 */
@Singleton
class DouyinSignBridge @Inject constructor(
    @ApplicationContext context: Context,
) : WebSignBridge(context) {

    override val homepageUrl: String = "https://www.douyin.com/"

    override val cookieDomain: String = ".douyin.com"

    override val postLoadDelayMs: Long = 2500L

    /**
     * Single-slot cache: ApiClient calls [signUrl] then [signedHeaders]
     * back-to-back for the same rawUrl; we eval the JS once in [signUrl]
     * and serve cached headers in [signedHeaders]. Not concurrent-safe
     * across multiple in-flight requests, but [WebSignBridge.evalMutex]
     * serializes sign() calls anyway.
     */
    @Volatile private var lastRawUrl: HttpUrl? = null
    @Volatile private var lastHeaders: Map<String, String> = emptyMap()

    override fun buildSignScript(rawUrl: String, purpose: String): String {
        val args = JSONObject().apply {
            put("url", rawUrl)
            put("aid", AID_DOUYIN_WEB)
            put("platform", "PC")
        }.toString()
        // Probe same byted_acrawler candidates as Toutiao. Return JSON
        // serialization so the bridge can unpack {X-Bogus, _signature}.
        return """
            (function() {
              try {
                if (window.byted_acrawler && typeof window.byted_acrawler.sign === 'function') {
                  var r = window.byted_acrawler.sign($args);
                  if (typeof r === 'string') return r;
                  if (r && typeof r === 'object') return JSON.stringify(r);
                }
                if (typeof window._0x32d839 === 'function') {
                  var r2 = window._0x32d839(${JSONObject.quote(rawUrl)});
                  return (typeof r2 === 'string') ? r2 : JSON.stringify(r2);
                }
                if (window.acrawler && typeof window.acrawler.sign === 'function') {
                  return window.acrawler.sign(${JSONObject.quote(rawUrl)});
                }
                return null;
              } catch (e) {
                return null;
              }
            })();
        """.trimIndent()
    }

    /**
     * Override the base [signUrl] to parse the JSON result and split it
     * into URL (with `_signature=` query) + headers (with `X-Bogus`).
     * The headers go into the single-slot cache for [signedHeaders].
     */
    override suspend fun signUrl(rawUrl: HttpUrl, purpose: String): HttpUrl? {
        val rawResult = evalSignResultRaw(rawUrl, purpose) ?: run {
            lastRawUrl = rawUrl
            lastHeaders = emptyMap()
            return null
        }
        // Two output shapes:
        //   - bare string `"abc123"` → treated as `_signature` value only
        //   - JSON object `{"_signature":"...", "X-Bogus":"..."}`
        val sig: String?
        val xBogus: String?
        val parsed = tryParseJson(rawResult)
        if (parsed != null) {
            sig = parsed.optStringOrNull("_signature")
                ?: parsed.optStringOrNull("signature")
            xBogus = parsed.optStringOrNull("X-Bogus")
                ?: parsed.optStringOrNull("x-bogus")
        } else {
            sig = rawResult.trim()
            xBogus = null
        }
        if (sig.isNullOrBlank()) {
            // Anti-bot sometimes returns just X-Bogus without _signature.
            // Treat as failure: Douyin endpoints require both.
            Timber.w("DouyinSignBridge: sign result missing _signature; raw=%s", rawResult.take(120))
            lastRawUrl = rawUrl
            lastHeaders = emptyMap()
            return null
        }
        val signedUrl = rawUrl.newBuilder().addQueryParameter("_signature", sig).build()
        val headers = if (!xBogus.isNullOrBlank()) {
            mapOf("X-Bogus" to xBogus)
        } else {
            emptyMap()
        }
        lastRawUrl = rawUrl
        lastHeaders = headers
        return signedUrl
    }

    override suspend fun signedHeaders(rawUrl: HttpUrl, purpose: String): Map<String, String> {
        // Strict equality — caller must use the SAME rawUrl object/value.
        // Mismatch means the cache slot is stale; serve emptyMap rather
        // than incorrect headers.
        return if (rawUrl == lastRawUrl) lastHeaders else emptyMap()
    }

    /**
     * Call into [WebSignBridge.signUrl]'s base eval flow but return the
     * raw JS result string (pre-fragment-append). We can't reuse the
     * base impl directly because that one already calls
     * [WebSignBridgeHelpers.appendSignFragment] — Douyin's result isn't
     * a fragment, it's a JSON object.
     */
    private suspend fun evalSignResultRaw(rawUrl: HttpUrl, purpose: String): String? {
        // Defer to the base class's protected evalScript machinery by
        // calling the public signUrl and immediately undoing it. That
        // approach can't see the original JS output once it's gone
        // through appendSignFragment, so we re-implement the eval inline
        // using the same script. This is a small duplication that keeps
        // the base class simple.
        return runJsAndDecode(buildSignScript(rawUrl.toString(), purpose))
    }

    private fun tryParseJson(raw: String): JSONObject? = try {
        val trimmed = raw.trim()
        if (trimmed.startsWith("{")) JSONObject(trimmed) else null
    } catch (_: Throwable) {
        null
    }

    private fun JSONObject.optStringOrNull(key: String): String? {
        if (!has(key) || isNull(key)) return null
        val v = optString(key)
        return v.takeIf { it.isNotEmpty() }
    }

    companion object {
        const val AID_DOUYIN_WEB = "2906"

        const val PURPOSE_HISTORY = "history"
        const val PURPOSE_FAVOURITE = "favourite"
        const val PURPOSE_LIKE = "like"
    }
}
