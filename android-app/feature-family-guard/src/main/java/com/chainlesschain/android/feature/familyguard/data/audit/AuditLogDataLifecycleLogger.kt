package com.chainlesschain.android.feature.familyguard.data.audit

import com.chainlesschain.android.feature.familyguard.domain.audit.AuditAction
import com.chainlesschain.android.feature.familyguard.domain.lifecycle.DataLifecycleAuditLogger
import com.chainlesschain.android.feature.familyguard.domain.lifecycle.DataLifecycleReport
import com.chainlesschain.android.feature.familyguard.domain.repository.AuditLogRepository
import javax.inject.Inject
import javax.inject.Singleton

/**
 * FAMILY-63: [DataLifecycleAuditLogger] 的真实实装 —— 把 FAMILY-28 每次数据清理结果
 * 写进不可删 audit_log (主文档 §4.6 "清理含 audit log 写入")。覆盖 LifecycleModule 原
 * NoOp 绑定。actor = system, action = DATA_LIFECYCLE_CLEANUP, timestamp = 清理运行时刻。
 */
@Singleton
class AuditLogDataLifecycleLogger @Inject constructor(
    private val auditLogRepository: AuditLogRepository,
) : DataLifecycleAuditLogger {

    override suspend fun recordCleanup(report: DataLifecycleReport) {
        auditLogRepository.record(
            action = AuditAction.DATA_LIFECYCLE_CLEANUP,
            actorDid = AuditLogRepository.SYSTEM_ACTOR,
            detail = "total=${report.totalDeleted} " +
                "L0=${report.telemetryL0Deleted} L1=${report.telemetryL1Deleted} " +
                "L2=${report.telemetryL2Deleted} L3=${report.telemetryL3Deleted} " +
                "loc=${report.locationDeleted} anomaly=${report.anomalyDeleted} " +
                "unbound=${report.unboundRelationshipsDeleted}",
            actionAtMs = report.runAtMs,
        )
    }
}
