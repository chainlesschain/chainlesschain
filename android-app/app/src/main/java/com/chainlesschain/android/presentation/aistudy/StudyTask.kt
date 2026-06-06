package com.chainlesschain.android.presentation.aistudy

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject
import javax.inject.Singleton

/** M5 任务状态 (主文档 §3.5)。本次 aistudy 联动只关心 [IN_PROGRESS]。 */
enum class StudyTaskStatus { ASSIGNED, IN_PROGRESS, SUBMITTED, GRADED, DONE }

/** M5 任务类型 (主文档 §3.5 表)。引导模式 / AI 批改主要针对 [HOMEWORK]。 */
enum class StudyTaskType { HOMEWORK, CHORE, EXERCISE, READING, CUSTOM }

/**
 * 一条学习任务/作业 (主文档 §3.5 `family_task` 的 aistudy 侧最小投影)。
 *
 * 完整的 family_task (P2P 同步 / 群作业导入 / 家长 UI / M4 硬绑 / M9 积分) 是
 * 设备/后端阻塞的大里程碑；这里只取**学习 tab 联动**需要的字段。
 */
data class StudyTask(
    val id: String,
    val title: String,
    val description: String = "",
    val type: StudyTaskType = StudyTaskType.HOMEWORK,
    val subject: Subject? = null,
    val status: StudyTaskStatus = StudyTaskStatus.ASSIGNED,
)

/** AI 调用防作弊类别。 */
enum class AiCallKind {
    /** 正常求助 (问思路/概念)。 */
    NORMAL,

    /** 疑似直接索要答案/成稿 (家长 review 关注点)。 */
    ANSWER_SEEKING,
}

/**
 * 一次任务内的 AI 调用记录 (主文档 §3.5 `ai_call_log`，防作弊审计)。
 * **只记元数据**：任务 id + 时间 + 类别，不含 prompt 原文 (与陪伴 tab 一致的隐私取向)。
 */
data class TaskAiCall(
    val taskId: String,
    val timestamp: Long,
    val kind: AiCallKind,
)

/**
 * M5 任务上下文 seam。aistudy 学习 tab 借此感知"当前是否有任务在进行中"，
 * 以及把任务内的 AI 调用写进防作弊 log。
 *
 * v0.1 内存态 + 接口化 —— 真正的 family_task 存储/同步是 follow-up；
 * 这一层纯逻辑、可单测，先把"in_progress → 引导模式 + 调用 log"做透。
 */
interface StudyTaskContext {
    /** 当前进行中的任务；无则 null。仅 [StudyTaskStatus.IN_PROGRESS] 会出现在这里。 */
    val activeTask: StateFlow<StudyTask?>

    /** 设置/更新当前任务。传入非 IN_PROGRESS (或 null) 即视为"无进行中任务"。 */
    fun setActiveTask(task: StudyTask?)

    /** 记一条任务内 AI 调用 (防作弊 log)。 */
    fun logAiCall(call: TaskAiCall)

    /** 取某任务的 AI 调用 log。 */
    fun callLogFor(taskId: String): List<TaskAiCall>
}

@Singleton
class InMemoryStudyTaskContext @Inject constructor() : StudyTaskContext {
    private val _activeTask = MutableStateFlow<StudyTask?>(null)
    override val activeTask: StateFlow<StudyTask?> = _activeTask.asStateFlow()

    private val callLog = MutableStateFlow<List<TaskAiCall>>(emptyList())

    override fun setActiveTask(task: StudyTask?) {
        _activeTask.value = task?.takeIf { it.status == StudyTaskStatus.IN_PROGRESS }
    }

    override fun logAiCall(call: TaskAiCall) {
        callLog.update { it + call }
    }

    override fun callLogFor(taskId: String): List<TaskAiCall> =
        callLog.value.filter { it.taskId == taskId }
}
