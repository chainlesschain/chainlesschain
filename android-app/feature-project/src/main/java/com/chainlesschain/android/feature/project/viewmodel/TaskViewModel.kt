package com.chainlesschain.android.feature.project.viewmodel

import android.content.Context
import timber.log.Timber
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.project.model.Task
import com.chainlesschain.android.feature.project.model.TaskFilter
import com.chainlesschain.android.feature.project.model.TaskListState
import com.chainlesschain.android.feature.project.model.TaskPriority
import com.chainlesschain.android.feature.project.model.TaskSortBy
import com.chainlesschain.android.feature.project.model.TaskStats
import com.chainlesschain.android.feature.project.model.TaskStatus
import com.chainlesschain.android.feature.project.model.TaskUiEvent
import com.chainlesschain.android.feature.project.model.TodoStep
import com.chainlesschain.android.feature.project.repository.CreateTaskRequest
import com.chainlesschain.android.feature.project.repository.TaskRepository
import com.chainlesschain.android.feature.project.repository.UpdateTaskRequest
import com.chainlesschain.android.feature.project.R
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 任务 ViewModel
 *
 * 管理任务列表、任务详情、任务操作的 UI 状态
 */
@HiltViewModel
class TaskViewModel @Inject constructor(
    private val taskRepository: TaskRepository,
    @ApplicationContext private val context: Context
) : ViewModel() {


    // ===== 当前用户 =====
    private val _currentUserId = MutableStateFlow<String?>(null)
    val currentUserId: StateFlow<String?> = _currentUserId.asStateFlow()

    // ===== 任务列表状态 =====
    private val _taskListState = MutableStateFlow<TaskListState>(TaskListState.Loading)
    val taskListState: StateFlow<TaskListState> = _taskListState.asStateFlow()

    // ===== 选中的任务 =====
    private val _selectedTask = MutableStateFlow<Task?>(null)
    val selectedTask: StateFlow<Task?> = _selectedTask.asStateFlow()

    // ===== 筛选条件 =====
    private val _filter = MutableStateFlow(TaskFilter())
    val filter: StateFlow<TaskFilter> = _filter.asStateFlow()

    // ===== 排序 =====
    private val _sortBy = MutableStateFlow(TaskSortBy.CREATED_AT)
    val sortBy: StateFlow<TaskSortBy> = _sortBy.asStateFlow()

    private val _sortAscending = MutableStateFlow(false)
    val sortAscending: StateFlow<Boolean> = _sortAscending.asStateFlow()

    // ===== 任务统计 =====
    private val _taskStats = MutableStateFlow(TaskStats())
    val taskStats: StateFlow<TaskStats> = _taskStats.asStateFlow()

    // ===== 加载状态 =====
    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    // ===== UI 事件 =====
    private val _uiEvents = MutableSharedFlow<TaskUiEvent>()
    val uiEvents: SharedFlow<TaskUiEvent> = _uiEvents.asSharedFlow()

    // ===== 创建任务临时状态 =====
    private val _newTaskTitle = MutableStateFlow("")
    val newTaskTitle: StateFlow<String> = _newTaskTitle.asStateFlow()

    private val _newTaskDescription = MutableStateFlow("")
    val newTaskDescription: StateFlow<String> = _newTaskDescription.asStateFlow()

    private val _newTaskPriority = MutableStateFlow(TaskPriority.MEDIUM)
    val newTaskPriority: StateFlow<TaskPriority> = _newTaskPriority.asStateFlow()

    private val _newTaskDueDate = MutableStateFlow<Long?>(null)
    val newTaskDueDate: StateFlow<Long?> = _newTaskDueDate.asStateFlow()

    private val _newTaskLabels = MutableStateFlow<List<String>>(emptyList())
    val newTaskLabels: StateFlow<List<String>> = _newTaskLabels.asStateFlow()

    private val _newTaskSteps = MutableStateFlow<List<String>>(emptyList())
    val newTaskSteps: StateFlow<List<String>> = _newTaskSteps.asStateFlow()

    private var loadTasksJob: Job? = null

    /**
     * 设置当前用户
     */
    fun setCurrentUser(userId: String) {
        Timber.d("setCurrentUser: $userId")
        _currentUserId.value = userId
        loadTasks()
        loadStats()
    }

    /**
     * 加载任务列表
     */
    fun loadTasks() {
        val userId = _currentUserId.value ?: return

        loadTasksJob?.cancel()
        loadTasksJob = viewModelScope.launch {
            _taskListState.value = TaskListState.Loading

            try {
                val filter = _filter.value

                // 根据筛选条件选择数据流
                val tasksFlow = when {
                    !filter.searchQuery.isNullOrBlank() ->
                        taskRepository.searchTasks(userId, filter.searchQuery)
                    filter.showOverdueOnly ->
                        taskRepository.getOverdueTasks(userId)
                    filter.showTodayOnly ->
                        taskRepository.getTodayTasks(userId)
                    filter.status != null ->
                        taskRepository.getTasksByStatus(userId, filter.status)
                    filter.priority != null ->
                        taskRepository.getTasksByPriority(userId, filter.priority)
                    filter.projectId != null ->
                        taskRepository.getTasksByProject(filter.projectId)
                    filter.label != null ->
                        taskRepository.getTasksByLabel(userId, filter.label)
                    else ->
                        taskRepository.getTasksByUser(userId)
                }

                tasksFlow
                    .map { tasks -> sortTasks(tasks) }
                    .catch { e ->
                        Timber.e(e, "Error loading tasks")
                        _taskListState.value = TaskListState.Error(e.message ?: "加载失败")
                    }
                    .collect { tasks ->
                        val stats = taskRepository.getTaskStats(userId)
                        _taskStats.value = stats

                        _taskListState.value = if (tasks.isEmpty()) {
                            TaskListState.Empty
                        } else {
                            TaskListState.Success(
                                tasks = tasks,
                                stats = stats,
                                filter = _filter.value,
                                sortBy = _sortBy.value,
                                sortAscending = _sortAscending.value
                            )
                        }
                    }
            } catch (e: Exception) {
                Timber.e(e, "Error loading tasks")
                _taskListState.value = TaskListState.Error(e.message ?: "加载失败")
            }
        }
    }

    /**
     * 加载任务统计
     */
    private fun loadStats() {
        val userId = _currentUserId.value ?: return

        viewModelScope.launch {
            try {
                _taskStats.value = taskRepository.getTaskStats(userId)
            } catch (e: Exception) {
                Timber.e(e, "Error loading task stats")
            }
        }
    }

    /**
     * 排序任务
     */
    private fun sortTasks(tasks: List<Task>): List<Task> {
        val sortBy = _sortBy.value
        val ascending = _sortAscending.value

        val sorted = when (sortBy) {
            TaskSortBy.CREATED_AT -> tasks.sortedBy { it.createdAt }
            TaskSortBy.UPDATED_AT -> tasks.sortedBy { it.updatedAt }
            TaskSortBy.DUE_DATE -> tasks.sortedBy { it.dueDate ?: Long.MAX_VALUE }
            TaskSortBy.PRIORITY -> tasks.sortedBy { it.priority.sortOrder }
            TaskSortBy.TITLE -> tasks.sortedBy { it.title.lowercase() }
            TaskSortBy.STATUS -> tasks.sortedBy { it.status.ordinal }
        }

        return if (ascending) sorted else sorted.reversed()
    }

    // ===== 筛选和排序操作 =====

    /**
     * 设置筛选条件
     */
    fun setFilter(filter: TaskFilter) {
        _filter.value = filter
        loadTasks()
    }

    /**
     * 按状态筛选
     */
    fun filterByStatus(status: TaskStatus?) {
        _filter.value = _filter.value.copy(status = status)
        loadTasks()
    }

    /**
     * 按优先级筛选
     */
    fun filterByPriority(priority: TaskPriority?) {
        _filter.value = _filter.value.copy(priority = priority)
        loadTasks()
    }

    /**
     * 按项目筛选
     */
    fun filterByProject(projectId: String?) {
        _filter.value = _filter.value.copy(projectId = projectId)
        loadTasks()
    }

    /**
     * 只显示逾期任务
     */
    fun showOverdueOnly(show: Boolean) {
        _filter.value = _filter.value.copy(showOverdueOnly = show)
        loadTasks()
    }

    /**
     * 只显示今日任务
     */
    fun showTodayOnly(show: Boolean) {
        _filter.value = _filter.value.copy(showTodayOnly = show)
        loadTasks()
    }

    /**
     * 搜索任务
     */
    fun search(query: String) {
        _filter.value = _filter.value.copy(searchQuery = query.takeIf { it.isNotBlank() })
        loadTasks()
    }

    /**
     * 设置排序方式
     */
    fun setSorting(sortBy: TaskSortBy, ascending: Boolean = false) {
        _sortBy.value = sortBy
        _sortAscending.value = ascending
        loadTasks()
    }

    /**
     * 清除筛选条件
     */
    fun clearFilter() {
        _filter.value = TaskFilter()
        loadTasks()
    }

    // ===== 任务操作 =====

    /**
     * 创建任务
     */
    fun createTask(
        title: String = _newTaskTitle.value,
        description: String? = _newTaskDescription.value.takeIf { it.isNotBlank() },
        priority: TaskPriority = _newTaskPriority.value,
        dueDate: Long? = _newTaskDueDate.value,
        labels: List<String> = _newTaskLabels.value,
        steps: List<String> = _newTaskSteps.value,
        projectId: String? = null
    ) {
        val userId = _currentUserId.value ?: return

        if (title.isBlank()) {
            viewModelScope.launch {
                _uiEvents.emit(TaskUiEvent.ShowError("任务标题不能为空"))
            }
            return
        }

        viewModelScope.launch {
            _isLoading.value = true

            val result = taskRepository.createTask(
                CreateTaskRequest(
                    userId = userId,
                    title = title,
                    description = description,
                    projectId = projectId,
                    priority = priority,
                    dueDate = dueDate,
                    labels = labels,
                    steps = steps
                )
            )

            result.fold(
                onSuccess = { task ->
                    clearNewTaskForm()
                    _uiEvents.emit(TaskUiEvent.ShowMessage("任务已创建"))
                    _uiEvents.emit(TaskUiEvent.TaskCreated(task))
                    loadStats()
                },
                onFailure = { error ->
                    _uiEvents.emit(TaskUiEvent.ShowError(error.message ?: "创建失败"))
                }
            )

            _isLoading.value = false
        }
    }

    /**
     * 更新任务
     */
    fun updateTask(taskId: String, request: UpdateTaskRequest) {
        viewModelScope.launch {
            _isLoading.value = true

            val result = taskRepository.updateTask(taskId, request)

            result.fold(
                onSuccess = { task ->
                    _uiEvents.emit(TaskUiEvent.ShowMessage("任务已更新"))
                    _uiEvents.emit(TaskUiEvent.TaskUpdated(task))
                },
                onFailure = { error ->
                    _uiEvents.emit(TaskUiEvent.ShowError(error.message ?: "更新失败"))
                }
            )

            _isLoading.value = false
        }
    }

    /**
     * 更新完整任务对象
     */
    fun updateTask(task: Task) {
        viewModelScope.launch {
            _isLoading.value = true

            val result = taskRepository.updateTask(task)

            result.fold(
                onSuccess = { updatedTask ->
                    _selectedTask.value = updatedTask
                    _uiEvents.emit(TaskUiEvent.ShowMessage("任务已更新"))
                    _uiEvents.emit(TaskUiEvent.TaskUpdated(updatedTask))
                },
                onFailure = { error ->
                    _uiEvents.emit(TaskUiEvent.ShowError(error.message ?: "更新失败"))
                }
            )

            _isLoading.value = false
        }
    }

    /**
     * 删除任务
     */
    fun deleteTask(taskId: String) {
        viewModelScope.launch {
            _isLoading.value = true

            val result = taskRepository.deleteTask(taskId)

            result.fold(
                onSuccess = {
                    _uiEvents.emit(TaskUiEvent.ShowMessage("任务已删除"))
                    _uiEvents.emit(TaskUiEvent.TaskDeleted(taskId))
                    if (_selectedTask.value?.id == taskId) {
                        _selectedTask.value = null
                    }
                    loadStats()
                },
                onFailure = { error ->
                    _uiEvents.emit(TaskUiEvent.ShowError(error.message ?: "删除失败"))
                }
            )

            _isLoading.value = false
        }
    }

    /**
     * 更新任务状态
     */
    fun updateTaskStatus(taskId: String, status: TaskStatus) {
        viewModelScope.launch {
            val result = taskRepository.updateTaskStatus(taskId, status)

            result.fold(
                onSuccess = {
                    val statusName = context.getString(status.displayNameResId)
                    _uiEvents.emit(TaskUiEvent.ShowMessage(context.getString(R.string.status_updated_to, statusName)))
                    loadStats()
                },
                onFailure = { error ->
                    _uiEvents.emit(TaskUiEvent.ShowError(error.message ?: "更新失败"))
                }
            )
        }
    }

    /**
     * 完成任务
     */
    fun completeTask(taskId: String) {
        updateTaskStatus(taskId, TaskStatus.COMPLETED)
    }

    /**
     * 取消任务
     */
    fun cancelTask(taskId: String) {
        updateTaskStatus(taskId, TaskStatus.CANCELLED)
    }

    /**
     * 开始任务
     */
    fun startTask(taskId: String) {
        updateTaskStatus(taskId, TaskStatus.IN_PROGRESS)
    }

    /**
     * 切换子步骤完成状态
     */
    fun toggleStepCompletion(taskId: String, stepId: String) {
        viewModelScope.launch {
            val result = taskRepository.toggleStepCompletion(taskId, stepId)

            result.fold(
                onSuccess = { task ->
                    _selectedTask.value = task
                },
                onFailure = { error ->
                    _uiEvents.emit(TaskUiEvent.ShowError(error.message ?: "更新失败"))
                }
            )
        }
    }

    /**
     * 添加子步骤
     */
    fun addStep(taskId: String, content: String) {
        if (content.isBlank()) return

        viewModelScope.launch {
            val result = taskRepository.addStep(taskId, content)

            result.fold(
                onSuccess = { task ->
                    _selectedTask.value = task
                    _uiEvents.emit(TaskUiEvent.ShowMessage("步骤已添加"))
                },
                onFailure = { error ->
                    _uiEvents.emit(TaskUiEvent.ShowError(error.message ?: "添加失败"))
                }
            )
        }
    }

    /**
     * 删除子步骤
     */
    fun removeStep(taskId: String, stepId: String) {
        viewModelScope.launch {
            val result = taskRepository.removeStep(taskId, stepId)

            result.fold(
                onSuccess = { task ->
                    _selectedTask.value = task
                    _uiEvents.emit(TaskUiEvent.ShowMessage("步骤已删除"))
                },
                onFailure = { error ->
                    _uiEvents.emit(TaskUiEvent.ShowError(error.message ?: "删除失败"))
                }
            )
        }
    }

    // ===== 任务详情 =====

    /**
     * 选择任务
     */
    fun selectTask(taskId: String) {
        viewModelScope.launch {
            _selectedTask.value = taskRepository.getTask(taskId)
        }
    }

    /**
     * 清除选中的任务
     */
    fun clearSelectedTask() {
        _selectedTask.value = null
    }

    /**
     * 观察任务详情
     */
    fun observeTask(taskId: String) {
        viewModelScope.launch {
            taskRepository.observeTask(taskId)
                .catch { e ->
                    Timber.e(e, "Error observing task")
                }
                .collect { task ->
                    _selectedTask.value = task
                }
        }
    }

    // ===== 创建任务表单操作 =====

    fun updateNewTaskTitle(title: String) {
        _newTaskTitle.value = title
    }

    fun updateNewTaskDescription(description: String) {
        _newTaskDescription.value = description
    }

    fun updateNewTaskPriority(priority: TaskPriority) {
        _newTaskPriority.value = priority
    }

    fun updateNewTaskDueDate(dueDate: Long?) {
        _newTaskDueDate.value = dueDate
    }

    fun addNewTaskLabel(label: String) {
        if (label.isNotBlank() && label !in _newTaskLabels.value) {
            _newTaskLabels.value = _newTaskLabels.value + label
        }
    }

    fun removeNewTaskLabel(label: String) {
        _newTaskLabels.value = _newTaskLabels.value - label
    }

    fun addNewTaskStep(step: String) {
        if (step.isNotBlank()) {
            _newTaskSteps.value = _newTaskSteps.value + step
        }
    }

    fun removeNewTaskStep(index: Int) {
        _newTaskSteps.value = _newTaskSteps.value.filterIndexed { i, _ -> i != index }
    }

    fun updateNewTaskStep(index: Int, content: String) {
        _newTaskSteps.value = _newTaskSteps.value.mapIndexed { i, step ->
            if (i == index) content else step
        }
    }

    fun clearNewTaskForm() {
        _newTaskTitle.value = ""
        _newTaskDescription.value = ""
        _newTaskPriority.value = TaskPriority.MEDIUM
        _newTaskDueDate.value = null
        _newTaskLabels.value = emptyList()
        _newTaskSteps.value = emptyList()
    }

    override fun onCleared() {
        super.onCleared()
        loadTasksJob?.cancel()
        Timber.d("TaskViewModel cleared")
    }
}
