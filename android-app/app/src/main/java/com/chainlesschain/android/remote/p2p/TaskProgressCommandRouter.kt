package com.chainlesschain.android.remote.p2p

import com.chainlesschain.android.task.LongRunningTask
import com.chainlesschain.android.task.LongTaskRegistry
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * `task.*` 命名空间的 reverse-RPC 接收器（M4 ProgressViewer）。
 *
 * 桌面端 Cowork orchestrator / Workflow runner / Skill executor 在任务期间通过
 * mobile-bridge.sendReverseRpcRequest 推快照到手机：
 *
 *   - `task.update` — upsert 单个 task 状态/进度
 *   - `task.complete` — 标记 Completed (终态)
 *   - `task.fail` — 标记 Failed
 *   - `task.cancel` — 标记 Cancelled
 *   - `task.remove` — 桌面主动清掉（如垃圾回收）
 *
 * 所有方法返回 `{ok: Boolean, found: Boolean?}` 给桌面确认收到。
 */
@Singleton
class TaskProgressCommandRouter @Inject constructor(
    private val registry: LongTaskRegistry,
) : CommandRouter {

    override suspend fun route(method: String, params: Map<String, Any>): Any? {
        return when (method) {
            "task.update" -> handleUpdate(params)
            "task.complete" -> handleComplete(params)
            "task.fail" -> handleFail(params)
            "task.cancel" -> handleCancel(params)
            "task.remove" -> handleRemove(params)
            else -> {
                if (method.startsWith("task.")) {
                    throw IllegalArgumentException("Unknown task method: $method")
                }
                throw IllegalArgumentException("Method namespace not handled: $method")
            }
        }
    }

    private fun handleUpdate(params: Map<String, Any>): Map<String, Any?> {
        val id = params["id"] as? String
            ?: throw IllegalArgumentException("task.update: missing 'id' param")
        val title = params["title"] as? String
            ?: throw IllegalArgumentException("task.update: missing 'title' param")

        val now = System.currentTimeMillis()
        val existing = registry.get(id)
        val createdAt = existing?.createdAt ?: now
        val state = parseState(params["state"] as? String) ?: existing?.state
            ?: LongRunningTask.State.Running
        val progress = parseProgress(params["progress"])

        val task = LongRunningTask(
            id = id,
            title = title,
            description = params["description"] as? String,
            progress = progress,
            state = state,
            createdAt = createdAt,
            updatedAt = now,
            errorMessage = params["errorMessage"] as? String,
            category = params["category"] as? String ?: "generic",
        )
        registry.upsert(task)
        Timber.d("task.update: id=%s state=%s progress=%s", id, state, progress)
        return mapOf("ok" to true)
    }

    private fun handleComplete(params: Map<String, Any>): Map<String, Any?> {
        val id = requireId(params, "task.complete")
        val ok = registry.markCompleted(id, params["description"] as? String)
        return mapOf("ok" to true, "found" to ok)
    }

    private fun handleFail(params: Map<String, Any>): Map<String, Any?> {
        val id = requireId(params, "task.fail")
        val err = (params["errorMessage"] as? String) ?: "unknown error"
        val ok = registry.markFailed(id, err)
        return mapOf("ok" to true, "found" to ok)
    }

    private fun handleCancel(params: Map<String, Any>): Map<String, Any?> {
        val id = requireId(params, "task.cancel")
        val ok = registry.markCancelled(id, params["reason"] as? String)
        return mapOf("ok" to true, "found" to ok)
    }

    private fun handleRemove(params: Map<String, Any>): Map<String, Any?> {
        val id = requireId(params, "task.remove")
        val removed = registry.remove(id)
        return mapOf("ok" to true, "found" to removed)
    }

    private fun requireId(params: Map<String, Any>, method: String): String =
        (params["id"] as? String) ?: throw IllegalArgumentException("$method: missing 'id' param")

    private fun parseState(s: String?): LongRunningTask.State? = when (s?.lowercase()) {
        "pending" -> LongRunningTask.State.Pending
        "running" -> LongRunningTask.State.Running
        "completed" -> LongRunningTask.State.Completed
        "failed" -> LongRunningTask.State.Failed
        "cancelled", "canceled" -> LongRunningTask.State.Cancelled
        null -> null
        else -> null  // 未知值忽略，沿用 existing
    }

    private fun parseProgress(value: Any?): Float? = when (value) {
        is Number -> value.toFloat().coerceIn(0f, 1f)
        is String -> value.toFloatOrNull()?.coerceIn(0f, 1f)
        else -> null
    }
}
