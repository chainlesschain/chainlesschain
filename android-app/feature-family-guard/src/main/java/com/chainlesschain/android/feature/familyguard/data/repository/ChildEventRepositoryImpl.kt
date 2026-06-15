package com.chainlesschain.android.feature.familyguard.data.repository

import com.chainlesschain.android.feature.familyguard.data.dao.ChildEventDao
import com.chainlesschain.android.feature.familyguard.data.entity.ChildEventEntity
import com.chainlesschain.android.feature.familyguard.data.telemetry.TelemetryEventConverter
import com.chainlesschain.android.feature.familyguard.domain.repository.ChildEventRepository
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppPayload
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppRun
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryEvent
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow

/**
 * FAMILY-20 实装. payload 走 [ForegroundAppPayload] (kotlinx.serialization),
 * 与 FAMILY-21 [com.chainlesschain.android.feature.familyguard.data.telemetry.ForegroundAppTelemetrySource]
 * 共用同一 encoder 保证两条写入路径字节一致; 正确转义所有控制字符。
 */
@Singleton
class ChildEventRepositoryImpl @Inject constructor(
    private val childEventDao: ChildEventDao,
) : ChildEventRepository {

    override suspend fun saveForegroundAppRun(childDid: String, run: ForegroundAppRun): Long {
        val payload = ForegroundAppPayload.encode(run.packageName, run.durationMs)
        val entity = ChildEventEntity(
            childDid = childDid,
            source = SOURCE_FOREGROUND_APP,
            kind = KIND_RUN,
            payload = payload,
            timestamp = run.startMs,
            durationMs = run.durationMs,
            level = "L1",
        )
        return childEventDao.insert(entity)
    }

    override suspend fun saveEvent(event: ChildEventEntity): Long =
        childEventDao.insert(event)

    override suspend fun saveTelemetryEvent(event: TelemetryEvent): Long =
        childEventDao.insert(TelemetryEventConverter.toEntity(event))

    override suspend fun querySince(childDid: String, sinceMs: Long): List<ChildEventEntity> =
        childEventDao.querySince(childDid, sinceMs)

    override fun observeRecent(childDid: String, limit: Int): Flow<List<ChildEventEntity>> =
        childEventDao.observeRecent(childDid, limit)

    override fun observeRecentAnyChild(limit: Int): Flow<List<ChildEventEntity>> =
        childEventDao.observeRecentAnyChild(limit)

    override suspend fun deleteOlderThan(cutoffMs: Long): Int =
        childEventDao.deleteOlderThan(cutoffMs)

    companion object {
        const val SOURCE_FOREGROUND_APP = "foreground_app"
        const val KIND_RUN = "run"
    }
}
