package com.chainlesschain.android.feature.familyguard.presentation.family

import com.chainlesschain.android.feature.familyguard.data.dao.SosEventDao
import com.chainlesschain.android.feature.familyguard.domain.model.GuardianTier
import com.chainlesschain.android.feature.familyguard.domain.model.MemberRole
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyGroupRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyMembershipRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import com.chainlesschain.android.feature.familyguard.fixtures.FamilyFixtures
import io.mockk.mockk
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * FAMILY-18 验收: 4 角色 + 4 状态 映射 (uiState 转换 pure 函数 buildState()).
 *
 * 不测 stateIn 订阅; 直接调 buildState(memberships, relationships, sosEvents,
 * groupName) 验输出 UiState. 4 角色 = parent primary + parent secondary +
 * child + guardian secondary. 4 状态 = active / unbind_pending /
 * emergency_unbound / sos (在 child 上).
 */
class FamilyMembersViewModelTest {

    private lateinit var vm: FamilyMembersViewModel

    @Before
    fun setUp() {
        // 所有 repo 走 mockk; buildState 是 pure, 不调它们
        vm = FamilyMembersViewModel(
            familyGroupRepository = mockk<FamilyGroupRepository>(relaxed = true),
            familyMembershipRepository = mockk<FamilyMembershipRepository>(relaxed = true),
            familyRelationshipRepository = mockk<FamilyRelationshipRepository>(relaxed = true),
            sosEventDao = mockk<SosEventDao>(relaxed = true),
        )
    }

    // ─── 4 角色 ───

    @Test
    fun `buildState parent PRIMARY membership produces parent role + label`() {
        val mem = FamilyFixtures.fakeParent(
            id = 1L,
            memberDid = "did:dad",
            guardianTier = "primary",
        )
        val state = vm.buildState(
            memberships = listOf(mem),
            relationships = emptyList(),
            sosEvents = emptyList(),
            groupName = "陈家",
        )
        assertEquals(1, state.members.size)
        val m = state.members[0]
        assertEquals(MemberRole.PARENT, m.role)
        assertEquals(GuardianTier.PRIMARY, m.tier)
        assertEquals("家长 (主)", m.displayLabel)
    }

    @Test
    fun `buildState parent SECONDARY produces correct label`() {
        val mem = FamilyFixtures.fakeParent(
            id = 1L,
            memberDid = "did:stepdad",
            guardianTier = "secondary",
        )
        val state = vm.buildState(
            memberships = listOf(mem),
            relationships = emptyList(),
            sosEvents = emptyList(),
            groupName = null,
        )
        assertEquals("家长 (副)", state.members[0].displayLabel)
        assertEquals(GuardianTier.SECONDARY, state.members[0].tier)
    }

    @Test
    fun `buildState child membership produces child role + 孩子 label + null tier`() {
        val mem = FamilyFixtures.fakeChild(memberDid = "did:kid")
        val state = vm.buildState(
            memberships = listOf(mem),
            relationships = emptyList(),
            sosEvents = emptyList(),
            groupName = null,
        )
        val m = state.members[0]
        assertEquals(MemberRole.CHILD, m.role)
        assertEquals("孩子", m.displayLabel)
        assertEquals(null, m.tier)
    }

    @Test
    fun `buildState guardian SECONDARY produces 守护人 label`() {
        val mem = FamilyFixtures.fakeGuardian(
            memberDid = "did:grandma",
            guardianTier = "secondary",
        )
        val state = vm.buildState(
            memberships = listOf(mem),
            relationships = emptyList(),
            sosEvents = emptyList(),
            groupName = null,
        )
        assertEquals(MemberRole.GUARDIAN, state.members[0].role)
        assertEquals(GuardianTier.SECONDARY, state.members[0].tier)
        assertEquals("守护人 (副)", state.members[0].displayLabel)
    }

    // ─── 4 状态 ───

