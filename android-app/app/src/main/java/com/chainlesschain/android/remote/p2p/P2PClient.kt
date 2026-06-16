package com.chainlesschain.android.remote.p2p

import com.chainlesschain.android.remote.data.AuthInfo
import com.chainlesschain.android.remote.data.CommandCancelRequest
import com.chainlesschain.android.remote.data.CommandRequest
import com.chainlesschain.android.remote.data.CommandResponse
import com.chainlesschain.android.remote.data.ErrorCodes
import com.chainlesschain.android.remote.data.ErrorInfo
import com.chainlesschain.android.remote.data.EventNotification
import com.chainlesschain.android.remote.data.FileTransferProgress
import com.chainlesschain.android.remote.data.MessageTypes
import com.chainlesschain.android.remote.data.P2PMessage
import com.chainlesschain.android.remote.data.ProgressNotification
import com.chainlesschain.android.remote.data.StreamChunkMessage
import com.chainlesschain.android.remote.data.StreamEndMessage
import com.chainlesschain.android.remote.data.StreamStartMessage
import com.chainlesschain.android.remote.data.fromJson
import com.chainlesschain.android.remote.data.toJsonString
import com.chainlesschain.android.core.p2p.RemoteSkillProvider
import com.chainlesschain.android.remote.crypto.NonceManager
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.lang.reflect.Type
import com.chainlesschain.android.remote.webrtc.WebRTCClient
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import timber.log.Timber
import java.util.concurrent.ConcurrentHashMap
import androidx.compose.runtime.Immutable
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.random.Random

