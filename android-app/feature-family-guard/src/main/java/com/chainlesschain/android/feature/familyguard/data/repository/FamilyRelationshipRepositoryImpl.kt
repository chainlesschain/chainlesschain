package com.chainlesschain.android.feature.familyguard.data.repository

import com.chainlesschain.android.feature.familyguard.data.dao.FamilyRelationshipDao
import com.chainlesschain.android.feature.familyguard.data.entity.FamilyRelationshipEntity
import com.chainlesschain.android.feature.familyguard.domain.model.GuardianTier
import com.chainlesschain.android.feature.familyguard.domain.model.MemberRole
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.FamilyPermissions
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.InvalidFamilyPermissionsException
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.QuietHourWindow
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository.Companion.DID_MIN_LEN
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository.Companion.DID_PREFIX
import com.chainlesschain.android.feature.familyguard.domain.repository.InvalidFamilyRelationshipException
import java.time.Clock
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json

/**
 * FAMILY-12 实装.
 *
 * 设计决策:
 *   - permissions 走 [FamilyPermissions] 类型化 + JSON encode 存 entity 列;
 *     调用方拿 entity 后再 decode 还原。两步分离让 DAO 不依赖 kotlinx-serialization。
 *   - 跨字段校验 [validatePermissions] 仅校验 quiet_hours 累计 ≤ 上限; 其他业务
 *     规则 (e.g. "allow_silent_observe=true 时 allow_force_pickup 必关") 留
 *     FAMILY-14 Permission Engine。
 *   - emergencyContacts 仅校验 JSON 可解析 (不强求 schema), 因主文档 §3.1 v0.2
 *     未固化 schema (FAMILY-45 SOS 60s 兜底落地时再固化字段)。
 */
@Singleton
class FamilyRelationshipRepositoryImpl @Inject constructor(
    private val familyRelationshipDao: FamilyRelationshipDao,
    private val clock: Clock,
) : FamilyRelationshipRepository {

    private val emergencyContactsJsonParser = Json { ignoreUnknownKeys = true }

    override suspend fun create(
        familyGroupId: String,
        friendDid: String,
        roleSelf: MemberRole,
        roleOther: MemberRole,
        guardianTierOther: GuardianTier?,
        permissions: FamilyPermissions,
        emergencyContactsJson: String?,
        boundEvidence: String?,
    ): FamilyRelationshipEntity {
        validateGroupId(familyGroupId)
        validateDid(friendDid)
        validatePermissions(permissions)
        validateEmergencyContacts(emergencyContactsJson)

        val now = clock.millis()
        val entity = FamilyRelationshipEntity(
            familyGroupId = familyGroupId,
            friendDid = friendDid,
            roleSelf = roleSelf.storageValue,
            roleOther = roleOther.storageValue,
            guardianTierOther = guardianTierOther?.storageValue,
            boundAt = now,
            boundEvidence = boundEvidence,
            permissions = FamilyPermissions.encode(permissions),
            emergencyContacts = emergencyContactsJson,
            status = "active",
            createdAt = now,
            updatedAt = now,
        )
        val id = familyRelationshipDao.insert(entity)
        return entity.copy(id = id)
    }

    override suspend fun findById(id: Long): FamilyRelationshipEntity? =
        familyRelationshipDao.findById(id)

    override suspend fun findByFriendDid(friendDid: String): FamilyRelationshipEntity? =
        familyRelationshipDao.findByFriendDid(friendDid)

    override fun observeAllActive(): Flow<List<FamilyRelationshipEntity>> =
        familyRelationshipDao.observeAllActive()

    override fun observeActiveByGroup(groupId: String): Flow<List<FamilyRelationshipEntity>> =
        familyRelationshipDao.observeActive(groupId)

    override suspend fun readPermissions(id: Long): FamilyPermissions? {
        val entity = familyRelationshipDao.findById(id) ?: return null
        return runCatching { FamilyPermissions.decode(entity.permissions) }
            .getOrElse { e ->
                // permissions 列损坏 (旧版本 / 手工 SQL 注入); 抛清晰错而非 silent null
                throw InvalidFamilyRelationshipException(
                    "stored permissions for relationship id=$id is malformed JSON",
                    cause = e,
                )
            }
    }

    override suspend fun updatePermissions(id: Long, permissions: FamilyPermissions): Boolean {
        validatePermissions(permissions)
        val encoded = FamilyPermissions.encode(permissions)
        return familyRelationshipDao.updatePermissions(
            id = id,
            permissionsJson = encoded,
            updatedAt = clock.millis(),
        ) > 0
    }

    override suspend fun updateEmergencyContacts(
        id: Long,
        emergencyContactsJson: String?,
    ): Boolean {
        validateEmergencyContacts(emergencyContactsJson)
        return familyRelationshipDao.updateEmergencyContacts(
            id = id,
            emergencyContactsJson = emergencyContactsJson,
            updatedAt = clock.millis(),
        ) > 0
    }

    // ─── 校验 ───

    private fun validateGroupId(groupId: String) {
        if (groupId.isBlank()) {
            throw InvalidFamilyRelationshipException("familyGroupId must not be blank")
        }
    }

    private fun validateDid(did: String) {
        if (!did.startsWith(DID_PREFIX)) {
            throw InvalidFamilyRelationshipException("friendDid must start with `$DID_PREFIX`: $did")
        }
        if (did.length < DID_MIN_LEN) {
            throw InvalidFamilyRelationshipException("friendDid length ${did.length} below $DID_MIN_LEN")
        }
    }

    /**
     * 业务级 cross-field 校验 (主文档 §3.2 v0.2):
     *   - quiet_hours 单窗口 ≤ 24h
     *   - quiet_hours 全部窗口累计 (按 weekday_only 是否计入) ≤ _quietHoursMaxPerDayMin
     *
     * 跨午夜窗口由 [QuietHourWindow.durationMinutes] 内部已处理。
     */
    private fun validatePermissions(permissions: FamilyPermissions) {
        val cap = permissions._quietHoursMaxPerDayMin
        if (cap !in 0..QuietHourWindow.DAY_MINUTES) {
            throw InvalidFamilyPermissionsException(
                "_quiet_hours_max_per_day_min ($cap) out of [0, ${QuietHourWindow.DAY_MINUTES}]",
            )
        }
        val totalMin = permissions.telemetryQuietHours.sumOf { it.durationMinutes() }
        if (totalMin > cap) {
            throw InvalidFamilyPermissionsException(
                "telemetry_quiet_hours total $totalMin min exceeds cap $cap min",
            )
        }
    }

    private fun validateEmergencyContacts(contactsJson: String?) {
        if (contactsJson.isNullOrBlank()) return
        // 不强求 schema; 允许 array (主文档 §3.1 v0.2 示例) 或 object;
        // 仅校验 parseToJsonElement 能成功 (语法 OK)。
        runCatching { emergencyContactsJsonParser.parseToJsonElement(contactsJson) }
            .onFailure { e ->
                throw InvalidFamilyRelationshipException(
                    "emergencyContactsJson is not valid JSON",
                    cause = e,
                )
            }
    }
}
