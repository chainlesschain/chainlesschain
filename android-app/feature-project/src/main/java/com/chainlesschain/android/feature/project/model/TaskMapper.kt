package com.chainlesschain.android.feature.project.model

import timber.log.Timber
import com.chainlesschain.android.core.database.entity.TaskEntity
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * 任务数据映射器
 *
 * 负责 TaskEntity（数据库实体）和 Task（UI 模型）之间的转换
 */
object TaskMapper {

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        isLenient = true
    }

    /**
     * 将数据库实体转换为 UI 模型
     */
    fun toTask(entity: TaskEntity): Task {
        return Task(
            id = entity.id,
            userId = entity.userId,
            projectId = entity.projectId,
            title = entity.title,
            description = entity.description,
            status = TaskStatus.fromString(entity.status),
            priority = TaskPriority.fromString(entity.priority),
            assignedTo = entity.assignedTo,
            labels = parseLabels(entity.labels),
            dueDate = entity.dueDate,
            reminderAt = entity.reminderAt,
            estimateHours = entity.estimateHours,
            actualHours = entity.actualHours,
            steps = parseSteps(entity.steps),
            createdAt = entity.createdAt,
            updatedAt = entity.updatedAt,
            completedAt = entity.completedAt
        )
    }

    /**
     * 将 UI 模型转换为数据库实体
     */
    fun toEntity(task: Task): TaskEntity {
        return TaskEntity(
            id = task.id,
            userId = task.userId,
            projectId = task.projectId,
            title = task.title,
            description = task.description,
            status = task.status.value,
            priority = task.priority.value,
            assignedTo = task.assignedTo,
            labels = serializeLabels(task.labels),
            dueDate = task.dueDate,
            reminderAt = task.reminderAt,
            estimateHours = task.estimateHours,
            actualHours = task.actualHours,
            steps = serializeSteps(task.steps),
            createdAt = task.createdAt,
            updatedAt = task.updatedAt,
            completedAt = task.completedAt
        )
    }

    /**
     * 批量转换：实体列表 -> UI 模型列表
     */
    fun toTaskList(entities: List<TaskEntity>): List<Task> {
        return entities.map { toTask(it) }
    }

    /**
     * 批量转换：UI 模型列表 -> 实体列表
     */
    fun toEntityList(tasks: List<Task>): List<TaskEntity> {
        return tasks.map { toEntity(it) }
    }

    // ===== 私有辅助方法 =====

    /**
     * 解析标签 JSON 字符串为列表
     */
    private fun parseLabels(labelsJson: String?): List<String> {
        if (labelsJson.isNullOrBlank()) return emptyList()
        return try {
            json.decodeFromString<List<String>>(labelsJson)
        } catch (e: Exception) {
            Timber.w(e, "Failed to parse labels JSON: $labelsJson")
            emptyList()
        }
    }

    /**
     * 序列化标签列表为 JSON 字符串
     */
    private fun serializeLabels(labels: List<String>): String? {
        if (labels.isEmpty()) return null
        return try {
            json.encodeToString(labels)
        } catch (e: Exception) {
            Timber.w(e, "Failed to serialize labels: $labels")
            null
        }
    }

    /**
     * 解析子步骤 JSON 字符串为列表
     */
    private fun parseSteps(stepsJson: String?): List<TodoStep> {
        if (stepsJson.isNullOrBlank()) return emptyList()
        return try {
            val stepDtos = json.decodeFromString<List<TodoStepDto>>(stepsJson)
            stepDtos.map { dto ->
                TodoStep(
                    id = dto.id,
                    content = dto.content,
                    isCompleted = dto.isCompleted,
                    completedAt = dto.completedAt
                )
            }
        } catch (e: Exception) {
            Timber.w(e, "Failed to parse steps JSON: $stepsJson")
            emptyList()
        }
    }

    /**
     * 序列化子步骤列表为 JSON 字符串
     */
    private fun serializeSteps(steps: List<TodoStep>): String? {
        if (steps.isEmpty()) return null
        return try {
            val stepDtos = steps.map { step ->
                TodoStepDto(
                    id = step.id,
                    content = step.content,
                    isCompleted = step.isCompleted,
                    completedAt = step.completedAt
                )
            }
            json.encodeToString(stepDtos)
        } catch (e: Exception) {
            Timber.w(e, "Failed to serialize steps: $steps")
            null
        }
    }
}

/**
 * 子步骤 DTO（用于 JSON 序列化）
 */
@Serializable
private data class TodoStepDto(
    val id: String,
    val content: String,
    val isCompleted: Boolean = false,
    val completedAt: Long? = null
)
