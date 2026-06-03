package com.chainlesschain.android.wear.tile

import com.chainlesschain.android.wear.sync.ApprovalRequest
import com.chainlesschain.android.wear.sync.WearApprovalStore
import org.junit.After
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * v1.2 #20 P0.2 Wear Phase 3 — Tile constants + store integration smoke。
 *
 * 真 Tile rendering 需要 `com.google.wear.services.tiles.TileInstance` 类
 * (instrumented test 才有，JVM 单测无)，所以这里仅验：
 *   - Tile-related constants 是 Phase 3 锁定的值 (RESOURCE_VERSION + freshness)
 *   - WearApprovalStore 与 tile 共享同一状态 — store 改动后 pendingCount/
 *     latest 反映入 tile 渲染层（间接验，避免 Robolectric 装 TileService）
 *   - 类加载成功 = manifest android:name 与 package 匹配
 *
 * Tile rendering 行为 / layout 完整测试走 instrumented test (Phase 3 follow-up)。
 */
class PendingApprovalsTileServiceTest {

    @After
    fun reset() {
        WearApprovalStore.clear()
    }

    private fun mkReq(id: String, title: String) = ApprovalRequest(
        id = id,
        kind = "multisig.purchase",
        title = title,
        summary = "s",
        createdAtMs = 1,
    )

    @Test
    fun `RESOURCE_VERSION is exported and version 1`() {
        assertEquals("1", PendingApprovalsTileService.RESOURCE_VERSION)
    }

    @Test
    fun `FRESHNESS_INTERVAL_MS is 5 minutes`() {
        assertEquals(5 * 60 * 1000L, PendingApprovalsTileService.FRESHNESS_INTERVAL_MS)
    }

    @Test
    fun `PendingApprovalsTileService class loads`() {
        val cls = Class.forName(
            "com.chainlesschain.android.wear.tile.PendingApprovalsTileService",
        )
        assertNotNull(cls)
    }

    @Test
    fun `tile reads pending count from store - empty`() {
        // Tile.buildTile 直接调用 WearApprovalStore.pendingCount()。验证 store 在
        // empty 时返 0 (上游 tile render 走 "无待审批" 文案分支)。
        assertEquals(0, WearApprovalStore.pendingCount())
    }

    @Test
    fun `tile reads pending count from store - multiple items`() {
        WearApprovalStore.upsert(mkReq("a", "Approve A"))
        WearApprovalStore.upsert(mkReq("b", "Approve B"))
        WearApprovalStore.upsert(mkReq("c", "Approve C"))
        assertEquals(3, WearApprovalStore.pendingCount())
        val latest = WearApprovalStore.requests.value.firstOrNull()
        assertNotNull(latest)
        assertTrue(listOf("Approve A", "Approve B", "Approve C").contains(latest.title))
    }
}
