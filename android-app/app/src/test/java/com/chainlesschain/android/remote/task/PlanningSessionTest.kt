package com.chainlesschain.android.remote.task

import com.chainlesschain.android.remote.model.ConfirmStatus
import com.chainlesschain.android.remote.model.ContextMode
import com.chainlesschain.android.remote.model.FileReference
import com.chainlesschain.android.remote.model.IntentUnderstanding
import com.chainlesschain.android.remote.model.InterviewQuestion
import com.chainlesschain.android.remote.model.PlanningState
import com.chainlesschain.android.remote.model.TaskItem
import com.chainlesschain.android.remote.model.TaskPlan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for PlanningSession
 */
class PlanningSessionTest {

    // ===== Creation Tests =====

    @Test
    fun `create session with defaults`() {
        val session = PlanningSession(originalRequest = "Build a web app")

        assertNotNull(session.id)
        assertEquals("Build a web app", session.originalRequest)
        assertEquals(ContextMode.PROJECT, session.contextMode)
        assertEquals(PlanningState.IDLE, session.state)
        assertNull(session.intent)
        assertNull(session.plan)
        assertTrue(session.referencedFiles.isEmpty())
        assertTrue(session.startedAt > 0)
    }

    @Test
    fun `create session using companion factory`() {
        val files = listOf(FileReference.fromPath("src/main.kt"))
        val session = PlanningSession.create(
            request = "Refactor code",
            contextMode = ContextMode.FILE,
            referencedFiles = files
        )

        assertEquals("Refactor code", session.originalRequest)
        assertEquals(ContextMode.FILE, session.contextMode)
        assertEquals(PlanningState.ANALYZING, session.state)
        assertEquals(1, session.referencedFiles.size)
    }

    // ===== isActive Tests =====

    @Test
    fun `isActive returns false for IDLE state`() {
        val session = PlanningSession(originalRequest = "test")
        assertFalse(session.isActive)
    }

    @Test
    fun `isActive returns true for ANALYZING state`() {
        val session = PlanningSession(originalRequest = "test", state = PlanningState.ANALYZING)
        assertTrue(session.isActive)
    }

    @Test
    fun `isActive returns true for EXECUTING state`() {
        val session = PlanningSession(originalRequest = "test", state = PlanningState.EXECUTING)
        assertTrue(session.isActive)
    }

    @Test
    fun `isActive returns false for COMPLETED state`() {
        val session = PlanningSession(originalRequest = "test", state = PlanningState.COMPLETED)
        assertFalse(session.isActive)
    }

    @Test
    fun `isActive returns false for CANCELLED state`() {
        val session = PlanningSession(originalRequest = "test", state = PlanningState.CANCELLED)
        assertFalse(session.isActive)
    }

    // ===== State Transition Tests =====

    @Test
    fun `transitionTo changes state`() {
        val session = PlanningSession(originalRequest = "test")
        val newSession = session.transitionTo(PlanningState.ANALYZING)

        assertEquals(PlanningState.ANALYZING, newSession.state)
    }

    @Test
    fun `transitionTo COMPLETED sets completedAt`() {
        val session = PlanningSession(originalRequest = "test")
        val newSession = session.transitionTo(PlanningState.COMPLETED)

        assertEquals(PlanningState.COMPLETED, newSession.state)
        assertNotNull(newSession.completedAt)
    }

    @Test
    fun `transitionTo CANCELLED sets completedAt`() {
        val session = PlanningSession(originalRequest = "test")
        val newSession = session.transitionTo(PlanningState.CANCELLED)

        assertNotNull(newSession.completedAt)
    }

    // ===== Intent Tests =====

    @Test
    fun `withIntent updates intent and state`() {
        val session = PlanningSession(originalRequest = "test", state = PlanningState.ANALYZING)
        val intent = IntentUnderstanding(intent = "Create project", confidence = 0.9f)
        val newSession = session.withIntent(intent)

        assertEquals(intent, newSession.intent)
        assertEquals(PlanningState.CONFIRMING, newSession.state)
    }

