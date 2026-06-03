package com.chainlesschain.android.feature.familyguard.data.permission

import com.chainlesschain.android.feature.familyguard.data.entity.FamilyRelationshipEntity
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.CompanionSummaryAccess
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.FamilyPermissions
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.PermissionTemplates
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel
import com.chainlesschain.android.feature.familyguard.domain.permission.FamilyAction
import com.chainlesschain.android.feature.familyguard.domain.permission.PermissionDecision
import com.chainlesschain.android.feature.familyguard.domain.permission.PermissionDecision.DenyReason
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import com.chainlesschain.android.feature.familyguard.fixtures.FamilyFixtures
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

/**
 * FAMILY-14 验收: 21 action 全覆盖 + Deny reason 分支 + 边界
 * (relationship 不存在 / 非 active / TEE 黑盒短路).
 */
class FamilyPermissionCheckerImplTest {

    private val repo: FamilyRelationshipRepository = mockk()
    private lateinit var checker: FamilyPermissionCheckerImpl

    private val targetDid = "did:chain:kid"

    @Before
    fun setUp() {
        checker = FamilyPermissionCheckerImpl(repo)
    }

    private fun seedActiveRelationship(perm: FamilyPermissions) {
        val rel = FamilyFixtures.fakeRelationship().copy(
            id = 1L,
            friendDid = targetDid,
            status = "active",
            permissions = FamilyPermissions.encode(perm),
        )
        coEvery { repo.findByFriendDid(targetDid) } returns rel
        coEvery { repo.readPermissions(1L) } returns perm
    }

    // ─── pure decide() 21 action 全覆盖 ───

    @Test
    fun `decide returns Allow when allowMessage true`() {
        val d = checker.decide(FamilyAction.SendMessage, FamilyPermissions(allowMessage = true))
        assertIs<PermissionDecision.Allow>(d)
    }

    @Test
    fun `decide returns Deny PERMISSION_DISABLED when allowMessage false`() {
        val d = checker.decide(FamilyAction.SendMessage, FamilyPermissions(allowMessage = false))
        val deny = assertIs<PermissionDecision.Deny>(d)
        assertEquals(DenyReason.PERMISSION_DISABLED, deny.reason)
    }

    @Test
    fun `decide StartAudioCall + StartVideoCall use respective flags`() {
        val p = FamilyPermissions(allowAudioCall = true, allowVideoCall = false)
        assertIs<PermissionDecision.Allow>(checker.decide(FamilyAction.StartAudioCall, p))
        assertIs<PermissionDecision.Deny>(checker.decide(FamilyAction.StartVideoCall, p))
    }

    @Test
    fun `decide StartSilentObserve respects flag`() {
        assertIs<PermissionDecision.Allow>(
            checker.decide(
                FamilyAction.StartSilentObserve,
                FamilyPermissions(allowSilentObserve = true),
            ),
        )
        assertIs<PermissionDecision.Deny>(
            checker.decide(
                FamilyAction.StartSilentObserve,
                FamilyPermissions(allowSilentObserve = false),
            ),
        )
    }

    @Test
    fun `decide StartForcePickup and StartRemoteView use respective flags`() {
        val p = FamilyPermissions(allowForcePickup = true, allowRemoteView = false)
        assertIs<PermissionDecision.Allow>(checker.decide(FamilyAction.StartForcePickup, p))
        assertIs<PermissionDecision.Deny>(checker.decide(FamilyAction.StartRemoteView, p))
    }

    @Test
    fun `decide ReadTelemetry L1 L2 L3 honor telemetryLevel encompasses`() {
        val pL1 = FamilyPermissions(telemetryLevel = TelemetryLevel.L1)
        assertIs<PermissionDecision.Allow>(checker.decide(FamilyAction.ReadTelemetryL1, pL1))
        val l2deny = assertIs<PermissionDecision.Deny>(
            checker.decide(FamilyAction.ReadTelemetryL2, pL1),
        )
        assertEquals(DenyReason.TELEMETRY_LEVEL_TOO_LOW, l2deny.reason)
        val l3deny = assertIs<PermissionDecision.Deny>(
            checker.decide(FamilyAction.ReadTelemetryL3, pL1),
        )
        assertEquals(DenyReason.TELEMETRY_LEVEL_TOO_LOW, l3deny.reason)

        val pL3 = FamilyPermissions(telemetryLevel = TelemetryLevel.L3)
        assertIs<PermissionDecision.Allow>(checker.decide(FamilyAction.ReadTelemetryL1, pL3))
        assertIs<PermissionDecision.Allow>(checker.decide(FamilyAction.ReadTelemetryL2, pL3))
        assertIs<PermissionDecision.Allow>(checker.decide(FamilyAction.ReadTelemetryL3, pL3))
    }

