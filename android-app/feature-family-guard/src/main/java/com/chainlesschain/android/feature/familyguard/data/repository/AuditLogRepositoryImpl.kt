package com.chainlesschain.android.feature.familyguard.data.repository

import com.chainlesschain.android.feature.familyguard.data.dao.AuditLogDao
import com.chainlesschain.android.feature.familyguard.data.entity.AuditLogEntity
import com.chainlesschain.android.feature.familyguard.domain.audit.AuditAction
import com.chainlesschain.android.feature.familyguard.domain.repository.AuditLogRepository
import java.time.Clock
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow

/**
 * FAMILY-63 实装. append-only 写入 + 查询; 无删除/更新 (主文档 §4.6 不可删)。
 *
 * actionAtMs 缺省用 [clock] (动作发生时刻); created_at 永远是落库时刻 clock.millis()。
 * (v0 用墙钟; 接 FAMILY-60 TimeAuthority.authoritativeNow 留后续, 审计时刻防改钟。)
 */
@Singleton
class AuditLogRepositoryImpl @Inject constructor(
    private val auditLogDao: AuditLogDao,
    private val clock: Clock,
) : AuditLogRepository {

    override suspend fun record(
        action: AuditAction,
        actorDid: String,
        targetDid: String?,
        familyGroupId: String?,
        detail: String,
        actionAtMs: Long?,
    ): Long {
        val now = clock.millis()
        val entity = AuditLogEntity(
            actorDid = actorDid,
            action = action.storageValue,
            targetDid = targetDid,
            familyGroupId = familyGroupId,
            detail = detail,
            timestamp = actionAtMs ?: now,
            createdAt = now,
        )
        return auditLogDao.insert(entity)
    }

    override fun observeRecent(limit: Int): Flow<List<AuditLogEntity>> =
        auditLogDao.observeRecent(limit)

    override suspend fun queryRange(sinceMs: Long, untilMs: Long): List<AuditLogEntity> =
        auditLogDao.queryRange(sinceMs, untilMs)

    override suspend fun queryByGroup(
        familyGroupId: String,
        sinceMs: Long,
        untilMs: Long,
    ): List<AuditLogEntity> = auditLogDao.queryByGroup(familyGroupId, sinceMs, untilMs)

    override suspend fun count(): Int = auditLogDao.count()
}
