package com.chainlesschain.android.feature.familyguard.domain.telemetry

/**
 * 上行权限闸 (FAMILY-25 seam).
 *
 * [CentralTelemetryDispatcher] 每收一个 [TelemetryEvent] 调本闸, 返「被授权接收该
 * 事件的 guardian DID 列表」。空列表 = 当前无任何 guardian 被授权接收该级别 →
 * dispatcher 丢弃事件 (不落库 / 不上行)。
 *
 * 默认实装
 * [com.chainlesschain.android.feature.familyguard.data.telemetry.RelationshipTelemetryUploadGate]
 * 按 event.level 映射到 FamilyAction.ReadTelemetryLx 查
 * [com.chainlesschain.android.feature.familyguard.domain.permission.FamilyPermissionChecker]。
 * FAMILY-25 正式化时 (家长申请 L2/L3 + 孩子端弹窗同意 + 审计) 在此扩展。
 */
interface TelemetryUploadGate {

    /** @return 被授权接收 [event] 的 guardian DID 列表; 空 = 不放行。 */
    suspend fun permittedGuardians(event: TelemetryEvent): List<String>
}
