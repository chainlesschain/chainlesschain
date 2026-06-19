package com.chainlesschain.android.feature.familyguard.data.repository

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.feature.familyguard.data.FamilyGuardDatabase
import com.chainlesschain.android.feature.familyguard.data.sync.NoOpFamilyTaskOutbox
import com.chainlesschain.android.feature.familyguard.domain.task.AiCallLogCodec
import com.chainlesschain.android.feature.familyguard.domain.task.AiCallLogEntry
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTask
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskSource
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskStatus
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskType
import com.chainlesschain.android.feature.familyguard.fixtures.FamilyFixtures
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * M5 family_task 端到端 (主文档 §3.5)。Room in-memory 真跑 SQL;
 * 验字段往返 / 状态机 / 提交批改 / ai_call_log / 生命周期清理。
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class FamilyTaskRepositoryImplTest {

    private lateinit var db: FamilyGuardDatabase
    private lateinit var repo: FamilyTaskRepositoryImpl
    private val childDid = FamilyFixtures.FIXTURE_CHILD_DID
    private val baseMs = FamilyFixtures.FIXTURE_TIME_MS

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            FamilyGuardDatabase::class.java,
        )
            .allowMainThreadQueries()
            .build()
        repo = FamilyTaskRepositoryImpl(
            db.familyTaskDao(),
            FamilyFixtures.fakeClock(baseMs),
            NoOpFamilyTaskOutbox(),
        )
    }

    @After
    fun tearDown() = db.close()

    private class RecordingTaskOutbox :
        com.chainlesschain.android.feature.familyguard.domain.sync.FamilyTaskOutbox {
        val enqueued = mutableListOf<String>()
        val deleted = mutableListOf<String>()
        override suspend fun enqueue(task: FamilyTask) { enqueued += task.id }
        override suspend fun enqueueDelete(taskId: String) { deleted += taskId }
    }

    @Test
    fun `local mutations enqueue to outbox but sync-writes do not (FAMILY-67)`() = runBlocking {
        val outbox = RecordingTaskOutbox()
        val syncRepo = FamilyTaskRepositoryImpl(db.familyTaskDao(), FamilyFixtures.fakeClock(baseMs), outbox)

        syncRepo.upsert(task("t1"))                  // 本地 → 上行
        syncRepo.transition("t1", FamilyTaskStatus.IN_PROGRESS) // 本地状态流转 → 上行
        syncRepo.upsertFromSync(task("t2"))          // 收端 → 不上行
        syncRepo.deleteFromSync("t1")                // 收端删除 → 不上行

        assertEquals(listOf("t1", "t1"), outbox.enqueued) // upsert + transition 两次, t2/收端删不计
        assertTrue(outbox.deleted.isEmpty())
    }

    @Test
    fun `local delete enqueues a delete to outbox (FAMILY-67)`() = runBlocking {
        val outbox = RecordingTaskOutbox()
        val syncRepo = FamilyTaskRepositoryImpl(db.familyTaskDao(), FamilyFixtures.fakeClock(baseMs), outbox)
        syncRepo.upsert(task("d1"))
        syncRepo.delete("d1")
        assertEquals(listOf("d1"), outbox.deleted)
    }

    private fun task(
        id: String,
        status: FamilyTaskStatus = FamilyTaskStatus.ASSIGNED,
        child: String = childDid,
    ) = FamilyTask(
        id = id,
        familyGroupId = FamilyFixtures.FIXTURE_GROUP_ID,
        assignerDid = FamilyFixtures.FIXTURE_PARENT_DID,
        childDid = child,
        source = FamilyTaskSource.PARENT,
        type = FamilyTaskType.HOMEWORK,
        title = "数学第3页",
        description = "1-10 题",
        subject = "math",
        gradeLevel = "P5",
        rewardPoints = 20,
        status = status,
        createdAtMs = baseMs,
        updatedAtMs = baseMs,
    )

    @Test
    fun `upsert then getById round-trips all fields`() = runBlocking {
        repo.upsert(task("t1"))
        val got = repo.getById("t1")!!
        assertEquals("数学第3页", got.title)
        assertEquals(FamilyTaskType.HOMEWORK, got.type)
        assertEquals(FamilyTaskSource.PARENT, got.source)
        assertEquals("math", got.subject)
        assertEquals("P5", got.gradeLevel)
        assertEquals(20, got.rewardPoints)
        assertEquals(FamilyTaskStatus.ASSIGNED, got.status)
    }

    @Test
    fun `observeForChild filters by child and orders by created desc`() = runBlocking {
        repo.upsert(task("t1").copy(createdAtMs = baseMs))
        repo.upsert(task("t2").copy(createdAtMs = baseMs + 1000))
        repo.upsert(task("t3", child = "did:chain:other"))

        val mine = repo.observeForChild(childDid).first()
        assertEquals(listOf("t2", "t1"), mine.map { it.id })
    }

    @Test
    fun `valid transition succeeds, invalid is rejected without change`() = runBlocking {
        repo.upsert(task("t1", status = FamilyTaskStatus.ASSIGNED))

        assertTrue(repo.transition("t1", FamilyTaskStatus.IN_PROGRESS))
        assertEquals(FamilyTaskStatus.IN_PROGRESS, repo.getById("t1")!!.status)

        // 跳级非法
        assertFalse(repo.transition("t1", FamilyTaskStatus.DONE))
        assertEquals(FamilyTaskStatus.IN_PROGRESS, repo.getById("t1")!!.status)
    }

    @Test
    fun `transition on missing task returns false`() = runBlocking {
        assertFalse(repo.transition("nope", FamilyTaskStatus.IN_PROGRESS))
    }

    @Test
    fun `recordSubmission only from in_progress, sets fields and status`() = runBlocking {
        repo.upsert(task("t1", status = FamilyTaskStatus.ASSIGNED))
        // 未进行中不能提交
        assertFalse(repo.recordSubmission("t1", "我的答案"))

        repo.transition("t1", FamilyTaskStatus.IN_PROGRESS)
        assertTrue(repo.recordSubmission("t1", "我的答案"))
        val got = repo.getById("t1")!!
        assertEquals(FamilyTaskStatus.SUBMITTED, got.status)
        assertEquals("我的答案", got.submission)
        assertEquals(baseMs, got.submittedAtMs)
    }

    @Test
    fun `ai grade and parent review persist`() = runBlocking {
        repo.upsert(task("t1"))
        assertTrue(repo.recordAiGrade("t1", "85 分，分数计算有进步"))
        assertTrue(repo.recordParentReview("t1", "继续加油"))
        val got = repo.getById("t1")!!
        assertEquals("85 分，分数计算有进步", got.aiGrade)
        assertEquals("继续加油", got.parentReview)
    }

    @Test
    fun `appendAiCall accumulates anti-cheat log`() = runBlocking {
        repo.upsert(task("t1"))
        assertTrue(repo.appendAiCall("t1", AiCallLogEntry(baseMs, "normal")))
        assertTrue(repo.appendAiCall("t1", AiCallLogEntry(baseMs + 1, "answer_seeking")))
        assertFalse(repo.appendAiCall("missing", AiCallLogEntry(baseMs, "normal")))

        val log = AiCallLogCodec.decode(repo.getById("t1")!!.aiCallLog)
        assertEquals(2, log.size)
        assertEquals("answer_seeking", log[1].kind)
    }

    @Test
    fun `activeTasksForChild returns only in_progress`() = runBlocking {
        repo.upsert(task("a", status = FamilyTaskStatus.ASSIGNED))
        repo.upsert(task("b", status = FamilyTaskStatus.IN_PROGRESS))
        repo.upsert(task("c", status = FamilyTaskStatus.IN_PROGRESS))

        val active = repo.activeTasksForChild(childDid)
        assertEquals(setOf("b", "c"), active.map { it.id }.toSet())
    }

    @Test
    fun `deleteTerminalOlderThan clears only done or cancelled before cutoff`() = runBlocking {
        repo.upsert(task("done-old", status = FamilyTaskStatus.DONE).copy(updatedAtMs = 100L))
        repo.upsert(task("cancelled-old", status = FamilyTaskStatus.CANCELLED).copy(updatedAtMs = 100L))
        repo.upsert(task("active-old", status = FamilyTaskStatus.IN_PROGRESS).copy(updatedAtMs = 100L))
        repo.upsert(task("done-new", status = FamilyTaskStatus.DONE).copy(updatedAtMs = baseMs))

        val deleted = repo.deleteTerminalOlderThan(baseMs)
        assertEquals(2, deleted)
        assertNull(repo.getById("done-old"))
        assertNull(repo.getById("cancelled-old"))
        assertTrue(repo.getById("active-old") != null) // 进行中不删
        assertTrue(repo.getById("done-new") != null) // 新的不删
    }

    @Test
    fun `delete removes a task`() = runBlocking {
        repo.upsert(task("t1"))
        assertTrue(repo.delete("t1"))
        assertNull(repo.getById("t1"))
        assertFalse(repo.delete("t1"))
    }
}
