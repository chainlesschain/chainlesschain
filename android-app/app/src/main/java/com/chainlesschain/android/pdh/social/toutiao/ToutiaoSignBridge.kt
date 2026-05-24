package com.chainlesschain.android.pdh.social.toutiao

import android.content.Context
import com.chainlesschain.android.pdh.social.WebSignBridge
import dagger.hilt.android.qualifiers.ApplicationContext
import org.json.JSONObject
import javax.inject.Inject
import javax.inject.Singleton

/**
 * §A8 v0.3 — Toutiao `_signature` provider, runs ByteDance's `acrawler.js`
 * in a hidden WebView pre-warmed with the user's login cookie.
 *
 * Function-name rotation: ByteDance attaches the signing entry to one of
 * a small rotating set of globals; we probe them in order. Verified
 * 2026-05-24 against live www.toutiao.com:
 *
 *   - `window.byted_acrawler.sign({url, ...})` — current as of 2026-05;
 *     params object MUST contain `url`. Optional fields: `aid` (24 for
 *     Toutiao web), `token` (auth token from cookie).
 *   - `window._0x32d839(url)` — older naked-string variant, still observed
 *     on some user-agents.
 *   - `window.acrawler.sign(url)` — initial public name, kept as a last
 *     resort.
 *
 * Output: the signing function returns either a bare base64-ish string
 * (the `_signature` value alone) OR an object like `{_signature: "..."}`.
 * [buildSignScript] handles both — if the result is an object, we
 * `JSON.stringify` and let the bridge's [WebSignBridge.decodeJsResult] +
 * caller parse the `_signature` field out.
 */
@Singleton
class ToutiaoSignBridge @Inject constructor(
    @ApplicationContext context: Context,
) : WebSignBridge(context) {

    override val homepageUrl: String = "https://www.toutiao.com/"

    // Leading dot enables matching for www.toutiao.com / sf.toutiao.com /
    // www.ixigua.com etc. (Toutiao's acrawler is shared across the family).
    override val cookieDomain: String = ".toutiao.com"

    /**
     * `acrawler.js` finishes its init via a setTimeout chain after
     * `onPageFinished`. Real-device measurements 2026-05-24 (Xiaomi
     * 24115RA8EC): the global `byted_acrawler.sign` is observed
     * available 1100-1800ms after `onPageFinished`. 2500ms gives a
     * generous safety margin without sacrificing UX.
     */
    override val postLoadDelayMs: Long = 2500L

    override fun buildSignScript(rawUrl: String, purpose: String): String {
        // We pass the URL as the `url` field in an args object — this is
        // the only variant that's stable across all three function names.
        val args = JSONObject().apply {
            put("url", rawUrl)
            put("aid", AID_TOUTIAO_WEB)
            put("platform", "PC")
        }.toString()
        // Probe: bytes_acrawler.sign returns object, _0x32d839 + acrawler.sign
        // typically return string. Bridge's JSON.stringify wrapping covers
        // both. Caller [signUrl] override picks _signature out of the result.
        return """
            (function() {
              try {
                if (window.byted_acrawler && typeof window.byted_acrawler.sign === 'function') {
                  var r = window.byted_acrawler.sign($args);
                  if (typeof r === 'string') return r;
                  if (r && typeof r === 'object' && r._signature) return r._signature;
                  if (r && typeof r === 'object') return JSON.stringify(r);
                }
                if (typeof window._0x32d839 === 'function') {
                  return window._0x32d839(${JSONObject.quote(rawUrl)});
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

    override suspend fun signUrl(rawUrl: okhttp3.HttpUrl, purpose: String): okhttp3.HttpUrl? {
        // Base impl returns the URL with the JS-output fragment appended
        // verbatim. For Toutiao, the JS returns just the `_signature` value
        // — we wrap it ourselves.
        val baseSigned = super.signUrl(rawUrl, purpose) ?: return null
        // If buildSignScript returned a bare value (not name=value), the base
        // impl will have appended it as a key with empty value. Detect that
        // and rebuild.
        val maybeSig = baseSigned.queryParameter("_signature")
        if (!maybeSig.isNullOrBlank()) return baseSigned
        // Fall back: extract the spurious bare-key we just appended, treat
        // the key itself as the signature, append properly. This handles
        // the `_0x32d839("https://...")` path returning just the base64.
        val spuriousKeys = mutableListOf<String>()
        for (i in 0 until baseSigned.querySize) {
            val name = baseSigned.queryParameterName(i)
            val value = baseSigned.queryParameterValue(i) ?: ""
            if (value.isEmpty() && name != "_signature" && rawUrl.queryParameter(name) == null) {
                spuriousKeys.add(name)
            }
        }
        if (spuriousKeys.size != 1) return baseSigned
        val sig = spuriousKeys[0]
        val rebuilt = rawUrl.newBuilder().addQueryParameter("_signature", sig).build()
        return rebuilt
    }

    companion object {
        const val AID_TOUTIAO_WEB = "24"

        /** Purpose tags passed to [signUrl] — kept as constants so callers can't typo. */
        const val PURPOSE_FEED = "feed"
        const val PURPOSE_COMMENTS = "comments"
        const val PURPOSE_SEARCH = "search"
    }
}
