package com.chainlesschain.android.task

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 内存中的长时任务注册表（M4 ProgressViewer）。
 *
 * 数据流：
 *  桌面 Cowork/Workflow → `task.update` reverse RPC → [com.chainlesschain.android.remote.p2p.TaskProgressCommandRouter]
 *   → [upsert] / [markCompleted] / [markFailed] / [markCancelled] → [tasks] StateFlow → UI
 *
 * 简化决策：v1.0 仅内存；进程被杀丢失。v1.1 加 Room 落盘 + 历史回看。
 *
 * 并发：[MutableStateFlow.update] 原子；多协程并发 upsert 同 ID 时按时间戳保留较新版本。
 *
 * 上限：[MAX_TASKS]。超出时丢弃**已终态**任务（FIFO 顺序）；如果所有任务都是 active，强制
 * 丢最旧的（罕见情况，仅保护 OOM）。
 */
@Singleton
class LongTaskRegistry @Inject constructor() {

    private val _tasks = MutableStateFlow<List<LongRunningTask>>(emptyList())
    val tasks: StateFlow<List<LongRunningTask>> = _tasks.asStateFlow()

    /**
     * 插入新任务 / 更新已存在任务。按 [LongRunningTask.id] 匹配。
     *
     * @return 更新后的 task list size
     */
    fun upsert(task: LongRunningTask): Int {
        val sanitized = task.copy(progress = task.progress?.coerceIn(0f, 1f))
        _tasks.update { current ->
            val idx = current.indexOfFirst { it.id == sanitized.id }
            val newList = if (idx >= 0) {
                current.toMutableList().also { it[idx] = sanitized }
            } else {
                current + sanitized
            }
            trim(newList)
        }
        return _tasks.value.size
    }

    /** 标记任务完成。如果 id 不存在 no-op。 */
    fun markCompleted(id: String, description: String? = null): Boolean =
        transition(id) { it.copy(
            state = LongRunningTask.State.Completed,
            description = description ?: it.description,
            progress = 1f,
            updatedAt = System.currentTimeMillis(),
        ) }

    /** 标记任务失败。 */
    fun markFailed(id: String, errorMessage: String): Boolean =
        transition(id) { it.copy(
            state = LongRunningTask.State.Failed,
            errorMessage = errorMessage,
            updatedAt = System.currentTimeMillis(),
        ) }

    /** 标记任务取消（用户或桌面端撤回）。 */
    fun markCancelled(id: String, reason: String? = null): Boolean =
        transition(id) { it.copy(
            state = LongRunningTask.State.Cancelled,
            errorMessage = reason,
            updatedAt = System.currentTimeMillis(),
        ) }

    /** 直接删除一条记录（用户在 UI 上 dismiss 已完成项时调）。 */
    fun remove(id: String): Boolean {
        var removed = false
        _tasks.update { current ->
            val filtered = current.filterNot { it.id == id }
            removed = filtered.size != current.size
            filtered
        }
        return removed
    }

    /** 清掉所有终态任务，保留运行中的。 */
    fun clearTerminal(): Int {
        var removedCount = 0
        _tasks.update { current ->
            val active = current.filter { !it.isTerminal() }
            removedCount = current.size - active.size
            active
        }
        return removedCount
    }

    /** 全清（测试 / 用户主动）。 */
    fun clear() {
        _tasks.value = emptyList()
    }

    /** 单条获取。 */
    fun get(id: String): LongRunningTask? = _tasks.value.firstOrNull { it.id == id }

    private fun transition(id: String, mutate: (LongRunningTask) -> LongRunningTask): Boolean {
        var found = false
        _tasks.update { current ->
            val idx = current.indexOfFirst { it.id == id }
            if (idx < 0) {
                Timber.w("LongTaskRegistry: transition target id=%s not found", id)
                current
            } else {
                found = true
                current.toMutableList().also { it[idx] = mutate(current[idx]) }
            }
        }
        return found
    }

    private fun trim(list: List<LongRunningTask>): List<LongRunningTask> {
        if (list.size <= MAX_TASKS) return list
        // 先丢已终态的最旧；都 active 时丢最旧（罕见）
        val terminal = list.filter { it.isTerminal() }
        if (terminal.isNotEmpty()) {
            val dropIds = terminal.sortedBy { it.updatedAt }.take(list.size - MAX_TASKS).map { it.id }.toSet()
            return list.filterNot { it.id in dropIds }
        }
        return list.sortedBy { it.createdAt }.drop(list.size - MAX_TASKS)
    }

    companion object {
        const val MAX_TASKS = 100
    }
}
