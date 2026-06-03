package com.chainlesschain.android.pdh.social.kuaishou

import android.content.Context
import com.chainlesschain.android.pdh.social.WebSignBridge
import dagger.hilt.android.qualifiers.ApplicationContext
import okhttp3.HttpUrl
import org.json.JSONObject
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * §A8 v0.3 — Kuaishou `NS_sig3` provider, runs the platform's own anti-bot
 * SDK in a hidden WebView pre-warmed with the user's login cookie.
 *
 * Unlike Toutiao / Douyin (single-string `_signature`), Kuaishou's signing
 * algorithm is **multi-stage**: it derives a per-call hash from
 *   sha256(visitor_id || timestamp || normalized_body || secret)
 * and packs it into the `__NS_sig3` field of the request URL's encoded
 * query payload AND into the `kpf` / `kpn` request headers. The exact
 * function names rotate (`window.__APP__.encryptParams`, `window.NS.sign`,
 * `window.GraphQL.fetch.sign`); we probe several known candidates.
 *
 * Kuaishou's web endpoints are **GraphQL POST**, not REST GET — the entire
 * request body must be passed to the signer (it's part of the hash input).
 * Bridge accepts the raw body via the [purpose] field, encoding it as
 * `"<queryName>|<bodyJson>"` so the JS can split + use both.
 *
 * Output shape: signing JS returns
 *   `{__NS_sig3: "abc...", kpf: "PC_WEB", kpn: "KUAISHOU_VISION", kuaishou.web.ph: "..."}`
 * Bridge encodes __NS_sig3 as a query param and ships kpf/kpn as headers.
 */
@Singleton
class KuaishouSignBridge @Inject constructor(
    @ApplicationContext context: Context,
) : WebSignBridge(context) {

    override val homepageUrl: String = "https://www.kuaishou.com/new-reco"

    override val cookieDomain: String = ".kuaishou.com"

    /**
     * Kuaishou's anti-bot SDK does an additional roundtrip after
     * onPageFinished to fetch a per-session secret salt. Real-device
     * measurements would land here; using 3000ms as a safety margin
     * pending verification (NS_sig3 init is heavier than acrawler.js).
     */
    override val postLoadDelayMs: Long = 3000L

    @Volatile private var lastRawUrl: HttpUrl? = null
    @Volatile private var lastHeaders: Map<String, String> = emptyMap()

    override fun buildSignScript(rawUrl: String, purpose: String): String {
        // purpose carries "<queryName>|<bodyJson>" — split + pass to signer.
        val pipe = purpose.indexOf('|')
        val queryName = if (pipe >= 0) purpose.substring(0, pipe) else purpose
        val body = if (pipe >= 0) purpose.substring(pipe + 1) else "{}"
        val args = JSONObject().apply {
            put("url", rawUrl)
            put("operationName", queryName)
            put("body", body)
        }.toString()
        return """
            (function() {
              try {
                // Candidate 1: kuaishou web client app-level encryptParams
                if (window.__APP__ && typeof window.__APP__.encryptParams === 'function') {
                  var r = window.__APP__.encryptParams($args);
                  if (typeof r === 'string') return r;
                  if (r && typeof r === 'object') return JSON.stringify(r);
                }
                // Candidate 2: NS namespace sign
                if (window.NS && typeof window.NS.sign === 'function') {
                  var r2 = window.NS.sign($args);
                  return (typeof r2 === 'string') ? r2 : JSON.stringify(r2);
                }
                // Candidate 3: GraphQL fetch wrapper
                if (window.GraphQL && window.GraphQL.fetch &&
                    typeof window.GraphQL.fetch.sign === 'function') {
                  var r3 = window.GraphQL.fetch.sign($args);
                  return (typeof r3 === 'string') ? r3 : JSON.stringify(r3);
                }
                // Candidate 4: bare global named __SIGN__ (occasional fallback)
                if (typeof window.__SIGN__ === 'function') {
                  return JSON.stringify(window.__SIGN__($args));
                }
                return null;
              } catch (e) {
                return null;
              }
            })();
        """.trimIndent()
    }

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
        val sigValue: String?
        val kpf: String?
        val kpn: String?
        if (parsed != null) {
            sigValue = parsed.optStringOrNull("__NS_sig3")
                ?: parsed.optStringOrNull("NS_sig3")
                ?: parsed.optStringOrNull("sig3")
            kpf = parsed.optStringOrNull("kpf") ?: "PC_WEB"
            kpn = parsed.optStringOrNull("kpn") ?: "KUAISHOU_VISION"
        } else {
            sigValue = rawResult.trim()
            kpf = "PC_WEB"
            kpn = "KUAISHOU_VISION"
        }
        if (sigValue.isNullOrBlank()) {
            Timber.w("KuaishouSignBridge: sign result missing __NS_sig3; raw=%s", rawResult.take(120))
            lastRawUrl = rawUrl
            lastHeaders = emptyMap()
            return null
        }
        val signedUrl = rawUrl.newBuilder().addQueryParameter("__NS_sig3", sigValue).build()
        lastRawUrl = rawUrl
        lastHeaders = mapOf(
            "kpf" to (kpf ?: "PC_WEB"),
            "kpn" to (kpn ?: "KUAISHOU_VISION"),
        )
        return signedUrl
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
        // GraphQL operation names — used as [purpose] prefix when calling sign.
        const val OP_FEED_RECOMMEND = "visionFeedRecommend"
        const val OP_PROFILE_PHOTOS = "visionProfilePhotoList"
        const val OP_SEARCH_PHOTO = "visionSearchPhoto"
    }
}
