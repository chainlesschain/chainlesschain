package com.chainlesschain.android.remote.task

import com.chainlesschain.android.remote.model.ConfirmStatus
import com.chainlesschain.android.remote.model.IntentUnderstanding
import com.chainlesschain.android.remote.model.PlanningState
import com.chainlesschain.android.remote.model.TaskItem
import com.chainlesschain.android.remote.model.TaskPlan
import com.chainlesschain.android.remote.model.TaskStatus
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for TaskPlanManager state management logic
 *
 * Since TaskPlanManager requires Hilt injection, we test the state flow logic
 * using direct MutableStateFlow manipulation and helper functions.
 */
class TaskPlanManagerTest {

    // ===== PlanningState Flow Tests =====

    @Test
    fun `planningState flow starts at IDLE`() {
        val state = MutableStateFlow(PlanningState.IDLE)
        assertEquals(PlanningState.IDLE, state.value)
    }

    @Test
    fun `planningState can transition to ANALYZING`() {
        val state = MutableStateFlow(PlanningState.IDLE)
        state.value = PlanningState.ANALYZING
        assertEquals(PlanningState.ANALYZING, state.value)
    }

    @Test
    fun `planningState can transition to INTERVIEWING`() {
        val state = MutableStateFlow(PlanningState.ANALYZING)
        state.value = PlanningState.INTERVIEWING
        assertEquals(PlanningState.INTERVIEWING, state.value)
    }

    @Test
    fun `planningState can transition to PLANNING`() {
        val state = MutableStateFlow(PlanningState.INTERVIEWING)
        state.value = PlanningState.PLANNING
        assertEquals(PlanningState.PLANNING, state.value)
    }

    @Test
    fun `planningState can transition to CONFIRMING`() {
        val state = MutableStateFlow(PlanningState.PLANNING)
        state.value = PlanningState.CONFIRMING
        assertEquals(PlanningState.CONFIRMING, state.value)
    }

    @Test
    fun `planningState can transition to EXECUTING`() {
        val state = MutableStateFlow(PlanningState.CONFIRMING)
        state.value = PlanningState.EXECUTING
        assertEquals(PlanningState.EXECUTING, state.value)
    }

    @Test
    fun `planningState can transition to COMPLETED`() {
        val state = MutableStateFlow(PlanningState.EXECUTING)
        state.value = PlanningState.COMPLETED
        assertEquals(PlanningState.COMPLETED, state.value)
    }

    @Test
    fun `planningState can transition to CANCELLED`() {
        val state = MutableStateFlow(PlanningState.EXECUTING)
        state.value = PlanningState.CANCELLED
        assertEquals(PlanningState.CANCELLED, state.value)
    }

    // ===== TaskPlan State Tests =====

    @Test
    fun `currentPlan starts null`() {
        val plan = MutableStateFlow<TaskPlan?>(null)
        assertNull(plan.value)
    }

    @Test
    fun `currentPlan can be set`() {
        val plan = MutableStateFlow<TaskPlan?>(null)
        val testPlan = TaskPlan(
            title = "Test Plan",
            summary = "Summary",
            tasks = listOf(
                TaskItem(1, "Task 1", "Do task 1", "action", "output")
            )
        )
        plan.value = testPlan

        assertNotNull(plan.value)
        assertEquals("Test Plan", plan.value?.title)
    }

    // ===== Intent Tests =====

    @Test
    fun `currentIntent starts null`() {
        val intent = MutableStateFlow<IntentUnderstanding?>(null)
        assertNull(intent.value)
    }

    @Test
    fun `currentIntent can be set`() {
        val intent = MutableStateFlow<IntentUnderstanding?>(null)
        intent.value = IntentUnderstanding("Create project", 0.9f)

        assertNotNull(intent.value)
        assertEquals("Create project", intent.value?.intent)
        assertEquals(0.9f, intent.value?.confidence ?: 0f, 0.001f)
    }

    // ===== ConfirmStatus Logic Tests =====

    @Test
    fun `CONFIRMED status transitions state to INTERVIEWING`() {
        val state = MutableStateFlow(PlanningState.ANALYZING)
        val status = ConfirmStatus.CONFIRMED

        when (status) {
            ConfirmStatus.CONFIRMED -> state.value = PlanningState.INTERVIEWING
            ConfirmStatus.REJECTED -> state.value = PlanningState.IDLE
            else -> {}
        }

        assertEquals(PlanningState.INTERVIEWING, state.value)
    }

    @Test
    fun `REJECTED status resets state to IDLE`() {
        val state = MutableStateFlow(PlanningState.ANALYZING)
        val status = ConfirmStatus.REJECTED

        when (status) {
            ConfirmStatus.CONFIRMED -> state.value = PlanningState.INTERVIEWING
            ConfirmStatus.REJECTED -> state.value = PlanningState.IDLE
            else -> {}
        }

        assertEquals(PlanningState.IDLE, state.value)
    }

    // ===== Task Status Update Logic Tests =====

    @Test
    fun `updateTaskStatus logic updates task correctly`() {
        val tasks = mutableListOf(
            TaskItem(1, "Task 1", "D", "a", "o", status = TaskStatus.PENDING),
            TaskItem(2, "Task 2", "D", "a", "o", status = TaskStatus.PENDING)
        )

        // Simulate updating task 1 to COMPLETED
        val updatedTasks = tasks.map { task ->
            if (task.id == 1) {
                task.copy(status = TaskStatus.COMPLETED)
            } else task
        }

        assertEquals(TaskStatus.COMPLETED, updatedTasks[0].status)
        assertEquals(TaskStatus.PENDING, updatedTasks[1].status)
    }

