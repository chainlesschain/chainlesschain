package com.chainlesschain.android.feature.p2p.call

import android.content.Context
import io.getstream.webrtc.android.ktx.ConstraintsBuilder
import io.getstream.webrtc.android.ktx.StreamPeerConnectionFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import org.webrtc.*
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * WebRTC管理器
 *
 * 负责管理WebRTC连接、音视频流、信令处理等
 *
 * 功能：
 * - PeerConnection管理
 * - 音视频轨道管理
 * - 信令交换（Offer/Answer/ICE）
 * - 通话状态管理
 *
 * @since v0.32.0
 */
@Singleton
class WebRTCManager @Inject constructor(
    private val context: Context
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // PeerConnectionFactory（WebRTC核心工厂）
    private var peerConnectionFactory: StreamPeerConnectionFactory? = null

    // PeerConnection实例
    private var peerConnection: PeerConnection? = null

    // 本地音视频流
    private var localAudioTrack: AudioTrack? = null
    private var localVideoTrack: VideoTrack? = null
    private var localMediaStream: MediaStream? = null

    // 远程音视频流
    private var remoteAudioTrack: AudioTrack? = null
    private var remoteVideoTrack: VideoTrack? = null

    // 视频捕获器
    private var videoCapturer: CameraVideoCapturer? = null
    private var videoSource: VideoSource? = null
    private var audioSource: AudioSource? = null

    // Surface渲染器
    private var localSurfaceRenderer: SurfaceViewRenderer? = null
    private var remoteSurfaceRenderer: SurfaceViewRenderer? = null

    // 通话状态
    private val _callState = MutableSharedFlow<CallState>()
    val callState: SharedFlow<CallState> = _callState.asSharedFlow()

    // ICE候选收集
    private val _iceCandidate = MutableSharedFlow<IceCandidate>()
    val iceCandidate: SharedFlow<IceCandidate> = _iceCandidate.asSharedFlow()

    // 信令事件
    private val _signalingEvent = MutableSharedFlow<SignalingEvent>()
    val signalingEvent: SharedFlow<SignalingEvent> = _signalingEvent.asSharedFlow()

    /**
     * 初始化WebRTC
     */
    fun initialize() {
        Timber.d("Initializing WebRTC...")

        // 初始化PeerConnectionFactory
        val options = PeerConnectionFactory.InitializationOptions.builder(context)
            .setEnableInternalTracer(true)
            .setFieldTrials("WebRTC-H264HighProfile/Enabled/")
            .createInitializationOptions()

        PeerConnectionFactory.initialize(options)

        // 创建StreamPeerConnectionFactory
        peerConnectionFactory = StreamPeerConnectionFactory(context)

        Timber.d("WebRTC initialized successfully")
    }

    /**
     * 发起通话
     *
     * @param targetDid 目标用户DID
     * @param isVideoCall 是否视频通话
     */
    suspend fun initiateCall(targetDid: String, isVideoCall: Boolean) {
        Timber.d("Initiating call to $targetDid, video=$isVideoCall")

        try {
            // 更新状态
            _callState.emit(CallState.Initiating)

            // 创建PeerConnection
            createPeerConnection()

            // 创建本地媒体流
            createLocalMediaStream(isVideoCall)

            // 添加本地流到PeerConnection
            localMediaStream?.let { stream ->
                peerConnection?.addStream(stream)
            }

            // 创建Offer
            val constraints = ConstraintsBuilder().apply {
                offerToReceiveAudio()
                if (isVideoCall) {
                    offerToReceiveVideo()
                }
            }.build()

            peerConnection?.createOffer(object : SdpObserver {
                override fun onCreateSuccess(sessionDescription: SessionDescription?) {
                    sessionDescription?.let { sdp ->
                        scope.launch {
                            // 设置本地描述
                            peerConnection?.setLocalDescription(object : SdpObserver {
                                override fun onSetSuccess() {
                                    scope.launch {
                                        // 发送Offer到对方
                                        _signalingEvent.emit(
                                            SignalingEvent.SendOffer(
                                                targetDid = targetDid,
                                                sdp = sdp
                                            )
                                        )
                                        _callState.emit(CallState.Ringing)
                                    }
                                }

                                override fun onSetFailure(error: String?) {
                                    Timber.e("Set local description failed: $error")
                                    scope.launch {
                                        _callState.emit(CallState.Error(error ?: "Unknown error"))
                                    }
                                }

                                override fun onCreateSuccess(p0: SessionDescription?) {}
                                override fun onCreateFailure(p0: String?) {}
                            }, sdp)
                        }
                    }
                }

                override fun onCreateFailure(error: String?) {
                    Timber.e("Create offer failed: $error")
                    scope.launch {
                        _callState.emit(CallState.Error(error ?: "Unknown error"))
                    }
                }

                override fun onSetSuccess() {}
                override fun onSetFailure(p0: String?) {}
            }, constraints)

        } catch (e: Exception) {
            Timber.e(e, "Failed to initiate call")
            _callState.emit(CallState.Error(e.message ?: "Unknown error"))
        }
    }

    /**
     * 处理收到的Offer
     *
     * @param fromDid 发起方DID
     * @param offer Offer SDP
     * @param isVideoCall 是否视频通话
     */
    suspend fun handleOffer(fromDid: String, offer: SessionDescription, isVideoCall: Boolean) {
        Timber.d("Handling offer from $fromDid")

        try {
            _callState.emit(CallState.Receiving)

            // 创建PeerConnection
            createPeerConnection()

            // 创建本地媒体流
            createLocalMediaStream(isVideoCall)

            // 添加本地流
            localMediaStream?.let { stream ->
                peerConnection?.addStream(stream)
            }

            // 设置远程描述（Offer）
            peerConnection?.setRemoteDescription(object : SdpObserver {
                override fun onSetSuccess() {
                    // 创建Answer
                    val constraints = ConstraintsBuilder().apply {
                        offerToReceiveAudio()
                        if (isVideoCall) {
                            offerToReceiveVideo()
                        }
                    }.build()

                    peerConnection?.createAnswer(object : SdpObserver {
                        override fun onCreateSuccess(answerSdp: SessionDescription?) {
                            answerSdp?.let { answer ->
                                // 设置本地描述（Answer）
                                peerConnection?.setLocalDescription(object : SdpObserver {
                                    override fun onSetSuccess() {
                                        scope.launch {
                                            // 发送Answer给对方
                                            _signalingEvent.emit(
                                                SignalingEvent.SendAnswer(
                                                    targetDid = fromDid,
                                                    sdp = answer
                                                )
                                            )
                                            _callState.emit(CallState.Connected)
                                        }
                                    }

                                    override fun onSetFailure(error: String?) {
                                        Timber.e("Set local description (answer) failed: $error")
                                        scope.launch {
                                            _callState.emit(CallState.Error(error ?: "Unknown error"))
                                        }
                                    }

                                    override fun onCreateSuccess(p0: SessionDescription?) {}
                                    override fun onCreateFailure(p0: String?) {}
                                }, answer)
                            }
                        }

                        override fun onCreateFailure(error: String?) {
                            Timber.e("Create answer failed: $error")
                            scope.launch {
                                _callState.emit(CallState.Error(error ?: "Unknown error"))
                            }
                        }

                        override fun onSetSuccess() {}
                        override fun onSetFailure(p0: String?) {}
                    }, constraints)
                }

                override fun onSetFailure(error: String?) {
                    Timber.e("Set remote description (offer) failed: $error")
                    scope.launch {
                        _callState.emit(CallState.Error(error ?: "Unknown error"))
                    }
                }

                override fun onCreateSuccess(p0: SessionDescription?) {}
                override fun onCreateFailure(p0: String?) {}
            }, offer)

        } catch (e: Exception) {
            Timber.e(e, "Failed to handle offer")
            _callState.emit(CallState.Error(e.message ?: "Unknown error"))
        }
    }

    /**
     * 处理收到的Answer
     *
     * @param answer Answer SDP
     */
    suspend fun handleAnswer(answer: SessionDescription) {
        Timber.d("Handling answer")

        try {
            peerConnection?.setRemoteDescription(object : SdpObserver {
                override fun onSetSuccess() {
                    Timber.d("Remote description (answer) set successfully")
                    scope.launch {
                        _callState.emit(CallState.Connected)
                    }
                }

                override fun onSetFailure(error: String?) {
                    Timber.e("Set remote description (answer) failed: $error")
                    scope.launch {
                        _callState.emit(CallState.Error(error ?: "Unknown error"))
                    }
                }

                override fun onCreateSuccess(p0: SessionDescription?) {}
                override fun onCreateFailure(p0: String?) {}
            }, answer)

        } catch (e: Exception) {
            Timber.e(e, "Failed to handle answer")
            _callState.emit(CallState.Error(e.message ?: "Unknown error"))
        }
    }

    /**
     * 处理ICE候选
     *
     * @param candidate ICE候选
     */
    fun handleIceCandidate(candidate: IceCandidate) {
        Timber.d("Adding ICE candidate: ${candidate.sdp}")
        peerConnection?.addIceCandidate(candidate)
    }

    /**
     * 结束通话
     */
    suspend fun endCall() {
        Timber.d("Ending call")

        try {
            // 停止视频捕获
            videoCapturer?.stopCapture()

            // 移除轨道
            localAudioTrack?.setEnabled(false)
            localVideoTrack?.setEnabled(false)

            // 关闭PeerConnection
            peerConnection?.close()
            peerConnection = null

            // 释放资源
            localAudioTrack?.dispose()
            localVideoTrack?.dispose()
            videoSource?.dispose()
            audioSource?.dispose()
            videoCapturer?.dispose()

            localAudioTrack = null
            localVideoTrack = null
            videoSource = null
            audioSource = null
            videoCapturer = null

            _callState.emit(CallState.Ended)

        } catch (e: Exception) {
            Timber.e(e, "Failed to end call")
            _callState.emit(CallState.Error(e.message ?: "Unknown error"))
        }
    }

    /**
     * 切换麦克风静音状态
     */
    fun toggleMicrophone(muted: Boolean) {
        localAudioTrack?.setEnabled(!muted)
    }

    /**
     * 切换扬声器
     */
    fun toggleSpeaker(enabled: Boolean) {
        // 通过AudioManager实现（需要在Activity/ViewModel中处理）
    }

    /**
     * 切换摄像头（前置/后置）
     */
    fun switchCamera() {
        (videoCapturer as? Camera2Enumerator)?.let { enumerator ->
            // 实现摄像头切换
        }
    }

    /**
     * 初始化Surface渲染器
     */
    fun initializeSurfaceRenderers(
        local: SurfaceViewRenderer,
        remote: SurfaceViewRenderer
    ) {
        localSurfaceRenderer = local
        remoteSurfaceRenderer = remote

        val eglBase = EglBase.create()
        local.init(eglBase.eglBaseContext, null)
        remote.init(eglBase.eglBaseContext, null)
    }

    /**
     * 创建PeerConnection
     */
    private fun createPeerConnection() {
        val iceServers = listOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun1.l.google.com:19302").createIceServer()
        )

        val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }

        peerConnection = peerConnectionFactory?.createPeerConnection(
            rtcConfig,
            CallPeerConnectionObserver(
                onIceCandidateReceived = { candidate ->
                    scope.launch {
                        _iceCandidate.emit(candidate)
                    }
                },
                onStreamAdded = { stream ->
                    Timber.d("Remote stream added")
                    remoteAudioTrack = stream.audioTracks.firstOrNull()
                    remoteVideoTrack = stream.videoTracks.firstOrNull()

                    remoteVideoTrack?.addSink(remoteSurfaceRenderer)
                },
                onConnectionChange = { newState ->
                    Timber.d("Connection state changed: $newState")
                }
            )
        )
    }

    /**
     * 创建本地媒体流
     */
    private fun createLocalMediaStream(includeVideo: Boolean) {
        val factory = peerConnectionFactory ?: return

        // 创建音频轨道
        audioSource = factory.makeAudioSource(MediaConstraints())
        localAudioTrack = factory.makeAudioTrack(
            source = audioSource!!,
            trackId = "local_audio_track"
        )

        // 创建视频轨道（如果是视频通话）
        if (includeVideo) {
            videoCapturer = createCameraCapturer()
            videoSource = factory.makeVideoSource(videoCapturer!!.isScreencast)
            videoCapturer?.initialize(
                SurfaceTextureHelper.create("CaptureThread", EglBase.create().eglBaseContext),
                context,
                videoSource!!.capturerObserver
            )
            videoCapturer?.startCapture(640, 480, 30)

            localVideoTrack = factory.makeVideoTrack(
                source = videoSource!!,
                trackId = "local_video_track"
            )

            localVideoTrack?.addSink(localSurfaceRenderer)
        }

        // 创建媒体流
        localMediaStream = factory.makeMediaStream("local_stream").apply {
            addTrack(localAudioTrack)
            if (includeVideo) {
                localVideoTrack?.let { addTrack(it) }
            }
        }
    }

    /**
     * 创建摄像头捕获器
     */
    private fun createCameraCapturer(): CameraVideoCapturer {
        val enumerator = Camera2Enumerator(context)
        val deviceNames = enumerator.deviceNames

        // 优先使用前置摄像头
        for (deviceName in deviceNames) {
            if (enumerator.isFrontFacing(deviceName)) {
                return enumerator.createCapturer(deviceName, null)
            }
        }

        // 如果没有前置摄像头，使用后置
        for (deviceName in deviceNames) {
            if (enumerator.isBackFacing(deviceName)) {
                return enumerator.createCapturer(deviceName, null)
            }
        }

        throw IllegalStateException("No camera found on device")
    }

    /**
     * 释放资源
     */
    fun dispose() {
        scope.launch {
            endCall()
            peerConnectionFactory?.dispose()
            peerConnectionFactory = null
        }
    }
}

/**
 * 通话状态
 */
sealed class CallState {
    /** 初始化中 */
    object Initiating : CallState()

    /** 振铃中 */
    object Ringing : CallState()

    /** 接收通话中 */
    object Receiving : CallState()

    /** 已连接 */
    object Connected : CallState()

    /** 已结束 */
    object Ended : CallState()

    /** 错误 */
    data class Error(val message: String) : CallState()
}

/**
 * 信令事件
 */
sealed class SignalingEvent {
    /** 发送Offer */
    data class SendOffer(
        val targetDid: String,
        val sdp: SessionDescription
    ) : SignalingEvent()

    /** 发送Answer */
    data class SendAnswer(
        val targetDid: String,
        val sdp: SessionDescription
    ) : SignalingEvent()

    /** 发送ICE候选 */
    data class SendIceCandidate(
        val targetDid: String,
        val candidate: IceCandidate
    ) : SignalingEvent()
}
