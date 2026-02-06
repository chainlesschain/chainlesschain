package com.chainlesschain.android.feature.project.repository

import android.util.Log
import com.chainlesschain.android.core.database.dao.TaskDao
import com.chainlesschain.android.core.database.entity.TaskEntity
import com.chainlesschain.android.core.database.entity.TaskStatusConst
import com.chainlesschain.android.feature.project.model.Task
import com.chainlesschain.android.feature.project.model.TaskMapper
import com.chainlesschain.android.feature.project.model.TaskPriority
import com.chainlesschain.android.feature.project.model.TaskStats
import com.chainlesschain.android.feature.project.model.TaskStatus
import com.chainlesschain.android.feature.project.model.TodoStep
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Calendar
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 任务事件
 */
sealed class TaskEvent {
    data class Created(val task: Task) : TaskEvent()
    data class Updated(val task: Task) : TaskEvent()
    data class Deleted(val taskId: String) : TaskEvent()
    data class StatusChanged(val taskId: String, val newStatus: TaskStatus) : TaskEvent()
}

/**
 * 创建任务请求
 */
data class CreateTaskRequest(
    val userId: String,
    val title: String,
    val description: String? = null,
    val projectId: String? = null,
    val priority: TaskPriority = TaskPriority.MEDIUM,
    val dueDate: Long? = null,
    val labels: List<String> = emptyList(),
    val steps: List<String> = emptyList(),  // 步骤内容列表
    val estimateHours: Float? = null
)

/**
 * 更新任务请求
 */
data class UpdateTaskRequest(
    val title: String? = null,
    val description: String? = null,
    val priority: TaskPriority? = null,
    val dueDate: Long? = null,
    val labels: List<String>? = null,
    val estimateHours: Float? = null,
    val actualHours: Float? = null
)

/**
 * 任务仓库
 *
 * 提供任务管理的业务逻辑层：
 * - 任务 CRUD 操作
 * - 任务状态管理
 * - 子步骤管理
 * - 任务统计
 */
