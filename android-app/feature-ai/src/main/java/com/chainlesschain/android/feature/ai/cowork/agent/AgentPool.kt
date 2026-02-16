package com.chainlesschain.android.feature.ai.cowork.agent

import timber.log.Timber
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Agent Pool
 *
 * Manages a pool of Cowork agents with lifecycle management,
 * assignment, and monitoring capabilities.
 */
@Singleton
class AgentPool @Inject constructor() {

    companion object {
        private const val DEFAULT_MAX_AGENTS = 10
    }

    // Agent storage
    private val agents = ConcurrentHashMap<String, CoworkAgent>()
    private val mutex = Mutex()

    // Configuration
    private var maxAgents = DEFAULT_MAX_AGENTS

    // State flows for reactive updates
    private val _agentCount = MutableStateFlow(0)
    val agentCount: StateFlow<Int> = _agentCount.asStateFlow()

    private val _activeAgents = MutableStateFlow<List<CoworkAgent>>(emptyList())
    val activeAgents: StateFlow<List<CoworkAgent>> = _activeAgents.asStateFlow()

    private val _availableAgents = MutableStateFlow<List<CoworkAgent>>(emptyList())
    val availableAgents: StateFlow<List<CoworkAgent>> = _availableAgents.asStateFlow()

    // ===== Agent Creation =====

    /**
     * Create and register a new agent
     */
    suspend fun createAgent(
        name: String,
        role: String,
        capabilities: Set<AgentCapability> = AgentCapability.defaultCapabilities,
        systemPrompt: String? = null,
        model: String = "gpt-4"
    ): CoworkAgent? = mutex.withLock {
        if (agents.size >= maxAgents) {
            Timber.w("Agent pool is full ($maxAgents agents)")
            return@withLock null
        }

        val agent = CoworkAgent(
            name = name,
            role = role,
            capabilities = capabilities,
            systemPrompt = systemPrompt,
            model = model
        )

        agents[agent.id] = agent
        updateStateFlows()
        Timber.d("Created agent: ${agent.name} (${agent.id})")
        return@withLock agent
    }

    /**
     * Register an existing agent
     */
    suspend fun registerAgent(agent: CoworkAgent): Boolean = mutex.withLock {
        if (agents.size >= maxAgents) {
            return@withLock false
        }

        agents[agent.id] = agent
        updateStateFlows()
        return@withLock true
    }

    // ===== Agent Retrieval =====

    /**
     * Get agent by ID
     */
    fun getAgent(agentId: String): CoworkAgent? {
        return agents[agentId]
    }

    /**
     * Get all agents
     */
    fun getAllAgents(): List<CoworkAgent> {
        return agents.values.toList()
    }

    /**
     * Get agents by status
     */
    fun getAgentsByStatus(status: AgentStatus): List<CoworkAgent> {
        return agents.values.filter { it.status == status }
    }

    /**
     * Get agents by capability
     */
    fun getAgentsByCapability(capability: AgentCapability): List<CoworkAgent> {
        return agents.values.filter { it.hasCapability(capability) }
    }

    /**
     * Get agents by team
     */
    fun getAgentsByTeam(teamId: String): List<CoworkAgent> {
        return agents.values.filter { it.teamId == teamId }
    }

    /**
     * Find best available agent for a task
     */
    fun findAvailableAgent(
        requiredCapabilities: Set<AgentCapability>? = null,
        preferredRole: String? = null
    ): CoworkAgent? {
        return agents.values
            .filter { it.isAvailable }
            .filter { agent ->
                requiredCapabilities == null ||
                requiredCapabilities.all { agent.hasCapability(it) }
            }
            .let { candidates ->
                if (preferredRole != null) {
                    candidates.find { it.role == preferredRole } ?: candidates.firstOrNull()
                } else {
                    candidates.firstOrNull()
                }
            }
    }

    // ===== Agent Assignment =====

