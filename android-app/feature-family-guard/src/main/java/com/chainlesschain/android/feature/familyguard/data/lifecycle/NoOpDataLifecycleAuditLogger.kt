package com.chainlesschain.android.feature.familyguard.data.lifecycle

import com.chainlesschain.android.feature.familyguard.domain.lifecycle.DataLifecycleAuditLogger
import com.chainlesschain.android.feature.familyguard.domain.lifecycle.DataLifecycleReport
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * [DataLifecycleAuditLogger] 默认 no-op (FAMILY-28). 仅记日志; 真实不可删 audit_log
 * (2y) 由 FAMILY-63 在 :app/feature 层覆盖本绑定。
 */
@Singleton
class NoOpDataLifecycleAuditLogger @Inject constructor() : DataLifecycleAuditLogger {

    override suspend fun recordCleanup(report: DataLifecycleReport) {
        Timber.i(
            "data lifecycle cleanup (no-op audit): total=%d L0=%d L1=%d L2=%d L3=%d loc=%d anomaly=%d unbound=%d",
            report.totalDeleted,
            report.telemetryL0Deleted,
            report.telemetryL1Deleted,
            report.telemetryL2Deleted,
            report.telemetryL3Deleted,
            report.locationDeleted,
            report.anomalyDeleted,
            report.unboundRelationshipsDeleted,
        )
    }
}
