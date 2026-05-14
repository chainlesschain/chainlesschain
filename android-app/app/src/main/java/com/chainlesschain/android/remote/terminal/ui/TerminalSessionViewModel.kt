package com.chainlesschain.android.remote.terminal.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.terminal.TerminalRpcClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * 单 session 视图 ViewModel — 桥接 [TerminalRpcClient] 与 Compose UI。
 *
 * 启动时拉一次 [TerminalRpcClient.history] 把 ring buffer 全部 replay 到
 * WebView；同时订阅 stdout/exit SharedFlow，过滤到当前 sessionId 后 emit
 * 给 UI。UI 通过 [sendInput] / [sendResize] / [closeSession] 反向调用。
 */
@HiltViewModel
class TerminalSessionViewModel @Inject constructor(
    private val terminalRpc: TerminalRpcClient,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    val pcPeerId: String = savedStateHandle.get<String>("peerId") ?: ""
    val sessionId: String = savedStateHandle.get<String>("sessionId") ?: ""

    private val _state = MutableStateFlow(TerminalSessionUiState())
    val state: StateFlow<TerminalSessionUiState> = _state.asStateFlow()

    // Push stream of stdout payloads — UI collects + writes into WebView.
    // SharedFlow with replay=0 since the WebView is the long-term buffer.
    private val _stdoutToUi = MutableSharedFlow<String>(extraBufferCapacity = 256)
    val stdoutToUi: SharedFlow<String> = _stdoutToUi.asSharedFlow()

    // Exit event stream — UI shows the "[session exited]" banner.
    private val _exitToUi = MutableSharedFlow<TerminalRpcClient.ExitEvent>(extraBufferCapacity = 4)
    val exitToUi: SharedFlow<TerminalRpcClient.ExitEvent> = _exitToUi.asSharedFlow()

    @Volatile private var lastSeq: Long = 0

    init {
        terminalRpc.start()
        observePushEvents()
        backfillHistory()
    }

    private fun observePushEvents() {
        viewModelScope.launch {
            terminalRpc.observeStdout()
                .filter { it.sessionId == sessionId }
                .collect { evt ->
                    if (evt.seq > lastSeq) {
                        lastSeq = evt.seq
                        _stdoutToUi.tryEmit(evt.data)
                    }
                }
        }
        viewModelScope.launch {
            terminalRpc.observeExit()
                .filter { it.sessionId == sessionId }
                .collect { evt ->
                    _state.update { it.copy(alive = false, exitCode = evt.exitCode) }
                    _exitToUi.tryEmit(evt)
                }
        }
    }

    private fun backfillHistory() {
        viewModelScope.launch {
            terminalRpc.history(pcPeerId, sessionId, fromSeq = 0)
                .onSuccess { res ->
                    if (res.truncated) {
                        _stdoutToUi.tryEmit("[2m[history truncated — earlier output dropped][0m\r\n")
                    }
                    for (chunk in res.chunks) {
                        _stdoutToUi.tryEmit(chunk.data)
                        if (chunk.seq > lastSeq) lastSeq = chunk.seq
                    }
                    _state.update { it.copy(historyLoaded = true) }
                }
                .onFailure { e ->
                    _state.update { it.copy(error = "拉取历史失败: ${e.message}") }
                    Timber.w(e, "[TerminalSession] history fetch failed")
                }
        }
    }

    fun sendInput(data: String) {
        viewModelScope.launch {
            terminalRpc.stdin(pcPeerId, sessionId, data)
                .onFailure { e ->
                    val msg = e.message ?: ""
                    if (msg.contains("dangerous_keyword_blocked")) {
                        _state.update { it.copy(error = "该命令被桌面端拦截（高危关键字）") }
                    } else {
                        _state.update { it.copy(error = "stdin 失败: $msg") }
                    }
                }
        }
    }

    fun sendResize(cols: Int, rows: Int) {
        viewModelScope.launch {
            terminalRpc.resize(pcPeerId, sessionId, cols, rows)
        }
    }

    fun closeSession() {
        viewModelScope.launch {
            terminalRpc.close(pcPeerId, sessionId)
        }
    }

    fun clearError() {
        _state.update { it.copy(error = null) }
    }
}

data class TerminalSessionUiState(
    val historyLoaded: Boolean = false,
    val alive: Boolean = true,
    val exitCode: Int? = null,
    val error: String? = null,
)
