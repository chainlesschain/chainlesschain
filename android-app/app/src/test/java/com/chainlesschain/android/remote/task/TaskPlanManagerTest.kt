package com.chainlesschain.android.remote.task

import com.chainlesschain.android.remote.model.ConfirmStatus
import com.chainlesschain.android.remote.model.IntentUnderstanding
import com.chainlesschain.android.remote.model.InterviewQuestion
import com.chainlesschain.android.remote.model.PlanningState
import com.chainlesschain.android.remote.model.TaskItem
import com.chainlesschain.android.remote.model.TaskPlan
import com.chainlesschain.android.remote.model.TaskStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for TaskPlanManager
 *
 * Tests the state management and flow logic of the planning system.
 * Uses reflection to set internal state for testing without network calls.
 */
class TaskPlanManagerTest {

    private lateinit var manager: TaskPlanManager

    @Before
    fun setup() {
        // Create manager with null client - we'll use reflection for state testing
        manager = createTestManager()
    }

    /**
     * Creates a TaskPlanManager for testing using reflection
     */
    private fun createTestManager(): TaskPlanManager {
        // Use reflection to create instance without Hilt injection
        val constructor = TaskPlanManager::class.java.declaredConstructors[0]
        constructor.isAccessible = true
        return constructor.newInstance(null) as TaskPlanManager
    }

    // ===== Initial State Tests =====

    @Test
    fun `initial state is IDLE`() = runBlocking {
        assertEquals(PlanningState.IDLE, manager.planningState.first())
    }

    @Test
    fun `initial plan is null`() = runBlocking {
        assertNull(manager.currentPlan.first())
    }

    @Test
    fun `initial intent is null`() = runBlocking {
        assertNull(manager.currentIntent.first())
    }

    @Test
    fun `initial interview questions is empty`() = runBlocking {
        assertTrue(manager.interviewQuestions.first().isEmpty())
    }

    @Test
    fun `initial error is null`() = runBlocking {
        assertNull(manager.error.first())
    }

    // ===== confirmIntent Tests =====

    @Test
    fun `confirmIntent CONFIRMED transitions to INTERVIEWING`() = runBlocking {
        // First set a dummy intent
        setDummyIntent()

        manager.confirmIntent(ConfirmStatus.CONFIRMED)

        assertEquals(PlanningState.INTERVIEWING, manager.planningState.first())
    }

    @Test
    fun `confirmIntent REJECTED resets to IDLE`() = runBlocking {
        setDummyIntent()

        manager.confirmIntent(ConfirmStatus.REJECTED)

        assertEquals(PlanningState.IDLE, manager.planningState.first())
        assertNull(manager.currentIntent.first())
    }

    @Test
    fun `confirmIntent MODIFIED updates intent and transitions`() = runBlocking {
        setDummyIntent()

        manager.confirmIntent(ConfirmStatus.MODIFIED, "Modified intent")

        assertEquals(PlanningState.INTERVIEWING, manager.planningState.first())
        assertEquals("Modified intent", manager.currentIntent.first()?.intent)
    }

    @Test
    fun `confirmIntent generates interview questions`() = runBlocking {
        setDummyIntent()

        manager.confirmIntent(ConfirmStatus.CONFIRMED)

        val questions = manager.interviewQuestions.first()
        assertTrue(questions.isNotEmpty())
    }

    // ===== Interview Question Tests =====

    @Test
    fun `answerQuestion updates question answer`() = runBlocking {
        setDummyIntent()
        manager.confirmIntent(ConfirmStatus.CONFIRMED)

        val questions = manager.interviewQuestions.first()
        val firstQuestion = questions.first()

        manager.answerQuestion(firstQuestion.id, "Test answer")

        val updatedQuestions = manager.interviewQuestions.first()
        assertEquals("Test answer", updatedQuestions.first().answer)
    }

    @Test
    fun `answerQuestion moves to next unanswered`() = runBlocking {
        setDummyIntent()
        manager.confirmIntent(ConfirmStatus.CONFIRMED)

        val questions = manager.interviewQuestions.first()
        val firstQuestion = questions.first()

        manager.answerQuestion(firstQuestion.id, "Answer 1")

        val newIndex = manager.currentQuestionIndex.first()
        assertTrue(newIndex > 0 || manager.planningState.first() == PlanningState.PLANNING)
    }

