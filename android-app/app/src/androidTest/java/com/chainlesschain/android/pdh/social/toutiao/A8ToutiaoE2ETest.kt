package com.chainlesschain.android.pdh.social.toutiao

import org.junit.Ignore
import org.junit.Test

/**
 * A8 v0.2 真机 E2E test stubs for 今日头条.
 *
 * **All tests are @Ignore'd** — they require:
 *   1. Real toutiao.com account credentials (cannot embed in CI)
 *   2. Real Android device with the APK installed
 *   3. In-APK cc bundle containing social-toutiao adapter (PDH ≥ 0.3.0)
 *   4. Mac/Linux dev box (Win lacks adb + Android SDK)
 *   5. Charles / mitmproxy for 412 anti-spider scenario (4)
 *
 * Test bodies use `TODO("see docs/design/A8_Toutiao_E2E_Plan.md §<N>")` so
 * each stub points to the manual test script. Pattern mirrors
 * [com.chainlesschain.android.pdh.social.douyin.A8DouyinE2ETest] (v0.2
 * profile-only template).
 *
 * v0.2 surface = profile-only via ByteDance unsigned passport endpoint
 * `/passport/account/info/v2/?aid=24` (Douyin uses aid=2906, same shape).
 * `_signature` signing is v0.3 — history/collection/search scenarios will
 * land once acrawler.js port is wired.
 *
 * Surface vs Douyin:
 *   - Same passport endpoint shape but aid=24 (Toutiao web client id)
 *   - Same 5 lastErrorCode branches (-4 / -5 / -6 / -7 / status_code!=0)
 *   - cookie field differs: passport_uid / multi_sids (Toutiao) vs
 *     sessionid (Douyin) — both ByteDance-issued though
 *   - No deep-link login (Toutiao web SSO is in-page; Douyin uses
 *     `snssdk1128://` to native app)
 */
class A8ToutiaoE2ETest {

    @Test
    @Ignore("Manual: see docs/design/A8_Toutiao_E2E_Plan.md §1 first-login happy path")
    fun firstLoginSuccess(): Unit = TODO("Manual scenario 1")

    @Test
    @Ignore("Manual: see docs/design/A8_Toutiao_E2E_Plan.md §2 sync profile success")
    fun syncProfileSuccess(): Unit = TODO("Manual scenario 2")

    @Test
    @Ignore("Manual: see docs/design/A8_Toutiao_E2E_Plan.md §3 cookie expired status_code 2154")
    fun cookieExpired(): Unit = TODO("Manual scenario 3")

    @Test
    @Ignore("Manual: see docs/design/A8_Toutiao_E2E_Plan.md §4 anti-spider 412")
    fun antiSpider412(): Unit = TODO("Manual scenario 4")

    @Test
    @Ignore("Manual: see docs/design/A8_Toutiao_E2E_Plan.md §5 WebView cancel login")
    fun webViewCancelLogin(): Unit = TODO("Manual scenario 5")

    @Test
    @Ignore("Manual: see docs/design/A8_Toutiao_E2E_Plan.md §6 repeated sync idempotency")
    fun repeatedSyncIdempotent(): Unit = TODO("Manual scenario 6")

    @Test
    @Ignore("Manual: see docs/design/A8_Toutiao_E2E_Plan.md §7 keystore corruption")
    fun keystoreCorruption(): Unit = TODO("Manual scenario 7")

    @Test
    @Ignore("Manual: see docs/design/A8_Toutiao_E2E_Plan.md §8 logout + re-login")
    fun logoutAndReLogin(): Unit = TODO("Manual scenario 8")
}
