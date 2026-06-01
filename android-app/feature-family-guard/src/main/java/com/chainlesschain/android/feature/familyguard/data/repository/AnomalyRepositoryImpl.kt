package com.chainlesschain.android.feature.familyguard.data.repository

import com.chainlesschain.android.feature.familyguard.data.dao.AnomalyDao
import com.chainlesschain.android.feature.familyguard.data.entity.AnomalyEntity
import com.chainlesschain.android.feature.familyguard.domain.anomaly.DetectedAnomaly
import com.chainlesschain.android.feature.familyguard.domain.repository.AnomalyRepository
import java.time.Clock
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow

/**
 * FAMILY-27 实装. [DetectedAnomaly] → [AnomalyEntity] 落库; dedup_key UNIQUE +
 * OnConflict IGNORE 去重 (复扫同一天的同一异常不重复落库)。
 */
@Singleton
class AnomalyRepositoryImpl @Inject constructor(
    private val anomalyDao: AnomalyDao,
    private val clock: Clock,
) : AnomalyRepository {

    override suspend fun record(anomaly: DetectedAnomaly): Long {
        val entity = AnomalyEntity(
            childDid = anomaly.childDid,
            type = anomaly.type.storageValue,
            severity = anomaly.severity.storageValue,
            dedupKey = anomaly.dedupKey,
            summary = anomaly.summary,
            detail = anomaly.detail,
            detectedAt = anomaly.detectedAtMs,
            createdAt = clock.millis(),
        )
        return anomalyDao.insert(entity)
    }

    override fun observeRecent(childDid: String, limit: Int): Flow<List<AnomalyEntity>> =
        anomalyDao.observeRecent(childDid, limit)

    override suspend fun acknowledge(id: Long): Boolean = anomalyDao.acknowledge(id) > 0

    override suspend fun deleteOlderThan(cutoffMs: Long): Int = anomalyDao.deleteOlderThan(cutoffMs)
}
