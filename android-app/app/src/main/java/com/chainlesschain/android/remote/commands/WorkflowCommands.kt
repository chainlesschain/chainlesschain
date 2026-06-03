package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 工作流命令 API
 *
 * 提供类型安全的工作流自动化命令，支持创建、执行和管理PC端的自动化工作流
 */
@Singleton
class WorkflowCommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    /**
     * 创建新工作流
     *
     * @param name 工作流名称
     * @param description 工作流描述
     * @param steps 工作流步骤列表
     * @param variables 初始变量
     * @param timeout 全局超时时间(毫秒)
     * @param rollbackOnError 错误时是否回滚
     * @return 创建结果
     */
    suspend fun create(
        name: String,
        steps: List<WorkflowStep>,
        description: String? = null,
        variables: Map<String, Any>? = null,
        timeout: Long? = null,
        rollbackOnError: Boolean = false
    ): Result<WorkflowCreateResponse> {
        val params = mutableMapOf<String, Any>(
            "name" to name,
            "steps" to steps.map { it.toMap() }
        )
        description?.let { params["description"] = it }
        variables?.let { params["variables"] = it }
        timeout?.let { params["timeout"] = it }
        params["rollbackOnError"] = rollbackOnError

        return client.invoke("workflow.create", params)
    }

    /**
     * 执行工作流
     *
     * @param workflowId 工作流ID
     * @param variables 运行时变量(覆盖默认值)
     * @param async 是否异步执行
     * @return 执行结果
     */
    suspend fun execute(
        workflowId: String,
        variables: Map<String, Any>? = null,
        async: Boolean = false
    ): Result<WorkflowExecuteResponse> {
        val params = mutableMapOf<String, Any>(
            "workflowId" to workflowId,
            "async" to async
        )
        variables?.let { params["variables"] = it }

        return client.invoke("workflow.execute", params)
    }

    /**
     * 获取工作流执行状态
     *
     * @param executionId 执行ID
     * @return 执行状态
     */
    suspend fun getStatus(executionId: String): Result<WorkflowStatusResponse> {
        val params = mapOf("executionId" to executionId)
        return client.invoke("workflow.getStatus", params)
    }

    /**
     * 取消正在执行的工作流
     *
     * @param executionId 执行ID
     * @return 取消结果
     */
    suspend fun cancel(executionId: String): Result<WorkflowCancelResponse> {
        val params = mapOf("executionId" to executionId)
        return client.invoke("workflow.cancel", params)
    }

    /**
     * 获取工作流列表
     *
     * @param limit 返回条数限制
     * @param offset 偏移量
     * @return 工作流列表
     */
    suspend fun list(
        limit: Int = 50,
        offset: Int = 0
    ): Result<WorkflowListResponse> {
        val params = mapOf(
            "limit" to limit,
            "offset" to offset
        )
        return client.invoke("workflow.list", params)
    }

    /**
     * 获取工作流详情
     *
     * @param workflowId 工作流ID
     * @return 工作流详情
     */
    suspend fun get(workflowId: String): Result<WorkflowDetailResponse> {
        val params = mapOf("workflowId" to workflowId)
        return client.invoke("workflow.get", params)
    }

    /**
     * 更新工作流
     *
     * @param workflowId 工作流ID
     * @param name 新名称
     * @param description 新描述
     * @param steps 新步骤
     * @param variables 新变量
     * @return 更新结果
     */
    suspend fun update(
        workflowId: String,
        name: String? = null,
        description: String? = null,
        steps: List<WorkflowStep>? = null,
        variables: Map<String, Any>? = null
    ): Result<WorkflowUpdateResponse> {
        val params = mutableMapOf<String, Any>("workflowId" to workflowId)
        name?.let { params["name"] = it }
        description?.let { params["description"] = it }
        steps?.let { params["steps"] = it.map { step -> step.toMap() } }
        variables?.let { params["variables"] = it }

        return client.invoke("workflow.update", params)
    }

    /**
     * 删除工作流
     *
     * @param workflowId 工作流ID
     * @return 删除结果
     */
    suspend fun delete(workflowId: String): Result<WorkflowDeleteResponse> {
        val params = mapOf("workflowId" to workflowId)
        return client.invoke("workflow.delete", params)
    }

    /**
     * 获取工作流执行历史
     *
     * @param workflowId 工作流ID(可选，不指定则返回所有)
     * @param limit 返回条数限制
     * @param offset 偏移量
     * @return 执行历史
     */
    suspend fun getHistory(
        workflowId: String? = null,
        limit: Int = 50,
        offset: Int = 0
    ): Result<WorkflowHistoryResponse> {
        val params = mutableMapOf<String, Any>(
            "limit" to limit,
            "offset" to offset
        )
        workflowId?.let { params["workflowId"] = it }

        return client.invoke("workflow.getHistory", params)
    }

    /**
     * 获取正在运行的工作流
     *
     * @return 正在运行的工作流列表
     */
    suspend fun getRunning(): Result<WorkflowRunningResponse> {
        return client.invoke("workflow.getRunning", emptyMap())
    }

    /**
     * 克隆工作流
     *
     * @param workflowId 源工作流ID
     * @param newName 新工作流名称
     * @return 克隆结果
     */
    suspend fun clone(
        workflowId: String,
        newName: String
    ): Result<WorkflowCreateResponse> {
        val params = mapOf(
            "workflowId" to workflowId,
            "newName" to newName
        )
        return client.invoke("workflow.clone", params)
    }

    /**
     * 导出工作流为JSON
     *
     * @param workflowId 工作流ID
     * @return 工作流JSON
     */
    suspend fun export(workflowId: String): Result<WorkflowExportResponse> {
        val params = mapOf("workflowId" to workflowId)
        return client.invoke("workflow.export", params)
    }

    /**
     * 导入工作流
     *
     * @param definition 工作流定义JSON
     * @param name 可选新名称(覆盖导入的名称)
     * @return 导入结果
     */
    suspend fun import(
        definition: String,
        name: String? = null
    ): Result<WorkflowCreateResponse> {
        val params = mutableMapOf<String, Any>("definition" to definition)
        name?.let { params["name"] = it }

        return client.invoke("workflow.import", params)
    }
}

