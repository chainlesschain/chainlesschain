package com.chainlesschain.android.pdh

import com.chainlesschain.android.pdh.PdhResourceBudget.Device
import com.chainlesschain.android.pdh.PdhResourceBudget.Settings
import com.chainlesschain.android.pdh.PdhResourceBudget.Weight
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * §3.5.20 资源预算纯决策测试:任务分级 / RUN_NOW·DEFER 各条件 / 现在跑警示 / 存储超限。
 */
class PdhResourceBudgetTest {

    @Test
    fun weight_classifies_heavy_tasks() {
        for (k in listOf("bulk_collect", "index_files", "ocr", "transcribe", "embed", "salvage", "collect_files")) {
            assertEquals(Weight.HEAVY, PdhResourceBudget.weightOf(k), "heavy: $k")
        }
    }

    @Test
    fun weight_classifies_light_tasks() {
        assertEquals(Weight.LIGHT, PdhResourceBudget.weightOf("query_vault"))
        assertEquals(Weight.LIGHT, PdhResourceBudget.weightOf("collect_system_data"))
        assertEquals(Weight.LIGHT, PdhResourceBudget.weightOf(null))
    }

    private val s = Settings()  // wifiOnly=true, minBattery=20, cap=2048

    @Test
    fun light_runs_now_regardless() {
        val d = Device(charging = false, batteryPercent = 5, onWifi = false)
        assertFalse(PdhResourceBudget.decide(Weight.LIGHT, d, s).deferred)
    }

    @Test
    fun heavy_defers_off_wifi_when_wifi_only() {
        val d = Device(charging = true, batteryPercent = 90, onWifi = false)
        val dec = PdhResourceBudget.decide(Weight.HEAVY, d, s)
        assertTrue(dec.deferred)
        assertTrue(dec.reason.contains("WiFi"))
    }

    @Test
    fun heavy_defers_low_battery_not_charging() {
        val d = Device(charging = false, batteryPercent = 10, onWifi = true)
        val dec = PdhResourceBudget.decide(Weight.HEAVY, d, s)
        assertTrue(dec.deferred)
        assertTrue(dec.reason.contains("电量"))
    }

    @Test
    fun heavy_runs_now_when_charging_and_wifi() {
        val d = Device(charging = true, batteryPercent = 50, onWifi = true)
        assertFalse(PdhResourceBudget.decide(Weight.HEAVY, d, s).deferred)
    }

    @Test
    fun heavy_defers_by_default_when_conditions_partial() {
        // WiFi ok, battery ok, but not charging → default defer to ideal window.
        val d = Device(charging = false, batteryPercent = 80, onWifi = true)
        assertTrue(PdhResourceBudget.decide(Weight.HEAVY, d, s).deferred)
    }

    @Test
    fun wifi_only_off_allows_cellular() {
        val d = Device(charging = true, batteryPercent = 90, onWifi = false)
        val lenient = Settings(wifiOnly = false)
        assertFalse(PdhResourceBudget.decide(Weight.HEAVY, d, lenient).deferred)
    }

    @Test
    fun force_run_warning_lists_costs() {
        assertEquals(
            "现在执行:将用移动数据、将耗电",
            PdhResourceBudget.forceRunWarning(Device(false, 50, false), s),
        )
        assertNotNull(PdhResourceBudget.forceRunWarning(Device(true, 50, false), s)) // cellular only
        assertNull(PdhResourceBudget.forceRunWarning(Device(true, 50, true), s)) // charging+wifi → no cost
    }

    @Test
    fun storage_over_cap() {
        assertTrue(PdhResourceBudget.storageOverCap(3000, s))
        assertFalse(PdhResourceBudget.storageOverCap(1000, s))
    }
}
