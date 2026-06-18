package com.chainlesschain.android.call

import android.content.Context
import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.remote.webrtc.WebRTCClient
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.Camera1Enumerator
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraEnumerator
import org.webrtc.CameraVideoCapturer
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * FAMILY-67 通话媒体控制器（WebRTC 实现，P1 音频 + P2 视频）。
 *
 * 独立媒体 PeerConnection（与消息 DataChannel PC 分开）。
 * - **音频**复用 [WebRTCClient.sharedFactory]（消息侧已建，无视频编解码工厂，够用）。
 * - **视频**需 EGL + 视频编解码工厂，消息侧 factory 没有 → 本类懒建一个独立的视频版
 *   [PeerConnectionFactory]（[PeerConnectionFactory.initialize] 全局只一次，已由 WebRTCClient 调过，
 *   故只 `builder()` 再造一个）。视频通话的 PC + 音轨 + 视频轨全部从该视频 factory 造。
 *
 * call:offer/answer/ice 经 [CallManager]（[CallMediaListener]）走信令中继；ICE 连通 → onMediaConnected
 * → ACTIVE。DTLS-SRTP 端到端加密。本地/远端视频轨经 [localVideoTrack]/[remoteVideoTrack] 暴露给 UI 渲染。
 */
@Singleton
class WebRtcCallMediaController @Inject constructor(
    @ApplicationContext private val context: Context,
    private val webRTCClient: WebRTCClient,
    private val didManager: DIDManager,
    private val audioRoute: AudioRouteController,
) : CallMediaController {

    @Volatile var listener: CallMediaListener? = null

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    @Volatile private var pc: PeerConnection? = null
    @Volatile private var audioSource: AudioSource? = null
    @Volatile private var audioTrack: AudioTrack? = null
    @Volatile private var callId: String? = null
    @Volatile private var currentMedia: CallMediaType = CallMediaType.AUDIO
    @Volatile private var remoteDescSet = false
    private val pendingIce = mutableListOf<IceCandidate>()

    // ---- 视频（P2，懒建，跨通话复用）----
    private val eglBase: EglBase by lazy { EglBase.create() }
    /** 视频版 factory：EGL + Default 编解码工厂。仅视频通话用。 */
    private val videoFactory: PeerConnectionFactory? by lazy { buildVideoFactory() }
    @Volatile private var videoSource: VideoSource? = null
    @Volatile private var videoTrack: VideoTrack? = null
    @Volatile private var capturer: CameraVideoCapturer? = null
    @Volatile private var surfaceHelper: SurfaceTextureHelper? = null
    @Volatile private var usingFrontCamera = true

    private val _localVideoTrack = MutableStateFlow<VideoTrack?>(null)
    val localVideoTrack: StateFlow<VideoTrack?> = _localVideoTrack.asStateFlow()
    private val _remoteVideoTrack = MutableStateFlow<VideoTrack?>(null)
    val remoteVideoTrack: StateFlow<VideoTrack?> = _remoteVideoTrack.asStateFlow()

    /** 供 UI [org.webrtc.SurfaceViewRenderer.init] 用的共享 EGL 上下文。 */
    fun eglContext(): EglBase.Context = eglBase.eglBaseContext

    override suspend fun startAsOfferer(callId: String, peerDid: String, media: CallMediaType) {
        if (!prepare(callId, peerDid, media)) return
        val conn = pc ?: return
        runCatching {
            val offer = conn.createSdp(offer = true)
            conn.setLocal(offer)
            listener?.onLocalSdp(callId, CallSignalTypes.OFFER, offer.description)
        }.onFailure { Timber.e(it, "[CallMedia] offer failed"); listener?.onMediaFailed(callId) }
    }

    override suspend fun startAsAnswerer(callId: String, peerDid: String, media: CallMediaType) {
        // 仅建好 PC + 本地轨，等对端 offer（onRemoteOffer）
        prepare(callId, peerDid, media)
    }

    override suspend fun onRemoteOffer(callId: String, sdp: String) {
        if (callId != this.callId) return
        val conn = pc ?: return
        runCatching {
            conn.setRemote(SessionDescription(SessionDescription.Type.OFFER, sdp))
            remoteDescSet = true
            drainPendingIce()
            val answer = conn.createSdp(offer = false)
            conn.setLocal(answer)
            listener?.onLocalSdp(callId, CallSignalTypes.ANSWER, answer.description)
        }.onFailure { Timber.e(it, "[CallMedia] answer failed"); listener?.onMediaFailed(callId) }
    }

    override suspend fun onRemoteAnswer(callId: String, sdp: String) {
        if (callId != this.callId) return
        val conn = pc ?: return
        runCatching {
            conn.setRemote(SessionDescription(SessionDescription.Type.ANSWER, sdp))
            remoteDescSet = true
            drainPendingIce()
        }.onFailure { Timber.e(it, "[CallMedia] setRemote answer failed"); listener?.onMediaFailed(callId) }
    }

    override suspend fun onRemoteIce(callId: String, candidate: String) {
        if (callId != this.callId) return
        val ice = parseIce(candidate) ?: return
        if (remoteDescSet) pc?.addIceCandidate(ice) else pendingIce.add(ice)
    }

    override fun setMuted(muted: Boolean) {
        audioTrack?.setEnabled(!muted)
    }

    override fun setSpeakerphone(on: Boolean) {
        audioRoute.setSpeaker(on)
    }

    /** P2：开/关本地摄像头（视频通话中）。 */
    fun setVideoEnabled(enabled: Boolean) {
        videoTrack?.setEnabled(enabled)
    }

    /** P2：前后摄像头切换。 */
    fun switchCamera() {
        capturer?.switchCamera(object : CameraVideoCapturer.CameraSwitchHandler {
            override fun onCameraSwitchDone(isFront: Boolean) { usingFrontCamera = isFront }
            override fun onCameraSwitchError(error: String?) { Timber.w("[CallMedia] switchCamera error: $error") }
        })
    }

    override fun close() {
        runCatching { capturer?.stopCapture() }
        runCatching { capturer?.dispose() }
        runCatching { surfaceHelper?.dispose() }
        runCatching { videoTrack?.dispose() }
        runCatching { videoSource?.dispose() }
        runCatching { pc?.close() }
        runCatching { pc?.dispose() }
        runCatching { audioTrack?.dispose() }
        runCatching { audioSource?.dispose() }
        runCatching { audioRoute.stopCallAudio() }
        pc = null; audioTrack = null; audioSource = null
        capturer = null; surfaceHelper = null; videoTrack = null; videoSource = null
        _localVideoTrack.value = null; _remoteVideoTrack.value = null
        callId = null; remoteDescSet = false; pendingIce.clear()
        Timber.i("[CallMedia] closed")
    }

    // ---- 内部 ----

    private suspend fun prepare(callId: String, peerDid: String, media: CallMediaType): Boolean {
        this.callId = callId
        this.currentMedia = media
        remoteDescSet = false
        pendingIce.clear()

        val video = media == CallMediaType.VIDEO
        val factory = if (video) videoFactory else webRTCClient.sharedFactory()
        if (factory == null) {
            Timber.e("[CallMedia] factory null (video=$video) — message stack not initialized")
            listener?.onMediaFailed(callId)
            return false
        }
        val myDid = runCatching { didManager.getCurrentDID() }.getOrNull() ?: ""
        val iceServers = runCatching { webRTCClient.callIceServers(myDid, peerDid) }.getOrDefault(emptyList())
        val config = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        val conn = factory.createPeerConnection(config, observer)
        if (conn == null) {
            listener?.onMediaFailed(callId)
            return false
        }
        pc = conn

        // 本地音轨（音视频都有）
        audioSource = factory.createAudioSource(MediaConstraints())
        audioTrack = factory.createAudioTrack("call-audio", audioSource).apply { setEnabled(true) }
        conn.addTrack(audioTrack, listOf("call-stream"))
        audioRoute.startCallAudio()

        // 本地视频轨（仅视频通话）
        if (video) {
            runCatching { setupLocalVideo(factory, conn) }
                .onFailure { Timber.e(it, "[CallMedia] local video setup failed") }
        }

        Timber.i("[CallMedia] prepared PC ${if (video) "A/V" else "audio"} (call=$callId, ice=${iceServers.size})")
        return true
    }

    private fun setupLocalVideo(factory: PeerConnectionFactory, conn: PeerConnection) {
        val cap = createCameraCapturer() ?: run {
            Timber.w("[CallMedia] no camera capturer")
            return
        }
        capturer = cap
        val helper = SurfaceTextureHelper.create("CallCaptureThread", eglBase.eglBaseContext)
        surfaceHelper = helper
        val source = factory.createVideoSource(false)
        videoSource = source
        cap.initialize(helper, context, source.capturerObserver)
        cap.startCapture(1280, 720, 30)
        val track = factory.createVideoTrack("call-video", source).apply { setEnabled(true) }
        videoTrack = track
        conn.addTrack(track, listOf("call-stream"))
        _localVideoTrack.value = track
    }

    private fun createCameraCapturer(): CameraVideoCapturer? {
        val enumerator: CameraEnumerator =
            if (Camera2Enumerator.isSupported(context)) Camera2Enumerator(context) else Camera1Enumerator(true)
        val names = enumerator.deviceNames
        // 优先前置
        names.firstOrNull { enumerator.isFrontFacing(it) }?.let {
            usingFrontCamera = true
            return enumerator.createCapturer(it, null)
        }
        names.firstOrNull()?.let {
            usingFrontCamera = false
            return enumerator.createCapturer(it, null)
        }
        return null
    }

    private fun buildVideoFactory(): PeerConnectionFactory? = runCatching {
        // initialize 已由 WebRTCClient 全局调过（sharedFactory != null 即证）；这里只再造一个带视频编解码的 factory。
        val encoder = DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true)
        val decoder = DefaultVideoDecoderFactory(eglBase.eglBaseContext)
        PeerConnectionFactory.builder()
            .setOptions(PeerConnectionFactory.Options())
            .setVideoEncoderFactory(encoder)
            .setVideoDecoderFactory(decoder)
            .createPeerConnectionFactory()
    }.onFailure { Timber.e(it, "[CallMedia] buildVideoFactory failed") }.getOrNull()

    private fun drainPendingIce() {
        if (pendingIce.isEmpty()) return
        pendingIce.forEach { pc?.addIceCandidate(it) }
        pendingIce.clear()
    }

    private val observer = object : PeerConnection.Observer {
        override fun onIceCandidate(c: IceCandidate) {
            val id = callId ?: return
            listener?.onLocalIce(id, serializeIce(c))
        }

        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
            Timber.d("[CallMedia] ICE state: $state")
            val id = callId ?: return
            when (state) {
                PeerConnection.IceConnectionState.CONNECTED,
                PeerConnection.IceConnectionState.COMPLETED -> listener?.onMediaConnected(id)
                PeerConnection.IceConnectionState.FAILED -> listener?.onMediaFailed(id)
                // 通话中网络瞬断 → 进重连宽限期（WebRTC 可能自行 ICE restart 恢复→回 CONNECTED）
                PeerConnection.IceConnectionState.DISCONNECTED -> listener?.onMediaDisconnected(id)
                else -> {}
            }
        }

        override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {
            val track = receiver?.track()
            Timber.d("[CallMedia] remote track added: ${track?.kind()}")
            if (track is VideoTrack) {
                track.setEnabled(true)
                _remoteVideoTrack.value = track
            }
            // 远端音轨经 AudioDeviceModule 自动播放，无需手动处理。
        }

        // 其余回调无需处理。
        override fun onSignalingChange(s: PeerConnection.SignalingState?) {}
        override fun onIceConnectionReceivingChange(b: Boolean) {}
        override fun onIceGatheringChange(s: PeerConnection.IceGatheringState?) {}
        override fun onIceCandidatesRemoved(c: Array<out IceCandidate>?) {}
        override fun onAddStream(s: MediaStream?) {}
        override fun onRemoveStream(s: MediaStream?) {}
        override fun onDataChannel(d: DataChannel?) {}
        override fun onRenegotiationNeeded() {}
    }

    private fun mediaConstraints(): MediaConstraints = MediaConstraints().apply {
        mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
        mandatory.add(
            MediaConstraints.KeyValuePair(
                "OfferToReceiveVideo",
                if (currentMedia == CallMediaType.VIDEO) "true" else "false",
            ),
        )
    }

    private fun serializeIce(c: IceCandidate): String = JSONObject().apply {
        put("sdpMid", c.sdpMid)
        put("sdpMLineIndex", c.sdpMLineIndex)
        put("candidate", c.sdp)
    }.toString()

    private fun parseIce(raw: String): IceCandidate? = runCatching {
        val o = JSONObject(raw)
        IceCandidate(o.optString("sdpMid"), o.optInt("sdpMLineIndex"), o.optString("candidate"))
    }.getOrNull()

    // ---- suspend SDP 包装（WebRTC 回调 → suspend）----

    private suspend fun PeerConnection.createSdp(offer: Boolean): SessionDescription =
        suspendCancellableCoroutine { cont ->
            val obs = object : SdpObserver {
                override fun onCreateSuccess(sdp: SessionDescription) { if (cont.isActive) cont.resume(sdp) }
                override fun onCreateFailure(err: String?) { if (cont.isActive) cont.resumeWithException(RuntimeException("createSdp: $err")) }
                override fun onSetSuccess() {}
                override fun onSetFailure(err: String?) {}
            }
            if (offer) createOffer(obs, mediaConstraints()) else createAnswer(obs, mediaConstraints())
        }

    private suspend fun PeerConnection.setLocal(sdp: SessionDescription) =
        suspendCancellableCoroutine<Unit> { cont ->
            setLocalDescription(object : SdpObserver {
                override fun onCreateSuccess(d: SessionDescription?) {}
                override fun onCreateFailure(e: String?) {}
                override fun onSetSuccess() { if (cont.isActive) cont.resume(Unit) }
                override fun onSetFailure(e: String?) { if (cont.isActive) cont.resumeWithException(RuntimeException("setLocal: $e")) }
            }, sdp)
        }

    private suspend fun PeerConnection.setRemote(sdp: SessionDescription) =
        suspendCancellableCoroutine<Unit> { cont ->
            setRemoteDescription(object : SdpObserver {
                override fun onCreateSuccess(d: SessionDescription?) {}
                override fun onCreateFailure(e: String?) {}
                override fun onSetSuccess() { if (cont.isActive) cont.resume(Unit) }
                override fun onSetFailure(e: String?) { if (cont.isActive) cont.resumeWithException(RuntimeException("setRemote: $e")) }
            }, sdp)
        }
}