/**
 * 工作流步骤
 */
data class WorkflowStep(
    val id: String,
    val action: String,
    val params: Map<String, Any> = emptyMap(),
    val retry: RetryConfig? = null,
    val onRollback: RollbackAction? = null,
    val condition: String? = null  // 条件表达式，如 "{{enabled}} === true"
) {
    fun toMap(): Map<String, Any> {
        val map = mutableMapOf<String, Any>(
            "id" to id,
            "action" to action,
            "params" to params
        )
        retry?.let { map["retry"] = it.toMap() }
        onRollback?.let { map["onRollback"] = it.toMap() }
        condition?.let { map["condition"] = it }
        return map
    }
}

/**
 * 重试配置
 */
data class RetryConfig(
    val maxAttempts: Int = 3,
    val delay: Long = 1000,  // 毫秒
    val backoffFactor: Double = 2.0
) {
    fun toMap(): Map<String, Any> = mapOf(
        "maxAttempts" to maxAttempts,
        "delay" to delay,
        "backoffFactor" to backoffFactor
    )
}

/**
 * 回滚操作
 */
data class RollbackAction(
    val action: String,
    val params: Map<String, Any> = emptyMap()
) {
    fun toMap(): Map<String, Any> = mapOf(
        "action" to action,
        "params" to params
    )
}

/**
 * 控制流步骤 - If条件
 */
data class IfStep(
    val id: String,
    val condition: String,
    val thenSteps: List<WorkflowStep>,
    val elseSteps: List<WorkflowStep>? = null
) {
    fun toWorkflowStep(): WorkflowStep = WorkflowStep(
        id = id,
        action = "control.if",
        params = mapOf(
            "condition" to condition,
            "then" to thenSteps.map { it.toMap() },
            "else" to (elseSteps?.map { it.toMap() } ?: emptyList<Map<String, Any>>())
        )
    )
}

/**
 * 控制流步骤 - ForEach循环
 */
data class ForEachStep(
    val id: String,
    val items: String,  // 变量引用，如 "{{items}}"
    val itemVar: String = "item",
    val indexVar: String = "index",
    val steps: List<WorkflowStep>
) {
    fun toWorkflowStep(): WorkflowStep = WorkflowStep(
        id = id,
        action = "control.forEach",
        params = mapOf(
            "items" to items,
            "itemVar" to itemVar,
            "indexVar" to indexVar,
            "steps" to steps.map { it.toMap() }
        )
    )
}

/**
 * 控制流步骤 - While循环
 */
data class WhileStep(
    val id: String,
    val condition: String,
    val steps: List<WorkflowStep>,
    val maxIterations: Int = 100
) {
    fun toWorkflowStep(): WorkflowStep = WorkflowStep(
        id = id,
        action = "control.while",
        params = mapOf(
            "condition" to condition,
            "steps" to steps.map { it.toMap() },
            "maxIterations" to maxIterations
        )
    )
}

// ==================== 响应数据类 ====================

/**
 * 工作流创建响应
 */
