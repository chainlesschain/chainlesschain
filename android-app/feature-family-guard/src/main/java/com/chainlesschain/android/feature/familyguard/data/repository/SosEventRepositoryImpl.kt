package com.chainlesschain.android.feature.familyguard.data.repository

import com.chainlesschain.android.feature.familyguard.data.dao.SosEventDao
import com.chainlesschain.android.feature.familyguard.data.entity.SosEventEntity
import com.chainlesschain.android.feature.familyguard.domain.repository.SosEventRepository
import com.chainlesschain.android.feature.familyguard.domain.sos.SosStatus
import com.chainlesschain.android.feature.familyguard.domain.sos.SosTransitionResult
import com.chainlesschain.android.feature.familyguard.domain.sos.SosTriggerSource
import com.chainlesschain.android.feature.familyguard.domain.time.TimeAuthority
import java.security.SecureRandom
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow

/**
 * FAMILY-40 实装. 时刻走 [TimeAuthority.authoritativeNow] (防改钟误记紧急事件时序);
 * 状态转换走 DAO 原子 SQL + WHERE status 守卫, 据影响行数判 [SosTransitionResult]
 * (同 UnbindStateMachineImpl 模式)。
 *
 * id 用 ULID-ish (时序前缀 + 随机后缀), 与 FamilyGroupRepositoryImpl 同款近似实现
 * (非 RFC ULID; 产品做大后再统一升 :core-database ULID lib)。
 */
@Singleton
class SosEventRepositoryImpl @Inject constructor(
    private val sosEventDao: SosEventDao,
    private val timeAuthority: TimeAuthority,
    // 不给默认值: `@Inject constructor(x = Default())` 会让 Kotlin 生成双构造器 → Dagger
    // 报 "may only contain one injected constructor" ([[android_inject_default_param_dual_ctor]])。
    // SecureRandom 由 FamilyGuardModule.provideSecureRandom 供给; 单测显式传 fixed-seed。
    private val secureRandom: SecureRandom,
) : SosEventRepository {

    override suspend fun trigger(
        childDid: String,
        familyGroupId: String,
        source: SosTriggerSource,
        locationSnapshot: String?,
        audioRecordingRef: String?,
    ): SosEventEntity {
        require(childDid.isNotBlank()) { "childDid must not be blank" }
        require(familyGroupId.isNotBlank()) { "familyGroupId must not be blank" }

        val now = timeAuthority.authoritativeNow()
        val entity = SosEventEntity(
            id = generateUlid(now),
            childDid = childDid,
            familyGroupId = familyGroupId,
            triggeredAt = now,
            triggerSource = source.storageValue,
            locationSnapshot = locationSnapshot,
            audioRecordingRef = audioRecordingRef,
            status = SosStatus.PENDING.storageValue,
        )
        sosEventDao.upsert(entity)
        return entity
    }

    override suspend fun acknowledge(id: String, guardianDid: String): SosTransitionResult {
        val rows = sosEventDao.markAcknowledged(id, guardianDid, timeAuthority.authoritativeNow())
        return resultFor(id, rows)
    }

    override suspend fun resolve(id: String, note: String?): SosTransitionResult {
        val rows = sosEventDao.markResolved(id, timeAuthority.authoritativeNow(), note)
        return resultFor(id, rows)
    }

    override suspend fun cancelAsFalseAlarm(id: String, reason: String): SosTransitionResult {
        val rows = sosEventDao.markFalseAlarm(id, timeAuthority.authoritativeNow(), reason)
        return resultFor(id, rows)
    }

    override fun observePending(): Flow<List<SosEventEntity>> = sosEventDao.observePending()

    override fun observeRecentForChild(childDid: String, limit: Int): Flow<List<SosEventEntity>> =
        sosEventDao.observeRecentForChild(childDid, limit)

    override suspend fun findById(id: String): SosEventEntity? = sosEventDao.findById(id)

    /** SQL 未影响行 → 查实体区分"不存在"与"当前状态不允许该转换"。 */
    private suspend fun resultFor(id: String, rowsAffected: Int): SosTransitionResult {
        if (rowsAffected > 0) return SosTransitionResult.Success
        val existing = sosEventDao.findById(id) ?: return SosTransitionResult.NotFound
        val current = SosStatus.fromStorage(existing.status) ?: SosStatus.PENDING
        return SosTransitionResult.InvalidState(current)
    }

    // ─── ULID-ish (同 FamilyGroupRepositoryImpl; 非 RFC) ───

    private fun generateUlid(nowMs: Long): String {
        val ts = nowMs and 0x0000FFFFFFFFFFFFL // 48 bits
        return encodeBase32(ts, length = 10) + randomSuffix(length = 16)
    }

    private fun randomSuffix(length: Int): String {
        val sb = StringBuilder(length)
        repeat(length) { sb.append(CROCKFORD[secureRandom.nextInt(CROCKFORD.length)]) }
        return sb.toString()
    }

    private fun encodeBase32(value: Long, length: Int): String {
        val chars = CharArray(length)
        var v = value
        for (i in length - 1 downTo 0) {
            chars[i] = CROCKFORD[(v and 0x1F).toInt()]
            v = v shr 5
        }
        return String(chars)
    }

    private companion object {
        // Crockford base32 (无 I/L/O/U), 与 FamilyGroupRepositoryImpl 一致。
        const val CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    }
}