    @Test
    fun `decide EditRules + DisableApp + HideApp use respective flags`() {
        val p = FamilyPermissions(
            allowRuleEdit = true,
            allowAppDisable = false,
            allowAppHide = true,
        )
        assertIs<PermissionDecision.Allow>(checker.decide(FamilyAction.EditRules, p))
        assertIs<PermissionDecision.Deny>(checker.decide(FamilyAction.DisableApp, p))
        assertIs<PermissionDecision.Allow>(checker.decide(FamilyAction.HideApp, p))
    }

    @Test
    fun `decide AssignTask and GrantReward use respective flags`() {
        val p = FamilyPermissions(allowTaskAssign = true, allowRewardGrant = false)
        assertIs<PermissionDecision.Allow>(checker.decide(FamilyAction.AssignTask, p))
        assertIs<PermissionDecision.Deny>(checker.decide(FamilyAction.GrantReward, p))
    }

    @Test
    fun `decide ReceiveSos uses allowSosReceive flag`() {
        assertIs<PermissionDecision.Allow>(
            checker.decide(FamilyAction.ReceiveSos, FamilyPermissions(allowSosReceive = true)),
        )
        assertIs<PermissionDecision.Deny>(
            checker.decide(FamilyAction.ReceiveSos, FamilyPermissions(allowSosReceive = false)),
        )
    }

    @Test
    fun `decide ViewLocation and EditGeofence use respective flags`() {
        val p = FamilyPermissions(allowLocationView = true, allowGeofenceEdit = false)
        assertIs<PermissionDecision.Allow>(checker.decide(FamilyAction.ViewLocation, p))
        assertIs<PermissionDecision.Deny>(checker.decide(FamilyAction.EditGeofence, p))
    }

    @Test
    fun `decide VetoPayment uses allowPaymentVeto flag`() {
        assertIs<PermissionDecision.Allow>(
            checker.decide(FamilyAction.VetoPayment, FamilyPermissions(allowPaymentVeto = true)),
        )
        assertIs<PermissionDecision.Deny>(
            checker.decide(FamilyAction.VetoPayment, FamilyPermissions(allowPaymentVeto = false)),
        )
    }

    @Test
    fun `decide ReadCompanionStats Allow when STATS_ONLY Deny when NEVER`() {
        assertIs<PermissionDecision.Allow>(
            checker.decide(
                FamilyAction.ReadCompanionStats,
                FamilyPermissions(allowCompanionSummary = CompanionSummaryAccess.STATS_ONLY),
            ),
        )
        val deny = assertIs<PermissionDecision.Deny>(
            checker.decide(
                FamilyAction.ReadCompanionStats,
                FamilyPermissions(allowCompanionSummary = CompanionSummaryAccess.NEVER),
            ),
        )
        assertEquals(DenyReason.COMPANION_SUMMARY_NEVER, deny.reason)
    }

    @Test
    fun `decide ReadCompanionFull always Deny COMPANION_TEE_BLACK_BOX even if permissions wide open`() {
        // 即使把 permissions JSON 改大开 (虚拟 STATS_ONLY 也允许), Full 永远 Deny
        val wideOpen = PermissionTemplates.forParentToChild().copy(
            allowCompanionSummary = CompanionSummaryAccess.STATS_ONLY,
        )
        val deny = assertIs<PermissionDecision.Deny>(
            checker.decide(FamilyAction.ReadCompanionFull, wideOpen),
        )
        assertEquals(DenyReason.COMPANION_TEE_BLACK_BOX, deny.reason)
    }

    @Test
    fun `decide TriggerEmergencyUnbind uses allowEmergencyUnbind flag`() {
        assertIs<PermissionDecision.Allow>(
            checker.decide(
                FamilyAction.TriggerEmergencyUnbind,
                FamilyPermissions(allowEmergencyUnbind = true),
            ),
        )
        assertIs<PermissionDecision.Deny>(
            checker.decide(
                FamilyAction.TriggerEmergencyUnbind,
                FamilyPermissions(allowEmergencyUnbind = false),
            ),
        )
    }

    // ─── check() 整体路径 ───

    @Test
    fun `check returns NotApplicable when no relationship found`() = runTest {
        coEvery { repo.findByFriendDid(targetDid) } returns null
        assertIs<PermissionDecision.NotApplicable>(
            checker.check(FamilyAction.SendMessage, targetDid),
        )
    }

