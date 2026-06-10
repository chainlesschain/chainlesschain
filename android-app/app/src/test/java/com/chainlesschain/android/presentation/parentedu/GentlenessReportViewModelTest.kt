package com.chainlesschain.android.presentation.parentedu

import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyTaskRepository
import com.chainlesschain.android.feature.familyguard.domain.task.AiCallLogEntry
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTask
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskStatus
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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class GentlenessReportViewModelTest {

    private class FakeFamilyTaskRepository(
        initial: List<FamilyTask> = emptyList(),
    ) : FamilyTaskRepository {
        val all = MutableStateFlow(initial)
        private fun find(id: String) = all.value.firstOrNull { it.id == id }

        override suspend fun upsert(task: FamilyTask) {
            all.value = all.value.filterNot { it.id == task.id } + task
        }
        override suspend fun getById(id: String) = find(id)
        override fun observeForChild(childDid: String): Flow<List<FamilyTask>> =
            all.map { list -> list.filter { it.childDid == childDid } }
        override fun observeForChild(childDid: String, status: FamilyTaskStatus) =
            all.map { list -> list.filter { it.childDid == childDid && it.status == status } }
        override suspend fun activeTasksForChild(childDid: String) =
            all.value.filter { it.childDid == childDid && it.status == FamilyTaskStatus.IN_PROGRESS }
        override suspend fun transition(id: String, to: FamilyTaskStatus) = false
        override suspend fun recordSubmission(id: String, submission: String) = false
        override suspend fun recordAiGrade(id: String, aiGrade: String) = false
        override suspend fun recordParentReview(id: String, review: String) = false
        override suspend fun appendAiCall(id: String, entry: AiCallLogEntry) = false
        override suspend fun delete(id: String) = false
        override suspend fun deleteTerminalOlderThan(cutoffMs: Long) = 0
    }

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun task(id: String, status: FamilyTaskStatus) = FamilyTask(
        id = id,
        familyGroupId = "g1",
        assignerDid = "did:chain:local-parent",
        childDid = "did:chain:local-child",
        title = "t",
        status = status,
        createdAtMs = System.currentTimeMillis() - 1_000L,
        updatedAtMs = System.currentTimeMillis() - 1_000L,
    )

    @Test
    fun `with task history the report uses real cancellation rate`() = runTest {
        val vm = GentlenessReportViewModel(
            FakeFamilyTaskRepository(
                listOf(
                    task("a", FamilyTaskStatus.DONE),
                    task("b", FamilyTaskStatus.CANCELLED),
                ),
            ),
        )
        val state = vm.uiState.value
        assertTrue(state.fromRealData)
        assertEquals(0.5, state.metrics.cancellationRate, 1e-9)
        // 采集缺口字段保留演示值 (不假装为 0 真值)
        assertEquals(35, state.metrics.forceStopCount)
    }

    @Test
    fun `without task history demo metrics are kept`() = runTest {
        val vm = GentlenessReportViewModel(FakeFamilyTaskRepository())
        val state = vm.uiState.value
        assertFalse(state.fromRealData)
        assertEquals(0.2, state.metrics.cancellationRate, 1e-9)
    }

    @Test
    fun `sliders still recompute on top of real data`() = runTest {
        val vm = GentlenessReportViewModel(
            FakeFamilyTaskRepository(listOf(task("a", FamilyTaskStatus.DONE))),
        )
        val scoreBefore = vm.uiState.value.report.score
        vm.setForceStopCount(60f)
        val state = vm.uiState.value
        assertEquals(60, state.metrics.forceStopCount)
        assertTrue(state.fromRealData) // what-if 调整不抹掉真实来源标记
        assertTrue(state.report.score < scoreBefore) // force-stop 拉高 → 温和度降
    }
}
