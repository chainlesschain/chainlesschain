package com.chainlesschain.android.feature.ai.cowork

/**
 * Cowork Error
 *
 * Sealed class representing errors in the Cowork system.
 */
sealed class CoworkError(
    val code: String,
    override val message: String,
    override val cause: Throwable? = null
) : Exception(message, cause) {

    /**
     * Agent not found
     */
    class AgentNotFound(
        agentId: String
    ) : CoworkError("AGENT_NOT_FOUND", "Agent not found: $agentId")

    /**
     * Agent not available
     */
    class AgentNotAvailable(
        agentId: String,
        reason: String = "busy"
    ) : CoworkError("AGENT_NOT_AVAILABLE", "Agent $agentId is not available: $reason")

    /**
     * Team not found
     */
    class TeamNotFound(
        teamId: String
    ) : CoworkError("TEAM_NOT_FOUND", "Team not found: $teamId")

    /**
     * Task not found
     */
    class TaskNotFound(
        taskId: String
    ) : CoworkError("TASK_NOT_FOUND", "Task not found: $taskId")

    /**
     * Invalid state transition
     */
    class InvalidStateTransition(
        from: String,
        to: String
    ) : CoworkError("INVALID_STATE_TRANSITION", "Cannot transition from $from to $to")

    /**
     * Permission denied
     */
    class PermissionDenied(
        operation: String,
        resource: String
    ) : CoworkError("PERMISSION_DENIED", "Permission denied: $operation on $resource")

    /**
     * Checkpoint not found
     */
    class CheckpointNotFound(
        taskId: String,
        checkpointId: String? = null
    ) : CoworkError("CHECKPOINT_NOT_FOUND",
        "Checkpoint not found for task $taskId" + (checkpointId?.let { ": $it" } ?: ""))

    /**
     * Task timeout
     */
    class TaskTimeout(
        taskId: String,
        timeoutMs: Long
    ) : CoworkError("TASK_TIMEOUT", "Task $taskId timed out after ${timeoutMs}ms")

    /**
     * Pool exhausted
     */
    class PoolExhausted(
        poolType: String,
        maxSize: Int
    ) : CoworkError("POOL_EXHAUSTED", "$poolType pool exhausted (max: $maxSize)")

    /**
     * Configuration error
     */
    class ConfigurationError(
        details: String
    ) : CoworkError("CONFIGURATION_ERROR", "Configuration error: $details")

    /**
     * Execution error
     */
    class ExecutionError(
        details: String,
        cause: Throwable? = null
    ) : CoworkError("EXECUTION_ERROR", "Execution error: $details", cause)

    /**
     * Sandbox violation
     */
    class SandboxViolation(
        agentId: String,
        operation: String,
        path: String
    ) : CoworkError("SANDBOX_VIOLATION", "Agent $agentId attempted $operation on $path")

    companion object {
        /**
         * Create error from exception
         */
        fun fromException(e: Throwable): CoworkError {
            return when (e) {
                is CoworkError -> e
                is SecurityException -> PermissionDenied("unknown", e.message ?: "unknown")
                is IllegalStateException -> InvalidStateTransition("unknown", e.message ?: "unknown")
                else -> ExecutionError(e.message ?: "Unknown error", e)
            }
        }
    }
}
