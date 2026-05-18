package com.chainlesschain.android.remote.task

import com.chainlesschain.android.remote.commands.AICommands
import com.chainlesschain.android.remote.model.ConfirmStatus
import com.chainlesschain.android.remote.model.IntentUnderstanding
import com.chainlesschain.android.remote.model.InterviewQuestion
import com.chainlesschain.android.remote.model.PlanningState
import com.chainlesschain.android.remote.model.TaskItem
import com.chainlesschain.android.remote.model.TaskPlan
import com.chainlesschain.android.remote.model.TaskStatus
import com.google.gson.Gson
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import timber.log.Timber
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Task Plan Manager
 *
 * Manages the lifecycle of task planning, including:
 * - Intent analysis
 * - Interview questions for clarification
 * - Plan generation
 * - Plan execution tracking
 *
 * Aligned with PC desktop-app-vue taskPlanner.ts
 */
@Singleton
class TaskPlanManager @Inject constructor(
    private val aiCommands: AICommands
) {
    private val gson = Gson()

    private val _planningState = MutableStateFlow(PlanningState.IDLE)
    val planningState: StateFlow<PlanningState> = _planningState.asStateFlow()

    private val _currentPlan = MutableStateFlow<TaskPlan?>(null)
    val currentPlan: StateFlow<TaskPlan?> = _currentPlan.asStateFlow()

    private val _currentIntent = MutableStateFlow<IntentUnderstanding?>(null)
    val currentIntent: StateFlow<IntentUnderstanding?> = _currentIntent.asStateFlow()

    private val _interviewQuestions = MutableStateFlow<List<InterviewQuestion>>(emptyList())
    val interviewQuestions: StateFlow<List<InterviewQuestion>> = _interviewQuestions.asStateFlow()

    private val _currentQuestionIndex = MutableStateFlow(0)
    val currentQuestionIndex: StateFlow<Int> = _currentQuestionIndex.asStateFlow()

    private val _executionProgress = MutableStateFlow<Pair<Int, Int>>(0 to 0)
    val executionProgress: StateFlow<Pair<Int, Int>> = _executionProgress.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    /**
     * Start analyzing user intent from a message
     */
    suspend fun analyzeIntent(message: String): Result<IntentUnderstanding> {
        _planningState.value = PlanningState.ANALYZING
        _error.value = null

        return try {
            // Use AI to analyze intent
            val result = aiCommands.chat(
                message = buildIntentAnalysisPrompt(message),
                systemPrompt = INTENT_ANALYSIS_SYSTEM_PROMPT
            )

            if (result.isSuccess) {
                val response = result.getOrNull()
                val intent = parseIntentFromResponse(response?.reply ?: "")
                _currentIntent.value = intent
                Result.success(intent)
            } else {
                val error = result.exceptionOrNull()?.message ?: "Intent analysis failed"
                _error.value = error
                _planningState.value = PlanningState.IDLE
                Result.failure(Exception(error))
            }
        } catch (e: Exception) {
            Timber.e(e, "Intent analysis failed")
            _error.value = e.message
            _planningState.value = PlanningState.IDLE
            Result.failure(e)
        }
    }

    /**
     * Confirm or reject the analyzed intent
     */
    fun confirmIntent(status: ConfirmStatus, modifiedIntent: String? = null) {
        when (status) {
            ConfirmStatus.CONFIRMED -> {
                _planningState.value = PlanningState.INTERVIEWING
                // Generate interview questions based on intent
                generateInterviewQuestions()
            }
            ConfirmStatus.REJECTED -> {
                reset()
            }
            ConfirmStatus.MODIFIED -> {
                _currentIntent.update { it?.copy(intent = modifiedIntent ?: it.intent) }
                _planningState.value = PlanningState.INTERVIEWING
                generateInterviewQuestions()
            }
            ConfirmStatus.PENDING -> {
                // Do nothing
            }
        }
    }

    /**
     * Answer an interview question
     */
    fun answerQuestion(questionId: Int, answer: String) {
        _interviewQuestions.update { questions ->
            questions.map { q ->
                if (q.id == questionId) q.copy(answer = answer) else q
            }
        }

        // Move to next question or proceed to planning
        val questions = _interviewQuestions.value
        val unanswered = questions.filter { it.answer == null && it.required }

        if (unanswered.isEmpty()) {
            _planningState.value = PlanningState.PLANNING
        } else {
            _currentQuestionIndex.value = questions.indexOf(unanswered.firstOrNull() ?: return)
        }
    }

    /**
     * Skip an optional question
     */
    fun skipQuestion(questionId: Int) {
        val questions = _interviewQuestions.value
        val question = questions.find { it.id == questionId }

        if (question != null && !question.required) {
            _interviewQuestions.update { qs ->
                qs.map { if (it.id == questionId) it.copy(answer = "[Skipped]") else it }
            }

            val unanswered = questions.filter { it.answer == null && it.required }
            if (unanswered.isEmpty()) {
                _planningState.value = PlanningState.PLANNING
            } else {
                _currentQuestionIndex.value = questions.indexOf(unanswered.firstOrNull() ?: return)
            }
        }
    }

    /**
     * Generate a task plan based on intent and interview answers
     */
    suspend fun generatePlan(): Result<TaskPlan> {
        _planningState.value = PlanningState.PLANNING
        _error.value = null

        return try {
            val intent = _currentIntent.value ?: return Result.failure(Exception("No intent"))
            val answers = _interviewQuestions.value

            val result = aiCommands.chat(
                message = buildPlanGenerationPrompt(intent, answers),
                systemPrompt = PLAN_GENERATION_SYSTEM_PROMPT
            )

            if (result.isSuccess) {
                val response = result.getOrNull()
                val plan = parsePlanFromResponse(response?.reply ?: "")
                _currentPlan.value = plan
                _planningState.value = PlanningState.CONFIRMING
                Result.success(plan)
            } else {
                val error = result.exceptionOrNull()?.message ?: "Plan generation failed"
                _error.value = error
                Result.failure(Exception(error))
            }
        } catch (e: Exception) {
            Timber.e(e, "Plan generation failed")
            _error.value = e.message
            Result.failure(e)
        }
    }

    /**
     * Confirm and start executing the plan
     */
    fun confirmPlan() {
        _planningState.value = PlanningState.EXECUTING
        _executionProgress.value = 0 to (_currentPlan.value?.tasks?.size ?: 0)
    }

    /**
     * Reject the plan and go back to interview
     */
    fun rejectPlan() {
        _planningState.value = PlanningState.INTERVIEWING
        _currentPlan.value = null
    }

    /**
     * Update task status during execution
     */
    fun updateTaskStatus(taskId: Int, status: TaskStatus, progress: Int = 0, error: String? = null) {
        _currentPlan.update { plan ->
            plan?.copy(
                tasks = plan.tasks.map { task ->
                    if (task.id == taskId) {
                        task.copy(status = status, progress = progress, error = error)
                    } else task
                }
            )
        }

        // Update execution progress
        val plan = _currentPlan.value
        if (plan != null) {
            val completed = plan.tasks.count { it.status == TaskStatus.COMPLETED || it.status == TaskStatus.FAILED }
            _executionProgress.value = completed to plan.tasks.size

            // Check if all tasks are done
            if (completed == plan.tasks.size) {
                _planningState.value = PlanningState.COMPLETED
            }
        }
    }

    /**
     * Cancel execution
     */
    fun cancelExecution() {
        _planningState.value = PlanningState.CANCELLED
        _currentPlan.update { plan ->
            plan?.copy(
                tasks = plan.tasks.map { task ->
                    if (task.status == TaskStatus.IN_PROGRESS || task.status == TaskStatus.PENDING) {
                        task.copy(status = TaskStatus.SKIPPED)
                    } else task
                }
            )
        }
    }

    /**
     * Reset the planning session
     */
    fun reset() {
        _planningState.value = PlanningState.IDLE
        _currentPlan.value = null
        _currentIntent.value = null
        _interviewQuestions.value = emptyList()
        _currentQuestionIndex.value = 0
        _executionProgress.value = 0 to 0
        _error.value = null
    }

    /**
     * Clear error
     */
    fun clearError() {
        _error.value = null
    }

    // Private helper methods

    private fun generateInterviewQuestions() {
        val intent = _currentIntent.value ?: return

        // Generate contextual questions based on intent
        val questions = when {
            intent.intent.contains("create", ignoreCase = true) -> listOf(
                InterviewQuestion(1, "What type of project do you want to create?", listOf("Web App", "Mobile App", "Library", "CLI Tool")),
                InterviewQuestion(2, "What programming language do you prefer?", listOf("TypeScript", "Kotlin", "Python", "Go", "Rust")),
                InterviewQuestion(3, "Do you need any specific frameworks?", required = false),
                InterviewQuestion(4, "What is the target platform?", listOf("Cross-platform", "Windows", "macOS", "Linux", "Android", "iOS"))
            )
            intent.intent.contains("refactor", ignoreCase = true) -> listOf(
                InterviewQuestion(1, "What part of the code needs refactoring?"),
                InterviewQuestion(2, "What is the main goal of this refactoring?", listOf("Improve readability", "Improve performance", "Add new features", "Fix bugs")),
                InterviewQuestion(3, "Are there any constraints or requirements?", required = false)
            )
            intent.intent.contains("test", ignoreCase = true) -> listOf(
                InterviewQuestion(1, "What type of tests do you need?", listOf("Unit tests", "Integration tests", "E2E tests", "All types")),
                InterviewQuestion(2, "What testing framework do you prefer?", required = false),
                InterviewQuestion(3, "What is the target code coverage?", listOf("80%+", "90%+", "100%", "No specific target"))
            )
            else -> listOf(
                InterviewQuestion(1, "Can you provide more details about what you want to achieve?"),
                InterviewQuestion(2, "Are there any specific requirements or constraints?", required = false),
                InterviewQuestion(3, "What is the expected outcome?")
            )
        }

        _interviewQuestions.value = questions
        _currentQuestionIndex.value = 0
    }

    private fun buildIntentAnalysisPrompt(message: String): String {
        return """
            Analyze the following user request and identify the main intent:

            User request: "$message"

            Please respond in JSON format with the following structure:
            {
                "intent": "brief description of intent",
                "confidence": 0.0-1.0,
                "entities": {"key": "value"},
                "suggestedActions": ["action1", "action2"]
            }
        """.trimIndent()
    }

    private fun buildPlanGenerationPrompt(intent: IntentUnderstanding, answers: List<InterviewQuestion>): String {
        val answersText = answers
            .filter { it.answer != null && it.answer != "[Skipped]" }
            .joinToString("\n") { "Q: ${it.question}\nA: ${it.answer}" }

        return """
            Generate a detailed task plan for the following intent:

            Intent: ${intent.intent}
            Confidence: ${intent.confidence}

            Additional information from user:
            $answersText

            Please respond in JSON format with the following structure:
            {
                "title": "Plan title",
                "summary": "Brief summary",
                "tasks": [
                    {
                        "id": 1,
                        "name": "Task name",
                        "description": "Task description",
                        "action": "The action to perform",
                        "output": "Expected output"
                    }
                ],
                "estimatedDuration": "X hours/days",
                "outputs": ["output1", "output2"]
            }
        """.trimIndent()
    }

    private fun parseIntentFromResponse(response: String): IntentUnderstanding {
        return try {
            // Try to extract JSON from response
            val jsonMatch = Regex("""\{[\s\S]*?\}""").find(response)
            if (jsonMatch != null) {
                gson.fromJson(jsonMatch.value, IntentUnderstanding::class.java)
            } else {
                // Fallback: create intent from plain text
                IntentUnderstanding(
                    intent = response.take(200),
                    confidence = 0.7f
                )
            }
        } catch (e: Exception) {
            Timber.w(e, "Failed to parse intent, using fallback")
            IntentUnderstanding(
                intent = response.take(200),
                confidence = 0.5f
            )
        }
    }

    private fun parsePlanFromResponse(response: String): TaskPlan {
        return try {
            val jsonMatch = Regex("""\{[\s\S]*?\}""").find(response)
            if (jsonMatch != null) {
                gson.fromJson(jsonMatch.value, TaskPlan::class.java)
            } else {
                // Fallback: create simple plan
                TaskPlan(
                    title = "Generated Plan",
                    summary = response.take(500),
                    tasks = listOf(
                        TaskItem(
                            id = 1,
                            name = "Execute task",
                            description = response,
                            action = "execute",
                            output = "Complete"
                        )
                    )
                )
            }
        } catch (e: Exception) {
            Timber.w(e, "Failed to parse plan, using fallback")
            TaskPlan(
                title = "Generated Plan",
                summary = response.take(500),
                tasks = listOf(
                    TaskItem(
                        id = 1,
                        name = "Execute task",
                        description = response,
                        action = "execute",
                        output = "Complete"
                    )
                )
            )
        }
    }

    companion object {
        private const val INTENT_ANALYSIS_SYSTEM_PROMPT = """
            You are an AI assistant that analyzes user requests and identifies their intent.
            Focus on understanding what the user wants to accomplish.
            Always respond in valid JSON format.
        """

        private const val PLAN_GENERATION_SYSTEM_PROMPT = """
            You are an AI assistant that generates detailed task plans.
            Break down complex tasks into smaller, actionable steps.
            Each task should be clear and executable.
            Always respond in valid JSON format.
        """
    }
}