@Singleton
class P2PClient @Inject constructor(
    private val didManager: DIDManager,
    private val webRTCClient: WebRTCClient,
    private val nonceManager: NonceManager,  // Nonce 持久化管理
    private val deviceActivityManager: DeviceActivityManager,  // 设备活动跟踪
    // Phase 3d M3 step D.5: 入向 COMMAND_REQUEST dispatch（PC → Android sync.* 命令）
    private val commandRouter: CommandRouter,
    // Phase 3d v1.1 #2: sync.* 入向 auth 校验（dagger.Lazy 因 SyncAuthVerifier
    // 反向注入 P2PClient — 用 Lazy 解循环）
    private val syncAuthVerifier: dagger.Lazy<com.chainlesschain.android.sync.SyncAuthVerifier>
) : RemoteSkillProvider {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val pendingRequests = ConcurrentHashMap<String, PendingRequest>()
    @Volatile private var heartbeatJob: Job? = null
    @Volatile private var reconnectJob: Job? = null
    @Volatile private var heartbeatTimeoutJob: Job? = null

    private val config = P2PClientConfig()
    private val gson = Gson()

    // Reconnection state
    @Volatile private var reconnectAttempts = 0
    @Volatile private var currentReconnectDelay = config.baseReconnectDelay
    @Volatile private var lastConnectedPeerId: String? = null
    @Volatile private var lastConnectedPeerDID: String? = null
    @Volatile private var lastHeartbeatReceived = System.currentTimeMillis()
    @Volatile private var autoReconnectEnabled = true

    private val _events = MutableSharedFlow<EventNotification>(replay = 0, extraBufferCapacity = 16)
    val events: SharedFlow<EventNotification> = _events.asSharedFlow()

    // ==================== 流式消息支持 ====================
    private val _streamStart = MutableSharedFlow<StreamStartMessage>(replay = 0, extraBufferCapacity = 16)
    val streamStart: SharedFlow<StreamStartMessage> = _streamStart.asSharedFlow()

    private val _streamChunks = MutableSharedFlow<StreamChunkMessage>(replay = 0, extraBufferCapacity = 64)
    val streamChunks: SharedFlow<StreamChunkMessage> = _streamChunks.asSharedFlow()

    private val _streamEnd = MutableSharedFlow<StreamEndMessage>(replay = 0, extraBufferCapacity = 16)
    val streamEnd: SharedFlow<StreamEndMessage> = _streamEnd.asSharedFlow()

    // 活跃流追踪
    private val activeStreams = ConcurrentHashMap<String, StreamState>()

    // ==================== 进度通知支持 ====================
    private val _progressUpdates = MutableSharedFlow<ProgressNotification>(replay = 0, extraBufferCapacity = 32)
    val progressUpdates: SharedFlow<ProgressNotification> = _progressUpdates.asSharedFlow()

    private val _fileTransferProgress = MutableSharedFlow<FileTransferProgress>(replay = 0, extraBufferCapacity = 32)
    val fileTransferProgress: SharedFlow<FileTransferProgress> = _fileTransferProgress.asSharedFlow()

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    // ==================== Connected peers (v1.1 W2.1 data model) ====================
    //
    // 内部用 `Map<peerId, PeerInfo>` keyed by peerId 方便 W2.2 lifecycle 多目标 connect/disconnect
    // 时按 peerId 增删；W2.1 范围内 lifecycle 仍单 peer-at-a-time（connect 前先 disconnect 当前），
    // 但底层数据结构已能容纳 N 个，为 W2.2-7 解锁。
    //
    // 老 API `connectedPeer: StateFlow<PeerInfo?>` 标 @Deprecated 但保留为同步镜像 MutableStateFlow，
    // 让 15+ callsites (RemoteConnectionManager / ConnectionViewModel / RemoteAgentControlViewModel /
    // 3 Compose Screen + RemoteCommandClient null guard + 7 test 断言) 在 W2.2-5 里逐步迁移，
    // 不在本 commit 一刀切。两个 StateFlow 在 P2PClient 内 connect/disconnect 三个 mutation 点同步写，
    // 避免 stateIn 的 IO-scope 异步 lag（老测试 runTest sync read .value 拿不到值）。
    private val _connectedPeers = MutableStateFlow<Map<String, PeerInfo>>(emptyMap())
    val connectedPeers: StateFlow<Map<String, PeerInfo>> = _connectedPeers.asStateFlow()

    private val _connectedPeer = MutableStateFlow<PeerInfo?>(null)

    @Deprecated(
        "v1.1 W2.1: data model 升 Map<peerId, PeerInfo>；本字段返回任意一个 peer。" +
            "新代码用 connectedPeers；UI 多设备视图见 W2.5 Settings 已配对设备列表。",
        ReplaceWith("connectedPeers.value.values.firstOrNull()"),
    )
    val connectedPeer: StateFlow<PeerInfo?> = _connectedPeer.asStateFlow()

    // Reconnection events for UI updates
    private val _reconnectionEvents = MutableSharedFlow<ReconnectionEvent>(replay = 0, extraBufferCapacity = 8)
    val reconnectionEvents: SharedFlow<ReconnectionEvent> = _reconnectionEvents.asSharedFlow()

    init {
        webRTCClient.initialize()
        webRTCClient.setOnMessageReceived { raw ->
            scope.launch { handleIncoming(raw) }
        }
        webRTCClient.setOnDisconnected {
            scope.launch { handleDisconnection() }
        }
    }

    suspend fun connect(pcPeerId: String, pcDID: String): Result<Unit> = withContext(Dispatchers.IO) {
        // v1.1 W3 latency 埋点：start time → 走完 webRTCClient.connect() 总耗时 + 当前 ICE policy
        val connectStartMs = System.currentTimeMillis()
        try {
            Timber.i("========================================")
            Timber.i("[P2PClient] connect() 被调用")
            Timber.i("[P2PClient] 目标 pcPeerId: $pcPeerId")
            Timber.i("[P2PClient] 目标 pcDID: $pcDID")
            Timber.i("[P2PClient] 当前连接状态: ${_connectionState.value}")
            Timber.i("========================================")

            if (_connectionState.value == ConnectionState.CONNECTED) {
                Timber.i("[P2PClient] 已连接，先断开...")
                disconnect()
            }
            _connectionState.value = ConnectionState.CONNECTING
            Timber.i("[P2PClient] 状态更新为 CONNECTING")

            // Store for reconnection
            lastConnectedPeerId = pcPeerId
            lastConnectedPeerDID = pcDID

            // Generate a local peerId for signaling registration
            val localPeerId = "mobile-${java.util.UUID.randomUUID().toString().take(8)}"
            Timber.i("[P2PClient] 生成本地 peerId: $localPeerId")
            Timber.i("[P2PClient] 正在调用 webRTCClient.connect()...")
            val result = webRTCClient.connect(pcPeerId, localPeerId)
            if (result.isFailure) {
                val elapsedFail = System.currentTimeMillis() - connectStartMs
                Timber.w("[P2PClient.metric] connect FAILED elapsed=${elapsedFail}ms peerId=$pcPeerId")
                _connectionState.value = ConnectionState.ERROR
                return@withContext Result.failure(result.exceptionOrNull() ?: Exception("Connect failed"))
            }

            // v1.1 W3 connect-success 埋点（M6 性能 LAN p50 < 200ms / NAT p50 < 800ms 验收用）。
            // 单条 Timber.i + 'metric' tag 让 release-time 简单 grep 'P2PClient.metric' 收数。
            val elapsed = System.currentTimeMillis() - connectStartMs
            Timber.i(
                "[P2PClient.metric] connect SUCCESS elapsed=${elapsed}ms peerId=$pcPeerId did=${pcDID.take(20)}…"
            )

            _connectionState.value = ConnectionState.CONNECTED
            // W2.1: 进 Map 不替换。W2.1 lifecycle 仍 single-peer-at-a-time（connect 前已 disconnect()），
            // 所以 Map 此刻只会有这一条；W2.2 会放开 lifecycle 让 N 个 peer 并存。
            val newPeer = PeerInfo(
                peerId = pcPeerId,
                did = pcDID,
                connectedAt = System.currentTimeMillis()
            )
            _connectedPeers.update { it + (pcPeerId to newPeer) }
            _connectedPeer.value = newPeer // @Deprecated 镜像，同步

            // Reset reconnection state on successful connect
            resetReconnectionState()

            // 通知活动管理器连接成功
            deviceActivityManager.setConnected(true)
            deviceActivityManager.recordActivity("connected")

            startHeartbeat()
            startHeartbeatTimeoutMonitor()
            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "P2P connect failed")
            _connectionState.value = ConnectionState.ERROR
            Result.failure(e)
        }
    }

    /**
     * FAMILY-67: 与已配对家庭 peer 建连。用本机真实 DID 作 stable localPeerId（对端经信令
     * 按 DID 发现本机），并按 glare 选举
     * ([com.chainlesschain.android.sync.FamilyGuardSyncConnector.electOfferer]) 决定 [isInitiator]：
     * true 主动发 offer，false 等对端 offer 并回 answer（answerer dance 复用
     * [WebRTCClient.connect] isInitiator=false 路径）。成功即进 [connectedPeers]，
     * SyncCoordinator 随后把排队的遥测/家庭变更推过去。
     *
     * 与 [connect]（PC 远程控制路径）并行；底层 WebRTCClient 当前单连接，家庭 1:1 场景够用；
     * 已连同一 peerDID 则幂等早返。失败不抛，调用方（连接器循环）下轮重试。
     */
    suspend fun connectFamilyPeer(
        peerDID: String,
        localDID: String,
        isInitiator: Boolean,
    ): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            if (_connectedPeers.value.containsKey(peerDID)) {
                return@withContext Result.success(Unit)
            }
            Timber.i(
                "[P2PClient] connectFamilyPeer peerDID=${peerDID.take(20)}… isInitiator=$isInitiator",
            )
            val result = webRTCClient.connect(
                targetPeerId = peerDID,
                localPeerId = localDID,
                isInitiator = isInitiator,
                relaySignaling = true, // FAMILY-67: 手机↔手机经生产信令服务器，须包 type:"message" 中继
            )
            if (result.isFailure) {
                return@withContext Result.failure(
                    result.exceptionOrNull() ?: Exception("family connect failed"),
                )
            }
            val peer = PeerInfo(
                peerId = peerDID,
                did = peerDID,
                connectedAt = System.currentTimeMillis(),
            )
            _connectedPeers.update { it + (peerDID to peer) }
            // FAMILY-67 (第8层): sendCommand 要求 _connectionState==CONNECTED 才发 RPC。
            // connect() 会设，connectFamilyPeer 之前漏设 → sync.push 立刻 "Not connected" 失败。
            _connectionState.value = ConnectionState.CONNECTED
            deviceActivityManager.setConnected(true)
            deviceActivityManager.recordActivity("family-connected")
            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "[P2PClient] connectFamilyPeer failed")
            Result.failure(e)
        }
    }

    /**
     * Enable or disable automatic reconnection
     */
    fun setAutoReconnect(enabled: Boolean) {
        autoReconnectEnabled = enabled
        if (!enabled) {
            cancelReconnect()
        }
    }

    /**
     * Handle disconnection and trigger auto-reconnect
     */
    private suspend fun handleDisconnection() {
        Timber.w("[P2PClient] Connection lost, handling disconnection...")

        if (_connectionState.value == ConnectionState.DISCONNECTED) {
            return  // Already handled
        }

        stopHeartbeat()
        stopHeartbeatTimeoutMonitor()

        _connectionState.value = ConnectionState.DISCONNECTED

        if (autoReconnectEnabled && lastConnectedPeerId != null && lastConnectedPeerDID != null) {
            scheduleReconnect()
        }
    }

    /**
     * Schedule a reconnection attempt with exponential backoff
     */
    private fun scheduleReconnect() {
        if (reconnectAttempts >= config.maxReconnectAttempts) {
            Timber.e("[P2PClient] Max reconnection attempts reached (${config.maxReconnectAttempts})")
            scope.launch {
                _reconnectionEvents.emit(ReconnectionEvent.Failed(
                    attempts = reconnectAttempts,
                    reason = "Max reconnection attempts exceeded"
                ))
            }
            _connectionState.value = ConnectionState.ERROR
            return
        }

        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            val delay = currentReconnectDelay
            Timber.i("[P2PClient] Scheduling reconnect in ${delay}ms (attempt ${reconnectAttempts + 1}/${config.maxReconnectAttempts})")

            _reconnectionEvents.emit(ReconnectionEvent.Scheduled(
                attempt = reconnectAttempts + 1,
                delayMs = delay
            ))

            _connectionState.value = ConnectionState.RECONNECTING

            delay(delay)

            reconnectAttempts++

            // Calculate next delay with exponential backoff
            currentReconnectDelay = minOf(
                (currentReconnectDelay * config.reconnectBackoffFactor).toLong(),
                config.maxReconnectDelay
            )

            _reconnectionEvents.emit(ReconnectionEvent.Attempting(
                attempt = reconnectAttempts
            ))

            val peerId = lastConnectedPeerId ?: return@launch
            val peerDID = lastConnectedPeerDID ?: return@launch

            Timber.i("[P2PClient] Attempting reconnect to $peerId...")

            val result = connect(peerId, peerDID)

            if (result.isSuccess) {
                Timber.i("[P2PClient] Reconnection successful!")
                _reconnectionEvents.emit(ReconnectionEvent.Success(
                    attempts = reconnectAttempts
                ))
            } else {
                Timber.w("[P2PClient] Reconnection failed: ${result.exceptionOrNull()?.message}")
                // Will be scheduled again by handleDisconnection if still auto-reconnect enabled
                if (autoReconnectEnabled) {
                    scheduleReconnect()
                }
            }
        }
    }

    /**
     * Cancel any pending reconnection attempt
     */
    fun cancelReconnect() {
        reconnectJob?.cancel()
        reconnectJob = null
    }

    /**
     * Reset reconnection state after successful connection
     */
    private fun resetReconnectionState() {
        reconnectAttempts = 0
        currentReconnectDelay = config.baseReconnectDelay
        lastHeartbeatReceived = System.currentTimeMillis()
    }

    /**
     * Monitor heartbeat timeout
     */
    private fun startHeartbeatTimeoutMonitor() {
        heartbeatTimeoutJob?.cancel()
        heartbeatTimeoutJob = scope.launch {
            while (isActive && _connectionState.value == ConnectionState.CONNECTED) {
                delay(config.heartbeatCheckInterval)

                val elapsed = System.currentTimeMillis() - lastHeartbeatReceived
                if (elapsed > config.heartbeatTimeout) {
                    Timber.w("[P2PClient] Heartbeat timeout! Last received ${elapsed}ms ago")
                    _reconnectionEvents.emit(ReconnectionEvent.HeartbeatTimeout(
                        lastReceivedMs = elapsed
                    ))
                    handleDisconnection()
                    break
                }
            }
        }
    }

    /**
     * Stop heartbeat timeout monitor
     */
    private fun stopHeartbeatTimeoutMonitor() {
        heartbeatTimeoutJob?.cancel()
        heartbeatTimeoutJob = null
    }

    /**
     * Get current reconnection status
     */
    fun getReconnectionStatus(): ReconnectionStatus {
        return ReconnectionStatus(
            isReconnecting = _connectionState.value == ConnectionState.RECONNECTING,
            attempts = reconnectAttempts,
            maxAttempts = config.maxReconnectAttempts,
            nextDelayMs = currentReconnectDelay,
            autoReconnectEnabled = autoReconnectEnabled
        )
    }

    /**
     * Send a command and return the raw result (no type conversion).
     * Callers should handle type conversion themselves or use the typed overload.
     */
    suspend fun <T> sendCommand(
        method: String,
        params: Map<String, Any> = emptyMap(),
        timeout: Long = config.requestTimeout
    ): Result<T> = withContext(Dispatchers.IO) {
        if (_connectionState.value != ConnectionState.CONNECTED) {
            return@withContext Result.failure(Exception("Not connected"))
        }
        try {
            // 记录活动（命令执行）
            deviceActivityManager.recordActivity("command_executed")

            val response = sendCommandInternal(method, params, timeout)

            if (response.isError()) {
                return@withContext Result.failure(Exception(response.error?.message ?: "Unknown error"))
            }

            @Suppress("UNCHECKED_CAST")
            Result.success(response.result as T)
        } catch (e: Exception) {
            Timber.e(e, "sendCommand failed: $method")
            Result.failure(e)
        }
    }

    /**
     * Send a command with proper type-safe deserialization via Gson TypeToken.
     * Use this when you need a specific return type (e.g., a data class).
     *
     * Example: sendCommand("ai.chat", params, typeOf = object : TypeToken<ChatResponse>() {}.type)
     */
    suspend fun <T> sendCommand(
        method: String,
        params: Map<String, Any> = emptyMap(),
        timeout: Long = config.requestTimeout,
        typeOf: Type
    ): Result<T> = withContext(Dispatchers.IO) {
        if (_connectionState.value != ConnectionState.CONNECTED) {
            return@withContext Result.failure(Exception("Not connected"))
        }
        try {
            val response = sendCommandInternal(method, params, timeout)

            if (response.isError()) {
                return@withContext Result.failure(Exception(response.error?.message ?: "Unknown error"))
            }

            val result = response.result
            val converted: T = when (result) {
                null -> {
                    @Suppress("UNCHECKED_CAST")
                    null as T
                }
                is String, is Number, is Boolean -> {
                    @Suppress("UNCHECKED_CAST")
                    result as T
                }
                else -> {
                    // Convert via JSON round-trip for proper type safety
                    val json = gson.toJson(result)
                    gson.fromJson(json, typeOf)
                }
            }
            Result.success(converted)
        } catch (e: Exception) {
            Timber.e(e, "sendCommand failed: $method")
            Result.failure(e)
        }
    }

    private suspend fun sendCommandInternal(
        method: String,
        params: Map<String, Any>,
        timeout: Long
    ): CommandResponse = withContext(Dispatchers.IO) {
        val requestId = generateRequestId()
        val requestPayload = mapOf(
            "id" to requestId,
            "method" to method,
            "params" to params,
            "auth" to createAuth(method)
        )

        val deferred = CompletableDeferred<CommandResponse>()
        pendingRequests[requestId] = PendingRequest(
            requestId = requestId,
            method = method,
            timestamp = System.currentTimeMillis(),
            deferred = deferred
        )

        val timeoutJob = scope.launch {
            delay(timeout)
            val pending = pendingRequests.remove(requestId)
            pending?.deferred?.completeExceptionally(Exception("Request timeout: $method"))
        }

        try {
            val message = P2PMessage(
                type = MessageTypes.COMMAND_REQUEST,
                payload = requestPayload.toJsonString()
            )
            webRTCClient.sendMessage(message.toJsonString())
            val response = deferred.await()
            timeoutJob.cancel()
            pendingRequests.remove(requestId)
            response
        } catch (e: Exception) {
            timeoutJob.cancel()
            pendingRequests.remove(requestId)
            throw e
        }
    }

    fun disconnect() {
        // Disable auto-reconnect during intentional disconnect
        autoReconnectEnabled = false
        cancelReconnect()
        stopHeartbeat()
        stopHeartbeatTimeoutMonitor()

        // 通知活动管理器断开连接
        deviceActivityManager.setConnected(false)

        webRTCClient.disconnect()
        pendingRequests.forEach { (_, pending) ->
            pending.deferred.completeExceptionally(Exception("Connection closed"))
        }
        pendingRequests.clear()
        // W2.1: 单 peer-at-a-time invariant，clear all。W2.2 改为 disconnect(peerId) 按目标移除。
        _connectedPeers.value = emptyMap()
        _connectedPeer.value = null // @Deprecated 镜像
        _connectionState.value = ConnectionState.DISCONNECTED

        // Clear stored peer info
        lastConnectedPeerId = null
        lastConnectedPeerDID = null
        resetReconnectionState()
    }

    /**
     * Disconnect but keep auto-reconnect enabled (for temporary disconnections)
     */
    fun disconnectTemporary() {
        stopHeartbeat()
        stopHeartbeatTimeoutMonitor()
        webRTCClient.disconnect()
        pendingRequests.forEach { (_, pending) ->
            pending.deferred.completeExceptionally(Exception("Connection closed temporarily"))
        }
        pendingRequests.clear()
        _connectedPeers.value = emptyMap()
        _connectedPeer.value = null // @Deprecated 镜像
        _connectionState.value = ConnectionState.DISCONNECTED

        // Don't clear lastConnectedPeerId/DID so auto-reconnect can work
        if (autoReconnectEnabled && lastConnectedPeerId != null) {
            scope.launch { scheduleReconnect() }
        }
    }

    private suspend fun handleIncoming(raw: String) {
        // Plan A.1 Trap 2 guard: chainlesschain:command:request envelope (Plan
        // A.1 Phase 2 wire format used by TerminalRpcClient / SignalingRpcClient)
        // shares the same WebRTCClient.messages SharedFlow as P2PMessage frames.
        // SignalingRpcClient sends payload as a JSONObject (not stringified), so
        // blindly decoding through P2PMessage would crash with "Expected beginning
        // of the string, but got {". Skip incoming requests silently so the
        // TerminalRpc / SignalingRpc subscriber can take them.
        //
        // BUT: chainlesschain:command:response **must** pass through here — this
        // is P2PClient.sendCommand's own reply path (PC always returns payload
        // as stringified JSON-RPC 2.0). Skipping responses leaves pendingRequests
        // forever orphan → timeout → "Job was cancelled". Phase 3 file/clipboard/
        // notification 等 RemoteCommandClient 通道走 P2PClient.sendCommand 全
        // 踩这条雷（2026-05-16 file.listDirectory 实测复现）。
        if (raw.contains("\"type\":\"chainlesschain:command:request\"") ||
            raw.contains("\"type\": \"chainlesschain:command:request\"")
        ) {
            // FAMILY-67 (第9层): 两类 command:request 共用本 SharedFlow，需区分：
            //   - SignalingRpc/TerminalRpc：payload 是 **JSONObject**（"payload":{...}），
            //     盲解 P2PMessage 会 crash，交给它们的订阅者 → 跳过。
            //   - P2PClient.sendCommand（sync.push / file.* 等入向请求）：payload 是
            //     **stringified JSON**（"payload":"..."），应落到下面 P2PMessage 解码 →
            //     handleIncomingCommandRequest → CommandRouter（sync.* → SyncCommandRouter）。
            //     旧守卫无脑跳过全部 → 家庭/桌面入向 sync.push 永不被处理（跨设备同步不通的一层）。
            val payloadIsObject = Regex("\"payload\"\\s*:\\s*\\{").containsMatchIn(raw)
            if (payloadIsObject) {
                return
            }
            // payload 是 string → 是 P2PMessage 包的入向命令请求，继续往下走 P2PMessage 解码分发。
        }
        try {
            val message = raw.fromJson<P2PMessage>()
            when (message.type) {
                MessageTypes.COMMAND_REQUEST -> {
                    // Phase 3d M3 step D.5: PC 端发来命令请求（sync.push / sync.pull / sync.ack 等）
                    handleIncomingCommandRequest(message.payload)
                }
                MessageTypes.COMMAND_RESPONSE -> {
                    val response = message.payload.fromJson<CommandResponse>()
                    pendingRequests[response.id]?.deferred?.complete(response)
                }
                MessageTypes.COMMAND_CANCEL -> {
                    // 处理来自 PC 端的取消请求
                    val cancelRequest = message.payload.fromJson<CommandCancelRequest>()
                    handleCommandCancel(cancelRequest)
                }
                MessageTypes.EVENT_NOTIFICATION -> {
                    val event = message.payload.fromJson<EventNotification>()
                    _events.emit(event)
                    // 处理特定类型的事件
                    handleSpecificEvent(event)
                }
                MessageTypes.HEARTBEAT, MessageTypes.HEARTBEAT_ACK, "pong" -> {
                    // Reset heartbeat timeout on any heartbeat-related message
                    lastHeartbeatReceived = System.currentTimeMillis()
                    Timber.v("[P2PClient] Heartbeat received, resetting timeout")
                }

                // ==================== 流式消息处理 ====================
                MessageTypes.STREAM_START -> {
                    val streamStart = message.payload.fromJson<StreamStartMessage>()
                    handleStreamStart(streamStart)
                }
                MessageTypes.STREAM_CHUNK -> {
                    val streamChunk = message.payload.fromJson<StreamChunkMessage>()
                    handleStreamChunk(streamChunk)
                }
                MessageTypes.STREAM_END -> {
                    val streamEnd = message.payload.fromJson<StreamEndMessage>()
                    handleStreamEnd(streamEnd)
                }
                MessageTypes.STREAM_ERROR -> {
                    val streamEnd = message.payload.fromJson<StreamEndMessage>()
                    handleStreamError(streamEnd)
                }

                // ==================== 文件传输进度 ====================
                MessageTypes.FILE_TRANSFER_PROGRESS -> {
                    val progress = message.payload.fromJson<FileTransferProgress>()
                    _fileTransferProgress.emit(progress)
                }

                else -> Timber.w("Unknown P2P message type: ${message.type}")
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to handle incoming message")
        }
    }

    /**
     * 处理特定类型的事件通知
     */
    private suspend fun handleSpecificEvent(event: EventNotification) {
        when (event.method) {
            // 进度类事件转换为进度通知
            "progress.update" -> {
                val progress = ProgressNotification(
                    operationId = event.params["operationId"] as? String ?: "",
                    operationType = event.params["operationType"] as? String ?: "",
                    progress = (event.params["progress"] as? Number)?.toFloat() ?: 0f,
                    currentStep = event.params["currentStep"] as? String,
                    totalSteps = (event.params["totalSteps"] as? Number)?.toInt(),
                    currentStepIndex = (event.params["currentStepIndex"] as? Number)?.toInt(),
                    estimatedRemainingMs = (event.params["estimatedRemainingMs"] as? Number)?.toLong()
                )
                _progressUpdates.emit(progress)
            }
            // 文件传输进度
            "file.transfer.progress" -> {
                val progress = FileTransferProgress(
                    transferId = event.params["transferId"] as? String ?: "",
                    fileName = event.params["fileName"] as? String ?: "",
                    filePath = event.params["filePath"] as? String ?: "",
                    direction = event.params["direction"] as? String ?: "download",
                    bytesTransferred = (event.params["bytesTransferred"] as? Number)?.toLong() ?: 0,
                    totalBytes = (event.params["totalBytes"] as? Number)?.toLong() ?: 0,
                    progress = (event.params["progress"] as? Number)?.toFloat() ?: 0f,
                    speed = (event.params["speed"] as? Number)?.toLong() ?: 0,
                    estimatedRemainingMs = (event.params["estimatedRemainingMs"] as? Number)?.toLong(),
                    state = event.params["state"] as? String ?: "transferring"
                )
                _fileTransferProgress.emit(progress)
            }
        }
    }

    // ==================== 流式消息处理方法 ====================

    private suspend fun handleStreamStart(streamStart: StreamStartMessage) {
        Timber.d("[P2PClient] Stream started: ${streamStart.streamId}")
        activeStreams[streamStart.streamId] = StreamState(
            streamId = streamStart.streamId,
            method = streamStart.method,
            startTime = System.currentTimeMillis(),
            totalChunks = streamStart.totalChunks,
            receivedChunks = 0
        )
        _streamStart.emit(streamStart)
    }

    private suspend fun handleStreamChunk(streamChunk: StreamChunkMessage) {
        val state = activeStreams[streamChunk.streamId]
        if (state != null) {
            activeStreams[streamChunk.streamId] = state.copy(
                receivedChunks = state.receivedChunks + 1,
                lastChunkTime = System.currentTimeMillis()
            )
        }
        _streamChunks.emit(streamChunk)
    }

    private suspend fun handleStreamEnd(streamEnd: StreamEndMessage) {
        Timber.d("[P2PClient] Stream ended: ${streamEnd.streamId}, success=${streamEnd.success}")
        activeStreams.remove(streamEnd.streamId)
        _streamEnd.emit(streamEnd)
    }

    private suspend fun handleStreamError(streamEnd: StreamEndMessage) {
        Timber.e("[P2PClient] Stream error: ${streamEnd.streamId}, error=${streamEnd.error}")
        activeStreams.remove(streamEnd.streamId)
        _streamEnd.emit(streamEnd.copy(success = false))
    }

    /**
     * 获取活跃流状态
     */
    fun getActiveStreams(): List<StreamState> {
        return activeStreams.values.toList()
    }

    /**
     * 取消活跃流
     */
    suspend fun cancelStream(streamId: String): Result<Unit> {
        return try {
            val cancelRequest = mapOf(
                "type" to "stream_cancel",
                "streamId" to streamId
            )
            val message = P2PMessage(
                type = "chainlesschain:stream:cancel",
                payload = cancelRequest.toJsonString()
            )
            webRTCClient.sendMessage(message.toJsonString())
            activeStreams.remove(streamId)
            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "[P2PClient] 取消流失败: $streamId")
            Result.failure(e)
        }
    }

    /**
     * Phase 3d M3 step D.5: 处理 PC → Android 入向命令请求。
     *
     * payload 解为 CommandRequest 后按 method 分发给注入的 commandRouter
     * （SyncCommandRouter 处理 sync.* 命名空间）。Result 回包成
     * COMMAND_RESPONSE 走 webRTCClient 反向发回 PC。**v1 不验证 auth**——
     * 已配对设备在 pairing 阶段做过 DID 互信，sync 路径暂跳过签名校验。v2 加。
     */
    private suspend fun handleIncomingCommandRequest(payload: String) {
        var requestId = ""
        try {
            val request = payload.fromJson<CommandRequest>()
            requestId = request.id
            Timber.d("[P2PClient] incoming command: ${request.method} (id=${request.id})")

            // Phase 3d v1.2 #2 (flip strict): sync.* 命名空间强制 auth 非 null。
            // Desktop side mobile-bridge-sync.js v1.2 #1 已开始发 AuthInfo；任何还
            // 不发 auth 的 desktop 客户端会被拒（升级 desktop 即可）。
            // 真密码学签名 v1.2 next iteration 加（需 peer pubkey 交换）。
            if (request.method.startsWith("sync.")) {
                val auth = request.auth
                    ?: throw SecurityException(
                        "sync.* request requires auth field (method=${request.method}); " +
                            "desktop client may be pre-v1.2 — please upgrade"
                    )
                syncAuthVerifier.get().verify(auth, request.method)
            }

            val result = commandRouter.route(request.method, request.params)
            sendCommandResponse(requestId = requestId, result = result, error = null)
        } catch (e: SecurityException) {
            // v1.1 #2 auth 校验失败
            Timber.w(e, "[P2PClient] AUTHENTICATION_FAILED: id=$requestId")
            sendCommandResponse(
                requestId = requestId,
                result = null,
                error = ErrorInfo(ErrorCodes.AUTHENTICATION_FAILED, e.message ?: "auth failed")
            )
        } catch (e: IllegalArgumentException) {
            // CommandRouter 抛 IllegalArgumentException → method-not-found
            Timber.w(e, "[P2PClient] METHOD_NOT_FOUND: id=$requestId")
            sendCommandResponse(
                requestId = requestId,
                result = null,
                error = ErrorInfo(ErrorCodes.METHOD_NOT_FOUND, e.message ?: "Method not found")
            )
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            Timber.e(e, "[P2PClient] command request failed: id=$requestId")
            sendCommandResponse(
                requestId = requestId,
                result = null,
                error = ErrorInfo(ErrorCodes.INTERNAL_ERROR, e.message ?: e.javaClass.simpleName)
            )
        }
    }

    /**
     * 包 CommandResponse → P2PMessage(COMMAND_RESPONSE) → webRTCClient.sendMessage。
     * result 走 Gson 序列化（@Contextual Any 兼容）；error 是 nullable
     * @Serializable 直接走 kotlinx。
     */
    private fun sendCommandResponse(requestId: String, result: Any?, error: ErrorInfo?) {
        try {
            // 用 Gson 序列化 result 内嵌对象（与 sendCommandInternal 出向 result 解码对称）
            // CommandResponse 走 @Contextual，需 JsonSerializer + 自定义 contextual ——
            // 简化：构造一个 Map<String, Any?> 然后 Gson 序列化整体 payload。
            val responseMap = mutableMapOf<String, Any?>(
                "jsonrpc" to "2.0",
                "id" to requestId
            )
            if (error != null) {
                responseMap["error"] = mapOf(
                    "code" to error.code,
                    "message" to error.message,
                    "data" to error.data
                )
            } else {
                responseMap["result"] = result
            }
            val payload = gson.toJson(responseMap)
            val message = P2PMessage(type = MessageTypes.COMMAND_RESPONSE, payload = payload)
            webRTCClient.sendMessage(message.toJsonString())
        } catch (e: Exception) {
            Timber.e(e, "[P2PClient] sendCommandResponse 失败: id=$requestId")
        }
    }

    /**
     * 处理来自 PC 端的命令取消请求
     */
    private fun handleCommandCancel(cancelRequest: CommandCancelRequest) {
        Timber.i("[P2PClient] 收到取消请求: ${cancelRequest.id} (${cancelRequest.reason ?: "no reason"})")

        val pending = pendingRequests[cancelRequest.id]
        if (pending != null) {
            // 取消待处理请求
            pending.deferred.completeExceptionally(
                CommandCancelledException(cancelRequest.reason ?: "Cancelled by server")
            )
            pendingRequests.remove(cancelRequest.id)
            Timber.i("[P2PClient] 命令已取消: ${cancelRequest.id}")
        } else {
            Timber.w("[P2PClient] 取消请求的命令不存在或已完成: ${cancelRequest.id}")
        }
    }

    /**
     * 取消正在执行的命令（发送取消请求到 PC 端）
     */
    suspend fun cancelCommand(commandId: String, reason: String = "Cancelled by client"): Result<Unit> {
        return try {
            Timber.d("[P2PClient] 取消命令: $commandId")

            val cancelRequest = CommandCancelRequest(
                id = commandId,
                reason = reason
            )

            val message = P2PMessage(
                type = MessageTypes.COMMAND_CANCEL,
                payload = cancelRequest.toJsonString()
            )

            webRTCClient.sendMessage(message.toJsonString())

            // 同时取消本地等待
            val pending = pendingRequests.remove(commandId)
            pending?.deferred?.completeExceptionally(
                CommandCancelledException(reason)
            )

            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "[P2PClient] 取消命令失败: $commandId")
            Result.failure(e)
        }
    }

    /**
     * 获取当前待处理的命令列表
     */
    fun getPendingCommands(): List<PendingCommandInfo> {
        val now = System.currentTimeMillis()
        return pendingRequests.values.map { pending ->
            PendingCommandInfo(
                requestId = pending.requestId,
                method = pending.method,
                timestamp = pending.timestamp,
                elapsedMs = now - pending.timestamp
            )
        }
    }

    private suspend fun createAuth(method: String): AuthInfo {
        val timestamp = System.currentTimeMillis()
        val did = didManager.getCurrentDID()
        // 使用 NonceManager 生成持久化的 Nonce（防重放攻击）
        val nonce = nonceManager.generateNonce(did)
        val signature = didManager.sign("$method:$timestamp:$nonce")
        return AuthInfo(
            did = did,
            signature = signature,
            timestamp = timestamp,
            nonce = nonce
        )
    }

    private fun startHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = scope.launch {
            while (isActive && _connectionState.value == ConnectionState.CONNECTED) {
                try {
                    val heartbeat = P2PMessage(
                        type = MessageTypes.HEARTBEAT,
                        payload = mapOf("timestamp" to System.currentTimeMillis()).toJsonString()
                    )
                    webRTCClient.sendMessage(heartbeat.toJsonString())
                } catch (e: Exception) {
                    Timber.w(e, "Heartbeat failed")
                }
                delay(config.heartbeatInterval)
            }
        }
    }

    private fun stopHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = null
    }

    private fun generateRequestId(): String {
        return "req-${System.currentTimeMillis()}-${Random.nextInt(100000, 999999)}"
    }

    // ==================== RemoteSkillProvider implementation ====================

    override val isRemoteConnected: Boolean
        get() = _connectionState.value == ConnectionState.CONNECTED

    override suspend fun <T> sendRemoteCommand(
        method: String,
        params: Map<String, Any>,
        timeout: Long
    ): Result<T> = sendCommand(method, params, timeout)
}

