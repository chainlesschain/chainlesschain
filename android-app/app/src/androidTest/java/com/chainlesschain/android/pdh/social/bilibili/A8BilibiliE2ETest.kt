package com.chainlesschain.android.pdh.social.bilibili

import org.junit.Ignore
import org.junit.Test

/**
 * A8 v0.1 真机 E2E test stubs.
 *
 * **All tests are @Ignore'd** — they require:
 *   1. Real Bilibili account credentials (cannot embed in CI)
 *   2. Real Android device with the APK installed
 *   3. In-APK cc bundle containing social-bilibili adapter (waits on PDH 0.2.2
 *      publish + node-runtime-bundle.yml rebuild)
 *   4. Mac/Linux dev box (Win lacks adb + Android SDK)
 *
 * Test bodies use `TODO("see docs/design/A8_Bilibili_E2E_Plan.md §<N>")` so
 * each stub points to the manual test script for the matching scenario.
 * The pattern mirrors core-e2ee androidTest stubs landed 2026-05-21:
 * `@Ignore` skips runtime but the `TODO()` body still type-checks, which
 * keeps the file compile-clean even though the test isn't runnable.
 *
 * To activate when ready: drop `@Ignore`, replace TODO with a runner that
 * orchestrates: install APK → adb intent to open PDH → WebView interaction
 * via UI Automator (login is manual — supply test account creds via secure
 * test-only Hilt module).
 */
class A8BilibiliE2ETest {

    @Test
    @Ignore("Manual: see docs/design/A8_Bilibili_E2E_Plan.md §1 first-login happy path")
    fun firstLoginSuccess(): Unit = TODO("Manual scenario 1")

    @Test
    @Ignore("Manual: see docs/design/A8_Bilibili_E2E_Plan.md §2 sync 4 kinds")
    fun syncFourKindsSuccess(): Unit = TODO("Manual scenario 2")

    @Test
    @Ignore("Manual: see docs/design/A8_Bilibili_E2E_Plan.md §3 cookie expired")
    fun cookieExpired(): Unit = TODO("Manual scenario 3")

    @Test
    @Ignore("Manual: see docs/design/A8_Bilibili_E2E_Plan.md §4 WebView cancel login")
    fun webViewCancelLogin(): Unit = TODO("Manual scenario 4")

    @Test
    @Ignore("Manual: see docs/design/A8_Bilibili_E2E_Plan.md §5 partial API failure")
    fun partialApiFailure(): Unit = TODO("Manual scenario 5")

    @Test
    @Ignore("Manual: see docs/design/A8_Bilibili_E2E_Plan.md §6 repeated sync idempotency")
    fun repeatedSyncIdempotent(): Unit = TODO("Manual scenario 6")

    @Test
    @Ignore("Manual: see docs/design/A8_Bilibili_E2E_Plan.md §7 keystore corruption")
    fun keystoreCorruption(): Unit = TODO("Manual scenario 7")

    @Test
    @Ignore("Manual: see docs/design/A8_Bilibili_E2E_Plan.md §8 logout + re-login")
    fun logoutAndReLogin(): Unit = TODO("Manual scenario 8")
}
