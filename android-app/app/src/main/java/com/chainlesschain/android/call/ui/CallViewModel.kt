package com.chainlesschain.android.call.ui

import androidx.lifecycle.ViewModel
import com.chainlesschain.android.call.CallManager
import com.chainlesschain.android.call.CallMediaType
import com.chainlesschain.android.call.CallSession
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject

/**
 * FAMILY-67 通话 UI 的薄 ViewModel —— 转发 [CallManager]（@Singleton）的状态与动作。
 *
 * 状态共享靠单例：来电浮层与聊天页拨号按钮各自 hiltViewModel() 得到不同 VM 实例，
 * 但都注入同一个 [CallManager] 单例，故 [callState] 一致。
 */
@HiltViewModel
class CallViewModel @Inject constructor(
    private val callManager: CallManager,
) : ViewModel() {

    val callState: StateFlow<CallSession?> = callManager.callState

    fun startCall(peerDid: String, media: CallMediaType = CallMediaType.AUDIO) =
        callManager.startCall(peerDid, media)

    fun accept() = callManager.accept()
    fun reject() = callManager.reject()
    fun hangup() = callManager.hangup()
    fun setMuted(muted: Boolean) = callManager.setMuted(muted)
    fun setSpeaker(on: Boolean) = callManager.setSpeaker(on)
}
