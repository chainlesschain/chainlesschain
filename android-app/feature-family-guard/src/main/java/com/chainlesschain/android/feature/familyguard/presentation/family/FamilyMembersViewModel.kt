package com.chainlesschain.android.feature.familyguard.presentation.family

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.familyguard.data.entity.FamilyMembershipEntity
import com.chainlesschain.android.feature.familyguard.data.entity.FamilyRelationshipEntity
import com.chainlesschain.android.feature.familyguard.data.entity.SosEventEntity
import com.chainlesschain.android.feature.familyguard.domain.model.GuardianTier
import com.chainlesschain.android.feature.familyguard.domain.model.MemberRole
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyGroupRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyMembershipRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import com.chainlesschain.android.feature.familyguard.data.dao.SosEventDao
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import timber.log.Timber

/**
 * FAMILY-18 ViewModel. 三源聚合:
 *   - FamilyMembershipRepository.observeByGroup → 全 active 成员
 *   - FamilyRelationshipRepository.observeActiveByGroup → 关系 status (含
 *     unbind_pending / emergency_unbound) 用于状态点 + 横幅
 *   - SosEventDao.observePending → 任一 child 当前 SOS pending → 红色高亮
 *
 * v0.1: 接受 familyGroupId 作为 SavedStateHandle 参数; 暂用默认 fixture id 让
 * Hilt 注入跑通, 实际 group id 走 SavedStateHandle 留 FAMILY-XX 接入。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class FamilyMembersViewModel @Inject constructor(
    private val familyGroupRepository: FamilyGroupRepository,
    private val familyMembershipRepository: FamilyMembershipRepository,
    private val familyRelationshipRepository: FamilyRelationshipRepository,
    private val sosEventDao: SosEventDao,
) : ViewModel() {

    // v0.1: hard-coded group id; FAMILY-XX 接 SavedStateHandle
    // 真实场景从首页 / 配对完成跳转时携带
    private val familyGroupId: String = "default-group-id"

    val uiState: StateFlow<FamilyMembersUiState> =
        combine(
            familyMembershipRepository.observeByGroup(familyGroupId),
            familyRelationshipRepository.observeActiveByGroup(familyGroupId),
            sosEventDao.observePending(),
            groupNameFlow(),
        ) { memberships, relationships, sosEvents, groupName ->
            buildState(
                memberships = memberships,
                relationships = relationships,
                sosEvents = sosEvents,
                groupName = groupName,
            )
        }.stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5_000),
            initialValue = FamilyMembersUiState(isLoading = true),
        )

    /** 异步取 group name; 一次性, 不订阅. */
    private fun groupNameFlow() = flow {
        emit(
            try {
                familyGroupRepository.findById(familyGroupId)?.name
            } catch (e: Exception) {
                Timber.w(e, "Failed to load family group")
                null
            },
        )
    }

    /** 内部 pure 函数, 单测可直接调; 主路径 buildState 在 lambda 内部. */
    internal fun buildState(
        memberships: List<FamilyMembershipEntity>,
        relationships: List<FamilyRelationshipEntity>,
        sosEvents: List<SosEventEntity>,
        groupName: String?,
    ): FamilyMembersUiState {
        val byDid = relationships.associateBy { it.friendDid }
        val sosByChildDid = sosEvents.associateBy { it.childDid }

        val items = memberships.map { membership ->
            val rel = byDid[membership.memberDid]
            val role = MemberRole.fromStorage(membership.role) ?: MemberRole.CHILD
            val tier = GuardianTier.fromStorage(membership.guardianTier)
            val status = computeStatus(membership, rel)
            val hasActiveSos = role == MemberRole.CHILD &&
                sosByChildDid[membership.memberDid] != null
            FamilyMemberUiModel(
                memberDid = membership.memberDid,
                role = role,
                tier = tier,
                displayLabel = buildLabel(role, tier),
                status = status,
                hasActiveSos = hasActiveSos,
            )
        }

        val unbindPendingCount = relationships.count { it.status == "unbind_pending" }
        val emergencyUnbindActive = relationships.any { it.status == "emergency_unbound" }

        return FamilyMembersUiState(
            isLoading = false,
            familyGroupName = groupName,
            members = items,
            unbindPendingCount = unbindPendingCount,
            emergencyUnbindActive = emergencyUnbindActive,
            errorMessage = null,
        )
    }

    private fun computeStatus(
        membership: FamilyMembershipEntity,
        rel: FamilyRelationshipEntity?,
    ): FamilyMemberUiModel.MemberStatus {
        // relationship.status 优先 (能体现解绑等 family-level 状态)
        if (rel != null) {
            return when (rel.status) {
                "unbind_pending" -> FamilyMemberUiModel.MemberStatus.UNBIND_PENDING
                "emergency_unbound" -> FamilyMemberUiModel.MemberStatus.EMERGENCY_UNBOUND
                "frozen" -> FamilyMemberUiModel.MemberStatus.FROZEN
                "active" -> FamilyMemberUiModel.MemberStatus.ACTIVE
                else -> FamilyMemberUiModel.MemberStatus.INACTIVE
            }
        }
        // 没 relationship — 仅 membership; 用 membership.status
        return if (membership.status == "active") {
            FamilyMemberUiModel.MemberStatus.ACTIVE
        } else {
            FamilyMemberUiModel.MemberStatus.INACTIVE
        }
    }

    private fun buildLabel(role: MemberRole, tier: GuardianTier?): String = when (role) {
        MemberRole.PARENT -> when (tier) {
            GuardianTier.PRIMARY -> "家长 (主)"
            GuardianTier.SECONDARY -> "家长 (副)"
            null -> "家长"
        }
        MemberRole.CHILD -> "孩子"
        MemberRole.GUARDIAN -> when (tier) {
            GuardianTier.PRIMARY -> "守护人 (主)"
            GuardianTier.SECONDARY -> "守护人 (副)"
            null -> "守护人"
        }
    }
}