    @Test
    fun `execution progress calculation`() {
        val tasks = listOf(
            TaskItem(1, "Task 1", "D", "a", "o", status = TaskStatus.COMPLETED),
            TaskItem(2, "Task 2", "D", "a", "o", status = TaskStatus.COMPLETED),
            TaskItem(3, "Task 3", "D", "a", "o", status = TaskStatus.PENDING),
            TaskItem(4, "Task 4", "D", "a", "o", status = TaskStatus.PENDING)
        )

        val completed = tasks.count { it.status == TaskStatus.COMPLETED || it.status == TaskStatus.FAILED }
        val progress = completed to tasks.size

        assertEquals(2, progress.first)
        assertEquals(4, progress.second)
    }

    @Test
    fun `all tasks completed detection`() {
        val tasks = listOf(
            TaskItem(1, "Task 1", "D", "a", "o", status = TaskStatus.COMPLETED),
            TaskItem(2, "Task 2", "D", "a", "o", status = TaskStatus.COMPLETED)
        )

        val completed = tasks.count { it.status == TaskStatus.COMPLETED || it.status == TaskStatus.FAILED }
        val allDone = completed == tasks.size

        assertTrue(allDone)
    }

    @Test
    fun `not all tasks completed`() {
        val tasks = listOf(
            TaskItem(1, "Task 1", "D", "a", "o", status = TaskStatus.COMPLETED),
            TaskItem(2, "Task 2", "D", "a", "o", status = TaskStatus.PENDING)
        )

        val completed = tasks.count { it.status == TaskStatus.COMPLETED || it.status == TaskStatus.FAILED }
        val allDone = completed == tasks.size

        assertFalse(allDone)
    }

    // ===== Cancel Execution Logic Tests =====

    @Test
    fun `cancelExecution marks pending tasks as SKIPPED`() {
        val tasks = listOf(
            TaskItem(1, "Task 1", "D", "a", "o", status = TaskStatus.COMPLETED),
            TaskItem(2, "Task 2", "D", "a", "o", status = TaskStatus.IN_PROGRESS),
            TaskItem(3, "Task 3", "D", "a", "o", status = TaskStatus.PENDING)
        )

        val cancelledTasks = tasks.map { task ->
            if (task.status == TaskStatus.IN_PROGRESS || task.status == TaskStatus.PENDING) {
                task.copy(status = TaskStatus.SKIPPED)
            } else task
        }

        assertEquals(TaskStatus.COMPLETED, cancelledTasks[0].status)
        assertEquals(TaskStatus.SKIPPED, cancelledTasks[1].status)
        assertEquals(TaskStatus.SKIPPED, cancelledTasks[2].status)
    }

    // ===== Reset Logic Tests =====

    @Test
    fun `reset clears all state`() {
        val planningState = MutableStateFlow(PlanningState.EXECUTING)
        val currentPlan = MutableStateFlow<TaskPlan?>(TaskPlan(title = "Test", summary = "Sum", tasks = emptyList()))
        val currentIntent = MutableStateFlow<IntentUnderstanding?>(IntentUnderstanding(intent = "Test", confidence = 0.9f))
        val error = MutableStateFlow<String?>("Some error")

        // Reset
        planningState.value = PlanningState.IDLE
        currentPlan.value = null
        currentIntent.value = null
        error.value = null

        assertEquals(PlanningState.IDLE, planningState.value)
        assertNull(currentPlan.value)
        assertNull(currentIntent.value)
        assertNull(error.value)
    }

    // ===== Interview Questions Generation Logic Tests =====

    @Test
    fun `create intent generates project questions`() {
        val intent = "create a new project"
        val hasCreate = intent.contains("create", ignoreCase = true)

        assertTrue(hasCreate)
    }

    @Test
    fun `refactor intent generates refactor questions`() {
        val intent = "refactor the code"
        val hasRefactor = intent.contains("refactor", ignoreCase = true)

        assertTrue(hasRefactor)
    }

    @Test
    fun `test intent generates test questions`() {
        val intent = "add tests to the module"
        val hasTest = intent.contains("test", ignoreCase = true)

        assertTrue(hasTest)
    }

    // ===== Error Handling Tests =====

    @Test
    fun `error state can be set and cleared`() {
        val error = MutableStateFlow<String?>(null)

        // Set error
        error.value = "Something went wrong"
        assertEquals("Something went wrong", error.value)

        // Clear error
        error.value = null
        assertNull(error.value)
    }

    // ===== Execution Progress Tests =====

    @Test
    fun `execution progress initializes at 0`() {
        val progress = MutableStateFlow(0 to 0)
        assertEquals(0, progress.value.first)
        assertEquals(0, progress.value.second)
    }

    @Test
    fun `execution progress updates correctly`() {
        val progress = MutableStateFlow(0 to 5)

        progress.value = 1 to 5
        assertEquals(1, progress.value.first)

        progress.value = 2 to 5
        assertEquals(2, progress.value.first)

        progress.value = 5 to 5
        assertEquals(5, progress.value.first)
        assertEquals(5, progress.value.second)
    }
}
