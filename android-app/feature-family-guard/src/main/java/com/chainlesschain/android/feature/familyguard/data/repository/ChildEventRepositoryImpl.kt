package com.chainlesschain.android.feature.familyguard.data.repository

import com.chainlesschain.android.feature.familyguard.data.dao.ChildEventDao
import com.chainlesschain.android.feature.familyguard.data.entity.ChildEventEntity
import com.chainlesschain.android.feature.familyguard.data.telemetry.TelemetryEventConverter
import com.chainlesschain.android.feature.familyguard.domain.repository.ChildEventRepository
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppRun
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryEvent
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow

/**
 * FAMILY-20 实装. 注意 payload 走简化 JSON 拼接 (不用 kotlinx-serialization),
 * 因 schema 极简 + 性能敏感 (每分钟最坏 1 行入); 真要 schema 演化时切回
 * @Serializable data class。
 */
@Singleton
class ChildEventRepositoryImpl @Inject constructor(
    private val childEventDao: ChildEventDao,
) : ChildEventRepository {

    override suspend fun saveForegroundAppRun(childDid: String, run: ForegroundAppRun): Long {
        val payload = """{"package":"${escapeJsonString(run.packageName)}","duration_ms":${run.durationMs}}"""
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

    override suspend fun deleteOlderThan(cutoffMs: Long): Int =
        childEventDao.deleteOlderThan(cutoffMs)

    /** JSON 字符串转义 (仅 package 名字含 \. 极端情况下 / "); 不做完整 JSON 编码. */
    private fun escapeJsonString(s: String): String =
        s.replace("\\", "\\\\").replace("\"", "\\\"")

    companion object {
        const val SOURCE_FOREGROUND_APP = "foreground_app"
        const val KIND_RUN = "run"
    }
}
