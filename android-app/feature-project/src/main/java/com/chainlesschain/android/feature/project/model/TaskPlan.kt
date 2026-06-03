package com.chainlesschain.android.feature.project.model

import java.util.UUID

/**
 * 任务计划数据模型
 * AI可以生成任务计划，用户确认后执行
 */
data class TaskPlan(
    val id: String = UUID.randomUUID().toString(),
    val title: String,
    val description: String = "",
    val steps: List<TaskStep>,
    val status: TaskPlanStatus = TaskPlanStatus.PENDING,
    val createdAt: Long = System.currentTimeMillis(),
    val completedAt: Long? = null,
    val projectId: String? = null,
    val relatedMessageId: String? = null
) {
    /**
     * 获取完成进度 (0.0 - 1.0)
     */
    fun getProgress(): Float {
        if (steps.isEmpty()) return 0f
        val completedCount = steps.count { it.status == StepStatus.COMPLETED }
        return completedCount.toFloat() / steps.size
    }

    /**
     * 获取当前正在执行的步骤
     */
    fun getCurrentStep(): TaskStep? {
        return steps.firstOrNull { it.status == StepStatus.IN_PROGRESS }
            ?: steps.firstOrNull { it.status == StepStatus.PENDING }
    }

    /**
     * 检查是否所有步骤都已完成
     */
    fun isAllCompleted(): Boolean {
        return steps.all { it.status == StepStatus.COMPLETED }
    }

    /**
     * 检查是否有失败的步骤
     */
    fun hasFailed(): Boolean {
        return steps.any { it.status == StepStatus.FAILED }
    }

    /**
     * 从JSON解析任务计划
     */
    companion object {
        fun fromAIResponse(response: String, projectId: String?): TaskPlan? {
            // 尝试解析AI返回的任务计划格式
            // 支持多种格式：
            // 1. JSON格式
            // 2. Markdown列表格式
            return try {
                parseMarkdownTaskPlan(response, projectId)
            } catch (e: Exception) {
                null
            }
        }

        private fun parseMarkdownTaskPlan(content: String, projectId: String?): TaskPlan? {
            // 查找任务标题
            val titleRegex = Regex("""(?:任务计划|Task Plan)[：:\s]*(.+?)(?:\n|$)""", RegexOption.IGNORE_CASE)
            val titleMatch = titleRegex.find(content)
            val title = titleMatch?.groupValues?.getOrNull(1)?.trim() ?: return null

            // 查找步骤列表
            val stepsRegex = Regex("""(?:^|\n)\s*[-*]\s*(?:\[[ x]\]\s*)?(.+?)(?=\n|$)""", RegexOption.MULTILINE)
            val stepsMatches = stepsRegex.findAll(content)
            val steps = stepsMatches.mapIndexed { index, match ->
                TaskStep(
                    order = index + 1,
                    description = match.groupValues[1].trim(),
                    status = if (match.value.contains("[x]", ignoreCase = true))
                        StepStatus.COMPLETED else StepStatus.PENDING
                )
            }.toList()

            if (steps.isEmpty()) return null

            return TaskPlan(
                title = title,
                steps = steps,
                projectId = projectId
            )
        }
    }
}

/**
 * 任务步骤
 */
data class TaskStep(
    val id: String = UUID.randomUUID().toString(),
    val order: Int,
    val description: String,
    val status: StepStatus = StepStatus.PENDING,
    val result: String? = null,
    val error: String? = null,
    val startedAt: Long? = null,
    val completedAt: Long? = null,
    val metadata: Map<String, String> = emptyMap()
) {
    /**
     * 获取状态显示文本
     */
    fun getStatusText(): String = when (status) {
        StepStatus.PENDING -> "待执行"
        StepStatus.IN_PROGRESS -> "执行中"
        StepStatus.COMPLETED -> "已完成"
        StepStatus.FAILED -> "失败"
        StepStatus.SKIPPED -> "已跳过"
    }
}

/**
 * 任务计划状态
 */
enum class TaskPlanStatus {
    /**
     * 等待确认
     */
    PENDING,

    /**
     * 已确认，等待执行
     */
    CONFIRMED,

    /**
     * 正在执行
     */
    EXECUTING,

    /**
     * 已完成
     */
    COMPLETED,

    /**
     * 执行失败
     */
    FAILED,

    /**
     * 已取消
     */
    CANCELLED
}

/**
 * 步骤状态
 */
enum class StepStatus {
    /**
     * 等待执行
     */
    PENDING,

    /**
     * 正在执行
     */
    IN_PROGRESS,

    /**
     * 已完成
     */
    COMPLETED,

    /**
     * 执行失败
     */
    FAILED,

    /**
     * 已跳过
     */
    SKIPPED
}
