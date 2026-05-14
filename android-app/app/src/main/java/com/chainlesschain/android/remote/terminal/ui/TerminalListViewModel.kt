package com.chainlesschain.android.remote.terminal.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.terminal.TerminalRpcClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 远程终端会话列表 ViewModel — 显示桌面上当前 PtyManager 的所有 sessions，
 * 允许"+ 新会话"或点选已有会话进入 [TerminalSessionScreen]。
 *
 * 从 NavGraph 拿 `peerId` (已配对桌面)，与 RemoteOperateViewModel 同款。
 */
@HiltViewModel
class TerminalListViewModel @Inject constructor(
    private val terminalRpc: TerminalRpcClient,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    val pcPeerId: String = savedStateHandle.get<String>("peerId") ?: ""

    private val _state = MutableStateFlow(
        TerminalListState(loading = false, sessions = emptyList()),
    )
    val state: StateFlow<TerminalListState> = _state.asStateFlow()

    init {
        terminalRpc.start()
        refresh()
    }

    fun refresh() {
        if (pcPeerId.isEmpty()) {
            _state.update { it.copy(error = "未提供桌面 peerId") }
            return
        }
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            terminalRpc.list(pcPeerId)
                .onSuccess { rows ->
                    _state.update { it.copy(loading = false, sessions = rows) }
                }
                .onFailure { e ->
                    _state.update { it.copy(loading = false, error = e.message ?: "失败") }
                }
        }
    }

    fun createSession(shell: String) {
        if (pcPeerId.isEmpty()) return
        _state.update { it.copy(creating = true, error = null) }
        viewModelScope.launch {
            terminalRpc.create(pcPeerId, shell = shell)
                .onSuccess {
                    _state.update { it.copy(creating = false, lastCreatedId = it.lastCreatedId) }
                    refresh()
                }
                .onFailure { e ->
                    _state.update { it.copy(creating = false, error = e.message ?: "创建失败") }
                }
        }
    }

    fun closeSession(sessionId: String) {
        if (pcPeerId.isEmpty()) return
        viewModelScope.launch {
            terminalRpc.close(pcPeerId, sessionId)
            refresh()
        }
    }
}

data class TerminalListState(
    val loading: Boolean = false,
    val creating: Boolean = false,
    val sessions: List<TerminalRpcClient.SessionRow> = emptyList(),
    val lastCreatedId: String? = null,
    val error: String? = null,
)
