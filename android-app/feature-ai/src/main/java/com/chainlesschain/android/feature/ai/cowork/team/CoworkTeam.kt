package com.chainlesschain.android.feature.ai.cowork.team

import com.chainlesschain.android.feature.ai.cowork.agent.CoworkAgent
import java.util.UUID

/**
 * Cowork Team
 *
 * Represents a team of agents working together on a goal.
 */
data class CoworkTeam(
    /**
     * Unique team identifier
     */
    val id: String = UUID.randomUUID().toString(),

    /**
     * Team name
     */
    val name: String,

    /**
     * Team goal/objective
     */
    var goal: String,

    /**
     * Team lead agent ID
     */
    var leadAgentId: String? = null,

    /**
     * Member agent IDs
     */
    val memberIds: MutableSet<String> = mutableSetOf(),

    /**
     * Current team status
     */
    var status: TeamStatus = TeamStatus.FORMING,

    /**
     * Team creation timestamp
     */
    val createdAt: Long = System.currentTimeMillis(),

    /**
     * Last activity timestamp
     */
    var lastActivityAt: Long = System.currentTimeMillis(),

    /**
     * Progress percentage (0-100)
     */
    var progress: Int = 0,

    /**
     * Team metadata
     */
    val metadata: MutableMap<String, Any> = mutableMapOf()
) {
    /**
     * Number of team members
     */
    val memberCount: Int
        get() = memberIds.size

    /**
     * Check if team has a lead
     */
    val hasLead: Boolean
        get() = leadAgentId != null

    /**
     * Check if team is active
     */
    val isActive: Boolean
        get() = status == TeamStatus.ACTIVE

    /**
     * Check if team is completed
     */
    val isCompleted: Boolean
        get() = status == TeamStatus.COMPLETED

    /**
     * Add a member to the team
     */
    fun addMember(agentId: String): Boolean {
        if (memberIds.contains(agentId)) return false
        memberIds.add(agentId)
        lastActivityAt = System.currentTimeMillis()
        return true
    }

    /**
     * Remove a member from the team
     */
    fun removeMember(agentId: String): Boolean {
        val removed = memberIds.remove(agentId)
        if (removed && leadAgentId == agentId) {
            leadAgentId = memberIds.firstOrNull()
        }
        lastActivityAt = System.currentTimeMillis()
        return removed
    }

    /**
     * Set team lead
     */
    fun setLead(agentId: String): Boolean {
        if (!memberIds.contains(agentId)) {
            memberIds.add(agentId)
        }
        leadAgentId = agentId
        lastActivityAt = System.currentTimeMillis()
        return true
    }

    /**
     * Update team goal
     */
    fun updateGoal(newGoal: String) {
        goal = newGoal
        lastActivityAt = System.currentTimeMillis()
    }

    /**
     * Update progress
     */
    fun updateProgress(newProgress: Int) {
        progress = newProgress.coerceIn(0, 100)
        lastActivityAt = System.currentTimeMillis()
        if (progress >= 100 && status == TeamStatus.ACTIVE) {
            status = TeamStatus.COMPLETED
        }
    }

    /**
     * Start team work
     */
    fun start(): Boolean {
        if (status != TeamStatus.READY && status != TeamStatus.FORMING) return false
        status = TeamStatus.ACTIVE
        lastActivityAt = System.currentTimeMillis()
        return true
    }

    /**
     * Pause team work
     */
    fun pause(): Boolean {
        if (status != TeamStatus.ACTIVE) return false
        status = TeamStatus.PAUSED
        lastActivityAt = System.currentTimeMillis()
        return true
    }

    /**
     * Resume team work
     */
    fun resume(): Boolean {
        if (status != TeamStatus.PAUSED) return false
        status = TeamStatus.ACTIVE
        lastActivityAt = System.currentTimeMillis()
        return true
    }

    /**
     * Complete team work
     */
    fun complete() {
        status = TeamStatus.COMPLETED
        progress = 100
        lastActivityAt = System.currentTimeMillis()
    }

    /**
     * Disband the team
     */
    fun disband() {
        status = TeamStatus.DISBANDED
        lastActivityAt = System.currentTimeMillis()
    }
}
