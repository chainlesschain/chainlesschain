package com.chainlesschain.android.feature.ai.cowork.agent

/**
 * Agent Status
 *
 * Represents the lifecycle state of a Cowork agent.
 */
enum class AgentStatus(
    val displayName: String,
    val canTransitionTo: Set<String>
) {
    /**
     * Agent is idle and ready to accept tasks
     */
    IDLE("Idle", setOf("WORKING", "PAUSED")),

    /**
     * Agent is actively working on a task
     */
    WORKING("Working", setOf("IDLE", "WAITING", "COMPLETED", "FAILED", "PAUSED")),

    /**
     * Agent is waiting for external input or another agent
     */
    WAITING("Waiting", setOf("WORKING", "IDLE", "FAILED", "PAUSED")),

    /**
     * Agent has completed its task successfully
     */
    COMPLETED("Completed", setOf("IDLE")),

    /**
     * Agent has failed its task
     */
    FAILED("Failed", setOf("IDLE")),

    /**
     * Agent is paused (can resume)
     */
    PAUSED("Paused", setOf("IDLE", "WORKING", "WAITING"));

    /**
     * Check if transition to target status is valid
     */
    fun canTransitionTo(target: AgentStatus): Boolean {
        return canTransitionTo.contains(target.name)
    }

    companion object {
        /**
         * Get all active statuses (agent is doing something)
         */
        val activeStatuses: Set<AgentStatus>
            get() = setOf(WORKING, WAITING)

        /**
         * Get all terminal statuses (task finished)
         */
        val terminalStatuses: Set<AgentStatus>
            get() = setOf(COMPLETED, FAILED)

        /**
         * Get status from string
         */
        fun fromString(value: String): AgentStatus? {
            return entries.find { it.name.equals(value, ignoreCase = true) }
        }
    }
}