    @Test
    fun `confirmIntent CONFIRMED transitions to INTERVIEWING`() {
        val session = PlanningSession(
            originalRequest = "test",
            intent = IntentUnderstanding("test", 0.9f)
        )
        val newSession = session.confirmIntent(ConfirmStatus.CONFIRMED)

        assertEquals(ConfirmStatus.CONFIRMED, newSession.intentConfirmStatus)
        assertEquals(PlanningState.INTERVIEWING, newSession.state)
    }

    @Test
    fun `confirmIntent REJECTED transitions to CANCELLED`() {
        val session = PlanningSession(
            originalRequest = "test",
            intent = IntentUnderstanding("test", 0.9f)
        )
        val newSession = session.confirmIntent(ConfirmStatus.REJECTED)

        assertEquals(ConfirmStatus.REJECTED, newSession.intentConfirmStatus)
        assertEquals(PlanningState.CANCELLED, newSession.state)
    }

    // ===== Interview Questions Tests =====

    @Test
    fun `allQuestionsAnswered returns true when no questions`() {
        val session = PlanningSession(originalRequest = "test")
        assertTrue(session.allQuestionsAnswered)
    }

    @Test
    fun `allQuestionsAnswered returns true when all required answered`() {
        val questions = listOf(
            InterviewQuestion(1, "Q1", required = true, answer = "A1"),
            InterviewQuestion(2, "Q2", required = false, answer = null)
        )
        val session = PlanningSession(originalRequest = "test", interviewQuestions = questions)

        assertTrue(session.allQuestionsAnswered)
    }

    @Test
    fun `allQuestionsAnswered returns false when required unanswered`() {
        val questions = listOf(
            InterviewQuestion(1, "Q1", required = true, answer = null),
            InterviewQuestion(2, "Q2", required = true, answer = "A2")
        )
        val session = PlanningSession(originalRequest = "test", interviewQuestions = questions)

        assertFalse(session.allQuestionsAnswered)
    }

    @Test
    fun `currentQuestion returns correct question`() {
        val questions = listOf(
            InterviewQuestion(1, "Q1"),
            InterviewQuestion(2, "Q2")
        )
        val session = PlanningSession(
            originalRequest = "test",
            interviewQuestions = questions,
            currentQuestionIndex = 1
        )

        assertEquals(2, session.currentQuestion?.id)
    }

    @Test
    fun `answerQuestion updates question and moves to next`() {
        val questions = listOf(
            InterviewQuestion(1, "Q1", required = true, answer = null),
            InterviewQuestion(2, "Q2", required = true, answer = null)
        )
        val session = PlanningSession(
            originalRequest = "test",
            interviewQuestions = questions,
            state = PlanningState.INTERVIEWING
        )

        val newSession = session.answerQuestion(1, "Answer 1")

        assertEquals("Answer 1", newSession.interviewQuestions[0].answer)
        assertEquals(1, newSession.currentQuestionIndex) // Moved to next unanswered
    }

    @Test
    fun `answerQuestion transitions to PLANNING when all answered`() {
        val questions = listOf(
            InterviewQuestion(1, "Q1", required = true, answer = null)
        )
        val session = PlanningSession(
            originalRequest = "test",
            interviewQuestions = questions,
            state = PlanningState.INTERVIEWING
        )

        val newSession = session.answerQuestion(1, "Answer")

        assertEquals(PlanningState.PLANNING, newSession.state)
    }

    @Test
    fun `unansweredRequiredQuestions returns correct list`() {
        val questions = listOf(
            InterviewQuestion(1, "Q1", required = true, answer = "A1"),
            InterviewQuestion(2, "Q2", required = true, answer = null),
            InterviewQuestion(3, "Q3", required = false, answer = null)
        )
        val session = PlanningSession(originalRequest = "test", interviewQuestions = questions)

        val unanswered = session.unansweredRequiredQuestions

        assertEquals(1, unanswered.size)
        assertEquals(2, unanswered[0].id)
    }

