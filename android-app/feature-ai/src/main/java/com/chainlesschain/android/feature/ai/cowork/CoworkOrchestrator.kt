package com.chainlesschain.android.feature.ai.cowork

import timber.log.Timber
import com.chainlesschain.android.feature.ai.cowork.agent.AgentCapability
import com.chainlesschain.android.feature.ai.cowork.agent.AgentPool
import com.chainlesschain.android.feature.ai.cowork.agent.AgentStatus
import com.chainlesschain.android.feature.ai.cowork.agent.CoworkAgent
import com.chainlesschain.android.feature.ai.cowork.sandbox.FileSandbox
import com.chainlesschain.android.feature.ai.cowork.sandbox.SandboxPermission
import com.chainlesschain.android.feature.ai.cowork.task.LongRunningTask
import com.chainlesschain.android.feature.ai.cowork.task.LongRunningTaskManager
import com.chainlesschain.android.feature.ai.cowork.team.CoworkTeam
import com.chainlesschain.android.feature.ai.cowork.team.TeamStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Cowork Orchestrator
 *
 * Central coordinator for the multi-agent collaboration system.
 * Manages agents, teams, tasks, and sandboxed file access.
 *
 * Features:
 * - Agent pool management
 * - Team formation and goal setting
 * - Task assignment and tracking
 * - Sandboxed file access
 * - Checkpoint/recovery for long-running tasks
 *
 * Aligns with iOS implementation patterns.
 */
