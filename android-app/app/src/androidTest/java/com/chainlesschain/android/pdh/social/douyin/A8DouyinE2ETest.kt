package com.chainlesschain.android.pdh.social.douyin

import org.junit.Ignore
import org.junit.Test

/**
 * A8 v0.2 真机 E2E test stubs for 抖音.
 *
 * **All tests are @Ignore'd** — they require:
 *   1. Real douyin.com account credentials (cannot embed in CI)
 *   2. Real Android device with the APK installed
 *   3. In-APK cc bundle containing social-douyin adapter (PDH ≥ 0.3.0)
 *   4. Mac/Linux dev box (Win lacks adb + Android SDK)
 *   5. Charles / mitmproxy for 412 anti-spider scenario (4)
 *
 * Test bodies use `TODO("see docs/design/A8_Douyin_E2E_Plan.md §<N>")` so
 * each stub points to the manual test script. Pattern mirrors
 * [A8BilibiliE2ETest] landed 2026-05-22.
 *
 * v0.2 surface = profile-only (8 scenarios vs Bilibili's 8 with full sync).
 * X-Bogus signing is v0.3 — history/favourite/post/like scenarios will land
 * once mssdk.js port is wired (WebView JS injection or native sig SDK).
 *
 * To activate: drop `@Ignore`, replace TODO with runner orchestrating
 * APK install → adb intent → WebView UI Automator (login manual; test
 * account creds via secure test-only Hilt module).
 *
 * Surface differences from Bilibili / Xhs E2E:
 *   - **Single endpoint** (passport/account/info/v2), unsigned. No signature
 *     scenarios needed in v0.2.
 *   - **No event-data scenarios** in v0.2 — only profile (KIND_PROFILE)
 *     emits to vault. Scenario 2 verifies person-self insert, NOT events.
 *   - **412 anti-spider** is the only HTTP-level risk-control branch worth
 *     testing in v0.2 (no msToken / X-Bogus / ttwid rotation pain yet).
 *   - Login path uses `snssdk1128://` deep-link to native Douyin app (see
 *     [[pdh_social_webview_deeplink_cookie_capture]]).
 */
class A8DouyinE2ETest {

    @Test
    @Ignore("Manual: see docs/design/A8_Douyin_E2E_Plan.md §1 first-login happy path")
    fun firstLoginSuccess(): Unit = TODO("Manual scenario 1")

    @Test
    @Ignore("Manual: see docs/design/A8_Douyin_E2E_Plan.md §2 sync profile success")
    fun syncProfileSuccess(): Unit = TODO("Manual scenario 2")

    @Test
    @Ignore("Manual: see docs/design/A8_Douyin_E2E_Plan.md §3 cookie expired status_code 2154")
    fun cookieExpired(): Unit = TODO("Manual scenario 3")

    @Test
    @Ignore("Manual: see docs/design/A8_Douyin_E2E_Plan.md §4 anti-spider 412")
    fun antiSpider412(): Unit = TODO("Manual scenario 4")

    @Test
    @Ignore("Manual: see docs/design/A8_Douyin_E2E_Plan.md §5 WebView cancel login")
    fun webViewCancelLogin(): Unit = TODO("Manual scenario 5")

    @Test
    @Ignore("Manual: see docs/design/A8_Douyin_E2E_Plan.md §6 repeated sync idempotency")
    fun repeatedSyncIdempotent(): Unit = TODO("Manual scenario 6")

    @Test
    @Ignore("Manual: see docs/design/A8_Douyin_E2E_Plan.md §7 keystore corruption")
    fun keystoreCorruption(): Unit = TODO("Manual scenario 7")

    @Test
    @Ignore("Manual: see docs/design/A8_Douyin_E2E_Plan.md §8 logout + re-login")
    fun logoutAndReLogin(): Unit = TODO("Manual scenario 8")
}
