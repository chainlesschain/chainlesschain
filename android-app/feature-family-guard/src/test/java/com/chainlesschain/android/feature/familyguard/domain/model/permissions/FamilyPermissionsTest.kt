package com.chainlesschain.android.feature.familyguard.domain.model.permissions

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * FAMILY-12 验收 — JSON round-trip + 3 默认模板字段值 + 校验。
 *
 * round-trip 是核心: serialize → string → deserialize 必须语义一致, 因为
 * permissions 列每次开 vault 都要 decode, 字段名漂移会导致历史数据丢字段。
 */
class FamilyPermissionsTest {

    // ─── Round-trip ───

    @Test
    fun `default constructor round-trips through JSON unchanged`() {
        val original = FamilyPermissions()
        val json = FamilyPermissions.encode(original)
        val decoded = FamilyPermissions.decode(json)
        assertEquals(original, decoded)
    }

    @Test
    fun `complex permissions round-trip preserves all 21 fields`() {
        val original = FamilyPermissions(
            telemetryLevel = TelemetryLevel.L3,
            telemetryAppsBlocklist = listOf("com.tencent.tmgp.sgame", "com.netease.party"),
            telemetryQuietHours = listOf(
                QuietHourWindow(start = "20:00", end = "21:00", weekdayOnly = true),
                QuietHourWindow(start = "23:30", end = "00:30"),
            ),
            _quietHoursMaxPerDayMin = 180,
            allowMessage = false,
            allowAudioCall = false,
            allowVideoCall = false,
            allowSilentObserve = true,
            allowForcePickup = true,
            allowRemoteView = true,
            allowRuleEdit = true,
            allowTaskAssign = true,
            allowAppDisable = true,
            allowAppHide = true,
            allowPaymentVeto = true,
            allowLocationView = true,
            allowGeofenceEdit = true,
            allowSosReceive = true,
            allowRewardGrant = true,
            allowCompanionSummary = CompanionSummaryAccess.NEVER,
            allowEmergencyUnbind = true,
        )
        val decoded = FamilyPermissions.decode(FamilyPermissions.encode(original))
        assertEquals(original, decoded)
    }

    @Test
    fun `encoded JSON uses snake_case SerialName not Kotlin camelCase`() {
        val json = FamilyPermissions.encode(FamilyPermissions())
        // 必须含 snake_case (主文档 §3.1 v0.2 JSON 字面值)
        assertTrue(json.contains("\"telemetry_level\""))
        assertTrue(json.contains("\"allow_silent_observe\""))
        assertTrue(json.contains("\"_quiet_hours_max_per_day_min\""))
        assertTrue(json.contains("\"allow_companion_summary\""))
        // 不应该有 Kotlin camelCase 名
        assertFalse(json.contains("\"telemetryLevel\""))
        assertFalse(json.contains("\"allowSilentObserve\""))
    }

    @Test
    fun `decoding JSON with unknown extra field tolerates ignoreUnknownKeys`() {
        val jsonWithExtra =
            """{"telemetry_level":"L2","unknown_future_field":42,"allow_call":false}"""
        val decoded = FamilyPermissions.decode(jsonWithExtra)
        assertEquals(TelemetryLevel.L2, decoded.telemetryLevel)
    }

    // ─── TelemetryLevel ordinal ───

    @Test
    fun `TelemetryLevel encompasses higher-level is true for self and lower`() {
        assertTrue(TelemetryLevel.L3.encompasses(TelemetryLevel.L0))
        assertTrue(TelemetryLevel.L3.encompasses(TelemetryLevel.L3))
        assertTrue(TelemetryLevel.L1.encompasses(TelemetryLevel.L0))
        assertFalse(TelemetryLevel.L1.encompasses(TelemetryLevel.L2))
        assertFalse(TelemetryLevel.L0.encompasses(TelemetryLevel.L1))
    }

    // ─── QuietHourWindow validation ───

    @Test
    fun `QuietHourWindow rejects malformed time`() {
        assertFailsWith<IllegalArgumentException> {
            QuietHourWindow(start = "25:00", end = "26:00")
        }
        assertFailsWith<IllegalArgumentException> {
            QuietHourWindow(start = "10:60", end = "11:00")
        }
        assertFailsWith<IllegalArgumentException> {
            QuietHourWindow(start = "abc", end = "10:00")
        }
    }

