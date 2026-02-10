package com.chainlesschain.android.feature.ai.cowork.agent

import java.util.UUID

/**
 * Cowork Agent
 *
 * Represents a single AI agent that can collaborate with others.
 */
data class CoworkAgent(
    /**
     * Unique agent identifier
     */
    val id: String = UUID.randomUUID().toString(),

    /**
     * Agent name
     */
    val name: String,

    /**
     * Agent role/specialization
     */
    val role: String,

    /**
     * Current status
     */
    var status: AgentStatus = AgentStatus.IDLE,

    /**
     * Agent capabilities
     */
    val capabilities: Set<AgentCapability> = AgentCapability.defaultCapabilities,

    /**
     * Current task ID (if working)
     */
    var currentTaskId: String? = null,

    /**
     * Team ID this agent belongs to
     */
    var teamId: String? = null,

    /**
     * System prompt/instructions for this agent
     */
    val systemPrompt: String? = null,

    /**
     * Model to use for this agent
     */
    val model: String = "gpt-4",

    /**
     * Maximum concurrent tasks
     */
    val maxConcurrentTasks: Int = 1,

    /**
     * Creation timestamp
     */
    val createdAt: Long = System.currentTimeMillis(),

    /**
     * Last activity timestamp
     */
    var lastActivityAt: Long = System.currentTimeMillis(),

    /**
     * Metadata for custom properties
     */
    val metadata: MutableMap<String, Any> = mutableMapOf()
) {
    /**
     * Check if agent is available for new tasks
     */
    val isAvailable: Boolean
        get() = status == AgentStatus.IDLE

    /**
     * Check if agent is currently active
     */
    val isActive: Boolean
        get() = status in AgentStatus.activeStatuses

    /**
     * Check if agent has a specific capability
     */
    fun hasCapability(capability: AgentCapability): Boolean {
        return capabilities.contains(capability)
    }

    /**
     * Update status with validation
     */
    fun updateStatus(newStatus: AgentStatus): Boolean {
        return if (status.canTransitionTo(newStatus)) {
            status = newStatus
            lastActivityAt = System.currentTimeMillis()
            true
        } else {
            false
        }
    }

    /**
     * Assign a task to this agent
     */
    fun assignTask(taskId: String): Boolean {
        if (!isAvailable) return false
        currentTaskId = taskId
        status = AgentStatus.WORKING
        lastActivityAt = System.currentTimeMillis()
        return true
    }

    /**
     * Complete current task
     */
    fun completeTask(success: Boolean = true) {
        currentTaskId = null
        status = if (success) AgentStatus.COMPLETED else AgentStatus.FAILED
        lastActivityAt = System.currentTimeMillis()
    }

    /**
     * Reset agent to idle state
     */
    fun reset() {
        currentTaskId = null
        status = AgentStatus.IDLE
        lastActivityAt = System.currentTimeMillis()
    }
}
