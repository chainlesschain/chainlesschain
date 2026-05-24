package com.chainlesschain.android.pdh.social

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 2026-05-24 — locks [dispatchExternalScheme] contract for `bilibili://`,
 * `snssdk1128://`, `xhsdiscover://`, `intent://` URI dispatch.
 *
 * 真机 E2E（手机上同时装着原生 App + ChainlessChain）走的是 WebViewClient.
 * shouldOverrideUrlLoading 路径，JVM 单测不能跑 WebView；这里直接测顶层
 * helper 的派发逻辑，保证：
 *   1. 自定义 scheme → 派发为 [Intent.ACTION_VIEW]，URI 透传
 *   2. `intent://` → 走 [Intent.parseUri]，最终 startActivity 拿到的 Intent
 *      action/scheme 由 parseUri 拆出，不是裸 ACTION_VIEW
 *   3. [ActivityNotFoundException]（原生 App 未装）被吞掉，返回 true
 *   4. null context 直接 swallow + return true（不 crash）
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class SocialCookieWebViewDispatchTest {

    @Test
    fun `bilibili scheme dispatches as ACTION_VIEW with raw URI`() {
        val ctx = mockk<Context>(relaxed = true)
        val intentSlot = slot<Intent>()
        every { ctx.startActivity(capture(intentSlot)) } returns Unit

        val handled = dispatchExternalScheme(
            ctx,
            Uri.parse("bilibili://video/BV1xx411c7mu"),
        )

        assertTrue(handled, "non-http scheme should always be marked handled")
        verify { ctx.startActivity(any()) }
        val captured = intentSlot.captured
        assertEquals(Intent.ACTION_VIEW, captured.action)
        assertEquals("bilibili", captured.data?.scheme)
        // FLAG_ACTIVITY_NEW_TASK 必带 — WebView attach 的是 Composable
        // context（Activity 本身但状态不可靠），不带 NEW_TASK 在 background
        // 启动可能抛 AndroidRuntimeException
        assertTrue(
            (captured.flags and Intent.FLAG_ACTIVITY_NEW_TASK) != 0,
            "FLAG_ACTIVITY_NEW_TASK must be set",
        )
    }

    @Test
    fun `intent URI is parsed via parseUri and dispatched`() {
        val ctx = mockk<Context>(relaxed = true)
        val intentSlot = slot<Intent>()
        every { ctx.startActivity(capture(intentSlot)) } returns Unit

        // 抖音 web 登录页常用的 intent:// 格式：唤起 snssdk1128 + fallback
        val handled = dispatchExternalScheme(
            ctx,
            Uri.parse(
                "intent://aweme/profile/0#Intent;scheme=snssdk1128;" +
                    "package=com.ss.android.ugc.aweme;end",
            ),
        )

        assertTrue(handled)
        verify { ctx.startActivity(any()) }
        val captured = intentSlot.captured
        // parseUri 应拆出 scheme = snssdk1128 而非 intent
        assertEquals("snssdk1128", captured.scheme)
        assertEquals("com.ss.android.ugc.aweme", captured.`package`)
    }

    @Test
    fun `ActivityNotFoundException is swallowed and still returns true`() {
        val ctx = mockk<Context>(relaxed = true)
        every { ctx.startActivity(any()) } throws ActivityNotFoundException(
            "no app handles xhsdiscover://",
        )

        val handled = dispatchExternalScheme(
            ctx,
            Uri.parse("xhsdiscover://item/abc123"),
        )

        // True 表示"我们尝试过了"，WebView 不再 loadUrl 这条 URI，避免
        // ERR_UNKNOWN_URL_SCHEME 错误页扰用户视线
        assertTrue(handled)
    }

    @Test
    fun `null context swallows without crashing`() {
        val handled = dispatchExternalScheme(
            null,
            Uri.parse("kwai://profile/123"),
        )
        // 罕见但理论可能（view?.context 在 detach 后为 null）
        assertTrue(handled)
    }

    @Test
    fun `SecurityException from startActivity is swallowed`() {
        val ctx = mockk<Context>(relaxed = true)
        every { ctx.startActivity(any()) } throws SecurityException(
            "permission denied",
        )

        val handled = dispatchExternalScheme(
            ctx,
            Uri.parse("snssdk143://user/login"),
        )
        // 兜底 Throwable 分支：crash 比 silent swallow 更糟（用户在登录中
        // 间 crash 整 app），所以选择吞 + log
        assertTrue(handled)
    }
}
