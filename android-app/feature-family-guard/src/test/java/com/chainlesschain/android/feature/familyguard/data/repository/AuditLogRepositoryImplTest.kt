package com.chainlesschain.android.feature.familyguard.data.repository

import com.chainlesschain.android.feature.familyguard.data.dao.AuditLogDao
import com.chainlesschain.android.feature.familyguard.data.entity.AuditLogEntity
import com.chainlesschain.android.feature.familyguard.domain.audit.AuditAction
import com.chainlesschain.android.feature.familyguard.domain.repository.AuditLogRepository
import io.mockk.coEvery
import io.mockk.mockk
import io.mockk.slot
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * FAMILY-63 验收: AuditLogRepositoryImpl 写入字段映射 + 时刻缺省 + actor 缺省。
 */
class AuditLogRepositoryImplTest {

    private val dao = mockk<AuditLogDao>()
    private val nowMs = 1_700_000_500_000L
    private val clock = Clock.fixed(Instant.ofEpochMilli(nowMs), ZoneOffset.UTC)
    private val repo = AuditLogRepositoryImpl(dao, clock)

    @Test
    fun `record maps fields and defaults timestamp to clock`() = runTest {
        val captured = slot<AuditLogEntity>()
        coEvery { dao.insert(capture(captured)) } returns 1L

        val id = repo.record(
            action = AuditAction.EMERGENCY_UNBIND,
            actorDid = "did:chain:mom",
            targetDid = "did:chain:kid",
            familyGroupId = "grp1",
            detail = "revival code",
        )

        assertEquals(1L, id)
        val e = captured.captured
        assertEquals("did:chain:mom", e.actorDid)
        assertEquals("emergency_unbind", e.action)
        assertEquals("did:chain:kid", e.targetDid)
        assertEquals("grp1", e.familyGroupId)
        assertEquals("revival code", e.detail)
        assertEquals(nowMs, e.timestamp) // actionAtMs 缺省 → clock
        assertEquals(nowMs, e.createdAt)
    }

    @Test
    fun `record uses explicit actionAtMs and system actor default`() = runTest {
        val captured = slot<AuditLogEntity>()
        coEvery { dao.insert(capture(captured)) } returns 2L

        repo.record(action = AuditAction.PAUSE, actionAtMs = 1_699_000_000_000L)

        val e = captured.captured
        assertEquals(AuditLogRepository.SYSTEM_ACTOR, e.actorDid) // 缺省 system
        assertNull(e.targetDid)
        assertEquals(1_699_000_000_000L, e.timestamp) // 显式动作时刻
        assertEquals(nowMs, e.createdAt) // 落库时刻仍是 clock
    }
}
