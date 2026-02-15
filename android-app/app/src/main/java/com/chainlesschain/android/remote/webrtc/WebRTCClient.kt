package com.chainlesschain.android.remote.webrtc

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import org.webrtc.*
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * WebRTC P2P connection state tracking
 */
enum class P2PConnectionState {
    DISCONNECTED,
    SIGNALING_CONNECTED,
    REGISTERED,
    CREATING_OFFER,
    WAITING_ANSWER,
    ICE_CONNECTING,
    DATA_CHANNEL_OPEN,
    READY,
    FAILED
}

@Singleton
class WebRTCClient @Inject constructor(
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: android.content.Context,
    private val signalClient: SignalClient
) {
    private var peerConnectionFactory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var dataChannel: DataChannel? = null

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var remoteIceJob: Job? = null
    private val pendingRemoteCandidates = mutableListOf<IceCandidate>()
    @Volatile
    private var isRemoteDescriptionSet = false

    private val iceServers = listOf(
        PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
        PeerConnection.IceServer.builder("stun:stun1.l.google.com:19302").createIceServer()
    )

    private var onMessageReceived: ((String) -> Unit)? = null
    private var onDisconnected: (() -> Unit)? = null

    private val _connectionState = MutableStateFlow(P2PConnectionState.DISCONNECTED)
    val connectionState: StateFlow<P2PConnectionState> = _connectionState.asStateFlow()

    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 64)
    val messages: SharedFlow<String> = _messages.asSharedFlow()

    companion object {
        private const val DATA_CHANNEL_LABEL = "chainlesschain-data"
    }

    fun initialize() {
        Timber.d("Initializing WebRTC")

        try {
            val initializationOptions = PeerConnectionFactory.InitializationOptions
                .builder(context)
                .setEnableInternalTracer(true)
                .createInitializationOptions()

            PeerConnectionFactory.initialize(initializationOptions)

            val options = PeerConnectionFactory.Options()
            peerConnectionFactory = PeerConnectionFactory.builder()
                .setOptions(options)
                .createPeerConnectionFactory()

            // 设置信令服务器转发消息的回调
            signalClient.setOnForwardedMessageReceived { message ->
                Timber.d("Received forwarded message via signaling: ${message.take(100)}...")
                onMessageReceived?.invoke(message)
                _messages.tryEmit(message)
            }

            Timber.d("WebRTC init success")
        } catch (e: Exception) {
            Timber.e(e, "WebRTC init failed")
            throw e
        }
    }

    suspend fun connect(pcPeerId: String, localPeerId: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            Timber.i("========================================")
            Timber.i("Starting P2P connection to PC: $pcPeerId")
            Timber.i("Local peer ID: $localPeerId")
            Timber.i("========================================")

            // 1. Connect to signaling server
            Timber.i("[Step 1/5] Connecting to signaling server...")
            val connectResult = signalClient.connect()
            if (connectResult.isFailure) {
                val error = connectResult.exceptionOrNull() ?: Exception("Signal server connect failed")
                Timber.e("[Step 1/5] FAILED: ${error.message}")
                _connectionState.value = P2PConnectionState.FAILED
                return@withContext Result.failure(Exception("信令服务器连接失败: ${error.message}"))
            }
            _connectionState.value = P2PConnectionState.SIGNALING_CONNECTED
            Timber.i("[Step 1/5] ✓ Signaling server connected")

            // 2. Register with signaling server
            Timber.i("[Step 2/5] Registering as $localPeerId...")
            signalClient.register(localPeerId, mapOf(
                "name" to android.os.Build.MODEL,
                "platform" to "android",
                "version" to android.os.Build.VERSION.RELEASE
            ))
            _connectionState.value = P2PConnectionState.REGISTERED
            Timber.i("[Step 2/5] ✓ Registered successfully")

            // 3. Create PeerConnection and DataChannel
            Timber.i("[Step 3/5] Creating PeerConnection and DataChannel...")
            createPeerConnection(pcPeerId)
            createDataChannel()
            startRemoteIceListener()
            Timber.i("[Step 3/5] ✓ PeerConnection and DataChannel created")

            // 4. Create and send offer
            Timber.i("[Step 4/5] Creating and sending offer to $pcPeerId...")
            _connectionState.value = P2PConnectionState.CREATING_OFFER
            val offer = createOffer()
            signalClient.sendOffer(pcPeerId, offer)
            Timber.i("[Step 4/5] ✓ Offer sent")

            // 5. Wait for answer
            Timber.i("[Step 5/5] Waiting for answer from PC (15s timeout)...")
            _connectionState.value = P2PConnectionState.WAITING_ANSWER
            val answer = signalClient.waitForAnswer(pcPeerId, timeout = 15000)
            Timber.i("[Step 5/5] ✓ Answer received, setting remote description...")
            setRemoteDescription(answer)
            isRemoteDescriptionSet = true
            drainPendingRemoteCandidates()

            _connectionState.value = P2PConnectionState.ICE_CONNECTING
            Timber.i("========================================")
            Timber.i("✓ P2P connection initiated, ICE negotiation in progress")
            Timber.i("========================================")
            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e("========================================")
            Timber.e("P2P Connection FAILED: ${e.message}")
            Timber.e(e, "Stack trace:")
            Timber.e("========================================")
            _connectionState.value = P2PConnectionState.FAILED
            // Provide more descriptive error messages
            val errorMessage = when {
                e.message?.contains("timeout", ignoreCase = true) == true -> "PC端未响应，请确保PC应用已启动并连接到同一网络"
                e.message?.contains("connect", ignoreCase = true) == true -> "无法连接到信令服务器，请检查网络设置"
                else -> "连接失败: ${e.message}"
            }
            Result.failure(Exception(errorMessage, e))
        }
    }

    private fun createPeerConnection(pcPeerId: String) {
        Timber.d("Creating peer connection")

        val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }

        peerConnection = peerConnectionFactory?.createPeerConnection(
            rtcConfig,
            object : PeerConnection.Observer {
                override fun onIceCandidate(candidate: IceCandidate) {
                    Timber.d("ICE candidate generated")
                    scope.launch {
                        signalClient.sendIceCandidate(pcPeerId, candidate)
                    }
                }

                override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
                    Timber.d("Connection state: $newState")
                    when (newState) {
                        PeerConnection.PeerConnectionState.FAILED -> {
                            _connectionState.value = P2PConnectionState.FAILED
                            notifyDisconnection()
                        }
                        PeerConnection.PeerConnectionState.DISCONNECTED -> {
                            _connectionState.value = P2PConnectionState.DISCONNECTED
                            notifyDisconnection()
                        }
                        else -> { /* handled by other callbacks */ }
                    }
                }

                override fun onDataChannel(dc: DataChannel) {
                    Timber.d("Data channel received: ${dc.label()}")
                    dataChannel = dc
                    setupDataChannel(dc)
                }

                override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState) {
                    Timber.d("ICE connection state: $newState")
                    when (newState) {
                        PeerConnection.IceConnectionState.CONNECTED,
                        PeerConnection.IceConnectionState.COMPLETED -> {
                            if (_connectionState.value == P2PConnectionState.ICE_CONNECTING) {
                                _connectionState.value = P2PConnectionState.DATA_CHANNEL_OPEN
                            }
                        }
                        PeerConnection.IceConnectionState.FAILED -> {
                            _connectionState.value = P2PConnectionState.FAILED
                            notifyDisconnection()
                        }
                        PeerConnection.IceConnectionState.DISCONNECTED -> {
                            _connectionState.value = P2PConnectionState.DISCONNECTED
                            notifyDisconnection()
                        }
                        else -> {}
                    }
                }

                override fun onIceConnectionReceivingChange(receiving: Boolean) {
                    Timber.d("ICE receiving: $receiving")
                }

                override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {
                    Timber.d("ICE candidates removed: ${candidates.size}")
                }

                override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState) {
                    Timber.d("ICE gathering: $newState")
                }

                override fun onSignalingChange(newState: PeerConnection.SignalingState) {
                    Timber.d("Signaling state: $newState")
                }

                override fun onAddStream(stream: MediaStream) {}
                override fun onRemoveStream(stream: MediaStream) {}

                override fun onRenegotiationNeeded() {
                    Timber.d("Renegotiation needed")
                }

                override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) {}
            }
        )

        Timber.d("Peer connection created")
    }

    private fun createDataChannel() {
        Timber.d("Creating data channel")

        val init = DataChannel.Init().apply {
            ordered = true
            maxRetransmits = -1
        }

        dataChannel = peerConnection?.createDataChannel(DATA_CHANNEL_LABEL, init)
        dataChannel?.let { setupDataChannel(it) }

        Timber.d("Data channel created")
    }

    private fun setupDataChannel(channel: DataChannel) {
        Timber.d("Setting up data channel")

        channel.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(amount: Long) {}

            override fun onStateChange() {
                val state = channel.state()
                Timber.d("Data channel state: $state")
                if (state == DataChannel.State.OPEN) {
                    _connectionState.value = P2PConnectionState.READY
                }
            }

            override fun onMessage(buffer: DataChannel.Buffer) {
                try {
                    val data = ByteArray(buffer.data.remaining())
                    buffer.data.get(data)
                    val message = String(data, Charsets.UTF_8)

                    Timber.d("Message received: ${message.take(50)}...")
                    onMessageReceived?.invoke(message)
                    _messages.tryEmit(message)
                } catch (e: Exception) {
                    Timber.e(e, "Handle message failed")
                }
            }
        })
    }

    private suspend fun createOffer(): SessionDescription = suspendCancellableCoroutine { continuation ->
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "false"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"))
        }

        peerConnection?.createOffer(object : SdpObserver {
            override fun onCreateSuccess(sdp: SessionDescription) {
                Timber.d("Offer created")

                peerConnection?.setLocalDescription(object : SdpObserver {
                    override fun onSetSuccess() {
                        Timber.d("Local description set")
                        continuation.resume(sdp) {}
                    }

                    override fun onSetFailure(error: String) {
                        Timber.e("Set local description failed: $error")
                        continuation.resumeWith(Result.failure(Exception(error)))
                    }

                    override fun onCreateSuccess(p0: SessionDescription?) {}
                    override fun onCreateFailure(p0: String?) {}
                }, sdp)
            }

            override fun onCreateFailure(error: String) {
                Timber.e("Create offer failed: $error")
                continuation.resumeWith(Result.failure(Exception(error)))
            }

            override fun onSetSuccess() {}
            override fun onSetFailure(p0: String?) {}
        }, constraints)
    }

    private suspend fun setRemoteDescription(answer: SessionDescription) = suspendCancellableCoroutine<Unit> { continuation ->
        peerConnection?.setRemoteDescription(object : SdpObserver {
            override fun onSetSuccess() {
                Timber.d("Remote description set")
                continuation.resume(Unit) {}
            }

            override fun onSetFailure(error: String) {
                Timber.e("Set remote description failed: $error")
                continuation.resumeWith(Result.failure(Exception(error)))
            }

            override fun onCreateSuccess(p0: SessionDescription?) {}
            override fun onCreateFailure(p0: String?) {}
        }, answer)
    }

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
        Timber.d("Message sent: ${message.take(50)}...")
    }

    fun setOnMessageReceived(callback: (String) -> Unit) {
        this.onMessageReceived = callback
    }

    fun setOnDisconnected(callback: () -> Unit) {
        this.onDisconnected = callback
    }

    private fun notifyDisconnection() {
        onDisconnected?.invoke()
    }

    fun disconnect() {
        Timber.d("Disconnecting")

        remoteIceJob?.cancel()
        remoteIceJob = null
        pendingRemoteCandidates.clear()
        isRemoteDescriptionSet = false

        dataChannel?.close()
        dataChannel = null

        peerConnection?.close()
        peerConnection = null

        signalClient.disconnect()
        _connectionState.value = P2PConnectionState.DISCONNECTED
    }

    fun cleanup() {
        Timber.d("Cleanup")

        disconnect()
        scope.coroutineContext[Job]?.cancelChildren()

        peerConnectionFactory?.dispose()
        peerConnectionFactory = null
    }

    private fun startRemoteIceListener() {
        remoteIceJob?.cancel()
        remoteIceJob = scope.launch {
            while (isActive) {
                try {
                    val candidate = signalClient.receiveIceCandidate()
                    if (isRemoteDescriptionSet) {
                        peerConnection?.addIceCandidate(candidate)
                    } else {
                        pendingRemoteCandidates.add(candidate)
                    }
                } catch (e: Exception) {
                    Timber.w(e, "Receive remote ICE failed")
                    delay(250)
                }
            }
        }
    }

    private fun drainPendingRemoteCandidates() {
        if (pendingRemoteCandidates.isEmpty()) return
        val iterator = pendingRemoteCandidates.iterator()
        while (iterator.hasNext()) {
            val candidate = iterator.next()
            peerConnection?.addIceCandidate(candidate)
            iterator.remove()
        }
    }
}

