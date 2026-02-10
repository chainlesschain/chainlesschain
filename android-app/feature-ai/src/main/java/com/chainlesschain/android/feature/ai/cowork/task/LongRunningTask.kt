package com.chainlesschain.android.feature.ai.cowork.task

import java.util.UUID

/**
 * Long Running Task
 *
 * Represents a task that may run for an extended period
 * and supports checkpoint/recovery.
 */
data class LongRunningTask(
    /**
     * Unique task identifier
     */
    val id: String = UUID.randomUUID().toString(),

    /**
     * Task name
     */
    val name: String,

    /**
     * Task description
     */
    val description: String,

    /**
     * Assigned agent ID
     */
    var agentId: String? = null,

    /**
     * Team ID if this is a team task
     */
    var teamId: String? = null,

    /**
     * Current status
     */
    var status: TaskStatus = TaskStatus.PENDING,

    /**
     * Current progress (0-100)
     */
    var progress: Int = 0,

    /**
     * Total steps in the task
     */
    val totalSteps: Int = 1,

    /**
     * Current step
     */
    var currentStep: Int = 0,

    /**
     * Task creation timestamp
     */
    val createdAt: Long = System.currentTimeMillis(),

    /**
     * Task start timestamp
     */
    var startedAt: Long? = null,

    /**
     * Task completion timestamp
     */
    var completedAt: Long? = null,

    /**
     * Last activity timestamp
     */
    var lastActivityAt: Long = System.currentTimeMillis(),

    /**
     * Latest checkpoint ID
     */
    var latestCheckpointId: String? = null,

    /**
     * Error message if failed
     */
    var errorMessage: String? = null,

    /**
     * Result data (JSON)
     */
    var resultJson: String? = null,

    /**
     * Task priority (higher = more important)
     */
    val priority: Int = 0,

    /**
     * Task timeout in milliseconds (0 = no timeout)
     */
    val timeoutMs: Long = 0,

    /**
     * Task metadata
     */
    val metadata: MutableMap<String, Any> = mutableMapOf()
) {
    /**
     * Check if task is running
     */
    val isRunning: Boolean
        get() = status == TaskStatus.RUNNING

    /**
     * Check if task is completed (success or failure)
     */
    val isCompleted: Boolean
        get() = status.isTerminal

    /**
     * Check if task can be resumed
     */
    val canResume: Boolean
        get() = status == TaskStatus.PAUSED && latestCheckpointId != null

    /**
     * Duration in milliseconds (or elapsed time if still running)
     */
    val durationMs: Long
        get() {
            val start = startedAt ?: return 0
            val end = completedAt ?: System.currentTimeMillis()
            return end - start
        }

    /**
     * Check if task has timed out
     */
    val isTimedOut: Boolean
        get() {
            if (timeoutMs <= 0) return false
            val start = startedAt ?: return false
            return System.currentTimeMillis() - start > timeoutMs
        }

    /**
     * Start the task
     */
    fun start() {
        status = TaskStatus.RUNNING
        startedAt = System.currentTimeMillis()
        lastActivityAt = System.currentTimeMillis()
    }

    /**
     * Pause the task
     */
    fun pause() {
        if (status == TaskStatus.RUNNING) {
            status = TaskStatus.PAUSED
            lastActivityAt = System.currentTimeMillis()
        }
    }

    /**
     * Resume the task
     */
    fun resume() {
        if (status == TaskStatus.PAUSED) {
            status = TaskStatus.RUNNING
            lastActivityAt = System.currentTimeMillis()
        }
    }

    /**
     * Complete the task successfully
     */
    fun complete(result: String? = null) {
        status = TaskStatus.COMPLETED
        progress = 100
        currentStep = totalSteps
        completedAt = System.currentTimeMillis()
        lastActivityAt = System.currentTimeMillis()
        resultJson = result
    }

    /**
     * Fail the task
     */
    fun fail(error: String) {
        status = TaskStatus.FAILED
        completedAt = System.currentTimeMillis()
        lastActivityAt = System.currentTimeMillis()
        errorMessage = error
    }

    /**
     * Cancel the task
     */
    fun cancel() {
        status = TaskStatus.CANCELLED
        completedAt = System.currentTimeMillis()
        lastActivityAt = System.currentTimeMillis()
    }

    /**
     * Mark as timed out
     */
    fun timeout() {
        status = TaskStatus.TIMEOUT
        completedAt = System.currentTimeMillis()
        lastActivityAt = System.currentTimeMillis()
        errorMessage = "Task timed out after ${timeoutMs}ms"
    }

    /**
     * Update progress
     */
    fun updateProgress(step: Int, progressPercent: Int? = null) {
        currentStep = step.coerceIn(0, totalSteps)
        progress = progressPercent ?: ((currentStep.toFloat() / totalSteps) * 100).toInt()
        lastActivityAt = System.currentTimeMillis()
    }
}