@Singleton
class CoworkOrchestrator @Inject constructor(
    private val agentPool: AgentPool,
    private val taskManager: LongRunningTaskManager,
    private val fileSandbox: FileSandbox
) {

    // Team storage
    private val teams = ConcurrentHashMap<String, CoworkTeam>()
    private val mutex = Mutex()

    // State flows
    private val _activeTeams = MutableStateFlow<List<CoworkTeam>>(emptyList())
    val activeTeams: StateFlow<List<CoworkTeam>> = _activeTeams.asStateFlow()

    // ===== Agent Operations =====

    /**
     * Create a new agent
     */
    suspend fun createAgent(
        name: String,
        role: String,
        capabilities: Set<AgentCapability> = AgentCapability.defaultCapabilities,
        systemPrompt: String? = null,
        model: String = "gpt-4"
    ): CoworkAgent? {
        return agentPool.createAgent(name, role, capabilities, systemPrompt, model)
    }

    /**
     * Get an available agent with required capabilities
     */
    fun findAgent(
        requiredCapabilities: Set<AgentCapability>? = null,
        preferredRole: String? = null
    ): CoworkAgent? {
        return agentPool.findAvailableAgent(requiredCapabilities, preferredRole)
    }

    /**
     * Get agent by ID
     */
    fun getAgent(agentId: String): CoworkAgent? {
        return agentPool.getAgent(agentId)
    }

    /**
     * List all agents
     */
    fun listAgents(): List<CoworkAgent> {
        return agentPool.getAllAgents()
    }

    // ===== Team Operations =====

    /**
     * Create a new team
     */
    suspend fun createTeam(
        name: String,
        goal: String,
        leadAgentId: String? = null
    ): CoworkTeam = mutex.withLock {
        val team = CoworkTeam(
            name = name,
            goal = goal,
            leadAgentId = leadAgentId
        )

        if (leadAgentId != null) {
            team.memberIds.add(leadAgentId)
            agentPool.assignToTeam(leadAgentId, team.id)
        }

        teams[team.id] = team
        team.status = TeamStatus.READY
        updateTeamFlows()

        Timber.d("Created team: ${team.name} (${team.id})")
        return@withLock team
    }

    /**
     * Add agent to team
     */
    suspend fun addAgentToTeam(teamId: String, agentId: String): Boolean = mutex.withLock {
        val team = teams[teamId] ?: return@withLock false
        val agent = agentPool.getAgent(agentId) ?: return@withLock false

        if (team.addMember(agentId)) {
            agentPool.assignToTeam(agentId, teamId)
            Timber.d("Added agent ${agent.name} to team ${team.name}")
            return@withLock true
        }
        return@withLock false
    }

    /**
     * Remove agent from team
     */
    suspend fun removeAgentFromTeam(teamId: String, agentId: String): Boolean = mutex.withLock {
        val team = teams[teamId] ?: return@withLock false

        if (team.removeMember(agentId)) {
            agentPool.removeFromTeam(agentId)
            Timber.d("Removed agent $agentId from team ${team.name}")
            return@withLock true
        }
        return@withLock false
    }

    /**
     * Start team work
     */
    suspend fun startTeam(teamId: String): Boolean = mutex.withLock {
        val team = teams[teamId] ?: return@withLock false

        if (team.start()) {
            updateTeamFlows()
            Timber.d("Started team: ${team.name}")
            return@withLock true
        }
        return@withLock false
    }

    /**
     * Update team goal
     */
    suspend fun updateTeamGoal(teamId: String, newGoal: String): Boolean = mutex.withLock {
        val team = teams[teamId] ?: return@withLock false
        team.updateGoal(newGoal)
        return@withLock true
    }

    /**
     * Get team by ID
     */
    fun getTeam(teamId: String): CoworkTeam? {
        return teams[teamId]
    }

    /**
     * Disband a team
     */
    suspend fun disbandTeam(teamId: String): Boolean = mutex.withLock {
        val team = teams[teamId] ?: return@withLock false

        // Remove all agents from team
        team.memberIds.forEach { agentId ->
            agentPool.removeFromTeam(agentId)
        }

        team.disband()
        teams.remove(teamId)
        updateTeamFlows()

        Timber.d("Disbanded team: ${team.name}")
        return@withLock true
    }

    // ===== Task Operations =====

    /**
     * Create and assign a task to an agent
     */
    suspend fun assignTask(
        agentId: String,
        taskName: String,
        taskDescription: String,
        totalSteps: Int = 1,
        priority: Int = 0,
        timeoutMs: Long = 0
    ): LongRunningTask? {
        val agent = agentPool.getAgent(agentId) ?: return null
        if (!agent.isAvailable) return null

        val task = taskManager.createTask(
            name = taskName,
            description = taskDescription,
            totalSteps = totalSteps,
            priority = priority,
            timeoutMs = timeoutMs
        )

        if (taskManager.startTask(task.id, agentId)) {
            agentPool.assignTask(agentId, task.id)
            Timber.d("Assigned task ${task.name} to agent ${agent.name}")
            return task
        }

        return null
    }

    /**
     * Complete an agent's task
     */
    suspend fun completeAgentTask(
        agentId: String,
        success: Boolean = true,
        result: String? = null
    ): Boolean {
        val agent = agentPool.getAgent(agentId) ?: return false
        val taskId = agent.currentTaskId ?: return false

        if (success) {
            taskManager.completeTask(taskId, result)
        } else {
            taskManager.failTask(taskId, result ?: "Task failed")
        }

        agentPool.completeTask(agentId, success)
        return true
    }

    /**
     * Get task by ID
     */
    fun getTask(taskId: String): LongRunningTask? {
        return taskManager.getTask(taskId)
    }

    // ===== Sandbox Operations =====

    /**
     * Grant file access to an agent
     */
    fun grantFileAccess(
        agentId: String,
        basePath: String,
        permission: SandboxPermission = SandboxPermission.READ
    ) {
        fileSandbox.grantPermission(agentId, basePath, permission)
    }

    /**
     * Revoke file access from an agent
     */
    fun revokeFileAccess(agentId: String) {
        fileSandbox.revokeAllPermissions(agentId)
    }

    /**
     * Check if agent can access a file
     */
    fun canAccess(
        agentId: String,
        filePath: String,
        permission: SandboxPermission
    ): Boolean {
        return fileSandbox.hasPermission(agentId, filePath, permission)
    }

    /**
     * Read file as agent
     */
    suspend fun readFile(agentId: String, filePath: String): Result<String> {
        return fileSandbox.readFile(agentId, filePath)
    }

    /**
     * Write file as agent
     */
    suspend fun writeFile(
        agentId: String,
        filePath: String,
        content: String
    ): Result<Unit> {
        return fileSandbox.writeFile(agentId, filePath, content)
    }

    // ===== Checkpoint Operations =====

    /**
     * Create checkpoint for current task
     */
    suspend fun createCheckpoint(
        taskId: String,
        name: String,
        stateJson: String
    ) = taskManager.createCheckpoint(taskId, name, stateJson)

    /**
     * Resume task from checkpoint
     */
    suspend fun resumeFromCheckpoint(taskId: String) = taskManager.resumeTask(taskId)

    // ===== Statistics =====

    /**
     * Get orchestrator statistics
     */
    fun getStats(): OrchestratorStats {
        val agentStats = agentPool.getStats()
        val allTasks = taskManager.getAllTasks()
        val allTeams = teams.values.toList()

        return OrchestratorStats(
            totalAgents = agentStats.totalAgents,
            workingAgents = agentStats.workingAgents,
            idleAgents = agentStats.idleAgents,
            totalTeams = allTeams.size,
            activeTeams = allTeams.count { it.isActive },
            totalTasks = allTasks.size,
            runningTasks = allTasks.count { it.isRunning },
            completedTasks = allTasks.count { it.isCompleted }
        )
    }

    // ===== Cleanup =====

    /**
     * Shutdown the orchestrator
     */
    suspend fun shutdown() {
        Timber.d("Shutting down orchestrator")

        // Stop all teams
        teams.keys.toList().forEach { disbandTeam(it) }

        // Reset all agents
        agentPool.resetAll()

        // Stop task manager
        taskManager.stop()
    }

    // ===== Private Helpers =====

    private fun updateTeamFlows() {
        _activeTeams.value = teams.values.filter { it.isActive }.toList()
    }
}

/**
 * Orchestrator statistics
 */
data class OrchestratorStats(
    val totalAgents: Int,
    val workingAgents: Int,
    val idleAgents: Int,
    val totalTeams: Int,
    val activeTeams: Int,
    val totalTasks: Int,
    val runningTasks: Int,
    val completedTasks: Int
)
