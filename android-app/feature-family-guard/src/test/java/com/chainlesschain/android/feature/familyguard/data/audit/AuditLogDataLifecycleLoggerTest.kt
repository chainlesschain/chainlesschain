package com.chainlesschain.android.feature.familyguard.data.audit

import com.chainlesschain.android.feature.familyguard.data.entity.AuditLogEntity
import com.chainlesschain.android.feature.familyguard.domain.audit.AuditAction
import com.chainlesschain.android.feature.familyguard.domain.lifecycle.DataLifecycleReport
import com.chainlesschain.android.feature.familyguard.domain.repository.AuditLogRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * FAMILY-63 验收: 数据清理结果写进不可删 audit_log —— action=DATA_LIFECYCLE_CLEANUP,
 * actor=system, 动作时刻 = 清理 runAtMs, detail 含各类删除数。
 *
 * 用手写 fake (非 mockk) 捕获调用, 规避 Kotlin 接口默认参数 + mockk `$default` 交互坑
 * ([[feedback_mockk_cross_file_jvm_pollution]])。
 */
class AuditLogDataLifecycleLoggerTest {

    private class RecordedCall(
        val action: AuditAction,
        val actorDid: String,
        val targetDid: String?,
        val detail: String,
        val actionAtMs: Long?,
    )

    private class FakeAuditRepo : AuditLogRepository {
        val calls = mutableListOf<RecordedCall>()
        override suspend fun record(
            action: AuditAction,
            actorDid: String,
            targetDid: String?,
            familyGroupId: String?,
            detail: String,
            actionAtMs: Long?,
        ): Long {
            calls += RecordedCall(action, actorDid, targetDid, detail, actionAtMs)
            return calls.size.toLong()
        }
        override fun observeRecent(limit: Int): Flow<List<AuditLogEntity>> = flowOf(emptyList())
        override suspend fun queryRange(sinceMs: Long, untilMs: Long): List<AuditLogEntity> = emptyList()
        override suspend fun queryByGroup(
            familyGroupId: String,
            sinceMs: Long,
            untilMs: Long,
        ): List<AuditLogEntity> = emptyList()
        override suspend fun count(): Int = calls.size
    }

    @Test
    fun `recordCleanup writes a system audit row`() = runTest {
        val repo = FakeAuditRepo()
        val report = DataLifecycleReport(
            telemetryL0Deleted = 1,
            telemetryL1Deleted = 2,
            telemetryL2Deleted = 3,
            telemetryL3Deleted = 4,
            locationDeleted = 5,
            anomalyDeleted = 6,
            unboundRelationshipsDeleted = 7,
            runAtMs = 1_700_000_000_000L,
        )

        AuditLogDataLifecycleLogger(repo).recordCleanup(report)

        assertEquals(1, repo.calls.size)
        val c = repo.calls.first()
        assertEquals(AuditAction.DATA_LIFECYCLE_CLEANUP, c.action)
        assertEquals(AuditLogRepository.SYSTEM_ACTOR, c.actorDid)
        assertEquals(1_700_000_000_000L, c.actionAtMs)
        assertTrue(c.detail.contains("total=28"), "detail=${c.detail}")
        assertTrue(c.detail.contains("anomaly=6"))
    }
}
