package com.chainlesschain.android.pdh

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * §3.5.16 跨设备操作纯逻辑测试:设备授权 / 目标解析(未授权回退本机)/ 只读判定 /
 * 入站确认策略 / 跨设备事务双端确认。
 */
class PdhCrossDeviceTest {

    private val paired = setOf("desktop", "tablet")

    @Test
    fun authorized_only_for_paired() {
        assertTrue(PdhCrossDevice.isAuthorizedDevice("desktop", paired))
        assertFalse(PdhCrossDevice.isAuthorizedDevice("stranger", paired))
        assertFalse(PdhCrossDevice.isAuthorizedDevice(null, paired))
        assertFalse(PdhCrossDevice.isAuthorizedDevice("", paired))
    }

    @Test
    fun resolve_target_defaults_self() {
        assertEquals("self", PdhCrossDevice.resolveTarget(null, "self", paired))
        assertEquals("self", PdhCrossDevice.resolveTarget("self", "self", paired))
    }

    @Test
    fun resolve_target_paired_device() {
        assertEquals("desktop", PdhCrossDevice.resolveTarget("desktop", "self", paired))
    }

    @Test
    fun resolve_target_unauthorized_falls_back_to_self() {
        // 选了未配对设备 → 回退本机(不静默驱动陌生设备)
        assertEquals("self", PdhCrossDevice.resolveTarget("stranger", "self", paired))
    }

    @Test
    fun read_only_tools() {
        for (t in listOf("query_vault", "search", "run_analysis", "data_overview", "list_collectors", "pdh_ping")) {
            assertTrue(PdhCrossDevice.isReadOnly(t), "read-only: $t")
        }
    }

    @Test
    fun side_effect_tools_not_read_only() {
        for (t in listOf("collect_app_data", "salvage_app_data", "read_file_content", "send_message", "make_call")) {
            assertFalse(PdhCrossDevice.isReadOnly(t), "side-effect: $t")
        }
    }

    @Test
    fun inbound_confirm_for_side_effects_only() {
        // 远端驱动本机:只读免打扰,有副作用必须本机确认
        assertFalse(PdhCrossDevice.inboundNeedsLocalConfirm("query_vault"))
        assertTrue(PdhCrossDevice.inboundNeedsLocalConfirm("collect_app_data"))
        assertTrue(PdhCrossDevice.inboundNeedsLocalConfirm("send_message"))
    }

    @Test
    fun cross_device_txn_double_confirm() {
        assertTrue(PdhCrossDevice.crossDeviceTxnNeedsDoubleConfirm())
    }
}
