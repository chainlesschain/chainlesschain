package com.chainlesschain.android.feature.familyguard.domain.merger

import com.chainlesschain.android.feature.familyguard.domain.model.permissions.CompanionSummaryAccess
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.FamilyPermissions
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.PermissionTemplates
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.QuietHourWindow
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * FAMILY-17 验收: 5 ticket 场景 + 边界. 全 pure 单测; 无 IO / 无 mock。
 *
 * Ticket 验收 5 场景:
 *   1. app_time_limit 取最严 (min daily_max_sec, 最窄 window)
 *   2. payment_cap 取最严 (min per_day / per_month / threshold)
 *   3. app_blocklist 并集
 *   4. permissions 取最严 (bool AND / level min / companion NEVER 赢)
 *   5. approval 一票否决
 */
class RuleMergerTest {

    // ─── 场景 1: AppTimeLimit ───

    @Test
    fun `scenario 1 mergeAppTimeLimit picks min dailyMaxSec`() {
        val dad = AppTimeLimitConfig(
            packageName = "com.tencent.tmgp.sgame",
            dailyMaxSec = 3600, // 1h
        )
        val mom = AppTimeLimitConfig(
            packageName = "com.tencent.tmgp.sgame",
            dailyMaxSec = 1800, // 30min — 更严
        )
        val merged = RuleMerger.mergeAppTimeLimit(listOf(dad, mom))
        assertNotNull(merged)
        assertEquals(1800, merged.dailyMaxSec)
    }

    @Test
    fun `mergeAppTimeLimit picks narrowest window from intersecting`() {
        val dad = AppTimeLimitConfig(
            packageName = "com.x",
            dailyMaxSec = 7200,
            weekdayWindow = TimeWindow(start = "16:00", end = "21:00"), // 16-21
        )
        val mom = AppTimeLimitConfig(
            packageName = "com.x",
            dailyMaxSec = 7200,
            weekdayWindow = TimeWindow(start = "17:00", end = "20:00"), // 17-20 (更窄)
        )
        val merged = RuleMerger.mergeAppTimeLimit(listOf(dad, mom))
        assertNotNull(merged)
        // 交集: max start 17:00, min end 20:00 → 17:00-20:00
        assertEquals("17:00", merged.weekdayWindow?.start)
        assertEquals("20:00", merged.weekdayWindow?.end)
    }

    @Test
    fun `mergeAppTimeLimit window without overlap falls back to first window`() {
        val dad = AppTimeLimitConfig(
            packageName = "com.x",
            dailyMaxSec = 3600,
            weekdayWindow = TimeWindow(start = "08:00", end = "10:00"),
        )
        val mom = AppTimeLimitConfig(
            packageName = "com.x",
            dailyMaxSec = 3600,
            weekdayWindow = TimeWindow(start = "20:00", end = "22:00"),
        )
        val merged = RuleMerger.mergeAppTimeLimit(listOf(dad, mom))
        assertNotNull(merged)
        // 无重叠 → 保留第一个 (fallback)
        assertEquals("08:00", merged.weekdayWindow?.start)
    }

    @Test
    fun `mergeAppTimeLimit empty list returns null`() {
        assertNull(RuleMerger.mergeAppTimeLimit(emptyList()))
    }

    @Test
    fun `mergeAppTimeLimit single-element passes through unchanged`() {
        val one = AppTimeLimitConfig(packageName = "com.x", dailyMaxSec = 1234)
        assertEquals(one, RuleMerger.mergeAppTimeLimit(listOf(one)))
    }

    @Test
    fun `mergeAppTimeLimit different package throws`() {
        val a = AppTimeLimitConfig(packageName = "com.x", dailyMaxSec = 1000)
        val b = AppTimeLimitConfig(packageName = "com.y", dailyMaxSec = 1000)
        assertFailsWithType<IllegalArgumentException> {
            RuleMerger.mergeAppTimeLimit(listOf(a, b))
        }
    }

    // ─── 场景 2: PaymentCap ───

    @Test
    fun `scenario 2 mergePaymentCap picks min for all three caps`() {
        val dad = PaymentCapConfig(perDay = 100.0, perMonth = 500.0, perTxApprovalThreshold = 50.0)
        val mom = PaymentCapConfig(perDay = 50.0, perMonth = 1000.0, perTxApprovalThreshold = 10.0)
        val merged = RuleMerger.mergePaymentCap(listOf(dad, mom))
        assertNotNull(merged)
        assertEquals(50.0, merged.perDay)
        assertEquals(500.0, merged.perMonth)
        assertEquals(10.0, merged.perTxApprovalThreshold)
    }

    @Test
    fun `mergePaymentCap empty list returns null`() {
        assertNull(RuleMerger.mergePaymentCap(emptyList()))
    }

    // ─── 场景 3: AppBlocklist (并集) ───

    @Test
    fun `scenario 3 mergeAppBlocklist returns union with dedup`() {
        val dad = AppBlocklistConfig(packages = listOf("com.a", "com.b"))
        val mom = AppBlocklistConfig(packages = listOf("com.b", "com.c"))
        val grandma = AppBlocklistConfig(packages = listOf("com.c", "com.d"))
        val merged = RuleMerger.mergeAppBlocklist(listOf(dad, mom, grandma))
        // 顺序 LinkedHashSet 保持首次出现
        assertEquals(listOf("com.a", "com.b", "com.c", "com.d"), merged.packages)
    }

    @Test
    fun `mergeAppBlocklist empty list returns empty packages`() {
        val merged = RuleMerger.mergeAppBlocklist(emptyList())
        assertTrue(merged.packages.isEmpty())
    }

    // ─── 场景 4: Permissions ───

