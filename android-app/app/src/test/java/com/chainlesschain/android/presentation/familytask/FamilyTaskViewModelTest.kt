package com.chainlesschain.android.presentation.familytask

import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyTaskRepository
import com.chainlesschain.android.feature.familyguard.domain.task.AiCallLogEntry
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTask
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskStatus
import com.chainlesschain.android.presentation.aistudy.InMemoryStudyTaskContext
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

    private lateinit var repo: FakeFamilyTaskRepository
    private lateinit var taskContext: InMemoryStudyTaskContext

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        repo = FakeFamilyTaskRepository()
        taskContext = InMemoryStudyTaskContext()
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun vm() = FamilyTaskViewModel(repo, taskContext)

    private fun firstTask(viewModel: FamilyTaskViewModel) = viewModel.uiState.value.tasks.first()

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
        viewModel.submit(firstTask(viewModel))
        assertEquals(FamilyTaskStatus.SUBMITTED, firstTask(viewModel).status)

        viewModel.aiGrade(firstTask(viewModel))
        assertEquals(FamilyTaskStatus.GRADED, firstTask(viewModel).status)
        assertTrue(firstTask(viewModel).aiGrade!!.contains("AI 批改"))

        viewModel.complete(firstTask(viewModel))
        assertEquals(FamilyTaskStatus.DONE, firstTask(viewModel).status)
    }

    @Test
    fun `completing the active task clears the study context`() = runTest {
        val viewModel = vm()
        viewModel.createTask("数学", null, "")
        viewModel.enterStudy(firstTask(viewModel))
        viewModel.submit(firstTask(viewModel))
        viewModel.aiGrade(firstTask(viewModel))
        viewModel.complete(firstTask(viewModel))

        assertNull(taskContext.activeTask.value)
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
