package com.chainlesschain.android.feature.p2p.webrtc.connection

import android.content.Context
import com.chainlesschain.android.feature.p2p.webrtc.signaling.SignalingClient
import com.chainlesschain.android.feature.p2p.webrtc.signaling.SignalingMessage
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import org.webrtc.*
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

/**
 * WebRTC peer connection manager
 *
 * Manages the lifecycle of WebRTC peer connections:
 * - Creates and configures peer connections
 * - Handles SDP offer/answer exchange
 * - Manages ICE candidate gathering and exchange
 * - Monitors connection state
 * - Automatic reconnection and recovery
 * - Offline message queue integration
 */
@Singleton
class WebRTCConnectionManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val signalingClient: SignalingClient
) {
    companion object {
        private const val MAX_RECONNECT_ATTEMPTS = 3
        private const val RECONNECT_DELAY_MS = 2000L
        private const val CONNECTION_TIMEOUT_MS = 30_000L
        private const val ICE_RESTART_DELAY_MS = 5000L
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private val peerConnectionFactory: PeerConnectionFactory by lazy {
        initializePeerConnectionFactory()
    }

    private val peerConnections = mutableMapOf<String, PeerConnection>()
    private val pendingIceCandidates = mutableMapOf<String, MutableList<IceCandidate>>()

    // 连接恢复状态
    private val reconnectAttempts = mutableMapOf<String, Int>()
    private val reconnectJobs = mutableMapOf<String, Job>()
    private val connectionTimeoutJobs = mutableMapOf<String, Job>()

    private val _connectionStates = MutableStateFlow<Map<String, PeerConnectionState>>(emptyMap())
    val connectionStates: StateFlow<Map<String, PeerConnectionState>> = _connectionStates.asStateFlow()

    // 连接事件流
    private val _connectionEvents = MutableSharedFlow<ConnectionEvent>(extraBufferCapacity = 64)
    val connectionEvents: SharedFlow<ConnectionEvent> = _connectionEvents.asSharedFlow()

    // 本地用户 ID 缓存
    private var cachedLocalUserId: String? = null

    init {
        // Listen for signaling messages
        scope.launch {
            signalingClient.incomingMessages.collect { message ->
                handleSignalingMessage(message)
            }
        }

        // 监控连接状态变化
        scope.launch {
            connectionStates.collect { states ->
                states.forEach { (peerId, state) ->
                    when (state) {
                        PeerConnectionState.FAILED -> handleConnectionFailed(peerId)
                        PeerConnectionState.DISCONNECTED -> handleConnectionDisconnected(peerId)
                        PeerConnectionState.CONNECTED, PeerConnectionState.COMPLETED -> {
                            // 连接成功，重置重连计数
                            reconnectAttempts.remove(peerId)
                            connectionTimeoutJobs[peerId]?.cancel()
                            connectionTimeoutJobs.remove(peerId)
                            scope.launch {
                                _connectionEvents.emit(ConnectionEvent.Connected(peerId))
                            }
                        }
                        else -> {}
                    }
                }
            }
        }
    }

    /**
     * Create a peer connection and send an offer
     *
     * @param remotePeerId Remote peer's DID
     * @param localUserId Local user's DID
     * @return Result containing the created peer connection
     */
    suspend fun createOffer(remotePeerId: String, localUserId: String): Result<Unit> {
        return withContext(Dispatchers.Default) {
            try {
                Timber.d("Creating offer for peer: $remotePeerId")

                // 缓存本地用户 ID 用于重连
                cachedLocalUserId = localUserId

                // 启动连接超时监控
                startConnectionTimeout(remotePeerId)

                val peerConnection = getOrCreatePeerConnection(remotePeerId, localUserId)

                // Create offer
                val offerSdp = suspendCancellableCoroutine { continuation ->
                    peerConnection.createOffer(object : SdpObserver {
                        override fun onCreateSuccess(sdp: SessionDescription?) {
                            continuation.resume(sdp, null)
                        }

                        override fun onCreateFailure(error: String?) {
                            continuation.resumeWith(Result.failure(Exception("Failed to create offer: $error")))
                        }

                        override fun onSetSuccess() {}
                        override fun onSetFailure(error: String?) {}
                    }, MediaConstraints())
                }

                // Set local description
                suspendCancellableCoroutine<Unit> { continuation ->
                    peerConnection.setLocalDescription(object : SdpObserver {
                        override fun onSetSuccess() {
                            continuation.resume(Unit, null)
                        }

                        override fun onSetFailure(error: String?) {
                            continuation.resumeWith(Result.failure(Exception("Failed to set local description: $error")))
                        }

                        override fun onCreateSuccess(sdp: SessionDescription?) {}
                        override fun onCreateFailure(error: String?) {}
                    }, offerSdp)
                }

                // Send offer via signaling
                val offerMessage = SignalingMessage.Offer(
                    from = localUserId,
                    to = remotePeerId,
                    sdp = offerSdp?.description ?: throw Exception("Offer SDP is null")
                )
                signalingClient.send(offerMessage)

                Timber.i("Offer created and sent to $remotePeerId")
                Result.success(Unit)
            } catch (e: Exception) {
                Timber.e(e, "Failed to create offer for $remotePeerId")
                Result.failure(e)
            }
        }
    }

    /**
     * Handle incoming offer and send answer
     */
    private suspend fun handleOffer(offer: SignalingMessage.Offer) {
        withContext(Dispatchers.Default) {
            try {
                Timber.d("Handling offer from ${offer.from}")

                val peerConnection = getOrCreatePeerConnection(offer.from, offer.to)

                // Set remote description
                val remoteSdp = SessionDescription(
                    SessionDescription.Type.OFFER,
                    offer.sdp
                )

                suspendCancellableCoroutine<Unit> { continuation ->
                    peerConnection.setRemoteDescription(object : SdpObserver {
                        override fun onSetSuccess() {
                            continuation.resume(Unit, null)
                        }

                        override fun onSetFailure(error: String?) {
                            continuation.resumeWith(Result.failure(Exception("Failed to set remote description: $error")))
                        }

                        override fun onCreateSuccess(sdp: SessionDescription?) {}
                        override fun onCreateFailure(error: String?) {}
                    }, remoteSdp)
                }

                // Create answer
                val answerSdp = suspendCancellableCoroutine { continuation ->
                    peerConnection.createAnswer(object : SdpObserver {
                        override fun onCreateSuccess(sdp: SessionDescription?) {
                            continuation.resume(sdp, null)
                        }

                        override fun onCreateFailure(error: String?) {
                            continuation.resumeWith(Result.failure(Exception("Failed to create answer: $error")))
                        }

                        override fun onSetSuccess() {}
                        override fun onSetFailure(error: String?) {}
                    }, MediaConstraints())
                }

                // Set local description
                suspendCancellableCoroutine<Unit> { continuation ->
                    peerConnection.setLocalDescription(object : SdpObserver {
                        override fun onSetSuccess() {
                            continuation.resume(Unit, null)
                        }

                        override fun onSetFailure(error: String?) {
                            continuation.resumeWith(Result.failure(Exception("Failed to set local description: $error")))
                        }

                        override fun onCreateSuccess(sdp: SessionDescription?) {}
                        override fun onCreateFailure(error: String?) {}
                    }, answerSdp)
                }

                // Add pending ICE candidates
                val pending = pendingIceCandidates.remove(offer.from)
                pending?.forEach { candidate ->
                    peerConnection.addIceCandidate(candidate)
                    Timber.d("Added pending ICE candidate from ${offer.from}")
                }

                // Send answer via signaling
                val answerMessage = SignalingMessage.Answer(
                    from = offer.to,
                    to = offer.from,
                    sdp = answerSdp?.description ?: throw Exception("Answer SDP is null")
                )
                signalingClient.send(answerMessage)

                Timber.i("Answer created and sent to ${offer.from}")
            } catch (e: Exception) {
                Timber.e(e, "Failed to handle offer from ${offer.from}")
            }
        }
    }

    /**
     * Handle incoming answer
     */
    private suspend fun handleAnswer(answer: SignalingMessage.Answer) {
        withContext(Dispatchers.Default) {
            try {
                Timber.d("Handling answer from ${answer.from}")

                val peerConnection = peerConnections[answer.from]
                if (peerConnection == null) {
                    Timber.w("No peer connection found for ${answer.from}")
                    return@withContext
                }

                // Set remote description
                val remoteSdp = SessionDescription(
                    SessionDescription.Type.ANSWER,
                    answer.sdp
                )

                suspendCancellableCoroutine<Unit> { continuation ->
                    peerConnection.setRemoteDescription(object : SdpObserver {
                        override fun onSetSuccess() {
                            continuation.resume(Unit, null)
                        }

                        override fun onSetFailure(error: String?) {
                            continuation.resumeWith(Result.failure(Exception("Failed to set remote description: $error")))
                        }

                        override fun onCreateSuccess(sdp: SessionDescription?) {}
                        override fun onCreateFailure(error: String?) {}
                    }, remoteSdp)
                }

                // Add pending ICE candidates
                val pending = pendingIceCandidates.remove(answer.from)
                pending?.forEach { candidate ->
                    peerConnection.addIceCandidate(candidate)
                    Timber.d("Added pending ICE candidate from ${answer.from}")
                }

                Timber.i("Answer processed from ${answer.from}")
            } catch (e: Exception) {
                Timber.e(e, "Failed to handle answer from ${answer.from}")
            }
        }
    }

    /**
     * Handle incoming ICE candidate
     */
    private suspend fun handleIceCandidate(candidateMessage: SignalingMessage.IceCandidate) {
        withContext(Dispatchers.Default) {
            try {
                Timber.d("Handling ICE candidate from ${candidateMessage.from}")

                val peerConnection = peerConnections[candidateMessage.from]
                val iceCandidate = IceCandidate(
                    candidateMessage.sdpMid,
                    candidateMessage.sdpMLineIndex,
                    candidateMessage.candidate
                )

                if (peerConnection?.remoteDescription != null) {
                    // Remote description is set, add candidate immediately
                    peerConnection.addIceCandidate(iceCandidate)
                    Timber.d("Added ICE candidate from ${candidateMessage.from}")
                } else {
                    // Remote description not set yet, queue candidate
                    pendingIceCandidates
                        .getOrPut(candidateMessage.from) { mutableListOf() }
                        .add(iceCandidate)
                    Timber.d("Queued ICE candidate from ${candidateMessage.from} (remote description not set)")
                }
            } catch (e: Exception) {
                Timber.e(e, "Failed to handle ICE candidate from ${candidateMessage.from}")
            }
        }
    }

    /**
     * Handle incoming bye message
     */
    private suspend fun handleBye(bye: SignalingMessage.Bye) {
        withContext(Dispatchers.Default) {
            Timber.i("Received BYE from ${bye.from}: ${bye.reason}")
            closePeerConnection(bye.from)
        }
    }

    /**
     * Close peer connection
     */
    suspend fun closePeerConnection(remotePeerId: String) {
        withContext(Dispatchers.Default) {
            peerConnections.remove(remotePeerId)?.apply {
                close()
                dispose()
                Timber.i("Closed peer connection with $remotePeerId")
            }
            pendingIceCandidates.remove(remotePeerId)

            // Update state
            val newStates = _connectionStates.value.toMutableMap()
            newStates.remove(remotePeerId)
            _connectionStates.value = newStates
        }
    }

    /**
     * Handle signaling messages
     */
    private suspend fun handleSignalingMessage(message: SignalingMessage) {
        when (message) {
            is SignalingMessage.Offer -> handleOffer(message)
            is SignalingMessage.Answer -> handleAnswer(message)
            is SignalingMessage.IceCandidate -> handleIceCandidate(message)
            is SignalingMessage.Bye -> handleBye(message)
            else -> Timber.v("Ignoring signaling message: ${message::class.simpleName}")
        }
    }

    /**
     * Get or create peer connection for remote peer
     */
    private fun getOrCreatePeerConnection(remotePeerId: String, localUserId: String): PeerConnection {
        return peerConnections.getOrPut(remotePeerId) {
            createPeerConnection(remotePeerId, localUserId)
        }
    }

    /**
     * Create a new peer connection
     */
    private fun createPeerConnection(remotePeerId: String, localUserId: String): PeerConnection {
        val iceServers = mutableListOf(
            // Google STUN servers
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun1.l.google.com:19302").createIceServer(),
            // Public TURN server for NAT traversal in restrictive networks
            PeerConnection.IceServer.builder("turn:openrelay.metered.ca:80")
                .setUsername("openrelayproject")
                .setPassword("openrelayproject")
                .createIceServer(),
            PeerConnection.IceServer.builder("turn:openrelay.metered.ca:443?transport=tcp")
                .setUsername("openrelayproject")
                .setPassword("openrelayproject")
                .createIceServer()
        )

        val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
            iceTransportsType = PeerConnection.IceTransportsType.ALL
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE
            tcpCandidatePolicy = PeerConnection.TcpCandidatePolicy.ENABLED
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }

        val peerConnection = peerConnectionFactory.createPeerConnection(
            rtcConfig,
            createPeerConnectionObserver(remotePeerId, localUserId)
        ) ?: throw IllegalStateException("Failed to create peer connection")

        updateConnectionState(remotePeerId, PeerConnectionState.NEW)
        Timber.d("Created peer connection for $remotePeerId")

        return peerConnection
    }

    /**
     * Create peer connection observer
     */
    private fun createPeerConnectionObserver(
        remotePeerId: String,
        localUserId: String
    ): PeerConnection.Observer {
        return object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate?) {
                candidate?.let {
                    scope.launch {
                        val message = SignalingMessage.IceCandidate(
                            from = localUserId,
                            to = remotePeerId,
                            candidate = it.sdp,
                            sdpMid = it.sdpMid,
                            sdpMLineIndex = it.sdpMLineIndex
                        )
                        signalingClient.send(message)
                        Timber.d("Sent ICE candidate to $remotePeerId")
                    }
                }
            }

            override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState?) {
                Timber.i("ICE connection state changed: $newState for $remotePeerId")
                newState?.let {
                    updateConnectionState(remotePeerId, it.toPeerConnectionState())
                }
            }

            override fun onIceConnectionReceivingChange(receiving: Boolean) {
                Timber.d("ICE connection receiving change: $receiving for $remotePeerId")
            }

            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) {
                Timber.i("Peer connection state changed: $newState for $remotePeerId")
            }

            override fun onDataChannel(dataChannel: DataChannel?) {
                Timber.d("Data channel received: ${dataChannel?.label()}")
            }

            override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState?) {
                Timber.d("ICE gathering state: $newState for $remotePeerId")
            }

            override fun onSignalingChange(newState: PeerConnection.SignalingState?) {
                Timber.d("Signaling state: $newState for $remotePeerId")
            }

            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {
                Timber.d("ICE candidates removed: ${candidates?.size} for $remotePeerId")
            }

            override fun onAddStream(stream: MediaStream?) {
                Timber.d("Media stream added: ${stream?.id}")
            }

            override fun onRemoveStream(stream: MediaStream?) {
                Timber.d("Media stream removed: ${stream?.id}")
            }

            override fun onRenegotiationNeeded() {
                Timber.d("Renegotiation needed for $remotePeerId")
            }

            override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {
                Timber.d("Track added: ${receiver?.id()}")
            }
        }
    }

    /**
     * Initialize peer connection factory
     */
    private fun initializePeerConnectionFactory(): PeerConnectionFactory {
        val options = PeerConnectionFactory.InitializationOptions.builder(context)
            .setEnableInternalTracer(false)
            .createInitializationOptions()

        PeerConnectionFactory.initialize(options)

        return PeerConnectionFactory.builder()
            .setOptions(PeerConnectionFactory.Options().apply {
                disableEncryption = false
                disableNetworkMonitor = false
            })
            .createPeerConnectionFactory()
    }

    /**
     * Update connection state
     */
    private fun updateConnectionState(peerId: String, state: PeerConnectionState) {
        val newStates = _connectionStates.value.toMutableMap()
        newStates[peerId] = state
        _connectionStates.value = newStates
    }

    /**
     * Get peer connection by peer ID
     */
    fun getPeerConnection(peerId: String): PeerConnection? {
        return peerConnections[peerId]
    }

    /**
     * 处理连接失败
     */
    private fun handleConnectionFailed(peerId: String) {
        val attempts = reconnectAttempts.getOrDefault(peerId, 0)

        if (attempts < MAX_RECONNECT_ATTEMPTS) {
            Timber.w("Connection failed for $peerId, scheduling reconnect (attempt ${attempts + 1}/$MAX_RECONNECT_ATTEMPTS)")

            reconnectJobs[peerId]?.cancel()
            reconnectJobs[peerId] = scope.launch {
                delay(RECONNECT_DELAY_MS * (attempts + 1))
                attemptReconnect(peerId)
            }
        } else {
            Timber.e("Connection failed for $peerId after $MAX_RECONNECT_ATTEMPTS attempts")
            scope.launch {
                _connectionEvents.emit(ConnectionEvent.Failed(peerId, "Max reconnect attempts reached"))
            }
            cleanupPeerConnection(peerId)
        }
    }

    /**
     * 处理连接断开（可能是临时的）
     */
    private fun handleConnectionDisconnected(peerId: String) {
        Timber.w("Connection disconnected for $peerId, waiting for recovery...")

        // 给连接一些时间自动恢复
        reconnectJobs[peerId]?.cancel()
        reconnectJobs[peerId] = scope.launch {
            delay(ICE_RESTART_DELAY_MS)

            // 检查是否仍然断开
            val currentState = _connectionStates.value[peerId]
            if (currentState == PeerConnectionState.DISCONNECTED) {
                Timber.i("Connection still disconnected for $peerId, attempting ICE restart")
                attemptIceRestart(peerId)
            }
        }
    }

    /**
     * 尝试重新连接
     */
    private suspend fun attemptReconnect(peerId: String) {
        val localUserId = cachedLocalUserId ?: return

        Timber.i("Attempting reconnect to $peerId")
        reconnectAttempts[peerId] = reconnectAttempts.getOrDefault(peerId, 0) + 1

        scope.launch {
            _connectionEvents.emit(ConnectionEvent.Reconnecting(peerId, reconnectAttempts[peerId] ?: 1))
        }

        // 关闭旧连接
        closePeerConnection(peerId)

        // 创建新的 offer
        val result = createOffer(peerId, localUserId)
        if (result.isFailure) {
            Timber.e(result.exceptionOrNull(), "Failed to create offer during reconnect")
            handleConnectionFailed(peerId)
        }
    }

    /**
     * 尝试 ICE 重启
     */
    private suspend fun attemptIceRestart(peerId: String) {
        val peerConnection = peerConnections[peerId] ?: return
        val localUserId = cachedLocalUserId ?: return

        Timber.i("Attempting ICE restart for $peerId")

        scope.launch {
            _connectionEvents.emit(ConnectionEvent.IceRestarting(peerId))
        }

        try {
            // 创建带 ICE restart 的新 offer
            val constraints = MediaConstraints().apply {
                mandatory.add(MediaConstraints.KeyValuePair("IceRestart", "true"))
            }

            val offerSdp = suspendCancellableCoroutine { continuation ->
                peerConnection.createOffer(object : SdpObserver {
                    override fun onCreateSuccess(sdp: SessionDescription?) {
                        continuation.resume(sdp, null)
                    }

                    override fun onCreateFailure(error: String?) {
                        continuation.resumeWith(Result.failure(Exception("Failed to create ICE restart offer: $error")))
                    }

                    override fun onSetSuccess() {}
                    override fun onSetFailure(error: String?) {}
                }, constraints)
            }

            // 设置本地描述
            suspendCancellableCoroutine<Unit> { continuation ->
                peerConnection.setLocalDescription(object : SdpObserver {
                    override fun onSetSuccess() {
                        continuation.resume(Unit, null)
                    }

                    override fun onSetFailure(error: String?) {
                        continuation.resumeWith(Result.failure(Exception("Failed to set local description: $error")))
                    }

                    override fun onCreateSuccess(sdp: SessionDescription?) {}
                    override fun onCreateFailure(error: String?) {}
                }, offerSdp)
            }

            // 发送 offer
            val offerMessage = SignalingMessage.Offer(
                from = localUserId,
                to = peerId,
                sdp = offerSdp?.description ?: throw Exception("Offer SDP is null")
            )
            signalingClient.send(offerMessage)

            Timber.i("ICE restart offer sent to $peerId")
        } catch (e: Exception) {
            Timber.e(e, "ICE restart failed for $peerId")
            handleConnectionFailed(peerId)
        }
    }

    /**
     * 清理单个对等连接
     */
    private fun cleanupPeerConnection(peerId: String) {
        reconnectJobs[peerId]?.cancel()
        reconnectJobs.remove(peerId)
        connectionTimeoutJobs[peerId]?.cancel()
        connectionTimeoutJobs.remove(peerId)
        reconnectAttempts.remove(peerId)
        pendingIceCandidates.remove(peerId)

        peerConnections.remove(peerId)?.apply {
            close()
            dispose()
        }

        val newStates = _connectionStates.value.toMutableMap()
        newStates.remove(peerId)
        _connectionStates.value = newStates
    }

    /**
     * 启动连接超时监控
     */
    private fun startConnectionTimeout(peerId: String) {
        connectionTimeoutJobs[peerId]?.cancel()
        connectionTimeoutJobs[peerId] = scope.launch {
            delay(CONNECTION_TIMEOUT_MS)

            val currentState = _connectionStates.value[peerId]
            if (currentState != PeerConnectionState.CONNECTED && currentState != PeerConnectionState.COMPLETED) {
                Timber.e("Connection timeout for $peerId")
                scope.launch {
                    _connectionEvents.emit(ConnectionEvent.Timeout(peerId))
                }
                handleConnectionFailed(peerId)
            }
        }
    }

    /**
     * 获取连接统计信息
     */
    fun getConnectionStats(): ConnectionStats {
        val states = _connectionStates.value
        return ConnectionStats(
            totalConnections = peerConnections.size,
            connectedCount = states.count { it.value == PeerConnectionState.CONNECTED || it.value == PeerConnectionState.COMPLETED },
            connectingCount = states.count { it.value == PeerConnectionState.NEW || it.value == PeerConnectionState.CHECKING },
            failedCount = states.count { it.value == PeerConnectionState.FAILED },
            disconnectedCount = states.count { it.value == PeerConnectionState.DISCONNECTED }
        )
    }

    /**
     * 手动触发重连
     */
    suspend fun reconnect(peerId: String, localUserId: String): Result<Unit> {
        cachedLocalUserId = localUserId
        reconnectAttempts[peerId] = 0
        return withContext(Dispatchers.Default) {
            try {
                attemptReconnect(peerId)
                Result.success(Unit)
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }

    /**
     * Cleanup resources
     */
    fun cleanup() {
        // 取消所有重连任务
        reconnectJobs.values.forEach { it.cancel() }
        reconnectJobs.clear()
        connectionTimeoutJobs.values.forEach { it.cancel() }
        connectionTimeoutJobs.clear()
        reconnectAttempts.clear()

        scope.cancel()
        peerConnections.values.forEach { pc ->
            pc.close()
            pc.dispose()
        }
        peerConnections.clear()
        pendingIceCandidates.clear()
        peerConnectionFactory.dispose()
    }
}

/**
 * 连接事件
 */
sealed class ConnectionEvent {
    data class Connected(val peerId: String) : ConnectionEvent()
    data class Disconnected(val peerId: String) : ConnectionEvent()
    data class Failed(val peerId: String, val reason: String) : ConnectionEvent()
    data class Reconnecting(val peerId: String, val attempt: Int) : ConnectionEvent()
    data class IceRestarting(val peerId: String) : ConnectionEvent()
    data class Timeout(val peerId: String) : ConnectionEvent()
}

/**
 * 连接统计
 */
data class ConnectionStats(
    val totalConnections: Int,
    val connectedCount: Int,
    val connectingCount: Int,
    val failedCount: Int,
    val disconnectedCount: Int
)

/**
 * Peer connection state
 */
enum class PeerConnectionState {
    NEW,
    CHECKING,
    CONNECTED,
    COMPLETED,
    FAILED,
    DISCONNECTED,
    CLOSED
}

/**
 * Convert WebRTC IceConnectionState to PeerConnectionState
 */
private fun PeerConnection.IceConnectionState.toPeerConnectionState(): PeerConnectionState {
    return when (this) {
        PeerConnection.IceConnectionState.NEW -> PeerConnectionState.NEW
        PeerConnection.IceConnectionState.CHECKING -> PeerConnectionState.CHECKING
        PeerConnection.IceConnectionState.CONNECTED -> PeerConnectionState.CONNECTED
        PeerConnection.IceConnectionState.COMPLETED -> PeerConnectionState.COMPLETED
        PeerConnection.IceConnectionState.FAILED -> PeerConnectionState.FAILED
        PeerConnection.IceConnectionState.DISCONNECTED -> PeerConnectionState.DISCONNECTED
        PeerConnection.IceConnectionState.CLOSED -> PeerConnectionState.CLOSED
    }
}

