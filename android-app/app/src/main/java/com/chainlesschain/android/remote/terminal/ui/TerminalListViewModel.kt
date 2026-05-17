package com.chainlesschain.android.remote.terminal.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.p2p.pairing.PairedDesktopsStore
import com.chainlesschain.android.remote.RemoteConnectionManager
import com.chainlesschain.android.remote.terminal.TerminalRpcClient
import com.chainlesschain.android.remote.webrtc.WebRTCClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * 远程终端会话列表 ViewModel — 显示桌面上当前 PtyManager 的所有 sessions，
 * 允许"+ 新会话"或点选已有会话进入 [TerminalSessionScreen]。
 *
 * 从 NavGraph 拿 `peerId` (已配对桌面)，与 RemoteOperateViewModel 同款。
 *
 * Plan A.1 — 进入屏幕时若 DC 未 ready 主动调 [RemoteConnectionManager.connect]
 * 触发 WebRTC 握手。握手成功后 [SignalingRpcClient.invoke] 自然走 DC 直连，绕开
 * signaling 4 跳链路的 NAT idle 间歇断。期间命令仍能走 signaling fallback。
 */
@HiltViewModel
class TerminalListViewModel @Inject constructor(
    private val terminalRpc: TerminalRpcClient,
    private val remoteConnectionManager: RemoteConnectionManager,
    private val webRTCClient: WebRTCClient,
    private val pairedDesktopsStore: PairedDesktopsStore,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    val pcPeerId: String = savedStateHandle.get<String>("peerId") ?: ""

    /**
     * Plan A.1 — DC 是否真 OPEN，UI 用来显示 "P2P 直连/中继" 标识。
     * `webRTCClient.dataChannelReady` 是 connectionState == READY 的 derived flow。
     */
    val dataChannelReady: StateFlow<Boolean> = webRTCClient.dataChannelReady

    private val _state = MutableStateFlow(
        TerminalListState(loading = false, sessions = emptyList()),
    )
    val state: StateFlow<TerminalListState> = _state.asStateFlow()

    init {
        terminalRpc.start()
        triggerDataChannelHandshake()
        refresh()
    }

    /**
     * Plan A.1 — DC 未 ready 时异步触发 WebRTC handshake；ready 或 pcPeerId
     * 空时跳过。失败 silent（命令仍能走 signaling fallback）；UI 通过
     * [dataChannelReady] StateFlow 自然反映状态。
     */
    private fun triggerDataChannelHandshake() {
        if (pcPeerId.isEmpty()) return
        if (webRTCClient.dataChannelReady.value) {
            Timber.d("[TerminalListVM] DC already ready, skip handshake")
            return
        }
        // pcDID 在 P2PClient.connect 里仅作 metadata 存到 PeerInfo（不影响 WebRTC
        // handshake — 那里只用 pcPeerId）。PairedDesktop 当前不存 DID，所以构造
        // 占位 did:peer:<peerId>。后续 PairedDesktop 加 did 字段后改用真实值。
        val pcDID = pairedDesktopsStore.devices.value
            .firstOrNull { it.pcPeerId == pcPeerId }
            ?.let { "did:peer:$pcPeerId" }
        if (pcDID == null) {
            Timber.w("[TerminalListVM] pcPeerId=$pcPeerId not in PairedDesktopsStore, can't trigger DC handshake")
            return
        }
        viewModelScope.launch {
            Timber.i("[TerminalListVM] triggering DC handshake to $pcPeerId / $pcDID")
            remoteConnectionManager.connect(pcPeerId, pcDID)
                .onSuccess { Timber.i("[TerminalListVM] DC handshake initiated; ICE negotiation runs async") }
                .onFailure { e -> Timber.w(e, "[TerminalListVM] DC handshake failed; signaling fallback in effect") }
        }
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

    fun createSession(shell: String, cwd: String? = null) {
        if (pcPeerId.isEmpty()) return
        _state.update { it.copy(creating = true, error = null) }
        viewModelScope.launch {
            terminalRpc.create(pcPeerId, shell = shell, cwd = cwd)
                .onSuccess { created ->
                    // Plan A.1 v5.0.3.53-fix7 真机 E2E 真因：原 `it.copy(lastCreatedId = it.lastCreatedId)`
                    // 把 onSuccess 闭包参数 `it`（CreatedSession）shadow 了，又用 state.it.lastCreatedId
                    // 拿 state 现存值 → state.lastCreatedId 永远不更新 → UI LaunchedEffect 不触发
                    // navigation → 用户停在 List 屏看不到新 session 的 WebView。
                    // 用 named param `created.sessionId` 才正确。
                    timber.log.Timber.i(
                        "[TerminalListVM] createSession ✓ sessionId=%s pid=%d",
                        created.sessionId,
                        created.pid,
                    )
                    _state.update { it.copy(creating = false, lastCreatedId = created.sessionId) }
                    refresh()
                }
                .onFailure { e ->
                    timber.log.Timber.w(e, "[TerminalListVM] createSession failed")
                    _state.update { it.copy(creating = false, error = e.message ?: "创建失败") }
                }
        }
    }

    /** Plan A.1 fix7: 调用方触发 navigation 后调此方法清掉 lastCreatedId，避免下次进 list 屏重复跳转。 */
    fun consumeLastCreatedId() {
        _state.update { it.copy(lastCreatedId = null) }
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