enum class ConnectionState {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    RECONNECTING,
    ERROR
}

data class PeerInfo(
    val peerId: String,
    val did: String,
    val connectedAt: Long
)

data class PendingRequest(
    val requestId: String,
    val method: String,
    val timestamp: Long,
    val deferred: CompletableDeferred<CommandResponse>
)

data class P2PClientConfig(
    val requestTimeout: Long = 30_000,
    val heartbeatInterval: Long = 30_000,
    val heartbeatTimeout: Long = 90_000,        // 90 seconds timeout
    val heartbeatCheckInterval: Long = 10_000,  // Check every 10 seconds
    val maxRetries: Int = 3,
    val retryDelay: Long = 1_000,

    // Reconnection configuration (exponential backoff)
    val baseReconnectDelay: Long = 1_000,       // Start with 1 second
    val maxReconnectDelay: Long = 60_000,       // Max 60 seconds
    val reconnectBackoffFactor: Double = 2.0,   // Double each time
    val maxReconnectAttempts: Int = 10          // Max 10 attempts before giving up
)

/**
 * Reconnection status for UI updates
 */
data class ReconnectionStatus(
    val isReconnecting: Boolean,
    val attempts: Int,
    val maxAttempts: Int,
    val nextDelayMs: Long,
    val autoReconnectEnabled: Boolean
)

