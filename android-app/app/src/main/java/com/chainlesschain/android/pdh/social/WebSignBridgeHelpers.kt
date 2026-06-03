package com.chainlesschain.android.pdh.social

import okhttp3.HttpUrl
import org.json.JSONObject

/**
 * Pure-Kotlin helpers extracted from [WebSignBridge] so JVM unit tests can
 * exercise them without dragging in `android.webkit.*` (which isn't on the
 * test classpath unless Robolectric is set up, and Robolectric WebView is
 * flaky on CI).
 *
 * Keep this file Android-import-free — no `android.*` types, no `Context`,
 * no `WebView`. Only standard Kotlin + okhttp + org.json.
 */
internal object WebSignBridgeHelpers {

    internal const val DESKTOP_CHROME_UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

    /**
     * Decode a value returned from `WebView.evaluateJavascript`. The
     * callback delivers values as JSON-encoded strings: `"foo"` →
     * `"\"foo\""`, `null` → `"null"`, `42` → `"42"`. Strip outer quotes
     * + unescape `\"`. Returns null for the literal `"null"` / blank /
     * `"undefined"`.
     */
    internal fun decodeJsResult(value: String?): String? {
        if (value.isNullOrBlank()) return null
        val trimmed = value.trim()
        if (trimmed == "null" || trimmed == "undefined") return null
        if (trimmed.startsWith("\"") && trimmed.endsWith("\"") && trimmed.length >= 2) {
            val inner = trimmed.substring(1, trimmed.length - 1)
            // JSONObject.quote is the inverse — but we don't have an
            // easy unquote. Manual replace for the common escapes:
            return inner.replace("\\\"", "\"").replace("\\\\", "\\").replace("\\n", "\n")
        }
        return trimmed
    }

    /**
     * Append a `name=value` (or `name1=v1&name2=v2`) query fragment
     * returned by the signing JS to [rawUrl]. Strips a leading `?` or
     * `&` if the JS includes it.
     */
    internal fun appendSignFragment(rawUrl: HttpUrl, fragment: String): HttpUrl {
        val trimmed = fragment.trim().removePrefix("?").removePrefix("&")
        if (trimmed.isEmpty()) return rawUrl
        val builder = rawUrl.newBuilder()
        for (pair in trimmed.split('&')) {
            if (pair.isBlank()) continue
            val eq = pair.indexOf('=')
            if (eq < 0) {
                builder.addQueryParameter(pair, "")
            } else {
                val k = pair.substring(0, eq)
                val v = pair.substring(eq + 1)
                builder.addQueryParameter(k, v)
            }
        }
        return builder.build()
    }

    /**
     * Build a JS snippet that probes a list of candidate function paths
     * (e.g. `["window.byted_acrawler.sign", "window._0x32d839.sign"]`)
     * and calls the first that resolves to a function. Each function
     * receives the [argsJson] string. The JS returns the result or null.
     */
    internal fun buildProbeScript(candidates: List<String>, argsJson: String): String {
        val checks = candidates.joinToString(",") { JSONObject.quote(it) }
        return """
            (function() {
              try {
                var candidates = [$checks];
                for (var i = 0; i < candidates.length; i++) {
                  var path = candidates[i];
                  var fn = path.split('.').reduce(function(o,k){return o && o[k];}, window);
                  if (typeof fn === 'function') {
                    var r = fn($argsJson);
                    if (typeof r === 'string') return r;
                    if (r && typeof r === 'object') return JSON.stringify(r);
                  }
                }
                return null;
              } catch (e) {
                return null;
              }
            })();
        """.trimIndent()
    }
}
