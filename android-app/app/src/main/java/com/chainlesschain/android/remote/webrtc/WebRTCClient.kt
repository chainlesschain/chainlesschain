package com.chainlesschain.android.remote.webrtc

import kotlinx.coroutines.*
import org.webrtc.*
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * WebRTC 客户端 - Android 端
 *
 * 基于 Google WebRTC 库实现点对点连接
 */
@Singleton
class WebRTCClient @Inject constructor(
    private val context: android.content.Context,
    private val signalClient: SignalClient
) {
    private var peerConnectionFactory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var dataChannel: DataChannel? = null

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // ICE 服务器配置
    private val iceServers = listOf(
        PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
        PeerConnection.IceServer.builder("stun:stun1.l.google.com:19302").createIceServer()
    )

    // 消息回调
    private var onMessageReceived: ((String) -> Unit)? = null

    companion object {
        private const val DATA_CHANNEL_LABEL = "command-channel"
    }

    /**
     * 初始化 WebRTC
     */
    fun initialize() {
        Timber.d("初始化 WebRTC")

        try {
            // 初始化 PeerConnectionFactory
            val initializationOptions = PeerConnectionFactory.InitializationOptions
                .builder(context)
                .setEnableInternalTracer(true)
                .createInitializationOptions()

            PeerConnectionFactory.initialize(initializationOptions)

            // 创建 PeerConnectionFactory
            val options = PeerConnectionFactory.Options()
            peerConnectionFactory = PeerConnectionFactory.builder()
                .setOptions(options)
                .createPeerConnectionFactory()

            Timber.d("✅ WebRTC 初始化成功")
        } catch (e: Exception) {
            Timber.e(e, "❌ WebRTC 初始化失败")
            throw e
        }
    }

    /**
     * 连接到 PC
     */
    suspend fun connect(pcPeerId: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            Timber.d("开始连接 PC: $pcPeerId")

            // 1. 创建对等连接
            createPeerConnection(pcPeerId)

            // 2. 创建数据通道
            createDataChannel()

            // 3. 创建 offer
            val offer = createOffer()

            // 4. 通过信令服务器发送 offer
            signalClient.sendOffer(pcPeerId, offer)

            // 5. 等待 answer
            val answer = signalClient.waitForAnswer(pcPeerId, timeout = 10000)

            // 6. 设置远程描述
            setRemoteDescription(answer)

            Timber.d("✅ 连接成功: $pcPeerId")
            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "❌ 连接失败")
            Result.failure(e)
        }
    }

    /**
     * 创建对等连接
     */
    private fun createPeerConnection(pcPeerId: String) {
        Timber.d("创建对等连接")

        val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }

        peerConnection = peerConnectionFactory?.createPeerConnection(
            rtcConfig,
            object : PeerConnection.Observer {
                override fun onIceCandidate(candidate: IceCandidate) {
                    Timber.d("生成 ICE candidate")
                    scope.launch {
                        signalClient.sendIceCandidate(pcPeerId, candidate)
                    }
                }

                override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
                    Timber.d("连接状态变更: $newState")
                }

                override fun onDataChannel(dc: DataChannel) {
                    Timber.d("接收到数据通道: ${dc.label()}")
                    dataChannel = dc
                    setupDataChannel(dc)
                }

                override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState) {
                    Timber.d("ICE 连接状态: $newState")
                }

                override fun onIceConnectionReceivingChange(receiving: Boolean) {
                    Timber.d("ICE 连接接收状态: $receiving")
                }

                override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {
                    Timber.d("ICE 候选已移除: ${candidates.size}")
                }

                override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState) {
                    Timber.d("ICE 收集状态: $newState")
                }

                override fun onSignalingChange(newState: PeerConnection.SignalingState) {
                    Timber.d("信令状态: $newState")
                }

                override fun onAddStream(stream: MediaStream) {
                    // 不需要媒体流
                }

                override fun onRemoveStream(stream: MediaStream) {
                    // 不需要媒体流
                }

                override fun onRenegotiationNeeded() {
                    Timber.d("需要重新协商")
                }

                override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) {
                    // 不需要媒体轨道
                }
            }
        )

        Timber.d("对等连接已创建")
    }

    /**
     * 创建数据通道
     */
    private fun createDataChannel() {
        Timber.d("创建数据通道")

        val init = DataChannel.Init().apply {
            ordered = true
            maxRetransmits = -1
        }

        dataChannel = peerConnection?.createDataChannel(DATA_CHANNEL_LABEL, init)
        dataChannel?.let { setupDataChannel(it) }

        Timber.d("数据通道已创建")
    }

    /**
     * 设置数据通道
     */
    private fun setupDataChannel(channel: DataChannel) {
        Timber.d("设置数据通道")

        channel.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(amount: Long) {
                // 缓冲区变化
            }

            override fun onStateChange() {
                Timber.d("数据通道状态: ${channel.state()}")

                when (channel.state()) {
                    DataChannel.State.OPEN -> {
                        Timber.d("✅ 数据通道已打开")
                    }
                    DataChannel.State.CLOSED -> {
                        Timber.d("数据通道已关闭")
                    }
                    else -> {}
                }
            }

            override fun onMessage(buffer: DataChannel.Buffer) {
                try {
                    val data = ByteArray(buffer.data.remaining())
                    buffer.data.get(data)
                    val message = String(data, Charsets.UTF_8)

                    Timber.d("收到消息: ${message.take(50)}...")
                    onMessageReceived?.invoke(message)
                } catch (e: Exception) {
                    Timber.e(e, "处理消息失败")
                }
            }
        })
    }

    /**
     * 创建 Offer
     */
    private suspend fun createOffer(): SessionDescription = suspendCancellableCoroutine { continuation ->
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "false"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"))
        }

        peerConnection?.createOffer(object : SdpObserver {
            override fun onCreateSuccess(sdp: SessionDescription) {
                Timber.d("Offer 创建成功")

                peerConnection?.setLocalDescription(object : SdpObserver {
                    override fun onSetSuccess() {
                        Timber.d("本地描述设置成功")
                        continuation.resume(sdp) {}
                    }

                    override fun onSetFailure(error: String) {
                        Timber.e("设置本地描述失败: $error")
                        continuation.resumeWith(Result.failure(Exception(error)))
                    }

                    override fun onCreateSuccess(p0: SessionDescription?) {}
                    override fun onCreateFailure(p0: String?) {}
                }, sdp)
            }

            override fun onCreateFailure(error: String) {
                Timber.e("创建 Offer 失败: $error")
                continuation.resumeWith(Result.failure(Exception(error)))
            }

            override fun onSetSuccess() {}
            override fun onSetFailure(p0: String?) {}
        }, constraints)
    }

    /**
     * 设置远程描述
     */
    private suspend fun setRemoteDescription(answer: SessionDescription) = suspendCancellableCoroutine<Unit> { continuation ->
        peerConnection?.setRemoteDescription(object : SdpObserver {
            override fun onSetSuccess() {
                Timber.d("✅ 远程描述设置成功")
                continuation.resume(Unit) {}
            }

            override fun onSetFailure(error: String) {
                Timber.e("❌ 设置远程描述失败: $error")
                continuation.resumeWith(Result.failure(Exception(error)))
            }

            override fun onCreateSuccess(p0: SessionDescription?) {}
            override fun onCreateFailure(p0: String?) {}
        }, answer)
    }

    /**
     * 发送消息
     */
    fun sendMessage(message: String) {
        val channel = dataChannel
            ?: throw IllegalStateException("Data channel not initialized")

        if (channel.state() != DataChannel.State.OPEN) {
            throw IllegalStateException("Data channel not open")
        }

        val buffer = DataChannel.Buffer(
            java.nio.ByteBuffer.wrap(message.toByteArray(Charsets.UTF_8)),
            false
        )

        channel.send(buffer)
        Timber.d("消息已发送: ${message.take(50)}...")
    }

    /**
     * 设置消息回调
     */
    fun setOnMessageReceived(callback: (String) -> Unit) {
        this.onMessageReceived = callback
    }

    /**
     * 断开连接
     */
    fun disconnect() {
        Timber.d("断开连接")

        dataChannel?.close()
        dataChannel = null

        peerConnection?.close()
        peerConnection = null
    }

    /**
     * 清理资源
     */
    fun cleanup() {
        Timber.d("清理资源")

        disconnect()

        peerConnectionFactory?.dispose()
        peerConnectionFactory = null
    }
}