    @Test
    fun `buildState active relationship toACTIVE status`() {
        val mem = FamilyFixtures.fakeParent(memberDid = "did:dad", guardianTier = "primary")
        val rel = FamilyFixtures.fakeRelationship(friendDid = "did:dad", status = "active")
        val state = vm.buildState(
            memberships = listOf(mem),
            relationships = listOf(rel),
            sosEvents = emptyList(),
            groupName = null,
        )
        assertEquals(
            FamilyMemberUiModel.MemberStatus.ACTIVE,
            state.members[0].status,
        )
        assertEquals(0, state.unbindPendingCount)
        assertFalse(state.emergencyUnbindActive)
    }

    @Test
    fun `buildState unbind_pending relationship toUNBIND_PENDING + banner count`() {
        val mem = FamilyFixtures.fakeParent(memberDid = "did:dad", guardianTier = "primary")
        val rel = FamilyFixtures.fakeRelationship(
            friendDid = "did:dad",
            status = "unbind_pending",
        )
        val state = vm.buildState(
            memberships = listOf(mem),
            relationships = listOf(rel),
            sosEvents = emptyList(),
            groupName = null,
        )
        assertEquals(
            FamilyMemberUiModel.MemberStatus.UNBIND_PENDING,
            state.members[0].status,
        )
        assertEquals(1, state.unbindPendingCount)
        assertFalse(state.emergencyUnbindActive)
    }

    @Test
    fun `buildState emergency_unbound relationship toEMERGENCY status + banner`() {
        val mem = FamilyFixtures.fakeParent(memberDid = "did:dad", guardianTier = "primary")
        val rel = FamilyFixtures.fakeRelationship(
            friendDid = "did:dad",
            status = "emergency_unbound",
        )
        val state = vm.buildState(
            memberships = listOf(mem),
            relationships = listOf(rel),
            sosEvents = emptyList(),
            groupName = null,
        )
        assertEquals(
            FamilyMemberUiModel.MemberStatus.EMERGENCY_UNBOUND,
            state.members[0].status,
        )
        assertTrue(state.emergencyUnbindActive)
    }

    @Test
    fun `buildState SOS on child tohasActiveSos true`() {
        val kid = FamilyFixtures.fakeChild(memberDid = "did:kid")
        val sos = FamilyFixtures.fakeSosEvent(
            childDid = "did:kid",
            status = "pending",
        )
        val state = vm.buildState(
            memberships = listOf(kid),
            relationships = emptyList(),
            sosEvents = listOf(sos),
            groupName = null,
        )
        assertTrue(state.members[0].hasActiveSos)
    }

    @Test
    fun `buildState SOS on different child does not affect this child`() {
        val kid = FamilyFixtures.fakeChild(memberDid = "did:kid1")
        val sos = FamilyFixtures.fakeSosEvent(
            childDid = "did:other-kid",
            status = "pending",
        )
        val state = vm.buildState(
            memberships = listOf(kid),
            relationships = emptyList(),
            sosEvents = listOf(sos),
            groupName = null,
        )
        assertFalse(state.members[0].hasActiveSos)
    }

    @Test
    fun `buildState SOS on parent does not mark hasActiveSos (only child)`() {
        val dad = FamilyFixtures.fakeParent(
            memberDid = "did:dad",
            guardianTier = "primary",
        )
        val sos = FamilyFixtures.fakeSosEvent(
            childDid = "did:dad",
            status = "pending",
        )
        val state = vm.buildState(
            memberships = listOf(dad),
            relationships = emptyList(),
            sosEvents = listOf(sos),
            groupName = null,
        )
        // SOS 只对 child 角色高亮 (业务设计: 家长不会触发自己 SOS)
        assertFalse(state.members[0].hasActiveSos)
    }

    // ─── 整体场景: 1 group + 2 parent + 1 child + 1 guardian (5 行) ───

