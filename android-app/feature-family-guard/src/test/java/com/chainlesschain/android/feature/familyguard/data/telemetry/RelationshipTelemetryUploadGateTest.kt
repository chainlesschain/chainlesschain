package com.chainlesschain.android.feature.familyguard.data.telemetry

import com.chainlesschain.android.feature.familyguard.data.entity.FamilyRelationshipEntity
import com.chainlesschain.android.feature.familyguard.domain.model.GuardianTier
import com.chainlesschain.android.feature.familyguard.domain.model.MemberRole
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.FamilyPermissions
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.QuietHourWindow
import com.chainlesschain.android.feature.familyguard.domain.permission.FamilyAction
import com.chainlesschain.android.feature.familyguard.domain.permission.FamilyPermissionChecker
import com.chainlesschain.android.feature.familyguard.domain.permission.PermissionDecision
import com.chainlesschain.android.feature.familyguard.domain.quiethours.QuietHoursEngine
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryEvent
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetrySourceType
import com.chainlesschain.android.feature.familyguard.domain.time.TimeAuthority
import com.chainlesschain.android.feature.familyguard.domain.time.TimeAuthorityStatus
import java.time.LocalDateTime
import java.time.ZoneId
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * FAMILY-25 v0.1 + FAMILY-24 + FAMILY-60 验收: RelationshipTelemetryUploadGate —
 * L0 永远放行 / L1+ 逐 guardian 查 checker / 无 active 返空 / 私有时段内 L1+ 排除
 * (按 **权威时间** [TimeAuthority.authoritativeNow] 判, 不读可伪造的 event.timestampMs)。
 */
class RelationshipTelemetryUploadGateTest {

    private val mom = "did:chain:mom"
    private val dad = "did:chain:dad"

    private val zone = ZoneId.of("UTC")
    private val engine = QuietHoursEngine(zone)

    /** 2026-06-03 周三 13:00 UTC — 默认事件时刻 (落在 12:00-14:00 测试窗口内)。 */
    private val wedNoonMs =
        LocalDateTime.of(2026, 6, 3, 13, 0).atZone(zone).toInstant().toEpochMilli()

    private fun event(level: TelemetryLevel, timestampMs: Long = wedNoonMs) = TelemetryEvent(
        childDid = "did:chain:kid",
        source = TelemetrySourceType.FOREGROUND_APP,
        kind = "run",
        payload = "{}",
        timestampMs = timestampMs,
        level = level,
    )

    /** 权威时间默认 = 13:00 (在 12:00-14:00 测试窗口内); 个别测试覆盖 nowMs。 */
    private fun gate(
        repo: FamilyRelationshipRepository,
        checker: FamilyPermissionChecker,
        nowMs: Long = wedNoonMs,
    ) = RelationshipTelemetryUploadGate(repo, checker, engine, FakeTimeAuthority(nowMs))

    @Test
    fun `no active relationship returns empty`() = runTest {
        val gate = gate(FakeRelRepo(active = emptyList()), FakeChecker(allowed = setOf(mom, dad)))
        assertTrue(gate.permittedGuardians(event(TelemetryLevel.L1)).isEmpty())
    }

    @Test
    fun `L0 aggregate allows all active guardians regardless of checker`() = runTest {
        val gate = gate(
            FakeRelRepo(active = listOf(rel(mom), rel(dad))),
            FakeChecker(allowed = emptySet()), // checker 全 Deny
        )
        assertEquals(listOf(mom, dad), gate.permittedGuardians(event(TelemetryLevel.L0)))
    }

    @Test
    fun `L1 returns only guardians the checker allows`() = runTest {
        val gate = gate(
            FakeRelRepo(active = listOf(rel(mom), rel(dad))),
            FakeChecker(allowed = setOf(mom)), // 只 mom 同意 L1
        )
        assertEquals(listOf(mom), gate.permittedGuardians(event(TelemetryLevel.L1)))
    }

    @Test
    fun `L1 maps to ReadTelemetryL1 action`() = runTest {
        val checker = FakeChecker(allowed = setOf(mom))
        val gate = gate(FakeRelRepo(listOf(rel(mom))), checker)
        gate.permittedGuardians(event(TelemetryLevel.L1))
        assertEquals(FamilyAction.ReadTelemetryL1, checker.lastAction)
    }

    @Test
    fun `L3 maps to ReadTelemetryL3 action`() = runTest {
        val checker = FakeChecker(allowed = setOf(mom))
        val gate = gate(FakeRelRepo(listOf(rel(mom))), checker)
        gate.permittedGuardians(event(TelemetryLevel.L3))
        assertEquals(FamilyAction.ReadTelemetryL3, checker.lastAction)
    }

    // ─── FAMILY-24 + FAMILY-60: quiet hours exclusion (按权威时间判) ───

    @Test
    fun `L1 excluded when authoritative now falls in guardian quiet hours`() = runTest {
        // mom 配私有时段 12:00-14:00; 权威时间 13:00 (默认) 命中 → mom 排除, dad 无窗口仍放行。
        val gate = gate(
            FakeRelRepo(listOf(rel(mom, quiet = listOf(noon())), rel(dad))),
            FakeChecker(allowed = setOf(mom, dad)),
        )
        assertEquals(listOf(dad), gate.permittedGuardians(event(TelemetryLevel.L1)))
    }

