package com.chainlesschain.android.feature.ai.cowork.task

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Long Running Task Manager
 *
 * Manages long-running tasks with checkpoint/recovery support.
 */
@Singleton
class LongRunningTaskManager @Inject constructor() {

    companion object {
        private const val TAG = "LongRunningTaskManager"
        private const val TIMEOUT_CHECK_INTERVAL_MS = 5000L
    }

    // Task storage
    private val tasks = ConcurrentHashMap<String, LongRunningTask>()
    private val checkpoints = ConcurrentHashMap<String, MutableList<TaskCheckpoint>>()
    private val mutex = Mutex()

    // Coroutine scope for background operations
    private val scope = CoroutineScope(Dispatchers.Default)
    private var timeoutMonitorJob: Job? = null

    // State flows
    private val _activeTasks = MutableStateFlow<List<LongRunningTask>>(emptyList())
    val activeTasks: StateFlow<List<LongRunningTask>> = _activeTasks.asStateFlow()

    private val _completedTasks = MutableStateFlow<List<LongRunningTask>>(emptyList())
    val completedTasks: StateFlow<List<LongRunningTask>> = _completedTasks.asStateFlow()

    init {
        startTimeoutMonitor()
    }

    // ===== Task Creation =====

    /**
     * Create a new task
     */
    suspend fun createTask(
        name: String,
        description: String,
        totalSteps: Int = 1,
        priority: Int = 0,
        timeoutMs: Long = 0
    ): LongRunningTask = mutex.withLock {
        val task = LongRunningTask(
            name = name,
            description = description,
            totalSteps = totalSteps,
            priority = priority,
            timeoutMs = timeoutMs
        )

        tasks[task.id] = task
        checkpoints[task.id] = mutableListOf()
        updateStateFlows()
        Log.d(TAG, "Created task: ${task.name} (${task.id})")
        return@withLock task
    }

    // ===== Task Operations =====

    /**
     * Start a task
     */
    suspend fun startTask(taskId: String, agentId: String? = null): Boolean = mutex.withLock {
        val task = tasks[taskId] ?: return@withLock false
        if (task.status != TaskStatus.PENDING) return@withLock false

        task.agentId = agentId
        task.start()
        updateStateFlows()
        Log.d(TAG, "Started task: ${task.name}")
        return@withLock true
    }

    /**
     * Pause a task
     */
    suspend fun pauseTask(taskId: String): Boolean = mutex.withLock {
        val task = tasks[taskId] ?: return@withLock false
        if (task.status != TaskStatus.RUNNING) return@withLock false

        task.pause()
        updateStateFlows()
        Log.d(TAG, "Paused task: ${task.name}")
        return@withLock true
    }

    /**
     * Resume a task from latest checkpoint
     */
    suspend fun resumeTask(taskId: String): TaskCheckpoint? = mutex.withLock {
        val task = tasks[taskId] ?: return@withLock null
        if (!task.canResume) return@withLock null

        task.resume()

        val taskCheckpoints = checkpoints[taskId] ?: return@withLock null
        val latestCheckpoint = taskCheckpoints.maxByOrNull { it.timestamp }

        updateStateFlows()
        Log.d(TAG, "Resumed task: ${task.name} from checkpoint ${latestCheckpoint?.name}")
        return@withLock latestCheckpoint
    }

    /**
     * Complete a task
     */
    suspend fun completeTask(taskId: String, result: String? = null): Boolean = mutex.withLock {
        val task = tasks[taskId] ?: return@withLock false

        task.complete(result)
        updateStateFlows()
        Log.d(TAG, "Completed task: ${task.name}")
        return@withLock true
    }

    /**
     * Fail a task
     */
    suspend fun failTask(taskId: String, error: String): Boolean = mutex.withLock {
        val task = tasks[taskId] ?: return@withLock false

        task.fail(error)
        updateStateFlows()
        Log.e(TAG, "Failed task: ${task.name} - $error")
        return@withLock true
    }

    /**
     * Cancel a task
     */
    suspend fun cancelTask(taskId: String): Boolean = mutex.withLock {
        val task = tasks[taskId] ?: return@withLock false

        task.cancel()
        updateStateFlows()
        Log.d(TAG, "Cancelled task: ${task.name}")
        return@withLock true
    }