    // ===== Plan Tests =====

    @Test
    fun `withPlan sets plan and transitions to CONFIRMING`() {
        val plan = TaskPlan(
            title = "Test Plan",
            summary = "Summary",
            tasks = emptyList()
        )
        val session = PlanningSession(originalRequest = "test", state = PlanningState.PLANNING)
        val newSession = session.withPlan(plan)

        assertEquals(plan.title, newSession.plan?.title)
        assertEquals(PlanningState.CONFIRMING, newSession.state)
    }

    @Test
    fun `startExecution sets planConfirmed and state`() {
        val plan = TaskPlan(
            title = "Test",
            summary = "Sum",
            tasks = listOf(TaskItem(1, "Task 1", "Desc", "action", "output"))
        )
        val session = PlanningSession(originalRequest = "test", plan = plan)
        val newSession = session.startExecution()

        assertTrue(newSession.planConfirmed)
        assertEquals(PlanningState.EXECUTING, newSession.state)
        assertEquals(1, newSession.executingTaskId)
    }

    // ===== Execution Progress Tests =====

    @Test
    fun `executionProgress returns 0 when no plan`() {
        val session = PlanningSession(originalRequest = "test")
        assertEquals(0f, session.executionProgress, 0.001f)
    }

    @Test
    fun `executionProgress returns correct fraction`() {
        val plan = TaskPlan(
            title = "Test",
            summary = "Sum",
            tasks = listOf(
                TaskItem(1, "T1", "D", "a", "o"),
                TaskItem(2, "T2", "D", "a", "o"),
                TaskItem(3, "T3", "D", "a", "o"),
                TaskItem(4, "T4", "D", "a", "o")
            )
        )
        val session = PlanningSession(
            originalRequest = "test",
            plan = plan,
            completedTaskIds = setOf(1, 2)
        )

        assertEquals(0.5f, session.executionProgress, 0.001f)
    }

    @Test
    fun `completeTask updates completedTaskIds and moves to next`() {
        val plan = TaskPlan(
            title = "Test",
            summary = "Sum",
            tasks = listOf(
                TaskItem(1, "T1", "D", "a", "o"),
                TaskItem(2, "T2", "D", "a", "o")
            )
        )
        val session = PlanningSession(
            originalRequest = "test",
            plan = plan,
            executingTaskId = 1
        )

        val newSession = session.completeTask(1)

        assertTrue(1 in newSession.completedTaskIds)
        assertEquals(2, newSession.executingTaskId)
    }

    @Test
    fun `completeTask marks session complete when all tasks done`() {
        val plan = TaskPlan(
            title = "Test",
            summary = "Sum",
            tasks = listOf(TaskItem(1, "T1", "D", "a", "o"))
        )
        val session = PlanningSession(
            originalRequest = "test",
            plan = plan,
            state = PlanningState.EXECUTING
        )

        val newSession = session.completeTask(1)

        assertEquals(PlanningState.COMPLETED, newSession.state)
        assertNotNull(newSession.completedAt)
    }

    @Test
    fun `failTask updates failedTaskIds and sets error`() {
        val plan = TaskPlan(
            title = "Test",
            summary = "Sum",
            tasks = listOf(
                TaskItem(1, "T1", "D", "a", "o"),
                TaskItem(2, "T2", "D", "a", "o")
            )
        )
        val session = PlanningSession(
            originalRequest = "test",
            plan = plan,
            executingTaskId = 1
        )

        val newSession = session.failTask(1, "Connection failed")

        assertTrue(1 in newSession.failedTaskIds)
        assertEquals("Connection failed", newSession.error)
        assertEquals(2, newSession.executingTaskId)
    }