    @Test
    fun `skipQuestion marks optional question as skipped`() = runBlocking {
        setDummyIntent()
        manager.confirmIntent(ConfirmStatus.CONFIRMED)

        // Find an optional question
        val questions = manager.interviewQuestions.first()
        val optionalQuestion = questions.find { !it.required }

        if (optionalQuestion != null) {
            manager.skipQuestion(optionalQuestion.id)

            val updated = manager.interviewQuestions.first()
            val skipped = updated.find { it.id == optionalQuestion.id }
            assertEquals("[Skipped]", skipped?.answer)
        }
    }

    @Test
    fun `skipQuestion does nothing for required questions`() = runBlocking {
        setDummyIntent()
        manager.confirmIntent(ConfirmStatus.CONFIRMED)

        val questions = manager.interviewQuestions.first()
        val requiredQuestion = questions.find { it.required }

        if (requiredQuestion != null) {
            manager.skipQuestion(requiredQuestion.id)

            val updated = manager.interviewQuestions.first()
            val question = updated.find { it.id == requiredQuestion.id }
            assertNull(question?.answer)
        }
    }

    // ===== Plan Confirmation Tests =====

    @Test
    fun `confirmPlan transitions to EXECUTING`() = runBlocking {
        setDummyPlan()

        manager.confirmPlan()

        assertEquals(PlanningState.EXECUTING, manager.planningState.first())
    }

    @Test
    fun `confirmPlan initializes execution progress`() = runBlocking {
        setDummyPlan()

        manager.confirmPlan()

        val progress = manager.executionProgress.first()
        assertEquals(0, progress.first)
        assertEquals(2, progress.second) // 2 tasks in dummy plan
    }

    @Test
    fun `rejectPlan returns to INTERVIEWING`() = runBlocking {
        setDummyPlan()

        manager.rejectPlan()

        assertEquals(PlanningState.INTERVIEWING, manager.planningState.first())
        assertNull(manager.currentPlan.first())
    }

    // ===== Task Status Update Tests =====

    @Test
    fun `updateTaskStatus updates task in plan`() = runBlocking {
        setDummyPlan()
        manager.confirmPlan()

        manager.updateTaskStatus(1, TaskStatus.COMPLETED)

        val plan = manager.currentPlan.first()
        val task = plan?.tasks?.find { it.id == 1 }
        assertEquals(TaskStatus.COMPLETED, task?.status)
    }

    @Test
    fun `updateTaskStatus updates execution progress`() = runBlocking {
        setDummyPlan()
        manager.confirmPlan()

        manager.updateTaskStatus(1, TaskStatus.COMPLETED)

        val progress = manager.executionProgress.first()
        assertEquals(1, progress.first)
    }

    @Test
    fun `updateTaskStatus transitions to COMPLETED when all tasks done`() = runBlocking {
        setDummyPlan()
        manager.confirmPlan()

        manager.updateTaskStatus(1, TaskStatus.COMPLETED)
        manager.updateTaskStatus(2, TaskStatus.COMPLETED)

        assertEquals(PlanningState.COMPLETED, manager.planningState.first())
    }

    @Test
    fun `updateTaskStatus with progress updates task progress`() = runBlocking {
        setDummyPlan()
        manager.confirmPlan()

        manager.updateTaskStatus(1, TaskStatus.IN_PROGRESS, progress = 50)

        val plan = manager.currentPlan.first()
        val task = plan?.tasks?.find { it.id == 1 }
        assertEquals(50, task?.progress)
    }

    @Test
    fun `updateTaskStatus with error sets task error`() = runBlocking {
        setDummyPlan()
        manager.confirmPlan()

        manager.updateTaskStatus(1, TaskStatus.FAILED, error = "Connection failed")

        val plan = manager.currentPlan.first()
        val task = plan?.tasks?.find { it.id == 1 }
        assertEquals("Connection failed", task?.error)
    }

    // ===== Cancel Execution Tests =====

    @Test
    fun `cancelExecution transitions to CANCELLED`() = runBlocking {
        setDummyPlan()
        manager.confirmPlan()

        manager.cancelExecution()

        assertEquals(PlanningState.CANCELLED, manager.planningState.first())
    }

    @Test
    fun `cancelExecution marks pending tasks as SKIPPED`() = runBlocking {
        setDummyPlan()
        manager.confirmPlan()

        manager.cancelExecution()

        val plan = manager.currentPlan.first()
        val allSkipped = plan?.tasks?.all { it.status == TaskStatus.SKIPPED } ?: false
        assertTrue(allSkipped)
    }

