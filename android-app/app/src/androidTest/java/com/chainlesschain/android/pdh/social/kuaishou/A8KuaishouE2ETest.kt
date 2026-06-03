package com.chainlesschain.android.pdh.social.kuaishou

import org.junit.Ignore
import org.junit.Test

/**
 * A8 v0.2 真机 E2E test stubs for 快手.
 *
 * **All tests are @Ignore'd** — they require:
 *   1. Real kuaishou.com account credentials (cannot embed in CI)
 *   2. Real Android device with the APK installed
 *   3. In-APK cc bundle containing social-kuaishou adapter (PDH ≥ 0.3.0)
 *   4. Mac/Linux dev box (Win lacks adb + Android SDK)
 *   5. (Scenarios 3 / 4 / 7) root shell to edit EncryptedSharedPreferences
 *
 * Test bodies use `TODO("see docs/design/A8_Kuaishou_E2E_Plan.md §<N>")`.
 * Pattern mirrors [com.chainlesschain.android.pdh.social.douyin.A8DouyinE2ETest]
 * (v0.2 profile-only template) but with **no HTTP / no network** —
 * fetchProfile is pure cookie-parse of `kuaishou.web.cp.api_ph`.
 *
 * Surface vs Douyin / Toutiao:
 *   - **No HTTP fetch** in v0.2: profile comes from URL-encoded JSON inside
 *     the api_ph cookie field (set by passport at login time). Anti-spider
 *     412 and other HTTP-level scenarios are NOT applicable in v0.2.
 *   - **2 distinct missing-data branches**: -8 (cookie has no api_ph at all,
 *     e.g. QR-login path) vs -9 (api_ph present but decoded value is not
 *     JSON, e.g. base64-rotated by future kuaishou release).
 *   - **One-tap login is recommended** over QR scan — QR scan may skip
 *     api_ph cookie write (see [[pdh_social_webview_deeplink_cookie_capture]]).
 *
 * v0.3 will add NS_sig3-signed GraphQL scenarios (watch/collect/search/
 * counts). Until then, fetchProfile is sync (cookie-parse).
 */
class A8KuaishouE2ETest {

    @Test
    @Ignore("Manual: see docs/design/A8_Kuaishou_E2E_Plan.md §1 first-login happy path (一键登录)")
    fun firstLoginSuccess(): Unit = TODO("Manual scenario 1")

    @Test
    @Ignore("Manual: see docs/design/A8_Kuaishou_E2E_Plan.md §2 sync profile success (cookie-parse)")
    fun syncProfileSuccess(): Unit = TODO("Manual scenario 2")

    @Test
    @Ignore("Manual: see docs/design/A8_Kuaishou_E2E_Plan.md §3 cookie missing api_ph (-8)")
    fun cookieMissingApiPh(): Unit = TODO("Manual scenario 3")

    @Test
    @Ignore("Manual: see docs/design/A8_Kuaishou_E2E_Plan.md §4 api_ph non-JSON (-9)")
    fun apiPhNonJson(): Unit = TODO("Manual scenario 4")

    @Test
    @Ignore("Manual: see docs/design/A8_Kuaishou_E2E_Plan.md §5 WebView cancel login")
    fun webViewCancelLogin(): Unit = TODO("Manual scenario 5")

    @Test
    @Ignore("Manual: see docs/design/A8_Kuaishou_E2E_Plan.md §6 repeated sync idempotency")
    fun repeatedSyncIdempotent(): Unit = TODO("Manual scenario 6")

    @Test
    @Ignore("Manual: see docs/design/A8_Kuaishou_E2E_Plan.md §7 keystore corruption")
    fun keystoreCorruption(): Unit = TODO("Manual scenario 7")

    @Test
    @Ignore("Manual: see docs/design/A8_Kuaishou_E2E_Plan.md §8 logout + re-login")
    fun logoutAndReLogin(): Unit = TODO("Manual scenario 8")
}
