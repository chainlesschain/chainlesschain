package com.chainlesschain.android.feature.ai.cowork.task

/**
 * Task Status
 *
 * Represents the lifecycle state of a long-running task.
 */
enum class TaskStatus(
    val displayName: String,
    val isTerminal: Boolean = false
) {
    /**
     * Task is queued/pending
     */
    PENDING("Pending"),

    /**
     * Task is currently running
     */
    RUNNING("Running"),

    /**
     * Task is paused
     */
    PAUSED("Paused"),

    /**
     * Task completed successfully
     */
    COMPLETED("Completed", isTerminal = true),

    /**
     * Task failed
     */
    FAILED("Failed", isTerminal = true),

    /**
     * Task was cancelled
     */
    CANCELLED("Cancelled", isTerminal = true),

    /**
     * Task timed out
     */
    TIMEOUT("Timeout", isTerminal = true);

    companion object {
        /**
         * Get status from string
         */
        fun fromString(value: String): TaskStatus? {
            return entries.find { it.name.equals(value, ignoreCase = true) }
        }

        /**
         * All active (non-terminal) statuses
         */
        val activeStatuses: Set<TaskStatus>
            get() = entries.filter { !it.isTerminal }.toSet()
    }
}
