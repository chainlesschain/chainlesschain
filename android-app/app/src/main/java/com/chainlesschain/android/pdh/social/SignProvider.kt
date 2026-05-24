package com.chainlesschain.android.pdh.social

import okhttp3.HttpUrl

/**
 * §A8 v0.3 — Pluggable URL signer for platforms that gate reads on JS-side
 * anti-bot signatures (Toutiao `_signature` / Douyin `X-Bogus` / Kuaishou
 * `NS_sig3`).
 *
 * Why an interface rather than just calling [WebSignBridge] directly:
 *   - ApiClient JVM tests want to assert URL building / response parsing
 *     without standing up a WebView (which Robolectric makes painful and
 *     CI-flaky). Tests inject a [FakeSignProvider] returning a deterministic
 *     sentinel; production wires the WebView-backed bridge.
 *   - Lets v0.3 ship with a graceful-degrade path: if signing fails, the
 *     ApiClient can still attempt the unsigned request and let the server
 *     decide (some endpoints will silent-empty rather than 412; the empty
 *     response surfaces to UI as "v0.3 sign failed, retry").
 *
 * Contract:
 *   - [signUrl] takes an [HttpUrl] (query already containing the read params
 *     except the signature itself), returns either the URL with signature
 *     appended OR null on failure (timeout, JS bridge not ready, signing
 *     function rotated and probe failed). Callers MUST treat null as
 *     "skip this endpoint" — never fall back to the unsigned URL silently,
 *     because anti-bot will mark the request as suspicious and may issue a
 *     short-band rate-limit.
 *   - Implementations MUST be safe to call concurrently from multiple
 *     coroutines (the in-APK collector parallelises fetchFeed/Comments/Search).
 *     WebView is single-threaded on Main; concrete impls must serialize JS
 *     evaluations behind a mutex.
 */
interface SignProvider {
    /**
     * Sign [rawUrl] for [purpose] (Toutiao's `_signature` algorithm takes
     * a different code path for feed vs search). Returns the signed
     * [HttpUrl] with sign params appended, or null on failure.
     */
    suspend fun signUrl(rawUrl: HttpUrl, purpose: String): HttpUrl?

    /**
     * Extra request headers required by the signing protocol. Toutiao's
     * `_signature` lives in the URL so this defaults to empty; Douyin's
     * `X-Bogus` and Kuaishou's signed `Cookie` mutations belong here.
     *
     * Implementations that compute headers + URL from the SAME JS
     * evaluation MUST stash the result during [signUrl] and serve it
     * back here when called with the same [rawUrl] — see
     * [WebSignBridge] for the single-slot cache pattern.
     */
    suspend fun signedHeaders(rawUrl: HttpUrl, purpose: String): Map<String, String> =
        emptyMap()

    /**
     * Eagerly warm up the underlying signing context (load the WebView,
     * inject cookies, wait for the platform's anti-bot SDK to initialize).
     * Calling [signUrl] without [warmUp] is supported but will pay the
     * warm-up cost on first call. Returns true if warm-up succeeded; false
     * if the platform SDK never reached a ready state (signing will fail).
     */
    suspend fun warmUp(cookie: String): Boolean = true

    /** Release resources (destroy the WebView). Idempotent. */
    fun shutdown() {}
}

/**
 * Always-failing provider used by JVM tests + as a sentinel default before
 * the platform-specific [SignProvider] is wired into the DI graph. ApiClient
 * methods MUST short-circuit when this provider returns null instead of
 * issuing the unsigned request.
 */
object NullSignProvider : SignProvider {
    override suspend fun signUrl(rawUrl: HttpUrl, purpose: String): HttpUrl? = null
}
