package com.chainlesschain.android.pdh.social.xiaohongshu

import org.junit.Ignore
import org.junit.Test

/**
 * A8 v0.2 真机 E2E test stubs for 小红书.
 *
 * **All tests are @Ignore'd** — they require:
 *   1. Real xiaohongshu.com account credentials (cannot embed in CI)
 *   2. Real Android device with the APK installed
 *   3. In-APK cc bundle containing social-xhs adapter (PDH ≥ 0.3.0)
 *   4. Mac/Linux dev box (Win lacks adb + Android SDK)
 *   5. Charles / mitmproxy for risk-control scenarios (3 + 6)
 *
 * Test bodies use `TODO("see docs/design/A8_Xhs_E2E_Plan.md §<N>")` so each
 * stub points to the manual test script for the matching scenario. Pattern
 * mirrors [A8BilibiliE2ETest] landed 2026-05-22: `@Ignore` skips runtime but
 * `TODO()` body keeps the file compile-clean.
 *
 * To activate when ready: drop `@Ignore`, replace TODO with a runner that
 * orchestrates: install APK → adb intent to open PDH → WebView interaction
 * via UI Automator (login is manual — supply test account creds via secure
 * test-only Hilt module).
 *
 * Surface differences from Bilibili E2E:
 *   - X-S / X-T signing per-fetcher (scenarios 3, 6 specifically test risk
 *     control / signature failure paths — Bilibili has WBI but it's stable)
 *   - 3 fetchers (notes / liked / follows) vs Bilibili's 4 (history /
 *     favourite / dynamic / follow). me endpoint is unsigned (acts like
 *     Douyin's passport).
 *   - a1 cookie is a separate persisted field (X-S input). Bilibili has no
 *     equivalent.
 */
class A8XhsE2ETest {

    @Test
    @Ignore("Manual: see docs/design/A8_Xhs_E2E_Plan.md §1 first-login happy path")
    fun firstLoginSuccess(): Unit = TODO("Manual scenario 1")

    @Test
    @Ignore("Manual: see docs/design/A8_Xhs_E2E_Plan.md §2 sync 3 kinds")
    fun syncThreeKindsSuccess(): Unit = TODO("Manual scenario 2")

    @Test
    @Ignore("Manual: see docs/design/A8_Xhs_E2E_Plan.md §3 X-S signature failure (-461 / code 460)")
    fun xsSignatureFailure(): Unit = TODO("Manual scenario 3")

    @Test
    @Ignore("Manual: see docs/design/A8_Xhs_E2E_Plan.md §4 cookie expired")
    fun cookieExpired(): Unit = TODO("Manual scenario 4")

    @Test
    @Ignore("Manual: see docs/design/A8_Xhs_E2E_Plan.md §5 WebView cancel login")
    fun webViewCancelLogin(): Unit = TODO("Manual scenario 5")

    @Test
    @Ignore("Manual: see docs/design/A8_Xhs_E2E_Plan.md §6 partial fetcher failure (one 5xx)")
    fun partialFetcherFailure(): Unit = TODO("Manual scenario 6")

    @Test
    @Ignore("Manual: see docs/design/A8_Xhs_E2E_Plan.md §7 repeated sync idempotency")
    fun repeatedSyncIdempotent(): Unit = TODO("Manual scenario 7")

    @Test
    @Ignore("Manual: see docs/design/A8_Xhs_E2E_Plan.md §8 keystore corruption")
    fun keystoreCorruption(): Unit = TODO("Manual scenario 8")

    @Test
    @Ignore("Manual: see docs/design/A8_Xhs_E2E_Plan.md §9 logout + re-login")
    fun logoutAndReLogin(): Unit = TODO("Manual scenario 9")
}