/**
 * 信令客户端接口
 */
interface SignalClient {
    suspend fun sendOffer(peerId: String, offer: org.webrtc.SessionDescription)
    suspend fun sendIceCandidate(peerId: String, candidate: org.webrtc.IceCandidate)
    suspend fun waitForAnswer(peerId: String, timeout: Long): org.webrtc.SessionDescription
}

/**
 * WebSocket 信令客户端实现
 *
 * 使用 OkHttp WebSocket 实现与信令服务器的通信
 */
class WebSocketSignalClient @Inject constructor(
    private val okHttpClient: okhttp3.OkHttpClient,
    private val signalingConfig: com.chainlesschain.android.remote.config.SignalingConfig
) : SignalClient {

    private var webSocket: okhttp3.WebSocket? = null
    private val answerChannel = kotlinx.coroutines.channels.Channel<org.webrtc.SessionDescription>(1)
    private val iceCandidateChannel = kotlinx.coroutines.channels.Channel<org.webrtc.IceCandidate>(kotlinx.coroutines.channels.Channel.UNLIMITED)

    private var currentPeerId: String? = null
    private var isConnected = false
    private var reconnectAttempts = 0

    /**
     * 连接到信令服务器
     */
    suspend fun connect(): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            if (isConnected) {
                Timber.d("已连接到信令服务器")
                return@withContext Result.success(Unit)
            }

            val signalingUrl = signalingConfig.getSignalingUrl()
            Timber.d("连接到信令服务器: $signalingUrl")

            val request = okhttp3.Request.Builder()
                .url(signalingUrl)
                .build()

            val listener = object : okhttp3.WebSocketListener() {
                override fun onOpen(webSocket: okhttp3.WebSocket, response: okhttp3.Response) {
                    Timber.d("✅ WebSocket 连接已建立")
                    isConnected = true
                }

                override fun onMessage(webSocket: okhttp3.WebSocket, text: String) {
                    Timber.d("收到信令消息: ${text.take(100)}...")
                    handleSignalingMessage(text)
                }

                override fun onFailure(webSocket: okhttp3.WebSocket, t: Throwable, response: okhttp3.Response?) {
                    Timber.e(t, "❌ WebSocket 连接失败 (尝试 ${reconnectAttempts + 1}/${com.chainlesschain.android.remote.config.SignalingConfig.MAX_RECONNECT_ATTEMPTS})")
                    isConnected = false

                    // 自动重连（带重试次数限制）
                    if (reconnectAttempts < com.chainlesschain.android.remote.config.SignalingConfig.MAX_RECONNECT_ATTEMPTS) {
                        reconnectAttempts++
                        CoroutineScope(Dispatchers.IO).launch {
                            delay(com.chainlesschain.android.remote.config.SignalingConfig.RECONNECT_DELAY_MS)
                            Timber.d("尝试重新连接 (${reconnectAttempts}/${com.chainlesschain.android.remote.config.SignalingConfig.MAX_RECONNECT_ATTEMPTS})...")
                            connect()
                        }
                    } else {
                        Timber.e("❌ 达到最大重连次数，停止重连")
                    }
                }

                override fun onClosed(webSocket: okhttp3.WebSocket, code: Int, reason: String) {
                    Timber.d("WebSocket 连接已关闭: code=$code, reason=$reason")
                    isConnected = false
                }
            }

            webSocket = okHttpClient.newWebSocket(request, listener)

            // 等待连接建立
            var waited = 0
            while (!isConnected && waited < com.chainlesschain.android.remote.config.SignalingConfig.CONNECT_TIMEOUT_MS.toInt()) {
                delay(100)
                waited += 100
            }

            if (isConnected) {
                reconnectAttempts = 0 // 重置重连计数
                Timber.d("✅ 信令服务器连接成功")
                Result.success(Unit)
            } else {
                Result.failure(Exception("连接超时"))
            }
        } catch (e: Exception) {
            Timber.e(e, "❌ 连接信令服务器失败")
            Result.failure(e)
        }
    }

    /**
     * 处理信令消息
     */
    private fun handleSignalingMessage(message: String) {
        try {
            val json = org.json.JSONObject(message)
            val type = json.getString("type")

            when (type) {
                "answer" -> {
                    val sdp = json.getString("sdp")
                    val answer = org.webrtc.SessionDescription(
                        org.webrtc.SessionDescription.Type.ANSWER,
                        sdp
                    )
                    CoroutineScope(Dispatchers.IO).launch {
                        answerChannel.send(answer)
                    }
                    Timber.d("✅ 收到 Answer")
                }

                "ice-candidate" -> {
                    val sdpMid = json.getString("sdpMid")
                    val sdpMLineIndex = json.getInt("sdpMLineIndex")
                    val sdp = json.getString("candidate")

                    val candidate = org.webrtc.IceCandidate(sdpMid, sdpMLineIndex, sdp)
                    CoroutineScope(Dispatchers.IO).launch {
                        iceCandidateChannel.send(candidate)
                    }
                    Timber.d("✅ 收到 ICE Candidate")
                }

                "error" -> {
                    val errorMsg = json.optString("message", "Unknown error")
                    Timber.e("收到错误消息: $errorMsg")
                }

                else -> {
                    Timber.w("未知消息类型: $type")
                }
            }
        } catch (e: Exception) {
            Timber.e(e, "处理信令消息失败: $message")
        }
    }

    override suspend fun sendOffer(peerId: String, offer: org.webrtc.SessionDescription) {
        Timber.d("发送 Offer to $peerId")
        currentPeerId = peerId

        val json = org.json.JSONObject().apply {
            put("type", "offer")
            put("peerId", peerId)
            put("sdp", offer.description)
        }

        sendMessage(json.toString())
    }

    override suspend fun sendIceCandidate(peerId: String, candidate: org.webrtc.IceCandidate) {
        Timber.d("发送 ICE Candidate to $peerId")

        val json = org.json.JSONObject().apply {
            put("type", "ice-candidate")
            put("peerId", peerId)
            put("sdpMid", candidate.sdpMid)
            put("sdpMLineIndex", candidate.sdpMLineIndex)
            put("candidate", candidate.sdp)
        }

        sendMessage(json.toString())
    }

    override suspend fun waitForAnswer(peerId: String, timeout: Long): org.webrtc.SessionDescription {
        Timber.d("等待 Answer from $peerId")
        return withTimeout(timeout) {
            answerChannel.receive()
        }
    }

    /**
     * 接收 ICE Candidate（用于处理远端发来的 ICE）
     */
    suspend fun receiveIceCandidate(): org.webrtc.IceCandidate {
        return iceCandidateChannel.receive()
    }

    /**
     * 发送消息到 WebSocket
     */
    private fun sendMessage(message: String) {
        if (!isConnected) {
            Timber.e("WebSocket 未连接，无法发送消息")
            return
        }

        val sent = webSocket?.send(message) ?: false
        if (sent) {
            Timber.d("✅ 消息已发送: ${message.take(100)}...")
        } else {
            Timber.e("❌ 消息发送失败")
        }
    }

    /**
     * 断开连接
     */
    fun disconnect() {
        Timber.d("断开信令服务器连接")
        webSocket?.close(1000, "Normal closure")
        webSocket = null
        isConnected = false
    }
}
