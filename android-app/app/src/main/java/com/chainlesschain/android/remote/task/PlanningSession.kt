package com.chainlesschain.android.remote.task

import com.chainlesschain.android.remote.model.ConfirmStatus
import com.chainlesschain.android.remote.model.ContextMode
import com.chainlesschain.android.remote.model.FileReference
import com.chainlesschain.android.remote.model.IntentUnderstanding
import com.chainlesschain.android.remote.model.InterviewQuestion
import com.chainlesschain.android.remote.model.PlanningState
import com.chainlesschain.android.remote.model.TaskPlan
import java.util.UUID

/**
 * Represents a single planning session
 *
 * Tracks the entire lifecycle of a task planning interaction,
 * from initial request through plan execution.
 */
data class PlanningSession(
    val id: String = UUID.randomUUID().toString(),
    val originalRequest: String,
    val contextMode: ContextMode = ContextMode.PROJECT,
    val referencedFiles: List<FileReference> = emptyList(),
    val state: PlanningState = PlanningState.IDLE,
    val intent: IntentUnderstanding? = null,
    val intentConfirmStatus: ConfirmStatus = ConfirmStatus.PENDING,
    val interviewQuestions: List<InterviewQuestion> = emptyList(),
    val currentQuestionIndex: Int = 0,
    val plan: TaskPlan? = null,
    val planConfirmed: Boolean = false,
    val executingTaskId: Int? = null,
    val completedTaskIds: Set<Int> = emptySet(),
    val failedTaskIds: Set<Int> = emptySet(),
    val error: String? = null,
    val startedAt: Long = System.currentTimeMillis(),
    val completedAt: Long? = null,
    val metadata: Map<String, String> = emptyMap()
) {
    /**
     * Check if session is active
     */
    val isActive: Boolean
        get() = state !in listOf(
            PlanningState.IDLE,
            PlanningState.COMPLETED,
            PlanningState.CANCELLED
        )

    /**
     * Check if all interview questions are answered
     */
    val allQuestionsAnswered: Boolean
        get() = interviewQuestions.all { it.answer != null || !it.required }

    /**
     * Get the current interview question
     */
    val currentQuestion: InterviewQuestion?
        get() = interviewQuestions.getOrNull(currentQuestionIndex)

    /**
     * Get unanswered required questions
     */
    val unansweredRequiredQuestions: List<InterviewQuestion>
        get() = interviewQuestions.filter { it.required && it.answer == null }

    /**
     * Get execution progress as a fraction (0.0 to 1.0)
     */
    val executionProgress: Float
        get() {
            val total = plan?.tasks?.size ?: return 0f
            if (total == 0) return 0f
            return (completedTaskIds.size + failedTaskIds.size).toFloat() / total
        }

    /**
     * Check if plan execution is complete
     */
    val isExecutionComplete: Boolean
        get() {
            val total = plan?.tasks?.size ?: return false
            return (completedTaskIds.size + failedTaskIds.size) == total
        }

    /**
     * Get the next pending task ID
     */
    val nextPendingTaskId: Int?
        get() = plan?.tasks
            ?.filter { it.id !in completedTaskIds && it.id !in failedTaskIds }
            ?.firstOrNull()
            ?.id

    /**
     * Get duration in milliseconds
     */
    val duration: Long
        get() = (completedAt ?: System.currentTimeMillis()) - startedAt

    /**
     * Transition to a new state
     */
    fun transitionTo(newState: PlanningState): PlanningSession {
        return copy(
            state = newState,
            completedAt = if (newState in listOf(PlanningState.COMPLETED, PlanningState.CANCELLED)) {
                System.currentTimeMillis()
            } else null
        )
    }

    /**
     * Update intent analysis result
     */
    fun withIntent(intent: IntentUnderstanding): PlanningSession {
        return copy(
            intent = intent,
            state = PlanningState.CONFIRMING
        )
    }

    /**
     * Confirm or reject intent
     */
    fun confirmIntent(status: ConfirmStatus): PlanningSession {
        return when (status) {
            ConfirmStatus.CONFIRMED -> copy(
                intentConfirmStatus = status,
                state = PlanningState.INTERVIEWING
            )
            ConfirmStatus.REJECTED -> copy(
                intentConfirmStatus = status,
                state = PlanningState.CANCELLED
            )
            ConfirmStatus.MODIFIED, ConfirmStatus.PENDING -> copy(
                intentConfirmStatus = status
            )
        }
    }

    /**
     * Answer an interview question
     */
    fun answerQuestion(questionId: Int, answer: String): PlanningSession {
        val updatedQuestions = interviewQuestions.map { q ->
            if (q.id == questionId) q.copy(answer = answer) else q
        }

        val allAnswered = updatedQuestions.all { it.answer != null || !it.required }
        val nextIndex = if (allAnswered) {
            currentQuestionIndex
        } else {
            updatedQuestions.indexOfFirst { it.answer == null && it.required }
                .takeIf { it >= 0 } ?: currentQuestionIndex
        }

        return copy(
            interviewQuestions = updatedQuestions,
            currentQuestionIndex = nextIndex,
            state = if (allAnswered) PlanningState.PLANNING else state
        )
    }

    /**
     * Set the generated plan
     */
    fun withPlan(plan: TaskPlan): PlanningSession {
        return copy(
            plan = plan,
            state = PlanningState.CONFIRMING
        )
    }

    /**
     * Confirm and start executing the plan
     */
    fun startExecution(): PlanningSession {
        val firstTaskId = plan?.tasks?.firstOrNull()?.id
        return copy(
            planConfirmed = true,
            state = PlanningState.EXECUTING,
            executingTaskId = firstTaskId
        )
    }

    /**
     * Mark a task as completed
     */
    fun completeTask(taskId: Int): PlanningSession {
        val newCompleted = completedTaskIds + taskId
        val nextTaskId = plan?.tasks
            ?.filter { it.id !in newCompleted && it.id !in failedTaskIds }
            ?.firstOrNull()
            ?.id

        val isComplete = (newCompleted.size + failedTaskIds.size) == (plan?.tasks?.size ?: 0)

        return copy(
            completedTaskIds = newCompleted,
            executingTaskId = nextTaskId,
            state = if (isComplete) PlanningState.COMPLETED else state,
            completedAt = if (isComplete) System.currentTimeMillis() else null
        )
    }

    /**
     * Mark a task as failed
     */
    fun failTask(taskId: Int, error: String): PlanningSession {
        val newFailed = failedTaskIds + taskId
        val nextTaskId = plan?.tasks
            ?.filter { it.id !in completedTaskIds && it.id !in newFailed }
            ?.firstOrNull()
            ?.id

        return copy(
            failedTaskIds = newFailed,
            executingTaskId = nextTaskId,
            error = error
        )
    }

    /**
     * Cancel the session
     */
    fun cancel(): PlanningSession {
        return copy(
            state = PlanningState.CANCELLED,
            completedAt = System.currentTimeMillis()
        )
    }

    /**
     * Add metadata
     */
    fun withMetadata(key: String, value: String): PlanningSession {
        return copy(metadata = metadata + (key to value))
    }

    companion object {
        /**
         * Create a new planning session
         */
        fun create(
            request: String,
            contextMode: ContextMode = ContextMode.PROJECT,
            referencedFiles: List<FileReference> = emptyList()
        ): PlanningSession {
            return PlanningSession(
                originalRequest = request,
                contextMode = contextMode,
                referencedFiles = referencedFiles,
                state = PlanningState.ANALYZING
            )
        }
    }
}