/**
 * Reconnection events for observing reconnection progress
 */
sealed class ReconnectionEvent {
    data class Scheduled(
        val attempt: Int,
        val delayMs: Long
    ) : ReconnectionEvent()

    data class Attempting(
        val attempt: Int
    ) : ReconnectionEvent()

    data class Success(
        val attempts: Int
    ) : ReconnectionEvent()

    data class Failed(
        val attempts: Int,
        val reason: String
    ) : ReconnectionEvent()

    data class HeartbeatTimeout(
        val lastReceivedMs: Long
    ) : ReconnectionEvent()
}

/**
 * 命令被取消异常
 */
class CommandCancelledException(
    message: String
) : Exception("Command cancelled: $message")

/**
 * 待处理命令信息（用于 UI 显示）
 */
data class PendingCommandInfo(
    val requestId: String,
    val method: String,
    val timestamp: Long,
    val elapsedMs: Long
)

/**
 * 流状态信息
 */
@Immutable
data class StreamState(
    val streamId: String,
    val method: String,
    val startTime: Long,
    val totalChunks: Int? = null,
    val receivedChunks: Int = 0,
    val lastChunkTime: Long? = null
) {
    val elapsedMs: Long get() = System.currentTimeMillis() - startTime
    val progress: Float? get() = totalChunks?.let { receivedChunks.toFloat() / it }
}
