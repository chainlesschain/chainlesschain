package com.chainlesschain.android.feature.project.model

import java.util.UUID

/**
 * 任务状态枚举
 */
enum class TaskStatus(
    val value: String,
    val displayName: String,
    val color: Long
) {
    PENDING("pending", "待办", 0xFF9E9E9E),
    IN_PROGRESS("in_progress", "进行中", 0xFF2196F3),
    COMPLETED("completed", "已完成", 0xFF4CAF50),
    CANCELLED("cancelled", "已取消", 0xFFFF5722);

    companion object {
        fun fromString(value: String): TaskStatus {
            return entries.find { it.value.equals(value, ignoreCase = true) } ?: PENDING
        }
    }
}

/**
 * 任务优先级枚举
 */
enum class TaskPriority(
    val value: String,
    val displayName: String,
    val color: Long,
    val sortOrder: Int
) {
    LOW("low", "低", 0xFF8BC34A, 4),
    MEDIUM("medium", "中", 0xFFFFC107, 3),
    HIGH("high", "高", 0xFFFF9800, 2),
    URGENT("urgent", "紧急", 0xFFF44336, 1);

    companion object {
        fun fromString(value: String): TaskPriority {
            return entries.find { it.value.equals(value, ignoreCase = true) } ?: MEDIUM
        }
    }
}

/**
 * 任务子步骤
 */
data class TodoStep(
    val id: String = UUID.randomUUID().toString(),
    val content: String,
    val isCompleted: Boolean = false,
    val completedAt: Long? = null
)

/**
 * 任务数据类（UI 层使用）
 *
 * 与 TaskEntity 对应，但使用枚举类型和解析后的列表类型
 */
data class Task(
    val id: String = UUID.randomUUID().toString(),
    val userId: String,
    val projectId: String? = null,
    val title: String,
    val description: String? = null,
    val status: TaskStatus = TaskStatus.PENDING,
    val priority: TaskPriority = TaskPriority.MEDIUM,
    val assignedTo: String? = null,
    val labels: List<String> = emptyList(),
    val dueDate: Long? = null,
    val reminderAt: Long? = null,
    val estimateHours: Float? = null,
    val actualHours: Float? = null,
    val steps: List<TodoStep> = emptyList(),
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
    val completedAt: Long? = null
) {
    /**
     * 检查任务是否已逾期
     */
    val isOverdue: Boolean
        get() = dueDate != null &&
                dueDate < System.currentTimeMillis() &&
                status != TaskStatus.COMPLETED &&
                status != TaskStatus.CANCELLED

    /**
     * 获取完成率（0.0 - 1.0）
     * 如果没有子步骤，根据状态返回 0 或 1
     */
    val completionRate: Float
        get() {
            if (steps.isEmpty()) {
                return if (status == TaskStatus.COMPLETED) 1f else 0f
            }
            return steps.count { it.isCompleted }.toFloat() / steps.size
        }

    /**
     * 检查是否有子步骤
     */
    val hasSteps: Boolean
        get() = steps.isNotEmpty()

    /**
     * 获取已完成的子步骤数量
     */
    val completedStepsCount: Int
        get() = steps.count { it.isCompleted }

    /**
     * 获取总子步骤数量
     */
    val totalStepsCount: Int
        get() = steps.size

    /**
     * 检查是否即将到期（24小时内）
     */
    val isDueSoon: Boolean
        get() {
            if (dueDate == null) return false
            if (status == TaskStatus.COMPLETED || status == TaskStatus.CANCELLED) return false
            val now = System.currentTimeMillis()
            val oneDayMs = 24 * 60 * 60 * 1000L
            return dueDate > now && dueDate <= now + oneDayMs
        }
}

/**
 * 任务统计数据
 */
data class TaskStats(
    val total: Int = 0,
    val pending: Int = 0,
    val inProgress: Int = 0,
    val completed: Int = 0,
    val cancelled: Int = 0,
    val overdue: Int = 0
) {
    /**
     * 获取活跃任务数量（待办 + 进行中）
     */
    val active: Int
        get() = pending + inProgress

    /**
     * 获取完成率
     */
    val completionRate: Float
        get() {
            val completable = total - cancelled
            if (completable == 0) return 0f
            return completed.toFloat() / completable
        }
}

/**
 * 任务筛选条件
 */
data class TaskFilter(
    val status: TaskStatus? = null,
    val priority: TaskPriority? = null,
    val projectId: String? = null,
    val showOverdueOnly: Boolean = false,
    val showTodayOnly: Boolean = false,
    val searchQuery: String? = null,
    val label: String? = null
)

/**
 * 任务排序方式
 */
enum class TaskSortBy(val displayName: String) {
    CREATED_AT("创建时间"),
    UPDATED_AT("更新时间"),
    DUE_DATE("截止时间"),
    PRIORITY("优先级"),
    TITLE("标题"),
    STATUS("状态")
}

/**
 * 任务列表 UI 状态
 */
sealed class TaskListState {
    object Loading : TaskListState()
    object Empty : TaskListState()
    data class Success(
        val tasks: List<Task>,
        val stats: TaskStats,
        val filter: TaskFilter = TaskFilter(),
        val sortBy: TaskSortBy = TaskSortBy.CREATED_AT,
        val sortAscending: Boolean = false
    ) : TaskListState()
    data class Error(val message: String) : TaskListState()
}

/**
 * 任务 UI 事件
 */
sealed class TaskUiEvent {
    data class ShowMessage(val message: String) : TaskUiEvent()
    data class ShowError(val error: String) : TaskUiEvent()
    data class NavigateToTask(val taskId: String) : TaskUiEvent()
    object NavigateBack : TaskUiEvent()
    data class TaskCreated(val task: Task) : TaskUiEvent()
    data class TaskUpdated(val task: Task) : TaskUiEvent()
    data class TaskDeleted(val taskId: String) : TaskUiEvent()
}