    @Test
    fun `scenario 4 mergePermissions takes AND of all bool flags`() {
        val dad = FamilyPermissions(allowMessage = true, allowVideoCall = true, allowRuleEdit = true)
        val mom = FamilyPermissions(allowMessage = true, allowVideoCall = false, allowRuleEdit = true)
        val merged = RuleMerger.mergePermissions(listOf(dad, mom))
        assertNotNull(merged)
        assertTrue(merged.allowMessage)
        assertFalse(merged.allowVideoCall) // 任一 false → false
        assertTrue(merged.allowRuleEdit)
    }

    @Test
    fun `mergePermissions takes min TelemetryLevel`() {
        val dad = FamilyPermissions(telemetryLevel = TelemetryLevel.L3)
        val mom = FamilyPermissions(telemetryLevel = TelemetryLevel.L1)
        val merged = RuleMerger.mergePermissions(listOf(dad, mom))
        assertEquals(TelemetryLevel.L1, merged?.telemetryLevel)
    }

    @Test
    fun `mergePermissions companion NEVER wins over STATS_ONLY`() {
        val dad = FamilyPermissions(allowCompanionSummary = CompanionSummaryAccess.STATS_ONLY)
        val mom = FamilyPermissions(allowCompanionSummary = CompanionSummaryAccess.NEVER)
        val merged = RuleMerger.mergePermissions(listOf(dad, mom))
        assertEquals(CompanionSummaryAccess.NEVER, merged?.allowCompanionSummary)
    }

    @Test
    fun `mergePermissions takes union of telemetry blocklist`() {
        val dad = FamilyPermissions(telemetryAppsBlocklist = listOf("com.a", "com.b"))
        val mom = FamilyPermissions(telemetryAppsBlocklist = listOf("com.b", "com.c"))
        val merged = RuleMerger.mergePermissions(listOf(dad, mom))
        assertEquals(listOf("com.a", "com.b", "com.c"), merged?.telemetryAppsBlocklist)
    }

    @Test
    fun `mergePermissions quiet_hours uses union`() {
        val dad = FamilyPermissions(
            telemetryQuietHours = listOf(QuietHourWindow(start = "20:00", end = "21:00")),
        )
        val mom = FamilyPermissions(
            telemetryQuietHours = listOf(QuietHourWindow(start = "21:00", end = "22:00")),
        )
        val merged = RuleMerger.mergePermissions(listOf(dad, mom))
        assertEquals(2, merged?.telemetryQuietHours?.size)
    }

    @Test
    fun `mergePermissions takes max quietHoursMaxPerDayMin (孩子端隐私上限放宽)`() {
        val dad = FamilyPermissions(_quietHoursMaxPerDayMin = 120)
        val mom = FamilyPermissions(_quietHoursMaxPerDayMin = 240)
        val merged = RuleMerger.mergePermissions(listOf(dad, mom))
        assertEquals(240, merged?._quietHoursMaxPerDayMin)
    }

    @Test
    fun `mergePermissions 3 templates produces all-strict result`() {
        val parent = PermissionTemplates.forParentToChild()
        val guardian = PermissionTemplates.forGuardianSecondaryToChild()
        val merged = RuleMerger.mergePermissions(listOf(parent, guardian))
        assertNotNull(merged)
        // parent.allowRuleEdit=true, guardian.allowRuleEdit=false → false
        assertFalse(merged.allowRuleEdit)
        // parent.allowSilentObserve=true, guardian.allowSilentObserve=false → false
        assertFalse(merged.allowSilentObserve)
        // 都 true → true
        assertTrue(merged.allowSosReceive)
        assertTrue(merged.allowPaymentVeto)
    }

    @Test
    fun `mergePermissions empty list returns null`() {
        assertNull(RuleMerger.mergePermissions(emptyList()))
    }

    @Test
    fun `mergePermissions single-element passes through unchanged`() {
        val one = PermissionTemplates.forParentToChild()
        assertEquals(one, RuleMerger.mergePermissions(listOf(one)))
    }

    // ─── 场景 5: Approval voting (一票否决) ───

    @Test
    fun `scenario 5 aggregateApprovals any-reject yields reject`() {
        assertFalse(RuleMerger.aggregateApprovals(listOf(true, true, false))!!)
        assertFalse(RuleMerger.aggregateApprovals(listOf(false, true))!!)
        assertFalse(RuleMerger.aggregateApprovals(listOf(false))!!)
    }

    @Test
    fun `aggregateApprovals all-approve yields approve`() {
        assertTrue(RuleMerger.aggregateApprovals(listOf(true, true, true))!!)
        assertTrue(RuleMerger.aggregateApprovals(listOf(true))!!)
    }

    @Test
    fun `aggregateApprovals empty list returns null (no votes)`() {
        assertNull(RuleMerger.aggregateApprovals(emptyList()))
    }

    // ─── TimeWindow 边界 ───

    @Test
    fun `narrowestWindow with cross-midnight falls back to first`() {
        // 21:00-06:00 跨午夜 → 简化 fallback
        val w1 = TimeWindow(start = "21:00", end = "06:00")
        val w2 = TimeWindow(start = "10:00", end = "12:00")
        val narrow = RuleMerger.narrowestWindow(listOf(w1, w2))
        // 任一跨午夜 → 保留第一个
        assertEquals(w1, narrow)
    }

    @Test
    fun `narrowestWindow empty returns null`() {
        assertNull(RuleMerger.narrowestWindow(emptyList()))
    }

    // ─── helpers ───

    private inline fun <reified T : Throwable> assertFailsWithType(block: () -> Unit) {
        try {
            block()
            error("Expected ${T::class.simpleName} but no exception was thrown")
        } catch (t: Throwable) {
            if (t !is T) throw t
        }
    }
}
