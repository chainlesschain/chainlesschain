package com.chainlesschain.android.feature.familyguard.domain.repository

import com.chainlesschain.android.feature.familyguard.data.entity.FamilyMembershipEntity
import com.chainlesschain.android.feature.familyguard.domain.model.GuardianTier
import com.chainlesschain.android.feature.familyguard.domain.model.MemberRole
import com.chainlesschain.android.feature.familyguard.domain.sync.FamilyMembershipSyncRecord
import kotlinx.coroutines.flow.Flow

/**
 * Family membership repository (FAMILY-11).
 *
 * 主文档 §3.1 v0.2 多孩子家庭 + 多家长共同监护:
 *   - 一个 family_group 可有 N PARENT (含 PRIMARY + SECONDARY tier)
 *   - 一个 family_group 可有 N CHILD (多孩子家庭)
 *   - 一个 family_group 可有 N GUARDIAN (爷爷奶奶 / 阿姨 etc., 必 SECONDARY)
 *   - 一个 member_did 可绑多设备 (UNIQUE(group, member, device) 区分行)
 *
 * 业务校验:
 *   - role=CHILD: tier 必须 null
 *   - role=PARENT or GUARDIAN: tier 必须非 null
 *   - memberDid: "did:" 前缀 + ≥ 8 char (与 FamilyGroupRepository 一致)
 *   - deviceId: 非空 trim 后非空
 *
 * 违反任一抛 [InvalidFamilyMembershipException]。
 */
interface FamilyMembershipRepository {

    /** 加入新成员到 group; 重复 (group, member, device) 抛 (ABORT)。 */
    suspend fun addMember(
        familyGroupId: String,
        memberDid: String,
        role: MemberRole,
        guardianTier: GuardianTier?,
        deviceId: String,
    ): FamilyMembershipEntity

    /**
     * FAMILY-26: 据同步记录按**自然键 (group, member, device)** upsert 一个 membership 副本
     * (入站同步落库)。与 [addMember] 区别: 幂等覆盖 (REPLACE) 而非重复即 ABORT, 且不自生成
     * joinedAt (用记录里的)。
     */
    suspend fun upsertReplica(record: FamilyMembershipSyncRecord)

    /** UI 用; 通常订阅 group 内全 active 成员变化。 */
    fun observeByGroup(familyGroupId: String): Flow<List<FamilyMembershipEntity>>

    suspend fun listAllByGroup(familyGroupId: String): List<FamilyMembershipEntity>

    suspend fun listChildren(familyGroupId: String): List<FamilyMembershipEntity>

    /**
     * 列 group 内 guardians (含 PARENT + GUARDIAN 两 role).
     * @param tier null = 不过滤 (返 primary + secondary 全部); 否则按 tier 过滤
     */
    suspend fun listGuardians(
        familyGroupId: String,
        tier: GuardianTier? = null,
    ): List<FamilyMembershipEntity>

    suspend fun find(
        familyGroupId: String,
        memberDid: String,
        deviceId: String,
    ): FamilyMembershipEntity?

    /** 软删 (status → 'inactive'); 真删走 [hardDelete]。 */
    suspend fun deactivate(id: Long): Boolean

    suspend fun hardDelete(id: Long): Boolean

    companion object {
        const val DID_PREFIX = "did:"
        const val DID_MIN_LEN = 8
        const val INACTIVE_STATUS = "inactive"
    }
}

class InvalidFamilyMembershipException(
    message: String,
    cause: Throwable? = null,
) : IllegalArgumentException(message, cause)
