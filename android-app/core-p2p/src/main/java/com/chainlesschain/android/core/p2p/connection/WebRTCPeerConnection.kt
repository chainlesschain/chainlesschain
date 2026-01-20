package com.chainlesschain.android.core.p2p.connection

import android.content.Context
import android.util.Log
import com.chainlesschain.android.core.p2p.model.P2PDevice
import com.chainlesschain.android.core.p2p.model.P2PMessage
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filterNotNull
import org.webrtc.*
import javax.inject.Inject

/**
 * WebRTC P2P连接实现
 *
 * 使用WebRTC DataChannel进行点对点数据传输
 */
class WebRTCPeerConnection @Inject constructor(
    @ApplicationContext private val context: Context
) : P2PConnection {

    companion object {
        private const val TAG = "WebRTCPeerConnection"
        private const val DATA_CHANNEL_LABEL = "chainlesschain-data"

        // STUN服务器配置
        private val ICE_SERVERS = listOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun1.l.google.com:19302").createIceServer()
        )
    }

    // WebRTC组件
    private var peerConnectionFactory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var dataChannel: DataChannel? = null
    private var eglBase: EglBase? = null

    // 状态管理
    private val _connectionState = MutableStateFlow<ConnectionState>(ConnectionState.Idle)
    private val _messages = MutableStateFlow<P2PMessage?>(null)
    private var currentDevice: P2PDevice? = null

    // 信令回调（由外部设置）
    var onOfferCreated: ((SessionDescription) -> Unit)? = null
    var onAnswerCreated: ((SessionDescription) -> Unit)? = null
    var onIceCandidateFound: ((IceCandidate) -> Unit)? = null

    init {
        initializeWebRTC()
    }

    /**
     * 初始化WebRTC
     */
    private fun initializeWebRTC() {
        Log.d(TAG, "Initializing WebRTC")

        // 初始化PeerConnectionFactory
        val options = PeerConnectionFactory.InitializationOptions.builder(context)
            .setEnableInternalTracer(true)
            .createInitializationOptions()

        PeerConnectionFactory.initialize(options)

        // 创建EglBase
        eglBase = EglBase.create()

        // 创建PeerConnectionFactory
        peerConnectionFactory = PeerConnectionFactory.builder()
            .setOptions(PeerConnectionFactory.Options())
            .createPeerConnectionFactory()
    }

    override suspend fun connect(device: P2PDevice) {
        Log.i(TAG, "Connecting to device: ${device.deviceName}")

        currentDevice = device
        _connectionState.value = ConnectionState.Connecting

        try {
            // 创建PeerConnection
            createPeerConnection()

            // 创建Offer
            createOffer()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to connect", e)
            _connectionState.value = ConnectionState.Failed(e.message ?: "Unknown error")
        }
    }

    override suspend fun disconnect() {
        Log.i(TAG, "Disconnecting")

        dataChannel?.close()
        dataChannel = null

        peerConnection?.close()
        peerConnection = null

        _connectionState.value = ConnectionState.Disconnected("User requested")
        currentDevice = null
    }

    override suspend fun sendMessage(message: P2PMessage) {
        if (!isConnected()) {
            Log.w(TAG, "Cannot send message: not connected")
            return
        }

        try {
            // 将消息序列化为JSON
            val json = kotlinx.serialization.json.Json.encodeToString(
                P2PMessage.serializer(),
                message
            )

            val buffer = DataChannel.Buffer(
                java.nio.ByteBuffer.wrap(json.toByteArray()),
                false
            )

            dataChannel?.send(buffer)
            Log.d(TAG, "Message sent: ${message.id}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send message", e)
        }
    }

    override fun observeMessages(): Flow<P2PMessage> {
        return _messages.asStateFlow().filterNotNull()
    }

    override fun observeConnectionState(): Flow<ConnectionState> {
        return _connectionState.asStateFlow()
    }

    override fun getConnectionState(): ConnectionState {
        return _connectionState.value
    }

    override fun isConnected(): Boolean {
        return _connectionState.value is ConnectionState.Connected
    }

    /**
     * 创建PeerConnection
     */
    private fun createPeerConnection() {
        val rtcConfig = PeerConnection.RTCConfiguration(ICE_SERVERS).apply {
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE
            tcpCandidatePolicy = PeerConnection.TcpCandidatePolicy.ENABLED
        }

        peerConnection = peerConnectionFactory?.createPeerConnection(
            rtcConfig,
            object : PeerConnection.Observer {
                override fun onSignalingChange(state: PeerConnection.SignalingState?) {
                    Log.d(TAG, "Signaling state changed: $state")
                }

                override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
                    Log.d(TAG, "ICE connection state changed: $state")

                    when (state) {
                        PeerConnection.IceConnectionState.CONNECTED -> {
                            currentDevice?.let {
                                _connectionState.value = ConnectionState.Connected(it)
                            }
                        }
                        PeerConnection.IceConnectionState.DISCONNECTED -> {
                            _connectionState.value = ConnectionState.Disconnected("ICE disconnected")
                        }
                        PeerConnection.IceConnectionState.FAILED -> {
                            _connectionState.value = ConnectionState.Failed("ICE connection failed")
                        }
                        else -> {}
                    }
                }

                override fun onIceConnectionReceivingChange(receiving: Boolean) {
                    Log.d(TAG, "ICE connection receiving: $receiving")
                }

                override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {
                    Log.d(TAG, "ICE gathering state changed: $state")
                }

                override fun onIceCandidate(candidate: org.webrtc.IceCandidate?) {
                    candidate?.let {
                        Log.d(TAG, "ICE candidate found: ${it.sdp}")
                        onIceCandidateFound?.invoke(
                            IceCandidate(
                                sdpMid = it.sdpMid,
                                sdpMLineIndex = it.sdpMLineIndex,
                                sdp = it.sdp
                            )
                        )
                    }
                }

                override fun onIceCandidatesRemoved(candidates: Array<out org.webrtc.IceCandidate>?) {
                    Log.d(TAG, "ICE candidates removed")
                }

                override fun onAddStream(stream: MediaStream?) {
                    // 不使用媒体流
                }

                override fun onRemoveStream(stream: MediaStream?) {
                    // 不使用媒体流
                }

                override fun onDataChannel(dc: DataChannel?) {
                    Log.d(TAG, "Data channel received: ${dc?.label()}")
                    dc?.let { setupDataChannel(it) }
                }

                override fun onRenegotiationNeeded() {
                    Log.d(TAG, "Renegotiation needed")
                }

                override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {
                    // 不使用媒体轨道
                }
            }
        )

        // 创建DataChannel
        val dataChannelInit = DataChannel.Init().apply {
            ordered = true
            maxRetransmits = -1
        }

        dataChannel = peerConnection?.createDataChannel(DATA_CHANNEL_LABEL, dataChannelInit)
        dataChannel?.let { setupDataChannel(it) }
    }

    /**
     * 设置DataChannel监听器
     */
    private fun setupDataChannel(dc: DataChannel) {
        dc.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(amount: Long) {
                Log.d(TAG, "Buffered amount changed: $amount")
            }

            override fun onStateChange() {
                Log.d(TAG, "DataChannel state changed: ${dc.state()}")

                when (dc.state()) {
                    DataChannel.State.OPEN -> {
                        Log.i(TAG, "DataChannel opened")
                    }
                    DataChannel.State.CLOSED -> {
                        Log.i(TAG, "DataChannel closed")
                    }
                    else -> {}
                }
            }

            override fun onMessage(buffer: DataChannel.Buffer?) {
                buffer?.let {
                    try {
                        val data = ByteArray(it.data.remaining())
                        it.data.get(data)
                        val json = String(data)

                        val message = kotlinx.serialization.json.Json.decodeFromString(
                            P2PMessage.serializer(),
                            json
                        )

                        Log.d(TAG, "Message received: ${message.id}")
                        _messages.value = message
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to parse message", e)
                    }
                }
            }
        })
    }

    /**
     * 创建Offer
     */
    private fun createOffer() {
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "false"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"))
        }

        peerConnection?.createOffer(object : SdpObserver {
            override fun onCreateSuccess(sdp: org.webrtc.SessionDescription?) {
                sdp?.let {
                    Log.d(TAG, "Offer created")
                    peerConnection?.setLocalDescription(object : SdpObserver {
                        override fun onCreateSuccess(p0: org.webrtc.SessionDescription?) {}
                        override fun onSetSuccess() {
                            Log.d(TAG, "Local description set")
                            onOfferCreated?.invoke(
                                SessionDescription(
                                    type = SessionDescription.Type.OFFER,
                                    sdp = it.description
                                )
                            )
                        }
                        override fun onCreateFailure(error: String?) {
                            Log.e(TAG, "Failed to create: $error")
                        }
                        override fun onSetFailure(error: String?) {
                            Log.e(TAG, "Failed to set local description: $error")
                        }
                    }, it)
                }
            }

            override fun onSetSuccess() {}
            override fun onCreateFailure(error: String?) {
                Log.e(TAG, "Failed to create offer: $error")
                _connectionState.value = ConnectionState.Failed(error ?: "Failed to create offer")
            }
            override fun onSetFailure(error: String?) {}
        }, constraints)
    }

    /**
     * 处理远程Offer
     */
    fun handleOffer(offer: SessionDescription) {
        Log.d(TAG, "Handling remote offer")

        if (peerConnection == null) {
            createPeerConnection()
        }

        val sdp = org.webrtc.SessionDescription(
            org.webrtc.SessionDescription.Type.OFFER,
            offer.sdp
        )

        peerConnection?.setRemoteDescription(object : SdpObserver {
            override fun onCreateSuccess(p0: org.webrtc.SessionDescription?) {}
            override fun onSetSuccess() {
                Log.d(TAG, "Remote description set, creating answer")
                createAnswer()
            }
            override fun onCreateFailure(error: String?) {}
            override fun onSetFailure(error: String?) {
                Log.e(TAG, "Failed to set remote description: $error")
            }
        }, sdp)
    }

    /**
     * 创建Answer
     */
    private fun createAnswer() {
        val constraints = MediaConstraints()

        peerConnection?.createAnswer(object : SdpObserver {
            override fun onCreateSuccess(sdp: org.webrtc.SessionDescription?) {
                sdp?.let {
                    Log.d(TAG, "Answer created")
                    peerConnection?.setLocalDescription(object : SdpObserver {
                        override fun onCreateSuccess(p0: org.webrtc.SessionDescription?) {}
                        override fun onSetSuccess() {
                            Log.d(TAG, "Local answer set")
                            onAnswerCreated?.invoke(
                                SessionDescription(
                                    type = SessionDescription.Type.ANSWER,
                                    sdp = it.description
                                )
                            )
                        }
                        override fun onCreateFailure(error: String?) {}
                        override fun onSetFailure(error: String?) {
                            Log.e(TAG, "Failed to set local answer: $error")
                        }
                    }, it)
                }
            }

            override fun onSetSuccess() {}
            override fun onCreateFailure(error: String?) {
                Log.e(TAG, "Failed to create answer: $error")
            }
            override fun onSetFailure(error: String?) {}
        }, constraints)
    }

    /**
     * 处理远程Answer
     */
    fun handleAnswer(answer: SessionDescription) {
        Log.d(TAG, "Handling remote answer")

        val sdp = org.webrtc.SessionDescription(
            org.webrtc.SessionDescription.Type.ANSWER,
            answer.sdp
        )

        peerConnection?.setRemoteDescription(object : SdpObserver {
            override fun onCreateSuccess(p0: org.webrtc.SessionDescription?) {}
            override fun onSetSuccess() {
                Log.d(TAG, "Remote answer set")
            }
            override fun onCreateFailure(error: String?) {}
            override fun onSetFailure(error: String?) {
                Log.e(TAG, "Failed to set remote answer: $error")
            }
        }, sdp)
    }

    /**
     * 添加远程ICE候选
     */
    fun addIceCandidate(candidate: IceCandidate) {
        val iceCandidate = org.webrtc.IceCandidate(
            candidate.sdpMid,
            candidate.sdpMLineIndex,
            candidate.sdp
        )

        peerConnection?.addIceCandidate(iceCandidate)
        Log.d(TAG, "ICE candidate added")
    }

    /**
     * 释放资源
     */
    fun release() {
        dataChannel?.dispose()
        peerConnection?.dispose()
        peerConnectionFactory?.dispose()
        eglBase?.release()

        dataChannel = null
        peerConnection = null
        peerConnectionFactory = null
        eglBase = null
    }
}