@Serializable
data class WorkflowCreateResponse(
    val success: Boolean,
    val workflowId: String? = null,
    val error: String? = null
)

/**
 * 工作流执行响应
 */
@Serializable
data class WorkflowExecuteResponse(
    val success: Boolean,
    val executionId: String? = null,
    val completedSteps: Int = 0,
    val variables: Map<String, JsonElement>? = null,
    val error: String? = null
)

/**
 * 工作流状态响应
 */
@Serializable
data class WorkflowStatusResponse(
    val success: Boolean,
    val status: String? = null,  // "pending", "running", "completed", "failed", "cancelled"
    val currentStep: String? = null,
    val completedSteps: Int = 0,
    val totalSteps: Int = 0,
    val progress: Int = 0,  // 0-100
    val variables: Map<String, JsonElement>? = null,
    val error: String? = null,
    val startedAt: Long? = null,
    val completedAt: Long? = null
)

/**
 * 工作流取消响应
 */
@Serializable
data class WorkflowCancelResponse(
    val success: Boolean,
    val cancelled: Boolean = false,
    val error: String? = null
)

/**
 * 工作流列表项
 */
@Serializable
data class WorkflowListItem(
    val id: String,
    val name: String,
    val description: String? = null,
    val stepCount: Int = 0,
    val createdAt: Long,
    val updatedAt: Long,
    val lastRunAt: Long? = null,
    val runCount: Int = 0
)

/**
 * 工作流列表响应
 */
@Serializable
data class WorkflowListResponse(
    val success: Boolean,
    val workflows: List<WorkflowListItem> = emptyList(),
    val total: Int = 0,
    val error: String? = null
)

/**
 * 工作流详情响应
 */
@Serializable
data class WorkflowDetailResponse(
    val success: Boolean,
    val workflow: WorkflowDefinition? = null,
    val error: String? = null
)

/**
 * 工作流定义
 */
@Serializable
data class WorkflowDefinition(
    val id: String,
    val name: String,
    val description: String? = null,
    val steps: List<Map<String, JsonElement>>,
    val variables: Map<String, JsonElement>? = null,
    val timeout: Long? = null,
    val rollbackOnError: Boolean = false,
    val createdAt: Long,
    val updatedAt: Long
)

/**
 * 工作流更新响应
 */
@Serializable
data class WorkflowUpdateResponse(
    val success: Boolean,
    val error: String? = null
)

/**
 * 工作流删除响应
 */
@Serializable
data class WorkflowDeleteResponse(
    val success: Boolean,
    val error: String? = null
)

/**
 * 执行历史项
 */
@Serializable
data class WorkflowExecutionHistory(
    val id: String,
    val workflowId: String,
    val workflowName: String,
    val status: String,
    val completedSteps: Int,
    val totalSteps: Int,
    val startedAt: Long,
    val completedAt: Long? = null,
    val duration: Long? = null,  // 毫秒
    val error: String? = null
)

/**
 * 工作流历史响应
 */
@Serializable
data class WorkflowHistoryResponse(
    val success: Boolean,
    val executions: List<WorkflowExecutionHistory> = emptyList(),
    val total: Int = 0,
    val error: String? = null
)

/**
 * 正在运行的工作流项
 */
@Serializable
data class RunningWorkflow(
    val executionId: String,
    val workflowId: String,
    val workflowName: String,
    val currentStep: String? = null,
    val progress: Int = 0,
    val startedAt: Long
)

/**
 * 正在运行的工作流响应
 */
@Serializable
data class WorkflowRunningResponse(
    val success: Boolean,
    val running: List<RunningWorkflow> = emptyList(),
    val count: Int = 0
)

/**
 * 工作流导出响应
 */
@Serializable
data class WorkflowExportResponse(
    val success: Boolean,
    val definition: String? = null,  // JSON字符串
    val error: String? = null
)

/**
 * 工作流进度事件
 *
 * 当工作流执行进度变化时通过P2P事件推送
 */
@Serializable
data class WorkflowProgressEvent(
    val type: String = "workflow.progress",
    val executionId: String,
    val workflowId: String,
    val workflowName: String,
    val status: String,
    val currentStep: String? = null,
    val completedSteps: Int,
    val totalSteps: Int,
    val progress: Int,
    val timestamp: Long
)

/**
 * 工作流完成事件
 */
@Serializable
data class WorkflowCompletedEvent(
    val type: String = "workflow.completed",
    val executionId: String,
    val workflowId: String,
    val workflowName: String,
    val success: Boolean,
    val completedSteps: Int,
    val duration: Long,
    val error: String? = null,
    val timestamp: Long
)
