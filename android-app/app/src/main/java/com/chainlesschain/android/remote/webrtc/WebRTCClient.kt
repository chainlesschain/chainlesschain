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
    suspend fun sendOffer(peerId: String, offer: SessionDescription)
    suspend fun sendIceCandidate(peerId: String, candidate: IceCandidate)
    suspend fun waitForAnswer(peerId: String, timeout: Long): SessionDescription
}

/**
 * 简化的信令客户端实现（基于 WebSocket）
 */
class WebSocketSignalClient @Inject constructor() : SignalClient {
    // TODO: 实现实际的 WebSocket 连接
    private val answerChannel = kotlinx.coroutines.channels.Channel<SessionDescription>(1)

    override suspend fun sendOffer(peerId: String, offer: SessionDescription) {
        Timber.d("发送 Offer to $peerId")
        // TODO: 通过 WebSocket 发送
    }

    override suspend fun sendIceCandidate(peerId: String, candidate: IceCandidate) {
        Timber.d("发送 ICE Candidate to $peerId")
        // TODO: 通过 WebSocket 发送
    }

    override suspend fun waitForAnswer(peerId: String, timeout: Long): SessionDescription {
        Timber.d("等待 Answer from $peerId")
        // TODO: 从 WebSocket 接收
        return withTimeout(timeout) {
            answerChannel.receive()
        }
    }
}
