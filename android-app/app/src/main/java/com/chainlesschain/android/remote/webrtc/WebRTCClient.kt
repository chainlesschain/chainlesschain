package com.chainlesschain.android.remote.webrtc

import com.chainlesschain.android.R
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
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
    private val signalClient: SignalClient,
    private val pairedPeersStore: com.chainlesschain.android.core.p2p.pairing.PairedPeersStore,
) {
    @Volatile
    private var peerConnectionFactory: PeerConnectionFactory? = null
    @Volatile
    private var peerConnection: PeerConnection? = null
    @Volatile
    private var dataChannel: DataChannel? = null

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    @Volatile
    private var remoteIceJob: Job? = null
    private val pendingRemoteCandidates = java.util.concurrent.CopyOnWriteArrayList<IceCandidate>()
    @Volatile
    private var isRemoteDescriptionSet = false

    /** Google STUN fallback — 当 PairedPeersStore 没存 iceServers 时用。 */
    private val fallbackIceServers = listOf(
        PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
        PeerConnection.IceServer.builder("stun:stun1.l.google.com:19302").createIceServer()
    )

    /**
     * v1.3+ plan B — 当前连接对应 pcPeerId 的 iceServers (优先) + Google STUN fallback。
     * `connect(pcPeerId,...)` 时设置；`createPeerConnection` 读取。
     *
     * iceServers JSON shape (from desktop-pair-handlers signIceCredentials):
     *   [{urls: ["stun:...", "turn:...?..."], username?, credential?}, ...]
     */
    @Volatile
    private var currentIceServers: List<PeerConnection.IceServer> = fallbackIceServers

    private fun resolveIceServersFor(pcPeerId: String): List<PeerConnection.IceServer> {
        val desktop = pairedPeersStore.devices.value.firstOrNull { it.pcPeerId == pcPeerId }
        val json = desktop?.iceServersJson ?: return fallbackIceServers
        val now = System.currentTimeMillis() / 1000
        if (desktop.iceExpiry > 0 && now > desktop.iceExpiry) {
            Timber.w("[WebRTCClient] iceServers expired for $pcPeerId (exp=${desktop.iceExpiry}) — fallback Google STUN")
            return fallbackIceServers
        }
        return try {
            parseIceServersJson(json).ifEmpty { fallbackIceServers }
        } catch (e: Exception) {
            Timber.w(e, "[WebRTCClient] parseIceServersJson failed — fallback")
            fallbackIceServers
        }
    }

    /**
     * v1.3+ plan B — 收到桌面 push 的 ice:config 时持久化到 PairedPeersStore，
     * 后续 createPeerConnection 拿。Wire shape (desktop pushIceServersToMobile):
     *   `{type:"chainlesschain:ice:config", payload:{pcPeerId, iceServers, iceExpiry}}`
     */
    private fun persistIceConfigMessage(msg: org.json.JSONObject) {
        try {
            val payloadRaw = msg.opt("payload")
            val payload = when (payloadRaw) {
                is String -> org.json.JSONObject(payloadRaw)
                is org.json.JSONObject -> payloadRaw
                else -> return
            }
            val pcPeerId = payload.optString("pcPeerId", null) ?: return
            val iceServersJson = payload.opt("iceServers")?.toString() ?: return
            val iceExpiry = payload.optLong("iceExpiry", 0L)
            val existing = pairedPeersStore.devices.value
                .firstOrNull { it.pcPeerId == pcPeerId }
                ?: run {
                    Timber.w("[WebRTCClient] ice:config for unknown pcPeerId=$pcPeerId")
                    return
                }
            pairedPeersStore.upsert(
                existing.copy(
                    iceServersJson = iceServersJson,
                    iceExpiry = iceExpiry,
                ),
            )
            Timber.i("[WebRTCClient] ✓ iceServers persisted for $pcPeerId (expiry=$iceExpiry)")
        } catch (e: Exception) {
            Timber.w(e, "[WebRTCClient] persistIceConfigMessage failed")
        }
    }

    private fun parseIceServersJson(raw: String): List<PeerConnection.IceServer> {
        val arr = org.json.JSONArray(raw)
        val result = mutableListOf<PeerConnection.IceServer>()
        for (i in 0 until arr.length()) {
            val obj = arr.optJSONObject(i) ?: continue
            val urlsRaw = obj.opt("urls")
            val urls = when (urlsRaw) {
                is String -> listOf(urlsRaw)
                is org.json.JSONArray -> (0 until urlsRaw.length()).map { urlsRaw.getString(it) }
                else -> emptyList()
            }
            for (url in urls) {
                val builder = PeerConnection.IceServer.builder(url)
                obj.optString("username", null)?.let { builder.setUsername(it) }
                obj.optString("credential", null)?.let { builder.setPassword(it) }
                result.add(builder.createIceServer())
            }
        }
        return result
    }

    @Volatile
    private var onMessageReceived: ((String) -> Unit)? = null
    @Volatile
    private var onDisconnected: (() -> Unit)? = null

    private val _connectionState = MutableStateFlow(P2PConnectionState.DISCONNECTED)
    val connectionState: StateFlow<P2PConnectionState> = _connectionState.asStateFlow()

    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 64)
    val messages: SharedFlow<String> = _messages.asSharedFlow()

    /**
     * Plan A.1 — DataChannel 真 OPEN 才 true。
     *
     * 关键语义提醒：[P2PConnectionState.DATA_CHANNEL_OPEN] 字面虽含 "OPEN" 但
     * 只是 ICE 通了（在 [PeerConnection.IceConnectionState.CONNECTED] 时设，
     * 见 onIceConnectionChange），DC 此时未必 open。真 DC OPEN 是
     * [P2PConnectionState.READY]（在 [setupDataChannel.onStateChange] 收到
     * [DataChannel.State.OPEN] 时设）。
     *
     * 消费者订阅本 flag 即可判断"可经 DC 发送"，无需自己理解 8 态状态机。
     */
    val dataChannelReady: StateFlow<Boolean> =
        _connectionState
            .map { it == P2PConnectionState.READY }
            .stateIn(scope, kotlinx.coroutines.flow.SharingStarted.Eagerly, false)

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
                // v1.3+ plan B — 拦截 ice:config 持久化 iceServers，再透传给下游
                try {
                    val msg = org.json.JSONObject(message)
                    if (msg.optString("type") == "chainlesschain:ice:config") {
                        persistIceConfigMessage(msg)
                    }
                } catch (e: Exception) {
                    Timber.w(e, "[WebRTCClient] ice:config parse failed")
                }
                onMessageReceived?.invoke(message)
                _messages.tryEmit(message)
            }

            Timber.d("WebRTC init success")
        } catch (e: Exception) {
            Timber.e(e, "WebRTC init failed")
            throw e
        }
    }

    /**
     * @param targetPeerId 对端 peerId（旧名 pcPeerId — desktop↔mobile 时是 desktop，
     *   mobile↔mobile 时是对方手机）。
     * @param isInitiator true=主叫（createOffer→等 answer，既有 desktop↔mobile 默认路径）；
     *   false=被叫（FAMILY-30 mobile↔mobile：等对方 offer→回 answer，DataChannel 经
     *   onDataChannel 受领，不自建）。默认 true 保向后兼容（P2PClient / remote-terminal /
     *   operate / pairing 三流不传此参，仍走 initiator）。
     */
    suspend fun connect(
        targetPeerId: String,
        localPeerId: String,
        isInitiator: Boolean = true,
    ): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            Timber.i("========================================")
            Timber.i("Starting P2P connection to peer: $targetPeerId (isInitiator=$isInitiator)")
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

            // 3. Create PeerConnection (DataChannel: initiator 自建; responder 经 onDataChannel 受领)
            Timber.i("[Step 3/5] Creating PeerConnection (isInitiator=$isInitiator)...")
            createPeerConnection(targetPeerId)
            if (isInitiator) {
                createDataChannel()
            }
            startRemoteIceListener()
            Timber.i("[Step 3/5] ✓ PeerConnection created")

            if (isInitiator) {
                // 4i. Create and send offer
                Timber.i("[Step 4/5] (initiator) Creating and sending offer to $targetPeerId...")
                _connectionState.value = P2PConnectionState.CREATING_OFFER
                val offer = createOffer()
                signalClient.sendOffer(targetPeerId, offer)
                Timber.i("[Step 4/5] ✓ Offer sent")

                // 5i. Wait for answer
                Timber.i("[Step 5/5] (initiator) Waiting for answer (15s timeout)...")
                _connectionState.value = P2PConnectionState.WAITING_ANSWER
                val answer = signalClient.waitForAnswer(targetPeerId, timeout = 15000)
                Timber.i("[Step 5/5] ✓ Answer received, setting remote description...")
                setRemoteDescription(answer)
                isRemoteDescriptionSet = true
                drainPendingRemoteCandidates()
            } else {
                // 4r. Wait for offer (FAMILY-30 responder path)
                Timber.i("[Step 4/5] (responder) Waiting for offer from $targetPeerId (15s timeout)...")
                _connectionState.value = P2PConnectionState.WAITING_ANSWER
                val offer = signalClient.waitForOffer(targetPeerId, timeout = 15000)
                Timber.i("[Step 4/5] ✓ Offer received, setting remote description...")
                setRemoteDescription(offer)
                isRemoteDescriptionSet = true
                drainPendingRemoteCandidates()

                // 5r. Create and send answer
                Timber.i("[Step 5/5] (responder) Creating and sending answer to $targetPeerId...")
                _connectionState.value = P2PConnectionState.CREATING_OFFER
                val answer = createAnswer()
                signalClient.sendAnswer(targetPeerId, answer)
                Timber.i("[Step 5/5] ✓ Answer sent")
            }

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
                e.message?.contains("timeout", ignoreCase = true) == true -> context.getString(R.string.webrtc_pc_not_responding)
                e.message?.contains("connect", ignoreCase = true) == true -> context.getString(R.string.webrtc_signaling_failed)
                else -> "连接失败: ${e.message}"
            }
            Result.failure(Exception(errorMessage, e))
        }
    }

    private fun createPeerConnection(targetPeerId: String) {
        Timber.d("Creating peer connection")
        // v1.3+ plan B — 用桌面 QR 签发的 ICE servers (含 turn.chainlesschain.com TURN)，
        // fallback Google STUN。这样 WAN 跨 NAT 下 WebRTC 也能打洞。
        currentIceServers = resolveIceServersFor(targetPeerId)
        Timber.i("[WebRTCClient] ice servers (${currentIceServers.size}) for $targetPeerId: " +
            currentIceServers.joinToString { it.urls.firstOrNull() ?: "?" })

        val rtcConfig = PeerConnection.RTCConfiguration(currentIceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }

        peerConnection = peerConnectionFactory?.createPeerConnection(
            rtcConfig,
            object : PeerConnection.Observer {
                override fun onIceCandidate(candidate: IceCandidate) {
                    Timber.d("ICE candidate generated")
                    scope.launch {
                        signalClient.sendIceCandidate(targetPeerId, candidate)
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

    // FAMILY-30 responder path — 镜像 createOffer，但 createAnswer（setRemoteDescription(offer)
    // 必须已先调）。
    private suspend fun createAnswer(): SessionDescription = suspendCancellableCoroutine { continuation ->
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "false"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"))
        }

        peerConnection?.createAnswer(object : SdpObserver {
            override fun onCreateSuccess(sdp: SessionDescription) {
                Timber.d("Answer created")
                peerConnection?.setLocalDescription(object : SdpObserver {
                    override fun onSetSuccess() {
                        Timber.d("Local description (answer) set")
                        continuation.resume(sdp) {}
                    }

                    override fun onSetFailure(error: String) {
                        Timber.e("Set local description (answer) failed: $error")
                        continuation.resumeWith(Result.failure(Exception(error)))
                    }

                    override fun onCreateSuccess(p0: SessionDescription?) {}
                    override fun onCreateFailure(p0: String?) {}
                }, sdp)
            }

            override fun onCreateFailure(error: String) {
                Timber.e("Create answer failed: $error")
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
        // CopyOnWriteArrayList's iterator.remove() throws UnsupportedOperationException
        // (with null message — caught by connect()'s try/catch and surfaced as
        // "连接失败: null"). Snapshot + removeAll instead. Drained candidates are
        // applied first so a race-arriving candidate (added after snapshot but before
        // removeAll) is left in the list for the next call.
        val drained = pendingRemoteCandidates.toList()
        if (drained.isEmpty()) return
        drained.forEach { peerConnection?.addIceCandidate(it) }
        pendingRemoteCandidates.removeAll(drained.toSet())
    }
}

interface SignalClient {
    suspend fun connect(): Result<Unit>
    suspend fun register(peerId: String, deviceInfo: Map<String, String>)
    suspend fun sendOffer(peerId: String, offer: org.webrtc.SessionDescription)
    suspend fun sendIceCandidate(peerId: String, candidate: org.webrtc.IceCandidate)
    suspend fun waitForAnswer(peerId: String, timeout: Long): org.webrtc.SessionDescription
    suspend fun receiveIceCandidate(): org.webrtc.IceCandidate

    // FAMILY-30 — responder path (mobile↔mobile 对等改造): 非 initiator 端等对方 offer
    // 并回 answer。default 实现保留向后兼容（既有 desktop↔mobile 流仅用 initiator 路径）。
    suspend fun sendAnswer(peerId: String, answer: org.webrtc.SessionDescription)
    suspend fun waitForOffer(peerId: String, timeout: Long): org.webrtc.SessionDescription

    /**
     * v1.1 W3.7 Flow B: 发任意 payload 给指定 peer 经信令服务器 forward。
     * 用于 `pair-ack`、自定义消息 等非 WebRTC 标准 signaling 路径。
     * 信令服务器会用 type:"message" + to:<toPeerId> 路由到目标。
     */
    suspend fun sendForwardedMessage(toPeerId: String, payload: org.json.JSONObject): Result<Unit>

    fun disconnect()

    /**
     * Plan A.1 — 多订阅 forwarded message 流（信令服务器 type:"message" 转发）。
     *
     * 替代 [setOnForwardedMessageReceived] 的单 listener 模型——后者的 "set 不是 add"
     * 语义曾导致 WebRTCClient / SignalingRpcClient / TerminalRpcClient 三方互相覆盖
     * (memory: Plan A.1 Trap 1)，ice:config 拦截 + RPC 响应 + terminal.stdout push
     * 互相吞掉。所有新代码应订阅本 flow。
     *
     * 现有 [setOnForwardedMessageReceived] callback 保留作向后兼容（WebRTCClient.initialize
     * 仍占用 — 它是 ice:config 拦截的 canonical handler），但**不再用于业务路径**。
     */
    val forwardedMessages: kotlinx.coroutines.flow.SharedFlow<String>

    fun setOnForwardedMessageReceived(callback: ((String) -> Unit)?)
}

class WebSocketSignalClient @Inject constructor(
    private val okHttpClient: okhttp3.OkHttpClient,
    private val signalingConfig: com.chainlesschain.android.core.p2p.config.SignalingConfig,
    // v1.1 W3.3b：desktop pairing:confirmation 经信令到达时投递到 bus，让
    // feature-p2p 的 DesktopPairingViewModel 不依赖 :app 也能消费。
    private val pairingMessageBus: com.chainlesschain.android.core.p2p.pairing.PairingMessageBus
) : SignalClient {

    @Volatile
    private var webSocket: okhttp3.WebSocket? = null
    private val answerChannel = kotlinx.coroutines.channels.Channel<org.webrtc.SessionDescription>(1)
    // FAMILY-30 responder path — 收到对方 offer 时投递给 waitForOffer。
    private val offerChannel = kotlinx.coroutines.channels.Channel<org.webrtc.SessionDescription>(1)
    private val iceCandidateChannel = kotlinx.coroutines.channels.Channel<org.webrtc.IceCandidate>(kotlinx.coroutines.channels.Channel.UNLIMITED)

    @Volatile
    private var currentPeerId: String? = null
    // Saved deviceInfo from last register() call. WS reconnect 后 onOpen 自动用
    // (currentPeerId, lastDeviceInfo) 重发 register 消息 — server 上新 socket
    // 立刻拿到 peerId 绑定，避免 from=unknown / to=undefined 命令路由黑洞。
    @Volatile
    private var lastDeviceInfo: Map<String, String>? = null
    @Volatile
    private var isConnected = false
    @Volatile
    private var reconnectAttempts = 0

    // General-purpose scope for callback dispatching
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // Application-layer heartbeat
    private val heartbeatScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    @Volatile
    private var heartbeatJob: Job? = null
    @Volatile
    private var lastPongTime = 0L
    private val missedPongThreshold = 3

    // 用于转发来自信令服务器的 P2P 消息
    @Volatile
    private var onForwardedMessageCallback: ((String) -> Unit)? = null

    // Plan A.1 — 多订阅版本，与 [onForwardedMessageCallback] 并存。SharedFlow 不丢消息
    // （extraBufferCapacity=64 与 [WebRTCClient._messages] 对齐），多消费者各 collect。
    private val _forwardedMessages = MutableSharedFlow<String>(extraBufferCapacity = 64)
    override val forwardedMessages: SharedFlow<String> = _forwardedMessages.asSharedFlow()

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
                    // Reconnect 后自动重发上次的 register —— server 上新 socket 立刻拿到
                    // peerId 绑定。否则 socket.peerId=undefined，转发响应时 from=unknown /
                    // to=undefined，命令进黑洞 30s 超时。
                    val pid = currentPeerId
                    val info = lastDeviceInfo
                    if (pid != null && info != null) {
                        try {
                            val json = org.json.JSONObject().apply {
                                put("type", "register")
                                put("peerId", pid)
                                put("deviceType", "mobile")
                                put("deviceInfo", org.json.JSONObject().apply {
                                    info.forEach { (k, v) -> put(k, v) }
                                })
                            }
                            webSocket.send(json.toString())
                            Timber.i("[SignalClient] ✓ auto re-registered after reconnect as $pid")
                        } catch (e: Exception) {
                            Timber.w(e, "[SignalClient] auto re-register failed")
                        }
                    }
                }

                override fun onMessage(webSocket: okhttp3.WebSocket, text: String) {
                    Timber.d("Signaling message: ${text.take(100)}...")
                    handleSignalingMessage(text)
                }

                override fun onFailure(webSocket: okhttp3.WebSocket, t: Throwable, response: okhttp3.Response?) {
                    Timber.e(t, "WebSocket failed (attempt ${reconnectAttempts + 1}/${com.chainlesschain.android.core.p2p.config.SignalingConfig.MAX_RECONNECT_ATTEMPTS})")
                    isConnected = false
                    stopHeartbeat()

                    if (reconnectAttempts < com.chainlesschain.android.core.p2p.config.SignalingConfig.MAX_RECONNECT_ATTEMPTS) {
                        reconnectAttempts++
                        scope.launch {
                            delay(com.chainlesschain.android.core.p2p.config.SignalingConfig.RECONNECT_DELAY_MS)
                            Timber.d("Reconnecting (${reconnectAttempts}/${com.chainlesschain.android.core.p2p.config.SignalingConfig.MAX_RECONNECT_ATTEMPTS})...")
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
            while (!isConnected && waited < com.chainlesschain.android.core.p2p.config.SignalingConfig.CONNECT_TIMEOUT_MS.toInt()) {
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
        lastDeviceInfo = deviceInfo  // 保存供 reconnect 自动重发
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

                // FAMILY-30 responder path — 入向 offer 投 offerChannel 供 waitForOffer。
                "offer" -> {
                    val sdpString = extractSdpFromMessage(json, "offer")
                    if (sdpString != null) {
                        val offer = org.webrtc.SessionDescription(
                            org.webrtc.SessionDescription.Type.OFFER,
                            sdpString
                        )
                        scope.launch {
                            offerChannel.send(offer)
                        }
                        Timber.d("Offer received (responder path)")
                    } else {
                        Timber.e("Offer received but could not extract SDP")
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
                        // v1.1 W3.3b：识别 pairing:confirmation payload（desktop
                        // device-pairing-handler.js sendConfirmation 发的），路由到
                        // PairingMessageBus 让 DesktopPairingViewModel 消费。
                        // 非 pairing payload 仍走 onForwardedMessageCallback（WebRTC
                        // DataChannel 回退路径）。
                        val payloadObj = payload as? org.json.JSONObject
                        if (payloadObj != null &&
                            payloadObj.optString("type") == "pairing:confirmation"
                        ) {
                            handlePairingConfirmation(payloadObj)
                        } else {
                            // 将消息转发到P2P消息处理流程
                            val messageStr = when (payload) {
                                is org.json.JSONObject -> payload.toString()
                                is String -> payload
                                else -> payload.toString()
                            }
                            Timber.d("Forwarding message to WebRTCClient: ${messageStr.take(100)}...")
                            // Plan A.1 — 同时 emit 到多订阅 SharedFlow（SignalingRpc /
                            // TerminalRpc 各自 collect，不再争抢单 callback）。
                            // callback 路径保留：WebRTCClient.initialize 用它做
                            // ice:config 拦截 + 转发到 webRTCClient._messages。
                            _forwardedMessages.tryEmit(messageStr)
                            onForwardedMessageCallback?.invoke(messageStr)
                        }
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
     * v1.1 W3.3b: 解析 desktop 经信令发的 pairing:confirmation payload，发到
     * [PairingMessageBus]。字段对齐 desktop `device-pairing-handler.js::
     * sendConfirmation`。
     */
    private fun handlePairingConfirmation(payload: org.json.JSONObject) {
        try {
            val pairingCode = payload.optString("pairingCode", "")
            val pcPeerId = payload.optString("pcPeerId", "")
            val timestamp = payload.optLong("timestamp", 0L)
            if (pairingCode.isBlank() || pcPeerId.isBlank()) {
                Timber.w("[SignalClient] pairing:confirmation missing pairingCode/pcPeerId, skipping")
                return
            }
            val deviceInfoJson = payload.optJSONObject("deviceInfo")
            val deviceInfo = deviceInfoJson?.let { obj ->
                obj.keys().asSequence().associateWith { obj.optString(it, "") }
            }
            val confirmation = com.chainlesschain.android.core.p2p.pairing.PairingConfirmation(
                pairingCode = pairingCode,
                pcPeerId = pcPeerId,
                deviceInfo = deviceInfo,
                timestamp = timestamp,
            )
            pairingMessageBus.emit(confirmation)
            Timber.i("[SignalClient] pairing:confirmation routed to bus (code=$pairingCode)")
        } catch (e: Exception) {
            Timber.e(e, "[SignalClient] failed to parse pairing:confirmation payload")
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

        // ⚠️ DO NOT touch currentPeerId here — `peerId` is the TARGET (desktop's
        // pcPeerId), not our self id. Original buggy line `currentPeerId = peerId`
        // (Plan A.1 v5.0.3.53-fix1 real-device E2E) caused: reconnect-then auto
        // re-register pulled `currentPeerId` and registered THIS mobile AS the
        // desktop's pcPeerId → server routed mobile's own `to: fb8380...` back
        // to itself = echo loop, desktop never saw `terminal.create` →
        // 「打不开」symptom. currentPeerId is exclusively owned by register().

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

    /**
     * v1.1 W3.7 Flow B: 把任意 payload 经信令服务器 forward 给目标 peer。
     * Wire shape: {type:"message", to:<peerId>, payload:<JSONObject>}。
     * 信令服务器收到后 forward 给目标 peer，其 onmessage 解 payload.type 自行 dispatch。
     */
    override suspend fun sendForwardedMessage(
        toPeerId: String,
        payload: org.json.JSONObject,
    ): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            if (!isConnected || webSocket == null) {
                return@withContext Result.failure(Exception("signaling not connected"))
            }
            val json = org.json.JSONObject().apply {
                put("type", "message")
                put("to", toPeerId)
                put("payload", payload)
            }
            sendWebSocketMessage(json.toString())
            Timber.i("[SignalClient] forwarded message → $toPeerId (payload.type=${payload.optString("type")})")
            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "[SignalClient] sendForwardedMessage failed")
            Result.failure(e)
        }
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

    // FAMILY-30 responder path — 镜像 sendOffer / waitForAnswer。peerId 是 TARGET（同
    // sendOffer 注释：勿碰 currentPeerId，那是 self）。
    override suspend fun sendAnswer(peerId: String, answer: org.webrtc.SessionDescription) {
        Timber.i("[SignalClient] 发送 Answer → 目标 peerId: $peerId (SDP ${answer.description.length})")
        val json = org.json.JSONObject().apply {
            put("type", "answer")
            put("to", peerId)
            put("answer", org.json.JSONObject().apply {
                put("type", "answer")
                put("sdp", answer.description)
            })
        }
        sendWebSocketMessage(json.toString())
        Timber.i("[SignalClient] ✓ Answer 消息已发送到 $peerId")
    }

    override suspend fun waitForOffer(peerId: String, timeout: Long): org.webrtc.SessionDescription {
        Timber.d("Waiting for offer from $peerId")
        return withTimeout(timeout) {
            offerChannel.receive()
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
                delay(com.chainlesschain.android.core.p2p.config.SignalingConfig.PING_INTERVAL_SECONDS * 1000)
                if (!isConnected) break

                val ping = org.json.JSONObject().apply {
                    put("type", "ping")
                    put("timestamp", System.currentTimeMillis())
                }
                sendWebSocketMessage(ping.toString())

                // Check if we received a pong since last ping
                val timeSinceLastPong = System.currentTimeMillis() - lastPongTime
                val expectedInterval = com.chainlesschain.android.core.p2p.config.SignalingConfig.PING_INTERVAL_SECONDS * 1000
                if (timeSinceLastPong > expectedInterval * 2) {
                    missedPongs++
                    Timber.w("Missed pong ($missedPongs/$missedPongThreshold), last pong ${timeSinceLastPong}ms ago")
                    if (missedPongs >= missedPongThreshold) {
                        Timber.e("Connection stale: $missedPongs missed pongs, triggering reconnect")
                        isConnected = false
                        webSocket?.cancel()
                        if (reconnectAttempts < com.chainlesschain.android.core.p2p.config.SignalingConfig.MAX_RECONNECT_ATTEMPTS) {
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
