package com.chainlesschain.android.presentation.aistudy

import com.chainlesschain.android.feature.familyguard.data.dao.GuardrailEventDao
import com.chainlesschain.android.feature.familyguard.data.entity.GuardrailEventEntity
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyTaskRepository
import com.chainlesschain.android.feature.familyguard.domain.task.AiCallLogEntry
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTask
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskStatus
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** §4.6 数据生命周期协调器 ([FamilyDataLifecycle]): 截止口径 + 24h 节流 + 单项失败隔离。 */
class FamilyDataLifecycleTest {

    private class RecordingRepo : FamilyTaskRepository {
        val cutoffs = mutableListOf<Long>()
        var throwOnCleanup = false
        override suspend fun deleteTerminalOlderThan(cutoffMs: Long): Int {
            if (throwOnCleanup) error("boom")
            cutoffs += cutoffMs
            return 0
        }

        override suspend fun upsert(task: FamilyTask) = Unit
        override suspend fun upsertFromSync(task: FamilyTask) = Unit
        override suspend fun deleteFromSync(id: String) = false
        override suspend fun getById(id: String): FamilyTask? = null
        override fun observeForChild(childDid: String): Flow<List<FamilyTask>> = flowOf(emptyList())
        override fun observeForChild(childDid: String, status: FamilyTaskStatus): Flow<List<FamilyTask>> =
            flowOf(emptyList())
        override suspend fun activeTasksForChild(childDid: String): List<FamilyTask> = emptyList()
        override suspend fun transition(id: String, to: FamilyTaskStatus) = false
        override suspend fun recordSubmission(id: String, submission: String) = false
        override suspend fun recordAiGrade(id: String, aiGrade: String) = false
        override suspend fun recordParentReview(id: String, review: String) = false
        override suspend fun appendAiCall(id: String, entry: AiCallLogEntry) = false
        override suspend fun delete(id: String) = false
    }

    private class RecordingGuardrailDao : GuardrailEventDao {
        val cutoffs = mutableListOf<Long>()
        override suspend fun insert(entity: GuardrailEventEntity): Long = 0
        override suspend fun getAll(): List<GuardrailEventEntity> = emptyList()
        override suspend fun count(): Int = 0
        override suspend fun deleteOlderThan(cutoffMs: Long): Int {
            cutoffs += cutoffMs
            return 0
        }
    }

    private class RecordingVault : CompanionVault {
        val cutoffs = mutableListOf<Long>()
        override suspend fun load(): List<CompanionChatRecord> = emptyList()
        override suspend fun append(record: CompanionChatRecord) = Unit
        override suspend fun clear() = Unit
        override suspend fun pruneOlderThan(cutoffMs: Long): Int {
            cutoffs += cutoffMs
            return 0
        }
    }

    private val now = 1_000L * 24 * 60 * 60 * 1000 // 第 1000 天

    @Test
    fun `runs all three cleanups with spec retention cutoffs`() = runTest {
        val repo = RecordingRepo()
        val dao = RecordingGuardrailDao()
        val vault = RecordingVault()

        assertTrue(FamilyDataLifecycle(repo, dao, vault).runIfDue(now))

        assertEquals(now - FamilyDataLifecycle.TASK_RETENTION_MS, repo.cutoffs.single()) // 1y
        assertEquals(now - FamilyDataLifecycle.GUARDRAIL_RETENTION_MS, dao.cutoffs.single()) // 30d
        assertEquals(now - FamilyDataLifecycle.COMPANION_RETENTION_MS, vault.cutoffs.single()) // 30d
    }

    @Test
    fun `throttles to once per 24h`() = runTest {
        val repo = RecordingRepo()
        val lifecycle = FamilyDataLifecycle(repo, RecordingGuardrailDao(), RecordingVault())

        assertTrue(lifecycle.runIfDue(now))
        assertFalse(lifecycle.runIfDue(now + 60_000L)) // 1 分钟后 no-op
        assertEquals(1, repo.cutoffs.size)

        assertTrue(lifecycle.runIfDue(now + FamilyDataLifecycle.MIN_INTERVAL_MS + 1)) // 24h 后再跑
        assertEquals(2, repo.cutoffs.size)
    }

    @Test
    fun `one failing cleanup does not block the others`() = runTest {
        val repo = RecordingRepo().apply { throwOnCleanup = true }
        val dao = RecordingGuardrailDao()
        val vault = RecordingVault()

        assertTrue(FamilyDataLifecycle(repo, dao, vault).runIfDue(now))
        assertEquals(1, dao.cutoffs.size)
        assertEquals(1, vault.cutoffs.size)
    }
}
