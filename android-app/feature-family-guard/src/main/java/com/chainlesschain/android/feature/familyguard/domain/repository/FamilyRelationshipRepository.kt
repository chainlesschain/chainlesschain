package com.chainlesschain.android.feature.familyguard.domain.repository

import com.chainlesschain.android.feature.familyguard.data.entity.FamilyRelationshipEntity
import com.chainlesschain.android.feature.familyguard.domain.model.GuardianTier
import com.chainlesschain.android.feature.familyguard.domain.model.MemberRole
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.FamilyPermissions
import kotlinx.coroutines.flow.Flow

/**
 * Family-friend (亲子特殊好友) 关系仓库 (FAMILY-12).
 *
 * v0.1 范围:
 *   - create + updatePermissions + 读路径
 *   - 状态转 active 默认; unbind / emergency-unbind 状态机走 FAMILY-15 / 16
 *
 * 校验:
 *   - friendDid: "did:" 前缀 + ≥ 8 char
 *   - permissions: 通过 [FamilyPermissions.encode] 隐式 schema 校验; 业务级
 *     cross-field check 在 [validatePermissions] 中 (quiet_hours 累计 ≤
 *     [FamilyPermissions._quietHoursMaxPerDayMin])
 *   - emergencyContacts: 非空必须可被解析为 JSON
 */
interface FamilyRelationshipRepository {

    suspend fun create(
        familyGroupId: String,
        friendDid: String,
        roleSelf: MemberRole,
        roleOther: MemberRole,
        guardianTierOther: GuardianTier? = null,
        permissions: FamilyPermissions,
        emergencyContactsJson: String? = null,
        boundEvidence: String? = null,
    ): FamilyRelationshipEntity

    suspend fun findById(id: Long): FamilyRelationshipEntity?

    suspend fun findByFriendDid(friendDid: String): FamilyRelationshipEntity?

    fun observeAllActive(): Flow<List<FamilyRelationshipEntity>>

    fun observeActiveByGroup(groupId: String): Flow<List<FamilyRelationshipEntity>>

    /** 读 entity 后解码 permissions JSON → [FamilyPermissions] 类型化对象. */
    suspend fun readPermissions(id: Long): FamilyPermissions?

    suspend fun updatePermissions(id: Long, permissions: FamilyPermissions): Boolean

    suspend fun updateEmergencyContacts(id: Long, emergencyContactsJson: String?): Boolean

    companion object {
        const val DID_PREFIX = "did:"
        const val DID_MIN_LEN = 8
    }
}

class InvalidFamilyRelationshipException(
    message: String,
    cause: Throwable? = null,
) : IllegalArgumentException(message, cause)
