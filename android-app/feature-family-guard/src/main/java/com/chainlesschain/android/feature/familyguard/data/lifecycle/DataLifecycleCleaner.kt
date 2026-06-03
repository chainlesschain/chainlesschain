package com.chainlesschain.android.feature.familyguard.data.lifecycle

import com.chainlesschain.android.feature.familyguard.data.dao.AnomalyDao
import com.chainlesschain.android.feature.familyguard.data.dao.ChildEventDao
import com.chainlesschain.android.feature.familyguard.data.dao.FamilyRelationshipDao
import com.chainlesschain.android.feature.familyguard.data.dao.LocationPointDao
import com.chainlesschain.android.feature.familyguard.domain.lifecycle.DataLifecycleAuditLogger
import com.chainlesschain.android.feature.familyguard.domain.lifecycle.DataLifecyclePolicy
import com.chainlesschain.android.feature.familyguard.domain.lifecycle.DataLifecycleReport
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * 数据生命周期清理器 (FAMILY-28). 主文档 §4.6 — 每日由
 * [DataLifecycleScheduler] 触发的 [com.chainlesschain.android.feature.familyguard.boot.DataLifecycleReceiver]
 * 调 [cleanOnce]。
 *
 * **幂等**: 删的是 timestamp/updated_at 早于 cutoff 的行; 重复运行 (alarm 抖动 /
 * 重启重排) 只是再删一次已无的行 → 0 行影响, 安全。故无需 once-per-day 状态守卫,
 * cadence 由 scheduler (RTC inexact daily) 负责。
 *
 * 清理后调 [DataLifecycleAuditLogger] 写审计 (§4.6 要求)。SOS 事件 + audit log 永不碰
 * (§4.6: 永久 / 不可删)。归档管线 (§4.6 标"归档"的聚合后存月度统计) v0 暂等同硬删,
 * 留 v0.2。
 */
@Singleton
class DataLifecycleCleaner @Inject constructor(
    private val childEventDao: ChildEventDao,
    private val locationPointDao: LocationPointDao,
    private val anomalyDao: AnomalyDao,
    private val familyRelationshipDao: FamilyRelationshipDao,
    private val policy: DataLifecyclePolicy,
    private val auditLogger: DataLifecycleAuditLogger,
) {

    /** @param nowMs 清理基准时刻 (= 各 cutoff 上界); 生产传 System.currentTimeMillis()。 */
    suspend fun cleanOnce(nowMs: Long): DataLifecycleReport {
        val report = DataLifecycleReport(
            telemetryL0Deleted = childEventDao.deleteOlderThanByLevel(
                LEVEL_L0,
                cutoff(nowMs, policy.telemetryL0RetentionDays),
            ),
            telemetryL1Deleted = childEventDao.deleteOlderThanByLevel(
                LEVEL_L1,
                cutoff(nowMs, policy.telemetryL1RetentionDays),
            ),
            telemetryL2Deleted = childEventDao.deleteOlderThanByLevel(
                LEVEL_L2,
                cutoff(nowMs, policy.telemetryL2RetentionDays),
            ),
            telemetryL3Deleted = childEventDao.deleteOlderThanByLevel(
                LEVEL_L3,
                cutoff(nowMs, policy.telemetryL3RetentionDays),
            ),
            locationDeleted = locationPointDao.deleteOlderThan(
                cutoff(nowMs, policy.locationRetentionDays),
            ),
            anomalyDeleted = anomalyDao.deleteOlderThan(
                cutoff(nowMs, policy.anomalyRetentionDays),
            ),
            unboundRelationshipsDeleted = familyRelationshipDao.deleteByStatusOlderThan(
                STATUS_UNBOUND,
                cutoff(nowMs, policy.unboundRelationshipRetentionDays),
            ),
            runAtMs = nowMs,
        )
        Timber.i("DataLifecycleCleaner.cleanOnce deleted total=%d", report.totalDeleted)
        auditLogger.recordCleanup(report)
        return report
    }

    private fun cutoff(nowMs: Long, retentionDays: Int): Long =
        nowMs - retentionDays.toLong() * MS_PER_DAY

    private companion object {
        const val LEVEL_L0 = "L0"
        const val LEVEL_L1 = "L1"
        const val LEVEL_L2 = "L2"
        const val LEVEL_L3 = "L3"
        const val STATUS_UNBOUND = "unbound"
        const val MS_PER_DAY = 24L * 60 * 60 * 1000
    }
}
