package com.chainlesschain.android.wear.tile

import com.chainlesschain.android.wear.sync.ApprovalRequest
import com.chainlesschain.android.wear.sync.WearApprovalStore
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/**
 * v1.2 #20 P0.2 Wear Phase 3 — complication helper + store integration smoke。
 *
 * SuspendingComplicationDataSourceService 同样依赖 androidx.wear.watchface
 * 内部 framework 类，JVM unit-test 实例化会 NoClassDefFound。这里仅验：
 *   - componentName helper 构造正确 ComponentName
 *   - 类加载成功 = manifest android:name 与 package 匹配
 *   - WearApprovalStore 与 complication 共享状态 (间接测)
 *
 * 真 ComplicationRequest 路径走 instrumented test。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class PendingApprovalsComplicationServiceTest {

    @After
    fun reset() {
        WearApprovalStore.clear()
    }

    private fun req(id: String) = ApprovalRequest(
        id = id,
        kind = "multisig.purchase",
        title = "t",
        summary = "s",
        createdAtMs = 1,
    )

    @Test
    fun `PendingApprovalsComplicationService class loads`() {
        val cls = Class.forName(
            "com.chainlesschain.android.wear.tile.PendingApprovalsComplicationService",
        )
        assertNotNull(cls)
    }

    @Test
    fun `componentName helper builds expected ComponentName`() {
        val cn = PendingApprovalsComplicationService.componentName("com.example.test")
        assertEquals("com.example.test", cn.packageName)
        assertEquals(PendingApprovalsComplicationService::class.java.name, cn.className)
    }

    @Test
    fun `componentName uses real wear-app package name`() {
        // 实际生产用 application 的 packageName ("com.chainlesschain.android"
        // / .debug)，complication source 名带 .wear.tile. 前缀
        val cn = PendingApprovalsComplicationService.componentName("com.chainlesschain.android")
        assertEquals("com.chainlesschain.android", cn.packageName)
        assertEquals(
            "com.chainlesschain.android.wear.tile.PendingApprovalsComplicationService",
            cn.className,
        )
    }

    @Test
    fun `store-driven count is what complication will surface`() {
        assertEquals(0, WearApprovalStore.pendingCount())
        WearApprovalStore.upsert(req("a"))
        WearApprovalStore.upsert(req("b"))
        assertEquals(2, WearApprovalStore.pendingCount())
    }
}
