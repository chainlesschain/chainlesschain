package com.chainlesschain.android.presentation.familytask

import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyTaskRepository
import com.chainlesschain.android.feature.familyguard.domain.task.AiCallLogEntry
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTask
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskStatus
import com.chainlesschain.android.presentation.aistudy.AiCallKind
import com.chainlesschain.android.presentation.aistudy.StudyTask
import com.chainlesschain.android.presentation.aistudy.StudyTaskStatus
import com.chainlesschain.android.presentation.aistudy.TaskAiCall
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** M5 防作弊 log 写穿 ([PersistingStudyTaskContext])。 */
class PersistingStudyTaskContextTest {

    /** 只捕获 appendAiCall 的最小 fake。 */
    private class RecordingRepo : FamilyTaskRepository {
        val appended = mutableListOf<Pair<String, AiCallLogEntry>>()
        override suspend fun appendAiCall(id: String, entry: AiCallLogEntry): Boolean {
            appended += id to entry
            return true
        }

        override suspend fun upsert(task: FamilyTask) = Unit
        override suspend fun getById(id: String): FamilyTask? = null
        override fun observeForChild(childDid: String): Flow<List<FamilyTask>> = flowOf(emptyList())
        override fun observeForChild(childDid: String, status: FamilyTaskStatus): Flow<List<FamilyTask>> =
            flowOf(emptyList())
        override suspend fun activeTasksForChild(childDid: String): List<FamilyTask> = emptyList()
        override suspend fun transition(id: String, to: FamilyTaskStatus) = false
        override suspend fun recordSubmission(id: String, submission: String) = false
        override suspend fun recordAiGrade(id: String, aiGrade: String) = false
        override suspend fun recordParentReview(id: String, review: String) = false
        override suspend fun delete(id: String) = false
        override suspend fun deleteTerminalOlderThan(cutoffMs: Long) = 0
    }

    @Test
    fun `logAiCall keeps memory behavior and writes metadata through`() = runBlocking {
        val repo = RecordingRepo()
        val ctx = PersistingStudyTaskContext(repo)

        ctx.logAiCall(TaskAiCall("t1", 1_000L, AiCallKind.ANSWER_SEEKING))
        ctx.logAiCall(TaskAiCall("t1", 2_000L, AiCallKind.NORMAL))
        ctx.logAiCall(TaskAiCall("t2", 3_000L, AiCallKind.NORMAL))

        // 内存行为与 InMemory 一致 (报告/banner 同步读)
        assertEquals(2, ctx.callLogFor("t1").size)
        assertEquals(1, ctx.callLogFor("t2").size)

        ctx.awaitIdle()
        // 写穿: 只元数据 (时间 + 小写类别), 与 AiCallLogEntry 契约对齐
        assertEquals(3, repo.appended.size)
        val t1Entries = repo.appended.filter { it.first == "t1" }.map { it.second }
        assertEquals(setOf("answer_seeking", "normal"), t1Entries.map { it.kind }.toSet())
        assertEquals(1_000L, t1Entries.first { it.kind == "answer_seeking" }.timestampMs)
    }

    @Test
    fun `activeTask stays memory-only and filters non in-progress`() {
        val ctx = PersistingStudyTaskContext(RecordingRepo())
        ctx.setActiveTask(StudyTask(id = "t1", title = "数学", status = StudyTaskStatus.IN_PROGRESS))
        assertEquals("t1", ctx.activeTask.value?.id)

        ctx.setActiveTask(StudyTask(id = "t2", title = "英语", status = StudyTaskStatus.DONE))
        assertNull(ctx.activeTask.value)
    }
}
