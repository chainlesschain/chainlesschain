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
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

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

    /**
     * group id 动态解析 (此前硬编码 "default-group-id" → 配对建的真实 ULID 组查不到,
     * 家人页恒空)。本机一个家庭, 取 observeAll 第一组; 其 membership/relationship/name
     * 随之响应式刷新。无任何组 → 空态。
     */
    val uiState: StateFlow<FamilyMembersUiState> =
        familyGroupRepository.observeAll().flatMapLatest { groups ->
            val group = groups.firstOrNull()
            if (group == null) {
                flowOf(FamilyMembersUiState(isLoading = false))
            } else {
                combine(
                    familyMembershipRepository.observeByGroup(group.id),
                    familyRelationshipRepository.observeActiveByGroup(group.id),
                    sosEventDao.observePending(),
                ) { memberships, relationships, sosEvents ->
                    buildState(
                        memberships = memberships,
                        relationships = relationships,
                        sosEvents = sosEvents,
                        groupName = group.name,
                    )
                }
            }
        }.stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5_000),
            initialValue = FamilyMembersUiState(isLoading = true),
        )

    /** 内部 pure 函数, 单测可直接调; 主路径 buildState 在 lambda 内部. */
    internal fun buildState(
        memberships: List<FamilyMembershipEntity>,
        relationships: List<FamilyRelationshipEntity>,
        sosEvents: List<SosEventEntity>,
        groupName: String?,
    ): FamilyMembersUiState {
        val byDid = relationships.associateBy { it.friendDid }
        val sosByChildDid = sosEvents.associateBy { it.childDid }

        // 保序去重: 先 membership, 再补"仅有 relationship 的对端"(对端 membership 尚未
        // P2P 同步过来时, 让已绑定的家人也能在家人页显示, 否则配对成功却看不到对方)。
        val items = LinkedHashMap<String, FamilyMemberUiModel>()
        memberships.forEach { membership ->
            val rel = byDid[membership.memberDid]
            val role = MemberRole.fromStorage(membership.role) ?: MemberRole.CHILD
            val tier = GuardianTier.fromStorage(membership.guardianTier)
            items[membership.memberDid] = FamilyMemberUiModel(
                memberDid = membership.memberDid,
                role = role,
                tier = tier,
                displayLabel = buildLabel(role, tier),
                status = computeStatus(membership, rel),
                hasActiveSos = role == MemberRole.CHILD &&
                    sosByChildDid[membership.memberDid] != null,
            )
        }
        relationships.forEach { rel ->
            if (!items.containsKey(rel.friendDid)) {
                val role = MemberRole.fromStorage(rel.roleOther) ?: MemberRole.PARENT
                val tier = GuardianTier.fromStorage(rel.guardianTierOther)
                items[rel.friendDid] = FamilyMemberUiModel(
                    memberDid = rel.friendDid,
                    role = role,
                    tier = tier,
                    displayLabel = buildLabel(role, tier),
                    status = statusFromRelationship(rel),
                    hasActiveSos = role == MemberRole.CHILD &&
                        sosByChildDid[rel.friendDid] != null,
                )
            }
        }

        val unbindPendingCount = relationships.count { it.status == "unbind_pending" }
        val emergencyUnbindActive = relationships.any { it.status == "emergency_unbound" }

        return FamilyMembersUiState(
            isLoading = false,
            familyGroupName = groupName,
            members = items.values.toList(),
            unbindPendingCount = unbindPendingCount,
            emergencyUnbindActive = emergencyUnbindActive,
            errorMessage = null,
        )
    }

    private fun statusFromRelationship(rel: FamilyRelationshipEntity): FamilyMemberUiModel.MemberStatus =
        when (rel.status) {
            "unbind_pending" -> FamilyMemberUiModel.MemberStatus.UNBIND_PENDING
            "emergency_unbound" -> FamilyMemberUiModel.MemberStatus.EMERGENCY_UNBOUND
            "frozen" -> FamilyMemberUiModel.MemberStatus.FROZEN
            "active" -> FamilyMemberUiModel.MemberStatus.ACTIVE
            else -> FamilyMemberUiModel.MemberStatus.INACTIVE
        }

    private fun computeStatus(
        membership: FamilyMembershipEntity,
        rel: FamilyRelationshipEntity?,
    ): FamilyMemberUiModel.MemberStatus {
        // relationship.status 优先 (能体现解绑等 family-level 状态)
        if (rel != null) return statusFromRelationship(rel)
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
