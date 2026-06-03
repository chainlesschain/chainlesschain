package com.chainlesschain.android.feature.familyguard.presentation.family

import com.chainlesschain.android.feature.familyguard.domain.model.GuardianTier
import com.chainlesschain.android.feature.familyguard.domain.model.MemberRole

/**
 * 家人页 (FAMILY-18) 一行成员的 UI 模型. ViewModel 从 FamilyMembership +
 * FamilyRelationship + SosEvent 多源聚合, Composable 只读 UI model 渲染。
 *
 * @property memberDid 唯一标识 (UI key 用)
 * @property role parent / child / guardian
 * @property tier primary / secondary / null (child)
 * @property displayLabel "爸 (主)" / "妈 (副)" / "娃" 等中文标签
 * @property status active / inactive / unbind_pending / sos / etc.
 * @property hasActiveSos 当前是否有 pending SOS (孩子端时高亮红色)
 */
data class FamilyMemberUiModel(
    val memberDid: String,
    val role: MemberRole,
    val tier: GuardianTier?,
    val displayLabel: String,
    val status: MemberStatus,
    val hasActiveSos: Boolean = false,
) {
    enum class MemberStatus {
        ACTIVE, INACTIVE, UNBIND_PENDING, EMERGENCY_UNBOUND, FROZEN
    }
}

/**
 * 家人页整体 state. UnbindPendingBanner 由 [unbindPendingCount] > 0 触发显示;
 * [emergencyUnbindActive] 真为 SOS 级警示 (M16 紧急解绑生效中)。
 */
data class FamilyMembersUiState(
    val isLoading: Boolean = true,
    val familyGroupName: String? = null,
    val members: List<FamilyMemberUiModel> = emptyList(),
    val unbindPendingCount: Int = 0,
    val emergencyUnbindActive: Boolean = false,
    val errorMessage: String? = null,
)