@Singleton
class TaskRepository @Inject constructor(
    private val taskDao: TaskDao
) {
    companion object {
        private const val TAG = "TaskRepository"
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // 任务事件流
    private val _taskEvents = MutableSharedFlow<TaskEvent>(replay = 0)
    val taskEvents: SharedFlow<TaskEvent> = _taskEvents.asSharedFlow()

    // ===== 查询操作 =====

    /**
     * 获取用户的所有任务
     */
    fun getTasksByUser(userId: String): Flow<List<Task>> {
        return taskDao.getTasksByUser(userId).map { entities ->
            TaskMapper.toTaskList(entities)
        }
    }

    /**
     * 按状态获取任务
     */
    fun getTasksByStatus(userId: String, status: TaskStatus): Flow<List<Task>> {
        return taskDao.getTasksByStatus(userId, status.value).map { entities ->
            TaskMapper.toTaskList(entities)
        }
    }

    /**
     * 按优先级获取任务
     */
    fun getTasksByPriority(userId: String, priority: TaskPriority): Flow<List<Task>> {
        return taskDao.getTasksByPriority(userId, priority.value).map { entities ->
            TaskMapper.toTaskList(entities)
        }
    }

    /**
     * 获取项目关联的任务
     */
    fun getTasksByProject(projectId: String): Flow<List<Task>> {
        return taskDao.getTasksByProject(projectId).map { entities ->
            TaskMapper.toTaskList(entities)
        }
    }

    /**
     * 获取逾期任务
     */
    fun getOverdueTasks(userId: String): Flow<List<Task>> {
        return taskDao.getOverdueTasks(userId).map { entities ->
            TaskMapper.toTaskList(entities)
        }
    }

    /**
     * 获取今日到期的任务
     */
    fun getTodayTasks(userId: String): Flow<List<Task>> {
        val (todayStart, todayEnd) = getTodayRange()
        return taskDao.getTodayTasks(userId, todayStart, todayEnd).map { entities ->
            TaskMapper.toTaskList(entities)
        }
    }

    /**
     * 获取本周到期的任务
     */
    fun getWeekTasks(userId: String): Flow<List<Task>> {
        val (weekStart, weekEnd) = getWeekRange()
        return taskDao.getWeekTasks(userId, weekStart, weekEnd).map { entities ->
            TaskMapper.toTaskList(entities)
        }
    }

    /**
     * 搜索任务
     */
    fun searchTasks(userId: String, query: String): Flow<List<Task>> {
        return taskDao.searchTasks(userId, query).map { entities ->
            TaskMapper.toTaskList(entities)
        }
    }

    /**
     * 按标签获取任务
     */
    fun getTasksByLabel(userId: String, label: String): Flow<List<Task>> {
        return taskDao.getTasksByLabel(userId, label).map { entities ->
            TaskMapper.toTaskList(entities)
        }
    }

    /**
     * 获取单个任务
     */
    suspend fun getTask(taskId: String): Task? {
        return withContext(Dispatchers.IO) {
            taskDao.getTaskById(taskId)?.let { TaskMapper.toTask(it) }
        }
    }

    /**
     * 观察单个任务
     */
    fun observeTask(taskId: String): Flow<Task?> {
        return taskDao.observeTask(taskId).map { entity ->
            entity?.let { TaskMapper.toTask(it) }
        }
    }

    // ===== 创建操作 =====

    /**
     * 创建任务
     */
    suspend fun createTask(request: CreateTaskRequest): Result<Task> {
        return withContext(Dispatchers.IO) {
            try {
                val now = System.currentTimeMillis()

                // 创建子步骤
                val steps = request.steps.mapIndexed { index, content ->
                    TodoStep(
                        id = UUID.randomUUID().toString(),
                        content = content,
                        isCompleted = false
                    )
                }

                val task = Task(
                    id = UUID.randomUUID().toString(),
                    userId = request.userId,
                    projectId = request.projectId,
                    title = request.title,
                    description = request.description,
                    status = TaskStatus.PENDING,
                    priority = request.priority,
                    labels = request.labels,
                    dueDate = request.dueDate,
                    estimateHours = request.estimateHours,
                    steps = steps,
                    createdAt = now,
                    updatedAt = now
                )

                val entity = TaskMapper.toEntity(task)
                taskDao.insertTask(entity)

                Log.i(TAG, "Created task: ${task.id} - ${task.title}")

                scope.launch {
                    _taskEvents.emit(TaskEvent.Created(task))
                }

                Result.success(task)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to create task", e)
                Result.failure(e)
            }
        }
    }

    // ===== 更新操作 =====

    /**
     * 更新任务
     */
    suspend fun updateTask(taskId: String, request: UpdateTaskRequest): Result<Task> {
        return withContext(Dispatchers.IO) {
            try {
                val existing = taskDao.getTaskById(taskId)
                    ?: return@withContext Result.failure(IllegalArgumentException("Task not found"))

                val existingTask = TaskMapper.toTask(existing)
                val updated = existingTask.copy(
                    title = request.title ?: existingTask.title,
                    description = request.description ?: existingTask.description,
                    priority = request.priority ?: existingTask.priority,
                    dueDate = request.dueDate ?: existingTask.dueDate,
                    labels = request.labels ?: existingTask.labels,
                    estimateHours = request.estimateHours ?: existingTask.estimateHours,
                    actualHours = request.actualHours ?: existingTask.actualHours,
                    updatedAt = System.currentTimeMillis()
                )

                taskDao.updateTask(TaskMapper.toEntity(updated))

                Log.i(TAG, "Updated task: $taskId")

                scope.launch {
                    _taskEvents.emit(TaskEvent.Updated(updated))
                }

                Result.success(updated)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to update task: $taskId", e)
                Result.failure(e)
            }
        }
    }

    /**
     * 更新完整任务对象
     */
    suspend fun updateTask(task: Task): Result<Task> {
        return withContext(Dispatchers.IO) {
            try {
                val updated = task.copy(updatedAt = System.currentTimeMillis())
                taskDao.updateTask(TaskMapper.toEntity(updated))

                Log.i(TAG, "Updated task: ${task.id}")

                scope.launch {
                    _taskEvents.emit(TaskEvent.Updated(updated))
                }

                Result.success(updated)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to update task: ${task.id}", e)
                Result.failure(e)
            }
        }
    }

    /**
     * 更新任务状态
     */
    suspend fun updateTaskStatus(taskId: String, status: TaskStatus): Result<Unit> {
        return withContext(Dispatchers.IO) {
            try {
                val now = System.currentTimeMillis()
                val completedAt = if (status == TaskStatus.COMPLETED) now else null

                taskDao.updateTaskStatus(
                    taskId = taskId,
                    status = status.value,
                    updatedAt = now,
                    completedAt = completedAt
                )

                Log.i(TAG, "Updated task status: $taskId -> ${status.value}")

                scope.launch {
                    _taskEvents.emit(TaskEvent.StatusChanged(taskId, status))
                }

                Result.success(Unit)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to update task status: $taskId", e)
                Result.failure(e)
            }
        }
    }

    /**
     * 切换子步骤完成状态
     */
    suspend fun toggleStepCompletion(taskId: String, stepId: String): Result<Task> {
        return withContext(Dispatchers.IO) {
            try {
                val entity = taskDao.getTaskById(taskId)
                    ?: return@withContext Result.failure(IllegalArgumentException("Task not found"))

                val task = TaskMapper.toTask(entity)
                val now = System.currentTimeMillis()

                val updatedSteps = task.steps.map { step ->
                    if (step.id == stepId) {
                        step.copy(
                            isCompleted = !step.isCompleted,
                            completedAt = if (!step.isCompleted) now else null
                        )
                    } else {
                        step
                    }
                }

                val updatedTask = task.copy(
                    steps = updatedSteps,
                    updatedAt = now
                )

                taskDao.updateTask(TaskMapper.toEntity(updatedTask))

                Log.i(TAG, "Toggled step completion: $taskId/$stepId")

                scope.launch {
                    _taskEvents.emit(TaskEvent.Updated(updatedTask))
                }

                Result.success(updatedTask)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to toggle step: $taskId/$stepId", e)
                Result.failure(e)
            }
        }
    }

    /**
     * 添加子步骤
     */
    suspend fun addStep(taskId: String, content: String): Result<Task> {
        return withContext(Dispatchers.IO) {
            try {
                val entity = taskDao.getTaskById(taskId)
                    ?: return@withContext Result.failure(IllegalArgumentException("Task not found"))

                val task = TaskMapper.toTask(entity)
                val newStep = TodoStep(
                    id = UUID.randomUUID().toString(),
                    content = content,
                    isCompleted = false
                )

                val updatedTask = task.copy(
                    steps = task.steps + newStep,
                    updatedAt = System.currentTimeMillis()
                )

                taskDao.updateTask(TaskMapper.toEntity(updatedTask))

                Log.i(TAG, "Added step to task: $taskId")

                scope.launch {
                    _taskEvents.emit(TaskEvent.Updated(updatedTask))
                }

                Result.success(updatedTask)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to add step: $taskId", e)
                Result.failure(e)
            }
        }
    }

    /**
     * 删除子步骤
     */
    suspend fun removeStep(taskId: String, stepId: String): Result<Task> {
        return withContext(Dispatchers.IO) {
            try {
                val entity = taskDao.getTaskById(taskId)
                    ?: return@withContext Result.failure(IllegalArgumentException("Task not found"))

                val task = TaskMapper.toTask(entity)
                val updatedTask = task.copy(
                    steps = task.steps.filter { it.id != stepId },
                    updatedAt = System.currentTimeMillis()
                )

                taskDao.updateTask(TaskMapper.toEntity(updatedTask))

                Log.i(TAG, "Removed step from task: $taskId/$stepId")

                scope.launch {
                    _taskEvents.emit(TaskEvent.Updated(updatedTask))
                }

                Result.success(updatedTask)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to remove step: $taskId/$stepId", e)
                Result.failure(e)
            }
        }
    }

    // ===== 删除操作 =====

    /**
     * 删除任务
     */
    suspend fun deleteTask(taskId: String): Result<Unit> {
        return withContext(Dispatchers.IO) {
            try {
                taskDao.deleteTask(taskId)

                Log.i(TAG, "Deleted task: $taskId")

                scope.launch {
                    _taskEvents.emit(TaskEvent.Deleted(taskId))
                }

                Result.success(Unit)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to delete task: $taskId", e)
                Result.failure(e)
            }
        }
    }

    // ===== 统计操作 =====

    /**
     * 获取任务统计信息
     */
    suspend fun getTaskStats(userId: String): TaskStats {
        return withContext(Dispatchers.IO) {
            try {
                val total = taskDao.getTaskCount(userId)
                val pending = taskDao.getTaskCountByStatus(userId, TaskStatusConst.PENDING)
                val inProgress = taskDao.getTaskCountByStatus(userId, TaskStatusConst.IN_PROGRESS)
                val completed = taskDao.getTaskCountByStatus(userId, TaskStatusConst.COMPLETED)
                val cancelled = taskDao.getTaskCountByStatus(userId, TaskStatusConst.CANCELLED)
                val overdue = taskDao.getOverdueTaskCount(userId)

                TaskStats(
                    total = total,
                    pending = pending,
                    inProgress = inProgress,
                    completed = completed,
                    cancelled = cancelled,
                    overdue = overdue
                )
            } catch (e: Exception) {
                Log.e(TAG, "Failed to get task stats", e)
                TaskStats()
            }
        }
    }

    /**
     * 获取本周完成的任务数量
     */
    suspend fun getCompletedThisWeek(userId: String): Int {
        return withContext(Dispatchers.IO) {
            val (weekStart, weekEnd) = getWeekRange()
            taskDao.getCompletedThisWeek(userId, weekStart, weekEnd)
        }
    }

    // ===== 辅助方法 =====

    /**
     * 获取今日时间范围
     */
    private fun getTodayRange(): Pair<Long, Long> {
        val calendar = Calendar.getInstance()
        calendar.set(Calendar.HOUR_OF_DAY, 0)
        calendar.set(Calendar.MINUTE, 0)
        calendar.set(Calendar.SECOND, 0)
        calendar.set(Calendar.MILLISECOND, 0)
        val todayStart = calendar.timeInMillis

        calendar.add(Calendar.DAY_OF_MONTH, 1)
        val todayEnd = calendar.timeInMillis

        return todayStart to todayEnd
    }

    /**
     * 获取本周时间范围
     */
    private fun getWeekRange(): Pair<Long, Long> {
        val calendar = Calendar.getInstance()
        calendar.set(Calendar.DAY_OF_WEEK, calendar.firstDayOfWeek)
        calendar.set(Calendar.HOUR_OF_DAY, 0)
        calendar.set(Calendar.MINUTE, 0)
        calendar.set(Calendar.SECOND, 0)
        calendar.set(Calendar.MILLISECOND, 0)
        val weekStart = calendar.timeInMillis

        calendar.add(Calendar.WEEK_OF_YEAR, 1)
        val weekEnd = calendar.timeInMillis

        return weekStart to weekEnd
    }
}