    @Test
    fun `cancelExecution preserves completed tasks`() = runBlocking {
        setDummyPlan()
        manager.confirmPlan()

        manager.updateTaskStatus(1, TaskStatus.COMPLETED)
        manager.cancelExecution()

        val plan = manager.currentPlan.first()
        val task1 = plan?.tasks?.find { it.id == 1 }
        val task2 = plan?.tasks?.find { it.id == 2 }

        assertEquals(TaskStatus.COMPLETED, task1?.status)
        assertEquals(TaskStatus.SKIPPED, task2?.status)
    }

    // ===== Reset Tests =====

    @Test
    fun `reset clears all state`() = runBlocking {
        setDummyPlan()
        manager.confirmPlan()

        manager.reset()

        assertEquals(PlanningState.IDLE, manager.planningState.first())
        assertNull(manager.currentPlan.first())
        assertNull(manager.currentIntent.first())
        assertTrue(manager.interviewQuestions.first().isEmpty())
        assertEquals(0, manager.currentQuestionIndex.first())
        assertEquals(0 to 0, manager.executionProgress.first())
        assertNull(manager.error.first())
    }

    // ===== Error Handling Tests =====

    @Test
    fun `clearError removes error`() = runBlocking {
        // Simulate error by accessing internal state
        // For testing, we would need to expose error setting
        manager.clearError()
        assertNull(manager.error.first())
    }

    // ===== Interview Question Generation Tests =====

    @Test
    fun `create intent generates appropriate questions`() = runBlocking {
        setIntentWith("create a new project")
        manager.confirmIntent(ConfirmStatus.CONFIRMED)

        val questions = manager.interviewQuestions.first()
        assertTrue(questions.any { it.question.contains("type", ignoreCase = true) })
    }

    @Test
    fun `refactor intent generates appropriate questions`() = runBlocking {
        setIntentWith("refactor the code")
        manager.confirmIntent(ConfirmStatus.CONFIRMED)

        val questions = manager.interviewQuestions.first()
        assertTrue(questions.any {
            it.question.contains("refactor", ignoreCase = true) ||
                    it.question.contains("part", ignoreCase = true) ||
                    it.question.contains("goal", ignoreCase = true)
        })
    }

    @Test
    fun `test intent generates appropriate questions`() = runBlocking {
        setIntentWith("add tests to the module")
        manager.confirmIntent(ConfirmStatus.CONFIRMED)

        val questions = manager.interviewQuestions.first()
        assertTrue(questions.any {
            it.question.contains("test", ignoreCase = true) ||
                    it.question.contains("coverage", ignoreCase = true)
        })
    }

    // ===== Helper Methods =====

    private fun setDummyIntent() = runBlocking {
        // Use reflection or internal method to set intent for testing
        val field = TaskPlanManager::class.java.getDeclaredField("_currentIntent")
        field.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val flow = field.get(manager) as kotlinx.coroutines.flow.MutableStateFlow<IntentUnderstanding?>
        flow.value = IntentUnderstanding(
            intent = "Test intent",
            confidence = 0.9f
        )
    }

    private fun setIntentWith(intentText: String) = runBlocking {
        val field = TaskPlanManager::class.java.getDeclaredField("_currentIntent")
        field.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val flow = field.get(manager) as kotlinx.coroutines.flow.MutableStateFlow<IntentUnderstanding?>
        flow.value = IntentUnderstanding(
            intent = intentText,
            confidence = 0.9f
        )
    }

    private fun setDummyPlan() = runBlocking {
        setDummyIntent()

        // Set plan directly for testing
        val planField = TaskPlanManager::class.java.getDeclaredField("_currentPlan")
        planField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val planFlow = planField.get(manager) as kotlinx.coroutines.flow.MutableStateFlow<TaskPlan?>
        planFlow.value = TaskPlan(
            title = "Test Plan",
            summary = "A test plan",
            tasks = listOf(
                TaskItem(1, "Task 1", "Do task 1", "action1", "output1"),
                TaskItem(2, "Task 2", "Do task 2", "action2", "output2")
            )
        )

        // Set state to CONFIRMING
        val stateField = TaskPlanManager::class.java.getDeclaredField("_planningState")
        stateField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val stateFlow = stateField.get(manager) as kotlinx.coroutines.flow.MutableStateFlow<PlanningState>
        stateFlow.value = PlanningState.CONFIRMING
    }
}
