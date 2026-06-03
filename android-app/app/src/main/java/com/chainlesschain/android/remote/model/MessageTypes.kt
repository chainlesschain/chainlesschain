package com.chainlesschain.android.remote.model

import androidx.compose.runtime.Immutable
import com.chainlesschain.android.remote.commands.TokenUsage
import kotlinx.serialization.Serializable
import java.util.UUID

/**
 * Context mode for AI chat
 * Aligned with PC desktop-app-vue ChatPanel.vue
 */
enum class ContextMode {
    /** Project context - AI has access to entire project */
    PROJECT,
    /** File context - AI focuses on specific file(s) */
    FILE,
    /** Global context - General AI conversation */
    GLOBAL
}

/**
 * File reference in chat messages
 */
@Serializable
data class FileReference(
    val id: String = UUID.randomUUID().toString(),
    val path: String,
    val name: String,
    val extension: String? = null,
    val size: Long? = null,
    val isDirectory: Boolean = false
) {
    companion object {
        fun fromPath(path: String): FileReference {
            val name = path.substringAfterLast("/").substringAfterLast("\\")
            val extension = if (name.contains(".")) name.substringAfterLast(".") else null
            return FileReference(
                path = path,
                name = name,
                extension = extension
            )
        }
    }
}

/**
 * Task plan data structure
 */
@Immutable
@Serializable
data class TaskPlan(
    val id: String = UUID.randomUUID().toString(),
    val title: String,
    val summary: String,
    val tasks: List<TaskItem>,
    val estimatedDuration: String? = null,
    val outputs: List<String> = emptyList(),
    val createdAt: Long = System.currentTimeMillis()
)

/**
 * Individual task item in a plan
 */
@Immutable
@Serializable
data class TaskItem(
    val id: Int,
    val name: String,
    val description: String,
    val action: String,
    val output: String,
    val status: TaskStatus = TaskStatus.PENDING,
    val progress: Int = 0,
    val error: String? = null
)

/**
 * Task execution status
 */
enum class TaskStatus {
    PENDING,
    IN_PROGRESS,
    COMPLETED,
    FAILED,
    SKIPPED
}

/**
 * Planning session state
 */
enum class PlanningState {
    IDLE,
    ANALYZING,
    INTERVIEWING,
    PLANNING,
    CONFIRMING,
    EXECUTING,
    COMPLETED,
    CANCELLED
}

/**
 * Interview question for task clarification
 */
@Immutable
@Serializable
data class InterviewQuestion(
    val id: Int,
    val question: String,
    val options: List<String>? = null,
    val required: Boolean = true,
    val answer: String? = null
)

/**
 * Intent understanding data
 */
@Immutable
@Serializable
data class IntentUnderstanding(
    val intent: String,
    val confidence: Float,
    val entities: Map<String, String> = emptyMap(),
    val suggestedActions: List<String> = emptyList()
)

/**
 * Intent confirmation status
 */
enum class ConfirmStatus {
    PENDING,
    CONFIRMED,
    REJECTED,
    MODIFIED
}

/**
 * Thinking stage for AI processing visualization
 */
enum class ThinkingStage {
    ANALYZING,
    PLANNING,
    GENERATING,
    REVIEWING,
    EXECUTING
}

/**
 * Progress information for long-running operations
 */
@Serializable
data class ProgressInfo(
    val step: Int,
    val total: Int,
    val message: String,
    val percentage: Int = if (total > 0) (step * 100 / total) else 0
)

/**
 * Sealed class representing different message types
 * Aligned with PC desktop-app-vue messageTypes.ts
 */
sealed class ChatMessageType {
    /** Standard user message */
    data object User : ChatMessageType()

    /** AI assistant response */
    data object Assistant : ChatMessageType()

    /** System message */
    data object System : ChatMessageType()

    /** Intent recognition result */
    data class IntentRecognition(
        val intent: String,
        val confidence: Float = 1.0f
    ) : ChatMessageType()

    /** Intent confirmation request/response */
    data class IntentConfirmation(
        val understanding: IntentUnderstanding,
        val status: ConfirmStatus = ConfirmStatus.PENDING
    ) : ChatMessageType()

    /** Interview questions for task clarification */
    data class Interview(
        val questions: List<InterviewQuestion>,
        val currentIndex: Int = 0
    ) : ChatMessageType()

    /** Task plan display */
    data class TaskPlanType(
        val plan: TaskPlan,
        val status: PlanningState = PlanningState.IDLE
    ) : ChatMessageType()

    /** Progress update */
    data class Progress(
        val info: ProgressInfo
    ) : ChatMessageType()

    /** Error message */
    data class Error(
        val message: String,
        val code: String? = null,
        val recoverable: Boolean = true
    ) : ChatMessageType()

    /** File reference message */
    data class FileReferenceType(
        val files: List<FileReference>
    ) : ChatMessageType()

    /** Code block message */
    data class CodeBlock(
        val language: String,
        val code: String,
        val filename: String? = null
    ) : ChatMessageType()

    /** Execution result message */
    data class ExecutionResult(
        val success: Boolean,
        val output: String,
        val duration: Long? = null
    ) : ChatMessageType()
}

/**
 * Enhanced chat message with full type support
 */
@Immutable
data class EnhancedChatMessage(
    val id: String = UUID.randomUUID().toString(),
    val role: MessageRole,
    val content: String,
    val timestamp: Long = System.currentTimeMillis(),
    val model: String? = null,
    val tokenUsage: TokenUsage? = null,
    val messageType: ChatMessageType = when (role) {
        MessageRole.USER -> ChatMessageType.User
        MessageRole.ASSISTANT -> ChatMessageType.Assistant
        MessageRole.SYSTEM -> ChatMessageType.System
    },
    val contextMode: ContextMode = ContextMode.PROJECT,
    val referencedFiles: List<FileReference> = emptyList(),
    val taskPlan: TaskPlan? = null,
    val thinkingStage: ThinkingStage? = null,
    val isStreaming: Boolean = false,
    val hasError: Boolean = false,
    val error: String? = null,
    val parentMessageId: String? = null,
    val metadata: Map<String, String> = emptyMap(),
    // Streaming progress
    val streamProgress: Float? = null,
    val streamTokenCount: Int? = null
)

/**
 * Message role enum
 */
enum class MessageRole {
    USER,
    ASSISTANT,
    SYSTEM
}

/**
 * Creation step for AI project creation progress
 */
@Immutable
@Serializable
data class CreationStep(
    val id: Int,
    val name: String,
    val description: String,
    val status: StepStatus = StepStatus.PENDING
)

/**
 * Step status for creation progress
 */
enum class StepStatus {
    PENDING,
    IN_PROGRESS,
    COMPLETED,
    FAILED
}

/**
 * AI creation progress state
 */
@Immutable
data class CreationProgress(
    val steps: List<CreationStep>,
    val currentStep: Int = 0,
    val isComplete: Boolean = false,
    val error: String? = null
)
