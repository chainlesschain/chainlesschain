package com.chainlesschain.android.core.database.entity

import androidx.annotation.StringRes
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import com.chainlesschain.android.core.database.R

/**
 * 任务状态常量
 */
object TaskStatusConst {
    const val PENDING = "pending"           // 待办
    const val IN_PROGRESS = "in_progress"   // 进行中
    const val COMPLETED = "completed"       // 已完成
    const val CANCELLED = "cancelled"       // 已取消

    val ALL = listOf(PENDING, IN_PROGRESS, COMPLETED, CANCELLED)

    /**
     * 获取状态显示名称的字符串资源ID
     */
    @StringRes
    fun getDisplayNameResId(status: String): Int = when (status) {
        PENDING -> R.string.task_status_pending
        IN_PROGRESS -> R.string.task_status_in_progress
        COMPLETED -> R.string.task_status_completed
        CANCELLED -> R.string.task_status_cancelled
        else -> R.string.task_status_unknown
    }

    @Deprecated("Use getDisplayNameResId() instead", ReplaceWith("getDisplayNameResId(status)"))
    fun getDisplayName(status: String): String = when (status) {
        PENDING -> "待办"
        IN_PROGRESS -> "进行中"
        COMPLETED -> "已完成"
        CANCELLED -> "已取消"
        else -> "未知"
    }
}

/**
 * 任务优先级常量
 */
object TaskPriorityConst {
    const val LOW = "low"           // 低
    const val MEDIUM = "medium"     // 中
    const val HIGH = "high"         // 高
    const val URGENT = "urgent"     // 紧急

    val ALL = listOf(LOW, MEDIUM, HIGH, URGENT)

    /**
     * 获取优先级显示名称的字符串资源ID
     */
    @StringRes
    fun getDisplayNameResId(priority: String): Int = when (priority) {
        LOW -> R.string.task_priority_low
        MEDIUM -> R.string.task_priority_medium
        HIGH -> R.string.task_priority_high
        URGENT -> R.string.task_priority_urgent
        else -> R.string.task_priority_unknown
    }

    @Deprecated("Use getDisplayNameResId() instead", ReplaceWith("getDisplayNameResId(priority)"))
    fun getDisplayName(priority: String): String = when (priority) {
        LOW -> "低"
        MEDIUM -> "中"
        HIGH -> "高"
        URGENT -> "紧急"
        else -> "未知"
    }

    fun getSortOrder(priority: String): Int = when (priority) {
        URGENT -> 1
        HIGH -> 2
        MEDIUM -> 3
        LOW -> 4
        else -> 5
    }
}

/**
 * 任务实体
 *
 * 存储待办任务的完整信息，支持：
 * - 基本信息：标题、描述、状态、优先级
 * - 关联信息：用户、项目
 * - 时间管理：截止日期、提醒时间、工时统计
 * - 子任务：通过 steps JSON 字段存储
 * - 标签：通过 labels JSON 字段存储
 */
@Entity(
    tableName = "tasks",
    indices = [
        Index(value = ["userId"]),
        Index(value = ["projectId"]),
        Index(value = ["status"]),
        Index(value = ["priority"]),
        Index(value = ["dueDate"]),
        Index(value = ["createdAt"])
    ]
)
data class TaskEntity(
    @PrimaryKey
    val id: String,

    /** 所属用户ID */
    val userId: String,

    /** 关联项目ID（可选） */
    val projectId: String? = null,

    /** 任务标题 */
    val title: String,

    /** 任务描述 */
    val description: String? = null,

    /** 任务状态: pending | in_progress | completed | cancelled */
    val status: String = TaskStatusConst.PENDING,

    /** 任务优先级: low | medium | high | urgent */
    val priority: String = TaskPriorityConst.MEDIUM,

    /** 指派给（用户ID） */
    val assignedTo: String? = null,

    /** 标签（JSON数组）: ["标签1", "标签2"] */
    val labels: String? = null,

    /** 截止时间（毫秒时间戳） */
    val dueDate: Long? = null,

    /** 提醒时间（毫秒时间戳） */
    val reminderAt: Long? = null,

    /** 预估工时（小时） */
    val estimateHours: Float? = null,

    /** 实际工时（小时） */
    val actualHours: Float? = null,

    /** 子步骤（JSON数组）: [{"id": "...", "content": "...", "isCompleted": false}] */
    val steps: String? = null,

    /** 创建时间 */
    val createdAt: Long = System.currentTimeMillis(),

    /** 更新时间 */
    val updatedAt: Long = System.currentTimeMillis(),

    /** 完成时间 */
    val completedAt: Long? = null
) {
    /**
     * 检查任务是否已逾期
     */
    fun isOverdue(): Boolean {
        return dueDate != null &&
                dueDate < System.currentTimeMillis() &&
                status != TaskStatusConst.COMPLETED &&
                status != TaskStatusConst.CANCELLED
    }

    /**
     * 获取状态显示名称的字符串资源ID
     */
    @StringRes
    fun getStatusDisplayNameResId(): Int = TaskStatusConst.getDisplayNameResId(status)

    /**
     * 获取优先级显示名称的字符串资源ID
     */
    @StringRes
    fun getPriorityDisplayNameResId(): Int = TaskPriorityConst.getDisplayNameResId(priority)

    /**
     * 获取状态显示名称
     */
    @Deprecated("Use getStatusDisplayNameResId() instead", ReplaceWith("getStatusDisplayNameResId()"))
    fun getStatusDisplayName(): String = @Suppress("DEPRECATION") TaskStatusConst.getDisplayName(status)

    /**
     * 获取优先级显示名称
     */
    @Deprecated("Use getPriorityDisplayNameResId() instead", ReplaceWith("getPriorityDisplayNameResId()"))
    fun getPriorityDisplayName(): String = @Suppress("DEPRECATION") TaskPriorityConst.getDisplayName(priority)

    /**
     * 解析标签列表
     */
    fun getLabelList(): List<String> {
        return try {
            labels?.let {
                kotlinx.serialization.json.Json.decodeFromString<List<String>>(it)
            } ?: emptyList()
        } catch (e: Exception) {
            emptyList()
        }
    }
}
