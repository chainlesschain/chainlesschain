package com.chainlesschain.android.presentation.screens.progress

import androidx.lifecycle.ViewModel
import com.chainlesschain.android.task.LongRunningTask
import com.chainlesschain.android.task.LongTaskRegistry
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject

/**
 * M4 ProgressViewer ViewModel — 转发 [LongTaskRegistry.tasks] 给 UI，提供 dismiss/clearTerminal
 * 操作。
 */
@HiltViewModel
class ProgressViewerViewModel @Inject constructor(
    private val registry: LongTaskRegistry,
) : ViewModel() {

    val tasks: StateFlow<List<LongRunningTask>> = registry.tasks

    /** 用户长按 / swipe dismiss 单条记录（建议只对已终态项暴露 UI）。 */
    fun dismiss(id: String): Boolean = registry.remove(id)

    /** "清除已完成" — 一键清掉所有 Completed/Failed/Cancelled 项。 */
    fun clearTerminal(): Int = registry.clearTerminal()
}