    @Test
    fun `check returns Deny RELATIONSHIP_NOT_ACTIVE when status not active`() = runTest {
        val rel = FamilyFixtures.fakeRelationship().copy(
            id = 1L,
            friendDid = targetDid,
            status = "unbind_pending",
            permissions = FamilyPermissions.encode(FamilyPermissions()),
        )
        coEvery { repo.findByFriendDid(targetDid) } returns rel
        val deny = assertIs<PermissionDecision.Deny>(
            checker.check(FamilyAction.SendMessage, targetDid),
        )
        assertEquals(DenyReason.RELATIONSHIP_NOT_ACTIVE, deny.reason)
    }

    @Test
    fun `check ReadCompanionFull short-circuits before relationship lookup`() = runTest {
        // 注意: 不 stub repo.findByFriendDid; 如果走查 → mockk 抛 NotFound, 测试就 fail。
        // 所以这是验证 short-circuit 路径的关键 negative 断言。
        val deny = assertIs<PermissionDecision.Deny>(
            checker.check(FamilyAction.ReadCompanionFull, targetDid),
        )
        assertEquals(DenyReason.COMPANION_TEE_BLACK_BOX, deny.reason)
    }

    @Test
    fun `check uses parent-to-child template Allow for SendMessage and StartVideoCall`() = runTest {
        seedActiveRelationship(PermissionTemplates.forParentToChild())
        assertIs<PermissionDecision.Allow>(checker.check(FamilyAction.SendMessage, targetDid))
        assertIs<PermissionDecision.Allow>(checker.check(FamilyAction.StartVideoCall, targetDid))
        assertIs<PermissionDecision.Allow>(checker.check(FamilyAction.EditRules, targetDid))
        assertIs<PermissionDecision.Allow>(checker.check(FamilyAction.ViewLocation, targetDid))
        // 强档默认关
        assertIs<PermissionDecision.Deny>(checker.check(FamilyAction.DisableApp, targetDid))
        assertIs<PermissionDecision.Deny>(checker.check(FamilyAction.HideApp, targetDid))
        // 强接通默认关
        assertIs<PermissionDecision.Deny>(checker.check(FamilyAction.StartForcePickup, targetDid))
    }

    @Test
    fun `check uses child-to-parent template Allow for SendMessage and TriggerEmergencyUnbind`() =
        runTest {
            seedActiveRelationship(PermissionTemplates.forChildToParent())
            assertIs<PermissionDecision.Allow>(checker.check(FamilyAction.SendMessage, targetDid))
            assertIs<PermissionDecision.Allow>(
                checker.check(FamilyAction.TriggerEmergencyUnbind, targetDid),
            )
            // child 端: rule edit / payment veto / SOS receive 全关
            assertIs<PermissionDecision.Deny>(checker.check(FamilyAction.EditRules, targetDid))
            assertIs<PermissionDecision.Deny>(checker.check(FamilyAction.VetoPayment, targetDid))
            assertIs<PermissionDecision.Deny>(checker.check(FamilyAction.ReceiveSos, targetDid))
            // companion NEVER
            val cs = assertIs<PermissionDecision.Deny>(
                checker.check(FamilyAction.ReadCompanionStats, targetDid),
            )
            assertEquals(DenyReason.COMPANION_SUMMARY_NEVER, cs.reason)
        }

    @Test
    fun `check uses secondary-guardian template Deny EditRules but Allow VetoPayment`() = runTest {
        seedActiveRelationship(PermissionTemplates.forGuardianSecondaryToChild())
        // 关键: rule_edit 关 (需 primary 确认)
        assertIs<PermissionDecision.Deny>(checker.check(FamilyAction.EditRules, targetDid))
        // 一票否决保留
        assertIs<PermissionDecision.Allow>(checker.check(FamilyAction.VetoPayment, targetDid))
        // 围栏不可改
        assertIs<PermissionDecision.Deny>(checker.check(FamilyAction.EditGeofence, targetDid))
        // SOS 接收 (广播给所有 guardian)
        assertIs<PermissionDecision.Allow>(checker.check(FamilyAction.ReceiveSos, targetDid))
        // 给积分天然
        assertIs<PermissionDecision.Allow>(checker.check(FamilyAction.GrantReward, targetDid))
    }

    @Test
    fun `check returns NotApplicable when permissions decode returns null`() = runTest {
        val rel = FamilyFixtures.fakeRelationship().copy(
            id = 99L,
            friendDid = targetDid,
            status = "active",
            permissions = FamilyPermissions.encode(FamilyPermissions()),
        )
        coEvery { repo.findByFriendDid(targetDid) } returns rel
        coEvery { repo.readPermissions(99L) } returns null

        assertIs<PermissionDecision.NotApplicable>(
            checker.check(FamilyAction.SendMessage, targetDid),
        )
    }
}
