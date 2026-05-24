package com.chainlesschain.android.pdh.social.weibo

import org.junit.Ignore
import org.junit.Test

/**
 * A8 v0.2 真机 E2E test stubs for 微博 (m.weibo.cn 移动端).
 *
 * **All tests are @Ignore'd** — they require:
 *   1. Real m.weibo.cn account credentials (cannot embed in CI)
 *   2. Real Android device with the APK installed
 *   3. In-APK cc bundle containing social-weibo adapter (PDH ≥ 0.3.0)
 *   4. Mac/Linux dev box (Win lacks adb + Android SDK)
 *   5. Charles / mitmproxy for risk-control scenarios (3 + 5 + 6)
 *
 * Test bodies use `TODO("see docs/design/A8_Weibo_E2E_Plan.md §<N>")` so
 * each stub points to the manual test script for the matching scenario.
 * Pattern mirrors [com.chainlesschain.android.pdh.social.bilibili.A8BilibiliE2ETest]
 * (4-fetcher full-sync template).
 *
 * Surface differences from Bilibili:
 *   - **UID not directly in cookie**: SUB cookie is encrypted compound token,
 *     must async /api/config to get uid. Scenario 1 assertion focuses on this
 *     extra round-trip.
 *   - **ISO 8601 time strings** ("Sun Jan 12 13:45:00 +0800 2026") vs
 *     Bilibili's unix-seconds. Scenario 2 includes time-parse assertion.
 *   - **Mobile UA + Referer m.weibo.cn** gates (scenario 6 anti-cookie-hijack
 *     burst is Weibo-specific — Bilibili doesn't have equivalent rate limit).
 *   - **No WBI / X-Bogus** on m.weibo.cn (desktop weibo.com has XSRF — v0.3).
 */
class A8WeiboE2ETest {

    @Test
    @Ignore("Manual: see docs/design/A8_Weibo_E2E_Plan.md §1 first-login happy path")
    fun firstLoginSuccess(): Unit = TODO("Manual scenario 1")

    @Test
    @Ignore("Manual: see docs/design/A8_Weibo_E2E_Plan.md §2 sync 3 kinds")
    fun syncThreeKindsSuccess(): Unit = TODO("Manual scenario 2")

    @Test
    @Ignore("Manual: see docs/design/A8_Weibo_E2E_Plan.md §3 cookie expired (-100 silentband)")
    fun cookieExpired(): Unit = TODO("Manual scenario 3")

    @Test
    @Ignore("Manual: see docs/design/A8_Weibo_E2E_Plan.md §4 WebView cancel login")
    fun webViewCancelLogin(): Unit = TODO("Manual scenario 4")

    @Test
    @Ignore("Manual: see docs/design/A8_Weibo_E2E_Plan.md §5 partial fetcher failure (one 5xx)")
    fun partialFetcherFailure(): Unit = TODO("Manual scenario 5")

    @Test
    @Ignore("Manual: see docs/design/A8_Weibo_E2E_Plan.md §6 anti-cookie-hijack burst")
    fun antiCookieHijackBurst(): Unit = TODO("Manual scenario 6")

    @Test
    @Ignore("Manual: see docs/design/A8_Weibo_E2E_Plan.md §7 repeated sync idempotency")
    fun repeatedSyncIdempotent(): Unit = TODO("Manual scenario 7")

    @Test
    @Ignore("Manual: see docs/design/A8_Weibo_E2E_Plan.md §8 keystore corruption")
    fun keystoreCorruption(): Unit = TODO("Manual scenario 8")
}
