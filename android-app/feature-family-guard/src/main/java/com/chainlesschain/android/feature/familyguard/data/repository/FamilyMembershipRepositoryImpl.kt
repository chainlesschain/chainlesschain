package com.chainlesschain.android.feature.familyguard.data.repository

import com.chainlesschain.android.feature.familyguard.data.dao.FamilyMembershipDao
import com.chainlesschain.android.feature.familyguard.data.entity.FamilyMembershipEntity
import com.chainlesschain.android.feature.familyguard.domain.model.GuardianTier
import com.chainlesschain.android.feature.familyguard.domain.model.MemberRole
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyMembershipRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyMembershipRepository.Companion.DID_MIN_LEN
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyMembershipRepository.Companion.DID_PREFIX
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyMembershipRepository.Companion.INACTIVE_STATUS
import com.chainlesschain.android.feature.familyguard.domain.repository.InvalidFamilyMembershipException
import java.time.Clock
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow

/**
 * FAMILY-11 实装. Clock 注入让 joinedAt 可测。
 *
 * 校验:
 *   - role + tier 一致性:
 *     · CHILD ⇔ tier 必 null
 *     · PARENT / GUARDIAN ⇔ tier 必非 null (PRIMARY 或 SECONDARY)
 *   - memberDid 同 FamilyGroupRepository ("did:" 前缀 + ≥ 8 char)
 *   - deviceId 非空 trim 后非空
 *   - familyGroupId 非空 (Repository 不强求 group 行存在; 留 FAMILY-13 配对流程
 *     在拉起 addMember 前先 FamilyGroupRepository.findById 显式校验)
 */
@Singleton
class FamilyMembershipRepositoryImpl @Inject constructor(
    private val familyMembershipDao: FamilyMembershipDao,
    private val clock: Clock,
) : FamilyMembershipRepository {

    override suspend fun addMember(
        familyGroupId: String,
        memberDid: String,
        role: MemberRole,
        guardianTier: GuardianTier?,
        deviceId: String,
    ): FamilyMembershipEntity {
        val normalizedDeviceId = deviceId.trim()
        validateGroupId(familyGroupId)
        validateDid(memberDid)
        validateDeviceId(normalizedDeviceId)
        validateRoleTier(role, guardianTier)

        val entity = FamilyMembershipEntity(
            familyGroupId = familyGroupId,
            memberDid = memberDid,
            role = role.storageValue,
            guardianTier = guardianTier?.storageValue,
            deviceId = normalizedDeviceId,
            joinedAt = clock.millis(),
            status = "active",
        )
        val id = familyMembershipDao.insert(entity)
        return entity.copy(id = id)
    }

    override fun observeByGroup(familyGroupId: String): Flow<List<FamilyMembershipEntity>> =
        familyMembershipDao.observeByGroup(familyGroupId)

    override suspend fun listAllByGroup(familyGroupId: String): List<FamilyMembershipEntity> =
        familyMembershipDao.listByGroup(familyGroupId)

    override suspend fun listChildren(familyGroupId: String): List<FamilyMembershipEntity> =
        familyMembershipDao.listByGroupAndRole(familyGroupId, MemberRole.CHILD.storageValue)

    override suspend fun listGuardians(
        familyGroupId: String,
        tier: GuardianTier?,
    ): List<FamilyMembershipEntity> =
        if (tier == null) {
            familyMembershipDao.listGuardiansByGroup(familyGroupId)
        } else {
            familyMembershipDao.listGuardiansByGroupAndTier(familyGroupId, tier.storageValue)
        }

    override suspend fun find(
        familyGroupId: String,
        memberDid: String,
        deviceId: String,
    ): FamilyMembershipEntity? =
        familyMembershipDao.findInGroup(familyGroupId, memberDid, deviceId)

    override suspend fun deactivate(id: Long): Boolean =
        familyMembershipDao.updateStatus(id, INACTIVE_STATUS) > 0

    override suspend fun hardDelete(id: Long): Boolean =
        familyMembershipDao.deleteById(id) > 0

    // ─── 校验 ───

    private fun validateGroupId(groupId: String) {
        if (groupId.isBlank()) {
            throw InvalidFamilyMembershipException("familyGroupId must not be blank")
        }
    }

    private fun validateDid(did: String) {
        if (!did.startsWith(DID_PREFIX)) {
            throw InvalidFamilyMembershipException("memberDid must start with `$DID_PREFIX`: $did")
        }
        if (did.length < DID_MIN_LEN) {
            throw InvalidFamilyMembershipException("memberDid length ${did.length} below $DID_MIN_LEN")
        }
    }

    private fun validateDeviceId(deviceId: String) {
        if (deviceId.isBlank()) {
            throw InvalidFamilyMembershipException("deviceId must not be blank")
        }
    }

    private fun validateRoleTier(role: MemberRole, tier: GuardianTier?) {
        when (role) {
            MemberRole.CHILD -> if (tier != null) {
                throw InvalidFamilyMembershipException(
                    "role=CHILD must have null guardianTier; got $tier",
                )
            }
            MemberRole.PARENT, MemberRole.GUARDIAN -> if (tier == null) {
                throw InvalidFamilyMembershipException(
                    "role=$role requires guardianTier (PRIMARY or SECONDARY)",
                )
            }
        }
    }
}
