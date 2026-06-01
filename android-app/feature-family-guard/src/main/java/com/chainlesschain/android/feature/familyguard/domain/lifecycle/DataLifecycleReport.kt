package com.chainlesschain.android.feature.familyguard.domain.lifecycle

/**
 * 一次清理运行的结果 (FAMILY-28). [DataLifecycleCleaner.cleanOnce] 返回 +
 * 喂给 [DataLifecycleAuditLogger] 写审计。各字段 = 该类数据本次硬删行数。
 */
data class DataLifecycleReport(
    val telemetryL0Deleted: Int,
    val telemetryL1Deleted: Int,
    val telemetryL2Deleted: Int,
    val telemetryL3Deleted: Int,
    val locationDeleted: Int,
    val anomalyDeleted: Int,
    val unboundRelationshipsDeleted: Int,
    val runAtMs: Long,
) {
    val totalDeleted: Int
        get() = telemetryL0Deleted + telemetryL1Deleted + telemetryL2Deleted +
            telemetryL3Deleted + locationDeleted + anomalyDeleted + unboundRelationshipsDeleted
}