    @Test
    fun `L0 still flows during quiet hours`() = runTest {
        // 私有时段内 L0 聚合仍上报 (主文档 §3.2)。
        val gate = gate(
            FakeRelRepo(listOf(rel(mom, quiet = listOf(noon())))),
            FakeChecker(allowed = setOf(mom)),
        )
        assertEquals(listOf(mom), gate.permittedGuardians(event(TelemetryLevel.L0)))
    }

    @Test
    fun `L1 flows when authoritative now is outside quiet hours`() = runTest {
        // 同窗口但权威时间 18:00 (窗外) → 不排除。
        val eveningMs =
            LocalDateTime.of(2026, 6, 3, 18, 0).atZone(zone).toInstant().toEpochMilli()
        val gate = gate(
            FakeRelRepo(listOf(rel(mom, quiet = listOf(noon())))),
            FakeChecker(allowed = setOf(mom)),
            nowMs = eveningMs,
        )
        assertEquals(listOf(mom), gate.permittedGuardians(event(TelemetryLevel.L1)))
    }

    @Test
    fun `quiet check uses authoritative now not spoofable event timestamp`() = runTest {
        // 绕过向量: 孩子把事件时间戳伪造成落在私有窗内 (13:00) 想抑制 L1 上行,
        // 但权威时间 (单调钟锚定) 是 18:00 窗外 → 不排除, telemetry 照常上行。
        val eveningMs =
            LocalDateTime.of(2026, 6, 3, 18, 0).atZone(zone).toInstant().toEpochMilli()
        val gate = gate(
            FakeRelRepo(listOf(rel(mom, quiet = listOf(noon())))),
            FakeChecker(allowed = setOf(mom)),
            nowMs = eveningMs, // 权威时间窗外
        )
        // 事件 timestampMs = 13:00 (伪造进窗内) — 旧逻辑会误排除 mom; 新逻辑按权威时间放行。
        assertEquals(
            listOf(mom),
            gate.permittedGuardians(event(TelemetryLevel.L1, timestampMs = wedNoonMs)),
        )
    }

    // ─── fakes ───

    private class FakeTimeAuthority(private val nowMs: Long) : TimeAuthority {
        override fun authoritativeNow(): Long = nowMs
        override fun status(): TimeAuthorityStatus = TimeAuthorityStatus.TRUSTED
        override fun isTimeTrusted(): Boolean = true
        override fun shouldLockTimeFeatures(): Boolean = false
        override suspend fun sync(): Boolean = true
    }

    private fun noon() = QuietHourWindow(start = "12:00", end = "14:00")

    private fun rel(
        friendDid: String,
        quiet: List<QuietHourWindow> = emptyList(),
    ): FamilyRelationshipEntity {
        val permissionsJson = if (quiet.isEmpty()) {
            "{}"
        } else {
            FamilyPermissions.encode(FamilyPermissions(telemetryQuietHours = quiet))
        }
        return FamilyRelationshipEntity(
            familyGroupId = "grp",
            friendDid = friendDid,
            roleSelf = "child",
            roleOther = "guardian",
            boundAt = 0L,
            permissions = permissionsJson,
            createdAt = 0L,
            updatedAt = 0L,
        )
    }

    private class FakeChecker(private val allowed: Set<String>) : FamilyPermissionChecker {
        var lastAction: FamilyAction? = null
        override suspend fun check(action: FamilyAction, targetDid: String): PermissionDecision {
            lastAction = action
            return if (targetDid in allowed) PermissionDecision.Allow
            else PermissionDecision.Deny(PermissionDecision.DenyReason.TELEMETRY_LEVEL_TOO_LOW)
        }
    }

    private class FakeRelRepo(
        private val active: List<FamilyRelationshipEntity>,
    ) : FamilyRelationshipRepository {
        override fun observeAllActive(): Flow<List<FamilyRelationshipEntity>> = flowOf(active)

        override suspend fun create(
            familyGroupId: String,
            friendDid: String,
            roleSelf: MemberRole,
            roleOther: MemberRole,
            guardianTierOther: GuardianTier?,
            permissions: FamilyPermissions,
            emergencyContactsJson: String?,
            boundEvidence: String?,
        ): FamilyRelationshipEntity = throw NotImplementedError()
        override suspend fun findById(id: Long): FamilyRelationshipEntity? = null
        override suspend fun findByFriendDid(friendDid: String): FamilyRelationshipEntity? = null
        override fun observeActiveByGroup(groupId: String): Flow<List<FamilyRelationshipEntity>> = flowOf(emptyList())
        override suspend fun readPermissions(id: Long): FamilyPermissions? = null
        override suspend fun updatePermissions(id: Long, permissions: FamilyPermissions): Boolean = false
        override suspend fun updateEmergencyContacts(id: Long, emergencyContactsJson: String?): Boolean = false
    }
}
