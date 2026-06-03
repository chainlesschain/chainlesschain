package com.chainlesschain.android.feature.familyguard.domain.permission

/**
 * 21 个 family-friend 关系内可执行的动作 (FAMILY-14). 一一对应主文档 §3.1 v0.2
 * 权限矩阵; 每个动作的"是否允许"由 [FamilyPermissionChecker] 查 family_relationship
 * .permissions JSON 解码出的 [FamilyPermissions] 字段决定。
 *
 * 21 个动作分 8 组:
 *   - Messaging / 通话 (6): SendMessage / StartAudioCall / StartVideoCall /
 *     StartSilentObserve / StartForcePickup / StartRemoteView
 *   - Telemetry read (3): ReadTelemetryL1 / L2 / L3
 *   - M4 Enforce (3): EditRules / DisableApp / HideApp
 *   - M5 Task / M9 Reward (2): AssignTask / GrantReward
 *   - M7 SOS (1): ReceiveSos
 *   - M8 Location (2): ViewLocation / EditGeofence
 *   - Payment (1): VetoPayment
 *   - Companion / Emergency (3): ReadCompanionStats / ReadCompanionFull (永远 Deny) /
 *     TriggerEmergencyUnbind
 */
sealed interface FamilyAction {

    // ─── Messaging / 通话 (6) ───

    data object SendMessage : FamilyAction
    data object StartAudioCall : FamilyAction
    data object StartVideoCall : FamilyAction
    data object StartSilentObserve : FamilyAction
    data object StartForcePickup : FamilyAction
    data object StartRemoteView : FamilyAction

    // ─── Telemetry 上行读取 (3) ───

    /** L0 永远允许 (聚合), 故不出现 in action set; 这里只用 L1+. */
    data object ReadTelemetryL1 : FamilyAction
    data object ReadTelemetryL2 : FamilyAction
    data object ReadTelemetryL3 : FamilyAction

    // ─── M4 Enforce (3) ───

    data object EditRules : FamilyAction
    data object DisableApp : FamilyAction
    data object HideApp : FamilyAction

    // ─── M5 Task + M9 Reward (2) ───

    data object AssignTask : FamilyAction
    data object GrantReward : FamilyAction

    // ─── M7 SOS (1) ───

    data object ReceiveSos : FamilyAction

    // ─── M8 Location (2) ───

    data object ViewLocation : FamilyAction
    data object EditGeofence : FamilyAction

    // ─── Payment (1) ───

    data object VetoPayment : FamilyAction

    // ─── Companion / Emergency (3) ───

    data object ReadCompanionStats : FamilyAction

    /**
     * 看陪伴 tab 原文. 主文档 §3.6: TEE Vault 黑盒, 家长**永远拿不到 decrypt key**;
     * Checker 永远返 Deny, 即使 permissions JSON 含 allow_companion_summary='full'
     * (该值在 [com.chainlesschain.android.feature.familyguard.domain.model.permissions.
     * CompanionSummaryAccess] enum 里就不存在)。
     */
    data object ReadCompanionFull : FamilyAction

    data object TriggerEmergencyUnbind : FamilyAction
}