    @Test
    fun `isExecutionComplete returns true when all tasks done`() {
        val plan = TaskPlan(
            title = "Test",
            summary = "Sum",
            tasks = listOf(
                TaskItem(1, "T1", "D", "a", "o"),
                TaskItem(2, "T2", "D", "a", "o")
            )
        )
        val session = PlanningSession(
            originalRequest = "test",
            plan = plan,
            completedTaskIds = setOf(1),
            failedTaskIds = setOf(2)
        )

        assertTrue(session.isExecutionComplete)
    }

    @Test
    fun `nextPendingTaskId returns correct task`() {
        val plan = TaskPlan(
            title = "Test",
            summary = "Sum",
            tasks = listOf(
                TaskItem(1, "T1", "D", "a", "o"),
                TaskItem(2, "T2", "D", "a", "o"),
                TaskItem(3, "T3", "D", "a", "o")
            )
        )
        val session = PlanningSession(
            originalRequest = "test",
            plan = plan,
            completedTaskIds = setOf(1)
        )

        assertEquals(2, session.nextPendingTaskId)
    }

    // ===== Cancel Tests =====

    @Test
    fun `cancel sets state and completedAt`() {
        val session = PlanningSession(
            originalRequest = "test",
            state = PlanningState.EXECUTING
        )

        val cancelled = session.cancel()

        assertEquals(PlanningState.CANCELLED, cancelled.state)
        assertNotNull(cancelled.completedAt)
    }

    // ===== Metadata Tests =====

    @Test
    fun `withMetadata adds metadata`() {
        val session = PlanningSession(originalRequest = "test")
        val newSession = session
            .withMetadata("key1", "value1")
            .withMetadata("key2", "value2")

        assertEquals("value1", newSession.metadata["key1"])
        assertEquals("value2", newSession.metadata["key2"])
    }

    // ===== Duration Tests =====

    @Test
    fun `duration calculates correctly`() {
        val startTime = System.currentTimeMillis() - 5000
        val session = PlanningSession(
            originalRequest = "test",
            startedAt = startTime
        )

        assertTrue(session.duration >= 5000)
    }
}

/**
 * Unit tests for PlanningEvent
 */
class PlanningEventTest {

    @Test
    fun `SessionStarted has correct fields`() {
        val event = PlanningEvent.SessionStarted(
            sessionId = "session-123",
            request = "Build something"
        )

        assertEquals("session-123", event.sessionId)
        assertEquals("Build something", event.request)
        assertTrue(event.timestamp > 0)
    }

    @Test
    fun `IntentAnalyzed has correct fields`() {
        val intent = IntentUnderstanding("Create app", 0.95f)
        val event = PlanningEvent.IntentAnalyzed(
            sessionId = "session-123",
            intent = intent
        )

        assertEquals(intent, event.intent)
    }

    @Test
    fun `TaskCompleted has correct fields`() {
        val event = PlanningEvent.TaskCompleted(
            sessionId = "session-123",
            taskId = 5
        )

        assertEquals(5, event.taskId)
    }

    @Test
    fun `TaskFailed captures error`() {
        val event = PlanningEvent.TaskFailed(
            sessionId = "session-123",
            taskId = 3,
            error = "Network timeout"
        )

        assertEquals(3, event.taskId)
        assertEquals("Network timeout", event.error)
    }

    @Test
    fun `SessionCompleted indicates success`() {
        val successEvent = PlanningEvent.SessionCompleted(
            sessionId = "session-123",
            success = true
        )
        assertTrue(successEvent.success)

        val failEvent = PlanningEvent.SessionCompleted(
            sessionId = "session-123",
            success = false
        )
        assertFalse(failEvent.success)
    }

    @Test
    fun `SessionCancelled captures reason`() {
        val event = PlanningEvent.SessionCancelled(
            sessionId = "session-123",
            reason = "User cancelled"
        )

        assertEquals("User cancelled", event.reason)
    }
}
