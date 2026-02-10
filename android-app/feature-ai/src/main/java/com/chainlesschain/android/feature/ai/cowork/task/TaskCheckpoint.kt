package com.chainlesschain.android.feature.ai.cowork.task

import java.util.UUID

/**
 * Task Checkpoint
 *
 * Represents a checkpoint in a long-running task for recovery.
 */
data class TaskCheckpoint(
    /**
     * Unique checkpoint identifier
     */
    val id: String = UUID.randomUUID().toString(),

    /**
     * Task ID this checkpoint belongs to
     */
    val taskId: String,

    /**
     * Checkpoint name/description
     */
    val name: String,

    /**
     * Step number in the task
     */
    val step: Int,

    /**
     * Total steps in the task
     */
    val totalSteps: Int,

    /**
     * Serialized state data (JSON)
     */
    val stateJson: String,

    /**
     * Checkpoint timestamp
     */
    val timestamp: Long = System.currentTimeMillis(),

    /**
     * Whether this checkpoint is recoverable
     */
    val isRecoverable: Boolean = true,

    /**
     * Additional metadata
     */
    val metadata: Map<String, String> = emptyMap()
) {
    /**
     * Progress percentage at this checkpoint
     */
    val progressPercent: Float
        get() = if (totalSteps > 0) (step.toFloat() / totalSteps) * 100 else 0f

    /**
     * Check if this is the final step
     */
    val isFinalStep: Boolean
        get() = step >= totalSteps
}
