package com.chainlesschain.android.wear

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/**
 * v1.2 #20 P0.2 Wear Phase 0 — 编译期 smoke 测。
 *
 * Phase 0 Compose preview 走 androidTest（device-render）— 主线单测里仅验
 * activity 类 + composable 引用可解析（防 manifest android:name 与代码漂移）。
 *
 * Phase 1+ 接业务逻辑后增 Robolectric Wear-compose 行为测；当前仅"能加载
 * + 类名匹配 manifest" 一层。
 */
class WearMainScreenTest {

    @Test
    fun `WearMainActivity class loads`() {
        val cls = Class.forName("com.chainlesschain.android.wear.WearMainActivity")
        assertNotNull(cls)
    }

    @Test
    fun `WearApplication class loads`() {
        val cls = Class.forName("com.chainlesschain.android.wear.WearApplication")
        assertNotNull(cls)
    }

    @Test
    fun `WearMainActivity has expected package`() {
        val cls = Class.forName("com.chainlesschain.android.wear.WearMainActivity")
        assertEquals("com.chainlesschain.android.wear", cls.`package`?.name)
    }

    @Test
    fun `applicationId matches phone module (data layer pairing requirement)`() {
        // Wearable Data Layer 通过 applicationId 匹配 phone/watch pair；
        // 这是 Phase 1 起 MessageClient.sendMessage 能找到对端的硬约束。
        // 实际值定义在 build.gradle.kts; 这里检 BuildConfig 是否被生成。
        assertNotNull(BuildConfig.APPLICATION_ID)
        // debug suffix 不影响 data layer pairing — Google Services 用 base
        // applicationId 字段（versionCode 也无关）。release / debug 都行。
        assertEquals(true, BuildConfig.APPLICATION_ID.startsWith("com.chainlesschain.android"))
    }
}
