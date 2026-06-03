package com.chainlesschain.android.feature.familyguard.data.permission

import com.chainlesschain.android.feature.familyguard.domain.model.permissions.CompanionSummaryAccess
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.FamilyPermissions
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel
import com.chainlesschain.android.feature.familyguard.domain.permission.FamilyAction
import com.chainlesschain.android.feature.familyguard.domain.permission.FamilyPermissionChecker
import com.chainlesschain.android.feature.familyguard.domain.permission.PermissionDecision
import com.chainlesschain.android.feature.familyguard.domain.permission.PermissionDecision.DenyReason
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import javax.inject.Inject
import javax.inject.Singleton

/**
 * FAMILY-14 实装. 21 action 的全套决策表.
 *
 * 查表流程 ([check]):
 *   1. 找 active relationship by friendDid; 找不到 → NotApplicable
 *   2. 解码 permissions JSON; 解码失败 (旧版本 / 数据损坏) → 抛
 *      InvalidFamilyRelationshipException (上层捕获)
 *   3. 按 action 类型查 [FamilyPermissions] 字段 + 返 [PermissionDecision]
 *
 * ReadCompanionFull 是常量 Deny: 主文档 §3.6 TEE 黑盒承诺, 即使 permissions
 * 字段允许也不能突破; 这是产品决策, 不可在 UI 配置。
 */
@Singleton
class FamilyPermissionCheckerImpl @Inject constructor(
    private val familyRelationshipRepository: FamilyRelationshipRepository,
) : FamilyPermissionChecker {

    override suspend fun check(action: FamilyAction, targetDid: String): PermissionDecision {
        // ─── ReadCompanionFull 常量 Deny (永不查 relationship) ───
        if (action is FamilyAction.ReadCompanionFull) {
            return PermissionDecision.Deny(DenyReason.COMPANION_TEE_BLACK_BOX)
        }

        // ─── 找 active relationship ───
        val rel = familyRelationshipRepository.findByFriendDid(targetDid)
            ?: return PermissionDecision.NotApplicable

        if (rel.status != "active") {
            return PermissionDecision.Deny(DenyReason.RELATIONSHIP_NOT_ACTIVE)
        }

        // ─── 解码 permissions ───
        val permissions = familyRelationshipRepository.readPermissions(rel.id)
            ?: return PermissionDecision.NotApplicable

        // ─── 21 action 决策表 ───
        return decide(action, permissions)
    }

    /**
     * Pure 决策函数 — 不接 IO; 单测可直接调; 也方便 FAMILY-17 RuleMerger 复用。
     * 21 个 action 全覆盖, when 用 sealed exhaustiveness 编译器强制。
     */
    @Suppress("CyclomaticComplexMethod") // 21 分支是设计要求, 不可拆
    internal fun decide(action: FamilyAction, p: FamilyPermissions): PermissionDecision =
        when (action) {
            // ─── Messaging / 通话 ───
            FamilyAction.SendMessage -> bool(p.allowMessage)
            FamilyAction.StartAudioCall -> bool(p.allowAudioCall)
            FamilyAction.StartVideoCall -> bool(p.allowVideoCall)
            FamilyAction.StartSilentObserve -> bool(p.allowSilentObserve)
            FamilyAction.StartForcePickup -> bool(p.allowForcePickup)
            FamilyAction.StartRemoteView -> bool(p.allowRemoteView)

            // ─── Telemetry read (按 level 分级) ───
            FamilyAction.ReadTelemetryL1 -> telemetry(p.telemetryLevel, TelemetryLevel.L1)
            FamilyAction.ReadTelemetryL2 -> telemetry(p.telemetryLevel, TelemetryLevel.L2)
            FamilyAction.ReadTelemetryL3 -> telemetry(p.telemetryLevel, TelemetryLevel.L3)

            // ─── M4 Enforce ───
            FamilyAction.EditRules -> bool(p.allowRuleEdit)
            FamilyAction.DisableApp -> bool(p.allowAppDisable)
            FamilyAction.HideApp -> bool(p.allowAppHide)

            // ─── M5 Task + M9 Reward ───
            FamilyAction.AssignTask -> bool(p.allowTaskAssign)
            FamilyAction.GrantReward -> bool(p.allowRewardGrant)

            // ─── M7 SOS ───
            FamilyAction.ReceiveSos -> bool(p.allowSosReceive)

            // ─── M8 Location ───
            FamilyAction.ViewLocation -> bool(p.allowLocationView)
            FamilyAction.EditGeofence -> bool(p.allowGeofenceEdit)

            // ─── Payment ───
            FamilyAction.VetoPayment -> bool(p.allowPaymentVeto)

            // ─── Companion ───
            FamilyAction.ReadCompanionStats -> when (p.allowCompanionSummary) {
                CompanionSummaryAccess.NEVER ->
                    PermissionDecision.Deny(DenyReason.COMPANION_SUMMARY_NEVER)
                CompanionSummaryAccess.STATS_ONLY -> PermissionDecision.Allow
            }

            // ReadCompanionFull 已在 check() 短路, 不会走到这里
            FamilyAction.ReadCompanionFull ->
                PermissionDecision.Deny(DenyReason.COMPANION_TEE_BLACK_BOX)

            // ─── Emergency unbind ───
            FamilyAction.TriggerEmergencyUnbind -> bool(p.allowEmergencyUnbind)
        }

    private fun bool(allowed: Boolean): PermissionDecision =
        if (allowed) PermissionDecision.Allow
        else PermissionDecision.Deny(DenyReason.PERMISSION_DISABLED)

    private fun telemetry(
        held: TelemetryLevel,
        required: TelemetryLevel,
    ): PermissionDecision =
        if (held.encompasses(required)) PermissionDecision.Allow
        else PermissionDecision.Deny(DenyReason.TELEMETRY_LEVEL_TOO_LOW)
}
