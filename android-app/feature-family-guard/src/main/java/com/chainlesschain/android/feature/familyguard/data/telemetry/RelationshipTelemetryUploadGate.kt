package com.chainlesschain.android.feature.familyguard.data.telemetry

import com.chainlesschain.android.feature.familyguard.data.entity.FamilyRelationshipEntity
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.FamilyPermissions
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.QuietHourWindow
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel
import com.chainlesschain.android.feature.familyguard.domain.permission.FamilyAction
import com.chainlesschain.android.feature.familyguard.domain.permission.FamilyPermissionChecker
import com.chainlesschain.android.feature.familyguard.domain.permission.PermissionDecision
import com.chainlesschain.android.feature.familyguard.domain.quiethours.QuietHoursEngine
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryEvent
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryUploadGate
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.first

/**
 * [TelemetryUploadGate] 默认实装 (FAMILY-25 v0.1).
 *
 * 在孩子端运行: active family_relationship 的 friendDid = guardian DID, 其
 * permissions.telemetryLevel = 孩子已同意上行给该 guardian 的最高级别。
 *
 * 决策:
 *   - 无 active relationship → 空 (没人可上行)。
 *   - event.level == L0 (聚合) → 永远允许 (主文档 §3.1: L0 不在 action set; 私有时段
 *     内 L0 仍上报), 返所有 active guardian。
 *   - L1/L2/L3 → 映射 FamilyAction.ReadTelemetryLx, 逐个 guardian:
 *       1. 查 [FamilyPermissionChecker] level gate; 非 [PermissionDecision.Allow] → 排除。
 *       2. (FAMILY-24) 查 [QuietHoursEngine]: 事件发生时刻落在该 guardian 关系的私有
 *          时段内 → 排除 (主文档 §3.2: 私有时段 L1/L2/L3 全停采)。
 *
 * 私有时段按 **事件发生时刻** ([TelemetryEvent.timestampMs]) 判, 而非"现在" — 上行
 * 可能延迟 (outbox 积压), 用事件时刻才符合"采集那一刻是否私有"的语义。
 *
 * 注: blocklist 过滤 (FAMILY-25 后续) 尚未在此接通。
 */
@Singleton
class RelationshipTelemetryUploadGate @Inject constructor(
    private val relationshipRepository: FamilyRelationshipRepository,
    private val permissionChecker: FamilyPermissionChecker,
    private val quietHoursEngine: QuietHoursEngine,
) : TelemetryUploadGate {

    override suspend fun permittedGuardians(event: TelemetryEvent): List<String> {
        val active = relationshipRepository.observeAllActive().first()
        if (active.isEmpty()) return emptyList()

        val action = event.level.toReadAction()
            ?: return active.map { it.friendDid } // L0 聚合: 只要有 active guardian 即放行

        val eventInstant = Instant.ofEpochMilli(event.timestampMs)
        return active
            .filter { permissionChecker.check(action, it.friendDid) is PermissionDecision.Allow }
            .filterNot { quietHoursEngine.isActive(quietWindowsOf(it), eventInstant) }
            .map { it.friendDid }
    }

    /**
     * 取该关系配置的私有时段窗口。permissions JSON 损坏时 fail-open 到空列表 (不因解析
     * 失败误判为私有而丢数据); level gate 已先于此处把损坏关系挡下 (checker 会抛),
     * 故此处仅是二重保险。
     */
    private fun quietWindowsOf(relationship: FamilyRelationshipEntity): List<QuietHourWindow> =
        runCatching { FamilyPermissions.decode(relationship.permissions).telemetryQuietHours }
            .getOrDefault(emptyList())

    /** L0 返 null (聚合永远允许, 不入 action set); L1/L2/L3 映射对应读 action。 */
    private fun TelemetryLevel.toReadAction(): FamilyAction? = when (this) {
        TelemetryLevel.L0 -> null
        TelemetryLevel.L1 -> FamilyAction.ReadTelemetryL1
        TelemetryLevel.L2 -> FamilyAction.ReadTelemetryL2
        TelemetryLevel.L3 -> FamilyAction.ReadTelemetryL3
    }
}