    @Test
    fun `QuietHourWindow durationMinutes basic`() {
        assertEquals(60, QuietHourWindow(start = "20:00", end = "21:00").durationMinutes())
        assertEquals(30, QuietHourWindow(start = "23:30", end = "00:00").durationMinutes())
    }

    @Test
    fun `QuietHourWindow durationMinutes cross-midnight`() {
        // 23:30 → 00:30 = 60 分 (跨午夜)
        assertEquals(60, QuietHourWindow(start = "23:30", end = "00:30").durationMinutes())
        // 22:00 → 06:00 = 8h = 480
        assertEquals(480, QuietHourWindow(start = "22:00", end = "06:00").durationMinutes())
    }

    // ─── 默认模板字段值 ───

    @Test
    fun `Parent-to-Child template enables typical 监管 capabilities`() {
        val p = PermissionTemplates.forParentToChild()
        assertEquals(TelemetryLevel.L1, p.telemetryLevel)
        assertTrue(p.allowMessage)
        assertTrue(p.allowVideoCall)
        assertTrue(p.allowSilentObserve)
        assertFalse(p.allowForcePickup) // 紧急配额, 默认关
        assertFalse(p.allowRemoteView)
        assertTrue(p.allowRuleEdit)
        assertTrue(p.allowTaskAssign)
        assertFalse(p.allowAppDisable) // 强档默认关
        assertFalse(p.allowAppHide)
        assertTrue(p.allowPaymentVeto)
        assertTrue(p.allowLocationView)
        assertTrue(p.allowGeofenceEdit)
        assertTrue(p.allowSosReceive)
        assertTrue(p.allowRewardGrant)
        assertEquals(CompanionSummaryAccess.STATS_ONLY, p.allowCompanionSummary)
        assertFalse(p.allowEmergencyUnbind) // child→parent 方向才用
    }

    @Test
    fun `Child-to-Parent template is restrictive but allows SOS and emergency unbind`() {
        val p = PermissionTemplates.forChildToParent()
        assertEquals(TelemetryLevel.L0, p.telemetryLevel)
        assertTrue(p.allowMessage)
        assertTrue(p.allowAudioCall)
        assertTrue(p.allowVideoCall)
        assertFalse(p.allowSilentObserve)
        assertFalse(p.allowRuleEdit)
        assertFalse(p.allowTaskAssign)
        assertFalse(p.allowPaymentVeto)
        assertTrue(p.allowLocationView) // 双向可见
        assertFalse(p.allowGeofenceEdit)
        assertFalse(p.allowSosReceive) // 孩子是发起方非接收方
        assertFalse(p.allowRewardGrant)
        assertEquals(CompanionSummaryAccess.NEVER, p.allowCompanionSummary)
        assertTrue(p.allowEmergencyUnbind) // 关键: 孩子有紧急解绑权
    }

    @Test
    fun `Secondary Guardian template denies rule edit and geofence edit but keeps payment veto`() {
        val p = PermissionTemplates.forGuardianSecondaryToChild()
        assertEquals(TelemetryLevel.L1, p.telemetryLevel)
        assertFalse(p.allowRuleEdit) // 关键: 需 primary 确认
        assertTrue(p.allowTaskAssign)
        assertTrue(p.allowPaymentVeto) // 一票否决保留 (主文档 §3.4)
        assertFalse(p.allowGeofenceEdit) // 不可改围栏
        assertFalse(p.allowSilentObserve) // 默认不给, 怕滥用
        assertTrue(p.allowSosReceive)
        assertTrue(p.allowRewardGrant)
        assertFalse(p.allowEmergencyUnbind)
    }

    @Test
    fun `all 3 templates round-trip cleanly`() {
        listOf(
            PermissionTemplates.forParentToChild(),
            PermissionTemplates.forChildToParent(),
            PermissionTemplates.forGuardianSecondaryToChild(),
        ).forEach { template ->
            val decoded = FamilyPermissions.decode(FamilyPermissions.encode(template))
            assertEquals(template, decoded)
        }
    }
}
