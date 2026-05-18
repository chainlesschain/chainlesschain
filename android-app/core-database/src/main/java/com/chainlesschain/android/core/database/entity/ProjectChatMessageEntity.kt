package com.chainlesschain.android.core.database.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import java.util.UUID

/**
 * Project-specific AI chat message entity
 *
 * Links AI conversations to specific projects for context-aware assistance
 */
@Entity(
    tableName = "project_chat_messages",
    foreignKeys = [
        ForeignKey(
            entity = ProjectEntity::class,
            parentColumns = ["id"],
            childColumns = ["projectId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [
        Index(value = ["projectId"]),
        Index(value = ["createdAt"]),
        Index(value = ["projectId", "createdAt"])
    ]
)
data class ProjectChatMessageEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),

    /** Associated project ID */
    val projectId: String,

    /** Message role: user, assistant, system */
    val role: String,

    /** Message content (supports Markdown) */
    val content: String,

    /** Message type: NORMAL, SYSTEM, TASK_PLAN, TASK_ANALYSIS, INTENT_CONFIRM, CREATION, CODE_BLOCK, FILE_REFERENCE, EXECUTION_RESULT */
    val messageType: String = ProjectMessageType.NORMAL,

    /** Context mode when message was created: PROJECT, FILE, GLOBAL */
    val contextMode: String = ProjectContextMode.PROJECT,

    /** Referenced file IDs (JSON array of file IDs mentioned in message) */
    val referencedFileIds: String? = null,

    /** Referenced file paths (JSON array of @mentioned file paths) */
    val referencedFilePaths: String? = null,

    /** Task plan JSON data if messageType is TASK_PLAN */
    val taskPlanData: String? = null,

    /** Model used for this response (for assistant messages) */
    val model: String? = null,

    /** Token count for this message */
    val tokenCount: Int? = null,

    /** Whether this message is a quick action result */
    val isQuickAction: Boolean = false,

    /** Quick action type if applicable: generate_readme, explain_code, suggest_files, etc. */
    val quickActionType: String? = null,

    /** Creation timestamp */
    val createdAt: Long = System.currentTimeMillis(),

    /** Whether the message is still streaming */
    val isStreaming: Boolean = false,

    /** Error message if the AI response failed */
    val error: String? = null,

    /** Parent message ID for threaded replies */
    val parentMessageId: String? = null,

    /** Metadata JSON for additional properties */
    val metadata: String? = null
)

/**
 * Project chat message role constants
 */
object ProjectChatRole {
    const val USER = "user"
    const val ASSISTANT = "assistant"
    const val SYSTEM = "system"
}

/**
 * Quick action type constants
 */
object ProjectQuickAction {
    const val GENERATE_README = "generate_readme"
    const val EXPLAIN_CODE = "explain_code"
    const val SUGGEST_FILES = "suggest_files"
    const val REVIEW_CODE = "review_code"
    const val ADD_COMMENTS = "add_comments"
    const val GENERATE_TESTS = "generate_tests"
    const val REFACTOR = "refactor"
    const val FIX_BUGS = "fix_bugs"
}

/**
 * Project message type constants
 */
object ProjectMessageType {
    const val NORMAL = "NORMAL"
    const val SYSTEM = "SYSTEM"
    const val TASK_PLAN = "TASK_PLAN"
    const val TASK_ANALYSIS = "TASK_ANALYSIS"
    const val INTENT_CONFIRM = "INTENT_CONFIRM"
    const val CREATION = "CREATION"
    const val CODE_BLOCK = "CODE_BLOCK"
    const val FILE_REFERENCE = "FILE_REFERENCE"
    const val EXECUTION_RESULT = "EXECUTION_RESULT"
}

/**
 * Context mode constants for AI chat
 */
object ProjectContextMode {
    const val PROJECT = "PROJECT"
    const val FILE = "FILE"
    const val GLOBAL = "GLOBAL"
}
