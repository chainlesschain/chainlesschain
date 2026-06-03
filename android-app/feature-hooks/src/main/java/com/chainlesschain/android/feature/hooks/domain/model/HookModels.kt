package com.chainlesschain.android.feature.hooks.domain.model

import kotlinx.serialization.Serializable

/**
 * Hook event types (21 types)
 * Based on iOS Hooks system
 */
@Serializable
enum class HookEvent {
    // Session events
    SESSION_START,
    SESSION_END,
    PRE_COMPACT,
    POST_COMPACT,

    // Tool events
    PRE_TOOL_USE,
    POST_TOOL_USE,
    TOOL_ERROR,

    // File events
    FILE_CREATED,
    FILE_MODIFIED,
    FILE_DELETED,
    FILE_READ,

    // AI events
    PRE_AI_REQUEST,
    POST_AI_REQUEST,
    AI_ERROR,

    // Agent events
    AGENT_STARTED,
    AGENT_COMPLETED,
    AGENT_ERROR,

    // Permission events
    PERMISSION_CHECK,
    PERMISSION_DENIED,

    // Custom
    CUSTOM,
    NOTIFICATION
}

/**
 * Hook type
 */
@Serializable
enum class HookType {
    SYNC,       // Synchronous execution
    ASYNC,      // Asynchronous execution
    COMMAND,    // Shell command
    SCRIPT      // JavaScript/Python/Bash script
}

/**
 * Hook priority levels
 */
@Serializable
enum class HookPriority(val value: Int) {
    SYSTEM(0),      // Highest priority, system hooks
    HIGH(100),      // High priority
    NORMAL(500),    // Default priority
    LOW(900),       // Low priority
    MONITOR(1000)   // Lowest, monitoring only
}

/**
 * Hook configuration
 */
@Serializable
data class HookConfig(
    val id: String,
    val name: String,
    val description: String? = null,
    val event: HookEvent,
    val type: HookType,
    val priority: HookPriority = HookPriority.NORMAL,
    val handler: HookHandler,
    val isEnabled: Boolean = true,
    val conditions: List<HookCondition> = emptyList(),
    val timeout: Long = 30_000L, // 30 seconds default
    val retryCount: Int = 0,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
)

/**
 * Hook handler configuration
 */
@Serializable
sealed class HookHandler {
    @Serializable
    data class Function(val name: String) : HookHandler()

    @Serializable
    data class Command(val command: String, val workDir: String? = null) : HookHandler()

    @Serializable
    data class Script(val path: String, val interpreter: String = "bash") : HookHandler()

    @Serializable
    data class Webhook(val url: String, val method: String = "POST") : HookHandler()
}

/**
 * Hook condition for conditional execution
 */
@Serializable
data class HookCondition(
    val field: String,
    val operator: ConditionOperator,
    val value: String
)

/**
 * Condition operators
 */
@Serializable
enum class ConditionOperator {
    EQUALS,
    NOT_EQUALS,
    CONTAINS,
    NOT_CONTAINS,
    STARTS_WITH,
    ENDS_WITH,
    MATCHES,    // Regex
    GREATER_THAN,
    LESS_THAN
}

/**
 * Hook execution context
 */
@Serializable
data class HookContext(
    val event: HookEvent,
    val timestamp: Long = System.currentTimeMillis(),
    val data: Map<String, String> = emptyMap(),
    val metadata: Map<String, String> = emptyMap()
)

/**
 * Hook response
 */
@Serializable
data class HookResponse(
    val hookId: String,
    val success: Boolean,
    val result: String? = null,
    val error: String? = null,
    val shouldContinue: Boolean = true, // For blocking hooks
    val modifiedData: Map<String, String>? = null,
    val executionTimeMs: Long = 0
)

/**
 * Hook execution log
 */
@Serializable
data class HookLog(
    val id: String,
    val hookId: String,
    val hookName: String,
    val event: HookEvent,
    val context: HookContext,
    val response: HookResponse,
    val timestamp: Long = System.currentTimeMillis()
)

/**
 * Hook statistics
 */
@Serializable
data class HookStats(
    val hookId: String,
    val totalExecutions: Int = 0,
    val successCount: Int = 0,
    val failureCount: Int = 0,
    val avgExecutionTimeMs: Double = 0.0,
    val lastExecuted: Long? = null
)
