package com.chainlesschain.android.remote.call

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.webrtc.CallKind
import com.chainlesschain.android.remote.webrtc.CallRole
import com.chainlesschain.android.remote.webrtc.FamilyCallEvent
import com.chainlesschain.android.remote.webrtc.FamilyCallRpcClient
import com.chainlesschain.android.remote.webrtc.FamilyCallType
import com.chainlesschain.android.remote.webrtc.UrgentCallQuota
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import timber.log.Timber

/** 通话 UI 状态（FAMILY-37）。 */
sealed interface FamilyCallUiState {
    data object Idle : FamilyCallUiState

    /** 本端主叫，已发 invite，等对端 accept。 */
    data class Outgoing(
        val callId: String,
        val callKind: CallKind,
        val targetPeerId: String,
    ) : FamilyCallUiState

    /** 收到对端来电（孩子端 ChildIncomingCallScreen 渲染）。 */
    data class Incoming(
        val callId: String,
        val fromPeerId: String,
        val callKind: CallKind,
        val inviterRole: CallRole?,
    ) : FamilyCallUiState

    /** 通话中。 */
    data class Connected(val callId: String, val callKind: CallKind) : FamilyCallUiState

    /** 已结束（对端 reject/hangup 或本端挂断）。 */
    data class Ended(val callId: String, val reason: String? = null) : FamilyCallUiState

    data class Error(val message: String) : FamilyCallUiState
}

/**
 * 通话 ViewModel（FAMILY-37）。驱动 ParentCallScreen / ChildIncomingCallScreen。
 *
 * 订阅 [FamilyCallRpcClient.observeCallEvents] → 折射 [FamilyCallUiState] 状态机；
 * 出向动作委托 FamilyCallRpcClient（已含 FAMILY-32 权限闸 + FAMILY-36 强接通配额降级）。
 * 强接通配额剩余 [urgentQuotaRemaining] 供 parent UI 展示。
 *
 * 媒体接通（accept 后调 WebRTCClient.connect(isInitiator=inviterRole) + addTrack）属真实
 * call 流编排，留后续；本 VM 管控制面状态 + 动作。
 */
@HiltViewModel
class FamilyCallViewModel @Inject constructor(
    private val familyCall: FamilyCallRpcClient,
    private val urgentCallQuota: UrgentCallQuota,
) : ViewModel() {

    private val _state = MutableStateFlow<FamilyCallUiState>(FamilyCallUiState.Idle)
    val state: StateFlow<FamilyCallUiState> = _state.asStateFlow()

    init {
        familyCall.start()
        viewModelScope.launch {
            familyCall.observeCallEvents().collect { reduce(it) }
        }
    }

    private fun reduce(event: FamilyCallEvent) {
        _state.value = when (event.type) {
            FamilyCallType.INVITE,
            FamilyCallType.SILENT_OBSERVE,
            FamilyCallType.URGENT_FORCE,
            ->
                FamilyCallUiState.Incoming(
                    callId = event.callId,
                    fromPeerId = event.fromPeerId.orEmpty(),
                    callKind = event.callKind ?: CallKind.AUDIO,
                    inviterRole = event.inviterRole,
                )

            FamilyCallType.ACCEPT -> {
                val cur = _state.value
                if (cur is FamilyCallUiState.Outgoing && cur.callId == event.callId) {
                    FamilyCallUiState.Connected(cur.callId, cur.callKind)
                } else {
                    cur
                }
            }

            FamilyCallType.REJECT -> FamilyCallUiState.Ended(event.callId, event.reason ?: "rejected")
            FamilyCallType.HANGUP -> FamilyCallUiState.Ended(event.callId, "hangup")
        }
    }

    // ─── 出向动作 ───

    fun startCall(targetPeerId: String, targetDid: String, callKind: CallKind) {
        viewModelScope.launch {
            familyCall.invite(targetPeerId, targetDid, callKind)
                .onSuccess { callId -> _state.value = FamilyCallUiState.Outgoing(callId, callKind, targetPeerId) }
                .onFailure { _state.value = FamilyCallUiState.Error(it.message ?: "invite failed") }
        }
    }

    fun silentObserve(targetPeerId: String, targetDid: String) {
        viewModelScope.launch {
            familyCall.silentObserve(targetPeerId, targetDid)
                .onSuccess { callId ->
                    _state.value = FamilyCallUiState.Outgoing(callId, CallKind.SILENT_OBSERVE, targetPeerId)
                }
                .onFailure { _state.value = FamilyCallUiState.Error(it.message ?: "silent observe failed") }
        }
    }

    fun urgentForce(targetPeerId: String, targetDid: String) {
        viewModelScope.launch {
            // urgentForce 内部超额会自动降级为 AUDIO invite；callKind 以返回前的意图记 URGENT。
            familyCall.urgentForce(targetPeerId, targetDid)
                .onSuccess { callId -> _state.value = FamilyCallUiState.Outgoing(callId, CallKind.URGENT, targetPeerId) }
                .onFailure { _state.value = FamilyCallUiState.Error(it.message ?: "urgent force failed") }
        }
    }

    /** 接受当前来电（Incoming → Connected）。 */
    fun acceptIncoming() {
        val cur = _state.value as? FamilyCallUiState.Incoming ?: return
        viewModelScope.launch {
            familyCall.accept(cur.fromPeerId, cur.callId)
                .onSuccess { _state.value = FamilyCallUiState.Connected(cur.callId, cur.callKind) }
                .onFailure { _state.value = FamilyCallUiState.Error(it.message ?: "accept failed") }
        }
    }

    fun rejectIncoming(reason: String? = null) {
        val cur = _state.value as? FamilyCallUiState.Incoming ?: return
        viewModelScope.launch {
            familyCall.reject(cur.fromPeerId, cur.callId, reason)
            _state.value = FamilyCallUiState.Ended(cur.callId, reason ?: "rejected")
        }
    }

    fun hangup(targetPeerId: String) {
        val callId = when (val cur = _state.value) {
            is FamilyCallUiState.Outgoing -> cur.callId
            is FamilyCallUiState.Connected -> cur.callId
            is FamilyCallUiState.Incoming -> cur.callId
            else -> null
        } ?: return
        viewModelScope.launch {
            familyCall.hangup(targetPeerId, callId)
            _state.value = FamilyCallUiState.Ended(callId, "hangup")
        }
    }

    fun dismiss() {
        _state.value = FamilyCallUiState.Idle
    }

    /** parent UI 展示：该孩子今日强接通剩余次数（FAMILY-36）。 */
    fun urgentQuotaRemaining(targetDid: String): Int =
        urgentCallQuota.remaining(targetDid, System.currentTimeMillis())

    override fun onCleared() {
        familyCall.stop()
        super.onCleared()
    }
}
