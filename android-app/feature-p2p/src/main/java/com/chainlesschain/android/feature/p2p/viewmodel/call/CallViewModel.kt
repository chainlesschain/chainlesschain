package com.chainlesschain.android.feature.p2p.viewmodel.call

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.p2p.call.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import org.webrtc.IceCandidate
import org.webrtc.SessionDescription
import timber.log.Timber
import javax.inject.Inject

/**
 * 通话ViewModel
 *
 * 管理通话状态和WebRTC交互
 *
 * 功能：
 * - 发起通话
 * - 接听/拒绝通话
 * - 通话控制（静音、切换摄像头等）
 * - 信令处理
 *
 * @since v0.32.0
 */
@HiltViewModel
class CallViewModel @Inject constructor(
    private val webRTCManager: WebRTCManager,
    private val signalingManager: SignalingManager
) : ViewModel() {

    // UI状态
    private val _uiState = MutableStateFlow(CallUiState())
    val uiState: StateFlow<CallUiState> = _uiState.asStateFlow()

    // 事件流
    private val _eventFlow = MutableSharedFlow<CallEvent>()
    val eventFlow: SharedFlow<CallEvent> = _eventFlow.asSharedFlow()

    // 当前通话对象DID
    private var currentPeerDid: String = ""

    init {
        // 监听通话状态
        viewModelScope.launch {
            webRTCManager.callState.collect { state ->
                _uiState.update { it.copy(callState = state) }

                when (state) {
                    is CallState.Error -> {
                        _eventFlow.emit(CallEvent.ShowError(state.message))
                    }
                    is CallState.Connected -> {
                        _eventFlow.emit(CallEvent.CallConnected)
                    }
                    is CallState.Ended -> {
                        _eventFlow.emit(CallEvent.CallEnded)
                    }
                    else -> {}
                }
            }
        }

        // 监听ICE候选
        viewModelScope.launch {
            webRTCManager.iceCandidate.collect { candidate ->
                if (currentPeerDid.isNotEmpty()) {
                    signalingManager.sendIceCandidate(currentPeerDid, candidate)
                }
            }
        }

        // 监听信令事件
        viewModelScope.launch {
            webRTCManager.signalingEvent.collect { event ->
                when (event) {
                    is SignalingEvent.SendOffer -> {
                        signalingManager.sendOffer(event.targetDid, event.sdp)
                    }
                    is SignalingEvent.SendAnswer -> {
                        signalingManager.sendAnswer(event.targetDid, event.sdp)
                    }
                    is SignalingEvent.SendIceCandidate -> {
                        signalingManager.sendIceCandidate(event.targetDid, event.candidate)
                    }
                }
            }
        }

        // 监听收到的信令消息
        viewModelScope.launch {
            signalingManager.signalingMessage.collect { message ->
                handleIncomingSignaling(message)
            }
        }
    }

    /**
     * 初始化WebRTC
     */
    fun initialize() {
        webRTCManager.initialize()
    }

    /**
     * 发起通话
     *
     * @param targetDid 目标用户DID
     * @param isVideoCall 是否视频通话
     */
    fun initiateCall(targetDid: String, isVideoCall: Boolean) {
        Timber.d("Initiating call to $targetDid, video=$isVideoCall")

        currentPeerDid = targetDid

        _uiState.update {
            it.copy(
                isVideoCall = isVideoCall,
                peerDid = targetDid,
                isOutgoingCall = true
            )
        }

        viewModelScope.launch {
            try {
                webRTCManager.initiateCall(targetDid, isVideoCall)
            } catch (e: Exception) {
                Timber.e(e, "Failed to initiate call")
                _eventFlow.emit(CallEvent.ShowError(e.message ?: "Failed to start call"))
            }
        }
    }

    /**
     * 接听通话
     */
    fun acceptCall() {
        Timber.d("Accepting call from $currentPeerDid")

        viewModelScope.launch {
            try {
                _uiState.update { it.copy(isInCall = true) }
                _eventFlow.emit(CallEvent.CallAccepted)
            } catch (e: Exception) {
                Timber.e(e, "Failed to accept call")
                _eventFlow.emit(CallEvent.ShowError(e.message ?: "Failed to accept call"))
            }
        }
    }

    /**
     * 拒绝通话
     */
    fun rejectCall(reason: String = "Rejected") {
        Timber.d("Rejecting call from $currentPeerDid: $reason")

        viewModelScope.launch {
            try {
                signalingManager.sendReject(currentPeerDid, reason)
                webRTCManager.endCall()
                _eventFlow.emit(CallEvent.CallRejected)
            } catch (e: Exception) {
                Timber.e(e, "Failed to reject call")
            }
        }
    }

    /**
     * 结束通话
     */
    fun endCall() {
        Timber.d("Ending call with $currentPeerDid")

        viewModelScope.launch {
            try {
                if (currentPeerDid.isNotEmpty()) {
                    signalingManager.sendHangup(currentPeerDid)
                }
                webRTCManager.endCall()
                _uiState.update { CallUiState() } // 重置状态
                currentPeerDid = ""
            } catch (e: Exception) {
                Timber.e(e, "Failed to end call")
            }
        }
    }

    /**
     * 切换麦克风静音
     */
    fun toggleMicrophone() {
        val newState = !_uiState.value.isMicrophoneMuted
        webRTCManager.toggleMicrophone(newState)
        _uiState.update { it.copy(isMicrophoneMuted = newState) }
    }

    /**
     * 切换扬声器
     */
    fun toggleSpeaker() {
        val newState = !_uiState.value.isSpeakerOn
        webRTCManager.toggleSpeaker(newState)
        _uiState.update { it.copy(isSpeakerOn = newState) }
    }

    /**
     * 切换摄像头
     */
    fun switchCamera() {
        webRTCManager.switchCamera()
        _uiState.update { it.copy(isFrontCamera = !it.isFrontCamera) }
    }

    /**
     * 处理收到的信令消息
     */
    private fun handleIncomingSignaling(message: SignalingMessage) {
        viewModelScope.launch {
            try {
                when (message.type) {
                    SignalingType.OFFER -> {
                        // 收到通话请求
                        val offerData = kotlinx.serialization.json.Json.decodeFromString<SignalingData.Offer>(message.data)
                        val sdp = SessionDescription(
                            SessionDescription.Type.fromCanonicalForm(offerData.type),
                            offerData.sdp
                        )

                        currentPeerDid = message.fromDid
                        _uiState.update {
                            it.copy(
                                peerDid = message.fromDid,
                                isVideoCall = true, // TODO: 从信令中识别
                                isOutgoingCall = false,
                                isIncomingCall = true
                            )
                        }

                        _eventFlow.emit(CallEvent.IncomingCall(message.fromDid))

                        // 自动处理Offer（如果已接听）
                        if (_uiState.value.isInCall) {
                            webRTCManager.handleOffer(message.fromDid, sdp, _uiState.value.isVideoCall)
                        }
                    }

                    SignalingType.ANSWER -> {
                        // 收到应答
                        val answerData = kotlinx.serialization.json.Json.decodeFromString<SignalingData.Answer>(message.data)
                        val sdp = SessionDescription(
                            SessionDescription.Type.fromCanonicalForm(answerData.type),
                            answerData.sdp
                        )
                        webRTCManager.handleAnswer(sdp)
                    }

                    SignalingType.ICE_CANDIDATE -> {
                        // 收到ICE候选
                        val candidateData = kotlinx.serialization.json.Json.decodeFromString<SignalingData.IceCandidate>(message.data)
                        val candidate = IceCandidate(
                            candidateData.sdpMid,
                            candidateData.sdpMLineIndex,
                            candidateData.sdp
                        )
                        webRTCManager.handleIceCandidate(candidate)
                    }

                    SignalingType.HANGUP -> {
                        // 对方挂断
                        webRTCManager.endCall()
                        _eventFlow.emit(CallEvent.CallEnded)
                    }

                    SignalingType.REJECT -> {
                        // 对方拒绝
                        val rejectData = kotlinx.serialization.json.Json.decodeFromString<SignalingData.Reject>(message.data)
                        webRTCManager.endCall()
                        _eventFlow.emit(CallEvent.ShowError("Call rejected: ${rejectData.reason}"))
                    }
                }
            } catch (e: Exception) {
                Timber.e(e, "Failed to handle signaling message")
                _eventFlow.emit(CallEvent.ShowError(e.message ?: "Signaling error"))
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        viewModelScope.launch {
            webRTCManager.dispose()
        }
    }
}

/**
 * 通话UI状态
 */
data class CallUiState(
    val callState: CallState = CallState.Ended,
    val peerDid: String = "",
    val isVideoCall: Boolean = false,
    val isOutgoingCall: Boolean = false,
    val isIncomingCall: Boolean = false,
    val isInCall: Boolean = false,
    val isMicrophoneMuted: Boolean = false,
    val isSpeakerOn: Boolean = true,
    val isFrontCamera: Boolean = true,
    val callDuration: Long = 0L
)

/**
 * 通话事件
 */
sealed class CallEvent {
    /** 显示错误 */
    data class ShowError(val message: String) : CallEvent()

    /** 来电 */
    data class IncomingCall(val fromDid: String) : CallEvent()

    /** 通话已连接 */
    object CallConnected : CallEvent()

    /** 通话已结束 */
    object CallEnded : CallEvent()

    /** 通话已接听 */
    object CallAccepted : CallEvent()

    /** 通话已拒绝 */
    object CallRejected : CallEvent()
}