/**
 * Session event for tracking planning history
 */
sealed class PlanningEvent {
    abstract val sessionId: String
    abstract val timestamp: Long

    data class SessionStarted(
        override val sessionId: String,
        val request: String,
        override val timestamp: Long = System.currentTimeMillis()
    ) : PlanningEvent()

    data class IntentAnalyzed(
        override val sessionId: String,
        val intent: IntentUnderstanding,
        override val timestamp: Long = System.currentTimeMillis()
    ) : PlanningEvent()

    data class IntentConfirmed(
        override val sessionId: String,
        val status: ConfirmStatus,
        override val timestamp: Long = System.currentTimeMillis()
    ) : PlanningEvent()

    data class QuestionAnswered(
        override val sessionId: String,
        val questionId: Int,
        val answer: String,
        override val timestamp: Long = System.currentTimeMillis()
    ) : PlanningEvent()

    data class PlanGenerated(
        override val sessionId: String,
        val plan: TaskPlan,
        override val timestamp: Long = System.currentTimeMillis()
    ) : PlanningEvent()

    data class ExecutionStarted(
        override val sessionId: String,
        override val timestamp: Long = System.currentTimeMillis()
    ) : PlanningEvent()

    data class TaskCompleted(
        override val sessionId: String,
        val taskId: Int,
        override val timestamp: Long = System.currentTimeMillis()
    ) : PlanningEvent()

    data class TaskFailed(
        override val sessionId: String,
        val taskId: Int,
        val error: String,
        override val timestamp: Long = System.currentTimeMillis()
    ) : PlanningEvent()

    data class SessionCompleted(
        override val sessionId: String,
        val success: Boolean,
        override val timestamp: Long = System.currentTimeMillis()
    ) : PlanningEvent()

    data class SessionCancelled(
        override val sessionId: String,
        val reason: String?,
        override val timestamp: Long = System.currentTimeMillis()
    ) : PlanningEvent()
}
