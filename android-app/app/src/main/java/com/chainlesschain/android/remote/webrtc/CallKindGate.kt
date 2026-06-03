package com.chainlesschain.android.remote.webrtc

import com.chainlesschain.android.feature.familyguard.domain.permission.FamilyPermissionChecker
import com.chainlesschain.android.feature.familyguard.domain.permission.PermissionDecision
import javax.inject.Inject

/**
 * 通话权限闸（FAMILY-32，依赖 FAMILY-14 FamilyPermissionChecker）。
 *
 * **每次 addTrack 前**调 [authorize] — 把 [CallKind.requiredAction] 喂
 * [FamilyPermissionChecker]，按 family_relationship.permissions 决定能否发起该类通话。
 *   - [CallKind.requiredAction] == null（SOS_BROADCAST）→ 恒 [PermissionDecision.Allow]
 *     （不查 checker；孩子安全功能不受家长权限限制）。
 *   - 否则 → checker.check(action, targetDid)：Allow / Deny(reason) / NotApplicable。
 *
 * 调用方（WebRTCClient / FamilyCallRpcClient，FAMILY-34 接）须在 Allow 时才 addTrack +
 * 挂 [CallKind.banner]，Deny 走拒绝路径（不建轨 / 提示）。
 */
class CallKindGate @Inject constructor(
    private val permissionChecker: FamilyPermissionChecker,
) {
    /** @param targetDid 对端（家长视角 = 孩子 DID；被授权方）。 */
    suspend fun authorize(kind: CallKind, targetDid: String): PermissionDecision {
        val action = kind.requiredAction ?: return PermissionDecision.Allow
        return permissionChecker.check(action, targetDid)
    }

    suspend fun isAllowed(kind: CallKind, targetDid: String): Boolean =
        authorize(kind, targetDid) is PermissionDecision.Allow
}