    /**
     * Update task progress
     */
    suspend fun updateProgress(
        taskId: String,
        step: Int,
        progressPercent: Int? = null
    ): Boolean = mutex.withLock {
        val task = tasks[taskId] ?: return@withLock false

        task.updateProgress(step, progressPercent)
        updateStateFlows()
        return@withLock true
    }

    // ===== Checkpoint Operations =====

    /**
     * Create a checkpoint
     */
    suspend fun createCheckpoint(
        taskId: String,
        name: String,
        stateJson: String,
        metadata: Map<String, String> = emptyMap()
    ): TaskCheckpoint? = mutex.withLock {
        val task = tasks[taskId] ?: return@withLock null
        if (task.status != TaskStatus.RUNNING && task.status != TaskStatus.PAUSED) {
            return@withLock null
        }

        val checkpoint = TaskCheckpoint(
            taskId = taskId,
            name = name,
            step = task.currentStep,
            totalSteps = task.totalSteps,
            stateJson = stateJson,
            metadata = metadata
        )

        checkpoints.getOrPut(taskId) { mutableListOf() }.add(checkpoint)
        task.latestCheckpointId = checkpoint.id

        Log.d(TAG, "Created checkpoint: $name for task ${task.name}")
        return@withLock checkpoint
    }

    /**
     * Get checkpoints for a task
     */
    fun getCheckpoints(taskId: String): List<TaskCheckpoint> {
        return checkpoints[taskId]?.toList() ?: emptyList()
    }

    /**
     * Get latest checkpoint for a task
     */
    fun getLatestCheckpoint(taskId: String): TaskCheckpoint? {
        return checkpoints[taskId]?.maxByOrNull { it.timestamp }
    }

    /**
     * Get checkpoint by ID
     */
    fun getCheckpoint(taskId: String, checkpointId: String): TaskCheckpoint? {
        return checkpoints[taskId]?.find { it.id == checkpointId }
    }

    // ===== Task Retrieval =====

    /**
     * Get task by ID
     */
    fun getTask(taskId: String): LongRunningTask? {
        return tasks[taskId]
    }

    /**
     * Get all tasks
     */
    fun getAllTasks(): List<LongRunningTask> {
        return tasks.values.toList()
    }

    /**
     * Get tasks by status
     */
    fun getTasksByStatus(status: TaskStatus): List<LongRunningTask> {
        return tasks.values.filter { it.status == status }
    }

    /**
     * Get tasks by agent
     */
    fun getTasksByAgent(agentId: String): List<LongRunningTask> {
        return tasks.values.filter { it.agentId == agentId }
    }

    // ===== Task Cleanup =====

    /**
     * Remove a completed task
     */
    suspend fun removeTask(taskId: String): Boolean = mutex.withLock {
        val removed = tasks.remove(taskId)
        checkpoints.remove(taskId)
        if (removed != null) {
            updateStateFlows()
            Log.d(TAG, "Removed task: ${removed.name}")
        }
        return@withLock removed != null
    }

    /**
     * Clear completed tasks
     */
    suspend fun clearCompleted() = mutex.withLock {
        val completedIds = tasks.values
            .filter { it.isCompleted }
            .map { it.id }

        completedIds.forEach { id ->
            tasks.remove(id)
            checkpoints.remove(id)
        }

        updateStateFlows()
        Log.d(TAG, "Cleared ${completedIds.size} completed tasks")
    }

    // ===== Private Helpers =====

    private fun startTimeoutMonitor() {
        timeoutMonitorJob = scope.launch {
            while (isActive) {
                delay(TIMEOUT_CHECK_INTERVAL_MS)
                checkTimeouts()
            }
        }
    }

    private suspend fun checkTimeouts() = mutex.withLock {
        var hasChanges = false

        tasks.values
            .filter { it.isRunning && it.isTimedOut }
            .forEach { task ->
                task.timeout()
                hasChanges = true
                Log.w(TAG, "Task timed out: ${task.name}")
            }

        if (hasChanges) {
            updateStateFlows()
        }
    }

    private fun updateStateFlows() {
        val allTasks = tasks.values.toList()
        _activeTasks.value = allTasks.filter { !it.isCompleted }
        _completedTasks.value = allTasks.filter { it.isCompleted }
    }

    /**
     * Stop the manager
     */
    fun stop() {
        timeoutMonitorJob?.cancel()
        timeoutMonitorJob = null
    }
}
