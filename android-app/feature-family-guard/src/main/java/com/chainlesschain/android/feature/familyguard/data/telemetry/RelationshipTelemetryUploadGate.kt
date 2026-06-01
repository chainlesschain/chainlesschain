package com.chainlesschain.android.feature.familyguard.data.telemetry

import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel
import com.chainlesschain.android.feature.familyguard.domain.permission.FamilyAction
import com.chainlesschain.android.feature.familyguard.domain.permission.FamilyPermissionChecker
import com.chainlesschain.android.feature.familyguard.domain.permission.PermissionDecision
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryEvent
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryUploadGate
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
 *   - event.level == L0 (聚合) → 永远允许 (主文档 §3.1: L0 不在 action set),
 *     返所有 active guardian。
 *   - L1/L2/L3 → 映射 FamilyAction.ReadTelemetryLx, 逐个 guardian 查
 *     [FamilyPermissionChecker]; 只收 [PermissionDecision.Allow] 的 friendDid。
 *
 * 注: quiet hours / blocklist 过滤 (FAMILY-25 后续) 尚未在此接通 — 当前仅 level
 * gate。接通点见 [permittedGuardians]。
 */
@Singleton
class RelationshipTelemetryUploadGate @Inject constructor(
    private val relationshipRepository: FamilyRelationshipRepository,
    private val permissionChecker: FamilyPermissionChecker,
) : TelemetryUploadGate {

    override suspend fun permittedGuardians(event: TelemetryEvent): List<String> {
        val active = relationshipRepository.observeAllActive().first()
        if (active.isEmpty()) return emptyList()

        val action = event.level.toReadAction()
            ?: return active.map { it.friendDid } // L0 聚合: 只要有 active guardian 即放行

        return active
            .filter { permissionChecker.check(action, it.friendDid) is PermissionDecision.Allow }
            .map { it.friendDid }
    }

    /** L0 返 null (聚合永远允许, 不入 action set); L1/L2/L3 映射对应读 action。 */
    private fun TelemetryLevel.toReadAction(): FamilyAction? = when (this) {
        TelemetryLevel.L0 -> null
        TelemetryLevel.L1 -> FamilyAction.ReadTelemetryL1
        TelemetryLevel.L2 -> FamilyAction.ReadTelemetryL2
        TelemetryLevel.L3 -> FamilyAction.ReadTelemetryL3
    }
}
