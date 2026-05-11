package com.chainlesschain.android.task

/**
 * 桌面侧长时任务的本地快照（M4 ProgressViewer）。
 *
 * 桌面端 Cowork orchestrator / Workflow runner / Skill executor 在任务期间通过
 * `task.update` reverse RPC 推快照过来；Android [com.chainlesschain.android.task.LongTaskRegistry]
 * 累积到 StateFlow，[com.chainlesschain.android.presentation.screens.progress.ProgressViewerScreen]
 * 订阅并渲染。
 *
 * 字段简化：v1.0 不持久化，仅内存中维护；进程被杀后丢失。v1.1 可加 Room 落盘。
 */
data class LongRunningTask(
    /** 任务唯一 ID（桌面侧生成，跨更新稳定）。 */
    val id: String,

    /** UI 友好标题（如 "Cowork: 拆解需求文档"）。 */
    val title: String,

    /** 可选副标题/进度细节描述（"正在执行第 3/7 步：编辑 README"）。 */
    val description: String? = null,

    /**
     * 进度：[0.0f, 1.0f]，null 表示 indeterminate（旋转进度条）。
     * 越界值会被 [LongTaskRegistry] clamp。
     */
    val progress: Float? = null,

    /** 状态。从 Pending → Running → Completed / Failed / Cancelled。 */
    val state: State = State.Running,

    /** 任务创建时间（首次进入 registry）。 */
    val createdAt: Long,

    /** 最近一次更新时间。 */
    val updatedAt: Long,

    /** Failed / Cancelled 时的错误/原因；其他状态 null。 */
    val errorMessage: String? = null,

    /** 任务类别，用于 UI 分组 / 图标。可选；默认 "generic"。 */
    val category: String = "generic",
) {
    enum class State { Pending, Running, Completed, Failed, Cancelled }

    /** 终态：不会再更新。 */
    fun isTerminal(): Boolean = state == State.Completed ||
        state == State.Failed ||
        state == State.Cancelled
}
