package com.chainlesschain.android.presentation.familytask

import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyTaskRepository
import com.chainlesschain.android.feature.familyguard.domain.task.AiCallLogEntry
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTask
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskSource
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskStatus
import com.chainlesschain.android.presentation.aistudy.AiCallKind
import com.chainlesschain.android.presentation.aistudy.CompanionChatRecord
import com.chainlesschain.android.presentation.aistudy.CompanionVault
import com.chainlesschain.android.presentation.aistudy.FamilyDataLifecycle
import com.chainlesschain.android.presentation.aistudy.InMemoryMistakeBook
import com.chainlesschain.android.presentation.aistudy.InMemoryPointsLedger
import com.chainlesschain.android.presentation.aistudy.InMemoryStudyTaskContext
import com.chainlesschain.android.presentation.aistudy.PointsEventType
import com.chainlesschain.android.presentation.aistudy.Subject
import com.chainlesschain.android.presentation.aistudy.TaskAiCall
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class FamilyTaskViewModelTest {

    /** 内存 fake repo: 真状态机, 无 Room。 */
    private class FakeFamilyTaskRepository : FamilyTaskRepository {
        val all = MutableStateFlow<List<FamilyTask>>(emptyList())
        private fun put(t: FamilyTask) { all.value = all.value.filterNot { it.id == t.id } + t }
        private fun find(id: String) = all.value.firstOrNull { it.id == id }

        override suspend fun upsert(task: FamilyTask) = put(task)
        override suspend fun upsertFromSync(task: FamilyTask) = put(task)
        override suspend fun deleteFromSync(id: String) = delete(id)
        override suspend fun getById(id: String) = find(id)
        override fun observeForChild(childDid: String): Flow<List<FamilyTask>> =
            all.map { list -> list.filter { it.childDid == childDid } }
        override fun observeForChild(childDid: String, status: FamilyTaskStatus) =
            all.map { list -> list.filter { it.childDid == childDid && it.status == status } }
        override suspend fun activeTasksForChild(childDid: String) =
            all.value.filter { it.childDid == childDid && it.status == FamilyTaskStatus.IN_PROGRESS }
        override suspend fun transition(id: String, to: FamilyTaskStatus): Boolean {
            val t = find(id) ?: return false
            if (!t.status.canTransitionTo(to)) return false
            put(t.copy(status = to)); return true
        }
        override suspend fun recordSubmission(id: String, submission: String): Boolean {
            val t = find(id) ?: return false
            if (!t.status.canTransitionTo(FamilyTaskStatus.SUBMITTED)) return false
            put(t.copy(submission = submission, status = FamilyTaskStatus.SUBMITTED)); return true
        }
        override suspend fun recordAiGrade(id: String, aiGrade: String): Boolean {
            val t = find(id) ?: return false
            put(t.copy(aiGrade = aiGrade)); return true
        }
        override suspend fun recordParentReview(id: String, review: String): Boolean {
            val t = find(id) ?: return false
            put(t.copy(parentReview = review)); return true
        }
        override suspend fun appendAiCall(id: String, entry: AiCallLogEntry) = find(id) != null
        override suspend fun delete(id: String): Boolean {
            if (find(id) == null) return false
            all.value = all.value.filterNot { it.id == id }; return true
        }
        override suspend fun deleteTerminalOlderThan(cutoffMs: Long) = 0
    }

    private class FakeHomeworkGrader(
        var result: GradingResult = GradingResult(85, "分数计算有进步，注意通分", listOf("分数通分")),
    ) : HomeworkGrader {
        var lastRequest: GradingRequest? = null
        override suspend fun grade(request: GradingRequest): GradingResult {
            lastRequest = request
            return result
        }
    }

    /** lifecycle 用的最小 fakes (本测试不关心清理行为, 只为构造 VM)。 */
    private class NoopGuardrailDao : com.chainlesschain.android.feature.familyguard.data.dao.GuardrailEventDao {
        override suspend fun insert(entity: com.chainlesschain.android.feature.familyguard.data.entity.GuardrailEventEntity): Long = 0
        override suspend fun getAll(): List<com.chainlesschain.android.feature.familyguard.data.entity.GuardrailEventEntity> = emptyList()
        override suspend fun count(): Int = 0
        override suspend fun deleteOlderThan(cutoffMs: Long): Int = 0
    }

    private class NoopVault : CompanionVault {
        override suspend fun load(): List<CompanionChatRecord> = emptyList()
        override suspend fun append(record: CompanionChatRecord) = Unit
        override suspend fun clear() = Unit
        override suspend fun pruneOlderThan(cutoffMs: Long): Int = 0
    }

    private lateinit var repo: FakeFamilyTaskRepository
    private lateinit var taskContext: InMemoryStudyTaskContext
    private lateinit var grader: FakeHomeworkGrader
    private lateinit var mistakeBook: InMemoryMistakeBook
    private lateinit var ledger: InMemoryPointsLedger
    private lateinit var lifecycle: FamilyDataLifecycle

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        repo = FakeFamilyTaskRepository()
        taskContext = InMemoryStudyTaskContext()
        grader = FakeHomeworkGrader()
        mistakeBook = InMemoryMistakeBook()
        ledger = InMemoryPointsLedger()
        lifecycle = FamilyDataLifecycle(repo, NoopGuardrailDao(), NoopVault())
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun vm() = FamilyTaskViewModel(repo, taskContext, grader, mistakeBook, ledger, lifecycle)

    private fun firstTask(viewModel: FamilyTaskViewModel) = viewModel.uiState.value.tasks.first()

    private fun firstTaskNamed(viewModel: FamilyTaskViewModel, title: String) =
        viewModel.uiState.value.tasks.first { it.title == title }

    @Test
    fun `createTask adds an ASSIGNED task visible in state`() = runTest {
        val viewModel = vm()
        viewModel.createTask("数学第3页", "math", "1-10 题")

        val tasks = viewModel.uiState.value.tasks
        assertEquals(1, tasks.size)
        assertEquals("数学第3页", tasks[0].title)
        assertEquals("math", tasks[0].subject)
        assertEquals(FamilyTaskStatus.ASSIGNED, tasks[0].status)
        assertFalse(viewModel.uiState.value.showCreateForm)
    }

    @Test
    fun `createTask with dueInDays persists a due timestamp`() = runTest {
        val before = System.currentTimeMillis()
        val viewModel = vm()
        viewModel.createTask("数学第3页", "math", "", dueInDays = 1)
        val after = System.currentTimeMillis()

        val due = firstTask(viewModel).dueAtMs!!
        val dayMs = 86_400_000L
        assertTrue(due >= before + dayMs && due <= after + dayMs)
        // 默认无截止
        viewModel.createTask("无截止任务", null, "")
        assertNull(viewModel.uiState.value.tasks.first { it.title == "无截止任务" }.dueAtMs)
    }

    @Test
    fun `blank title is ignored`() = runTest {
        val viewModel = vm()
        viewModel.createTask("   ", null, "")
        assertTrue(viewModel.uiState.value.tasks.isEmpty())
    }

    @Test
    fun `enterStudy sets active study task and persists in_progress`() = runTest {
        val viewModel = vm()
        viewModel.createTask("作文", null, "")
        viewModel.enterStudy(firstTask(viewModel))

        assertEquals(FamilyTaskStatus.IN_PROGRESS, firstTask(viewModel).status)
        val active = taskContext.activeTask.value
        assertEquals("作文", active?.title)
    }

    @Test
    fun `submit then aiGrade then complete walks the state machine`() = runTest {
        val viewModel = vm()
        viewModel.createTask("英语阅读", "english", "")
        val t = firstTask(viewModel)
        viewModel.enterStudy(t)
        viewModel.submit(firstTask(viewModel), "my answer")
        assertEquals(FamilyTaskStatus.SUBMITTED, firstTask(viewModel).status)
        assertEquals("my answer", firstTask(viewModel).submission)

        viewModel.aiGrade(firstTask(viewModel))
        assertEquals(FamilyTaskStatus.GRADED, firstTask(viewModel).status)
        // 真批改结果格式化为"<分> 分 — <评语>"
        assertTrue(firstTask(viewModel).aiGrade!!.contains("85 分"))
        assertTrue(firstTask(viewModel).aiGrade!!.contains("分数计算有进步"))
        assertNull(viewModel.uiState.value.gradingTaskId) // 批改完清加载态
    }

    @Test
    fun `aiGrade feeds the submission into the grader and writes mistakes to the book`() = runTest {
        val viewModel = vm()
        viewModel.createTask("数学作业", "math", "P5 题")
        viewModel.enterStudy(firstTask(viewModel))
        viewModel.submit(firstTask(viewModel), "1/2 + 1/3 = 2/5")
        viewModel.aiGrade(firstTask(viewModel))

        // grader 收到的是孩子真实作答
        assertEquals("1/2 + 1/3 = 2/5", grader.lastRequest?.submission)
        assertEquals("math", grader.lastRequest?.subjectCode)
        // 识别出的错题进错题本 (接学习 RAG)
        val mistakes = mistakeBook.snapshot()
        assertEquals(1, mistakes.size)
        assertEquals("分数通分", mistakes[0].knowledgeNode)
        assertEquals(Subject.MATH, mistakes[0].subject)
    }

    @Test
    fun `blank submission is not recorded`() = runTest {
        val viewModel = vm()
        viewModel.createTask("作业", null, "")
        viewModel.enterStudy(firstTask(viewModel))
        viewModel.submit(firstTask(viewModel), "   ")
        assertEquals(FamilyTaskStatus.IN_PROGRESS, firstTask(viewModel).status)
    }

    @Test
    fun `completing the active task clears the study context`() = runTest {
        val viewModel = vm()
        viewModel.createTask("数学", null, "")
        viewModel.enterStudy(firstTask(viewModel))
        viewModel.submit(firstTask(viewModel), "ans")
        viewModel.aiGrade(firstTask(viewModel))
        viewModel.complete(firstTask(viewModel))

        assertNull(taskContext.activeTask.value)
    }

    @Test
    fun `completing a graded homework auto-earns tiered points (M5 to M9)`() = runTest {
        val viewModel = vm()
        viewModel.createTask("数学", "math", "")
        viewModel.enterStudy(firstTask(viewModel))
        viewModel.submit(firstTask(viewModel), "ans")
        viewModel.aiGrade(firstTask(viewModel)) // FakeHomeworkGrader → 85 分 → 80+ 档 = 20
        viewModel.complete(firstTask(viewModel))

        val events = ledger.events.value
        assertEquals(1, events.size)
        assertEquals(PointsEventType.EARN, events[0].type)
        assertEquals(20, events[0].amount)
        assertEquals(firstTask(viewModel).id, events[0].relatedTaskId)
        assertEquals("+20 积分", viewModel.uiState.value.message)

        viewModel.consumeMessage()
        assertNull(viewModel.uiState.value.message)
    }

    @Test
    fun `answer seeking calls from the study tab halve a full-mark earn`() = runTest {
        grader.result = GradingResult(100, "全对", emptyList())
        val viewModel = vm()
        viewModel.createTask("数学", "math", "")
        val id = firstTask(viewModel).id
        viewModel.enterStudy(firstTask(viewModel))
        repeat(3) { taskContext.logAiCall(TaskAiCall(id, it.toLong(), AiCallKind.ANSWER_SEEKING)) }
        viewModel.submit(firstTask(viewModel), "ans")
        viewModel.aiGrade(firstTask(viewModel))
        viewModel.complete(firstTask(viewModel))

        // 满分 30 → answer-seeking ≥3 → 50% = 15
        assertEquals(15, ledger.events.value.single().amount)
        assertTrue(viewModel.uiState.value.message!!.contains("50%"))
    }

    @Test
    fun `group import lands SUGGESTED candidates pending parent confirmation`() = runTest {
        val viewModel = vm()
        viewModel.importFromGroupText(
            "今日作业：\n1. 数学课本第32页 1-10 题\n2. 语文背诵《静夜思》明天检查",
        ).join()

        val tasks = viewModel.uiState.value.tasks
        assertEquals(2, tasks.size)
        assertTrue(tasks.all { it.status == FamilyTaskStatus.SUGGESTED })
        assertTrue(tasks.all { it.source == FamilyTaskSource.SCHOOL_WECHAT_GROUP })
        val math = tasks.first { it.subject == "math" }
        assertTrue(math.title.contains("第32页"))
        assertTrue(viewModel.uiState.value.message!!.contains("2 条"))
    }

    @Test
    fun `confirm promotes SUGGESTED to ASSIGNED and ignore cancels`() = runTest {
        val viewModel = vm()
        viewModel.importFromGroupText("作业：\n1. 数学口算\n2. 英语听写").join()
        val (first, second) = viewModel.uiState.value.tasks

        viewModel.confirmSuggested(first)
        assertEquals(
            FamilyTaskStatus.ASSIGNED,
            viewModel.uiState.value.tasks.first { it.id == first.id }.status,
        )

        viewModel.cancel(second)
        assertEquals(
            FamilyTaskStatus.CANCELLED,
            viewModel.uiState.value.tasks.first { it.id == second.id }.status,
        )
    }

    @Test
    fun `seventh consecutive on-time day adds the streak bonus once`() = runTest {
        val now = System.currentTimeMillis()
        val dayMs = 86_400_000L
        // 史: 前 6 天每天一个准时 DONE
        (1..6).forEach { d ->
            repo.all.value = repo.all.value + FamilyTask(
                id = "hist-$d",
                familyGroupId = "g1",
                assignerDid = "did:chain:local-parent",
                childDid = "did:chain:local-child",
                title = "历史任务 $d",
                status = FamilyTaskStatus.DONE,
                createdAtMs = now - d * dayMs - 1_000L,
                updatedAtMs = now - d * dayMs,
            )
        }
        val viewModel = vm()
        viewModel.createTask("今日数学", "math", "")
        viewModel.enterStudy(firstTaskNamed(viewModel, "今日数学"))
        viewModel.submit(firstTaskNamed(viewModel, "今日数学"), "ans")
        viewModel.aiGrade(firstTaskNamed(viewModel, "今日数学"))
        viewModel.complete(firstTaskNamed(viewModel, "今日数学"))

        val earns = ledger.events.value
        assertEquals(2, earns.size) // 作业分档 +20 与 streak +50
        val streak = earns.first { it.relatedTaskId!!.startsWith("streak-") }
        assertEquals(70, earns.sumOf { it.amount })
        assertTrue(streak.reason.contains("连续 7 天"))
        assertTrue(viewModel.uiState.value.message!!.contains("连续 7 天准时 +50"))

        // 同日再完成一单: streak bonus 按日去重不重复发
        viewModel.createTask("今日英语", "english", "")
        viewModel.enterStudy(firstTaskNamed(viewModel, "今日英语"))
        viewModel.submit(firstTaskNamed(viewModel, "今日英语"), "ans")
        viewModel.aiGrade(firstTaskNamed(viewModel, "今日英语"))
        viewModel.complete(firstTaskNamed(viewModel, "今日英语"))
        assertEquals(1, ledger.events.value.count { it.relatedTaskId!!.startsWith("streak-") })
    }

    @Test
    fun `bounce back with a review writes parent_review and reverts to in progress`() = runTest {
        val viewModel = vm()
        viewModel.createTask("数学", "math", "")
        viewModel.enterStudy(firstTask(viewModel))
        viewModel.submit(firstTask(viewModel), "ans")
        viewModel.aiGrade(firstTask(viewModel))

        viewModel.bounceBack(firstTask(viewModel), review = "第 3 题再想想")
        val task = firstTask(viewModel)
        assertEquals(FamilyTaskStatus.IN_PROGRESS, task.status)
        assertEquals("第 3 题再想想", task.parentReview)

        // 无评语打回不覆盖已有评语
        viewModel.submit(firstTask(viewModel), "ans2")
        viewModel.aiGrade(firstTask(viewModel))
        viewModel.bounceBack(firstTask(viewModel), review = "   ")
        assertEquals("第 3 题再想想", firstTask(viewModel).parentReview)
    }

    @Test
    fun `import with no recognizable homework only sets a hint message`() = runTest {
        val viewModel = vm()
        viewModel.importFromGroupText("明天上午九点开家长会").join()
        assertTrue(viewModel.uiState.value.tasks.isEmpty())
        assertTrue(viewModel.uiState.value.message!!.contains("没识别出"))
    }

    @Test
    fun `cancel from assigned works and clears active if needed`() = runTest {
        val viewModel = vm()
        viewModel.createTask("家务", null, "")
        viewModel.enterStudy(firstTask(viewModel))
        viewModel.cancel(firstTask(viewModel))

        assertEquals(FamilyTaskStatus.CANCELLED, firstTask(viewModel).status)
        assertNull(taskContext.activeTask.value)
    }
}
