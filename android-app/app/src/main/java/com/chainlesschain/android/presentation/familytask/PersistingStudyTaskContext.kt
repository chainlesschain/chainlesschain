package com.chainlesschain.android.presentation.familytask

import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyTaskRepository
import com.chainlesschain.android.feature.familyguard.domain.task.AiCallLogEntry
import com.chainlesschain.android.presentation.aistudy.StudyTask
import com.chainlesschain.android.presentation.aistudy.StudyTaskContext
import com.chainlesschain.android.presentation.aistudy.StudyTaskStatus
import com.chainlesschain.android.presentation.aistudy.TaskAiCall
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * M5 任务上下文的**防作弊 log 持久版** (主文档 §3.5 ai_call_log)。
 *
 * 原 InMemoryStudyTaskContext 的 AI 调用 log 只在内存 —— 孩子重启 App 即可
 * 清空 answer-seeking 计数, 逃掉满分减半防作弊 (TaskCompletionEarn)。本实现
 * 行为不变 + 每条调用异步写穿 family_task.ai_call_log (只元数据: 时间 + 类别,
 * 无 prompt 原文); 完成时 TaskCompletionEarn 对 内存+持久 两源**按时间戳去重**
 * 合并, 重启不丢也不双计。
 *
 * activeTask 仍为内存态 (有意): 进行中状态以 FamilyTaskRepository 持久 status
 * 为真相源, 「开始学习」时由 FamilyTaskViewModel 重新 set。
 */
@Singleton
class PersistingStudyTaskContext @Inject constructor(
    private val repo: FamilyTaskRepository,
) : StudyTaskContext {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _activeTask = MutableStateFlow<StudyTask?>(null)
    override val activeTask: StateFlow<StudyTask?> = _activeTask.asStateFlow()

    private val callLog = MutableStateFlow<List<TaskAiCall>>(emptyList())

    override fun setActiveTask(task: StudyTask?) {
        _activeTask.value = task?.takeIf { it.status == StudyTaskStatus.IN_PROGRESS }
    }

    override fun logAiCall(call: TaskAiCall) {
        callLog.update { it + call }
        scope.launch {
            // "normal" | "answer_seeking" — 与 AiCallLogEntry.kind 契约对齐。
            repo.appendAiCall(call.taskId, AiCallLogEntry(call.timestamp, call.kind.name.lowercase()))
        }
    }

    override fun callLogFor(taskId: String): List<TaskAiCall> =
        callLog.value.filter { it.taskId == taskId }

    /** 测试用: 等所有已发起的写穿完成。 */
    internal suspend fun awaitIdle() {
        scope.coroutineContext[Job]?.children?.forEach { it.join() }
    }
}
