package com.chainlesschain.android.feature.familyguard.data.repository

import com.chainlesschain.android.feature.familyguard.data.dao.FamilyGroupDao
import com.chainlesschain.android.feature.familyguard.data.entity.FamilyGroupEntity
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyGroupRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyGroupRepository.Companion.DID_MIN_LEN
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyGroupRepository.Companion.DID_PREFIX
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyGroupRepository.Companion.NAME_MAX_LEN
import com.chainlesschain.android.feature.familyguard.domain.repository.InvalidFamilyGroupException
import java.security.SecureRandom
import java.time.Clock
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json

/**
 * FAMILY-10 实装. Clock + SecureRandom 注入让 ULID 生成可重现; 单测 fixed seed
 * + Clock.fixed 后 ID 完全确定。
 *
 * 验证策略 (主文档 §3.1 + 业务约束):
 *   - name: 非空 trim 后 ≤ NAME_MAX_LEN
 *   - primary_did: 以 "did:" 开头 + 总长 ≥ DID_MIN_LEN
 *   - metadata: 非空时必须 parseToJsonElement 成功; 拒绝 plain string / 数字, 因
 *     family_group.metadata_json 应该是结构化扩展 (家庭照 / 约定 / etc.)
 *
 * 注意 ULID-ish 实现非 RFC ULID, 仅"时序 + 随机"近似: 10-char Crockford
 * timestamp (毫秒级, 35+ 年内不溢) + 16-char Crockford 随机 = 26 字符总长。
 * RFC 严格 ULID 留产品做大后再升 (与 :core-database 主库的 ULID lib 复用).
 */
@Singleton
class FamilyGroupRepositoryImpl @Inject constructor(
    private val familyGroupDao: FamilyGroupDao,
    private val clock: Clock,
    private val secureRandom: SecureRandom = SecureRandom(),
) : FamilyGroupRepository {

    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun create(
        name: String,
        primaryDid: String,
        metadataJson: String?,
    ): FamilyGroupEntity {
        val normalizedName = name.trim()
        validateName(normalizedName)
        validateDid(primaryDid)
        validateMetadata(metadataJson)

        val entity = FamilyGroupEntity(
            id = generateUlid(),
            name = normalizedName,
            primaryDid = primaryDid,
            createdAt = clock.millis(),
            metadataJson = metadataJson,
        )
        familyGroupDao.insert(entity)
        return entity
    }

    override suspend fun findById(id: String): FamilyGroupEntity? =
        familyGroupDao.findById(id)

    override fun observeAll(): Flow<List<FamilyGroupEntity>> =
        familyGroupDao.observeAll()

    override suspend fun rename(id: String, newName: String): Boolean {
        val normalized = newName.trim()
        validateName(normalized)
        if (!familyGroupDao.exists(id)) return false
        return familyGroupDao.updateName(id, normalized) > 0
    }

    override suspend fun updateMetadata(id: String, newMetadataJson: String?): Boolean {
        validateMetadata(newMetadataJson)
        if (!familyGroupDao.exists(id)) return false
        return familyGroupDao.updateMetadata(id, newMetadataJson) > 0
    }

    override suspend fun delete(id: String): Boolean =
        familyGroupDao.deleteById(id) > 0

    // ─── 校验 ───

    private fun validateName(name: String) {
        if (name.isBlank()) {
            throw InvalidFamilyGroupException("name must not be blank")
        }
        if (name.length > NAME_MAX_LEN) {
            throw InvalidFamilyGroupException("name length ${name.length} exceeds $NAME_MAX_LEN")
        }
    }

    private fun validateDid(did: String) {
        if (!did.startsWith(DID_PREFIX)) {
            throw InvalidFamilyGroupException("primary_did must start with `$DID_PREFIX`: $did")
        }
        if (did.length < DID_MIN_LEN) {
            throw InvalidFamilyGroupException("primary_did length ${did.length} below $DID_MIN_LEN")
        }
    }

    private fun validateMetadata(metadataJson: String?) {
        if (metadataJson.isNullOrBlank()) return
        runCatching { json.parseToJsonElement(metadataJson) }
            .onFailure { e ->
                throw InvalidFamilyGroupException("metadata_json is not valid JSON", e)
            }
    }

    // ─── ULID-ish 实现 ───

    internal fun generateUlid(): String {
        val ts = clock.millis() and 0x0000FFFFFFFFFFFFL // 48 bits
        return encodeBase32(ts, length = 10) + randomSuffix(length = 16)
    }

    private fun randomSuffix(length: Int): String {
        val sb = StringBuilder(length)
        repeat(length) {
            sb.append(CROCKFORD[secureRandom.nextInt(CROCKFORD.size)])
        }
        return sb.toString()
    }

    private fun encodeBase32(value: Long, length: Int): String {
        val sb = StringBuilder(length)
        var n = value
        repeat(length) {
            sb.insert(0, CROCKFORD[(n and 0x1FL).toInt()])
            n = n ushr 5
        }
        return sb.toString()
    }

    companion object {
        /** Crockford base32 (无 I / L / O / U; ULID 用同款). */
        private val CROCKFORD =
            "0123456789ABCDEFGHJKMNPQRSTVWXYZ".toCharArray()
    }
}
