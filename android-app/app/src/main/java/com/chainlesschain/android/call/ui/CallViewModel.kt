package com.chainlesschain.android.call.ui

import androidx.lifecycle.ViewModel
import com.chainlesschain.android.call.CallManager
import com.chainlesschain.android.call.CallMediaType
import com.chainlesschain.android.call.CallSession
import com.chainlesschain.android.call.WebRtcCallMediaController
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import org.webrtc.EglBase
import org.webrtc.VideoTrack
import javax.inject.Inject

/**
 * FAMILY-67 通话 UI 的薄 ViewModel —— 转发 [CallManager]（@Singleton）的状态与动作，
 * 视频轨/EGL 直接取自 [WebRtcCallMediaController]（同 @Singleton）。
 *
 * 状态共享靠单例：来电浮层与聊天页拨号按钮各自 hiltViewModel() 得到不同 VM 实例，
 * 但都注入同一组单例，故状态一致。
 */
@HiltViewModel
class CallViewModel @Inject constructor(
    private val callManager: CallManager,
    private val mediaController: WebRtcCallMediaController,
) : ViewModel() {

    val callState: StateFlow<CallSession?> = callManager.callState

    // 视频（P2）
    val localVideoTrack: StateFlow<VideoTrack?> = mediaController.localVideoTrack
    val remoteVideoTrack: StateFlow<VideoTrack?> = mediaController.remoteVideoTrack
    fun eglContext(): EglBase.Context = mediaController.eglContext()

    fun startCall(peerDid: String, media: CallMediaType = CallMediaType.AUDIO) =
        callManager.startCall(peerDid, media)

    fun accept() = callManager.accept()
    fun reject() = callManager.reject()
    fun hangup() = callManager.hangup()
    fun setMuted(muted: Boolean) = callManager.setMuted(muted)
    fun setSpeaker(on: Boolean) = callManager.setSpeaker(on)
    fun switchCamera() = mediaController.switchCamera()
    fun setVideoEnabled(enabled: Boolean) = mediaController.setVideoEnabled(enabled)
}
