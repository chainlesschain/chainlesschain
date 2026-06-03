package com.chainlesschain.android.feature.familyguard.data.lifecycle

import com.chainlesschain.android.feature.familyguard.data.dao.AnomalyDao
import com.chainlesschain.android.feature.familyguard.data.dao.ChildEventDao
import com.chainlesschain.android.feature.familyguard.data.dao.FamilyRelationshipDao
import com.chainlesschain.android.feature.familyguard.data.dao.LocationPointDao
import com.chainlesschain.android.feature.familyguard.domain.lifecycle.DataLifecycleAuditLogger
import com.chainlesschain.android.feature.familyguard.domain.lifecycle.DataLifecyclePolicy
import com.chainlesschain.android.feature.familyguard.domain.lifecycle.DataLifecycleReport
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals

/**
 * FAMILY-28 验收: [DataLifecycleCleaner] 按 §4.6 各类保留期算 cutoff + 汇总报告 +
 * 写审计。DAO 走 mockk 验证 cutoff 实参 = now - retentionDays。
 */
class DataLifecycleCleanerTest {

    private val childEventDao = mockk<ChildEventDao>()
    private val locationPointDao = mockk<LocationPointDao>()
    private val anomalyDao = mockk<AnomalyDao>()
    private val familyRelationshipDao = mockk<FamilyRelationshipDao>()
    private val auditLogger = mockk<DataLifecycleAuditLogger>(relaxed = true)
    private val policy = DataLifecyclePolicy()

    private val cleaner = DataLifecycleCleaner(
        childEventDao,
        locationPointDao,
        anomalyDao,
        familyRelationshipDao,
        policy,
        auditLogger,
    )

    private val now = 1_700_000_000_000L
    private val dayMs = 24L * 60 * 60 * 1000

    @Test
    fun `deletes each category at correct cutoff and aggregates report`() = runTest {
        coEvery { childEventDao.deleteOlderThanByLevel("L0", any()) } returns 1
        coEvery { childEventDao.deleteOlderThanByLevel("L1", any()) } returns 2
        coEvery { childEventDao.deleteOlderThanByLevel("L2", any()) } returns 3
        coEvery { childEventDao.deleteOlderThanByLevel("L3", any()) } returns 4
        coEvery { locationPointDao.deleteOlderThan(any()) } returns 5
        coEvery { anomalyDao.deleteOlderThan(any()) } returns 6
        coEvery { familyRelationshipDao.deleteByStatusOlderThan("unbound", any()) } returns 7

        val report = cleaner.cleanOnce(now)

        assertEquals(1, report.telemetryL0Deleted)
        assertEquals(2, report.telemetryL1Deleted)
        assertEquals(3, report.telemetryL2Deleted)
        assertEquals(4, report.telemetryL3Deleted)
        assertEquals(5, report.locationDeleted)
        assertEquals(6, report.anomalyDeleted)
        assertEquals(7, report.unboundRelationshipsDeleted)
        assertEquals(28, report.totalDeleted)
        assertEquals(now, report.runAtMs)

        coVerify { childEventDao.deleteOlderThanByLevel("L0", now - 365 * dayMs) }
        coVerify { childEventDao.deleteOlderThanByLevel("L1", now - 90 * dayMs) }
        coVerify { childEventDao.deleteOlderThanByLevel("L2", now - 30 * dayMs) }
        coVerify { childEventDao.deleteOlderThanByLevel("L3", now - 7 * dayMs) }
        coVerify { locationPointDao.deleteOlderThan(now - 30 * dayMs) }
        coVerify { anomalyDao.deleteOlderThan(now - 365 * dayMs) }
        coVerify { familyRelationshipDao.deleteByStatusOlderThan("unbound", now - 90 * dayMs) }
    }

    @Test
    fun `writes the report to audit logger`() = runTest {
        coEvery { childEventDao.deleteOlderThanByLevel(any(), any()) } returns 0
        coEvery { locationPointDao.deleteOlderThan(any()) } returns 0
        coEvery { anomalyDao.deleteOlderThan(any()) } returns 0
        coEvery { familyRelationshipDao.deleteByStatusOlderThan(any(), any()) } returns 0

        val captured = slot<DataLifecycleReport>()
        coEvery { auditLogger.recordCleanup(capture(captured)) } returns Unit

        val report = cleaner.cleanOnce(now)

        coVerify(exactly = 1) { auditLogger.recordCleanup(any()) }
        assertEquals(report, captured.captured)
        assertEquals(0, captured.captured.totalDeleted)
    }

    @Test
    fun `respects custom retention policy`() = runTest {
        val custom = DataLifecycleCleaner(
            childEventDao, locationPointDao, anomalyDao, familyRelationshipDao,
            DataLifecyclePolicy(telemetryL3RetentionDays = 1, locationRetentionDays = 10),
            auditLogger,
        )
        coEvery { childEventDao.deleteOlderThanByLevel(any(), any()) } returns 0
        coEvery { locationPointDao.deleteOlderThan(any()) } returns 0
        coEvery { anomalyDao.deleteOlderThan(any()) } returns 0
        coEvery { familyRelationshipDao.deleteByStatusOlderThan(any(), any()) } returns 0

        custom.cleanOnce(now)

        coVerify { childEventDao.deleteOlderThanByLevel("L3", now - 1 * dayMs) }
        coVerify { locationPointDao.deleteOlderThan(now - 10 * dayMs) }
    }
}