interface SignalClient {
    suspend fun connect(): Result<Unit>
    suspend fun register(peerId: String, deviceInfo: Map<String, String>)
    suspend fun sendOffer(peerId: String, offer: org.webrtc.SessionDescription)
    suspend fun sendIceCandidate(peerId: String, candidate: org.webrtc.IceCandidate)
    suspend fun waitForAnswer(peerId: String, timeout: Long): org.webrtc.SessionDescription
    suspend fun receiveIceCandidate(): org.webrtc.IceCandidate
    fun disconnect()
    fun setOnForwardedMessageReceived(callback: ((String) -> Unit)?)
}

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

    // General-purpose scope for callback dispatching
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // Application-layer heartbeat
    private val heartbeatScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var heartbeatJob: Job? = null
    @Volatile
    private var lastPongTime = 0L
    private val missedPongThreshold = 3

    // 用于转发来自信令服务器的 P2P 消息
    private var onForwardedMessageCallback: ((String) -> Unit)? = null

    override fun setOnForwardedMessageReceived(callback: ((String) -> Unit)?) {
        onForwardedMessageCallback = callback
    }

    override suspend fun connect(): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            if (isConnected) {
                Timber.d("Already connected to signaling server")
                return@withContext Result.success(Unit)
            }

            val signalingUrl = signalingConfig.getSignalingUrl()
            Timber.d("Connecting to signaling server: $signalingUrl")

            val request = okhttp3.Request.Builder()
                .url(signalingUrl)
                .build()

            val listener = object : okhttp3.WebSocketListener() {
                override fun onOpen(webSocket: okhttp3.WebSocket, response: okhttp3.Response) {
                    Timber.d("WebSocket connected")
                    isConnected = true
                }

                override fun onMessage(webSocket: okhttp3.WebSocket, text: String) {
                    Timber.d("Signaling message: ${text.take(100)}...")
                    handleSignalingMessage(text)
                }

                override fun onFailure(webSocket: okhttp3.WebSocket, t: Throwable, response: okhttp3.Response?) {
                    Timber.e(t, "WebSocket failed (attempt ${reconnectAttempts + 1}/${com.chainlesschain.android.remote.config.SignalingConfig.MAX_RECONNECT_ATTEMPTS})")
                    isConnected = false
                    stopHeartbeat()

                    if (reconnectAttempts < com.chainlesschain.android.remote.config.SignalingConfig.MAX_RECONNECT_ATTEMPTS) {
                        reconnectAttempts++
                        scope.launch {
                            delay(com.chainlesschain.android.remote.config.SignalingConfig.RECONNECT_DELAY_MS)
                            Timber.d("Reconnecting (${reconnectAttempts}/${com.chainlesschain.android.remote.config.SignalingConfig.MAX_RECONNECT_ATTEMPTS})...")
                            connect()
                        }
                    } else {
                        Timber.e("Max reconnect attempts reached")
                    }
                }

                override fun onClosed(webSocket: okhttp3.WebSocket, code: Int, reason: String) {
                    Timber.d("WebSocket closed code=$code reason=$reason")
                    isConnected = false
                    stopHeartbeat()
                }
            }

            webSocket = okHttpClient.newWebSocket(request, listener)

            var waited = 0
            while (!isConnected && waited < com.chainlesschain.android.remote.config.SignalingConfig.CONNECT_TIMEOUT_MS.toInt()) {
                delay(100)
                waited += 100
            }

            if (isConnected) {
                reconnectAttempts = 0
                startHeartbeat()
                Timber.d("Signaling connected")
                Result.success(Unit)
            } else {
                Result.failure(Exception("Connect timeout"))
            }
        } catch (e: Exception) {
            Timber.e(e, "Connect signaling failed")
            Result.failure(e)
        }
    }

    override suspend fun register(peerId: String, deviceInfo: Map<String, String>) {
        currentPeerId = peerId
        Timber.i("[SignalClient] ========================================")
        Timber.i("[SignalClient] 注册到信令服务器")
        Timber.i("[SignalClient] peerId: $peerId")
        Timber.i("[SignalClient] isConnected: $isConnected")
        Timber.i("[SignalClient] webSocket: ${if (webSocket != null) "存在" else "null"}")
        Timber.i("[SignalClient] ========================================")

        val json = org.json.JSONObject().apply {
            put("type", "register")
            put("peerId", peerId)
            put("deviceType", "mobile")
            put("deviceInfo", org.json.JSONObject().apply {
                deviceInfo.forEach { (key, value) -> put(key, value) }
            })
        }

        sendWebSocketMessage(json.toString())
        Timber.i("[SignalClient] ✓ register 消息已发送")
    }

    private fun handleSignalingMessage(message: String) {
        try {
            val json = org.json.JSONObject(message)
            val type = json.optString("type", "")

            when (type) {
                "registered" -> {
                    val peerId = json.optString("peerId")
                    val isReconnect = json.optBoolean("isReconnect", false)
                    Timber.d("Registered successfully: peerId=$peerId, isReconnect=$isReconnect")
                }

                "answer" -> {
                    // Server forwards answer with nested "answer" or "sdp" object
                    val sdpString = extractSdpFromMessage(json, "answer")
                    if (sdpString != null) {
                        val answer = org.webrtc.SessionDescription(
                            org.webrtc.SessionDescription.Type.ANSWER,
                            sdpString
                        )
                        scope.launch {
                            answerChannel.send(answer)
                        }
                        Timber.d("Answer received")
                    } else {
                        Timber.e("Answer received but could not extract SDP")
                    }
                }

                "ice-candidate" -> {
                    val candidateObj = json.optJSONObject("candidate")
                    if (candidateObj != null) {
                        val sdpMid = candidateObj.optString("sdpMid", "0")
                        val sdpMLineIndex = candidateObj.optInt("sdpMLineIndex", 0)
                        val sdp = candidateObj.optString("candidate", "")
                        if (sdp.isNotBlank()) {
                            val candidate = org.webrtc.IceCandidate(sdpMid, sdpMLineIndex, sdp)
                            scope.launch {
                                iceCandidateChannel.send(candidate)
                            }
                            Timber.d("ICE candidate received")
                        }
                    } else {
                        // Fallback: try flat fields for backward compatibility
                        val sdpMid = json.optString("sdpMid", "0")
                        val sdpMLineIndex = json.optInt("sdpMLineIndex", 0)
                        val sdp = json.optString("candidate", "")
                        if (sdp.isNotBlank()) {
                            val candidate = org.webrtc.IceCandidate(sdpMid, sdpMLineIndex, sdp)
                            scope.launch {
                                iceCandidateChannel.send(candidate)
                            }
                            Timber.d("ICE candidate received (flat format)")
                        }
                    }
                }

                "ice-candidates" -> {
                    // Batch ICE candidates (sent by desktop mobile-bridge.js every 100ms)
                    val candidatesArray = json.optJSONArray("candidates")
                    if (candidatesArray != null) {
                        scope.launch {
                            for (i in 0 until candidatesArray.length()) {
                                val c = candidatesArray.optJSONObject(i) ?: continue
                                val sdpMid = c.optString("sdpMid", "0")
                                val sdpMLineIndex = c.optInt("sdpMLineIndex", 0)
                                val sdp = c.optString("candidate", "")
                                if (sdp.isNotBlank()) {
                                    iceCandidateChannel.send(
                                        org.webrtc.IceCandidate(sdpMid, sdpMLineIndex, sdp)
                                    )
                                }
                            }
                        }
                        Timber.d("Batch ICE candidates received: ${candidatesArray.length()}")
                    }
                }

                "peer-offline" -> {
                    val offlinePeerId = json.optString("peerId")
                    val messageType = json.optString("messageType")
                    Timber.w("Peer offline: $offlinePeerId (attempted: $messageType)")
                }

                "offer-pending" -> {
                    val pendingPeerId = json.optString("peerId")
                    val pendingMessage = json.optString("message", "PC is starting up...")
                    Timber.i("Offer pending for $pendingPeerId: $pendingMessage")
                    // The offer was queued, PC will process it when MobileBridge connects
                    // We should wait for the answer instead of treating it as an error
                }

                "peer-status-response" -> {
                    val statusPeerId = json.optString("peerId")
                    val status = json.optString("status")
                    Timber.d("Peer status: $statusPeerId = $status")
                }

                "pong" -> {
                    lastPongTime = System.currentTimeMillis()
                    Timber.d("Pong received")
                }

                "message" -> {
                    // PC端通过信令服务器转发的消息（当DataChannel未就绪时的回退机制）
                    val payload = json.opt("payload")
                    Timber.d("Message received via signaling server: ${payload.toString().take(100)}...")

                    if (payload != null) {
                        // 将消息转发到P2P消息处理流程
                        val messageStr = when (payload) {
                            is org.json.JSONObject -> payload.toString()
                            is String -> payload
                            else -> payload.toString()
                        }
                        Timber.d("Forwarding message to WebRTCClient: ${messageStr.take(100)}...")
                        onForwardedMessageCallback?.invoke(messageStr)
                    }
                }

                "error" -> {
                    val errorMsg = json.optString("error", json.optString("message", "Unknown error"))
                    Timber.e("Signaling error: $errorMsg")
                }

                else -> {
                    Timber.w("Unknown signaling type: $type")
                }
            }
        } catch (e: Exception) {
            Timber.e(e, "Handle signaling message failed: $message")
        }
    }

    /**
     * Extract SDP string from a signaling message.
     * The server may send SDP in different formats:
     * - { "answer": { "type": "answer", "sdp": "..." } }
     * - { "sdp": { "type": "answer", "sdp": "..." } }
     * - { "sdp": "..." } (flat string)
     */
    private fun extractSdpFromMessage(json: org.json.JSONObject, key: String): String? {
        // Try nested object under the key (e.g., "answer" or "offer")
        val nested = json.optJSONObject(key)
        if (nested != null) {
            val sdp = nested.optString("sdp", "")
            if (sdp.isNotBlank()) return sdp
        }

        // Try nested object under "sdp"
        val sdpObj = json.optJSONObject("sdp")
        if (sdpObj != null) {
            val sdp = sdpObj.optString("sdp", "")
            if (sdp.isNotBlank()) return sdp
        }

        // Try flat "sdp" string
        val sdpStr = json.optString("sdp", "")
        if (sdpStr.isNotBlank()) return sdpStr

        return null
    }

    override suspend fun sendOffer(peerId: String, offer: org.webrtc.SessionDescription) {
        Timber.i("[SignalClient] ========================================")
        Timber.i("[SignalClient] 发送 Offer")
        Timber.i("[SignalClient] 目标 peerId: $peerId")
        Timber.i("[SignalClient] SDP 长度: ${offer.description.length}")
        Timber.i("[SignalClient] ========================================")

        currentPeerId = peerId

        val json = org.json.JSONObject().apply {
            put("type", "offer")
            put("to", peerId)
            put("offer", org.json.JSONObject().apply {
                put("type", "offer")
                put("sdp", offer.description)
            })
        }

        sendWebSocketMessage(json.toString())
        Timber.i("[SignalClient] ✓ Offer 消息已发送到 $peerId")
    }

    override suspend fun sendIceCandidate(peerId: String, candidate: org.webrtc.IceCandidate) {
        Timber.d("Send ICE candidate to $peerId")

        val json = org.json.JSONObject().apply {
            put("type", "ice-candidate")
            put("to", peerId)
            put("candidate", org.json.JSONObject().apply {
                put("candidate", candidate.sdp)
                put("sdpMid", candidate.sdpMid)
                put("sdpMLineIndex", candidate.sdpMLineIndex)
            })
        }

        sendWebSocketMessage(json.toString())
    }

    override suspend fun waitForAnswer(peerId: String, timeout: Long): org.webrtc.SessionDescription {
        Timber.d("Waiting for answer from $peerId")
        return withTimeout(timeout) {
            answerChannel.receive()
        }
    }

    override suspend fun receiveIceCandidate(): org.webrtc.IceCandidate {
        return iceCandidateChannel.receive()
    }

    private fun sendWebSocketMessage(message: String) {
        Timber.i("[SignalClient] sendWebSocketMessage 调用")
        Timber.i("[SignalClient]   isConnected: $isConnected")
        Timber.i("[SignalClient]   webSocket: ${if (webSocket != null) "存在" else "null"}")

        if (!isConnected) {
            Timber.e("[SignalClient] ✗ WebSocket 未连接，无法发送消息")
            return
        }

        val sent = webSocket?.send(message) ?: false
        if (sent) {
            Timber.i("[SignalClient] ✓ 消息已发送: ${message.take(150)}...")
        } else {
            Timber.e("[SignalClient] ✗ 发送消息失败 (send() 返回 false)")
        }
    }

    private fun startHeartbeat() {
        stopHeartbeat()
        lastPongTime = System.currentTimeMillis()
        heartbeatJob = heartbeatScope.launch {
            var missedPongs = 0
            while (isActive && isConnected) {
                delay(com.chainlesschain.android.remote.config.SignalingConfig.PING_INTERVAL_SECONDS * 1000)
                if (!isConnected) break

                val ping = org.json.JSONObject().apply {
                    put("type", "ping")
                    put("timestamp", System.currentTimeMillis())
                }
                sendWebSocketMessage(ping.toString())

                // Check if we received a pong since last ping
                val timeSinceLastPong = System.currentTimeMillis() - lastPongTime
                val expectedInterval = com.chainlesschain.android.remote.config.SignalingConfig.PING_INTERVAL_SECONDS * 1000
                if (timeSinceLastPong > expectedInterval * 2) {
                    missedPongs++
                    Timber.w("Missed pong ($missedPongs/$missedPongThreshold), last pong ${timeSinceLastPong}ms ago")
                    if (missedPongs >= missedPongThreshold) {
                        Timber.e("Connection stale: $missedPongs missed pongs, triggering reconnect")
                        isConnected = false
                        webSocket?.cancel()
                        if (reconnectAttempts < com.chainlesschain.android.remote.config.SignalingConfig.MAX_RECONNECT_ATTEMPTS) {
                            reconnectAttempts++
                            connect()
                        }
                        break
                    }
                } else {
                    missedPongs = 0
                }
            }
        }
    }

    private fun stopHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = null
    }

    override fun disconnect() {
        Timber.d("Disconnect signaling")
        stopHeartbeat()
        scope.coroutineContext[Job]?.cancelChildren()
        heartbeatScope.coroutineContext[Job]?.cancelChildren()
        webSocket?.close(1000, "Normal closure")
        webSocket = null
        isConnected = false
    }
}