    @Test
    fun `buildState typical family (2 parent + 1 child + 1 guardian) all status correct`() {
        val dad = FamilyFixtures.fakeParent(
            id = 1L,
            memberDid = "did:dad",
            guardianTier = "primary",
        )
        val mom = FamilyFixtures.fakeParent(
            id = 2L,
            memberDid = "did:mom",
            guardianTier = "primary",
        )
        val kid = FamilyFixtures.fakeChild(id = 3L, memberDid = "did:kid")
        val grandma = FamilyFixtures.fakeGuardian(
            id = 4L,
            memberDid = "did:grandma",
            guardianTier = "secondary",
        )

        val state = vm.buildState(
            memberships = listOf(dad, mom, kid, grandma),
            relationships = emptyList(),
            sosEvents = emptyList(),
            groupName = "陈家",
        )

        assertEquals(4, state.members.size)
        assertEquals("陈家", state.familyGroupName)
        assertEquals(
            setOf("家长 (主)", "孩子", "守护人 (副)"),
            state.members.map { it.displayLabel }.toSet(),
        )
    }

    @Test
    fun `buildState surfaces a bound relationship friend even without a membership row`() {
        // 孩子端配对后: 只有自己的 membership + 到家长的 relationship (家长 membership 尚未同步)。
        val kid = FamilyFixtures.fakeChild(memberDid = "did:kid")
        val relToParent = FamilyFixtures.fakeRelationship(
            friendDid = "did:dad",
            roleSelf = "child",
            roleOther = "parent",
            status = "active",
        )
        val state = vm.buildState(
            memberships = listOf(kid),
            relationships = listOf(relToParent),
            sosEvents = emptyList(),
            groupName = "陈家",
        )
        assertEquals(2, state.members.size)
        val parent = state.members.first { it.memberDid == "did:dad" }
        assertEquals(MemberRole.PARENT, parent.role)
        assertEquals(FamilyMemberUiModel.MemberStatus.ACTIVE, parent.status)
    }

    @Test
    fun `buildState empty memberships toempty member list + not loading`() {
        val state = vm.buildState(
            memberships = emptyList(),
            relationships = emptyList(),
            sosEvents = emptyList(),
            groupName = "陈家",
        )
        assertTrue(state.members.isEmpty())
        assertFalse(state.isLoading)
        assertEquals("陈家", state.familyGroupName)
    }

    @Test
    fun `buildState membership without relationship uses membership status`() {
        val inactive = FamilyFixtures.fakeChild(
            memberDid = "did:kid-inactive",
            status = "inactive",
        )
        val state = vm.buildState(
            memberships = listOf(inactive),
            relationships = emptyList(),
            sosEvents = emptyList(),
            groupName = null,
        )
        assertEquals(
            FamilyMemberUiModel.MemberStatus.INACTIVE,
            state.members[0].status,
        )
    }

    @Test
    fun `buildState multiple unbind_pending relationships tounbindPendingCount accurate`() {
        val mems = listOf(
            FamilyFixtures.fakeParent(memberDid = "did:dad", guardianTier = "primary"),
            FamilyFixtures.fakeParent(memberDid = "did:mom", guardianTier = "primary"),
        )
        val rels = listOf(
            FamilyFixtures.fakeRelationship(friendDid = "did:dad", status = "unbind_pending"),
            FamilyFixtures.fakeRelationship(friendDid = "did:mom", status = "unbind_pending"),
        )
        val state = vm.buildState(
            memberships = mems,
            relationships = rels,
            sosEvents = emptyList(),
            groupName = null,
        )
        assertEquals(2, state.unbindPendingCount)
    }

    @Test
    fun `buildState relationship null fallback to membership status`() {
        val mem = FamilyFixtures.fakeChild(memberDid = "did:kid", status = "active")
        val state = vm.buildState(
            memberships = listOf(mem),
            relationships = emptyList(), // 无 relationship
            sosEvents = emptyList(),
            groupName = null,
        )
        assertEquals(
            FamilyMemberUiModel.MemberStatus.ACTIVE,
            state.members[0].status,
        )
    }
}
