package com.chainlesschain.android.core.p2p.connection

import android.content.Context
import android.util.Log
import com.chainlesschain.android.core.p2p.config.P2PFeatureFlags
import com.chainlesschain.android.core.p2p.ice.IceServerConfig
import com.chainlesschain.android.core.p2p.model.P2PDevice
import com.chainlesschain.android.core.p2p.model.P2PMessage
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import org.webrtc.*
import javax.inject.Inject

/**
 * WebRTC P2P连接实现
 *
 * 使用WebRTC DataChannel进行点对点数据传输
 */
class WebRTCPeerConnection @Inject constructor(
    @ApplicationContext private val context: Context,
    private val iceServerConfig: IceServerConfig
) : P2PConnection {

    companion object {
        private const val TAG = "WebRTCPeerConnection"
        private const val DATA_CHANNEL_LABEL = "chainlesschain-data"

        /** ICE 收集超时（毫秒） */
        const val ICE_GATHERING_TIMEOUT_MS = 10_000L

        /** ICE 连接超时（毫秒） */
        const val ICE_CONNECTION_TIMEOUT_MS = 30_000L

        /** ICE 重启最大尝试次数 */
        const val MAX_ICE_RESTART_ATTEMPTS = 3

        /** TURN 回退前的等待时间（毫秒） */
        const val TURN_FALLBACK_DELAY_MS = 5_000L
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

    // ICE 状态管理
    private val _iceGatheringState = MutableStateFlow<IceGatheringState>(IceGatheringState.NEW)
    private val _iceConnectionState = MutableStateFlow<IceConnectionState>(IceConnectionState.NEW)
    private var iceRestartAttempts = 0
    private var iceGatheringJob: Job? = null
    private var iceConnectionJob: Job? = null
    private val pendingIceCandidates = mutableListOf<IceCandidate>()
    private var isRemoteDescriptionSet = false

    // TURN 回退状态
    private var turnFallbackAttempted = false

    // 协程作用域
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    // 信令回调（由外部设置）
    var onOfferCreated: ((SessionDescription) -> Unit)? = null
    var onAnswerCreated: ((SessionDescription) -> Unit)? = null
    var onIceCandidateFound: ((IceCandidate) -> Unit)? = null
    var onIceGatheringComplete: (() -> Unit)? = null
    var onIceConnectionFailed: ((String) -> Unit)? = null

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
     *
     * @param forceTurnRelay 是否强制使用 TURN 中继模式
     */
    private fun createPeerConnection(forceTurnRelay: Boolean = false) {
        // 重置 ICE 状态
        iceRestartAttempts = 0
        pendingIceCandidates.clear()
        isRemoteDescriptionSet = false
        _iceGatheringState.value = IceGatheringState.NEW
        _iceConnectionState.value = IceConnectionState.NEW

        // 如果需要强制使用 TURN，切换传输策略
        if (forceTurnRelay && P2PFeatureFlags.enableTurnFallback) {
            iceServerConfig.forceRelay()
            Log.i(TAG, "Forcing TURN relay mode")
        } else {
            iceServerConfig.useNormalPolicy()
        }

        // 使用配置化的 ICE 服务器
        val rtcConfig = iceServerConfig.getRtcConfiguration()

        Log.d(TAG, "Creating PeerConnection with ${iceServerConfig.getConfigSummary()}")

        peerConnection = peerConnectionFactory?.createPeerConnection(
            rtcConfig,
            object : PeerConnection.Observer {
                override fun onSignalingChange(state: PeerConnection.SignalingState?) {
                    Log.d(TAG, "Signaling state changed: $state")
                }

                override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
                    Log.d(TAG, "ICE connection state changed: $state")

                    // 更新内部状态
                    _iceConnectionState.value = when (state) {
                        PeerConnection.IceConnectionState.NEW -> IceConnectionState.NEW
                        PeerConnection.IceConnectionState.CHECKING -> IceConnectionState.CHECKING
                        PeerConnection.IceConnectionState.CONNECTED -> IceConnectionState.CONNECTED
                        PeerConnection.IceConnectionState.COMPLETED -> IceConnectionState.COMPLETED
                        PeerConnection.IceConnectionState.FAILED -> IceConnectionState.FAILED
                        PeerConnection.IceConnectionState.DISCONNECTED -> IceConnectionState.DISCONNECTED
                        PeerConnection.IceConnectionState.CLOSED -> IceConnectionState.CLOSED
                        else -> IceConnectionState.NEW
                    }

                    when (state) {
                        PeerConnection.IceConnectionState.CONNECTED,
                        PeerConnection.IceConnectionState.COMPLETED -> {
                            // 取消连接超时
                            iceConnectionJob?.cancel()
                            iceRestartAttempts = 0
                            turnFallbackAttempted = false // 重置 TURN 回退状态
                            currentDevice?.let {
                                _connectionState.value = ConnectionState.Connected(it)
                            }
                            Log.i(TAG, "ICE connection established${if (iceServerConfig.getConfigSummary().transportPolicy == "RELAY") " (via TURN relay)" else ""}")
                        }
                        PeerConnection.IceConnectionState.DISCONNECTED -> {
                            // ICE 断开，可能是临时的网络问题
                            Log.w(TAG, "ICE disconnected, waiting for recovery...")
                            // 启动恢复超时
                            startIceRecoveryTimeout()
                        }
                        PeerConnection.IceConnectionState.FAILED -> {
                            Log.e(TAG, "ICE connection failed")
                            handleIceConnectionFailed()
                        }
                        PeerConnection.IceConnectionState.CHECKING -> {
                            // 开始 ICE 连接检查，启动超时计时
                            startIceConnectionTimeout()
                        }
                        else -> {}
                    }
                }

                override fun onIceConnectionReceivingChange(receiving: Boolean) {
                    Log.d(TAG, "ICE connection receiving: $receiving")
                    if (!receiving) {
                        Log.w(TAG, "ICE not receiving data, connection may be degraded")
                    }
                }

                override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {
                    Log.d(TAG, "ICE gathering state changed: $state")

                    _iceGatheringState.value = when (state) {
                        PeerConnection.IceGatheringState.NEW -> IceGatheringState.NEW
                        PeerConnection.IceGatheringState.GATHERING -> IceGatheringState.GATHERING
                        PeerConnection.IceGatheringState.COMPLETE -> IceGatheringState.COMPLETE
                        else -> IceGatheringState.NEW
                    }

                    when (state) {
                        PeerConnection.IceGatheringState.GATHERING -> {
                            // 开始 ICE 收集，启动超时计时
                            startIceGatheringTimeout()
                        }
                        PeerConnection.IceGatheringState.COMPLETE -> {
                            // 取消收集超时
                            iceGatheringJob?.cancel()
                            Log.i(TAG, "ICE gathering complete")
                            onIceGatheringComplete?.invoke()
                        }
                        else -> {}
                    }
                }

                override fun onIceCandidate(candidate: org.webrtc.IceCandidate?) {
                    candidate?.let {
                        Log.d(TAG, "ICE candidate found: ${it.sdp}")
                        val iceCandidate = IceCandidate(
                            sdpMid = it.sdpMid,
                            sdpMLineIndex = it.sdpMLineIndex,
                            sdp = it.sdp
                        )
                        onIceCandidateFound?.invoke(iceCandidate)
                    }
                }

                override fun onIceCandidatesRemoved(candidates: Array<out org.webrtc.IceCandidate>?) {
                    Log.d(TAG, "ICE candidates removed: ${candidates?.size ?: 0}")
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
                isRemoteDescriptionSet = true
                processPendingIceCandidates()
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
                isRemoteDescriptionSet = true
                processPendingIceCandidates()
            }
            override fun onCreateFailure(error: String?) {}
            override fun onSetFailure(error: String?) {
                Log.e(TAG, "Failed to set remote answer: $error")
            }
        }, sdp)
    }

    /**
     * 添加远程ICE候选
     *
     * 如果远程描述尚未设置，候选将被缓存并在设置后添加
     */
    fun addIceCandidate(candidate: IceCandidate) {
        if (!isRemoteDescriptionSet) {
            Log.d(TAG, "Remote description not set, queuing ICE candidate")
            pendingIceCandidates.add(candidate)
            return
        }

        addIceCandidateInternal(candidate)
    }

    private fun addIceCandidateInternal(candidate: IceCandidate) {
        val iceCandidate = org.webrtc.IceCandidate(
            candidate.sdpMid,
            candidate.sdpMLineIndex,
            candidate.sdp
        )

        val success = peerConnection?.addIceCandidate(iceCandidate) ?: false
        if (success) {
            Log.d(TAG, "ICE candidate added: ${candidate.sdp.take(50)}...")
        } else {
            Log.w(TAG, "Failed to add ICE candidate")
        }
    }

    /**
     * 处理待处理的 ICE 候选
     */
    private fun processPendingIceCandidates() {
        if (pendingIceCandidates.isEmpty()) return

        Log.i(TAG, "Processing ${pendingIceCandidates.size} pending ICE candidates")
        pendingIceCandidates.forEach { addIceCandidateInternal(it) }
        pendingIceCandidates.clear()
    }

    /**
     * 启动 ICE 收集超时
     */
    private fun startIceGatheringTimeout() {
        iceGatheringJob?.cancel()
        iceGatheringJob = scope.launch {
            delay(ICE_GATHERING_TIMEOUT_MS)
            if (_iceGatheringState.value == IceGatheringState.GATHERING) {
                Log.w(TAG, "ICE gathering timeout after ${ICE_GATHERING_TIMEOUT_MS}ms")
                // 收集超时不一定是致命错误，可能已有足够的候选
                onIceGatheringComplete?.invoke()
            }
        }
    }

    /**
     * 启动 ICE 连接超时
     */
    private fun startIceConnectionTimeout() {
        iceConnectionJob?.cancel()
        iceConnectionJob = scope.launch {
            delay(ICE_CONNECTION_TIMEOUT_MS)
            val state = _iceConnectionState.value
            if (state == IceConnectionState.CHECKING || state == IceConnectionState.NEW) {
                Log.e(TAG, "ICE connection timeout after ${ICE_CONNECTION_TIMEOUT_MS}ms")
                handleIceConnectionFailed()
            }
        }
    }

    /**
     * 启动 ICE 恢复超时（用于临时断开）
     */
    private fun startIceRecoveryTimeout() {
        iceConnectionJob?.cancel()
        iceConnectionJob = scope.launch {
            // 给 15 秒恢复时间
            delay(15_000L)
            if (_iceConnectionState.value == IceConnectionState.DISCONNECTED) {
                Log.w(TAG, "ICE recovery timeout, attempting restart")
                attemptIceRestart()
            }
        }
    }

    /**
     * 处理 ICE 连接失败
     */
    private fun handleIceConnectionFailed() {
        iceConnectionJob?.cancel()

        if (iceRestartAttempts < MAX_ICE_RESTART_ATTEMPTS) {
            Log.w(TAG, "ICE connection failed, attempting restart (${iceRestartAttempts + 1}/$MAX_ICE_RESTART_ATTEMPTS)")
            attemptIceRestart()
        } else if (P2PFeatureFlags.enableTurnFallback && !turnFallbackAttempted && hasTurnServersConfigured()) {
            // 尝试 TURN 回退
            Log.w(TAG, "ICE connection failed after $MAX_ICE_RESTART_ATTEMPTS attempts, falling back to TURN relay")
            attemptTurnFallback()
        } else {
            val reason = if (turnFallbackAttempted) {
                "ICE connection failed after TURN fallback"
            } else {
                "ICE connection failed after $MAX_ICE_RESTART_ATTEMPTS attempts"
            }
            Log.e(TAG, reason)
            _connectionState.value = ConnectionState.Failed(reason)
            onIceConnectionFailed?.invoke(reason)
        }
    }

    /**
     * 检查是否配置了 TURN 服务器
     */
    private fun hasTurnServersConfigured(): Boolean {
        return iceServerConfig.getConfigSummary().turnServerCount > 0
    }

    /**
     * 尝试使用 TURN 服务器回退
     */
    private fun attemptTurnFallback() {
        turnFallbackAttempted = true
        iceRestartAttempts = 0

        Log.i(TAG, "Attempting TURN fallback")

        // 关闭当前连接
        peerConnection?.close()
        peerConnection = null
        dataChannel?.close()
        dataChannel = null

        scope.launch {
            // 短暂延迟后重建连接
            delay(TURN_FALLBACK_DELAY_MS)

            // 使用 TURN 模式重新创建连接
            createPeerConnection(forceTurnRelay = true)

            // 重新创建 Offer
            createOffer()
        }
    }

    /**
     * 尝试 ICE 重启
     */
    private fun attemptIceRestart() {
        iceRestartAttempts++
        Log.i(TAG, "Attempting ICE restart (attempt $iceRestartAttempts)")

        // 使用 ICE restart 而非完全重建连接
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("IceRestart", "true"))
        }

        peerConnection?.createOffer(object : SdpObserver {
            override fun onCreateSuccess(sdp: org.webrtc.SessionDescription?) {
                sdp?.let {
                    Log.d(TAG, "ICE restart offer created")
                    peerConnection?.setLocalDescription(object : SdpObserver {
                        override fun onCreateSuccess(p0: org.webrtc.SessionDescription?) {}
                        override fun onSetSuccess() {
                            Log.d(TAG, "ICE restart local description set")
                            onOfferCreated?.invoke(
                                SessionDescription(
                                    type = SessionDescription.Type.OFFER,
                                    sdp = it.description
                                )
                            )
                        }
                        override fun onCreateFailure(error: String?) {
                            Log.e(TAG, "ICE restart create failure: $error")
                        }
                        override fun onSetFailure(error: String?) {
                            Log.e(TAG, "ICE restart set failure: $error")
                        }
                    }, it)
                }
            }

            override fun onSetSuccess() {}
            override fun onCreateFailure(error: String?) {
                Log.e(TAG, "Failed to create ICE restart offer: $error")
                _connectionState.value = ConnectionState.Failed("ICE restart failed: $error")
            }
            override fun onSetFailure(error: String?) {}
        }, constraints)
    }

    /**
     * 获取 ICE 连接状态
     */
    fun getIceConnectionState(): IceConnectionState = _iceConnectionState.value

    /**
     * 获取 ICE 收集状态
     */
    fun getIceGatheringState(): IceGatheringState = _iceGatheringState.value

    /**
     * 释放资源
     */
    fun release() {
        // 取消所有超时任务
        iceGatheringJob?.cancel()
        iceConnectionJob?.cancel()
        scope.cancel()

        dataChannel?.dispose()
        peerConnection?.dispose()
        peerConnectionFactory?.dispose()
        eglBase?.release()

        dataChannel = null
        peerConnection = null
        peerConnectionFactory = null
        eglBase = null
        pendingIceCandidates.clear()
    }
}

/**
 * ICE 连接状态
 */
enum class IceConnectionState {
    NEW,
    CHECKING,
    CONNECTED,
    COMPLETED,
    FAILED,
    DISCONNECTED,
    CLOSED
}

/**
 * ICE 收集状态
 */
enum class IceGatheringState {
    NEW,
    GATHERING,
    COMPLETE
}