    /**
     * Assign a task to an agent
     */
    suspend fun assignTask(
        agentId: String,
        taskId: String
    ): Boolean = mutex.withLock {
        val agent = agents[agentId] ?: return@withLock false
        val success = agent.assignTask(taskId)
        if (success) {
            updateStateFlows()
            Timber.d("Assigned task $taskId to agent ${agent.name}")
        }
        return@withLock success
    }

    /**
     * Complete agent's current task
     */
    suspend fun completeTask(
        agentId: String,
        success: Boolean = true
    ): Boolean = mutex.withLock {
        val agent = agents[agentId] ?: return@withLock false
        agent.completeTask(success)
        updateStateFlows()
        Timber.d("Agent ${agent.name} completed task (success=$success)")
        return@withLock true
    }

    /**
     * Update agent status
     */
    suspend fun updateAgentStatus(
        agentId: String,
        newStatus: AgentStatus
    ): Boolean = mutex.withLock {
        val agent = agents[agentId] ?: return@withLock false
        val success = agent.updateStatus(newStatus)
        if (success) {
            updateStateFlows()
        }
        return@withLock success
    }

    // ===== Agent Removal =====

    /**
     * Remove an agent from the pool
     */
    suspend fun removeAgent(agentId: String): CoworkAgent? = mutex.withLock {
        val removed = agents.remove(agentId)
        if (removed != null) {
            updateStateFlows()
            Timber.d("Removed agent: ${removed.name}")
        }
        return@withLock removed
    }

    /**
     * Clear all agents
     */
    suspend fun clear() = mutex.withLock {
        agents.clear()
        updateStateFlows()
        Timber.d("Cleared all agents")
    }

    // ===== Team Management =====

    /**
     * Assign agent to a team
     */
    suspend fun assignToTeam(agentId: String, teamId: String): Boolean = mutex.withLock {
        val agent = agents[agentId] ?: return@withLock false
        agent.teamId = teamId
        return@withLock true
    }

    /**
     * Remove agent from team
     */
    suspend fun removeFromTeam(agentId: String): Boolean = mutex.withLock {
        val agent = agents[agentId] ?: return@withLock false
        agent.teamId = null
        return@withLock true
    }

    // ===== Pool Management =====

    /**
     * Set maximum number of agents
     */
    fun setMaxAgents(max: Int) {
        maxAgents = max
    }

    /**
     * Get pool statistics
     */
    fun getStats(): AgentPoolStats {
        val allAgents = agents.values.toList()
        return AgentPoolStats(
            totalAgents = allAgents.size,
            maxAgents = maxAgents,
            idleAgents = allAgents.count { it.status == AgentStatus.IDLE },
            workingAgents = allAgents.count { it.status == AgentStatus.WORKING },
            waitingAgents = allAgents.count { it.status == AgentStatus.WAITING },
            completedAgents = allAgents.count { it.status == AgentStatus.COMPLETED },
            failedAgents = allAgents.count { it.status == AgentStatus.FAILED },
            pausedAgents = allAgents.count { it.status == AgentStatus.PAUSED }
        )
    }

    /**
     * Reset all agents to idle state
     */
    suspend fun resetAll() = mutex.withLock {
        agents.values.forEach { it.reset() }
        updateStateFlows()
        Timber.d("Reset all agents to idle")
    }

    // ===== Private Helpers =====

    private fun updateStateFlows() {
        val allAgents = agents.values.toList()
        _agentCount.value = allAgents.size
        _activeAgents.value = allAgents.filter { it.isActive }
        _availableAgents.value = allAgents.filter { it.isAvailable }
    }
}

/**
 * Agent pool statistics
 */
data class AgentPoolStats(
    val totalAgents: Int,
    val maxAgents: Int,
    val idleAgents: Int,
    val workingAgents: Int,
    val waitingAgents: Int,
    val completedAgents: Int,
    val failedAgents: Int,
    val pausedAgents: Int
) {
    val utilizationRate: Float
        get() = if (totalAgents > 0) workingAgents.toFloat() / totalAgents else 0f

    val availabilityRate: Float
        get() = if (totalAgents > 0) idleAgents.toFloat() / totalAgents else 0f
}
